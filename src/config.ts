import 'dotenv/config';
import { z } from 'zod';

/**
 * Every tunable lives here. The schema is the single source of truth for what
 * the bot accepts, so a typo in `.env` fails at boot instead of mid-trade.
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

const csv = () =>
  z
    .string()
    .optional()
    .transform((v) =>
      (v ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );

export const WSOL_MINT = 'So11111111111111111111111111111111111111112';
export const LAMPORTS_PER_SOL = 1_000_000_000;

const schema = z.object({
  // ---- Network -------------------------------------------------------------
  RPC_HTTP_URL: z.string().url('RPC_HTTP_URL must be a valid URL'),
  RPC_WS_URL: z.string().url().optional(),
  JUPITER_API_BASE: z.string().url().default('https://lite-api.jup.ag/swap/v1'),
  JUPITER_API_KEY: z.string().optional(),

  // ---- Wallet --------------------------------------------------------------
  // Base58 secret key (Phantom "export private key") or a JSON uint8 array.
  WALLET_PRIVATE_KEY: z.string().optional(),

  // ---- Mode ----------------------------------------------------------------
  // DRY_RUN=true simulates fills without broadcasting. Live trading requires
  // DRY_RUN=false *and* a wallet key — two independent switches on purpose.
  DRY_RUN: bool(true),
  CONFIRM_LIVE: bool(false),

  // ---- Position sizing & risk ---------------------------------------------
  BUY_AMOUNT_SOL: num(0.05, 0.0001, 1000),
  MAX_CONCURRENT_POSITIONS: num(3, 1, 50),
  MAX_DAILY_LOSS_SOL: num(0.5, 0, 100000),
  MAX_TRADES_PER_HOUR: num(10, 1, 1000),
  MIN_WALLET_RESERVE_SOL: num(0.02, 0, 1000),

  // ---- Execution -----------------------------------------------------------
  BUY_SLIPPAGE_BPS: num(1500, 1, 10000),
  SELL_SLIPPAGE_BPS: num(2500, 1, 10000),
  PRIORITY_FEE_MICRO_LAMPORTS: num(500_000, 0, 100_000_000),
  MAX_PRIORITY_FEE_SOL: num(0.005, 0, 1),
  TX_CONFIRM_TIMEOUT_MS: num(60_000, 5_000, 300_000),
  MAX_BUY_RETRIES: num(2, 0, 10),

  // ---- Exit strategy -------------------------------------------------------
  TAKE_PROFIT_PCT: num(80, 1, 100000),
  STOP_LOSS_PCT: num(35, 1, 99),
  TRAILING_STOP_PCT: num(25, 0, 99),
  MAX_HOLD_MINUTES: num(30, 1, 10080),
  PRICE_POLL_INTERVAL_MS: num(5_000, 1_000, 120_000),
  PARTIAL_TP_PCT: num(50, 0, 100),

  // ---- Safety filters ------------------------------------------------------
  MIN_LIQUIDITY_SOL: num(5, 0, 100000),
  MAX_LIQUIDITY_SOL: num(5000, 0, 1_000_000),
  MAX_TOP_HOLDER_PCT: num(25, 1, 100),
  MAX_TOP10_HOLDER_PCT: num(60, 1, 100),
  REQUIRE_MINT_AUTHORITY_REVOKED: bool(true),
  REQUIRE_FREEZE_AUTHORITY_REVOKED: bool(true),
  MAX_BUY_TAX_PCT: num(5, 0, 100),
  BLACKLISTED_MINTS: csv(),
  BLACKLISTED_DEPLOYERS: csv(),

  // ---- AI ------------------------------------------------------------------
  ENABLE_AI_ANALYSIS: bool(true),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default('claude-haiku-4-5-20251001'),
  AI_MIN_SCORE: num(65, 0, 100),
  AI_TIMEOUT_MS: num(8_000, 1_000, 60_000),
  AI_FAIL_OPEN: bool(false),

  // ---- Discovery -----------------------------------------------------------
  WATCH_RAYDIUM: bool(true),
  WATCH_PUMPFUN: bool(true),
  MAX_TOKEN_AGE_SECONDS: num(120, 1, 86400),

  // ---- Ops -----------------------------------------------------------------
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  LOG_PRETTY: bool(true),
  DATA_DIR: z.string().default('./data'),
});

export type Config = z.infer<typeof schema> & {
  live: boolean;
  buyAmountLamports: number;
};

function describeIssues(error: z.ZodError): string {
  return error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid configuration:\n${describeIssues(parsed.error)}\n\nSee .env.example for the full reference.`);
  }
  const cfg = parsed.data;

  // Live trading needs three independent yeses: DRY_RUN off, an explicit
  // CONFIRM_LIVE ack, and a key. Any one missing keeps us in simulation.
  const hasKey = Boolean(cfg.WALLET_PRIVATE_KEY && cfg.WALLET_PRIVATE_KEY.trim());
  const live = !cfg.DRY_RUN && cfg.CONFIRM_LIVE && hasKey;

  if (!cfg.DRY_RUN && !hasKey) {
    throw new Error('DRY_RUN=false but WALLET_PRIVATE_KEY is not set. Refusing to start.');
  }
  if (!cfg.DRY_RUN && !cfg.CONFIRM_LIVE) {
    throw new Error(
      'DRY_RUN=false requires CONFIRM_LIVE=true to acknowledge that real funds will be spent. Refusing to start.',
    );
  }
  if (cfg.ENABLE_AI_ANALYSIS && !cfg.ANTHROPIC_API_KEY) {
    throw new Error('ENABLE_AI_ANALYSIS=true but ANTHROPIC_API_KEY is missing. Set the key or disable AI analysis.');
  }
  if (cfg.STOP_LOSS_PCT >= 100) {
    throw new Error('STOP_LOSS_PCT must be below 100.');
  }
  if (cfg.MIN_LIQUIDITY_SOL > cfg.MAX_LIQUIDITY_SOL) {
    throw new Error('MIN_LIQUIDITY_SOL cannot exceed MAX_LIQUIDITY_SOL.');
  }

  return {
    ...cfg,
    live,
    buyAmountLamports: Math.floor(cfg.BUY_AMOUNT_SOL * LAMPORTS_PER_SOL),
  };
}
