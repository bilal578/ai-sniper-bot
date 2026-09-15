import { describe, expect, it } from 'vitest';
import { timeScenes, totalDuration } from '../src/output/timing.js';
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

describe('timeScenes', () => {
  it('derives duration from word count at the configured pace', () => {
    const words = Array.from({ length: 26 }, (_, i) => `w${i}`).join(' ');
    const [timed] = timeScenes([scene('hook', words)], 2.6);
    expect(timed?.wordCount).toBe(26);
    expect(timed?.durationSec).toBeCloseTo(10, 5);
  });

  it('lays scenes end to end with no gaps', () => {
    const scenes = timeScenes(
      [scene('a', 'one two three four five six'), scene('b', 'seven eight nine ten eleven twelve')],
      2,
    );
    expect(scenes[0]?.startSec).toBe(0);
    expect(scenes[1]?.startSec).toBeCloseTo(scenes[0]!.durationSec, 5);
    expect(totalDuration(scenes)).toBeCloseTo(6, 5);
  });

  it('enforces a floor so a one-word scene is not a single frame', () => {
    const [timed] = timeScenes([scene('beat', 'Stop.')], 2.6);
    expect(timed?.durationSec).toBe(2);
  });

  it('keeps the original scene index', () => {
    const scenes = timeScenes([scene('a', 'x'), scene('b', 'y'), scene('c', 'z')], 2.6);
    expect(scenes.map((s) => s.index)).toEqual([0, 1, 2]);
  });
});
