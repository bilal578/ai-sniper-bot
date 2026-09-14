import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const base = { RPC_HTTP_URL: 'https://example.com', ENABLE_AI_ANALYSIS: 'false' };

describe('loadConfig', () => {
  it('rejects a missing RPC url', () => {
    expect(() => loadConfig({ ENABLE_AI_ANALYSIS: 'false' })).toThrow(/RPC_HTTP_URL/);
  });

  it('applies defaults and stays in dry run', () => {
    const cfg = loadConfig(base);
    expect(cfg.DRY_RUN).toBe(true);
    expect(cfg.live).toBe(false);
    expect(cfg.BUY_AMOUNT_SOL).toBe(0.05);
    expect(cfg.buyAmountLamports).toBe(50_000_000);
  });

  it('refuses live mode without a wallet key', () => {
    expect(() => loadConfig({ ...base, DRY_RUN: 'false', CONFIRM_LIVE: 'true' })).toThrow(/WALLET_PRIVATE_KEY/);
  });

  it('refuses live mode without an explicit acknowledgement', () => {
    expect(() => loadConfig({ ...base, DRY_RUN: 'false', WALLET_PRIVATE_KEY: 'abc' })).toThrow(/CONFIRM_LIVE/);
  });

  it('enables live mode only when all three switches are set', () => {
    const cfg = loadConfig({ ...base, DRY_RUN: 'false', CONFIRM_LIVE: 'true', WALLET_PRIVATE_KEY: 'abc' });
    expect(cfg.live).toBe(true);
  });

  it('requires an API key when AI analysis is on', () => {
    expect(() => loadConfig({ RPC_HTTP_URL: 'https://example.com', ENABLE_AI_ANALYSIS: 'true' })).toThrow(
      /ANTHROPIC_API_KEY/,
    );
  });

  it('rejects an inverted liquidity window', () => {
    expect(() => loadConfig({ ...base, MIN_LIQUIDITY_SOL: '100', MAX_LIQUIDITY_SOL: '10' })).toThrow(/MIN_LIQUIDITY_SOL/);
  });

  it('rejects an out-of-range numeric value', () => {
    expect(() => loadConfig({ ...base, BUY_SLIPPAGE_BPS: '99999' })).toThrow(/BUY_SLIPPAGE_BPS/);
  });

  it('defaults the transfer-fee tolerance to 5 percent', () => {
    expect(loadConfig(base).MAX_BUY_TAX_PCT).toBe(5);
  });

  it('parses comma-separated blacklists', () => {
    const cfg = loadConfig({ ...base, BLACKLISTED_MINTS: 'aaa, bbb ,, ccc' });
    expect(cfg.BLACKLISTED_MINTS).toEqual(['aaa', 'bbb', 'ccc']);
  });
});
