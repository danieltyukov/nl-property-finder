import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { Hono, type Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import {
  API_PREFIX,
  ConfigPatchBody,
  ContactBody,
  DraftBody,
  ResolveTaskBody,
  SendMessageBody,
  SourcePatchBody,
  WithdrawAllBody,
  redact,
  type Config,
  type ConversationView,
  type EventType,
  type Property,
  type PropertyView,
  type StatusView,
  type Task,
} from '@nlpf/core';
import type { DaemonContext } from '../context.js';
import { renderIcs } from '../ics.js';
import { SESSION_COOKIE, guard } from './guard.js';
import { buildOpenApi } from './openapi.js';
import { sseHandler } from './sse.js';

export class HttpError extends Error {
  constructor(readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 500 | 503, readonly code: string, message: string) {
    super(message);
  }
}

const notFound = (what: string) => new HttpError(404, 'not_found', `${what} not found.`);

async function body<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  let raw: unknown = {};
  const text = await c.req.text();
  if (text) {
    try {
      raw = JSON.parse(text);
    } catch {
      throw new HttpError(400, 'bad_json', 'The request body is not valid JSON.');
    }
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new HttpError(400, 'invalid', parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
  }
  return parsed.data;
}

function propertyView(ctx: DaemonContext, id: string): PropertyView {
  const property = ctx.store.properties.get(id);
  if (!property) throw notFound('Property');
  const application = ctx.store.applications.byProperty(id) ?? null;
  return {
    property,
    listings: ctx.store.listings.list({ propertyId: id }),
    match: ctx.store.matches.get(id) ?? null,
    application,
    viewings: ctx.store.viewings.list().filter((v) => v.propertyId === id),
    conversationIds: application ? ctx.store.conversations.byApplication(application.id).map((c) => c.id) : [],
  };
}

function startOfTodayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export function statusView(ctx: DaemonContext): StatusView {
  const cfg = ctx.config();
  const today = startOfTodayIso();
  const count = (sql: string, ...args: unknown[]) => (ctx.store.raw.prepare(sql).get(...args) as { n: number }).n;
  return {
    version: ctx.version,
    startedAt: ctx.startedAt,
    paused: cfg.automation.paused,
    dryRun: cfg.automation.dryRun,
    demo: ctx.demo,
    sources: ctx.store.sources.list(),
    mail: ctx.mailStatus(),
    ai: ctx.ai(),
    counts: {
      openTasks: count("SELECT count(*) AS n FROM tasks WHERE state = 'open'"),
      seenToday: count('SELECT count(*) AS n FROM listings WHERE first_seen_at >= ?', today),
      matchedToday: count('SELECT count(*) AS n FROM matches WHERE passed = 1 AND evaluated_at >= ?', today),
      contactedToday: ctx.store.applications.countContactedSince(today),
      repliesToday: count("SELECT count(*) AS n FROM messages WHERE direction = 'in' AND at >= ?", today),
      viewingsUpcoming: count("SELECT count(*) AS n FROM viewings WHERE state = 'booked' AND starts_at >= ?", new Date().toISOString()),
    },
    nextPollAt: ctx.nextPollAt(),
  };
}

/** Config without secrets, plus which secrets are present. */
function publicConfig(ctx: DaemonContext): Config & { secretsPresent: string[] } {
  const secrets = ctx.secrets();
  return { ...redact(ctx.config(), Object.values(secrets)), secretsPresent: Object.keys(secrets).filter((k) => secrets[k]) };
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
};

/**
 * Resolves a request path to a file inside the dashboard build, or undefined.
 * Both sides go through realpath, so neither `..` segments nor a symlink can
 * reach outside, and the prefix check is anchored on a separator so a sibling
 * folder such as `dist-other` does not pass for `dist`.
 */
export function staticFile(dir: string, requestPath: string): string | undefined {
  try {
    const base = realpathSync(dir);
    const candidate = normalize(join(base, decodeURIComponent(requestPath)));
    if (!extname(candidate) || !existsSync(candidate)) return undefined;
    const real = realpathSync(candidate);
    if (!real.startsWith(base + sep) || !statSync(real).isFile()) return undefined;
    return real;
  } catch {
    return undefined;
  }
}

const LOCKED_PAGE =`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>nl-property-finder</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{font:16px/1.6 system-ui,sans-serif;background:#F5F2EA;color:#13201F;display:grid;place-items:center;min-height:100vh;margin:0}
main{max-width:34rem;padding:2rem}code{background:#ECE7DC;padding:.1rem .35rem;border-radius:4px}
@media (prefers-color-scheme:dark){body{background:#0C1515;color:#ECF1EE}code{background:#142221}}</style></head>
<body><main><h1>The agent is running</h1><p>Open the dashboard with <code>nlpf open</code>. It signs this browser in with the token only you can read.</p></main></body></html>`;

export function createApp(ctx: DaemonContext): Hono {
  const app = new Hono();
  const extraHosts = ctx.lanHost ? [ctx.lanHost] : [];
  app.use('*', guard({ token: ctx.token, port: ctx.port, extraHosts }));

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: { code: err.code, message: err.message } }, err.status);
    if (err instanceof z.ZodError) return c.json({ error: { code: 'invalid', message: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') } }, 400);
    ctx.log.error('api error', { path: c.req.path, error: err });
    return c.json({ error: { code: 'internal', message: redact(err.message, Object.values(ctx.secrets())) } }, 500);
  });

  const api = new Hono();
  const json = <T>(c: Context, value: T) => c.json(redact(value, Object.values(ctx.secrets())) as object);

  api.get('/status', (c) => json(c, statusView(ctx)));
  api.post('/pause', (c) => (ctx.actions.pause(), json(c, statusView(ctx))));
  api.post('/resume', (c) => (ctx.actions.resume(), json(c, statusView(ctx))));

  api.get('/properties', (c) => {
    const status = c.req.query('status') as never;
    const items = ctx.store.properties
      .list({ status, q: c.req.query('q'), limit: Number(c.req.query('limit') ?? 50), before: c.req.query('before') })
      .map((p) => propertyView(ctx, p.id));
    const last = items.at(-1);
    return json(c, { items, next: items.length && last ? last.property.createdAt : undefined });
  });
  api.get('/properties/:id', (c) => json(c, propertyView(ctx, c.req.param('id'))));
  api.post('/properties/:id/contact', async (c) => json(c, await ctx.actions.contactProperty(c.req.param('id'), await body(c, ContactBody))));
  api.post('/properties/:id/skip', async (c) => (await ctx.actions.skipProperty(c.req.param('id')), json(c, propertyView(ctx, c.req.param('id')))));

  api.get('/applications', (c) => {
    const items = ctx.store.applications.list({ status: c.req.query('status') as never }).map((a) => propertyView(ctx, a.propertyId));
    return json(c, { items });
  });
  api.post('/applications/withdraw-all', async (c) => json(c, await ctx.actions.withdrawAll(await body(c, WithdrawAllBody))));

  api.get('/tasks', (c) => {
    const state = (c.req.query('state') ?? 'active') as Task['state'] | 'active';
    return json(c, { items: ctx.store.tasks.list({ state, limit: Number(c.req.query('limit') ?? 200) }) });
  });
  api.post('/tasks/:id/resolve', async (c) => {
    if (!ctx.store.tasks.get(c.req.param('id'))) throw notFound('Task');
    return json(c, await ctx.actions.resolveTask(c.req.param('id'), await body(c, ResolveTaskBody)));
  });

  api.get('/conversations', (c) => {
    const items = ctx.store.conversations.list({ unreadOnly: c.req.query('unread') === '1', limit: Number(c.req.query('limit') ?? 100) });
    return json(c, { items });
  });
  api.get('/conversations/:id', (c) => {
    const conversation = ctx.store.conversations.get(c.req.param('id'));
    if (!conversation) throw notFound('Conversation');
    if (conversation.unread) ctx.store.conversations.update(conversation.id, { unread: 0 });
    const view: ConversationView = {
      conversation: { ...conversation, unread: 0 },
      messages: ctx.store.messages.list(conversation.id),
      property: conversation.propertyId ? (ctx.store.properties.get(conversation.propertyId) ?? null) : null,
      application: conversation.applicationId ? (ctx.store.applications.get(conversation.applicationId) ?? null) : null,
    };
    return json(c, view);
  });
  api.post('/conversations/:id/messages', async (c) => {
    if (!ctx.store.conversations.get(c.req.param('id'))) throw notFound('Conversation');
    return json(c, await ctx.actions.sendMessage(c.req.param('id'), await body(c, SendMessageBody)));
  });
  api.post('/draft', async (c) => json(c, await ctx.actions.draft(await body(c, DraftBody))));

  api.get('/viewings', (c) => json(c, { items: ctx.store.viewings.list({ from: c.req.query('from') }) }));

  api.get('/sources', (c) => json(c, { items: ctx.sources() }));
  api.post('/notify/test', async (c) => json(c, await ctx.actions.notifyTest()));
  api.patch('/sources/:id', async (c) => json(c, await ctx.actions.patchSource(c.req.param('id'), await body(c, SourcePatchBody))));
  api.post('/sources/:id/test', async (c) => json(c, await ctx.actions.testSource(c.req.param('id'))));
  api.post('/sources/:id/connect', async (c) => {
    void ctx.actions.connectSource(c.req.param('id')).catch((e) => ctx.log.warn('connect failed', { source: c.req.param('id'), error: e }));
    return c.json({ started: true }, 202);
  });
  api.post('/sources/:id/poll', async (c) => (await ctx.actions.pollSource(c.req.param('id')), c.json({ queued: true }, 202)));

  api.get('/config', (c) => json(c, publicConfig(ctx)));
  api.patch('/config', async (c) => {
    const { section, value } = await body(c, ConfigPatchBody);
    ctx.updateConfig(section, value);
    return json(c, publicConfig(ctx));
  });

  api.get('/activity', (c) => {
    const since = Number(c.req.query('since') ?? 0);
    const types = c.req.query('types')?.split(',').filter(Boolean) as EventType[] | undefined;
    const items = since ? ctx.store.events.since(since, Number(c.req.query('limit') ?? 500)) : ctx.store.events.latest(Number(c.req.query('limit') ?? 200), types);
    return json(c, { items: types && since ? items.filter((e) => types.includes(e.type)) : items });
  });
  api.get('/events', (c) => sseHandler(c, ctx.store, ctx.bus));
  api.get('/stats', (c) => json(c, ctx.actions.stats()));

  api.get('/documents', (c) => json(c, { items: ctx.actions.listDocuments() }));
  api.post('/documents', async (c) => {
    const form = await c.req.parseBody();
    const file = form.file;
    if (!(file instanceof File)) throw new HttpError(400, 'invalid', 'Send the document as a multipart field named "file".');
    const sensitivity = String(form.sensitivity ?? 'private');
    if (!['public', 'private', 'identity'].includes(sensitivity)) throw new HttpError(400, 'invalid', 'sensitivity must be public, private or identity.');
    const doc = ctx.actions.saveDocument(file.name, sensitivity as 'public', String(form.kind ?? 'other'), new Uint8Array(await file.arrayBuffer()));
    return json(c, doc);
  });
  api.delete('/documents/:name', (c) => (ctx.actions.deleteDocument(c.req.param('name')), c.json({ deleted: true })));
  api.get('/profile.pdf', async (c) => {
    const pdf = await ctx.actions.tenantProfilePdf();
    return c.body(pdf as unknown as ArrayBuffer, 200, { 'content-type': 'application/pdf', 'content-disposition': 'inline; filename="tenant-profile.pdf"' });
  });
  api.get('/openapi.json', (c) => c.json(buildOpenApi(ctx.version)));

  app.route(API_PREFIX, api);

  app.get('/calendar.ics', (c) => {
    const viewings = ctx.store.viewings.list();
    const props = new Map<string, Property>();
    for (const v of viewings) {
      const p = ctx.store.properties.get(v.propertyId);
      if (p) props.set(p.id, p);
    }
    return c.body(renderIcs(viewings, props, new Date().toISOString()), 200, { 'content-type': 'text/calendar; charset=utf-8' });
  });

  /* ---------- the dashboard ---------- */
  const dir = ctx.dashboardDir;
  const serveIndex = (c: Context) => {
    const authed = getCookie(c, SESSION_COOKIE) === ctx.token;
    if (!authed || !dir || !existsSync(join(dir, 'index.html'))) {
      return c.html(authed ? LOCKED_PAGE.replace('The agent is running', 'The dashboard is not built').replace(/<p>.*<\/p>/, '<p>Run <code>npm run build -w @nlpf/dashboard</code>.</p>') : LOCKED_PAGE);
    }
    const html = readFileSync(join(dir, 'index.html'), 'utf8').replace(
      '</head>',
      `<script>window.__NLPF__=${JSON.stringify({ token: ctx.token, demo: ctx.demo, version: ctx.version, ...(process.env.NLPF_TILES === '0' ? { tiles: false } : {}) })}</script></head>`,
    );
    c.header('cache-control', 'no-store');
    return c.html(html);
  };
  app.get('*', (c) => {
    // `nlpf open` visits /?t=<token> once: set the session cookie and drop the
    // token from the address bar and history.
    const t = c.req.query('t');
    if (t) {
      if (t !== ctx.token) return c.html(LOCKED_PAGE, 401);
      setCookie(c, SESSION_COOKIE, ctx.token, { httpOnly: true, sameSite: 'Strict', path: '/', maxAge: 60 * 60 * 24 * 365 });
      return c.redirect(c.req.path);
    }
    if (dir && c.req.path !== '/' && !c.req.path.startsWith('/api/')) {
      const file = staticFile(dir, c.req.path);
      if (file) {
        c.header('content-type', MIME[extname(file)] ?? 'application/octet-stream');
        c.header('cache-control', c.req.path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
        return c.body(readFileSync(file) as unknown as ArrayBuffer);
      }
    }
    return serveIndex(c);
  });

  return app;
}
