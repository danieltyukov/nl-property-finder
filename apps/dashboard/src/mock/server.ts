/*
 * A stand-in daemon for building and demoing the dashboard without the real
 * one. It implements every route in ROUTES from the fixtures in memory, keeps
 * an SSE stream that "finds" a new listing every few seconds, and serves the
 * Vite build with the token injected the way the daemon does.
 *
 *   npm run build -w @nlpf/dashboard && npm run mock -w @nlpf/dashboard
 *
 * Environment: NLPF_MOCK_PORT (7432), NLPF_MOCK_TOKEN (mock-token),
 * NLPF_MOCK_EVERY_MS (6000, 0 turns the simulation off), NLPF_MOCK_FRESH=1
 * (empty profile, so the onboarding wizard shows), NLPF_MOCK_TILES=0 (no map
 * tiles, for offline tests). POST /_mock/reset?fresh=1 rebuilds the world.
 *
 * Node's http module only, so it adds no dependency.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EventType, Message, NlpfEvent, PropertyView, Task } from '@nlpf/core';
import { API_PREFIX, ROUTES } from '../core';
import { applicationsOf, buildWorld, LIVE_POOL, statusOf, type World } from './fixtures';

const PORT = Number(process.env.NLPF_MOCK_PORT ?? 7432);
const TOKEN = process.env.NLPF_MOCK_TOKEN ?? 'mock-token';
const EVERY = Number(process.env.NLPF_MOCK_EVERY_MS ?? 6000);
const DIST = fileURLToPath(new URL('../../dist/', import.meta.url));
const TILES = process.env.NLPF_MOCK_TILES === '0' ? false : undefined;

let world: World = buildWorld(Date.now(), { fresh: process.env.NLPF_MOCK_FRESH === '1' });
let lastId = Math.max(0, ...world.events.map((e) => e.id));
const clients = new Set<ServerResponse>();

/* ---------- events ---------- */

