import type { TimedScene } from '../types.js';
import { countWords, formatSrtTime } from '../utils/index.js';

/** Two lines of roughly this width is the comfortable reading limit. */
const MAX_CHARS_PER_CUE = 84;
const MAX_WORDS_PER_CUE = 14;

export interface Cue {
  index: number;
  startSec: number;
  endSec: number;
  text: string;
}

/**
 * Splits each scene's narration into readable cues and spreads the scene's
 * duration across them in proportion to their word counts, so a long sentence
 * stays on screen longer than a short one.
 */
export function buildCues(scenes: TimedScene[]): Cue[] {
  const cues: Cue[] = [];

  for (const scene of scenes) {
    const chunks = chunkNarration(scene.narration);
    const totalWords = chunks.reduce((sum, c) => sum + countWords(c), 0) || 1;

    let cursor = scene.startSec;
    for (const chunk of chunks) {
      const share = (countWords(chunk) / totalWords) * scene.durationSec;
      cues.push({
        index: cues.length + 1,
        startSec: cursor,
        endSec: cursor + share,
        text: chunk,
      });
      cursor += share;
    }
  }

  return cues;
}

export function buildSrt(scenes: TimedScene[]): string {
  return `${buildCues(scenes)
    .map((cue) => `${cue.index}\n${formatSrtTime(cue.startSec)} --> ${formatSrtTime(cue.endSec)}\n${wrapCue(cue.text)}`)
    .join('\n\n')}\n`;
}

/**
 * Breaks on sentence boundaries first — a caption that splits mid-clause is
 * harder to read than one that runs slightly long.
 */
export function chunkNarration(narration: string): string[] {
  const sentences = narration
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?…۔])\s+/)
    .filter(Boolean);

  const chunks: string[] = [];
  for (const sentence of sentences) {
    if (sentence.length <= MAX_CHARS_PER_CUE && countWords(sentence) <= MAX_WORDS_PER_CUE) {
      chunks.push(sentence);
      continue;
    }
    // Too long for one cue: fall back to packing words up to the limit.
    let current: string[] = [];
    for (const word of sentence.split(' ')) {
      const candidate = [...current, word];
      if (candidate.join(' ').length > MAX_CHARS_PER_CUE || candidate.length > MAX_WORDS_PER_CUE) {
        if (current.length > 0) chunks.push(current.join(' '));
        current = [word];
      } else {
        current = candidate;
      }
    }
    if (current.length > 0) chunks.push(current.join(' '));
  }

  return chunks.length > 0 ? chunks : [narration.trim()].filter(Boolean);
}

/** Balances a cue onto at most two lines. */
function wrapCue(text: string): string {
  if (text.length <= MAX_CHARS_PER_CUE / 2) return text;

  const words = text.split(' ');
  const half = Math.ceil(text.length / 2);
  let line = '';
  let split = words.length;
  for (const [i, word] of words.entries()) {
    if (line.length + word.length > half) {
      split = i;
      break;
    }
    line = line ? `${line} ${word}` : word;
  }
  if (split <= 0 || split >= words.length) return text;
  return `${words.slice(0, split).join(' ')}\n${words.slice(split).join(' ')}`;
}
