import { access, mkdir } from 'node:fs/promises';
import Anthropic from '@anthropic-ai/sdk';
import { loadConfig } from './config.js';
import { hasFfmpeg } from './media/render.js';
import { errorMessage } from './utils/index.js';

type Status = 'ok' | 'warn' | 'fail';

interface Check {
  status: Status;
  label: string;
  detail: string;
}

const ICON: Record<Status, string> = { ok: '✓', warn: '!', fail: '✗' };

/**
 * Runs before anything spends money, so it must not throw on the same broken
 * config it exists to explain. Returns a process exit code.
 */
export async function runDoctor(): Promise<number> {
  const checks: Check[] = [];

  const major = Number(process.versions.node.split('.')[0]);
  checks.push({
    status: major >= 20 ? 'ok' : 'fail',
    label: 'Node.js',
    detail: major >= 20 ? `v${process.versions.node}` : `v${process.versions.node} — needs v20 or newer`,
  });

  let cfg: ReturnType<typeof loadConfig> | null = null;
  try {
    cfg = loadConfig();
    checks.push({ status: 'ok', label: 'Configuration', detail: '.env parsed' });
  } catch (error) {
    checks.push({ status: 'fail', label: 'Configuration', detail: errorMessage(error) });
  }

  if (cfg) {
    checks.push(await checkClaude(cfg.ANTHROPIC_API_KEY, cfg.AI_MODEL));

    checks.push({
      status: cfg.YOUTUBE_API_KEY ? 'ok' : 'warn',
      label: 'YouTube Data API',
      detail: cfg.YOUTUBE_API_KEY
        ? 'key set — topic research will use live competition data'
        : 'no key — topics are judged from the model\'s own knowledge (optional)',
    });

    checks.push({
      status: cfg.PEXELS_API_KEY ? 'ok' : 'warn',
      label: 'Pexels stock assets',
      detail: cfg.PEXELS_API_KEY
        ? 'key set — b-roll will be downloaded per scene'
        : 'no key — b-roll search phrases are written to shotlist.md instead (optional)',
    });

    checks.push({
      status: cfg.TTS_PROVIDER === 'none' ? 'warn' : cfg.ELEVENLABS_API_KEY ? 'ok' : 'fail',
      label: 'Voiceover',
      detail:
        cfg.TTS_PROVIDER === 'none'
          ? 'TTS_PROVIDER=none — you record the narration yourself (optional)'
          : cfg.ELEVENLABS_API_KEY
            ? `ElevenLabs, voice ${cfg.ELEVENLABS_VOICE_ID}`
            : 'TTS_PROVIDER=elevenlabs but ELEVENLABS_API_KEY is unset',
    });

    checks.push({
      status: (await hasFfmpeg()) ? 'ok' : 'warn',
      label: 'ffmpeg',
      detail: (await hasFfmpeg())
        ? 'found — `ai-tuber render` can assemble a rough cut'
        : 'not found — the production package still works, only `render` needs it (brew install ffmpeg)',
    });

    checks.push(await checkOutputDir(cfg.OUTPUT_DIR));
  }

  const width = Math.max(...checks.map((c) => c.label.length));
  const lines = checks.map((c) => `  ${ICON[c.status]} ${c.label.padEnd(width)}  ${c.detail}`);
  const failed = checks.filter((c) => c.status === 'fail').length;

  process.stdout.write(
    `\nai-tuber preflight\n\n${lines.join('\n')}\n\n${
      failed === 0 ? 'Ready. Try: ai-tuber make "your niche"\n\n' : `${failed} blocking problem(s) — fix them before running.\n\n`
    }`,
  );
  return failed === 0 ? 0 : 1;
}

async function checkClaude(apiKey: string, model: string): Promise<Check> {
  try {
    // Cheapest possible proof that the key works and the model is reachable:
    // a metadata lookup, which costs no tokens.
    const info = await new Anthropic({ apiKey, maxRetries: 0 }).models.retrieve(model);
    return { status: 'ok', label: 'Claude API', detail: `${info.id} reachable` };
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return { status: 'fail', label: 'Claude API', detail: 'ANTHROPIC_API_KEY rejected' };
    }
    if (error instanceof Anthropic.NotFoundError) {
      return { status: 'fail', label: 'Claude API', detail: `model "${model}" not available to this key` };
    }
    return { status: 'warn', label: 'Claude API', detail: `could not verify: ${errorMessage(error)}` };
  }
}

async function checkOutputDir(dir: string): Promise<Check> {
  try {
    await mkdir(dir, { recursive: true });
    await access(dir);
    return { status: 'ok', label: 'Output folder', detail: dir };
  } catch (error) {
    return { status: 'fail', label: 'Output folder', detail: `${dir} is not writable: ${errorMessage(error)}` };
  }
}