function emit(type: EventType, summary: string, data: Record<string, unknown> = {}): NlpfEvent {
  const event: NlpfEvent = { id: ++lastId, type, at: new Date().toISOString(), summary, data };
  world.events.unshift(event);
  world.events.length = Math.min(world.events.length, 1000);
  const frame = `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) res.write(frame);
  return event;
}

/* ---------- the simulation ---------- */

let tick = 0;
function simulate() {
  const seed = LIVE_POOL[tick % LIVE_POOL.length]!;
  const round = Math.floor(tick / LIVE_POOL.length);
  tick += 1;
  const now = Date.now();
  const id = `p_live_${tick}`;
  const number = String(Number(seed.number) + round * 2);
  const title = `${seed.street} ${number}`;
  const source = world.sources.find((s) => s.sourceId === seed.source);
  if (source) {
    source.lastRunAt = new Date(now).toISOString();
    source.lastOkAt = source.lastRunAt;
    source.nextRunAt = new Date(now + (source.intervalSec ?? 90) * 1000).toISOString();
    source.lastCount = 8 + (tick % 7);
  }
  const iso = new Date(now).toISOString();
  const view: PropertyView = {
    property: {
      id, key: `pc:${seed.postcode.replace(' ', '')}:${number}:`, title, priceEur: seed.price, sizeM2: seed.size, type: seed.type, createdAt: iso, updatedAt: iso,
      address: { street: seed.street, houseNumber: number, postcode: seed.postcode, city: seed.city, municipality: seed.city },
    },
    listings: [
      {
        id: `${seed.source}:${id}`, sourceId: seed.source, externalId: id, url: `https://example.nl/${id}`, title: `${title}, ${seed.city}`,
        priceEur: seed.price, priceBasis: 'excl', sizeM2: seed.size, type: seed.type, furnishing: 'upholstered', contact: 'form',
        address: { street: seed.street, houseNumber: number, postcode: seed.postcode, city: seed.city },
        description: 'Nieuw in de verhuur. Bezichtigingen op korte termijn mogelijk.', language: 'nl',
        propertyId: id, firstSeenAt: iso, lastSeenAt: iso, state: 'active', via: 'poll',
      },
    ],
    match: null, application: null, viewings: [], conversationIds: [],
  };
  world.properties.unshift(view);
  emit('source.polled', `Checked ${source?.name ?? seed.source}`, { sourceId: seed.source });
  emit('listing.new', `${source?.name ?? seed.source} · ${title}, ${seed.city} · €${seed.price.toLocaleString('en-GB')} · ${seed.size} m²`, { propertyId: id, sourceId: seed.source });

  const tooExpensive = seed.price > 1400 || tick % 4 === 0;
  setTimeout(() => {
    view.match = {
      propertyId: id, passed: !tooExpensive, failedRule: tooExpensive ? `rent €${seed.price + (tick % 4 === 0 ? 150 : 0)} above €1,400` : undefined,
      score: tooExpensive ? 0 : 60 + (tick * 7) % 30, reasons: tooExpensive ? [] : [`rent €${seed.price} within €1,400`, seed.city], requirements: {},
      scam: { level: 'none', signals: [] }, by: 'ai', evaluatedAt: new Date().toISOString(),
    };
    if (tooExpensive) {
      emit('property.rejected', `Skipped ${title}: ${view.match.failedRule}`, { propertyId: id });
      return;
    }
    emit('property.matched', `Matched ${title} · score ${view.match.score}`, { propertyId: id });
    const auto = source?.contactMode === 'auto' && source.health !== 'needs_login';
    if (world.paused || !auto) return;
    setTimeout(() => {
      const reactionMs = Date.now() - now;
      view.application = {
        id: `app_live_${tick}`, propertyId: id, status: 'contacted', firstSeenAt: iso, contactedAt: new Date().toISOString(), reactionMs,
        channel: { kind: 'form', sourceId: seed.source }, updatedAt: new Date().toISOString(),
      };
      emit('message.sent', `Sent to ${title} by ${source?.name ?? seed.source} form, ${Math.round(reactionMs / 1000)} s after it appeared`, {
        propertyId: id, rationale: 'Dutch listing, so Dutch. Led with your job and income, offered your viewing hours.',
      });
    }, 1800);
  }, 1500);

  // Now and then a landlord answers, which opens an inbox item.
  if (tick % 5 === 3) {
    setTimeout(() => {
      const target = world.properties.find((p) => p.application?.status === 'contacted' && p.property.id !== id);
      if (!target) return;
      const task: Task = {
        id: `t_live_${tick}`, kind: 'reply_needed', priority: 2, state: 'open', propertyId: target.property.id, applicationId: target.application?.id,
        title: `Question about your move-in date, ${target.property.title}`,
        reason: 'The agency asks whether you can start two weeks later. That is your call, so the agent drafted a yes for you to check.',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        payload: { draft: 'Beste heer, mevrouw,\n\nEen latere ingangsdatum is voor mij geen probleem.\n\nMet vriendelijke groet,\nSam de Vries', questions: ['Kunt u ook twee weken later beginnen?'] },
      };
      target.application!.status = 'replied';
      world.tasks.push(task);
      emit('message.received', `Reply about ${target.property.title}: a question about the move-in date`, { propertyId: target.property.id });
      emit('task.created', `Needs you: question about your move-in date for ${target.property.title}`, { propertyId: target.property.id, taskId: task.id });
    }, 3500);
  }
}

if (EVERY > 0) setInterval(simulate, EVERY);
setInterval(() => {
  for (const res of clients) res.write(': keep-alive\n\n');
}, 15_000);

/* ---------- helpers ---------- */

function send(res: ServerResponse, status: number, body: unknown) {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(json);
}

function fail(res: ServerResponse, status: number, code: string, message: string) {
  send(res, status, { error: { code, message } });
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  const raw = (await readBody(req)).toString('utf8');
  return (raw ? JSON.parse(raw) : {}) as T;
}

