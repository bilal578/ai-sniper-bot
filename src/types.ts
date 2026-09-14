/** Where a candidate token was first seen. */
export type TokenSource = 'raydium' | 'pumpfun' | 'manual';

/** A freshly-detected token, before any safety or AI work has been done. */
export interface TokenCandidate {
  mint: string;
  source: TokenSource;
  /** Pool/bonding-curve address, when the watcher could resolve one. */
  poolAddress?: string;
  /** Signature of the transaction that created the pool. */
  signature: string;
  /** Epoch millis when the bot observed the launch. */
  detectedAt: number;
  deployer?: string;
  name?: string;
  symbol?: string;
  uri?: string;
}

/** One pass/fail rule evaluated against a candidate. */
export interface SafetyCheck {
  name: string;
  passed: boolean;
  detail: string;
  /** A failed critical check vetoes the trade outright. */
  critical: boolean;
}

export interface SafetyReport {
  mint: string;
  passed: boolean;
  checks: SafetyCheck[];
  /** 0-100, share of weighted checks passed. */
  score: number;
  metrics: TokenMetrics;
}

export interface TokenMetrics {
  decimals: number;
  supply: number;
  mintAuthorityRevoked: boolean;
  freezeAuthorityRevoked: boolean;
  liquiditySol: number | null;
  topHolderPct: number | null;
  top10HolderPct: number | null;
  /** Token-2022 transfer fee in basis points; null for a plain SPL mint. */
  transferFeeBps: number | null;
  holderCount: number | null;
  ageSeconds: number;
  priceUsd: number | null;
  volume5mUsd: number | null;
  buys5m: number | null;
  sells5m: number | null;
  socials: string[];
}

export interface AiVerdict {
  /** 0-100 conviction. Higher means more likely to be a real launch. */
  score: number;
  decision: 'buy' | 'skip';
  reasoning: string;
  risks: string[];
  /** True when analysis failed and the configured fail-open/closed default was used. */
  fallback: boolean;
}

export type PositionStatus = 'open' | 'closing' | 'closed' | 'failed';

export type ExitReason =
  | 'take_profit'
  | 'partial_take_profit'
  | 'stop_loss'
  | 'trailing_stop'
  | 'max_hold'
  | 'manual'
  | 'shutdown';

export interface Position {
  id: string;
  mint: string;
  symbol?: string;
  source: TokenSource;
  status: PositionStatus;
  /** Lamports of SOL actually spent on entry. */
  entryLamports: number;
  /** Raw token base units received. */
  tokenAmountRaw: string;
  tokenDecimals: number;
  /** SOL per whole token at entry. */
  entryPrice: number;
  peakPrice: number;
  lastPrice: number;
  openedAt: number;
  closedAt?: number;
  buySignature?: string;
  sellSignatures: string[];
  /** Lamports realised so far from (partial) exits. */
  realisedLamports: number;
  partialTaken: boolean;
  exitReason?: ExitReason;
  aiScore?: number;
  safetyScore?: number;
  dryRun: boolean;
  error?: string;
}

export interface SwapResult {
  signature: string;
  inAmount: string;
  outAmount: string;
  /** Set when the swap was simulated rather than broadcast. */
  simulated: boolean;
}
