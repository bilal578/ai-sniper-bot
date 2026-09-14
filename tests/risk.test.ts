import { describe, expect, it, beforeEach } from 'vitest';
import { loadConfig, type Config } from '../src/config.js';
import { RiskManager } from '../src/trading/risk.js';
import type { Position } from '../src/types.js';

const LAMPORTS = 1e9;

function makeConfig(overrides: Record<string, string> = {}): Config {
  return loadConfig({
    RPC_HTTP_URL: 'https://example.com',
    ENABLE_AI_ANALYSIS: 'false',
    BUY_AMOUNT_SOL: '0.1',
    MIN_WALLET_RESERVE_SOL: '0.02',
    MAX_CONCURRENT_POSITIONS: '2',
    MAX_TRADES_PER_HOUR: '3',
    MAX_DAILY_LOSS_SOL: '0.5',
    ...overrides,
  });
}

const openPosition = (mint: string): Position =>
  ({ mint, status: 'open' }) as Position;

describe('RiskManager', () => {
  let risk: RiskManager;
  beforeEach(() => {
    risk = new RiskManager(makeConfig());
  });

  const ctx = (over: Partial<Parameters<RiskManager['canOpenPosition']>[0]> = {}) => ({
    openPositions: [] as Position[],
    walletLamports: 1 * LAMPORTS,
    mint: 'MINT_A',
    ...over,
  });

  it('allows a trade when every limit has headroom', () => {
    expect(risk.canOpenPosition(ctx()).allowed).toBe(true);
  });

  it('blocks once the concurrent position cap is reached', () => {
    const decision = risk.canOpenPosition(ctx({ openPositions: [openPosition('X'), openPosition('Y')] }));
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/max concurrent/);
  });

  it('refuses to double up on a mint already held', () => {
    const decision = risk.canOpenPosition(ctx({ openPositions: [openPosition('MINT_A')] }));
    expect(decision.reason).toMatch(/already holding/);
  });

  it('honours the wallet reserve', () => {
    // 0.11 SOL cannot fund a 0.1 buy while keeping 0.02 in reserve.
    const decision = risk.canOpenPosition(ctx({ walletLamports: 0.11 * LAMPORTS }));
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/insufficient balance/);
  });

  it('enforces the hourly trade cap', () => {
    for (let i = 0; i < 3; i++) risk.recordTrade();
    expect(risk.canOpenPosition(ctx()).reason).toMatch(/hourly trade limit/);
  });

  it('forgets trades older than an hour', () => {
    const old = Date.now() - 3_700_000;
    for (let i = 0; i < 3; i++) risk.recordTrade(old);
    expect(risk.canOpenPosition(ctx()).allowed).toBe(true);
  });

  it('halts trading after the daily loss limit', () => {
    risk.recordRealisedPnl(-0.6 * LAMPORTS);
    expect(risk.canOpenPosition(ctx()).reason).toMatch(/daily loss limit/);
  });

  it('keeps trading while losses stay under the limit', () => {
    risk.recordRealisedPnl(-0.4 * LAMPORTS);
    expect(risk.canOpenPosition(ctx()).allowed).toBe(true);
  });

  it('does not count profits against the loss limit', () => {
    risk.recordRealisedPnl(2 * LAMPORTS);
    expect(risk.canOpenPosition(ctx()).allowed).toBe(true);
    expect(risk.dailyPnlSol).toBeCloseTo(2);
  });

  it('blocks re-entry while a mint is cooling down', () => {
    risk.setCooldown('MINT_A', 60_000);
    expect(risk.canOpenPosition(ctx()).reason).toMatch(/cooldown/);
  });

  it('allows re-entry once the cooldown expires', () => {
    risk.setCooldown('MINT_A', 1_000, Date.now() - 10_000);
    expect(risk.canOpenPosition(ctx()).allowed).toBe(true);
  });
});
