import 'dotenv/config';
import { z } from 'zod';

/**
 * Every tunable lives here. The schema is the single source of truth for what
 * the agent accepts, so a typo in `.env` fails at startup instead of halfway
 * through a paid generation run.
 */

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const num = (def: number, min?: number, max?: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : Number(v)))
    .pipe(
      z
        .number({ invalid_type_error: 'must be a number' })
        .min(min ?? -Infinity)
        .max(max ?? Infinity),
    );

const str = (def: string) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : v));

const schema = z.object({
  // ---- Claude --------------------------------------------------------------
  // The only hard requirement. Everything else degrades gracefully.
  ANTHROPIC_API_KEY: z.string().min(1, 'ANTHROPIC_API_KEY is required — get one at https://console.anthropic.com'),
  AI_MODEL: str('claude-opus-5'),
  AI_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional().default('high'),
  AI_MAX_TOKENS: num(32_000, 1024, 128_000),
  AI_TIMEOUT_MS: num(600_000, 10_000),

  // Lets Claude search the live web while researching topics. Costs extra per
  // run, so it is opt-in rather than on by default.
  ENABLE_WEB_SEARCH: bool(false),
  WEB_SEARCH_MAX_USES: num(6, 1, 30),

  // ---- Channel voice -------------------------------------------------------
  CHANNEL_NAME: z.string().optional(),
  CHANNEL_NICHE: z.string().optional(),
  CHANNEL_TONE: str('clear, energetic and concrete — no filler, no clickbait that the video does not pay off'),
  CHANNEL_AUDIENCE: str('curious beginners who want a straight answer fast'),
  // BCP-47-ish tag. Anything Claude writes well in works: en, ur, hi, ar, es...
  CONTENT_LANGUAGE: str('en'),

  // ---- Video shape ---------------------------------------------------------
  TARGET_DURATION_SEC: num(480, 30, 3600),
  // Narration pace used to turn a word count into timings. 2.6 w/s ≈ 156 wpm,
  // a normal energetic YouTube delivery.
  WORDS_PER_SECOND: num(2.6, 1, 6),
  TOPIC_COUNT: num(8, 3, 25),

  // ---- Optional integrations ----------------------------------------------
  YOUTUBE_API_KEY: z.string().optional(),
  PEXELS_API_KEY: z.string().optional(),
  TTS_PROVIDER: z.enum(['none', 'elevenlabs']).optional().default('none'),
  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_VOICE_ID: str('21m00Tcm4TlvDq8ikWAM'),
  ELEVENLABS_MODEL_ID: str('eleven_multilingual_v2'),

  // ---- Output --------------------------------------------------------------
  OUTPUT_DIR: str('./out'),
  BROLL_PER_SCENE: num(2, 0, 10),

  // ---- Logging -------------------------------------------------------------
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).optional().default('info'),
  LOG_PRETTY: bool(true),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${lines.join('\n')}\n\nSee .env.example for every option.`);
  }

  const cfg = parsed.data;
  if (cfg.TTS_PROVIDER === 'elevenlabs' && !cfg.ELEVENLABS_API_KEY) {
    throw new Error('TTS_PROVIDER=elevenlabs requires ELEVENLABS_API_KEY.');
  }
  return cfg;
}

/** Config with secrets removed, safe to print or log. */
export function redactConfig(cfg: Config): Record<string, unknown> {
  const mask = (v: string | undefined): string => (v ? `${v.slice(0, 6)}…(${v.length} chars)` : 'unset');
  return {
    ...cfg,
    ANTHROPIC_API_KEY: mask(cfg.ANTHROPIC_API_KEY),
    YOUTUBE_API_KEY: mask(cfg.YOUTUBE_API_KEY),
    PEXELS_API_KEY: mask(cfg.PEXELS_API_KEY),
    ELEVENLABS_API_KEY: mask(cfg.ELEVENLABS_API_KEY),
  };
}
