import { Connection, PublicKey } from '@solana/web3.js';
import { getTransferFeeConfig, unpackMint, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { getLogger } from '../logger.js';
import { errorMessage, retry, withTimeout } from '../utils/index.js';

const log = getLogger('tokens');

const METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

export interface MintInfo {
  decimals: number;
  supply: bigint;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  /** True when the mint is owned by the Token-2022 program. */
  isToken2022: boolean;
  /**
   * Token-2022 transfer fee in basis points, or null for a plain SPL mint.
   * This is the on-chain equivalent of a "buy tax" and is a real honeypot
   * vector: a mint can carry a 100% fee so every transfer you make is
   * confiscated.
   */
  transferFeeBps: number | null;
}

export interface TokenMetadata {
  name: string;
  symbol: string;
  uri: string;
  updateAuthority: string;
}

export interface HolderDistribution {
  topHolderPct: number;
  top10HolderPct: number;
  /** Number of accounts sampled — `getTokenLargestAccounts` caps this at 20. */
  sampled: number;
}

export async function fetchMintInfo(connection: Connection, mint: string): Promise<MintInfo> {
  const pubkey = new PublicKey(mint);
  const account = await retry(() => connection.getAccountInfo(pubkey, 'confirmed'), { attempts: 3 });
  if (!account) throw new Error(`mint account ${mint} does not exist`);

  // Which token program owns the mint decides how its data is laid out — and
  // whether it can carry fee extensions at all.
  const isToken2022 = account.owner.equals(TOKEN_2022_PROGRAM_ID);
  if (!isToken2022 && !account.owner.equals(TOKEN_PROGRAM_ID)) {
    throw new Error(`${mint} is not owned by a token program (owner: ${account.owner.toBase58()})`);
  }

  const info = unpackMint(pubkey, account, account.owner);

  return {
    decimals: info.decimals,
    supply: info.supply,
    mintAuthority: info.mintAuthority?.toBase58() ?? null,
    freezeAuthority: info.freezeAuthority?.toBase58() ?? null,
    isToken2022,
    transferFeeBps: isToken2022 ? readTransferFeeBps(info) : null,
  };
}

/**
 * Worst-case transfer fee for a Token-2022 mint.
 *
 * A mint stores two fee schedules — the one in force now and the one that
 * takes over at a future epoch. We take the higher of the two on purpose: a
 * scam can ship with a 0% fee and a 100% fee already scheduled for the next
 * epoch, so reading only the active fee is exactly the case that gets you
 * rugged.
 */
function readTransferFeeBps(mint: Parameters<typeof getTransferFeeConfig>[0]): number | null {
  const config = getTransferFeeConfig(mint);
  if (!config) return null;
  return Math.max(
    config.olderTransferFee.transferFeeBasisPoints,
    config.newerTransferFee.transferFeeBasisPoints,
  );
}

export function metadataPda(mint: string): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('metadata'), METADATA_PROGRAM_ID.toBuffer(), new PublicKey(mint).toBuffer()],
    METADATA_PROGRAM_ID,
  );
  return pda;
}

/**
 * Minimal Metaplex Token Metadata decoder. We only need the first few fields,
 * so decoding by hand avoids pulling in the full (heavy) Metaplex SDK.
 *
 * Layout: key(1) | updateAuthority(32) | mint(32) | name | symbol | uri
 * where each string is a u32 length prefix followed by fixed-size padded bytes.
 */
export function decodeMetadata(data: Buffer): TokenMetadata | null {
  try {
    let offset = 1; // key
    const updateAuthority = new PublicKey(data.subarray(offset, offset + 32)).toBase58();
    offset += 32;
    offset += 32; // mint

    const readString = (): string => {
      const len = data.readUInt32LE(offset);
      offset += 4;
      if (len > 1000 || offset + len > data.length) throw new Error('metadata string out of bounds');
      const raw = data.subarray(offset, offset + len).toString('utf8');
      offset += len;
      // On-chain strings are zero-padded to a fixed size.
      return raw.replace(/\0+$/, '').trim();
    };

    const name = readString();
    const symbol = readString();
    const uri = readString();
    return { name, symbol, uri, updateAuthority };
  } catch (error) {
    log.debug({ err: errorMessage(error) }, 'failed to decode token metadata');
    return null;
  }
}

export async function fetchMetadata(connection: Connection, mint: string): Promise<TokenMetadata | null> {
  try {
    const account = await connection.getAccountInfo(metadataPda(mint), 'confirmed');
    if (!account) return null;
    return decodeMetadata(account.data);
  } catch (error) {
    log.debug({ mint, err: errorMessage(error) }, 'metadata fetch failed');
    return null;
  }
}

