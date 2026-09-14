import { createServer } from 'node:http';
import { access, constants, mkdir } from 'node:fs/promises';
import { Connection } from '@solana/web3.js';
import { loadConfig, type Config, WSOL_MINT } from './config.js';
import { Wallet } from './wallet.js';
import { errorMessage, withTimeout } from './utils/index.js';

type Status = 'ok' | 'warn' | 'fail';

interface CheckResult {
  name: string;
  status: Status;
  detail: string;
  /** Shown underneath when the check did not pass, to say what to do next. */
  fix?: string;
}

const SYMBOL: Record<Status, string> = { ok: '✔', warn: '!', fail: '✖' };

const MIN_NODE_MAJOR = 20;
/** Above this, an RPC is too slow to win a competitive entry. */
const SLOW_RPC_MS = 400;

function nodeVersion(): CheckResult {
  const major = Number(process.versions.node.split('.')[0]);
  if (Number.isNaN(major) || major < MIN_NODE_MAJOR) {
    return {
      name: 'Node.js version',
      status: 'fail',
      detail: `v${process.versions.node} — need v${MIN_NODE_MAJOR} or newer`,
      fix: 'brew install node@22',
    };
  }
  return { name: 'Node.js version', status: 'ok', detail: `v${process.versions.node}` };
}

async function envFile(): Promise<CheckResult> {
  try {
    await access('.env', constants.R_OK);
    return { name: '.env file', status: 'ok', detail: 'found and readable' };
  } catch {
    return {
      name: '.env file',
      status: 'fail',
      detail: 'not found in the current directory',
      fix: 'cp .env.example .env    # then edit it',
    };
  }
}

async function rpc(cfg: Config): Promise<CheckResult[]> {
  const connection = new Connection(cfg.RPC_HTTP_URL, 'confirmed');
  const started = Date.now();

  try {
    const slot = await withTimeout(connection.getSlot('confirmed'), 10_000, 'rpc getSlot');
    const latency = Date.now() - started;

    const reachable: CheckResult = {
      name: 'RPC endpoint',
      status: 'ok',
      detail: `reachable, slot ${slot}`,
    };

    const isPublic = cfg.RPC_HTTP_URL.includes('api.mainnet-beta.solana.com');
    const speed: CheckResult =
      latency > SLOW_RPC_MS
        ? {
            name: 'RPC latency',
            status: 'warn',
            detail: `${latency}ms — slow enough to lose competitive entries`,
            fix: isPublic
              ? 'The public RPC also rate-limits hard. Use Helius, QuickNode or Triton for live trading.'
              : 'Consider an endpoint in a region closer to this machine.',
          }
        : { name: 'RPC latency', status: 'ok', detail: `${latency}ms` };

    const tier: CheckResult = isPublic
      ? {
          name: 'RPC tier',
          status: 'warn',
          detail: 'using the public mainnet-beta endpoint',
          fix: 'Fine for dry runs. For live trading it will rate-limit you out of entries and delay exits.',
        }
      : { name: 'RPC tier', status: 'ok', detail: 'custom endpoint configured' };

    return [reachable, speed, tier];
  } catch (error) {
    return [
      {
        name: 'RPC endpoint',
        status: 'fail',
        detail: errorMessage(error),
        fix: 'Check RPC_HTTP_URL in .env, and that this machine has outbound internet.',
      },
    ];
  }
}

async function jupiter(cfg: Config): Promise<CheckResult> {
  const params = new URLSearchParams({
    inputMint: WSOL_MINT,
    outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
    amount: '100000000', // 0.1 SOL
    slippageBps: '100',
  });

  try {
    const res = await withTimeout(
      fetch(`${cfg.JUPITER_API_BASE}/quote?${params}`, { headers: { accept: 'application/json' } }),
      10_000,
      'jupiter quote',
    );
    if (!res.ok) {
      return {
        name: 'Jupiter swap API',
        status: 'fail',
        detail: `HTTP ${res.status}`,
        fix: 'Check JUPITER_API_BASE in .env. The default is https://lite-api.jup.ag/swap/v1',
      };
    }
    const quote = (await res.json()) as { outAmount?: string };
    const usdc = Number(quote.outAmount ?? 0) / 1e6;
    return { name: 'Jupiter swap API', status: 'ok', detail: `quoting (0.1 SOL ≈ $${usdc.toFixed(2)})` };
  } catch (error) {
    return { name: 'Jupiter swap API', status: 'fail', detail: errorMessage(error) };
  }
}

