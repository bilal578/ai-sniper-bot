/**
 * The dashboard page, served as a single self-contained document.
 *
 * No bundler, no CDN and no external fonts: the page must render on a machine
 * with no outbound internet, and a trading dashboard should never depend on a
 * third party that could see the request.
 */
export function renderPage(_tokenRequired: boolean): string {
  return PAGE;
}

const PAGE = String.raw`<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<title>AI Sniper Bot</title>
<style>
  :root {
    --bg: #0b0e14; --panel: #141922; --panel-2: #1b2130; --line: #262e3d;
    --text: #e6e9ef; --dim: #8b95a7; --faint: #5d6678;
    --green: #3fcf8e; --red: #f2555a; --amber: #f0a93b; --blue: #58a6ff; --violet: #a371f7;
    --radius: 10px;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--text);
    font: 14px/1.5 ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif;
    padding: 20px 16px 60px;
  }
  .wrap { max-width: 1180px; margin: 0 auto; }
  h1 { font-size: 18px; margin: 0; letter-spacing: -0.01em; }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em;
       color: var(--dim); margin: 26px 0 10px; font-weight: 600; }
  code, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }

  header { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 4px; }
  .badge { font-size: 11px; font-weight: 700; padding: 3px 9px; border-radius: 999px;
           letter-spacing: 0.05em; text-transform: uppercase; }
  .badge.live { background: rgba(242,85,90,.16); color: var(--red); border: 1px solid rgba(242,85,90,.35); }
  .badge.dry  { background: rgba(88,166,255,.14); color: var(--blue); border: 1px solid rgba(88,166,255,.32); }
  .badge.paused { background: rgba(240,169,59,.16); color: var(--amber); border: 1px solid rgba(240,169,59,.35); }
  .spacer { flex: 1; }

  button {
    background: var(--panel-2); color: var(--text); border: 1px solid var(--line);
    padding: 6px 13px; border-radius: 7px; cursor: pointer; font-size: 13px; font-weight: 500;
  }
  button:hover:not(:disabled) { border-color: var(--faint); background: #222a3a; }
  button:disabled { opacity: .45; cursor: not-allowed; }
  button.danger { color: var(--red); border-color: rgba(242,85,90,.3); }
  button.danger:hover:not(:disabled) { background: rgba(242,85,90,.12); border-color: var(--red); }

  .cards { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(165px, 1fr)); margin-top: 14px; }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 13px 15px; }
  .card .label { font-size: 11px; color: var(--dim); text-transform: uppercase; letter-spacing: 0.05em; }
  .card .value { font-size: 21px; font-weight: 650; margin-top: 5px; letter-spacing: -0.02em;
                 font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .card .sub { font-size: 12px; color: var(--faint); margin-top: 3px; }

  .panel { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; }
  .scroll { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em;
       color: var(--dim); font-weight: 600; padding: 10px 14px; border-bottom: 1px solid var(--line);
       white-space: nowrap; }
  td { padding: 10px 14px; border-bottom: 1px solid rgba(38,46,61,.55); white-space: nowrap; }
  tr:last-child td { border-bottom: 0; }
  tbody tr:hover { background: rgba(255,255,255,.022); }

  .pos { color: var(--green); } .neg { color: var(--red); } .dim { color: var(--dim); }
  .num { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .sym { font-weight: 600; }
  .mint { color: var(--faint); font-size: 12px; font-family: ui-monospace, Menlo, monospace; }

  .tag { font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 5px;
         text-transform: uppercase; letter-spacing: 0.04em; }
  .tag.bought   { background: rgba(63,207,142,.15); color: var(--green); }
  .tag.closed   { background: rgba(163,113,247,.15); color: var(--violet); }
  .tag.safety   { background: rgba(242,85,90,.13); color: var(--red); }
  .tag.ai       { background: rgba(240,169,59,.14); color: var(--amber); }
  .tag.risk     { background: rgba(88,166,255,.13); color: var(--blue); }
  .tag.error    { background: rgba(139,149,167,.15); color: var(--dim); }

  .feed { max-height: 480px; overflow-y: auto; }
  .feed .reason { white-space: normal; color: var(--dim); font-size: 12.5px;
                  max-width: 560px; min-width: 240px; }
  .empty { padding: 30px 16px; text-align: center; color: var(--faint); font-size: 13px; }

  .meter { height: 4px; background: var(--panel-2); border-radius: 999px; overflow: hidden; margin-top: 8px; }
  .meter > span { display: block; height: 100%; border-radius: 999px; transition: width .35s ease; }

  footer { margin-top: 26px; color: var(--faint); font-size: 12px;
           display: flex; gap: 14px; flex-wrap: wrap; align-items: center; }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--green); display: inline-block; }
  .dot.stale { background: var(--amber); }
  .dot.down { background: var(--red); }

  @media (max-width: 620px) {
    body { padding: 14px 12px 50px; }
    .card .value { font-size: 18px; }
  }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>AI Sniper Bot</h1>
    <span id="mode" class="badge dry">…</span>
    <span id="pausedBadge" class="badge paused" hidden>paused</span>
    <span class="spacer"></span>
    <button id="toggle" disabled>…</button>
  </header>

  <div class="cards" id="cards"></div>

  <h2>Open positions</h2>
  <div class="panel scroll"><table>
    <thead><tr>
      <th>Token</th><th>In</th><th>Now</th><th>P&amp;L</th><th>Peak</th><th>Age</th><th>Scores</th><th></th>
    </tr></thead>
    <tbody id="openBody"></tbody>
  </table></div>

  <h2>Activity — every token the bot judged</h2>
  <div class="panel feed scroll"><table>
    <thead><tr><th>Time</th><th>Stage</th><th>Token</th><th>Reason</th></tr></thead>
    <tbody id="feedBody"></tbody>
  </table></div>

  <h2>Closed positions</h2>
  <div class="panel scroll"><table>
    <thead><tr><th>Token</th><th>In</th><th>Out</th><th>P&amp;L</th><th>Exit</th><th>Held</th></tr></thead>
    <tbody id="closedBody"></tbody>
  </table></div>

  <footer>
    <span><span id="dot" class="dot"></span> <span id="status">connecting…</span></span>
    <span id="uptime" class="dim"></span>
    <span id="walletInfo" class="mono dim"></span>
  </footer>
</div>

<script>
(function () {
  var TOKEN = new URLSearchParams(location.search).get('token');
  var failures = 0;

  function api(path, options) {
    var opts = options || {};
    var url = path + (TOKEN ? (path.indexOf('?') === -1 ? '?' : '&') + 'token=' + encodeURIComponent(TOKEN) : '');
    return fetch(url, opts).then(function (r) {
      if (!r.ok) return r.json().catch(function () { return {}; }).then(function (b) {
        throw new Error(b.error || ('HTTP ' + r.status));
      });
      return r.json();
    });
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function sol(n, d) { return (n >= 0 ? '+' : '') + n.toFixed(d == null ? 4 : d); }
  function cls(n) { return n > 0 ? 'pos' : n < 0 ? 'neg' : 'dim'; }
  function short(a) { return a && a.length > 12 ? a.slice(0, 4) + '…' + a.slice(-4) : (a || ''); }
  function mins(ms) {
    var m = ms / 60000;
    if (m < 1) return Math.round(ms / 1000) + 's';
    if (m < 60) return m.toFixed(1) + 'm';
    return (m / 60).toFixed(1) + 'h';
  }
  function clock(ts) {
    var d = new Date(ts);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
         + ':' + String(d.getSeconds()).padStart(2, '0');
  }
  function pnlPct(from, to) { return from ? ((to - from) / from) * 100 : 0; }

  function card(label, value, valueClass, sub, meter) {
    var h = '<div class="card"><div class="label">' + esc(label) + '</div>'
          + '<div class="value ' + (valueClass || '') + '">' + value + '</div>';
    if (sub) h += '<div class="sub">' + sub + '</div>';
    if (meter) {
      h += '<div class="meter"><span style="width:' + Math.min(100, Math.max(0, meter.pct)) + '%;background:'
         + meter.color + '"></span></div>';
    }
    return h + '</div>';
  }

  function renderCards(s) {
    var t = s.totals, r = s.risk;
    var net = t.realisedPnlSol + t.unrealisedPnlSol;
    var trades = t.wins + t.losses;
    var winRate = trades ? Math.round((t.wins / trades) * 100) : 0;
    var lossUsed = r.maxDailyLossSol > 0 ? (Math.max(0, -r.dailyPnlSol) / r.maxDailyLossSol) * 100 : 0;

    document.getElementById('cards').innerHTML =
        card('Net P&L', sol(net) + ' SOL', cls(net),
             'realised ' + sol(t.realisedPnlSol) + ' · open ' + sol(t.unrealisedPnlSol))
      + card('Wallet', s.wallet.balanceSol == null ? '—' : s.wallet.balanceSol.toFixed(3) + ' SOL', '',
             s.wallet.canSign ? 'signing enabled' : 'read-only (no key)')
      + card('Open', r.openPositions + ' / ' + r.maxConcurrentPositions, '',
             s.settings.buyAmountSol + ' SOL per trade',
             { pct: (r.openPositions / r.maxConcurrentPositions) * 100, color: 'var(--blue)' })
      + card('Win rate', trades ? winRate + '%' : '—', trades ? cls(winRate - 50) : 'dim',
             t.wins + 'W · ' + t.losses + 'L')
      + card('Daily loss budget', Math.max(0, -r.dailyPnlSol).toFixed(3) + ' / ' + r.maxDailyLossSol,
             lossUsed >= 100 ? 'neg' : '', lossUsed >= 100 ? 'limit hit — buys halted' : 'SOL used today',
             { pct: lossUsed, color: lossUsed > 70 ? 'var(--red)' : 'var(--amber)' })
      + card('Detected', s.stats.detected, '',
             s.stats.bought + ' bought · ' + (s.stats.safetyRejected + s.stats.aiRejected + s.stats.riskRejected) + ' rejected')
      + card('Rejections', s.stats.safetyRejected + ' / ' + s.stats.aiRejected + ' / ' + s.stats.riskRejected,
             'dim', 'safety / ai / risk')
      + card('Trades this hour', r.tradesThisHour + ' / ' + r.maxTradesPerHour, '',
             s.settings.aiModel ? 'AI ≥ ' + s.settings.aiMinScore : 'AI disabled',
             { pct: (r.tradesThisHour / r.maxTradesPerHour) * 100, color: 'var(--violet)' });
  }

  function renderOpen(s) {
    var body = document.getElementById('openBody');
    if (!s.positions.open.length) {
      body.innerHTML = '<tr><td colspan="8" class="empty">No open positions.</td></tr>';
      return;
    }
    body.innerHTML = s.positions.open.map(function (p) {
      var change = pnlPct(p.entryPrice, p.lastPrice);
      var peak = pnlPct(p.entryPrice, p.peakPrice);
      var inSol = p.entryLamports / 1e9;
      var nowSol = inSol * (p.entryPrice ? p.lastPrice / p.entryPrice : 1);
      return '<tr>'
        + '<td><span class="sym">' + esc(p.symbol || '—') + '</span> '
        +   '<span class="mint">' + esc(short(p.mint)) + '</span>'
        +   (p.dryRun ? ' <span class="tag error">dry</span>' : '')
        +   (p.status === 'closing' ? ' <span class="tag ai">closing</span>' : '') + '</td>'
        + '<td class="num">' + inSol.toFixed(4) + '</td>'
        + '<td class="num">' + nowSol.toFixed(4) + '</td>'
        + '<td class="num ' + cls(change) + '">' + sol(change, 1) + '%</td>'
        + '<td class="num dim">' + sol(peak, 1) + '%</td>'
        + '<td class="num dim">' + mins(Date.now() - p.openedAt) + '</td>'
        + '<td class="num dim">' + (p.safetyScore == null ? '—' : p.safetyScore)
        +   ' / ' + (p.aiScore == null ? '—' : p.aiScore) + '</td>'
        + '<td><button class="danger" data-close="' + esc(p.id) + '"'
        +   (p.status !== 'open' ? ' disabled' : '') + '>Sell</button></td>'
        + '</tr>';
    }).join('');
  }

  function renderFeed(s) {
    var body = document.getElementById('feedBody');
    if (!s.activity.length) {
      body.innerHTML = '<tr><td colspan="4" class="empty">Nothing yet — waiting for new launches.</td></tr>';
      return;
    }
    body.innerHTML = s.activity.map(function (a) {
      var scores = [];
      if (a.safetyScore != null) scores.push('safety ' + a.safetyScore);
      if (a.aiScore != null) scores.push('ai ' + a.aiScore);
      return '<tr>'
        + '<td class="num dim">' + clock(a.at) + '</td>'
        + '<td><span class="tag ' + esc(a.stage) + '">' + esc(a.stage) + '</span></td>'
        + '<td><span class="sym">' + esc(a.symbol || '—') + '</span> '
        +   '<span class="mint">' + esc(short(a.mint)) + '</span></td>'
        + '<td class="reason">' + esc(a.reason)
        +   (scores.length ? ' <span class="dim">(' + scores.join(', ') + ')</span>' : '') + '</td>'
        + '</tr>';
    }).join('');
  }

  function renderClosed(s) {
    var body = document.getElementById('closedBody');
    if (!s.positions.closed.length) {
      body.innerHTML = '<tr><td colspan="6" class="empty">No closed positions yet.</td></tr>';
      return;
    }
    body.innerHTML = s.positions.closed.map(function (p) {
      var inSol = p.entryLamports / 1e9;
      var outSol = p.realisedLamports / 1e9;
      var d = outSol - inSol;
      return '<tr>'
        + '<td><span class="sym">' + esc(p.symbol || '—') + '</span> '
        +   '<span class="mint">' + esc(short(p.mint)) + '</span></td>'
        + '<td class="num">' + inSol.toFixed(4) + '</td>'
        + '<td class="num">' + outSol.toFixed(4) + '</td>'
        + '<td class="num ' + cls(d) + '">' + sol(d) + ' (' + sol(pnlPct(inSol, outSol), 1) + '%)</td>'
        + '<td class="dim">' + esc(p.exitReason || '—') + '</td>'
        + '<td class="num dim">' + (p.closedAt ? mins(p.closedAt - p.openedAt) : '—') + '</td>'
        + '</tr>';
    }).join('');
  }

  function render(s) {
    var mode = document.getElementById('mode');
    mode.textContent = s.mode === 'LIVE' ? 'live' : 'dry run';
    mode.className = 'badge ' + (s.mode === 'LIVE' ? 'live' : 'dry');
    document.getElementById('pausedBadge').hidden = !s.paused;

    var toggle = document.getElementById('toggle');
    toggle.textContent = s.paused ? 'Resume buys' : 'Pause buys';
    toggle.disabled = false;
    toggle.dataset.action = s.paused ? 'resume' : 'pause';

    renderCards(s);
    renderOpen(s);
    renderFeed(s);
    renderClosed(s);

    document.getElementById('uptime').textContent = 'up ' + mins(s.uptimeSeconds * 1000);
    document.getElementById('walletInfo').textContent = short(s.wallet.address)
      + (s.solPriceUsd ? '  ·  SOL $' + s.solPriceUsd.toFixed(2) : '');
  }

  function setStatus(text, state) {
    document.getElementById('status').textContent = text;
    document.getElementById('dot').className = 'dot' + (state ? ' ' + state : '');
  }

  function refresh() {
    return api('/api/state').then(function (s) {
      failures = 0;
      render(s);
      setStatus('live · updated ' + clock(Date.now()), '');
    }).catch(function (e) {
      failures++;
      setStatus('disconnected — ' + e.message, failures > 3 ? 'down' : 'stale');
    });
  }

  document.getElementById('toggle').addEventListener('click', function (e) {
    var btn = e.currentTarget;
    btn.disabled = true;
    api('/api/' + btn.dataset.action, { method: 'POST' }).then(refresh).catch(function (err) {
      setStatus('action failed — ' + err.message, 'stale');
      btn.disabled = false;
    });
  });

  document.getElementById('openBody').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-close]');
    if (!btn) return;
    if (!confirm('Sell this position now at the current market price?')) return;
    btn.disabled = true;
    btn.textContent = 'Selling…';
    api('/api/positions/' + encodeURIComponent(btn.dataset.close) + '/close', { method: 'POST' })
      .then(refresh)
      .catch(function (err) {
        setStatus('sell failed — ' + err.message, 'stale');
        btn.disabled = false;
        btn.textContent = 'Sell';
      });
  });

  refresh();
  setInterval(refresh, 3000);
})();
</script>
</body>
</html>
`;