/**
 * Holder concentration from the largest token accounts. This is a *sample*
 * (the RPC returns at most 20 accounts), which is enough to catch the common
 * "one wallet holds 80%" rug pattern.
 */
export async function fetchHolderDistribution(
  connection: Connection,
  mint: string,
  supply: bigint,
  excludeAccounts: string[] = [],
): Promise<HolderDistribution | null> {
  if (supply <= 0n) return null;
  try {
    const res = await retry(() => connection.getTokenLargestAccounts(new PublicKey(mint), 'confirmed'), {
      attempts: 2,
    });
    const excluded = new Set(excludeAccounts);
    const balances = res.value
      .filter((a) => !excluded.has(a.address.toBase58()))
      .map((a) => BigInt(a.amount))
      .filter((a) => a > 0n)
      .sort((a, b) => (a > b ? -1 : a < b ? 1 : 0));

    if (balances.length === 0) return null;

    const supplyNum = Number(supply);
    const top = Number(balances[0] ?? 0n);
    const top10 = balances.slice(0, 10).reduce((sum, b) => sum + Number(b), 0);

    return {
      topHolderPct: (top / supplyNum) * 100,
      top10HolderPct: (top10 / supplyNum) * 100,
      sampled: balances.length,
    };
  } catch (error) {
    log.debug({ mint, err: errorMessage(error) }, 'holder distribution fetch failed');
    return null;
  }
}

/** Raw token base units held by `owner`, summed across all its token accounts. */
export async function fetchTokenBalanceRaw(
  connection: Connection,
  owner: PublicKey,
  mint: string,
): Promise<bigint> {
  const accounts = await connection.getParsedTokenAccountsByOwner(owner, { mint: new PublicKey(mint) });
  return accounts.value.reduce((total, { account }) => {
    const amount = account.data.parsed?.info?.tokenAmount?.amount;
    return total + (amount ? BigInt(amount) : 0n);
  }, 0n);
}

export interface DexScreenerPair {
  liquidityUsd: number | null;
  liquiditySol: number | null;
  priceUsd: number | null;
  volume5mUsd: number | null;
  buys5m: number | null;
  sells5m: number | null;
  socials: string[];
  pairCreatedAt: number | null;
}

/**
 * Market context from DexScreener. Brand-new pools are often not indexed yet,
 * so every caller must treat a null result as "unknown", never as "zero".
 */
export async function fetchDexScreener(
  mint: string,
  solPriceUsd: number | null,
  timeoutMs = 4_000,
): Promise<DexScreenerPair | null> {
  try {
    const res = await withTimeout(
      fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, {
        headers: { accept: 'application/json' },
      }),
      timeoutMs,
      'dexscreener',
    );
    if (!res.ok) return null;

    const body = (await res.json()) as { pairs?: DexScreenerRawPair[] };
    const pairs = body.pairs ?? [];
    if (pairs.length === 0) return null;

    // Deepest pool is the one that actually sets the price.
    const best = pairs.reduce((a, b) => ((b.liquidity?.usd ?? 0) > (a.liquidity?.usd ?? 0) ? b : a));
    const liquidityUsd = best.liquidity?.usd ?? null;

    const socials = [
      ...(best.info?.websites ?? []).map((w) => w.url),
      ...(best.info?.socials ?? []).map((s) => s.url),
    ].filter((u): u is string => typeof u === 'string');

    return {
      liquidityUsd,
      liquiditySol: liquidityUsd !== null && solPriceUsd ? liquidityUsd / solPriceUsd : null,
      priceUsd: best.priceUsd ? Number(best.priceUsd) : null,
      volume5mUsd: best.volume?.m5 ?? null,
      buys5m: best.txns?.m5?.buys ?? null,
      sells5m: best.txns?.m5?.sells ?? null,
      socials,
      pairCreatedAt: best.pairCreatedAt ?? null,
    };
  } catch (error) {
    log.debug({ mint, err: errorMessage(error) }, 'dexscreener lookup failed');
    return null;
  }
}

interface DexScreenerRawPair {
  liquidity?: { usd?: number };
  priceUsd?: string;
  volume?: { m5?: number };
  txns?: { m5?: { buys?: number; sells?: number } };
  pairCreatedAt?: number;
  info?: { websites?: { url?: string }[]; socials?: { url?: string }[] };
}
