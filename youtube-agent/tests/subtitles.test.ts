import { describe, expect, it } from 'vitest';
import { buildCues, buildSrt, chunkNarration } from '../src/output/subtitles.js';
import { timeScenes } from '../src/output/timing.js';
import type { Scene } from '../src/types.js';

const scene = (id: string, narration: string): Scene => ({
  id,
  heading: id,
  narration,
  onScreenText: '',
  visual: '',
  brollQuery: '',
  editorNote: '',
});

describe('chunkNarration', () => {
  it('splits on sentence boundaries', () => {
    expect(chunkNarration('First one. Second one! Third one?')).toEqual(['First one.', 'Second one!', 'Third one?']);
  });

  it('splits an Urdu full stop', () => {
    expect(chunkNarration('پہلا جملہ۔ دوسرا جملہ۔')).toHaveLength(2);
  });

  it('breaks a sentence that is too long for one cue', () => {
    const long = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
    const chunks = chunkNarration(`${long}.`);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.split(' ').length).toBeLessThanOrEqual(14);
  });

  it('never returns an empty chunk list for real text', () => {
    expect(chunkNarration('Hi')).toEqual(['Hi']);
  });
});

describe('buildCues', () => {
  it('keeps cues inside their scene and in order', () => {
    const scenes = timeScenes(
      [scene('hook', 'First sentence here. Second sentence here. Third one too.'), scene('body', 'Another scene.')],
      2.6,
    );
    const cues = buildCues(scenes);

    expect(cues.length).toBeGreaterThan(3);
    for (const [i, cue] of cues.entries()) {
      expect(cue.endSec).toBeGreaterThan(cue.startSec);
      if (i > 0) expect(cue.startSec).toBeGreaterThanOrEqual(cues[i - 1]!.startSec);
    }

    const last = cues[cues.length - 1]!;
    const end = scenes[1]!.startSec + scenes[1]!.durationSec;
    expect(last.endSec).toBeLessThanOrEqual(end + 0.001);
  });

  it('gives a longer sentence more screen time than a short one', () => {
    const scenes = timeScenes([scene('a', 'Short. This sentence is considerably longer than the first one.')], 2.6);
    const [first, second] = buildCues(scenes);
    expect(second!.endSec - second!.startSec).toBeGreaterThan(first!.endSec - first!.startSec);
  });
});

describe('buildSrt', () => {
  it('emits well-formed SRT blocks', () => {
    const scenes = timeScenes([scene('hook', 'One sentence. Two sentences.')], 2.6);
    const srt = buildSrt(scenes);

    expect(srt.startsWith('1\n')).toBe(true);
    expect(srt).toMatch(/\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}/);
    expect(srt.endsWith('\n')).toBe(true);
  });

  it('numbers cues consecutively across scenes', () => {
    const scenes = timeScenes([scene('a', 'One. Two.'), scene('b', 'Three. Four.')], 2.6);
    const indices = buildSrt(scenes)
      .split('\n\n')
      .map((block) => Number(block.split('\n')[0]));
    expect(indices).toEqual([1, 2, 3, 4]);
  });
});
