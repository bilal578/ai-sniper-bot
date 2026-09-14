import { Connection } from '@solana/web3.js';
import type { Config } from '../config.js';

/**
 * A single shared connection. `confirmed` is the right trade-off for sniping:
 * `processed` can be rolled back, `finalized` is ~13s too slow to react.
 */
export function createConnection(cfg: Config): Connection {
  return new Connection(cfg.RPC_HTTP_URL, {
    commitment: 'confirmed',
    wsEndpoint: cfg.RPC_WS_URL,
    confirmTransactionInitialTimeout: cfg.TX_CONFIRM_TIMEOUT_MS,
    disableRetryOnRateLimit: false,
  });
}
