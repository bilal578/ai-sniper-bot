import pino from 'pino';

export type Logger = pino.Logger;

let root: Logger | null = null;

export function initLogger(level: string, pretty: boolean): Logger {
  root = pino({
    level,
    // Anything that looks like a key gets scrubbed before it can reach a log
    // sink, a crash report, or a screenshot.
    redact: {
      paths: [
        'ANTHROPIC_API_KEY',
        'YOUTUBE_API_KEY',
        'PEXELS_API_KEY',
        'ELEVENLABS_API_KEY',
        '*.ANTHROPIC_API_KEY',
        '*.YOUTUBE_API_KEY',
        '*.PEXELS_API_KEY',
        '*.ELEVENLABS_API_KEY',
        '*.apiKey',
      ],
      censor: '[redacted]',
    },
    ...(pretty
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
          },
        }
      : {}),
  });
  return root;
}

export function getLogger(scope?: string): Logger {
  if (!root) root = pino({ level: process.env.LOG_LEVEL ?? 'info' });
  return scope ? root.child({ scope }) : root;
}
