import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { SandboxCore } from './core.js';
import {
  huisjeContactDone,
  huisjeDetail,
  huisjeHome,
  huisjeLogin,
  huisjeMessages,
  huisjeNotFound,
} from './pages/huisje.js';
import type { SandboxAttachment, SandboxListing, ThreadMessage } from './types.js';

/*
 * Huisje: a fake rental platform with a JSON search API that filters on the
 * server, listing pages, a cookie login, a contact form and platform
 * messaging. `setLoginRequired` puts the contact form and the inbox behind
 * the login; `setBlocked` answers every Huisje request with HTTP 429.
 */

export const HUISJE_COOKIE = 'huisje_session';

/** The listing as the search API returns it. */
export function huisjeItem(l: SandboxListing, base: string) {
  return {
    id: l.id,
    url: `${base}/huisje/listing/${l.id}`,
    title: l.title,
    address: {
      street: l.street,
      houseNumber: l.houseNumber,
      addition: l.addition ?? null,
      postcode: l.postcode,
      city: l.city,
      lat: l.lat,
      lon: l.lon,
      display: l.addressText,
    },
    price: {
      amount: l.priceEur,
      basis: l.priceBasis,
      serviceCosts: l.serviceCostsEur ?? null,
      deposit: l.depositEur ?? null,
    },
    size: l.sizeM2,
    rooms: l.rooms,
    bedrooms: l.bedrooms,
    type: l.type,
    furnishing: l.furnishing,
    energyLabel: l.energyLabel ?? null,
    availableFrom: l.availableFrom,
    publishedAt: l.publishedAt,
    language: l.language,
    status: l.status,
    description: l.description,
    images: [`${base}/media/${l.id}/1.svg`, `${base}/media/${l.id}/2.svg`],
    landlord: { name: l.landlord.name, kind: l.landlord.kind, email: l.landlord.email },
  };
}

export type HuisjeItem = ReturnType<typeof huisjeItem>;

function attachmentJson(a: SandboxAttachment, base: string) {
  let data: string | undefined;
  try {
    data = readFileSync(a.path).toString('base64');
  } catch {
    data = undefined;
  }
  return {
    id: a.id,
    filename: a.filename,
    contentType: a.contentType,
    size: a.size,
    url: `${base}/huisje/api/attachments/${a.id}`,
    data,
  };
}

export function messageJson(
  m: ThreadMessage,
  threadId: string,
  listingId: string | null,
  base: string,
  from: { name: string; kind: string },
) {
  return {
    id: m.id,
    threadId,
    listingId,
    from: m.from === 'landlord' ? from : { name: 'you', kind: 'applicant' },
    subject: m.subject,
    text: m.text,
    at: m.at,
    attachments: m.attachments.map((a) => attachmentJson(a, base)),
  };
}

