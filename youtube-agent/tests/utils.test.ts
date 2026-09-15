import { describe, expect, it } from 'vitest';
import { countWords, escapeXml, formatSrtTime, formatTimecode, slugify } from '../src/utils/index.js';

describe('slugify', () => {
  it('makes a filesystem-safe name', () => {
    expect(slugify('Why Your Sourdough Is Gummy Inside!')).toBe('why-your-sourdough-is-gummy-inside');
  });

  it('strips accents rather than dropping the word', () => {
    expect(slugify('Café Crème')).toBe('cafe-creme');
  });

  it('falls back to a stable hash for non-Latin titles', () => {
    const urdu = 'یوٹیوب ویڈیو کیسے بنائیں';
    const slug = slugify(urdu);
    expect(slug).toMatch(/^video-[a-z0-9]+$/);
    expect(slugify(urdu)).toBe(slug);
  });

  it('does not leave a trailing separator when truncating', () => {
    expect(slugify('a'.repeat(40) + ' ' + 'b'.repeat(40), 41)).not.toMatch(/-$/);
  });
});

describe('countWords', () => {
  it('ignores surrounding and repeated whitespace', () => {
    expect(countWords('  two   words  ')).toBe(2);
    expect(countWords('   ')).toBe(0);
  });
});

describe('timecodes', () => {
  it('formats chapter timestamps', () => {
    expect(formatTimecode(0)).toBe('0:00');
    expect(formatTimecode(65.9)).toBe('1:05');
    expect(formatTimecode(600)).toBe('10:00');
  });

  it('formats SRT timestamps with milliseconds', () => {
    expect(formatSrtTime(0)).toBe('00:00:00,000');
    expect(formatSrtTime(3661.25)).toBe('01:01:01,250');
  });

  it('never emits a negative timestamp', () => {
    expect(formatSrtTime(-5)).toBe('00:00:00,000');
  });
});

describe('escapeXml', () => {
  it('escapes every character that would break an SVG', () => {
    expect(escapeXml(`<a href="x">5 & 6 'ok'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;5 &amp; 6 &apos;ok&apos;&lt;/a&gt;',
    );
  });
});