/** Just enough multipart parsing for the document upload. */
function parseMultipart(body: Buffer, contentType: string): Record<string, { value?: string; filename?: string; size?: number }> {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType);
  const marker = Buffer.from(`--${boundary?.[1] ?? boundary?.[2] ?? ''}`);
  const out: Record<string, { value?: string; filename?: string; size?: number }> = {};
  let start = body.indexOf(marker);
  while (start !== -1) {
    const next = body.indexOf(marker, start + marker.length);
    if (next === -1) break;
    const part = body.subarray(start + marker.length + 2, next - 2);
    const split = part.indexOf('\r\n\r\n');
    if (split !== -1) {
      const headers = part.subarray(0, split).toString('utf8');
      const content = part.subarray(split + 4);
      const name = /name="([^"]*)"/.exec(headers)?.[1];
      const filename = /filename="([^"]*)"/.exec(headers)?.[1];
      if (name) out[name] = filename !== undefined ? { filename, size: content.length } : { value: content.toString('utf8') };
    }
    start = next;
  }
  return out;
}

/** A one-page PDF built by hand, so the preview works without a PDF library. */
function tenantPdf(): Buffer {
  const p = world.config.profile;
  const lines = [
    `${p.firstName} ${p.lastName}`.trim() || 'Tenant profile',
    `${p.occupation === 'phd' ? 'PhD candidate' : p.occupation} at ${p.organisation ?? 'unknown'}`,
    p.incomeMonthlyGrossEur ? `Gross income EUR ${p.incomeMonthlyGrossEur} a month` : '',
    p.moveInFrom ? `Can move in from ${p.moveInFrom}` : '',
    'Sample from the mock server.',
  ].filter(Boolean);
  const text = lines.map((l, i) => `BT /F1 ${i === 0 ? 22 : 12} Tf 72 ${760 - i * 28} Td (${l.replace(/[()\\]/g, '')}) Tj ET`).join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

function ics(): string {
  const stamp = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const events = world.viewings
    .filter((v) => v.state === 'booked')
    .map((v) =>
      [
        'BEGIN:VEVENT',
        `UID:${v.id}@nl-property-finder`,
        `DTSTAMP:${stamp(new Date().toISOString())}`,
        `DTSTART:${stamp(v.startsAt)}`,
        `DTEND:${stamp(v.endsAt)}`,
        `SUMMARY:Viewing ${(v.location ?? '').replace(/,/g, '\\,')}`,
        `LOCATION:${(v.location ?? '').replace(/,/g, '\\,')}`,
        'END:VEVENT',
      ].join('\r\n'),
    );
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//nl-property-finder//mock//EN', ...events, 'END:VCALENDAR', ''].join('\r\n');
}

const routeTable = Object.entries(ROUTES).map(([name, route]) => ({
  name: name as keyof typeof ROUTES,
  method: route.method,
  pattern: new RegExp(`^${route.path.replace(/:[a-zA-Z]+/g, '([^/]+)')}$`),
  keys: [...route.path.matchAll(/:([a-zA-Z]+)/g)].map((m) => m[1]!),
}));

function findProperty(id: string) {
  return world.properties.find((p) => p.property.id === id);
}

/* ---------- API ---------- */

async function api(req: IncomingMessage, res: ServerResponse, url: URL) {
  const path = url.pathname.slice(API_PREFIX.length) || '/';
  const hit = routeTable.find((r) => r.method === req.method && r.pattern.test(path));
  if (!hit) return fail(res, 404, 'not_found', `No route for ${req.method} ${path}`);
  const match = hit.pattern.exec(path)!;
  const params = Object.fromEntries(hit.keys.map((k, i) => [k, decodeURIComponent(match[i + 1] ?? '')]));
  const tokenOk = req.headers['x-nlpf-token'] === TOKEN || (hit.name === 'events' && url.searchParams.get('token') === TOKEN);
  if (!tokenOk) return fail(res, 401, 'unauthorized', 'Missing or wrong X-NLPF-Token.');
  const now = Date.now();

  switch (hit.name) {
    case 'status':
      return send(res, 200, statusOf(world, now));
    case 'pause':
    case 'resume': {
      world.paused = hit.name === 'pause';
      world.config.automation.paused = world.paused;
      emit(world.paused ? 'automation.paused' : 'automation.resumed', world.paused ? 'Automation paused. Sources are still read.' : 'Automation resumed.');
      return send(res, 200, statusOf(world, now));
    }
    case 'properties': {
      const q = (url.searchParams.get('q') ?? '').toLowerCase();
      const limit = Number(url.searchParams.get('limit') ?? 200);
      const items = world.properties.filter((p) => !q || JSON.stringify(p.property).toLowerCase().includes(q)).slice(0, limit);
      return send(res, 200, { items });
    }
    case 'property': {
      const p = findProperty(params.id!);
      return p ? send(res, 200, p) : fail(res, 404, 'not_found', 'No such property.');
    }
    case 'contactProperty': {
      const p = findProperty(params.id!);
      if (!p) return fail(res, 404, 'not_found', 'No such property.');
      p.application = {
        id: `app_${p.property.id}`, propertyId: p.property.id, status: 'contacted', firstSeenAt: p.property.createdAt, contactedAt: new Date(now).toISOString(),
        reactionMs: now - Date.parse(p.property.createdAt), channel: { kind: 'form', sourceId: p.listings[0]?.sourceId }, updatedAt: new Date(now).toISOString(),
      };
      emit('message.sent', `Sent to ${p.property.title} because you asked`, { propertyId: p.property.id });
      return send(res, 202, { ok: true });
    }
    case 'skipProperty': {
      const p = findProperty(params.id!);
      if (!p) return fail(res, 404, 'not_found', 'No such property.');
      p.application = { id: `app_${p.property.id}`, propertyId: p.property.id, status: 'skipped', firstSeenAt: p.property.createdAt, updatedAt: new Date(now).toISOString() };
      emit('application.updated', `Skipped ${p.property.title} by hand`, { propertyId: p.property.id });
      return send(res, 200, { ok: true });
    }
    case 'applications':
      return send(res, 200, { items: applicationsOf(world) });
    case 'withdrawAll': {
      const body = await readJson<{ foundAddress?: string; message?: string; pause?: boolean }>(req);
      const found = (body.foundAddress ?? '').toLowerCase();
      let count = 0;
      for (const p of world.properties) {
        const app = p.application;
        if (!app || !['queued', 'contacted', 'replied', 'viewing_proposed', 'viewing_booked', 'viewed', 'offer'].includes(app.status)) continue;
        if (found && found.includes(`${p.property.address.street} ${p.property.address.houseNumber}`.toLowerCase())) continue;
        app.status = 'withdrawn';
        app.updatedAt = new Date(now).toISOString();
        count += 1;
      }
      if (body.pause !== false) {
        world.paused = true;
        world.config.automation.paused = true;
        emit('automation.paused', 'Automation paused after I found a place.');
      }
      emit('applications.withdrawn', `Withdrew ${count} applications${body.foundAddress ? `, kept ${body.foundAddress}` : ''}`);
      return send(res, 200, { withdrawn: count });
    }
    case 'tasks': {
      const state = url.searchParams.get('state') ?? 'open';
      return send(res, 200, { items: world.tasks.filter((t) => state === 'all' || t.state === state) });
    }
    case 'resolveTask': {
      const task = world.tasks.find((t) => t.id === params.id);
      if (!task) return fail(res, 404, 'not_found', 'No such task.');
      const body = await readJson<{ action: string; draft?: string; until?: string; slot?: number }>(req);
      task.state = body.action === 'snooze' ? 'snoozed' : body.action === 'dismiss' ? 'dismissed' : 'done';
      task.snoozedUntil = body.until;
      task.updatedAt = new Date(now).toISOString();
      task.resolvedBy = 'human';
      if ((body.action === 'send_draft' || body.action === 'approve') && task.conversationId) {
        const text = body.draft ?? (typeof task.payload?.draft === 'string' ? task.payload.draft : undefined);
        if (text) {
          const message: Message = { id: `m_${now}`, conversationId: task.conversationId, direction: 'out', author: 'human', channel: 'email', body: text, at: new Date(now).toISOString(), status: 'sent' };
          world.messages.push(message);
          emit('message.sent', `You answered about ${findProperty(task.propertyId ?? '')?.property.title ?? 'a listing'}`, { propertyId: task.propertyId, conversationId: task.conversationId });
        }
      }
      emit('task.updated', `${task.title}: ${body.action}`, { taskId: task.id });
      return send(res, 200, task);
    }
    case 'conversations':
      return send(res, 200, { items: world.conversations });
    case 'conversation': {
      const c = world.conversations.find((x) => x.id === params.id);
      if (!c) return fail(res, 404, 'not_found', 'No such conversation.');
      c.unread = 0;
      const p = c.propertyId ? findProperty(c.propertyId) : undefined;
      return send(res, 200, { conversation: c, messages: world.messages.filter((m) => m.conversationId === c.id), property: p?.property ?? null, application: p?.application ?? null });
    }
    case 'sendMessage': {
      const c = world.conversations.find((x) => x.id === params.id);
      if (!c) return fail(res, 404, 'not_found', 'No such conversation.');
      const body = await readJson<{ body: string; subject?: string }>(req);
      if (!body.body?.trim()) return fail(res, 400, 'invalid_body', 'The message is empty.');
      const message: Message = { id: `m_${now}`, conversationId: c.id, direction: 'out', author: 'human', channel: 'email', subject: body.subject, body: body.body, at: new Date(now).toISOString(), status: 'sent' };
      world.messages.push(message);
      c.lastMessageAt = message.at;
      emit('message.sent', `You wrote to ${c.counterpart.name ?? c.counterpart.email ?? 'a landlord'}`, { conversationId: c.id, propertyId: c.propertyId });
      return send(res, 201, message);
    }
    case 'draft': {
      const body = await readJson<{ conversationId?: string; instructions?: string }>(req);
      const c = world.conversations.find((x) => x.id === body.conversationId);
      const name = c?.counterpart.name?.split(',')[0] ?? 'heer, mevrouw';
      const text = `Beste ${name},\n\nDank voor uw bericht. ${body.instructions ? `${body.instructions.charAt(0).toUpperCase()}${body.instructions.slice(1)}.` : 'Ik kom graag langs voor een bezichtiging op een moment dat u uitkomt.'}\n\nMet vriendelijke groet,\n${world.config.profile.firstName} ${world.config.profile.lastName}`.trim();
      return send(res, 200, { body: text, rationale: 'Dutch, because the conversation is in Dutch. Kept to what your profile says.' });
    }
    case 'viewings':
      return send(res, 200, { items: world.viewings });
    case 'sources':
      return send(res, 200, { items: world.sources.map((s) => ({ ...s, config: world.config.sources[s.sourceId] })) });
    case 'patchSource': {
      const s = world.sources.find((x) => x.sourceId === params.id);
      if (!s) return fail(res, 404, 'not_found', 'No such source.');
      const body = await readJson<{ enabled?: boolean; contact?: 'auto' | 'watch_only'; paidPlan?: string | null; intervalSec?: number }>(req);
      const cfg = { ...(world.config.sources[s.sourceId] ?? { enabled: true, searchUrls: [], options: {} }) };
      if (body.enabled !== undefined) {
        s.enabled = body.enabled;
        cfg.enabled = body.enabled;
        s.health = body.enabled ? (s.contactMode === 'watch_only' ? 'watch_only' : 'ok') : 'disabled';
      }
      if (body.contact) {
        s.contactMode = body.contact;
        cfg.contact = body.contact;
        if (s.enabled && (s.health === 'ok' || s.health === 'watch_only')) s.health = body.contact === 'auto' ? 'ok' : 'watch_only';
      }
      if (body.paidPlan !== undefined) cfg.paidPlan = body.paidPlan ?? undefined;
      if (body.intervalSec) s.intervalSec = body.intervalSec;
      world.config.sources[s.sourceId] = cfg;
      emit('config.updated', `${s.name} settings changed`, { sourceId: s.sourceId });
      return send(res, 200, s);
    }
    case 'testSource': {
      const s = world.sources.find((x) => x.sourceId === params.id);
      if (!s) return fail(res, 404, 'not_found', 'No such source.');
      await new Promise((r) => setTimeout(r, 700));
      if (s.health === 'needs_login') return send(res, 200, { ok: false, error: 'The session expired. Reconnect first.', ms: 3100 });
      if (s.health === 'down') return send(res, 200, { ok: false, error: '429 Too Many Requests', ms: 12000 });
      const sample = world.properties.filter((p) => p.listings.some((l) => l.sourceId === s.sourceId)).slice(0, 3);
      return send(res, 200, { ok: true, count: s.lastCount ?? sample.length, ms: s.lastLatencyMs ?? 800, sample: sample.map((p) => ({ title: p.listings[0]!.title, url: p.listings[0]!.url, priceEur: p.property.priceEur })) });
    }
    case 'connectSource': {
      const s = world.sources.find((x) => x.sourceId === params.id);
      if (!s) return fail(res, 404, 'not_found', 'No such source.');
      setTimeout(() => {
        s.health = s.contactMode === 'watch_only' ? 'watch_only' : 'ok';
        s.lastError = undefined;
        s.consecutiveFailures = 0;
        const reconnect = world.tasks.find((t) => t.kind === 'reconnect' && t.sourceId === s.sourceId && t.state === 'open');
        if (reconnect) {
          reconnect.state = 'done';
          reconnect.resolvedBy = 'agent';
        }
        emit('source.health', `${s.name} session works again`, { sourceId: s.sourceId, health: s.health });
      }, 4000);
      return send(res, 202, { started: true });
    }
    case 'pollSource': {
      const s = world.sources.find((x) => x.sourceId === params.id);
      if (!s) return fail(res, 404, 'not_found', 'No such source.');
      s.lastRunAt = new Date(now).toISOString();
      emit('source.polled', `Checked ${s.name} by hand`, { sourceId: s.sourceId });
      return send(res, 202, { started: true });
    }
    case 'config':
      return send(res, 200, world.config);
    case 'patchConfig': {
      const body = await readJson<{ section: keyof World['config']; value: unknown }>(req);
      if (!body.section || !(body.section in world.config)) return fail(res, 400, 'invalid_section', 'Unknown config section.');
      (world.config as unknown as Record<string, unknown>)[body.section] = body.value;
      if (body.section === 'sources') {
        for (const s of world.sources) {
          const cfg = world.config.sources[s.sourceId];
          if (!cfg) continue;
          if (cfg.enabled !== undefined) s.enabled = cfg.enabled;
          if (cfg.contact) s.contactMode = cfg.contact;
          if (!s.enabled) s.health = 'disabled';
          else if (s.health === 'disabled' || s.health === 'watch_only' || s.health === 'ok') s.health = s.contactMode === 'auto' ? 'ok' : 'watch_only';
        }
      }
      if (body.section === 'automation') world.paused = world.config.automation.paused;
      emit('config.updated', `Config section ${body.section} saved`, { section: body.section });
      return send(res, 200, world.config);
    }
    case 'activity': {
      const limit = Number(url.searchParams.get('limit') ?? 100);
      const types = url.searchParams.get('types')?.split(',').filter(Boolean);
      return send(res, 200, { items: world.events.filter((e) => !types || types.includes(e.type)).slice(0, limit) });
    }
    case 'events': {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write('retry: 3000\n\n');
      const since = Number(req.headers['last-event-id'] ?? 0);
      if (since) {
        for (const e of [...world.events].reverse().filter((x) => x.id > since)) res.write(`id: ${e.id}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
      }
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    case 'stats':
      return send(res, 200, world.stats);
    case 'documents':
      return send(res, 200, { items: world.documents });
    case 'uploadDocument': {
      const parts = parseMultipart(await readBody(req), String(req.headers['content-type'] ?? ''));
      const file = parts.file;
      if (!file?.filename) return fail(res, 400, 'no_file', 'No file in the upload.');
      const sensitivity = (parts.sensitivity?.value ?? 'private') as 'public' | 'private' | 'identity';
      world.documents = world.documents.filter((d) => d.name !== file.filename);
      world.documents.push({ name: file.filename, sensitivity, kind: parts.kind?.value, size: file.size, addedAt: new Date(now).toISOString() });
      return send(res, 201, { ok: true });
    }
    case 'deleteDocument':
      world.documents = world.documents.filter((d) => d.name !== params.name);
      return send(res, 200, { ok: true });
    case 'tenantProfilePdf': {
      const pdf = tenantPdf();
      res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': pdf.length });
      return res.end(pdf);
    }
    case 'openapi':
      return send(res, 200, {
        openapi: '3.1.0',
        info: { title: 'nl-property-finder (mock)', version: '0.1.0' },
        paths: Object.fromEntries(Object.values(ROUTES).map((r) => [`${API_PREFIX}${r.path.replace(/:([a-zA-Z]+)/g, '{$1}')}`, { [r.method.toLowerCase()]: { responses: { 200: { description: 'OK' } } } }])),
      });
    default:
      return fail(res, 501, 'not_implemented', `${hit.name} is not in the mock.`);
  }
}

/* ---------- static files ---------- */

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
};

async function serveStatic(res: ServerResponse, pathname: string) {
  const clean = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(DIST, clean);
  if (!file.startsWith(DIST)) return fail(res, 403, 'forbidden', 'Outside the build folder.');
  try {
    const info = await stat(file);
    if (info.isDirectory()) file = join(file, 'index.html');
  } catch {
    file = join(DIST, 'index.html');
  }
  let data: Buffer;
  try {
    data = await readFile(file);
  } catch {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('The dashboard is not built yet. Run: npm run build -w @nlpf/dashboard\n');
  }
  const ext = extname(file);
  if (ext === '.html') {
    const inject = `<script>window.__NLPF__ = ${JSON.stringify({ token: TOKEN, ...(TILES === false ? { tiles: false } : {}) })};</script>`;
    data = Buffer.from(data.toString('utf8').replace('</head>', `${inject}</head>`));
    res.writeHead(200, { 'Content-Type': TYPES[ext]!, 'Cache-Control': 'no-store' });
    return res.end(data);
  }
  res.writeHead(200, { 'Content-Type': TYPES[ext] ?? 'application/octet-stream', 'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' });
  res.end(data);
}

/* ---------- server ---------- */

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
  void (async () => {
    try {
      if (url.pathname.startsWith(API_PREFIX)) return await api(req, res, url);
      if (url.pathname === '/calendar.ics') {
        if (url.searchParams.get('token') !== TOKEN) return fail(res, 401, 'unauthorized', 'Missing or wrong token.');
        res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8' });
        return res.end(ics());
      }
      if (url.pathname === '/_mock/reset' && req.method === 'POST') {
        world = buildWorld(Date.now(), { fresh: url.searchParams.get('fresh') === '1' });
        lastId = Math.max(0, ...world.events.map((e) => e.id));
        tick = 0;
        return send(res, 200, { ok: true, fresh: url.searchParams.get('fresh') === '1' });
      }
      return await serveStatic(res, url.pathname);
    } catch (error) {
      if (!res.headersSent) fail(res, 500, 'mock_error', error instanceof Error ? error.message : String(error));
      else res.end();
    }
  })();
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`nlpf mock daemon on http://127.0.0.1:${PORT}/ (token ${TOKEN}, ${EVERY ? `a new listing every ${EVERY / 1000} s` : 'simulation off'})`);
});

