import { Connection } from '@solana/web3.js';
import { randomUUID } from 'node:crypto';
import type { Config } from '../config.js';
import { WSOL_MINT, LAMPORTS_PER_SOL } from '../config.js';
import { getLogger } from '../logger.js';
import { errorMessage, retry } from '../utils/index.js';
import { JupiterClient } from '../solana/jupiter.js';
import { fetchTokenBalanceRaw } from '../solana/tokens.js';
import type { Wallet } from '../wallet.js';
import type { ExitReason, Position, SwapResult, TokenCandidate } from '../types.js';

const log = getLogger('executor');

export class TradeExecutor {
  constructor(
    private readonly cfg: Config,
    private readonly connection: Connection,
    private readonly jupiter: JupiterClient,
    private readonly wallet: Wallet,
  ) {}

  /** Buys `BUY_AMOUNT_SOL` worth of `candidate.mint` and returns the resulting position. */
  async buy(
    candidate: TokenCandidate,
    decimals: number,
    meta: { aiScore?: number; safetyScore?: number },
  ): Promise<Position> {
    const lamports = this.cfg.buyAmountLamports;

    // Re-quote on every attempt: a stale quote on a moving pool fails the
    // slippage check, so retrying the same one just burns fees.
    const result = await retry(
      async () => {
        const quote = await this.jupiter.getQuote({
          inputMint: WSOL_MINT,
          outputMint: candidate.mint,
          amount: lamports,
          slippageBps: this.cfg.BUY_SLIPPAGE_BPS,
        });

        log.info(
          {
            mint: candidate.mint,
            solIn: lamports / LAMPORTS_PER_SOL,
            priceImpactPct: (Number(quote.priceImpactPct ?? 0) * 100).toFixed(2),
          },
          this.cfg.live ? 'executing buy' : 'simulating buy (dry run)',
        );

        return this.swap(quote, 'buy');
      },
      {
        attempts: this.cfg.MAX_BUY_RETRIES + 1,
        baseDelayMs: 400,
        onRetry: (error, attempt) =>
          log.warn({ mint: candidate.mint, attempt, err: errorMessage(error) }, 'buy attempt failed; re-quoting'),
      },
    );

    // Trust the chain over the quote: slippage means we rarely receive exactly
    // what was quoted, and every exit is sized off this number.
    let tokenAmountRaw = result.outAmount;
    if (!result.simulated) {
      try {
        const onChain = await retry(
          () => fetchTokenBalanceRaw(this.connection, this.wallet.publicKey, candidate.mint),
          { attempts: 4, baseDelayMs: 500 },
        );
        if (onChain > 0n) tokenAmountRaw = onChain.toString();
      } catch (error) {
        log.warn({ mint: candidate.mint, err: errorMessage(error) }, 'could not read filled balance; using quoted amount');
      }
    }

    const tokens = Number(tokenAmountRaw) / 10 ** decimals;
    const entryPrice = tokens > 0 ? lamports / LAMPORTS_PER_SOL / tokens : 0;

    const position: Position = {
      id: randomUUID(),
      mint: candidate.mint,
      source: candidate.source,
      status: 'open',
      entryLamports: lamports,
      tokenAmountRaw,
      tokenDecimals: decimals,
      entryPrice,
      peakPrice: entryPrice,
      lastPrice: entryPrice,
      openedAt: Date.now(),
      buySignature: result.signature,
      sellSignatures: [],
      realisedLamports: 0,
      partialTaken: false,
      dryRun: !this.cfg.live,
      ...(candidate.symbol ? { symbol: candidate.symbol } : {}),
      ...(meta.aiScore !== undefined ? { aiScore: meta.aiScore } : {}),
      ...(meta.safetyScore !== undefined ? { safetyScore: meta.safetyScore } : {}),
    };

    log.info(
      { mint: position.mint, tokens: tokens.toFixed(4), entryPrice: entryPrice.toExponential(4), signature: result.signature },
      'position opened',
    );
    return position;
  }

  /**
   * Sells `fraction` (0-1] of a position. Returns lamports received.
   *
   * The exit is retried harder than the entry: failing to buy costs an
   * opportunity, failing to sell costs the position.
   */
  async sell(position: Position, fraction: number, reason: ExitReason): Promise<{ lamports: number; signature: string }> {
    const clamped = Math.max(0, Math.min(1, fraction));
    if (clamped <= 0) throw new Error('sell fraction must be greater than zero');

    let amountRaw = (BigInt(position.tokenAmountRaw) * BigInt(Math.round(clamped * 10_000))) / 10_000n;

    // Never try to sell more than we actually hold — a dust mismatch would
    // make every exit attempt fail.
    if (this.cfg.live) {
      try {
        const onChain = await fetchTokenBalanceRaw(this.connection, this.wallet.publicKey, position.mint);
        if (onChain === 0n) throw new Error('wallet holds none of this mint');
        if (amountRaw > onChain) amountRaw = onChain;
      } catch (error) {
        log.warn({ mint: position.mint, err: errorMessage(error) }, 'balance check before sell failed');
      }
    }

    if (amountRaw <= 0n) throw new Error('computed sell amount is zero');

    const quote = await this.jupiter.getQuote({
      inputMint: position.mint,
      outputMint: WSOL_MINT,
      amount: amountRaw.toString(),
      slippageBps: this.cfg.SELL_SLIPPAGE_BPS,
    });

    log.info(
      { mint: position.mint, reason, fraction: clamped, expectedSol: Number(quote.outAmount) / LAMPORTS_PER_SOL },
      this.cfg.live ? 'executing sell' : 'simulating sell (dry run)',
    );

    // Exits get a fixed, generous retry budget regardless of the buy setting:
    // failing to buy costs an opportunity, failing to sell costs the position.
    const result = await retry(() => this.swap(quote, 'sell'), {
      attempts: 4,
      baseDelayMs: 800,
      onRetry: (error, attempt) =>
        log.warn({ mint: position.mint, attempt, err: errorMessage(error) }, 'sell attempt failed; retrying'),
    });

    return { lamports: Number(result.outAmount), signature: result.signature };
  }

  private async swap(quote: Awaited<ReturnType<JupiterClient['getQuote']>>, side: 'buy' | 'sell'): Promise<SwapResult> {
    if (!this.cfg.live || !this.wallet.keypair) {
      // Dry run: fill at the quoted price. Good enough to exercise every code
      // path downstream without touching the network.
      return {
        signature: `DRYRUN-${side}-${randomUUID().slice(0, 8)}`,
        inAmount: quote.inAmount,
        outAmount: quote.outAmount,
        simulated: true,
      };
    }

    const signature = await this.jupiter.executeSwap(quote, this.wallet.keypair);
    return { signature, inAmount: quote.inAmount, outAmount: quote.outAmount, simulated: false };
  }
}
