# Quickstart — macOS

Getting the bot running on your Mac in dry-run mode. Nothing here spends money;
live trading needs three extra switches covered at the end.

## 1. Install Node.js

Open **Terminal** (⌘-Space, type "Terminal").

```bash
node -v
```

If that prints `v20` or higher, skip ahead. Otherwise install it with
[Homebrew](https://brew.sh):

```bash
# Homebrew itself, if you do not have it
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

brew install node
node -v
```

On Apple Silicon, if `brew` is not found after installing, run
`eval "$(/opt/homebrew/bin/brew shellenv)"` and add that line to `~/.zprofile`.

## 2. Get the code

```bash
cd ~/Documents
git clone https://github.com/bilal578/ai-sniper-bot.git
cd ai-sniper-bot
npm install
npm run build
```

## 3. Create your .env

```bash
cp .env.example .env
open -e .env        # opens in TextEdit
```

For a **dry run** you only need one line to work — the RPC endpoint. The file
already contains the public one, which is fine for testing:

```dotenv
RPC_HTTP_URL=https://api.mainnet-beta.solana.com
```

To also exercise the AI gate, add a key from
[console.anthropic.com](https://console.anthropic.com):

```dotenv
ENABLE_AI_ANALYSIS=true
ANTHROPIC_API_KEY=sk-ant-...
```

Or set `ENABLE_AI_ANALYSIS=false` to skip it for now. Leave
`WALLET_PRIVATE_KEY` empty — a dry run does not need one, and an empty key is
one more thing that cannot go wrong.

Save and close TextEdit.

## 4. Check your setup

```bash
npm run doctor
```

This exercises every dependency the bot needs — Node version, config parsing,
RPC reachability *and latency*, the Jupiter API, your Anthropic key, wallet
loading, the data directory, and whether the dashboard port is free. It takes
about ten seconds and tells you exactly what to fix.

```
  ✔  Node.js version    v22.22.2
  ✔  .env file          found and readable
  ✔  Configuration      parsed and valid
  ✔  Trading mode       dry run — no funds will move
  ✔  RPC endpoint       reachable, slot 312847291
  !  RPC latency        480ms — slow enough to lose competitive entries
                        → The public RPC also rate-limits hard. Use Helius,
                          QuickNode or Triton for live trading.
  ✔  Jupiter swap API   quoting (0.1 SOL ≈ $21.44)
  ✔  Anthropic API      key valid, model claude-haiku-4-5-20251001
  !  Wallet key         no key loaded — dry run only
  ✔  Data directory     ./data is writable
  ✔  Dashboard port     http://127.0.0.1:4311 is free
```

Warnings (`!`) are fine for a dry run. Fix anything marked `✖` before going on.

## 5. Run it

```bash
npm start
```

Then open **<http://127.0.0.1:4311>** in your browser.

Leave it running. New Solana launches appear every few minutes; the activity
feed fills up with each one and the reason it was accepted or rejected. Press
**Ctrl-C** in Terminal to stop.

## What to look for in the first hour

The activity feed is the point. You are not watching for profit yet — you are
checking whether your filters are sane:

- **Almost everything rejected on `safety`?** Normal. Most launches genuinely
  are scams. Read the reasons: `freeze_authority still held`, `top holder 71%`,
  `transfer fee 90%` are all working as intended.
- **Nothing ever reaching the AI stage?** Your filters are too tight for current
  conditions. `MIN_LIQUIDITY_SOL` is the usual culprit — try lowering it.
- **Lots of buys immediately going red?** Raise `AI_MIN_SCORE`, raise
  `MIN_LIQUIDITY_SOL`, or tighten `MAX_TOP_HOLDER_PCT`.
- **Liquidity showing `unknown`?** The pool is not indexed yet. That is treated
  as a failure on purpose — a pool you cannot price is a pool you cannot exit.

Change settings in `.env`, then Ctrl-C and `npm start` again.

## Important: a laptop is for testing, not for live trading

The bot manages exits on a timer. If your Mac sleeps, **stop-losses stop being
evaluated** while the token keeps trading. Closing the lid on a live position is
how you turn a 35% loss into a total one.

For dry runs this does not matter. Before going live, move to a VPS — see
[DEPLOYMENT.md](DEPLOYMENT.md).

If you want to leave a dry run going overnight to collect data, stop the Mac
sleeping while plugged in:

```bash
caffeinate -s npm start
```

## When you are ready to go live

Three switches, all required — setting only some is a startup error, not a
silent fallback:

```dotenv
DRY_RUN=false
CONFIRM_LIVE=true
WALLET_PRIVATE_KEY=<base58 key from Phantom → Export Private Key>
```

Before you do:

- Use a **burner wallet**. Fund it with only what you can lose entirely.
- Start at `BUY_AMOUNT_SOL=0.01`.
- Get a paid RPC endpoint. On the public one your entries will be rate-limited
  and your exits will be late — and late exits are the expensive half.
- Run `npm run doctor` again. It reports LIVE mode and checks your balance
  covers a trade plus the reserve.

## Troubleshooting

| Problem | Fix |
|---|---|
| `command not found: node` | Node is not installed or not on PATH — redo step 1. |
| `command not found: npm run doctor` | You are not in the project folder. `cd ~/Documents/ai-sniper-bot` |
| doctor: RPC endpoint fails | Check `RPC_HTTP_URL` in `.env`, and that you are online. |
| doctor: Dashboard port in use | Something else has 4311. Set `DASHBOARD_PORT=4312` in `.env`. |
| Dashboard page will not load | The bot must be running in Terminal. Check for errors there. |
| Nothing appears in the feed | Normal for the first few minutes. Confirm `WATCH_RAYDIUM` and `WATCH_PUMPFUN` are `true`. |
| `EACCES` on npm install | Do **not** use `sudo npm`. Reinstall Node via Homebrew. |
