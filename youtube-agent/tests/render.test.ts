import { describe, expect, it } from 'vitest';
import { buildConcatList, escapeFilterPath } from '../src/media/render.js';

describe('buildConcatList', () => {
  it('repeats the last slide, which the concat demuxer requires', () => {
    const list = buildConcatList(['/a.jpg', '/b.jpg'], [3, 4]);
    expect(list.trim().split('\n')).toEqual([
      "file '/a.jpg'",
      'duration 3.000',
      "file '/b.jpg'",
      'duration 4.000',
      "file '/b.jpg'",
    ]);
  });

  it('escapes a quote in a filename', () => {
    expect(buildConcatList(["/it's.jpg"], [2])).toContain("file '/it'\\''s.jpg'");
  });

  it('falls back to a default duration when one is missing', () => {
    expect(buildConcatList(['/a.jpg', '/b.jpg'], [3])).toContain('duration 5.000');
  });

  it('returns an empty list for no slides', () => {
    expect(buildConcatList([], [])).toBe('\n');
  });
});

describe('escapeFilterPath', () => {
  it('escapes the colon in a Windows path so the filtergraph parses', () => {
    expect(escapeFilterPath('C:\\videos\\subs.srt')).toBe('C\\\\:/videos/subs.srt');
  });

  it('leaves a plain POSIX path alone', () => {
    expect(escapeFilterPath('/home/user/subs.srt')).toBe('/home/user/subs.srt');
  });
});
