import { describe, expect, it } from 'vitest';
import { buildReport } from '../src/safety/rugcheck.js';
import type { SafetyCheck, TokenMetrics } from '../src/types.js';

const metrics: TokenMetrics = {
  decimals: 6,
  supply: 1e9,
  mintAuthorityRevoked: true,
  freezeAuthorityRevoked: true,
  liquiditySol: 10,
  topHolderPct: 5,
  top10HolderPct: 20,
  transferFeeBps: null,
  holderCount: 20,
  ageSeconds: 30,
  priceUsd: null,
  volume5mUsd: null,
  buys5m: null,
  sells5m: null,
  socials: [],
};

const check = (name: string, passed: boolean, critical: boolean): SafetyCheck => ({
  name,
  passed,
  critical,
  detail: '',
});

describe('buildReport', () => {
  it('passes when every check passes', () => {
    const report = buildReport('m', [check('mint_authority', true, true), check('liquidity', true, true)], metrics);
    expect(report.passed).toBe(true);
    expect(report.score).toBe(100);
  });

  it('fails outright on a single failed critical check', () => {
    const report = buildReport('m', [check('mint_authority', false, true), check('liquidity', true, true)], metrics);
    expect(report.passed).toBe(false);
  });

  it('still passes when only a non-critical check fails', () => {
    const report = buildReport('m', [check('mint_authority', true, true), check('top10_holders', false, false)], metrics);
    expect(report.passed).toBe(true);
    expect(report.score).toBeLessThan(100);
  });

  it('weights checks rather than counting them', () => {
    // mint_authority is weighted 20, top10_holders 10.
    const a = buildReport('m', [check('mint_authority', false, false), check('top10_holders', true, false)], metrics);
    const b = buildReport('m', [check('mint_authority', true, false), check('top10_holders', false, false)], metrics);
    expect(b.score).toBeGreaterThan(a.score);
  });

  it('vetoes on a failed transfer-fee check', () => {
    const report = buildReport('m', [check('transfer_fee', false, true)], metrics);
    expect(report.passed).toBe(false);
  });

  it('scores zero with no checks instead of dividing by zero', () => {
    const report = buildReport('m', [], metrics);
    expect(report.score).toBe(0);
    expect(report.passed).toBe(true);
  });
});
