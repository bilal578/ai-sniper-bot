import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Config } from '../config.js';
import type { TimedScene } from '../types.js';
import { getLogger } from '../logger.js';
import { errorMessage, sleep } from '../utils/index.js';

const log = getLogger('tts');

export interface VoiceoverResult {
  /** Absolute path to each scene's narration audio, in scene order. */
  files: string[];
  provider: string;
}

/**
 * Renders narration to audio, one file per scene. Per-scene files beat one long
 * MP3 for two reasons: an editor can drop each clip onto its own cut, and the
 * renderer can time each slide to its real audio length instead of an estimate.
 */
export async function synthesizeVoiceover(
  cfg: Config,
  scenes: TimedScene[],
  destDir: string,
): Promise<VoiceoverResult | null> {
  if (cfg.TTS_PROVIDER === 'none') return null;
  if (!cfg.ELEVENLABS_API_KEY) {
    log.warn('TTS requested but ELEVENLABS_API_KEY is unset — skipping voiceover');
    return null;
  }

  await mkdir(destDir, { recursive: true });
  const files: string[] = [];

  for (const scene of scenes) {
    const file = path.join(destDir, `${String(scene.index + 1).padStart(2, '0')}-${scene.id}.mp3`);
    try {
      const audio = await elevenLabsSpeak(cfg, scene.narration);
      await writeFile(file, audio);
      files.push(file);
      log.info({ scene: scene.id, bytes: audio.length }, 'voiceover rendered');
    } catch (error) {
      log.warn({ scene: scene.id, err: errorMessage(error) }, 'voiceover failed for scene');
    }
    // ElevenLabs rate-limits concurrent synthesis on the lower tiers; a short
    // gap is cheaper than handling a 429 storm.
    await sleep(350);
  }

  return files.length > 0 ? { files, provider: cfg.TTS_PROVIDER } : null;
}

async function elevenLabsSpeak(cfg: Config, text: string): Promise<Buffer> {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${cfg.ELEVENLABS_VOICE_ID}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': cfg.ELEVENLABS_API_KEY ?? '',
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: cfg.ELEVENLABS_MODEL_ID,
      voice_settings: { stability: 0.45, similarity_boost: 0.75, style: 0.3, use_speaker_boost: true },
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`ElevenLabs ${response.status}: ${body.slice(0, 300)}`);
  }
  return Buffer.from(await response.arrayBuffer());
}
