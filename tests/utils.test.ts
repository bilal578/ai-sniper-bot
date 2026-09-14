import { describe, expect, it, vi } from 'vitest';
import { retry, withTimeout, pnlPct, SeenSet, shortAddress, errorMessage } from '../src/utils/index.js';

describe('retry', () => {
  it('returns the first successful result', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    await expect(retry(fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries until it succeeds', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue('ok');
    await expect(retry(fn, { baseDelayMs: 1 })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('rethrows the last error once attempts are exhausted', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always'));
    await expect(retry(fn, { attempts: 2, baseDelayMs: 1 })).rejects.toThrow('always');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('stops early when shouldRetry says the error is fatal', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fatal'));
    await expect(retry(fn, { attempts: 5, baseDelayMs: 1, shouldRetry: () => false })).rejects.toThrow('fatal');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('withTimeout', () => {
  it('resolves a fast promise', async () => {
    await expect(withTimeout(Promise.resolve(1), 100)).resolves.toBe(1);
  });

  it('rejects a slow promise', async () => {
    const slow = new Promise((r) => setTimeout(r, 500));
    await expect(withTimeout(slow, 20, 'slow op')).rejects.toThrow(/slow op timed out/);
  });
});

describe('pnlPct', () => {
  it('computes gains and losses', () => {
    expect(pnlPct(100, 180)).toBeCloseTo(80);
    expect(pnlPct(100, 65)).toBeCloseTo(-35);
  });

  it('returns zero for an unusable base', () => {
    expect(pnlPct(0, 50)).toBe(0);
    expect(pnlPct(Number.NaN, 50)).toBe(0);
  });
});

describe('SeenSet', () => {
  it('reports a key as new exactly once', () => {
    const set = new SeenSet();
    expect(set.add('a')).toBe(true);
    expect(set.add('a')).toBe(false);
  });

  it('evicts the oldest key past its bound', () => {
    const set = new SeenSet(2);
    set.add('a');
    set.add('b');
    set.add('c');
    expect(set.size).toBe(2);
    expect(set.has('a')).toBe(false);
    expect(set.has('c')).toBe(true);
  });
});

describe('helpers', () => {
  it('shortens long addresses and leaves short ones alone', () => {
    expect(shortAddress('So11111111111111111111111111111111111111112')).toBe('So11...1112');
    expect(shortAddress('abc')).toBe('abc');
  });

  it('extracts a message from any thrown value', () => {
    expect(errorMessage(new Error('x'))).toBe('x');
    expect(errorMessage('plain')).toBe('plain');
    expect(errorMessage({ code: 1 })).toBe('{"code":1}');
  });
});
