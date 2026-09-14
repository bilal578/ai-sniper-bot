import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig, type Config } from '../src/config.js';
import { DashboardServer } from '../src/server/dashboard.js';
import type { SniperBot } from '../src/bot.js';

const base = { RPC_HTTP_URL: 'https://example.com', ENABLE_AI_ANALYSIS: 'false' };

/** Minimal stand-in: the server only ever touches these four members. */
function fakeBot(): SniperBot & { paused: boolean; closed: string[] } {
  const bot = {
    paused: false,
    closed: [] as string[],
    setPaused(v: boolean) {
      bot.paused = v;
    },
    async closePosition(id: string) {
      if (id === 'missing') throw new Error(`no position with id ${id}`);
      bot.closed.push(id);
    },
    async snapshot() {
      return { mode: 'DRY_RUN', paused: bot.paused, activity: [] };
    },
  };
  return bot as unknown as SniperBot & { paused: boolean; closed: string[] };
}

const servers: DashboardServer[] = [];

async function startServer(env: Record<string, string> = {}): Promise<{
  server: DashboardServer;
  bot: ReturnType<typeof fakeBot>;
  cfg: Config;
}> {
  // Port 0 lets the OS pick a free port, so tests never collide.
  const cfg = loadConfig({ ...base, DASHBOARD_PORT: '0', ...env });
  const bot = fakeBot();
  const server = new DashboardServer(cfg, bot);
  await server.start();
  servers.push(server);
  return { server, bot, cfg };
}

/** Reads the port the OS actually assigned. */
function portOf(server: DashboardServer): number {
  const raw = (server as unknown as { server: { address(): { port: number } } }).server;
  return raw.address().port;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.stop()));
});

describe('DashboardServer', () => {
  it('serves the dashboard page', async () => {
    const { server } = await startServer();
    const res = await fetch(`http://127.0.0.1:${portOf(server)}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('AI Sniper Bot');
  });

  it('serves the state snapshot as JSON', async () => {
    const { server } = await startServer();
    const res = await fetch(`http://127.0.0.1:${portOf(server)}/api/state`);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ mode: 'DRY_RUN', paused: false });
  });

  it('pauses and resumes buys', async () => {
    const { server, bot } = await startServer();
    const url = `http://127.0.0.1:${portOf(server)}`;

    await fetch(`${url}/api/pause`, { method: 'POST' });
    expect(bot.paused).toBe(true);

    await fetch(`${url}/api/resume`, { method: 'POST' });
    expect(bot.paused).toBe(false);
  });

  it('closes a position on request', async () => {
    const { server, bot } = await startServer();
    const res = await fetch(`http://127.0.0.1:${portOf(server)}/api/positions/pos-1/close`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(bot.closed).toEqual(['pos-1']);
  });

  it('reports a failed close as a 400 rather than a crash', async () => {
    const { server } = await startServer();
    const res = await fetch(`http://127.0.0.1:${portOf(server)}/api/positions/missing/close`, { method: 'POST' });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining('no position') });
  });

  it('404s an unknown route', async () => {
    const { server } = await startServer();
    const res = await fetch(`http://127.0.0.1:${portOf(server)}/api/nope`);
    expect(res.status).toBe(404);
  });

  it('rejects an unauthenticated request when a token is configured', async () => {
    const { server } = await startServer({ DASHBOARD_TOKEN: 'sekret' });
    const res = await fetch(`http://127.0.0.1:${portOf(server)}/api/state`);
    expect(res.status).toBe(401);
  });

  it('rejects a wrong token', async () => {
    const { server } = await startServer({ DASHBOARD_TOKEN: 'sekret' });
    const res = await fetch(`http://127.0.0.1:${portOf(server)}/api/state?token=wrong`);
    expect(res.status).toBe(401);
  });

  it('accepts the token as a query parameter', async () => {
    const { server } = await startServer({ DASHBOARD_TOKEN: 'sekret' });
    const res = await fetch(`http://127.0.0.1:${portOf(server)}/api/state?token=sekret`);
    expect(res.status).toBe(200);
  });

  it('accepts the token as a bearer header', async () => {
    const { server } = await startServer({ DASHBOARD_TOKEN: 'sekret' });
    const res = await fetch(`http://127.0.0.1:${portOf(server)}/api/state`, {
      headers: { authorization: 'Bearer sekret' },
    });
    expect(res.status).toBe(200);
  });

  it('will not control the bot without a token', async () => {
    const { server, bot } = await startServer({ DASHBOARD_TOKEN: 'sekret' });
    await fetch(`http://127.0.0.1:${portOf(server)}/api/pause`, { method: 'POST' });
    expect(bot.paused).toBe(false);
  });
});

describe('dashboard configuration', () => {
  it('refuses to bind off-loopback without a token', () => {
    expect(() => loadConfig({ ...base, DASHBOARD_HOST: '0.0.0.0' })).toThrow(/DASHBOARD_TOKEN is unset/);
  });

  it('allows off-loopback binding once a token is set', () => {
    expect(() => loadConfig({ ...base, DASHBOARD_HOST: '0.0.0.0', DASHBOARD_TOKEN: 'x' })).not.toThrow();
  });

  it('does not require a token on loopback', () => {
    expect(() => loadConfig({ ...base, DASHBOARD_HOST: '127.0.0.1' })).not.toThrow();
  });

  it('skips the check entirely when the dashboard is off', () => {
    expect(() => loadConfig({ ...base, DASHBOARD_HOST: '0.0.0.0', DASHBOARD_ENABLED: 'false' })).not.toThrow();
  });
});
