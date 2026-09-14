import { describe, expect, it } from 'vitest';
import { parseVerdict, buildPrompt } from '../src/ai/analyzer.js';
import type { SafetyReport, TokenCandidate } from '../src/types.js';

describe('parseVerdict', () => {
  it('parses a clean JSON response', () => {
    const v = parseVerdict('{"score": 82, "decision": "buy", "reasoning": "looks organic", "risks": ["new"]}');
    expect(v).toMatchObject({ score: 82, decision: 'buy', reasoning: 'looks organic', risks: ['new'], fallback: false });
  });

  it('extracts JSON from a markdown fence', () => {
    const v = parseVerdict('```json\n{"score": 10, "decision": "skip", "reasoning": "rug", "risks": []}\n```');
    expect(v.decision).toBe('skip');
    expect(v.score).toBe(10);
  });

  it('clamps an out-of-range score', () => {
    expect(parseVerdict('{"score": 500, "decision": "buy"}').score).toBe(100);
    expect(parseVerdict('{"score": -20, "decision": "buy"}').score).toBe(0);
  });

  it('treats any non-buy decision as skip', () => {
    expect(parseVerdict('{"score": 90, "decision": "maybe"}').decision).toBe('skip');
  });

  it('scores an unparseable score as zero rather than trusting it', () => {
    expect(parseVerdict('{"score": "high", "decision": "buy"}').score).toBe(0);
  });

  it('drops non-string entries from risks', () => {
    expect(parseVerdict('{"score": 50, "decision": "skip", "risks": ["a", 5, null]}').risks).toEqual(['a']);
  });

  it('throws when there is no JSON at all', () => {
    expect(() => parseVerdict('I cannot help with that.')).toThrow(/no JSON object/);
  });
});

describe('buildPrompt', () => {
  const candidate: TokenCandidate = {
    mint: 'Mint111',
    source: 'pumpfun',
    signature: 'sig',
    detectedAt: Date.now(),
    symbol: 'TEST',
    name: 'Test Token',
  };

  const report: SafetyReport = {
    mint: 'Mint111',
    passed: true,
    score: 90,
    checks: [{ name: 'mint_authority', passed: true, detail: 'revoked', critical: true }],
    metrics: {
      decimals: 6,
      supply: 1e9,
      mintAuthorityRevoked: true,
      freezeAuthorityRevoked: true,
      liquiditySol: 12.5,
      topHolderPct: 8.2,
      top10HolderPct: 31,
      transferFeeBps: null,
      holderCount: 20,
      ageSeconds: 42,
      priceUsd: 0.000012,
      volume5mUsd: 5000,
      buys5m: 40,
      sells5m: 12,
      socials: ['https://x.com/test'],
    },
  };

  it('includes the key decision inputs', () => {
    const prompt = buildPrompt(candidate, report);
    expect(prompt).toContain('Mint111');
    expect(prompt).toContain('TEST');
    expect(prompt).toContain('12.50 SOL');
    expect(prompt).toContain('8.20%');
    expect(prompt).toContain('mint_authority: PASS');
    expect(prompt).toContain('https://x.com/test');
  });

  it('renders unknown metrics as "unknown" rather than zero', () => {
    const blind = { ...report, metrics: { ...report.metrics, liquiditySol: null, topHolderPct: null } };
    const prompt = buildPrompt(candidate, blind);
    expect(prompt).toContain('liquidity: unknown');
    expect(prompt).toContain('top holder: unknown');
    expect(prompt).not.toContain('liquidity: 0.00');
  });
});
