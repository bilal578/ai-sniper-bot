import { EventEmitter } from 'node:events';
import type { Config } from '../config.js';
import { LAMPORTS_PER_SOL } from '../config.js';
import { getLogger } from '../logger.js';
import { errorMessage, pnlPct } from '../utils/index.js';
import type { JupiterClient } from '../solana/jupiter.js';
import type { PositionStore } from '../store/positions.js';
import type { TradeExecutor } from './executor.js';
import type { RiskManager } from './risk.js';
import type { ExitReason, Position } from '../types.js';

const log = getLogger('positions');

export interface ExitSignal {
  reason: ExitReason;
  /** Portion of the remaining position to sell, 0-1. */
  fraction: number;
}

/**
 * Decides whether an open position should be (partially) exited.
 *
 * Pure and synchronous so the exit ladder can be unit-tested exhaustively
 * without any network involvement.
 */
export function evaluateExit(
  position: Position,
  currentPrice: number,
  cfg: Pick<Config, 'TAKE_PROFIT_PCT' | 'STOP_LOSS_PCT' | 'TRAILING_STOP_PCT' | 'MAX_HOLD_MINUTES' | 'PARTIAL_TP_PCT'>,
  now = Date.now(),
): ExitSignal | null {
  if (!Number.isFinite(currentPrice) || currentPrice <= 0 || position.entryPrice <= 0) return null;

  const changePct = pnlPct(position.entryPrice, currentPrice);
  const peak = Math.max(position.peakPrice, currentPrice);

  // Stop loss first: capital preservation outranks every upside rule.
  if (changePct <= -cfg.STOP_LOSS_PCT) {
    return { reason: 'stop_loss', fraction: 1 };
  }

  // Trailing stop only arms once we are in profit, otherwise it would just
  // duplicate the stop loss at a tighter distance.
  if (cfg.TRAILING_STOP_PCT > 0 && peak > position.entryPrice) {
    const dropFromPeak = pnlPct(peak, currentPrice);
    if (dropFromPeak <= -cfg.TRAILING_STOP_PCT) {
      return { reason: 'trailing_stop', fraction: 1 };
    }
  }

  if (changePct >= cfg.TAKE_PROFIT_PCT) {
    // Scale out: bank a slice at target and let the rest ride the trailing stop.
    if (!position.partialTaken && cfg.PARTIAL_TP_PCT > 0 && cfg.PARTIAL_TP_PCT < 100) {
      return { reason: 'partial_take_profit', fraction: cfg.PARTIAL_TP_PCT / 100 };
    }
    if (position.partialTaken && cfg.PARTIAL_TP_PCT > 0 && cfg.PARTIAL_TP_PCT < 100) {
      // The remainder is now managed by the trailing stop, not a second TP.
      return null;
    }
    return { reason: 'take_profit', fraction: 1 };
  }

  const heldMinutes = (now - position.openedAt) / 60_000;
  if (heldMinutes >= cfg.MAX_HOLD_MINUTES) {
    return { reason: 'max_hold', fraction: 1 };
  }

  return null;
}

export interface PositionManagerEvents {
  closed: [Position];
}

export class PositionManager extends EventEmitter<PositionManagerEvents> {
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;

  constructor(
    private readonly cfg: Config,
    private readonly store: PositionStore,
    private readonly jupiter: JupiterClient,
    private readonly executor: TradeExecutor,
    private readonly risk: RiskManager,
  ) {
    super();
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.cfg.PRICE_POLL_INTERVAL_MS);
    log.info({ intervalMs: this.cfg.PRICE_POLL_INTERVAL_MS }, 'position manager started');
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One monitoring pass over every open position. */
  async tick(): Promise<void> {
    // Overlapping ticks could issue two exits for the same position.
    if (this.ticking) return;
    this.ticking = true;

    try {
      const open = this.store.open().filter((p) => p.status === 'open');
      await Promise.allSettled(open.map((p) => this.evaluate(p)));
    } finally {
      this.ticking = false;
    }
  }

  private async evaluate(position: Position): Promise<void> {
    const price = await this.jupiter.getTokenPriceInSol(
      position.mint,
      position.tokenAmountRaw,
      position.tokenDecimals,
    );

    if (price === null || price <= 0) {
      // No route usually means liquidity was pulled. There is nothing to sell
      // into, so flag it loudly rather than pretending the position is fine.
      log.warn({ mint: position.mint }, 'no sell route available — liquidity may have been removed');
      return;
    }

    position.lastPrice = price;
    position.peakPrice = Math.max(position.peakPrice, price);
    await this.store.upsert(position);

    const signal = evaluateExit(position, price, this.cfg);
    if (!signal) {
      log.debug(
        { mint: position.mint, pnlPct: pnlPct(position.entryPrice, price).toFixed(1) },
        'holding',
      );
      return;
    }

    await this.exit(position, signal);
  }

  async exit(position: Position, signal: ExitSignal): Promise<void> {
    if (position.status !== 'open') return;

    position.status = 'closing';
    await this.store.upsert(position);

    try {
      const { lamports, signature } = await this.executor.sell(position, signal.fraction, signal.reason);

      position.realisedLamports += lamports;
      position.sellSignatures.push(signature);

      const partial = signal.reason === 'partial_take_profit' && signal.fraction < 1;
      if (partial) {
        const remaining =
          (BigInt(position.tokenAmountRaw) * BigInt(10_000 - Math.round(signal.fraction * 10_000))) / 10_000n;
        position.tokenAmountRaw = remaining.toString();
        position.entryLamports = Math.round(position.entryLamports * (1 - signal.fraction));
        position.partialTaken = true;
        position.status = 'open';
        log.info({ mint: position.mint, solOut: lamports / LAMPORTS_PER_SOL }, 'partial take-profit filled');
      } else {
        position.status = 'closed';
        position.closedAt = Date.now();
        position.exitReason = signal.reason;

        const pnlLamports = position.realisedLamports - position.entryLamports;
        this.risk.recordRealisedPnl(pnlLamports);
        // Do not immediately re-enter a token we just exited.
        this.risk.setCooldown(position.mint, this.cfg.MAX_HOLD_MINUTES * 60_000);

        log.info(
          {
            mint: position.mint,
            reason: signal.reason,
            pnlSol: (pnlLamports / LAMPORTS_PER_SOL).toFixed(4),
            pnlPct: pnlPct(position.entryLamports, position.realisedLamports).toFixed(1),
          },
          'position closed',
        );
        this.emit('closed', position);
      }

      await this.store.upsert(position);
    } catch (error) {
      // Back to `open` so the next tick retries — a stuck `closing` position
      // would never be monitored again.
      position.status = 'open';
      position.error = errorMessage(error);
      await this.store.upsert(position);
      log.error({ mint: position.mint, reason: signal.reason, err: position.error }, 'exit failed; will retry next tick');
    }
  }

  /** Best-effort liquidation of everything, used on shutdown. */
  async closeAll(reason: ExitReason = 'shutdown'): Promise<void> {
    const open = this.store.open().filter((p) => p.status === 'open');
    if (open.length === 0) return;
    log.info({ count: open.length }, 'closing all open positions');
    await Promise.allSettled(open.map((p) => this.exit(p, { reason, fraction: 1 })));
  }
}
