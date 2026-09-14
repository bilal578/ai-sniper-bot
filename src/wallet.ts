import { Keypair, Connection, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import type { Config } from './config.js';
import { LAMPORTS_PER_SOL } from './config.js';

/**
 * Accepts either a base58 secret key (what Phantom/Solflare export) or the
 * JSON byte array produced by `solana-keygen`.
 */
export function loadKeypair(secret: string): Keypair {
  const trimmed = secret.trim();

  if (trimmed.startsWith('[')) {
    let bytes: number[];
    try {
      bytes = JSON.parse(trimmed) as number[];
    } catch {
      throw new Error('WALLET_PRIVATE_KEY looks like JSON but could not be parsed.');
    }
    if (!Array.isArray(bytes) || bytes.length !== 64) {
      throw new Error(`WALLET_PRIVATE_KEY JSON array must hold exactly 64 bytes, got ${bytes.length}.`);
    }
    return Keypair.fromSecretKey(Uint8Array.from(bytes));
  }

  let decoded: Uint8Array;
  try {
    decoded = bs58.decode(trimmed);
  } catch {
    throw new Error('WALLET_PRIVATE_KEY is neither valid base58 nor a JSON byte array.');
  }
  if (decoded.length !== 64) {
    throw new Error(`Decoded WALLET_PRIVATE_KEY must be 64 bytes, got ${decoded.length}.`);
  }
  return Keypair.fromSecretKey(decoded);
}

export class Wallet {
  readonly keypair: Keypair | null;
  readonly publicKey: PublicKey;

  private constructor(keypair: Keypair | null, publicKey: PublicKey) {
    this.keypair = keypair;
    this.publicKey = publicKey;
  }

  static from(cfg: Config): Wallet {
    if (cfg.WALLET_PRIVATE_KEY?.trim()) {
      const kp = loadKeypair(cfg.WALLET_PRIVATE_KEY);
      return new Wallet(kp, kp.publicKey);
    }
    // Dry runs without a key still need an address to quote against, so we use
    // a throwaway keypair that can never sign anything real.
    const placeholder = Keypair.generate();
    return new Wallet(null, placeholder.publicKey);
  }

  get canSign(): boolean {
    return this.keypair !== null;
  }

  get address(): string {
    return this.publicKey.toBase58();
  }

  async getBalanceLamports(connection: Connection): Promise<number> {
    return connection.getBalance(this.publicKey, 'confirmed');
  }

  async getBalanceSol(connection: Connection): Promise<number> {
    return (await this.getBalanceLamports(connection)) / LAMPORTS_PER_SOL;
  }
}