const num = (v: string | undefined) => {
  if (v === undefined || v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

export function huisjeRoutes(core: SandboxCore): Hono {
  const app = new Hono({ strict: false });
  const base = () => core.url;

  const session = (c: Context): string | undefined => {
    const token = getCookie(c, HUISJE_COOKIE);
    return token ? core.state.sessions.get(token) : undefined;
  };
  const wantsJson = (c: Context) =>
    (c.req.header('accept') ?? '').includes('application/json') ||
    (c.req.header('content-type') ?? '').includes('application/json');
  const loginNeeded = (c: Context) =>
    c.json(
      { error: 'login_required', message: 'Log in on Huisje first.', loginUrl: `${base()}/huisje/login` },
      401,
    );

  app.use('*', async (c, next) => {
    const b = core.state.blocked.huisje;
    if (b.on) {
      if (b.retryAfterSec !== undefined) c.header('Retry-After', String(b.retryAfterSec));
      return c.text('Too many requests. Please try again later.', 429);
    }
    await next();
  });

  /* ---------- pages ---------- */

  app.get('/', (c) => {
    const city = c.req.query('city')?.toLowerCase() || undefined;
    const priceMax = num(c.req.query('priceMax'));
    const listings = core.world
      .listings({ source: 'huisje' })
      .filter(
        (l) =>
          l.status === 'available' &&
          (!city || l.city.toLowerCase() === city) &&
          (priceMax === undefined || l.priceEur <= priceMax),
      );
    return c.html(huisjeHome(listings, { city, priceMax: c.req.query('priceMax') }, Boolean(session(c))));
  });

  app.get('/listing/:id', (c) => {
    const l = core.world.listing(c.req.param('id'));
    if (!l || l.removed || l.source !== 'huisje') return c.html(huisjeNotFound(), 404);
    return c.html(
      huisjeDetail(l, { loggedIn: Boolean(session(c)), loginRequired: core.state.loginRequired }),
    );
  });

  app.get('/login', (c) => c.html(huisjeLogin(c.req.query('next') ?? '/huisje/')));

  app.post('/login', async (c) => {
    const json = wantsJson(c);
    const body: Record<string, unknown> = json
      ? await c.req.json().catch(() => ({}))
      : await c.req.parseBody();
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!email || !password) {
      return json
        ? c.json({ error: 'invalid_credentials' }, 400)
        : c.html(huisjeLogin(String(body.next ?? '/huisje/'), 'Vul je e-mailadres en wachtwoord in.'), 400);
    }
    const token = randomBytes(16).toString('hex');
    core.state.sessions.set(token, email);
    setCookie(c, HUISJE_COOKIE, token, { path: '/huisje', httpOnly: true, sameSite: 'Lax' });
    if (json) return c.json({ ok: true, email });
    const next = String(body.next ?? '/huisje/');
    return c.redirect(next.startsWith('/huisje') ? next : '/huisje/');
  });

  app.get('/uitloggen', (c) => {
    const token = getCookie(c, HUISJE_COOKIE);
    if (token) core.state.sessions.delete(token);
    deleteCookie(c, HUISJE_COOKIE, { path: '/huisje' });
    return c.redirect('/huisje/');
  });

  app.get('/berichten', (c) => {
    if (core.state.loginRequired && !session(c)) return c.redirect('/huisje/login?next=/huisje/berichten');
    const subs = core.world.submissions().filter((s) => s.source === 'huisje');
    return c.html(huisjeMessages(subs, Boolean(session(c))));
  });

  /** The contact form. JSON in and out for the adapter, a form post and a thank-you page for people. */
  app.post('/listing/:id/contact', async (c) => {
    const json = wantsJson(c);
    const l = core.world.listing(c.req.param('id'));
    if (!l || l.removed || l.source !== 'huisje') {
      return json
        ? c.json({ error: 'not_found', message: 'This listing is no longer online.' }, 404)
        : c.html(huisjeNotFound(), 404);
    }
    const email = session(c);
    if (core.state.loginRequired && !email) {
      return json
        ? loginNeeded(c)
        : c.redirect(`/huisje/login?next=${encodeURIComponent(`/huisje/listing/${l.id}`)}`);
    }
    if (l.status !== 'available') {
      return json
        ? c.json({ error: 'not_available', message: `This home is ${l.status}.` }, 409)
        : c.html(huisjeNotFound(), 409);
    }
    const body: Record<string, unknown> = json
      ? await c.req.json().catch(() => ({}))
      : await c.req.parseBody();
    const text = (k: string) => (typeof body[k] === 'string' ? (body[k] as string).trim() : '');
    const message = text('message');
    if (!message)
      return json
        ? c.json({ error: 'invalid', message: 'The message is empty.' }, 400)
        : c.html(huisjeDetail(l, { loggedIn: Boolean(email), loginRequired: core.state.loginRequired }), 400);
    const sub = core.submit({
      source: 'huisje',
      listing: l,
      channel: 'form',
      name: text('name'),
      email: text('email') || email || '',
      phone: text('phone') || undefined,
      subject: text('subject') || undefined,
      message,
    });
    const confirmation = `Bedankt! Je bericht is doorgestuurd naar ${l.landlord.name}.`;
    return json
      ? c.json({ ok: true, submissionId: sub.id, threadId: sub.threadId, confirmation })
      : c.html(huisjeContactDone(l, sub));
  });

  /* ---------- API ---------- */

  app.get('/api/search', (c) => {
    const q = (k: string) => c.req.query(k);
    const cities = (q('city') ?? '')
      .split(',')
      .map((s) =>
        s
          .trim()
          .toLowerCase()
          .replace(/^'s-gravenhage$/, 'den haag'),
      )
      .filter(Boolean);
    const types = (q('type') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const priceMin = num(q('priceMin'));
    const priceMax = num(q('priceMax'));
    const sizeMin = num(q('sizeMin'));
    const roomsMin = num(q('roomsMin'));
    const page = Math.max(1, Math.floor(num(q('page')) ?? 1));
    const pageSize = Math.min(50, Math.max(1, Math.floor(num(q('pageSize')) ?? 20)));
    const matches = core.world
      .listings({ source: 'huisje' })
      .filter(
        (l) =>
          (!cities.length || cities.includes(l.city.toLowerCase())) &&
          (!types.length || types.includes(l.type)) &&
          (priceMin === undefined || l.priceEur >= priceMin) &&
          (priceMax === undefined || l.priceEur <= priceMax) &&
          (sizeMin === undefined || l.sizeM2 >= sizeMin) &&
          (roomsMin === undefined || l.rooms >= roomsMin),
      );
    const items = matches.slice((page - 1) * pageSize, page * pageSize).map((l) => huisjeItem(l, base()));
    return c.json({
      items,
      page,
      pageSize,
      total: matches.length,
      pages: Math.max(1, Math.ceil(matches.length / pageSize)),
    });
  });

  app.get('/api/listings/:id', (c) => {
    const l = core.world.listing(c.req.param('id'));
    if (!l || l.removed || l.source !== 'huisje') return c.json({ error: 'not_found' }, 404);
    return c.json(huisjeItem(l, base()));
  });

  app.post('/api/login', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    if (!email || typeof body.password !== 'string' || !body.password)
      return c.json({ error: 'invalid_credentials' }, 400);
    const token = randomBytes(16).toString('hex');
    core.state.sessions.set(token, email);
    setCookie(c, HUISJE_COOKIE, token, { path: '/huisje', httpOnly: true, sameSite: 'Lax' });
    return c.json({ ok: true, email });
  });

  app.get('/api/me', (c) => {
    const email = session(c);
    return email ? c.json({ email }) : c.json({ error: 'not_logged_in' }, 401);
  });

  app.get('/api/inbox', (c) => {
    if (core.state.loginRequired && !session(c)) return loginNeeded(c);
    const since = c.req.query('since');
    const sinceMs = since ? Date.parse(since) : NaN;
    const messages = core.world
      .submissions()
      .filter((s) => s.source === 'huisje')
      .flatMap((s) =>
        s.messages
          .filter(
            (m) =>
              m.from === 'landlord' &&
              m.channel === 'platform' &&
              (Number.isNaN(sinceMs) || Date.parse(m.at) >= sinceMs),
          )
          .map((m) => messageJson(m, s.threadId, s.listingId, base(), s.landlord)),
      )
      .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id, 'en', { numeric: true }));
    return c.json({ messages });
  });

  app.get('/api/threads', (c) => {
    if (core.state.loginRequired && !session(c)) return loginNeeded(c);
    const threads = core.world
      .submissions()
      .filter((s) => s.source === 'huisje')
      .map((s) => ({
        id: s.threadId,
        listingId: s.listingId,
        landlord: s.landlord.name,
        messages: s.messages.length,
        lastAt: s.messages.at(-1)?.at ?? s.at,
      }));
    return c.json({ threads });
  });

  app.get('/api/threads/:id', (c) => {
    if (core.state.loginRequired && !session(c)) return loginNeeded(c);
    const s = core.world.submissionByThread(c.req.param('id'));
    if (!s || s.source !== 'huisje') return c.json({ error: 'not_found' }, 404);
    return c.json({
      id: s.threadId,
      listingId: s.listingId,
      messages: s.messages.map((m) => messageJson(m, s.threadId, s.listingId, base(), s.landlord)),
    });
  });

  app.post('/api/threads/:id/reply', async (c) => {
    if (core.state.loginRequired && !session(c)) return loginNeeded(c);
    const s = core.world.submissionByThread(c.req.param('id'));
    if (!s || s.source !== 'huisje') return c.json({ error: 'not_found' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as {
      body?: unknown;
      subject?: unknown;
      attachments?: { filename?: unknown; contentType?: unknown; data?: unknown }[];
    };
    if (typeof body.body !== 'string' || !body.body.trim())
      return c.json({ error: 'invalid', message: 'The message is empty.' }, 400);
    const attachments = (Array.isArray(body.attachments) ? body.attachments : [])
      .filter((a) => typeof a.filename === 'string' && typeof a.data === 'string')
      .map((a) =>
        core.files.save(
          a.filename as string,
          typeof a.contentType === 'string' ? a.contentType : 'application/octet-stream',
          Buffer.from(a.data as string, 'base64'),
        ),
      );
    const msg = core.agentMessage(s, {
      channel: 'platform',
      subject: typeof body.subject === 'string' ? body.subject : '',
      text: body.body,
      attachments,
    });
    return c.json({ ok: true, id: msg.id, threadId: s.threadId });
  });

  app.get('/api/attachments/:id', (c) => {
    const id = c.req.param('id');
    const found = core.world
      .submissions()
      .flatMap((s) => s.messages.flatMap((m) => m.attachments))
      .find((a) => a.id === id);
    if (!found) return c.json({ error: 'not_found' }, 404);
    try {
      const data = new Uint8Array(readFileSync(found.path));
      return c.body(data, 200, {
        'content-type': found.contentType,
        'content-disposition': `attachment; filename="${found.filename}"`,
      });
    } catch {
      return c.json({ error: 'not_found' }, 404);
    }
  });

  return app;
}
