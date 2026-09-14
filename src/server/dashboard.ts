import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import type { Config } from '../config.js';
import { getLogger } from '../logger.js';
import { errorMessage } from '../utils/index.js';
import type { SniperBot } from '../bot.js';
import { renderPage } from './ui.js';

const log = getLogger('dashboard');

/** Constant-time compare so the token cannot be recovered by timing the response. */
function tokenMatches(expected: string, provided: string | undefined): boolean {
  if (!provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export class DashboardServer {
  private server: Server | null = null;

  constructor(
    private readonly cfg: Config,
    private readonly bot: SniperBot,
  ) {}

  get url(): string {
    const host = this.cfg.DASHBOARD_HOST === '0.0.0.0' ? 'localhost' : this.cfg.DASHBOARD_HOST;
    const suffix = this.cfg.DASHBOARD_TOKEN ? `?token=${encodeURIComponent(this.cfg.DASHBOARD_TOKEN)}` : '';
    return `http://${host}:${this.cfg.DASHBOARD_PORT}/${suffix}`;
  }

  async start(): Promise<void> {
    if (this.server) return;

    this.server = createServer((req, res) => {
      void this.handle(req, res).catch((error) => {
        log.error({ err: errorMessage(error) }, 'unhandled dashboard error');
        send(res, 500, { error: 'internal error' });
      });
    });

    await new Promise<void>((resolve, reject) => {
      const server = this.server;
      if (!server) {
        reject(new Error('server was torn down during start'));
        return;
      }
      server.once('error', reject);
      server.listen(this.cfg.DASHBOARD_PORT, this.cfg.DASHBOARD_HOST, () => {
        server.removeListener('error', reject);
        resolve();
      });
    });

    log.info({ url: this.url }, '📊 dashboard listening');
  }

  private authorised(req: IncomingMessage, url: URL): boolean {
    const expected = this.cfg.DASHBOARD_TOKEN?.trim();
    if (!expected) return true; // loopback-only; enforced at config load

    const header = req.headers.authorization;
    const bearer = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    return tokenMatches(expected, bearer) || tokenMatches(expected, url.searchParams.get('token') ?? undefined);
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    if (!this.authorised(req, url)) {
      send(res, 401, { error: 'unauthorised — append ?token=... or send an Authorization: Bearer header' });
      return;
    }

    // The page can trigger sells, so never let another origin read its data.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(renderPage(Boolean(this.cfg.DASHBOARD_TOKEN)));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/favicon.svg') {
      res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'max-age=86400' });
      res.end(FAVICON);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/state') {
      send(res, 200, await this.bot.snapshot());
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/pause') {
      this.bot.setPaused(true);
      send(res, 200, { paused: true });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/resume') {
      this.bot.setPaused(false);
      send(res, 200, { paused: false });
      return;
    }

    const closeMatch = url.pathname.match(/^\/api\/positions\/([\w-]+)\/close$/);
    if (req.method === 'POST' && closeMatch?.[1]) {
      try {
        await this.bot.closePosition(closeMatch[1]);
        send(res, 200, { closed: true });
      } catch (error) {
        send(res, 400, { error: errorMessage(error) });
      }
      return;
    }

    send(res, 404, { error: 'not found' });
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = null;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    log.info('dashboard stopped');
  }
}

/** Crosshair mark, inlined so the page needs no asset pipeline. */
const FAVICON = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">',
  '<circle cx="16" cy="16" r="11" fill="none" stroke="#3fcf8e" stroke-width="2.5"/>',
  '<circle cx="16" cy="16" r="3" fill="#3fcf8e"/>',
  '<path d="M16 1v6M16 25v6M1 16h6M25 16h6" stroke="#3fcf8e" stroke-width="2.5" stroke-linecap="round"/>',
  '</svg>',
].join('');

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}
