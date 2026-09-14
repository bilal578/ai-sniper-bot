import { describe, expect, it } from 'vitest';
import { ActivityLog } from '../src/store/activity.js';

const entry = (mint: string) =>
  ({ mint, source: 'raydium', stage: 'safety', outcome: 'rejected', reason: 'r' }) as const;

describe('ActivityLog', () => {
  it('stamps a timestamp when one is not supplied', () => {
    const log = new ActivityLog();
    const before = Date.now();
    const recorded = log.record(entry('a'));
    expect(recorded.at).toBeGreaterThanOrEqual(before);
  });

  it('preserves an explicit timestamp', () => {
    const log = new ActivityLog();
    expect(log.record({ ...entry('a'), at: 1234 }).at).toBe(1234);
  });

  it('returns newest entries first', () => {
    const log = new ActivityLog();
    log.record(entry('first'));
    log.record(entry('second'));
    expect(log.recent().map((e) => e.mint)).toEqual(['second', 'first']);
  });

  it('drops the oldest entries past its bound', () => {
    const log = new ActivityLog(2);
    log.record(entry('a'));
    log.record(entry('b'));
    log.record(entry('c'));
    expect(log.size).toBe(2);
    expect(log.recent().map((e) => e.mint)).toEqual(['c', 'b']);
  });

  it('honours the recent() limit', () => {
    const log = new ActivityLog();
    for (const m of ['a', 'b', 'c']) log.record(entry(m));
    expect(log.recent(2)).toHaveLength(2);
  });

  it('clears', () => {
    const log = new ActivityLog();
    log.record(entry('a'));
    log.clear();
    expect(log.size).toBe(0);
  });
});
