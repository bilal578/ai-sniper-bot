# Where this runs

This is a **Node.js process**. It runs on a computer you control — your own
machine, or a server you rent. There is no hosted version, nothing runs in a
browser, and nothing runs "on the blockchain".

Two things matter when choosing where to put it:

- **It must stay running.** The bot reacts to launches as they happen and
  manages exits on a timer. A machine that sleeps, reboots, or loses network
  will miss entries and — much worse — miss stop-losses on positions it is
  already holding.
- **Latency decides your fill.** You are competing with other bots for the same
  block. Round-trip time to your RPC provider is most of your reaction time.

---

## Option A — your own PC or laptop

Fine for **dry-run testing**. Not fine for live trading.

```bash
git clone https://github.com/bilal578/ai-sniper-bot.git
cd ai-sniper-bot
npm install
cp .env.example .env     # then edit it
npm run build
node dist/index.js run
```

Open <http://127.0.0.1:4311> for the dashboard.

The problem with a laptop is not speed, it is availability: close the lid and
the bot stops mid-position. The stop-loss stops being evaluated while the token
keeps trading. Use this to watch the bot think, then move it somewhere that
stays up.

## Option B — a VPS (recommended for live trading)

A small Linux VPS is enough — **2 vCPU / 2 GB RAM** is plenty; this is a
network-bound workload, not a compute-bound one. Hetzner, DigitalOcean, Vultr,
Contabo and OVH all work.

**Put the VPS near your RPC provider, not near yourself.** Your own location is
irrelevant — you are not in the loop. Ask your RPC provider (Helius, QuickNode,
Triton) which region their endpoint serves, and pick the matching datacentre.
For most Solana infrastructure that means **Frankfurt / Amsterdam** or
**Ashburn / New York**. Getting this wrong costs you 100-200ms on every quote
and every exit.

### Setup

```bash
# --- on the VPS, as root ---
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs git

# A dedicated unprivileged user — this process holds a funded key.
adduser --system --group --home /opt/ai-sniper-bot sniper

git clone https://github.com/bilal578/ai-sniper-bot.git /opt/ai-sniper-bot
cd /opt/ai-sniper-bot
npm ci
npm run build
mkdir -p data

cp .env.example .env
chmod 600 .env          # the key lives here; nobody else should read it
nano .env               # fill it in
chown -R sniper:sniper /opt/ai-sniper-bot
```

Then install the service so it restarts on crash and survives reboots:

```bash
cp deploy/ai-sniper.service /etc/systemd/system/
# ExecStart assumes /usr/bin/node — check `which node` and edit if it differs
# (nvm and fnm installs are NOT in /usr/bin).
systemctl daemon-reload
systemctl enable --now ai-sniper

systemctl status ai-sniper
journalctl -u ai-sniper -f      # live logs
```

`systemctl stop ai-sniper` sends SIGTERM, which runs the bot's own shutdown
handler: the watcher stops and open positions are persisted to `data/` so they
are picked back up on the next start.

### Reaching the dashboard on a VPS

The dashboard shows your wallet and can sell your positions. **Do not open port
4311 to the internet.** Tunnel it over SSH instead — nothing is exposed, and no
token is needed:

```bash
# from your own machine
ssh -N -L 4311:127.0.0.1:4311 user@your-vps-ip
```

Now <http://127.0.0.1:4311> on your laptop shows the bot running on the VPS.

If you genuinely need direct access (for example from a phone, off your own
network), then set both of these — the bot refuses to start with a non-loopback
host and no token:

```dotenv
DASHBOARD_HOST=0.0.0.0
DASHBOARD_TOKEN=<a long random string>
```

…and restrict the port at the firewall to your own IP:

```bash
ufw allow from YOUR.IP.ADDR.ESS to any port 4311
```

Anyone who reaches that port with the token can sell your positions. The SSH
tunnel is the better answer in almost every case.

## Option C — Docker

```bash
docker build -t ai-sniper-bot .

docker run -d --name sniper --restart unless-stopped \
  --env-file .env \
  -v "$PWD/data:/data" \
  -p 127.0.0.1:4311:4311 \
  ai-sniper-bot
```

Two details that matter:

- `-p 127.0.0.1:4311:4311` publishes the dashboard **to loopback on the host
  only**. Writing `-p 4311:4311` instead publishes it to every interface, and
  Docker punches through `ufw` — your dashboard would be on the public internet.
- The image sets `DASHBOARD_HOST=0.0.0.0` because the server must listen on the
  container's external interface to be reachable at all. The host-side
  `127.0.0.1:` binding above is what keeps it private.

`-v "$PWD/data:/data"` keeps your position ledger across container restarts.
Without it, a restart loses track of what you are holding.

---

## Before you leave it running

- [ ] Ran in dry-run first and read the dashboard's activity feed.
- [ ] `.env` is `chmod 600` and owned by the service user.
- [ ] Wallet is a **burner**, funded only with what you can lose entirely.
- [ ] `MAX_DAILY_LOSS_SOL` set to a number you would accept losing today.
- [ ] Paid RPC endpoint, in the same region as the VPS.
- [ ] Dashboard reachable only over an SSH tunnel, or token + firewall.
- [ ] `journalctl -u ai-sniper -f` checked at least once after starting.

## Cost

| Item | Typical |
|---|---|
| VPS (2 vCPU / 2 GB) | $5-12 / month |
| Paid Solana RPC | $0-50 / month (free tiers exist but rate-limit) |
| Anthropic API | cents per day — Haiku, one short call per candidate |

The RPC is the line item that actually affects results. Everything else is
noise next to your trading P&L.
