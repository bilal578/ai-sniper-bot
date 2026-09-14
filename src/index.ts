#!/usr/bin/env node
import { loadConfig, LAMPORTS_PER_SOL } from './config.js';
import { runDoctor } from './doctor.js';
import { initLogger, getLogger } from './logger.js';
import { SniperBot } from './bot.js';
import { PositionStore } from './store/positions.js';
import { errorMessage, pnlPct, shortAddress } from './utils/index.js';

const HELP = `
ai-sniper-bot — AI-assisted Solana sniper

Usage:
  ai-sniper doctor              Check your setup before running anything
  ai-sniper run                 Watch for new launches and trade them
  ai-sniper buy <mint>          Run one mint through the full pipeline
  ai-sniper positions           Show open and closed positions
  ai-sniper balance             Show wallet address and SOL balance
  ai-sniper config              Print the resolved configuration (secrets redacted)
  ai-sniper help                Show this message

Flags:
  --liquidate-on-exit           Sell every open position on shutdown

While the bot is running a live dashboard is served on http://127.0.0.1:4311
(set DASHBOARD_ENABLED=false to turn it off).

Configuration is read from .env — see .env.example for every option.
`;

async function main(): Promise<void> {
  const [command = 'run', ...rest] = process.argv.slice(2);

  if (command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(HELP);
    return;
  }

  // Runs before loadConfig on purpose: reporting a broken config is its job,
  // so it must not die on the same error it exists to explain.
  if (command === 'doctor') {
    process.exit(await runDoctor());
  }

  const cfg = loadConfig();
  initLogger(cfg.LOG_LEVEL, cfg.LOG_PRETTY);
  const log = getLogger('cli');

  switch (command) {
    case 'run': {
      const liquidateOnExit = rest.includes('--liquidate-on-exit');
      const bot = new SniperBot(cfg);
      await bot.start();

      let stopping = false;
      const shutdown = async (signal: string): Promise<void> => {
        if (stopping) {
          log.warn('second signal received — exiting immediately');
          process.exit(1);
        }
        stopping = true;
        log.info({ signal }, 'signal received');
        await bot.shutdown(liquidateOnExit);
        process.exit(0);
      };

      process.on('SIGINT', () => void shutdown('SIGINT'));
      process.on('SIGTERM', () => void shutdown('SIGTERM'));

      // An unhandled rejection mid-trade must not leave positions unmonitored.
      process.on('unhandledRejection', (reason) => {
        log.error({ err: errorMessage(reason) }, 'unhandled rejection');
      });
      break;
    }

    case 'buy': {
      const mint = rest[0];
      if (!mint) throw new Error('usage: ai-sniper buy <mint>');
      const bot = new SniperBot(cfg);
      await bot.start();
      await bot.snipeManually(mint);
      await bot.shutdown(false);
      process.exit(0);
      break;
    }

    case 'positions': {
      const store = new PositionStore(cfg.DATA_DIR);
      await store.load();
      printPositions(store);
      break;
    }

    case 'balance': {
      const bot = new SniperBot(cfg);
      const sol = await bot.wallet.getBalanceSol(bot.connection);
      process.stdout.write(`wallet:  ${bot.wallet.address}\n`);
      process.stdout.write(`balance: ${sol.toFixed(6)} SOL\n`);
      process.stdout.write(`signing: ${bot.wallet.canSign ? 'enabled' : 'disabled (no key loaded)'}\n`);
      process.stdout.write(`mode:    ${cfg.live ? 'LIVE' : 'DRY RUN'}\n`);
      break;
    }

    case 'config': {
      const { WALLET_PRIVATE_KEY, ANTHROPIC_API_KEY, JUPITER_API_KEY, ...safe } = cfg;
      process.stdout.write(
        `${JSON.stringify(
          {
            ...safe,
            WALLET_PRIVATE_KEY: WALLET_PRIVATE_KEY ? '[set]' : '[unset]',
            ANTHROPIC_API_KEY: ANTHROPIC_API_KEY ? '[set]' : '[unset]',
            JUPITER_API_KEY: JUPITER_API_KEY ? '[set]' : '[unset]',
          },
          null,
          2,
        )}\n`,
      );
      break;
    }

    default:
      process.stderr.write(`Unknown command: ${command}\n${HELP}`);
      process.exit(1);
  }
}

function printPositions(store: PositionStore): void {
  const open = store.open();
  const closed = store.closed();

  process.stdout.write(`\nOPEN (${open.length})\n`);
  if (open.length === 0) {
    process.stdout.write('  none\n');
  } else {
    for (const p of open) {
      const change = pnlPct(p.entryPrice, p.lastPrice);
      process.stdout.write(
        `  ${shortAddress(p.mint, 6)} ${(p.symbol ?? '').padEnd(10)} ` +
          `in=${(p.entryLamports / LAMPORTS_PER_SOL).toFixed(4)} SOL  ` +
          `pnl=${change >= 0 ? '+' : ''}${change.toFixed(1)}%  ` +
          `age=${((Date.now() - p.openedAt) / 60_000).toFixed(1)}m` +
          `${p.dryRun ? '  [dry]' : ''}\n`,
      );
    }
  }

  process.stdout.write(`\nCLOSED (${closed.length})\n`);
  if (closed.length === 0) {
    process.stdout.write('  none\n');
  } else {
    for (const p of closed.slice(-20)) {
      const pnlSol = (p.realisedLamports - p.entryLamports) / LAMPORTS_PER_SOL;
      process.stdout.write(
        `  ${shortAddress(p.mint, 6)} ${(p.symbol ?? '').padEnd(10)} ` +
          `pnl=${pnlSol >= 0 ? '+' : ''}${pnlSol.toFixed(4)} SOL  ` +
          `(${pnlPct(p.entryLamports, p.realisedLamports).toFixed(1)}%)  ` +
          `reason=${p.exitReason ?? '?'}\n`,
      );
    }
    const total = closed.reduce((s, p) => s + (p.realisedLamports - p.entryLamports), 0) / LAMPORTS_PER_SOL;
    const wins = closed.filter((p) => p.realisedLamports > p.entryLamports).length;
    process.stdout.write(
      `\n  total: ${total >= 0 ? '+' : ''}${total.toFixed(4)} SOL over ${closed.length} trades ` +
        `(${((wins / closed.length) * 100).toFixed(0)}% win rate)\n`,
    );
  }
  process.stdout.write('\n');
}

main().catch((error) => {
  process.stderr.write(`\n✖ ${errorMessage(error)}\n\n`);
  process.exit(1);
});
