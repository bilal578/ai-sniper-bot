import { describe, expect, it } from 'vitest';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { loadKeypair } from '../src/wallet.js';

describe('loadKeypair', () => {
  const kp = Keypair.generate();

  it('loads a base58 secret key', () => {
    const loaded = loadKeypair(bs58.encode(kp.secretKey));
    expect(loaded.publicKey.toBase58()).toBe(kp.publicKey.toBase58());
  });

  it('loads a JSON byte array', () => {
    const loaded = loadKeypair(JSON.stringify([...kp.secretKey]));
    expect(loaded.publicKey.toBase58()).toBe(kp.publicKey.toBase58());
  });

  it('tolerates surrounding whitespace', () => {
    const loaded = loadKeypair(`  ${bs58.encode(kp.secretKey)}\n`);
    expect(loaded.publicKey.toBase58()).toBe(kp.publicKey.toBase58());
  });

  it('rejects a JSON array of the wrong length', () => {
    expect(() => loadKeypair('[1,2,3]')).toThrow(/64 bytes/);
  });

  it('rejects malformed JSON', () => {
    expect(() => loadKeypair('[not json')).toThrow(/could not be parsed/);
  });

  it('rejects a non-base58 string', () => {
    expect(() => loadKeypair('!!!not-base58!!!')).toThrow(/base58/);
  });

  it('rejects a base58 string of the wrong length', () => {
    expect(() => loadKeypair(bs58.encode(Uint8Array.from([1, 2, 3])))).toThrow(/64 bytes/);
  });
});
