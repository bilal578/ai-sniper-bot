import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { TimedScene } from '../types.js';
import { getLogger } from '../logger.js';
import { errorMessage } from '../utils/index.js';

const execFileAsync = promisify(execFile);
const log = getLogger('render');

const WIDTH = 1920;
const HEIGHT = 1080;

export interface RenderOptions {
  scenes: TimedScene[];
  projectDir: string;
  /** Per-scene narration audio, in scene order. Optional. */
  audioFiles: string[];
  subtitlePath: string | null;
  outputPath: string;
}

export async function hasFfmpeg(): Promise<boolean> {
  try {
    await execFileAsync('ffmpeg', ['-version'], { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Assembles a rough-cut slideshow: one still per scene, narration underneath,
 * subtitles burned in. This is a preview to check pacing, not a finished edit —
 * the production package is the real deliverable.
 */
export async function renderVideo(opts: RenderOptions): Promise<string> {
  if (!(await hasFfmpeg())) {
    throw new Error(
      'ffmpeg not found. Install it first:\n' +
        '  macOS:   brew install ffmpeg\n' +
        '  Ubuntu:  sudo apt install ffmpeg\n' +
        '  Windows: winget install Gyan.FFmpeg',
    );
  }

  const workDir = path.join(opts.projectDir, '.render');
  await mkdir(workDir, { recursive: true });

  // Real audio length beats the word-count estimate whenever we have it,
  // otherwise the picture drifts out of sync a few scenes in.
  const durations: number[] = [];
  for (const [i, scene] of opts.scenes.entries()) {
    const audio = opts.audioFiles[i];
    const measured = audio ? await audioDuration(audio) : null;
    durations.push(measured ?? scene.durationSec);
  }

  const slides: string[] = [];
  for (const [i, scene] of opts.scenes.entries()) {
    const asset = scene.assets.find((a) => a.file && a.kind === 'photo');
    slides.push(asset?.file ?? (await placeholderSlide(workDir, i)));
  }

  const listPath = path.join(workDir, 'slides.txt');
  await writeFile(listPath, buildConcatList(slides, durations), 'utf8');

  const audioPath = opts.audioFiles.length > 0 ? await concatAudio(workDir, opts.audioFiles) : null;

  const filters = [
    `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease`,
    `pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=0x0d1117`,
    'fps=30',
  ];
  if (opts.subtitlePath) {
    filters.push(
      `subtitles=${escapeFilterPath(opts.subtitlePath)}:force_style='FontSize=22,Outline=2,Shadow=0,MarginV=60'`,
    );
  }
  filters.push('format=yuv420p');

  const args = ['-y', '-f', 'concat', '-safe', '0', '-i', listPath];
  if (audioPath) args.push('-i', audioPath);
  args.push('-vf', filters.join(','), '-c:v', 'libx264', '-preset', 'medium', '-crf', '20');
  if (audioPath) args.push('-c:a', 'aac', '-b:a', '192k', '-shortest');
  args.push(opts.outputPath);

  log.info({ scenes: opts.scenes.length, audio: Boolean(audioPath) }, 'rendering with ffmpeg');
  try {
    await execFileAsync('ffmpeg', args, { timeout: 30 * 60_000, maxBuffer: 32 * 1024 * 1024 });
  } catch (error) {
    throw new Error(`ffmpeg failed: ${errorMessage(error).slice(0, 800)}`);
  }
  return opts.outputPath;
}

/**
 * The concat demuxer ignores the duration of the final entry, so the last slide
 * is listed twice — the documented workaround.
 */
export function buildConcatList(slides: string[], durations: number[]): string {
  const lines: string[] = [];
  for (const [i, slide] of slides.entries()) {
    lines.push(`file '${slide.replace(/'/g, "'\\''")}'`);
    lines.push(`duration ${(durations[i] ?? 5).toFixed(3)}`);
  }
  const last = slides[slides.length - 1];
  if (last) lines.push(`file '${last.replace(/'/g, "'\\''")}'`);
  return `${lines.join('\n')}\n`;
}

async function audioDuration(file: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
      { timeout: 20_000 },
    );
    const seconds = Number(stdout.trim());
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  } catch {
    return null;
  }
}

async function placeholderSlide(workDir: string, index: number): Promise<string> {
  const file = path.join(workDir, `placeholder-${index}.png`);
  await execFileAsync(
    'ffmpeg',
    ['-y', '-f', 'lavfi', '-i', `color=c=0x0d1117:s=${WIDTH}x${HEIGHT}`, '-frames:v', '1', file],
    { timeout: 30_000 },
  );
  return file;
}

async function concatAudio(workDir: string, files: string[]): Promise<string> {
  const listPath = path.join(workDir, 'audio.txt');
  const body = files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n');
  await writeFile(listPath, `${body}\n`, 'utf8');

  const out = path.join(workDir, 'narration.mp3');
  await execFileAsync('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', out], {
    timeout: 10 * 60_000,
  });
  return out;
}

/** ffmpeg's filtergraph parser needs colons and backslashes escaped in paths. */
export function escapeFilterPath(file: string): string {
  return file.replace(/\\/g, '/').replace(/:/g, '\\\\:').replace(/'/g, "\\\\'");
}
