import { Connection, Keypair, VersionedTransaction } from '@solana/web3.js';
import type { Config } from '../config.js';
import { WSOL_MINT, LAMPORTS_PER_SOL } from '../config.js';
import { getLogger } from '../logger.js';
import { errorMessage, retry, withTimeout } from '../utils/index.js';

const log = getLogger('jupiter');

export interface QuoteResponse {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  priceImpactPct: string;
  routePlan: unknown[];
  [key: string]: unknown;
}

export class JupiterError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'JupiterError';
  }
}

export class JupiterClient {
  constructor(
    private readonly cfg: Config,
    private readonly connection: Connection,
  ) {}

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (this.cfg.JUPITER_API_KEY) headers['x-api-key'] = this.cfg.JUPITER_API_KEY;
    return headers;
  }

  /** A 5xx or 429 is worth another shot; a 4xx means the request itself is wrong. */
  private static isRetryable(error: unknown): boolean {
    if (error instanceof JupiterError) return error.retryable;
    return true; // network-level failures
  }

  async getQuote(params: {
    inputMint: string;
    outputMint: string;
    amount: string | number;
    slippageBps: number;
  }): Promise<QuoteResponse> {
    const query = new URLSearchParams({
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      amount: String(params.amount),
      slippageBps: String(params.slippageBps),
      // Single-hop routes land faster and are far less likely to partially fail
      // on a brand-new pool.
      onlyDirectRoutes: 'true',
    });

    return retry(
      async () => {
        const res = await withTimeout(
          fetch(`${this.cfg.JUPITER_API_BASE}/quote?${query}`, { headers: this.headers() }),
          10_000,
          'jupiter quote',
        );
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw new JupiterError(
            `quote failed (${res.status}): ${body.slice(0, 200)}`,
            res.status,
            res.status === 429 || res.status >= 500,
          );
        }
        const quote = (await res.json()) as QuoteResponse;
        if (!quote.outAmount || BigInt(quote.outAmount) <= 0n) {
          throw new JupiterError('quote returned zero output — no route or no liquidity', undefined, false);
        }
        return quote;
      },
      { attempts: 3, baseDelayMs: 250, shouldRetry: JupiterClient.isRetryable },
    );
  }

  /** Builds the swap transaction for an already-obtained quote. */
  private async buildSwapTransaction(quote: QuoteResponse, userPublicKey: string): Promise<VersionedTransaction> {
    const maxLamports = Math.floor(this.cfg.MAX_PRIORITY_FEE_SOL * LAMPORTS_PER_SOL);

    // A non-zero PRIORITY_FEE_MICRO_LAMPORTS pins the compute-unit price to
    // exactly what the operator asked for. Zero (the default) hands the
    // decision to Jupiter's dynamic estimator, capped by MAX_PRIORITY_FEE_SOL.
    const prioritization =
      this.cfg.PRIORITY_FEE_MICRO_LAMPORTS > 0
        ? { computeUnitPriceMicroLamports: Math.floor(this.cfg.PRIORITY_FEE_MICRO_LAMPORTS) }
        : {
            prioritizationFeeLamports: {
              priorityLevelWithMaxLamports: { maxLamports, priorityLevel: 'high', global: false },
            },
          };

    const res = await withTimeout(
      fetch(`${this.cfg.JUPITER_API_BASE}/swap`, {
        method: 'POST',
        headers: { ...this.headers(), 'content-type': 'application/json' },
        body: JSON.stringify({
          quoteResponse: quote,
          userPublicKey,
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
          ...prioritization,
        }),
      }),
      15_000,
      'jupiter swap build',
    );

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new JupiterError(
        `swap build failed (${res.status}): ${body.slice(0, 200)}`,
        res.status,
        res.status === 429 || res.status >= 500,
      );
    }

    const { swapTransaction } = (await res.json()) as { swapTransaction?: string };
    if (!swapTransaction) throw new JupiterError('swap build returned no transaction', undefined, false);

    return VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'));
  }

  /**
   * Signs and broadcasts a swap, then waits for confirmation.
   *
   * `skipPreflight` is deliberate: on a launch the simulation is frequently
   * stale by the time it returns, and preflight would cost us the block.
   * The confirmation check below is what actually proves the fill.
   */
  async executeSwap(quote: QuoteResponse, keypair: Keypair): Promise<string> {
    const tx = await this.buildSwapTransaction(quote, keypair.publicKey.toBase58());
    tx.sign([keypair]);

    const raw = tx.serialize();
    const signature = await this.connection.sendRawTransaction(raw, {
      skipPreflight: true,
      maxRetries: 0, // we drive our own re-broadcast loop below
    });

    log.debug({ signature }, 'swap broadcast, awaiting confirmation');
    await this.confirm(signature, raw);
    return signature;
  }

  /**
   * Confirms a signature, re-broadcasting the same signed bytes while we wait.
   * Re-sending an identical transaction is idempotent — the network dedupes on
   * signature — so this only improves the odds of landing under congestion.
   */
  private async confirm(signature: string, raw: Uint8Array): Promise<void> {
    const deadline = Date.now() + this.cfg.TX_CONFIRM_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const { value } = await this.connection.getSignatureStatuses([signature]);
      const status = value[0];

      if (status?.err) {
        throw new JupiterError(`transaction failed on-chain: ${JSON.stringify(status.err)}`, undefined, false);
      }
      if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') {
        return;
      }

      await this.connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }).catch(() => {
        /* the transaction may already be in flight; keep polling */
      });
      await new Promise((r) => setTimeout(r, 2_000));
    }

    throw new JupiterError(
      `transaction ${signature} not confirmed within ${this.cfg.TX_CONFIRM_TIMEOUT_MS}ms`,
      undefined,
      false,
    );
  }

  /**
   * SOL per whole token, derived from a real sell quote of `amountRaw`.
   *
   * Quoting the actual position size (rather than a nominal 1 token) means the
   * price already includes the slippage we would eat on the way out — which is
   * the only price that matters for a stop-loss decision.
   */
  async getTokenPriceInSol(mint: string, amountRaw: string, decimals: number): Promise<number | null> {
    try {
      const quote = await this.getQuote({
        inputMint: mint,
        outputMint: WSOL_MINT,
        amount: amountRaw,
        slippageBps: this.cfg.SELL_SLIPPAGE_BPS,
      });
      const solOut = Number(quote.outAmount) / LAMPORTS_PER_SOL;
      const tokensIn = Number(amountRaw) / 10 ** decimals;
      if (!tokensIn) return null;
      return solOut / tokensIn;
    } catch (error) {
      log.debug({ mint, err: errorMessage(error) }, 'price quote failed');
      return null;
    }
  }
}
