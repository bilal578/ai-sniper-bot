import { Connection } from '@solana/web3.js';
import type { Config } from '../config.js';
import { getLogger } from '../logger.js';
import { errorMessage } from '../utils/index.js';
import { fetchDexScreener, fetchHolderDistribution, fetchMetadata, fetchMintInfo } from '../solana/tokens.js';
import type { SafetyCheck, SafetyReport, TokenCandidate, TokenMetrics } from '../types.js';

const log = getLogger('safety');

/** Weights used for the advisory 0-100 score. Critical checks gate separately. */
const WEIGHTS: Record<string, number> = {
  mint_authority: 20,
  freeze_authority: 20,
  liquidity: 20,
  top_holder: 15,
  top10_holders: 10,
  transfer_fee: 15,
  blacklist: 5,
};

export class RugChecker {
  constructor(
    private readonly cfg: Config,
    private readonly connection: Connection,
  ) {}

  async check(candidate: TokenCandidate, solPriceUsd: number | null): Promise<SafetyReport> {
    const checks: SafetyCheck[] = [];
    const { mint } = candidate;

    // --- Blacklists: cheapest possible veto, so run them first ---------------
    const blacklistedMint = this.cfg.BLACKLISTED_MINTS.includes(mint);
    const blacklistedDeployer = Boolean(candidate.deployer && this.cfg.BLACKLISTED_DEPLOYERS.includes(candidate.deployer));
    checks.push({
      name: 'blacklist',
      passed: !blacklistedMint && !blacklistedDeployer,
      detail: blacklistedMint
        ? 'mint is blacklisted'
        : blacklistedDeployer
          ? `deployer ${candidate.deployer} is blacklisted`
          : 'not blacklisted',
      critical: true,
    });

    const mintInfo = await fetchMintInfo(this.connection, mint);

    // --- Authorities --------------------------------------------------------
    // A live mint authority means the deployer can print unlimited supply; a
    // live freeze authority means they can freeze your account so you can never
    // sell. Both are classic honeypot setups.
    const mintRevoked = mintInfo.mintAuthority === null;
    checks.push({
      name: 'mint_authority',
      passed: mintRevoked || !this.cfg.REQUIRE_MINT_AUTHORITY_REVOKED,
      detail: mintRevoked ? 'revoked' : `still held by ${mintInfo.mintAuthority}`,
      critical: this.cfg.REQUIRE_MINT_AUTHORITY_REVOKED,
    });

    const freezeRevoked = mintInfo.freezeAuthority === null;
    checks.push({
      name: 'freeze_authority',
      passed: freezeRevoked || !this.cfg.REQUIRE_FREEZE_AUTHORITY_REVOKED,
      detail: freezeRevoked ? 'revoked' : `still held by ${mintInfo.freezeAuthority}`,
      critical: this.cfg.REQUIRE_FREEZE_AUTHORITY_REVOKED,
    });

    // --- Enrichment (best-effort, never fatal) ------------------------------
    const [metadata, holders, market] = await Promise.all([
      fetchMetadata(this.connection, mint),
      fetchHolderDistribution(this.connection, mint, mintInfo.supply),
      fetchDexScreener(mint, solPriceUsd),
    ]);

    // --- Liquidity ----------------------------------------------------------
    // Thin pools cannot be exited; enormous ones on a brand-new token usually
    // mean we are late and are buying somebody else's exit.
    const liquiditySol = market?.liquiditySol ?? null;
    if (liquiditySol === null) {
      checks.push({
        name: 'liquidity',
        passed: false,
        detail: 'liquidity unknown (pool not indexed yet)',
        critical: this.cfg.MIN_LIQUIDITY_SOL > 0,
      });
    } else {
      const ok = liquiditySol >= this.cfg.MIN_LIQUIDITY_SOL && liquiditySol <= this.cfg.MAX_LIQUIDITY_SOL;
      checks.push({
        name: 'liquidity',
        passed: ok,
        detail: `${liquiditySol.toFixed(2)} SOL (window ${this.cfg.MIN_LIQUIDITY_SOL}-${this.cfg.MAX_LIQUIDITY_SOL})`,
        critical: true,
      });
    }

    // --- Holder concentration ----------------------------------------------
    if (holders === null) {
      checks.push({ name: 'top_holder', passed: false, detail: 'holder data unavailable', critical: false });
      checks.push({ name: 'top10_holders', passed: false, detail: 'holder data unavailable', critical: false });
    } else {
      checks.push({
        name: 'top_holder',
        passed: holders.topHolderPct <= this.cfg.MAX_TOP_HOLDER_PCT,
        detail: `top holder ${holders.topHolderPct.toFixed(1)}% (max ${this.cfg.MAX_TOP_HOLDER_PCT}%)`,
        critical: true,
      });
      checks.push({
        name: 'top10_holders',
        passed: holders.top10HolderPct <= this.cfg.MAX_TOP10_HOLDER_PCT,
        detail: `top 10 hold ${holders.top10HolderPct.toFixed(1)}% (max ${this.cfg.MAX_TOP10_HOLDER_PCT}%)`,
        critical: false,
      });
    }

    // --- Transfer fee (Token-2022 "buy tax") --------------------------------
    // A plain SPL mint cannot carry a fee at all, so it passes trivially. A
    // Token-2022 mint can tax every transfer, including the one that moves
    // tokens into your wallet and the one that sells them.
    const feePct = mintInfo.transferFeeBps === null ? 0 : mintInfo.transferFeeBps / 100;
    checks.push({
      name: 'transfer_fee',
      passed: feePct <= this.cfg.MAX_BUY_TAX_PCT,
      detail:
        mintInfo.transferFeeBps === null
          ? 'standard SPL mint, no transfer fee possible'
          : `Token-2022 transfer fee ${feePct.toFixed(2)}% (max ${this.cfg.MAX_BUY_TAX_PCT}%)`,
      critical: true,
    });

    const ageSeconds = (Date.now() - candidate.detectedAt) / 1000;
    const metrics: TokenMetrics = {
      decimals: mintInfo.decimals,
      supply: Number(mintInfo.supply) / 10 ** mintInfo.decimals,
      mintAuthorityRevoked: mintRevoked,
      freezeAuthorityRevoked: freezeRevoked,
      liquiditySol,
      topHolderPct: holders?.topHolderPct ?? null,
      top10HolderPct: holders?.top10HolderPct ?? null,
      transferFeeBps: mintInfo.transferFeeBps,
      holderCount: holders?.sampled ?? null,
      ageSeconds,
      priceUsd: market?.priceUsd ?? null,
      volume5mUsd: market?.volume5mUsd ?? null,
      buys5m: market?.buys5m ?? null,
      sells5m: market?.sells5m ?? null,
      socials: market?.socials ?? [],
    };

    if (metadata) {
      candidate.name = metadata.name;
      candidate.symbol = metadata.symbol;
      candidate.uri = metadata.uri;
    }

    const report = buildReport(mint, checks, metrics);
    log.info(
      { mint, passed: report.passed, score: report.score, failed: report.checks.filter((c) => !c.passed).map((c) => c.name) },
      'safety check complete',
    );
    return report;
  }

  /** Wraps `check` so a transient RPC failure blocks the trade instead of crashing the bot. */
  async checkSafely(candidate: TokenCandidate, solPriceUsd: number | null): Promise<SafetyReport | null> {
    try {
      return await this.check(candidate, solPriceUsd);
    } catch (error) {
      log.warn({ mint: candidate.mint, err: errorMessage(error) }, 'safety check errored — treating as unsafe');
      return null;
    }
  }
}

export function buildReport(mint: string, checks: SafetyCheck[], metrics: TokenMetrics): SafetyReport {
  const totalWeight = checks.reduce((sum, c) => sum + (WEIGHTS[c.name] ?? 5), 0);
  const earned = checks.reduce((sum, c) => sum + (c.passed ? (WEIGHTS[c.name] ?? 5) : 0), 0);

  return {
    mint,
    checks,
    // A single failed critical check vetoes the trade regardless of score.
    passed: checks.every((c) => c.passed || !c.critical),
    score: totalWeight === 0 ? 0 : Math.round((earned / totalWeight) * 100),
    metrics,
  };
}