async function anthropic(cfg: Config): Promise<CheckResult> {
  if (!cfg.ENABLE_AI_ANALYSIS) {
    return {
      name: 'Anthropic API',
      status: 'warn',
      detail: 'AI analysis disabled',
      fix: 'Set ENABLE_AI_ANALYSIS=true and ANTHROPIC_API_KEY to enable the AI gate.',
    };
  }

  try {
    // The models endpoint authenticates the key without spending any tokens.
    const res = await withTimeout(
      fetch('https://api.anthropic.com/v1/models?limit=1', {
        headers: {
          'x-api-key': cfg.ANTHROPIC_API_KEY ?? '',
          'anthropic-version': '2023-06-01',
        },
      }),
      10_000,
      'anthropic models',
    );
    if (res.status === 401) {
      return {
        name: 'Anthropic API',
        status: 'fail',
        detail: 'key rejected (401)',
        fix: 'Check ANTHROPIC_API_KEY in .env — get one at https://console.anthropic.com',
      };
    }
    if (!res.ok) {
      return { name: 'Anthropic API', status: 'fail', detail: `HTTP ${res.status}` };
    }
    return { name: 'Anthropic API', status: 'ok', detail: `key valid, model ${cfg.AI_MODEL}` };
  } catch (error) {
    return {
      name: 'Anthropic API',
      status: 'fail',
      detail: errorMessage(error),
      fix: 'Check ANTHROPIC_API_KEY in .env — get one at https://console.anthropic.com',
    };
  }
}

async function wallet(cfg: Config): Promise<CheckResult[]> {
  let w: Wallet;
  try {
    w = Wallet.from(cfg);
  } catch (error) {
    return [
      {
        name: 'Wallet key',
        status: 'fail',
        detail: errorMessage(error),
        fix: 'WALLET_PRIVATE_KEY must be a base58 secret key or a JSON array of 64 bytes.',
      },
    ];
  }

  if (!w.canSign) {
    return [
      {
        name: 'Wallet key',
        status: 'warn',
        detail: 'no key loaded — dry run only',
        fix: 'Set WALLET_PRIVATE_KEY in .env when you are ready to trade live.',
      },
    ];
  }

  const results: CheckResult[] = [
    { name: 'Wallet key', status: 'ok', detail: `loaded ${w.address}` },
  ];

  try {
    const connection = new Connection(cfg.RPC_HTTP_URL, 'confirmed');
    const sol = await withTimeout(w.getBalanceSol(connection), 10_000, 'balance');
    const needed = cfg.BUY_AMOUNT_SOL + cfg.MIN_WALLET_RESERVE_SOL;

    results.push(
      sol < needed
        ? {
            name: 'Wallet balance',
            status: cfg.live ? 'fail' : 'warn',
            detail: `${sol.toFixed(4)} SOL — one trade plus reserve needs ${needed.toFixed(4)} SOL`,
            fix: 'Fund the wallet, or lower BUY_AMOUNT_SOL.',
          }
        : { name: 'Wallet balance', status: 'ok', detail: `${sol.toFixed(4)} SOL` },
    );
  } catch (error) {
    results.push({ name: 'Wallet balance', status: 'warn', detail: `could not read: ${errorMessage(error)}` });
  }

  return results;
}

async function dataDir(cfg: Config): Promise<CheckResult> {
  try {
    await mkdir(cfg.DATA_DIR, { recursive: true });
    await access(cfg.DATA_DIR, constants.W_OK);
    return { name: 'Data directory', status: 'ok', detail: `${cfg.DATA_DIR} is writable` };
  } catch (error) {
    return {
      name: 'Data directory',
      status: 'fail',
      detail: errorMessage(error),
      fix: `The bot stores open positions in ${cfg.DATA_DIR}. It must be writable.`,
    };
  }
}

