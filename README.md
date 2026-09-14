# ai-sniper-bot

An AI-assisted sniper bot for Solana. It watches Raydium and pump.fun for new
launches, runs every candidate through deterministic rug checks and an LLM risk
review, and executes risk-managed swaps through Jupiter with an automated exit
ladder.

> ⚠️ **Read [Risk](#risk) before running this with real funds.** Sniping new
> launches is one of the highest-loss-rate activities in crypto. The majority of
> tokens this bot will see are scams, and the filters here reduce that risk —
> they do not remove it. You can lose everything you fund the wallet with.

---

## How it works

```
   Raydium / pump.fun logs
             │
             ▼
   ┌──────────────────┐   new mint, < MAX_TOKEN_AGE_SECONDS old
   │  TokenWatcher    │
   └────────┬─────────┘
            ▼
   ┌──────────────────┐   mint & freeze authority, liquidity window,
   │  RugChecker      │   holder concentration, blacklists
   └────────┬─────────┘   → any failed *critical* check vetoes the trade
            ▼
   ┌──────────────────┐   Claude scores the launch 0-100 on the signals
   │  AiAnalyzer      │   the deterministic checks cannot see
   └────────┬─────────┘   → below AI_MIN_SCORE vetoes the trade
            ▼
   ┌──────────────────┐   position caps, hourly rate, daily loss limit,
   │  RiskManager     │   wallet reserve, per-mint cooldown
   └────────┬─────────┘   → hard limits; the AI cannot override these
            ▼
   ┌──────────────────┐   Jupiter quote → sign → send → confirm
   │  TradeExecutor   │   → re-reads the on-chain fill, not the quote
   └────────┬─────────┘
            ▼
   ┌──────────────────┐   partial TP → trailing stop → stop loss → max hold
   │ PositionManager  │   polled every PRICE_POLL_INTERVAL_MS
   └──────────────────┘
```

Each stage can veto, and nothing downstream runs when it does.

## Dashboard

While the bot is running it serves a live dashboard on
**<http://127.0.0.1:4311>** — open it in any browser.

It shows, refreshing every 3 seconds:

- **Net P&L** split into realised and open, wallet balance, win rate, and how
  much of the daily loss budget is spent.
- **Open positions** with live P&L against the last polled sell quote, peak
  gain, age, and the safety/AI scores they were bought on. Each has a **Sell**
  button for a manual exit at market.
- **Activity feed** — every token the bot judged and *why* it decided that:
  which safety check failed and with what value, what the AI scored it and its
  reasoning, or which risk limit blocked it. This is the part worth watching:
  it tells you whether your filters are too loose or too tight.
- **Closed positions** with realised P&L and exit reason.
- **Pause buys** — stops new entries immediately. Open positions keep being
  monitored and exited normally.

The dashboard binds to loopback only. It displays your wallet and can sell your
positions, so pointing `DASHBOARD_HOST` at anything else requires
`DASHBOARD_TOKEN` to be set — the bot refuses to start otherwise. With a token
set, reach it at `http://host:4311/?token=...`.

Set `DASHBOARD_ENABLED=false` to run headless. A dashboard that fails to start
(port already busy, say) is logged and skipped — it never takes the trading loop
down with it.

## Install

Requires Node.js 20 or newer.

```bash
git clone https://github.com/bilal578/ai-sniper-bot.git
cd ai-sniper-bot
npm install
cp .env.example .env
```

Then edit `.env`. At minimum you need `RPC_HTTP_URL`; for live trading you also
need `WALLET_PRIVATE_KEY`, and for AI analysis an `ANTHROPIC_API_KEY`.

## Usage

```bash
npm run dev -- run          # watch and trade (dry run by default) + dashboard
npm run dev -- buy <mint>   # run one mint through the whole pipeline
npm run dev -- positions    # open and closed positions with P&L
npm run dev -- balance      # wallet address, SOL balance, mode
npm run dev -- config       # resolved config, secrets redacted
```

For production, build once and run the compiled output:

```bash
npm run build
node dist/index.js run
```

Add `--liquidate-on-exit` to sell every open position on `Ctrl-C`. Without it,
open positions are written to `data/positions.json` and resumed on next start.

## Going live

Real funds move only when **all three** of these are true:

```dotenv
DRY_RUN=false
CONFIRM_LIVE=true
WALLET_PRIVATE_KEY=<your base58 key>
```

Setting only one or two is a startup error, not a silent fallback. This is
deliberate — the most common way to lose money with a bot like this is to
believe you are in simulation when you are not.

**Before you flip it:**

1. Run in dry-run for at least a few hours and read `positions` output. If the
   simulated results are bad, the live ones will be worse — simulation does not
   model failed fills, MEV, or the tokens you cannot sell at all.
2. Use a **dedicated burner wallet**. Never point this at a wallet holding
   anything you are not willing to lose entirely.
3. Start at `BUY_AMOUNT_SOL=0.01` and a low `MAX_DAILY_LOSS_SOL`.
4. Use a paid RPC endpoint. On a public RPC you will be rate-limited out of
   every competitive entry and your exits will be late — which is the expensive
   half.

## Configuration

Every option, its default, and what it does is documented inline in
[`.env.example`](.env.example). The settings worth understanding before your
first live run:

| Setting | Default | Why it matters |
|---|---|---|
| `BUY_AMOUNT_SOL` | `0.05` | Fixed size per trade. There is no position scaling. |
| `MAX_DAILY_LOSS_SOL` | `0.5` | Trading halts for the rest of the UTC day when realised losses hit this. Your main circuit breaker. |
| `MIN_WALLET_RESERVE_SOL` | `0.02` | Never spent, so you can always pay fees to exit. |
| `STOP_LOSS_PCT` | `35` | Evaluated before every other exit rule. |
| `TRAILING_STOP_PCT` | `25` | Arms only once the position is in profit. |
| `PARTIAL_TP_PCT` | `50` | Sells half at target, lets the rest ride the trailing stop. `0` exits fully at target. |
| `BUY_SLIPPAGE_BPS` | `1500` | 15%. Tighter than this and fills on new pools simply do not land. |
| `MIN_LIQUIDITY_SOL` | `5` | Below this you cannot exit at any price. |
| `MAX_TOP_HOLDER_PCT` | `25` | One wallet holding more than this is the single strongest rug signal. |
| `MAX_BUY_TAX_PCT` | `5` | Token-2022 transfer fee ceiling. A high fee is a honeypot. |
| `PRIORITY_FEE_MICRO_LAMPORTS` | `0` | `0` lets Jupiter estimate dynamically, capped by `MAX_PRIORITY_FEE_SOL`. |
| `AI_MIN_SCORE` | `65` | Raise to trade less and more selectively. |
| `DASHBOARD_HOST` | `127.0.0.1` | Off-loopback binding requires `DASHBOARD_TOKEN`. |
| `AI_FAIL_OPEN` | `false` | Keep it false. An unreachable model should block trades, not wave them through. |

## Safety model

**Deterministic checks** (`src/safety/rugcheck.ts`) run first because they are
cheap and unambiguous. A failed *critical* check vetoes the trade outright — no
score, no override:

- **Mint authority live** → the deployer can print unlimited supply.
- **Freeze authority live** → the deployer can freeze your account so you can
  never sell. This is the classic honeypot.
- **Liquidity outside the window** → too thin to exit, or so deep on a brand-new
  token that you are buying someone else's exit.
- **Top holder concentration** → one wallet that can dump the whole float.
- **Token-2022 transfer fee above `MAX_BUY_TAX_PCT`** → the mint taxes every
  transfer, including the one that sells your position. The bot reads both the
  active *and* the scheduled fee and uses the higher of the two, because a scam
  can ship at 0% with 100% already queued for the next epoch.
- **Blacklisted mint or deployer** → your own denylist.

LP-burn verification is **not** implemented — it cannot be established from
mint data alone, and a knob that silently never passes is worse than no knob.

Liquidity that cannot be determined is treated as *unknown and failing*, never
as zero — a pool DexScreener has not indexed yet is a pool you cannot price.

**AI review** (`src/ai/analyzer.ts`) runs second, on what the checks cannot see:
brand impersonation, implausible metrics, early sell pressure, whether the
socials look real. It can only ever *reject* a candidate that already passed the
deterministic gate — it cannot approve one that failed.

**Risk limits** (`src/trading/risk.ts`) are the last gate and are absolute:
concurrent positions, trades per hour, daily loss, wallet reserve, and a
per-mint cooldown so a chopping token cannot drain you in fees.

## Development

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm test            # vitest — 93 tests
npm run build       # compile to dist/
```

The exit ladder, risk limits, config validation, verdict parsing, and mint
extraction are all pure functions with no network dependency. The dashboard is
covered by tests that boot a real HTTP server on an ephemeral port and exercise
every route, including that control endpoints reject an unauthenticated caller.
CI runs typecheck, lint, tests and build on every push.

## Risk

This software is provided as-is under the MIT License, with no warranty of any
kind. Specifically:

- **Most new token launches are scams.** The filters here catch common patterns.
  Sophisticated rugs defeat them.
- **A passing safety check is not a safe token.** Liquidity can be pulled one
  block after you buy.
- **Simulation results do not predict live results.** Dry-run mode fills at the
  quoted price. It does not model failed transactions, MEV sandwiching, or
  tokens with no sell route.
- **Your private key is in a `.env` file** on whatever machine runs this. Use a
  burner wallet. `.gitignore` excludes `.env`, but the responsibility is yours.
- **Automated trading may be regulated or restricted** where you live. Complying
  with that is your responsibility.

Do not trade with money you cannot afford to lose entirely.

## License

MIT — see [LICENSE](LICENSE).
