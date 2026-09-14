import { Connection, PublicKey } from '@solana/web3.js';
import { EventEmitter } from 'node:events';
import type { Config } from '../config.js';
import { WSOL_MINT } from '../config.js';
import { getLogger } from '../logger.js';
import { errorMessage, SeenSet } from '../utils/index.js';
import type { TokenCandidate } from '../types.js';

const log = getLogger('discovery');

export const RAYDIUM_AMM_V4 = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');
export const PUMPFUN_PROGRAM = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');

/** Mints that are never the "new token" side of a pool. */
const QUOTE_MINTS = new Set([
  WSOL_MINT,
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
]);

export interface TokenWatcherEvents {
  candidate: [TokenCandidate];
  error: [Error];
}

/**
 * Streams newly-created pools by subscribing to program logs and pulling the
 * mints out of the creating transaction.
 */
export class TokenWatcher extends EventEmitter<TokenWatcherEvents> {
  private readonly seen = new SeenSet(20_000);
  private subscriptions: number[] = [];
  private running = false;

  constructor(
    private readonly cfg: Config,
    private readonly connection: Connection,
  ) {
    super();
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    if (this.cfg.WATCH_RAYDIUM) {
      this.subscriptions.push(this.subscribe(RAYDIUM_AMM_V4, 'raydium', ['initialize2', 'InitializeInstruction2']));
      log.info({ program: RAYDIUM_AMM_V4.toBase58() }, 'watching Raydium AMM v4 for new pools');
    }
    if (this.cfg.WATCH_PUMPFUN) {
      this.subscriptions.push(this.subscribe(PUMPFUN_PROGRAM, 'pumpfun', ['Instruction: Create']));
      log.info({ program: PUMPFUN_PROGRAM.toBase58() }, 'watching pump.fun for new launches');
    }
    if (this.subscriptions.length === 0) {
      log.warn('no watchers enabled — set WATCH_RAYDIUM or WATCH_PUMPFUN to true');
    }
  }

  private subscribe(program: PublicKey, source: 'raydium' | 'pumpfun', markers: string[]): number {
    return this.connection.onLogs(
      program,
      (logs) => {
        if (logs.err) return;
        if (!markers.some((m) => logs.logs.some((line) => line.includes(m)))) return;
        if (!this.seen.add(logs.signature)) return;

        // Resolving mints needs a second RPC round-trip; do it off the hot path
        // so a slow lookup can never stall the log subscription.
        void this.resolveCandidate(logs.signature, source).catch((error) => {
          log.debug({ signature: logs.signature, err: errorMessage(error) }, 'candidate resolution failed');
        });
      },
      'confirmed',
    );
  }

  private async resolveCandidate(signature: string, source: 'raydium' | 'pumpfun'): Promise<void> {
    const tx = await this.connection.getParsedTransaction(signature, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    });
    if (!tx || tx.meta?.err) return;

    const mint = extractNewMint(tx);
    if (!mint) {
      log.debug({ signature }, 'no new mint found in pool-creation transaction');
      return;
    }
    if (!this.seen.add(`mint:${mint}`)) return;

    const blockTimeMs = (tx.blockTime ?? Math.floor(Date.now() / 1000)) * 1000;
    const ageSeconds = (Date.now() - blockTimeMs) / 1000;
    if (ageSeconds > this.cfg.MAX_TOKEN_AGE_SECONDS) {
      log.debug({ mint, ageSeconds }, 'skipping candidate: older than MAX_TOKEN_AGE_SECONDS');
      return;
    }

    const deployer = tx.transaction.message.accountKeys.find((k) => k.signer)?.pubkey.toBase58();

    const candidate: TokenCandidate = {
      mint,
      source,
      signature,
      detectedAt: Date.now(),
      ...(deployer ? { deployer } : {}),
    };

    log.info({ mint, source, ageSeconds: ageSeconds.toFixed(1) }, 'new token detected');
    this.emit('candidate', candidate);
  }

  async stop(): Promise<void> {
    this.running = false;
    await Promise.all(
      this.subscriptions.map((id) =>
        this.connection.removeOnLogsListener(id).catch((error) => {
          log.debug({ err: errorMessage(error) }, 'failed to remove log listener');
        }),
      ),
    );
    this.subscriptions = [];
    this.removeAllListeners();
  }
}

interface ParsedTxLike {
  meta?: {
    postTokenBalances?: { mint?: string }[] | null;
    preTokenBalances?: { mint?: string }[] | null;
    innerInstructions?: { instructions: unknown[] }[] | null;
  } | null;
  transaction: { message: { instructions: unknown[] } };
}

/**
 * Picks the non-quote mint out of a pool-creation transaction.
 *
 * Token balances are the most reliable signal: a new pool always ends up
 * holding both sides, so whichever mint is not SOL/USDC/USDT is the launch.
 * Falls back to scanning `initializeMint` instructions for pump.fun-style
 * transactions where the curve account is funded in a later instruction.
 */
export function extractNewMint(tx: ParsedTxLike): string | null {
  const balanceMints = [...(tx.meta?.postTokenBalances ?? []), ...(tx.meta?.preTokenBalances ?? [])]
    .map((b) => b?.mint)
    .filter((m): m is string => typeof m === 'string');

  const fromBalances = balanceMints.find((m) => !QUOTE_MINTS.has(m));
  if (fromBalances) return fromBalances;

  const allInstructions = [
    ...tx.transaction.message.instructions,
    ...(tx.meta?.innerInstructions ?? []).flatMap((i) => i.instructions),
  ];

  for (const raw of allInstructions) {
    const ix = raw as { parsed?: { type?: string; info?: { mint?: string } } };
    if (ix.parsed?.type === 'initializeMint' || ix.parsed?.type === 'initializeMint2') {
      const mint = ix.parsed.info?.mint;
      if (mint && !QUOTE_MINTS.has(mint)) return mint;
    }
  }

  return null;
}