async function dashboardPort(cfg: Config): Promise<CheckResult> {
  if (!cfg.DASHBOARD_ENABLED) {
    return { name: 'Dashboard port', status: 'warn', detail: 'dashboard disabled' };
  }
  if (cfg.DASHBOARD_PORT === 0) {
    return { name: 'Dashboard port', status: 'ok', detail: 'ephemeral port requested' };
  }

  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', (error: NodeJS.ErrnoException) => {
      resolve({
        name: 'Dashboard port',
        status: error.code === 'EADDRINUSE' ? 'fail' : 'warn',
        detail: error.code === 'EADDRINUSE' ? `port ${cfg.DASHBOARD_PORT} already in use` : errorMessage(error),
        fix: 'Another process has it — stop it, or set DASHBOARD_PORT to something else.',
      });
    });
    probe.listen(cfg.DASHBOARD_PORT, cfg.DASHBOARD_HOST, () => {
      probe.close(() =>
        resolve({
          name: 'Dashboard port',
          status: 'ok',
          detail: `http://${cfg.DASHBOARD_HOST}:${cfg.DASHBOARD_PORT} is free`,
        }),
      );
    });
  });
}

function modeSummary(cfg: Config): CheckResult {
  return cfg.live
    ? {
        name: 'Trading mode',
        status: 'warn',
        detail: 'LIVE — real funds will be spent',
        fix: `Each trade risks ${cfg.BUY_AMOUNT_SOL} SOL. Daily loss limit: ${cfg.MAX_DAILY_LOSS_SOL} SOL.`,
      }
    : { name: 'Trading mode', status: 'ok', detail: 'dry run — no funds will move' };
}

/**
 * Pre-flight diagnostics.
 *
 * Every dependency the bot needs at runtime is exercised here, so a broken
 * setup surfaces in ten seconds instead of halfway through a launch window.
 */
export async function runDoctor(): Promise<number> {
  const out = (line = ''): void => {
    process.stdout.write(`${line}\n`);
  };

  out();
  out('  ai-sniper-bot — preflight check');
  out('  ──────────────────────────────────────────────');

  const results: CheckResult[] = [nodeVersion(), await envFile()];

  let cfg: Config;
  try {
    cfg = loadConfig();
    results.push({ name: 'Configuration', status: 'ok', detail: 'parsed and valid' });
  } catch (error) {
    results.push({
      name: 'Configuration',
      status: 'fail',
      detail: errorMessage(error).split('\n').slice(0, 4).join(' '),
      fix: 'Compare your .env against .env.example.',
    });
    print(results, out);
    out('  Configuration could not be loaded — fix that first, then re-run.');
    out();
    return 1;
  }

  results.push(modeSummary(cfg));
  // Network probes are independent; run them together so the check stays fast.
  const [rpcResults, jupiterResult, anthropicResult, walletResults, dataResult, portResult] = await Promise.all([
    rpc(cfg),
    jupiter(cfg),
    anthropic(cfg),
    wallet(cfg),
    dataDir(cfg),
    dashboardPort(cfg),
  ]);
  results.push(...rpcResults, jupiterResult, anthropicResult, ...walletResults, dataResult, portResult);

  print(results, out);

  const failed = results.filter((r) => r.status === 'fail').length;
  const warned = results.filter((r) => r.status === 'warn').length;

  if (failed > 0) {
    out(`  ${failed} check${failed === 1 ? '' : 's'} failed — the bot will not work correctly yet.`);
    out();
    return 1;
  }

  out(
    warned > 0
      ? `  Ready to run, with ${warned} warning${warned === 1 ? '' : 's'} above.`
      : '  All checks passed.',
  );
  out();
  out(`  Start with:  node dist/index.js run`);
  out();
  return 0;
}

function print(results: CheckResult[], out: (line?: string) => void): void {
  out();
  const width = Math.max(...results.map((r) => r.name.length));
  for (const r of results) {
    out(`  ${SYMBOL[r.status]}  ${r.name.padEnd(width)}   ${r.detail}`);
    if (r.fix && r.status !== 'ok') out(`     ${' '.repeat(width)}   → ${r.fix}`);
  }
  out();
}
