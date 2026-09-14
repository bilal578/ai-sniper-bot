import { describe, expect, it } from 'vitest';
import { extractNewMint } from '../src/discovery/watcher.js';

const WSOL = 'So11111111111111111111111111111111111111112';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const NEW = 'NewMint1111111111111111111111111111111111111';

const tx = (over: Record<string, unknown> = {}) => ({
  meta: { postTokenBalances: [], preTokenBalances: [], innerInstructions: [], ...(over.meta as object) },
  transaction: { message: { instructions: [] } },
  ...over,
});

describe('extractNewMint', () => {
  it('picks the non-quote mint out of a SOL pair', () => {
    const parsed = tx({ meta: { postTokenBalances: [{ mint: WSOL }, { mint: NEW }] } });
    expect(extractNewMint(parsed)).toBe(NEW);
  });

  it('ignores USDC as a quote asset too', () => {
    const parsed = tx({ meta: { postTokenBalances: [{ mint: USDC }, { mint: NEW }] } });
    expect(extractNewMint(parsed)).toBe(NEW);
  });

  it('returns null for a SOL/USDC pair with no new token', () => {
    const parsed = tx({ meta: { postTokenBalances: [{ mint: WSOL }, { mint: USDC }] } });
    expect(extractNewMint(parsed)).toBeNull();
  });

  it('falls back to initializeMint when balances are empty', () => {
    const parsed = tx({
      transaction: {
        message: { instructions: [{ parsed: { type: 'initializeMint2', info: { mint: NEW } } }] },
      },
    });
    expect(extractNewMint(parsed)).toBe(NEW);
  });

  it('finds initializeMint inside inner instructions', () => {
    const parsed = tx({
      meta: {
        innerInstructions: [{ instructions: [{ parsed: { type: 'initializeMint', info: { mint: NEW } } }] }],
      },
    });
    expect(extractNewMint(parsed)).toBe(NEW);
  });

  it('returns null when nothing identifies a mint', () => {
    expect(extractNewMint(tx())).toBeNull();
  });
});
