import { describe, expect, it } from 'vitest';
import { evaluateExit } from '../src/trading/positionManager.js';
import type { Position } from '../src/types.js';

const cfg = {
  TAKE_PROFIT_PCT: 80,
  STOP_LOSS_PCT: 35,
  TRAILING_STOP_PCT: 25,
  MAX_HOLD_MINUTES: 30,
  PARTIAL_TP_PCT: 50,
};

function position(overrides: Partial<Position> = {}): Position {
  return {
    id: 'p1',
    mint: 'mint',
    source: 'raydium',
    status: 'open',
    entryLamports: 50_000_000,
    tokenAmountRaw: '1000000000',
    tokenDecimals: 6,
    entryPrice: 1,
    peakPrice: 1,
    lastPrice: 1,
    openedAt: Date.now(),
    sellSignatures: [],
    realisedLamports: 0,
    partialTaken: false,
    dryRun: true,
    ...overrides,
  };
}

describe('evaluateExit', () => {
  it('holds while price sits inside the bands', () => {
    expect(evaluateExit(position(), 1.2, cfg)).toBeNull();
  });

  it('stops out at the loss threshold', () => {
    expect(evaluateExit(position(), 0.65, cfg)).toEqual({ reason: 'stop_loss', fraction: 1 });
  });

  it('does not stop out just above the threshold', () => {
    expect(evaluateExit(position(), 0.66, cfg)).toBeNull();
  });

  it('scales out half at the take-profit target', () => {
    expect(evaluateExit(position(), 1.8, cfg)).toEqual({ reason: 'partial_take_profit', fraction: 0.5 });
  });

  it('lets the runner ride once the partial is taken', () => {
    expect(evaluateExit(position({ partialTaken: true, peakPrice: 1.8 }), 1.9, cfg)).toBeNull();
  });

  it('takes the full profit when scaling out is disabled', () => {
    expect(evaluateExit(position(), 1.8, { ...cfg, PARTIAL_TP_PCT: 0 })).toEqual({
      reason: 'take_profit',
      fraction: 1,
    });
  });

  it('trails the peak once in profit', () => {
    const p = position({ peakPrice: 2, partialTaken: true });
    expect(evaluateExit(p, 1.4, cfg)).toEqual({ reason: 'trailing_stop', fraction: 1 });
  });

  it('does not arm the trailing stop below the entry price', () => {
    const p = position({ peakPrice: 0.9 });
    expect(evaluateExit(p, 0.8, cfg)).toBeNull();
  });

  it('prefers the stop loss over the trailing stop', () => {
    const p = position({ peakPrice: 2 });
    expect(evaluateExit(p, 0.5, cfg)?.reason).toBe('stop_loss');
  });

  it('exits once the max hold time elapses', () => {
    const p = position({ openedAt: Date.now() - 31 * 60_000 });
    expect(evaluateExit(p, 1.05, cfg)).toEqual({ reason: 'max_hold', fraction: 1 });
  });

  it('ignores a nonsensical price instead of panic-selling', () => {
    expect(evaluateExit(position(), 0, cfg)).toBeNull();
    expect(evaluateExit(position(), Number.NaN, cfg)).toBeNull();
  });
});
