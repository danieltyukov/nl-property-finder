/**
 * Test helpers for adapter tests. Nothing here touches the network beyond
 * 127.0.0.1: `fixtureContext` answers `ctx.fetch` from files, and
 * `startFixtureServer` serves files and handlers on a local port for code
 * that needs a real HTTP server (a browser filling a form, for example).
 */
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ConfigSchema,
  SourceConfigSchema,
  memoryLogger,
  type BrowserSession,
  type Config,
  type Logger,
  type SourceContext,
} from '@nlpf/core';
import { SourceHttpError } from './runtime/errors.js';
import { checkResponse, makeResult, type FetchInit } from './runtime/fetch.js';

/** Absolute path of `packages/sources/fixtures/`. */
export const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/', import.meta.url));

const resolveIn = (dir: string, file: string) => (isAbsolute(file) ? file : join(dir, file));

/** Reads a fixture file as text, relative to `packages/sources/fixtures/` unless `dir` is given. */
export function readFixture(file: string, dir: string = FIXTURES_DIR): string {
  return readFileSync(resolveIn(dir, file), 'utf8');
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
  '.eml': 'message/rfc822',
};

function guessType(body: string | Buffer, file?: string): string {
  if (file) return TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
  const start = (typeof body === 'string' ? body : body.subarray(0, 64).toString('latin1')).trimStart();
  if (start.startsWith('<')) return 'text/html; charset=utf-8';
  if (start.startsWith('{') || start.startsWith('[')) return 'application/json';
  return 'text/plain; charset=utf-8';
}

/* ---------- fixtureContext ---------- */

export interface FixtureRoute {
  /** A substring of the requested URL, or a RegExp tested against it. The first matching route wins. */
  match: string | RegExp;
  /** Only match this HTTP method (case-insensitive). Default: any. */
  method?: string;
  /** Fixture file, relative to `dir`. */
  file?: string;
  /** Inline body instead of a file; objects are sent as JSON. */
  body?: string | object;
  status?: number;
  headers?: Record<string, string>;
}

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

export interface FixtureContextOptions {
  /** Where relative fixture paths resolve. Default `packages/sources/fixtures/`. */
  dir?: string;
  /** Either a list of routes or a map from URL substring to fixture file. */
  routes: FixtureRoute[] | Record<string, string>;
  sourceId?: string;
  /** A full config or a partial one that goes through the config schema (defaults filled in). */
  config?: Config | Record<string, unknown>;
  now?: Date | (() => Date);
  /** Browser sessions for adapters that need one; by default `ctx.browser()` throws. */
  browser?: (opts?: { headed?: boolean }) => Promise<BrowserSession>;
  log?: Logger;
  signal?: AbortSignal;
}

export interface FixtureContext extends SourceContext {
  /** Every request the adapter made, in order, so tests can assert URLs, methods and bodies. */
  requests: RecordedRequest[];
}

function bodyText(body: RequestInit['body']): string | undefined {
  if (body == null) return undefined;
  if (typeof body === 'string') return body;
  if (body instanceof URLSearchParams) return body.toString();
  return String(body);
}

/**
 * A `SourceContext` whose `fetch` serves fixture files by URL pattern, with
 * the same error behaviour as the polite fetch (403/429 and challenge pages
 * throw `SourceBlockedError`, other failures `SourceHttpError`). A request no
 * route matches throws a 404 `SourceHttpError` naming the URL.
 *
 * ```ts
 * const ctx = fixtureContext({ sourceId: 'kamernet', routes: { '/findlistings': 'kamernet/search.json' } });
 * const listings = await adapter.search(req, ctx);
 * expect(ctx.requests[0]?.body).toContain('"radius"');
 * ```
 */
