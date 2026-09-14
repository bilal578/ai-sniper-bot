import pino from 'pino';

export type Logger = pino.Logger;

let root: Logger | null = null;

export function initLogger(level: string, pretty: boolean): Logger {
  root = pino({
    level,
    // Anything that looks like a secret gets scrubbed before it can reach a
    // log sink, a crash report, or a screenshot.
    redact: {
      paths: [
        'WALLET_PRIVATE_KEY',
        'ANTHROPIC_API_KEY',
        'JUPITER_API_KEY',
        '*.WALLET_PRIVATE_KEY',
        '*.ANTHROPIC_API_KEY',
        '*.privateKey',
        '*.secretKey',
        'config.WALLET_PRIVATE_KEY',
        'config.ANTHROPIC_API_KEY',
        'config.JUPITER_API_KEY',
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
