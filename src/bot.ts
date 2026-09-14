import { Connection } from '@solana/web3.js';
import type { Config } from './config.js';
import { LAMPORTS_PER_SOL, WSOL_MINT } from './config.js';
import { getLogger } from './logger.js';
import { errorMessage, shortAddress } from './utils/index.js';
import { createConnection } from './solana/connection.js';
import { JupiterClient } from './solana/jupiter.js';
import { fetchDexScreener, fetchMintInfo } from './solana/tokens.js';
import { TokenWatcher } from './discovery/watcher.js';
import { RugChecker } from './safety/rugcheck.js';
import { AiAnalyzer } from './ai/analyzer.js';
import { RiskManager } from './trading/risk.js';
import { TradeExecutor } from './trading/executor.js';
import { PositionManager } from './trading/positionManager.js';
import { PositionStore } from './store/positions.js';
import { Wallet } from './wallet.js';
import type { TokenCandidate } from './types.js';

const log = getLogger('bot');

export interface BotStats {
  detected: number;
  safetyRejected: number;
  aiRejected: number;
  riskRejected: number;
  bought: number;
  buyFailed: number;
}

export class SniperBot {
  readonly connection: Connection;
  readonly wallet: Wallet;
  readonly store: PositionStore;
  readonly risk: RiskManager;

  private readonly jupiter: JupiterClient;
  private readonly watcher: TokenWatcher;
  private readonly rugChecker: RugChecker;
  private readonly ai: AiAnalyzer;
  private readonly executor: TradeExecutor;
  private readonly positions: PositionManager;

  private solPriceUsd: number | null = null;
  private solPriceTimer: NodeJS.Timeout | null = null;
  private shuttingDown = false;
  /** Mints currently being evaluated, so a duplicate log never double-buys. */
  private readonly inFlight = new Set<string>();

  readonly stats: BotStats = {
    detected: 0,
    safetyRejected: 0,
    aiRejected: 0,
    riskRejected: 0,
    bought: 0,
    buyFailed: 0,
  };

  constructor(private readonly cfg: Config) {
    this.connection = createConnection(cfg);
    this.wallet = Wallet.from(cfg);
    this.store = new PositionStore(cfg.DATA_DIR);
    this.risk = new RiskManager(cfg);
    this.jupiter = new JupiterClient(cfg, this.connection);
    this.watcher = new TokenWatcher(cfg, this.connection);
    this.rugChecker = new RugChecker(cfg, this.connection);
    this.ai = new AiAnalyzer(cfg);
    this.executor = new TradeExecutor(cfg, this.connection, this.jupiter, this.wallet);
    this.positions = new PositionManager(cfg, this.store, this.jupiter, this.executor, this.risk);
  }

  async start(): Promise<void> {
    await this.store.load();
    await this.refreshSolPrice();
    this.solPriceTimer = setInterval(() => void this.refreshSolPrice(), 60_000);

    const balanceSol = await this.wallet.getBalanceSol(this.connection).catch(() => 0);

    log.info(
      {
        mode: this.cfg.live ? 'LIVE' : 'DRY RUN',
        wallet: shortAddress(this.wallet.address, 6),
        balanceSol: balanceSol.toFixed(4),
        buySizeSol: this.cfg.BUY_AMOUNT_SOL,
        maxPositions: this.cfg.MAX_CONCURRENT_POSITIONS,
        ai: this.ai.enabled ? this.cfg.AI_MODEL : 'disabled',
        openPositions: this.store.open().length,
      },
      this.cfg.live ? '🔴 LIVE TRADING — real funds at risk' : '🧪 dry run — no funds will move',
    );

    if (this.cfg.live && balanceSol < this.cfg.BUY_AMOUNT_SOL + this.cfg.MIN_WALLET_RESERVE_SOL) {
      log.warn(
        { balanceSol, required: this.cfg.BUY_AMOUNT_SOL + this.cfg.MIN_WALLET_RESERVE_SOL },
        'wallet balance is below one trade plus reserve — buys will be blocked by the risk manager',
      );
    }

    this.watcher.on('candidate', (candidate) => {
      this.stats.detected++;
      void this.handleCandidate(candidate);
    });

    await this.watcher.start();
    this.positions.start();
  }

