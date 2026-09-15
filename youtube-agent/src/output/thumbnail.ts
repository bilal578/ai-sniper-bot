import type { ThumbnailConcept } from '../types.js';
import { escapeXml } from '../utils/index.js';

const WIDTH = 1280;
const HEIGHT = 720;
const PADDING = 72;
/** Average glyph width of a heavy sans face, as a fraction of font size. */
const GLYPH_RATIO = 0.58;

const RTL_LANGUAGES = new Set(['ur', 'ar', 'fa', 'he', 'ps', 'sd']);

export function isRtl(language: string): boolean {
  return RTL_LANGUAGES.has(language.toLowerCase().split('-')[0] ?? '');
}

/**
 * Draws the concept as an editable 1280x720 SVG. Vector on purpose: it opens in
 * a browser for a quick look and in Figma, Canva or Illustrator when the text
 * needs nudging — which it always does once a real photo goes behind it.
 */
export function renderThumbnailSvg(concept: ThumbnailConcept, language: string): string {
  const rtl = isRtl(language);
  const background = safeColor(concept.palette.background, '#0d1117');
  const accent = safeColor(concept.palette.accent, '#ffcc00');
  const textColor = safeColor(concept.palette.text, '#ffffff');

  const lines = wrapLines(concept.bigText.trim() || 'YOUR TEXT', 3);
  const longest = lines.reduce((max, line) => Math.max(max, line.length), 1);
  const usable = WIDTH - PADDING * 2 - 40;
  const fontSize = Math.max(52, Math.min(148, Math.round(usable / (longest * GLYPH_RATIO))));
  const lineHeight = Math.round(fontSize * 1.14);

  // Vertical centring works off baselines: n lines span (n-1) gaps plus one
  // glyph height, not n gaps. Counting n gaps pushes the sub-line far below the
  // headline and leaves the whole block sitting high on the canvas.
  const subGap = concept.subText ? Math.round(fontSize * 0.72) : 0;
  const blockHeight = (lines.length - 1) * lineHeight + fontSize + subGap;
  const firstBaseline = Math.round((HEIGHT - blockHeight) / 2 + fontSize * 0.82);
  const lastBaseline = firstBaseline + (lines.length - 1) * lineHeight;

  const anchor = rtl ? 'end' : 'start';
  const textX = rtl ? WIDTH - PADDING : PADDING;

  const bigTextNodes = lines
    .map(
      (line, i) =>
        `    <text x="${textX}" y="${firstBaseline + i * lineHeight}" class="big" text-anchor="${anchor}"${
          rtl ? ' direction="rtl"' : ''
        }>${escapeXml(line)}</text>`,
    )
    .join('\n');

  const subTextNode = concept.subText
    ? `    <text x="${textX}" y="${lastBaseline + subGap}" class="sub" text-anchor="${anchor}"${
        rtl ? ' direction="rtl"' : ''
      }>${escapeXml(concept.subText)}</text>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="${escapeXml(concept.bigText)}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${background}"/>
      <stop offset="100%" stop-color="${shade(background, -0.35)}"/>
    </linearGradient>
    <style>
      .big { font-family: 'Inter', 'Helvetica Neue', Arial, sans-serif; font-weight: 800; font-size: ${fontSize}px;
             fill: ${textColor}; paint-order: stroke; stroke: ${shade(background, -0.6)}; stroke-width: ${Math.round(fontSize * 0.09)}px;
             stroke-linejoin: round; letter-spacing: -0.5px; }
      .sub { font-family: 'Inter', 'Helvetica Neue', Arial, sans-serif; font-weight: 700; font-size: ${Math.round(fontSize * 0.42)}px;
             fill: ${accent}; letter-spacing: 1px; }
      .note { font-family: 'Inter', Arial, sans-serif; font-size: 20px; fill: ${textColor}; opacity: 0.45; }
    </style>
  </defs>

  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>

  <!-- Drop the real photo or screenshot in here, behind the text. -->
  <g opacity="0.85">
    <circle cx="${rtl ? 250 : WIDTH - 250}" cy="${HEIGHT / 2}" r="260" fill="${accent}" opacity="0.16"/>
    <rect x="${rtl ? WIDTH - PADDING - 14 : PADDING - 14}" y="${Math.round(HEIGHT * 0.18)}" width="14" height="${Math.round(HEIGHT * 0.64)}" fill="${accent}" rx="7"/>
  </g>

  <g>
${bigTextNodes}
${subTextNode}
  </g>

  <text x="${PADDING}" y="${HEIGHT - 34}" class="note">${escapeXml(concept.emotion)} · ${escapeXml(concept.visual.slice(0, 90))}</text>
  <rect x="4" y="4" width="${WIDTH - 8}" height="${HEIGHT - 8}" fill="none" stroke="${accent}" stroke-width="8" rx="18" opacity="0.35"/>
</svg>
`;
}

/** Balances the words across lines. Two stacked lines read best on a phone. */
export function wrapLines(text: string, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];

  // A word-per-line column looks broken; a single wide line goes unreadable
  // past about three words. Two lines is the sweet spot for thumbnail text.
  const lineCount = Math.min(maxLines, words.length <= 2 ? 1 : words.length <= 5 ? 2 : maxLines);
  const perLine = Math.ceil(words.length / lineCount);

  const lines: string[] = [];
  for (let i = 0; i < words.length; i += perLine) {
    lines.push(words.slice(i, i + perLine).join(' '));
  }
  return lines;
}

function safeColor(value: string, fallback: string): string {
  return /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(value.trim()) ? value.trim() : fallback;
}

/** Darkens (amount < 0) or lightens a hex colour, for the gradient stop. */
export function shade(hex: string, amount: number): string {
  const full = hex.length === 4 ? `#${hex.slice(1).split('').map((c) => c + c).join('')}` : hex;
  const channels = [1, 3, 5].map((i) => parseInt(full.slice(i, i + 2), 16));
  const shifted = channels.map((c) => {
    const next = amount < 0 ? c * (1 + amount) : c + (255 - c) * amount;
    return Math.max(0, Math.min(255, Math.round(next)));
  });
  return `#${shifted.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}
