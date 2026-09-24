import { timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';

export const SESSION_COOKIE = 'nlpf_session';

export interface GuardOptions {
  token: string;
  port: number;
  extraHosts?: string[];
}

const same = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * Three checks on every request.
 *
 * Host must be the daemon's own address. That defeats DNS rebinding, where a
 * web page makes its own hostname resolve to 127.0.0.1 to read our responses.
 *
 * Origin, when present, must be ours too. Browsers send it on cross-site
 * requests, so a page elsewhere cannot trigger actions even blindly.
 *
 * The token must match: the X-NLPF-Token header for API clients (CLI, MCP,
 * the dashboard's fetches), the session cookie for the dashboard page itself,
 * and a `token` query parameter only where a header cannot be set (the
 * calendar feed a calendar app subscribes to, and EventSource).
 */
export function guard(opts: GuardOptions): MiddlewareHandler {
  const hosts = new Set([`127.0.0.1:${opts.port}`, `localhost:${opts.port}`, ...(opts.extraHosts ?? []).map((h) => `${h}:${opts.port}`)]);
  const origins = new Set([...hosts].map((h) => `http://${h}`));
  return async (c, next) => {
    const host = c.req.header('host') ?? '';
    if (!hosts.has(host)) return c.json({ error: { code: 'bad_host', message: 'Unknown Host header.' } }, 403);
    const origin = c.req.header('origin');
    if (origin && !origins.has(origin)) return c.json({ error: { code: 'bad_origin', message: 'Cross-origin requests are not accepted.' } }, 403);

    const path = c.req.path;
    // The dashboard shell and its static assets carry no data; the page gets
    // its token only through the session cookie (see the `/` route).
    const isApi = path.startsWith('/api/') || path === '/calendar.ics';
    if (!isApi) return next();

    const header = c.req.header('x-nlpf-token');
    const cookie = getCookie(c, SESSION_COOKIE);
    const queryAllowed = path === '/calendar.ics' || path === '/api/v1/events';
    const query = queryAllowed ? c.req.query('token') : undefined;
    const presented = header ?? query ?? cookie;
    if (!presented || !same(presented, opts.token)) {
      return c.json({ error: { code: 'unauthorized', message: 'Missing or wrong API token. Run nlpf open, or read it from the api-token file.' } }, 401);
    }
    return next();
  };
}
