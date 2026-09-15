import { describe, expect, it } from 'vitest';
import { estimateCostUsd, extractJson } from '../src/ai/client.js';

describe('extractJson', () => {
  it('parses a bare object', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('unwraps a markdown fence', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('unwraps an unlabelled fence', () => {
    expect(extractJson('```\n{"a":[1,2]}\n```')).toEqual({ a: [1, 2] });
  });

  it('ignores prose around the object', () => {
    expect(extractJson('Here you go:\n{"title":"x"}\nHope that helps!')).toEqual({ title: 'x' });
  });

  it('keeps nested braces intact', () => {
    expect(extractJson('{"a":{"b":{"c":2}}}')).toEqual({ a: { b: { c: 2 } } });
  });

  it('throws a readable error when there is no object at all', () => {
    expect(() => extractJson('I cannot help with that.')).toThrow(/no JSON object/);
  });

  it('throws on malformed JSON rather than returning junk', () => {
    expect(() => extractJson('{"a":1,}')).toThrow();
  });
});

describe('estimateCostUsd', () => {
  it('prices input and output tokens separately', () => {
    expect(estimateCostUsd({ inputTokens: 1_000_000, outputTokens: 0, calls: 1 })).toBeCloseTo(5, 5);
    expect(estimateCostUsd({ inputTokens: 0, outputTokens: 1_000_000, calls: 1 })).toBeCloseTo(25, 5);
  });

  it('is zero for an unused client', () => {
    expect(estimateCostUsd({ inputTokens: 0, outputTokens: 0, calls: 0 })).toBe(0);
  });
});