  /**
   * The full pipeline for one detected token:
   *   safety checks -> AI judgement -> risk limits -> buy
   * Each stage can veto, and nothing below a stage runs if it does.
   */
  private async handleCandidate(candidate: TokenCandidate): Promise<void> {
    const { mint } = candidate;
    if (this.shuttingDown) return;
    if (this.inFlight.has(mint)) return;
    this.inFlight.add(mint);

    try {
      const safety = await this.rugChecker.checkSafely(candidate, this.solPriceUsd);
      if (!safety || !safety.passed) {
        this.stats.safetyRejected++;
        log.info(
          { mint, failed: safety?.checks.filter((c) => !c.passed && c.critical).map((c) => c.name) ?? ['error'] },
          'rejected by safety checks',
        );
        return;
      }

      const verdict = await this.ai.analyze(candidate, safety);
      if (verdict.decision !== 'buy' || verdict.score < this.cfg.AI_MIN_SCORE) {
        this.stats.aiRejected++;
        log.info(
          { mint, score: verdict.score, threshold: this.cfg.AI_MIN_SCORE, reason: verdict.reasoning },
          'rejected by AI analysis',
        );
        return;
      }

      // Re-read the balance here rather than caching it: a concurrent buy may
      // have spent it since this candidate arrived.
      const walletLamports = this.cfg.live
        ? await this.wallet.getBalanceLamports(this.connection)
        : Number.MAX_SAFE_INTEGER / 2;

      const decision = this.risk.canOpenPosition({
        openPositions: this.store.open(),
        walletLamports,
        mint,
      });
      if (!decision.allowed) {
        this.stats.riskRejected++;
        log.info({ mint, reason: decision.reason }, 'rejected by risk manager');
        return;
      }

      const mintInfo = await fetchMintInfo(this.connection, mint);
      const position = await this.executor.buy(candidate, mintInfo.decimals, {
        aiScore: verdict.score,
        safetyScore: safety.score,
      });

      await this.store.upsert(position);
      this.risk.recordTrade();
      this.stats.bought++;

      log.info(
        { mint, symbol: candidate.symbol, aiScore: verdict.score, safetyScore: safety.score, reasoning: verdict.reasoning },
        '✅ sniped',
      );
    } catch (error) {
      this.stats.buyFailed++;
      log.error({ mint, err: errorMessage(error) }, 'candidate pipeline failed');
    } finally {
      this.inFlight.delete(mint);
    }
  }

  /** Manual entry point, used by the `buy` CLI command. */
  async snipeManually(mint: string): Promise<void> {
    await this.handleCandidate({
      mint,
      source: 'manual',
      signature: 'manual',
      detectedAt: Date.now(),
    });
  }

  private async refreshSolPrice(): Promise<void> {
    const data = await fetchDexScreener(WSOL_MINT, null);
    if (data?.priceUsd) {
      this.solPriceUsd = data.priceUsd;
      log.debug({ solPriceUsd: this.solPriceUsd }, 'sol price refreshed');
    } else if (this.solPriceUsd === null) {
      log.warn('could not fetch SOL price — liquidity checks will treat USD values as unknown');
    }
  }

  summary(): string {
    const closed = this.store.closed();
    const pnlSol =
      closed.reduce((sum, p) => sum + (p.realisedLamports - p.entryLamports), 0) / LAMPORTS_PER_SOL;
    const wins = closed.filter((p) => p.realisedLamports > p.entryLamports).length;

    return [
      `detected=${this.stats.detected}`,
      `bought=${this.stats.bought}`,
      `closed=${closed.length}`,
      `wins=${wins}`,
      `rejected(safety/ai/risk)=${this.stats.safetyRejected}/${this.stats.aiRejected}/${this.stats.riskRejected}`,
      `realisedPnl=${pnlSol.toFixed(4)} SOL`,
    ].join('  ');
  }

  async shutdown(liquidate: boolean): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    log.info({ liquidate }, 'shutting down');

    if (this.solPriceTimer) clearInterval(this.solPriceTimer);
    this.positions.stop();
    await this.watcher.stop();

    if (liquidate) {
      await this.positions.closeAll('shutdown');
    } else if (this.store.open().length > 0) {
      log.warn(
        { open: this.store.open().length },
        'positions left open — they are saved to disk and will be resumed on next start',
      );
    }

    log.info(this.summary());
  }
}