export function fixtureContext(opts: FixtureContextOptions): FixtureContext {
  const dir = opts.dir ?? FIXTURES_DIR;
  const routes: FixtureRoute[] = Array.isArray(opts.routes)
    ? opts.routes
    : Object.entries(opts.routes).map(([match, file]) => ({ match, file }));
  const config = ConfigSchema.parse(opts.config ?? {});
  const sourceId = opts.sourceId ?? 'test';
  const requests: RecordedRequest[] = [];
  const now = opts.now instanceof Date ? () => opts.now as Date : (opts.now ?? (() => new Date()));

  const fetchFixture = async (url: string, init: FetchInit = {}) => {
    const method = (init.method ?? 'GET').toUpperCase();
    requests.push({ url, method, headers: Object.fromEntries(new Headers(init.headers).entries()), body: bodyText(init.body) });
    const route = routes.find(
      (r) =>
        (!r.method || r.method.toUpperCase() === method) &&
        (typeof r.match === 'string' ? url.includes(r.match) : r.match.test(url)),
    );
    if (!route) throw new SourceHttpError(`no fixture route for ${method} ${url}`, { status: 404, url });
    let text: string;
    if (route.file) text = readFileSync(resolveIn(dir, route.file), 'utf8');
    else if (typeof route.body === 'string') text = route.body;
    else if (route.body !== undefined) text = JSON.stringify(route.body);
    else text = '';
    const headers = new Headers({ 'content-type': guessType(text, route.file), ...route.headers });
    const status = route.status ?? 200;
    checkResponse({ status, headers, text, url });
    return makeResult({ status, url, headers, text, notModified: false });
  };

  return {
    requests,
    fetch: fetchFixture,
    browser: async (o) => {
      if (!opts.browser) throw new Error('fixtureContext has no browser; pass opts.browser');
      return opts.browser(o);
    },
    log: opts.log ?? memoryLogger(),
    profile: config.profile,
    searches: config.searches.filter((s) => s.enabled),
    source: config.sources[sourceId] ?? SourceConfigSchema.parse({}),
    now,
    signal: opts.signal ?? new AbortController().signal,
  };
}

/* ---------- startFixtureServer ---------- */

export interface ServerRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Record<string, string>;
  body: string;
}

export interface ServerReply {
  status?: number;
  headers?: Record<string, string>;
  /** Strings and Buffers are sent as they are; other objects as JSON. */
  body?: string | Buffer | object;
  /** Fixture file, relative to the server's `dir`. */
  file?: string;
}

/** A fixture file path, a fixed reply, or a handler. */
export type ServerRoute = string | ServerReply | ((req: ServerRequest) => ServerReply | Promise<ServerReply>);

export interface FixtureServer {
  /** `http://127.0.0.1:<port>` without a trailing slash. */
  url: string;
  port: number;
  requests: ServerRequest[];
  close(): Promise<void>;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * A local HTTP server on 127.0.0.1 and a free port. Route keys are a path
 * (`/aanbod/`) or a method and a path (`POST /contact`); the query string is
 * not part of the match. Unknown paths get a 404.
 */
export async function startFixtureServer(routes: Record<string, ServerRoute>, opts: { dir?: string } = {}): Promise<FixtureServer> {
  const dir = opts.dir ?? FIXTURES_DIR;
  const requests: ServerRequest[] = [];
  const server = createServer(async (req, res) => {
    try {
      const u = new URL(req.url ?? '/', 'http://127.0.0.1');
      const method = (req.method ?? 'GET').toUpperCase();
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers[k] = v;
      const request: ServerRequest = { method, path: u.pathname, query: u.searchParams, headers, body: await readBody(req) };
      requests.push(request);
      const route = routes[`${method} ${u.pathname}`] ?? routes[u.pathname];
      if (route === undefined) {
        res.writeHead(404, { 'content-type': 'text/plain' }).end(`no route for ${method} ${u.pathname}`);
        return;
      }
      const reply: ServerReply =
        typeof route === 'string' ? { file: route } : typeof route === 'function' ? await route(request) : route;
      let body: string | Buffer = '';
      if (reply.file) body = readFileSync(resolveIn(dir, reply.file));
      else if (typeof reply.body === 'string' || Buffer.isBuffer(reply.body)) body = reply.body;
      else if (reply.body !== undefined) body = JSON.stringify(reply.body);
      const status = reply.status ?? 200;
      const out: Record<string, string> = { ...reply.headers };
      if (status !== 304 && !Object.keys(out).some((k) => k.toLowerCase() === 'content-type')) {
        out['content-type'] = guessType(body, reply.file);
      }
      res.writeHead(status, out).end(status === 304 ? undefined : body);
    } catch (e) {
      res.writeHead(500, { 'content-type': 'text/plain' }).end(String(e));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
