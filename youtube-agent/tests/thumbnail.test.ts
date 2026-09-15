import { describe, expect, it } from 'vitest';
import { isRtl, renderThumbnailSvg, shade, wrapLines } from '../src/output/thumbnail.js';
import type { ThumbnailConcept } from '../src/types.js';

const concept: ThumbnailConcept = {
  bigText: 'STOP DOING THIS',
  subText: 'it costs you views',
  visual: 'Close-up of a confused creator at a desk',
  emotion: 'mild alarm',
  palette: { background: '#0d1117', accent: '#ffcc00', text: '#ffffff' },
};

describe('wrapLines', () => {
  it('keeps two words on one line', () => {
    expect(wrapLines('BIG MISTAKE', 3)).toEqual(['BIG MISTAKE']);
  });

  it('stacks three or four words onto two lines', () => {
    expect(wrapLines('STOP DOING THIS NOW', 3)).toEqual(['STOP DOING', 'THIS NOW']);
  });

  it('never exceeds the line limit', () => {
    expect(wrapLines('one two three four five six seven eight', 3).length).toBeLessThanOrEqual(3);
  });

  it('handles empty text without crashing', () => {
    expect(wrapLines('   ', 3)).toEqual(['']);
  });
});

describe('shade', () => {
  it('darkens a colour', () => {
    expect(shade('#808080', -0.5)).toBe('#404040');
  });

  it('lightens a colour', () => {
    expect(shade('#000000', 0.5)).toBe('#808080');
  });

  it('expands shorthand hex', () => {
    expect(shade('#fff', 0)).toBe('#ffffff');
  });
});

describe('renderThumbnailSvg', () => {
  it('renders at YouTube thumbnail dimensions', () => {
    const svg = renderThumbnailSvg(concept, 'en');
    expect(svg).toContain('width="1280"');
    expect(svg).toContain('height="720"');
    expect(svg).toContain('viewBox="0 0 1280 720"');
  });

  it('uses the concept palette', () => {
    const svg = renderThumbnailSvg(concept, 'en');
    expect(svg).toContain('#0d1117');
    expect(svg).toContain('#ffcc00');
  });

  it('falls back to a safe colour when the model invents one', () => {
    const svg = renderThumbnailSvg({ ...concept, palette: { background: 'dark blue', accent: 'gold', text: 'white' } }, 'en');
    expect(svg).not.toContain('dark blue');
    expect(svg).toContain('#0d1117');
  });

  it('escapes text so a stray angle bracket cannot break the document', () => {
    const svg = renderThumbnailSvg({ ...concept, bigText: '5 < 6 & "more"' }, 'en');
    expect(svg).toContain('&lt;');
    expect(svg).toContain('&amp;');
    expect(svg).not.toMatch(/<text[^>]*>[^<]*<[^/]/);
  });

  it('stacks the text block without gaps or overflow', () => {
    const svg = renderThumbnailSvg(concept, 'en');
    const baselines = [...svg.matchAll(/<text[^>]*y="(\d+)"[^>]*class="(\w+)"/g)].map((m) => ({
      cls: m[2],
      y: Number(m[1]),
    }));

    const big = baselines.filter((b) => b.cls === 'big').map((b) => b.y);
    const sub = baselines.find((b) => b.cls === 'sub');
    const note = baselines.find((b) => b.cls === 'note');

    expect(big).toHaveLength(2);
    // The sub-line sits just under the headline, not stranded halfway down.
    expect(sub!.y - big[big.length - 1]!).toBeLessThan(150);
    expect(sub!.y).toBeGreaterThan(big[big.length - 1]!);
    // And the whole block stays inside the canvas, above the caption line.
    expect(big[0]!).toBeGreaterThan(0);
    expect(note!.y).toBeGreaterThan(sub!.y);
    expect(note!.y).toBeLessThan(720);
  });

  it('centres the block whether or not there is a sub-line', () => {
    const withSub = renderThumbnailSvg(concept, 'en');
    const withoutSub = renderThumbnailSvg({ ...concept, subText: '' }, 'en');
    expect(withoutSub).not.toContain('class="sub"');

    const firstOf = (svg: string): number =>
      Number(/<text[^>]*y="(\d+)"[^>]*class="big"/.exec(svg)?.[1] ?? 0);
    // Dropping the sub-line should push the headline down, not leave it put.
    expect(firstOf(withoutSub)).toBeGreaterThan(firstOf(withSub));
  });

  it('lays Urdu out right to left', () => {
    const svg = renderThumbnailSvg({ ...concept, bigText: 'یہ مت کریں' }, 'ur');
    expect(svg).toContain('direction="rtl"');
    expect(svg).toContain('text-anchor="end"');
  });
});

describe('isRtl', () => {
  it('detects right-to-left languages, including regional tags', () => {
    expect(isRtl('ur')).toBe(true);
    expect(isRtl('ar-EG')).toBe(true);
    expect(isRtl('en')).toBe(false);
    expect(isRtl('hi')).toBe(false);
  });
});
