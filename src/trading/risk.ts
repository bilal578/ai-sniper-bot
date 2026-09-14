import type { Config } from '../config.js';
import { LAMPORTS_PER_SOL } from '../config.js';
import { getLogger } from '../logger.js';
import type { Position } from '../types.js';

const log = getLogger('risk');

export interface RiskDecision {
  allowed: boolean;
  reason: string;
}

const ALLOW: RiskDecision = { allowed: true, reason: 'ok' };
const deny = (reason: string): RiskDecision => ({ allowed: false, reason });

/**
 * The last gate before funds move. Everything here is a hard limit — the AI
 * cannot talk its way past a risk rule.
 */
export class RiskManager {
  private tradeTimestamps: number[] = [];
  private realisedPnlLamports = 0;
  private dayStart = startOfUtcDay(Date.now());
  private readonly cooldowns = new Map<string, number>();

  constructor(private readonly cfg: Config) {}

  private rollDayIfNeeded(now: number): void {
    const today = startOfUtcDay(now);
    if (today !== this.dayStart) {
      log.info({ previousPnlSol: this.realisedPnlLamports / LAMPORTS_PER_SOL }, 'daily risk counters reset');
      this.dayStart = today;
      this.realisedPnlLamports = 0;
    }
  }

  canOpenPosition(params: {
    openPositions: Position[];
    walletLamports: number;
    mint: string;
    now?: number;
  }): RiskDecision {
    const now = params.now ?? Date.now();
    this.rollDayIfNeeded(now);

    if (params.openPositions.length >= this.cfg.MAX_CONCURRENT_POSITIONS) {
      return deny(`max concurrent positions reached (${this.cfg.MAX_CONCURRENT_POSITIONS})`);
    }

    if (params.openPositions.some((p) => p.mint === params.mint)) {
      return deny('already holding this mint');
    }

    const cooldownUntil = this.cooldowns.get(params.mint);
    if (cooldownUntil && now < cooldownUntil) {
      return deny(`mint on cooldown for another ${Math.ceil((cooldownUntil - now) / 1000)}s`);
    }

    this.tradeTimestamps = this.tradeTimestamps.filter((t) => now - t < 3_600_000);
    if (this.tradeTimestamps.length >= this.cfg.MAX_TRADES_PER_HOUR) {
      return deny(`hourly trade limit reached (${this.cfg.MAX_TRADES_PER_HOUR})`);
    }

    const lossSol = -this.realisedPnlLamports / LAMPORTS_PER_SOL;
    if (lossSol >= this.cfg.MAX_DAILY_LOSS_SOL) {
      return deny(`daily loss limit hit (${lossSol.toFixed(3)} / ${this.cfg.MAX_DAILY_LOSS_SOL} SOL)`);
    }

    // Keep enough SOL behind to pay the fees on the *exit*. A position we
    // cannot sell is worse than a position we never opened.
    const reserveLamports = this.cfg.MIN_WALLET_RESERVE_SOL * LAMPORTS_PER_SOL;
    if (params.walletLamports - this.cfg.buyAmountLamports < reserveLamports) {
      return deny(
        `insufficient balance: ${(params.walletLamports / LAMPORTS_PER_SOL).toFixed(4)} SOL, ` +
          `need ${(this.cfg.BUY_AMOUNT_SOL + this.cfg.MIN_WALLET_RESERVE_SOL).toFixed(4)} SOL incl. reserve`,
      );
    }

    return ALLOW;
  }

  recordTrade(now = Date.now()): void {
    this.tradeTimestamps.push(now);
  }

  recordRealisedPnl(lamports: number, now = Date.now()): void {
    this.rollDayIfNeeded(now);
    this.realisedPnlLamports += lamports;
  }

  /** Blocks re-entry into a mint we just exited, so a chop does not drain fees. */
  setCooldown(mint: string, ms: number, now = Date.now()): void {
    this.cooldowns.set(mint, now + ms);
  }

  get dailyPnlSol(): number {
    return this.realisedPnlLamports / LAMPORTS_PER_SOL;
  }

  get tradesThisHour(): number {
    const now = Date.now();
    return this.tradeTimestamps.filter((t) => now - t < 3_600_000).length;
  }
}

export function startOfUtcDay(ms: number): number {
  return Math.floor(ms / 86_400_000) * 86_400_000;
}
