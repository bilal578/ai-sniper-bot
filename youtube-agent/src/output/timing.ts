import type { Scene, TimedScene } from '../types.js';
import { countWords } from '../utils/index.js';

/** A scene shorter than this reads as a glitch rather than a beat. */
const MIN_SCENE_SEC = 2;

/**
 * Turns the script's word counts into a timeline. Estimated, not measured — if
 * a real voiceover gets rendered later, the renderer prefers its actual
 * durations over these numbers.
 */
export function timeScenes(scenes: Scene[], wordsPerSecond: number): TimedScene[] {
  let cursor = 0;
  return scenes.map((scene, index) => {
    const wordCount = countWords(scene.narration);
    const durationSec = Math.max(MIN_SCENE_SEC, wordCount / wordsPerSecond);
    const timed: TimedScene = {
      ...scene,
      index,
      wordCount,
      startSec: cursor,
      durationSec,
      assets: [],
    };
    cursor += durationSec;
    return timed;
  });
}

export function totalDuration(scenes: TimedScene[]): number {
  return scenes.reduce((sum, scene) => sum + scene.durationSec, 0);
}
