export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
  /** Return false to abort early on an error that retrying cannot fix. */
  shouldRetry?: (error: unknown) => boolean;
}

/** Exponential backoff with full jitter. */
export async function retry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const { attempts = 3, baseDelayMs = 300, maxDelayMs = 8_000, onRetry, shouldRetry } = opts;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === attempts || (shouldRetry && !shouldRetry(error))) break;
      const backoff = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      const delay = Math.floor(Math.random() * backoff);
      onRetry?.(error, attempt, delay);
      await sleep(delay);
    }
  }
  throw lastError;
}

/** Rejects if `promise` has not settled within `ms`. */
export async function withTimeout<T>(promise: Promise<T>, ms: number, label = 'operation'): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export const lamportsToSol = (lamports: number | bigint): number => Number(lamports) / 1e9;
export const solToLamports = (sol: number): number => Math.floor(sol * 1e9);

export function pct(value: number, total: number): number {
  if (!total || !Number.isFinite(total)) return 0;
  return (value / total) * 100;
}

export function formatSol(lamports: number): string {
  return `${lamportsToSol(lamports).toFixed(4)} SOL`;
}

/** Percentage change from `from` to `to`; 0 when `from` is not usable. */
export function pnlPct(from: number, to: number): number {
  if (!from || !Number.isFinite(from)) return 0;
  return ((to - from) / from) * 100;
}

export function shortAddress(address: string, chars = 4): string {
  if (address.length <= chars * 2 + 3) return address;
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

/** Simple in-memory de-duplicator with a bounded size. */
export class SeenSet {
  private readonly seen = new Set<string>();
  private readonly order: string[] = [];

  constructor(private readonly maxSize = 10_000) {}

  /** Returns true the first time a key is offered, false afterwards. */
  add(key: string): boolean {
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    this.order.push(key);
    if (this.order.length > this.maxSize) {
      const oldest = this.order.shift();
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    return true;
  }

  has(key: string): boolean {
    return this.seen.has(key);
  }

  get size(): number {
    return this.seen.size;
  }
}
