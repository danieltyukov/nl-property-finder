import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type {
  ContactResult,
  FetchResult,
  InboundMessage,
  Listing,
  OutboundMessage,
  RawListing,
  SearchRequest,
  SourceAdapter,
  SourceContext,
} from '@nlpf/core';
import { NeedsLoginError, SourceHttpError } from '@nlpf/sources';
import type { HuisjeItem } from './platform.js';

export interface HuisjeAdapterOptions {
  /** Where attachments from Huisje messages are saved. Default: `nlpf-huisje` in the system temp folder. */
  attachmentsDir?: string;
  /** Default 60. The daemon may poll faster in demo mode. */
  intervalSec?: number;
  /** Result pages to read per search. Default 3. */
  maxPages?: number;
}

interface InboxMessage {
  id: string;
  threadId: string;
  listingId: string | null;
  from: { name: string; kind: string };
  subject: string;
  text: string;
  at: string;
  attachments: {
    id: string;
    filename: string;
    contentType: string;
    size: number;
    url: string;
    data?: string;
  }[];
}

const COOKIE = 'huisje_session';
const JSON_HEADERS = { accept: 'application/json', 'content-type': 'application/json' };

/**
 * The adapter for Huisje, the sandbox's fake platform. It is a complete
 * `SourceAdapter`: JSON search with the filters applied by the platform,
 * detail, contact through the platform's form, the platform inbox, replies in
 * a thread, session checks and an availability check.
 *
 * Logging in: with `sources.huisje.options.email` and `.password` in the
 * config the adapter logs in by itself (the sandbox accepts any pair) and
 * keeps the session cookie. Without them it works as a guest, and when the
 * platform demands a login (`control.setLoginRequired(true)`) it throws
 * `NeedsLoginError`.
 *
 * `ContactResult.externalId` is the platform thread id ("th-1"); inbound
 * messages carry the same `threadId` and `sourceId: 'huisje'`.
 */
export function huisjeAdapter(baseUrl: string, opts: HuisjeAdapterOptions = {}): SourceAdapter {
  const base = baseUrl.replace(/\/+$/, '');
  const loginUrl = `${base}/huisje/login`;
  const attachmentsDir = opts.attachmentsDir ?? join(tmpdir(), 'nlpf-huisje');
  let cookie: string | undefined;

  const credentials = (ctx: SourceContext) => {
    const o = ctx.source.options ?? {};
    return typeof o.email === 'string' && typeof o.password === 'string' && o.email && o.password
      ? { email: o.email, password: o.password }
      : undefined;
  };

  const headers = (extra: Record<string, string> = {}) =>
    cookie ? { ...extra, cookie: `${COOKIE}=${cookie}` } : extra;

  async function login(ctx: SourceContext): Promise<boolean> {
    const creds = credentials(ctx);
    if (!creds) return false;
    const res = await ctx.fetch(`${base}/huisje/api/login`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(creds),
    });
    const set = res.headers.getSetCookie?.() ?? [res.headers.get('set-cookie') ?? ''];
    const token = set.map((c) => new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(c)?.[1]).find(Boolean);
    cookie = token;
    return Boolean(token);
  }

  /** Runs a request; on a 401 logs in once (when credentials exist) and retries, else throws NeedsLoginError. */
  async function authed(ctx: SourceContext, run: () => Promise<FetchResult>): Promise<FetchResult> {
    if (!cookie && credentials(ctx)) await login(ctx);
    try {
      return await run();
    } catch (e) {
      if (!(e instanceof SourceHttpError) || e.status !== 401) throw e;
      if (credentials(ctx) && (await login(ctx))) {
        try {
          return await run();
        } catch (again) {
          if (again instanceof SourceHttpError && again.status === 401)
            throw new NeedsLoginError('Huisje refused the login', { loginUrl });
          throw again;
        }
      }
      cookie = undefined;
      throw new NeedsLoginError('Huisje asks for a login', { loginUrl });
    }
  }

  function toRaw(item: HuisjeItem): RawListing {
    const address: RawListing['address'] = {
      street: item.address.street,
      houseNumber: item.address.houseNumber,
      postcode: item.address.postcode,
      city: item.address.city,
      lat: item.address.lat,
      lon: item.address.lon,
    };
    if (item.address.addition) address.addition = item.address.addition;
    const raw: RawListing = {
      sourceId: 'huisje',
      externalId: item.id,
      url: item.url,
      title: item.title,
      priceEur: item.price.amount,
      priceBasis: item.price.basis,
      sizeM2: item.size,
      rooms: item.rooms,
      bedrooms: item.bedrooms,
      type: item.type,
      furnishing: item.furnishing,
      address,
      availableFrom: item.availableFrom,
      description: item.description,
      images: item.images,
      agent: { name: item.landlord.name, email: item.landlord.email },
      contact: 'form',
      contactUrl: `${item.url}#contact`,
      publishedAt: item.publishedAt,
      language: item.language,
      extra: { landlordKind: item.landlord.kind, addressAsWritten: item.address.display },
    };
    if (item.price.serviceCosts !== null) raw.serviceCostsEur = item.price.serviceCosts;
    if (item.price.deposit !== null) raw.depositEur = item.price.deposit;
    if (item.energyLabel) raw.energyLabel = item.energyLabel;
    return raw;
  }

  function saveAttachment(messageId: string, a: InboxMessage['attachments'][number]) {
    const out: { filename: string; contentType: string; size: number; path?: string } = {
      filename: a.filename,
      contentType: a.contentType,
      size: a.size,
    };
    if (a.data === undefined) return out;
    const dir = join(attachmentsDir, `${messageId}-${a.id}`);
    const path = join(dir, basename(a.filename) || 'attachment');
    if (!existsSync(path) || statSync(path).size !== a.size) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(path, Buffer.from(a.data, 'base64'));
    }
    out.path = path;
    return out;
  }

  const adapter: SourceAdapter = {
    id: 'huisje',
    name: 'Huisje',
    homepage: `${base}/huisje/`,
    regions: 'nl',
    defaultIntervalSec: opts.intervalSec ?? 60,
    capabilities: { search: 'json', detail: true, contact: 'form', login: 'optional', terms: 'allows' },
    loginUrl,

    buildSearches(searches, source) {
      const out: SearchRequest[] = [];
      const add = (req: SearchRequest) => {
        if (!out.some((r) => r.key === req.key)) out.push(req);
      };
      for (const s of searches.filter((x) => x.enabled)) {
        const cities = [
          ...new Set(
            s.regions
              .flatMap((r) => r.municipalities)
              .map((m) => m.trim().toLowerCase())
              .filter(Boolean),
          ),
        ];
        const params: Record<string, string | number> = {};
        if (s.priceMaxEur !== undefined) params.priceMax = s.priceMaxEur;
        if (s.priceMinEur !== undefined) params.priceMin = s.priceMinEur;
        if (s.sizeMinM2 !== undefined) params.sizeMin = s.sizeMinM2;
        if (s.roomsMin !== undefined) params.roomsMin = s.roomsMin;
        if (s.types.length && s.types.length < 4) params.type = [...s.types].sort().join(',');
        for (const city of cities.length ? cities : ['']) {
          const p = city ? { city, ...params } : { ...params };
          const qs = new URLSearchParams(Object.entries(p).map(([k, v]) => [k, String(v)])).toString();
          add({ key: qs || 'all', label: city ? `Huisje ${city}` : 'Huisje', params: p });
        }
      }
      for (const url of source.searchUrls) {
        add({
          key: `url-${createHash('sha1').update(url).digest('hex').slice(0, 10)}`,
          label: `Huisje: ${url}`,
          url,
        });
      }
      if (!out.length) add({ key: 'all', label: 'Huisje', params: {} });
      return out;
    },

    async search(req, ctx) {
      const out: RawListing[] = [];
      const seen = new Set<string>();
      const first = new URL(req.url ?? `${base}/huisje/api/search`);
      for (const [k, v] of Object.entries(req.params ?? {})) first.searchParams.set(k, String(v));
      const maxPages = opts.maxPages ?? 3;
      for (let page = 1; page <= maxPages; page++) {
        first.searchParams.set('page', String(page));
        const res = await ctx.fetch(first.toString(), { headers: { accept: 'application/json' } });
        const data = res.json<{ items: HuisjeItem[]; pages: number }>();
        for (const item of data.items) {
          if (item.status !== 'available' || seen.has(item.id)) continue;
          seen.add(item.id);
          out.push(toRaw(item));
        }
        if (page >= data.pages) break;
      }
      ctx.log.debug('huisje listings read', { count: out.length });
      return out;
    },

    async detail(listing, ctx) {
      const res = await ctx.fetch(`${base}/huisje/api/listings/${encodeURIComponent(listing.externalId)}`, {
        headers: { accept: 'application/json' },
      });
      return { ...listing, ...toRaw(res.json<HuisjeItem>()) };
    },

    async isAvailable(listing, ctx) {
      try {
        const res = await ctx.fetch(`${base}/huisje/api/listings/${encodeURIComponent(listing.externalId)}`, {
          headers: { accept: 'application/json' },
        });
        return res.json<HuisjeItem>().status === 'available';
      } catch (e) {
        if (e instanceof SourceHttpError && (e.status === 404 || e.status === 410)) return false;
        throw e;
      }
    },

    async contact(listing: Listing, message: OutboundMessage, ctx: SourceContext): Promise<ContactResult> {
      if (message.dryRun) return { ok: true, channel: 'form', evidence: 'dry run: nothing was sent' };
      const p = message.profile;
      const body = JSON.stringify({
        name: `${p.firstName} ${p.lastName}`.trim(),
        email: p.email,
        phone: p.phone ?? '',
        subject: message.subject ?? '',
        message: message.body,
      });
      try {
        const res = await authed(ctx, () =>
          ctx.fetch(`${base}/huisje/listing/${encodeURIComponent(listing.externalId)}/contact`, {
            method: 'POST',
            headers: headers(JSON_HEADERS),
            body,
          }),
        );
        const r = res.json<{ threadId: string; confirmation: string }>();
        return { ok: true, channel: 'form', externalId: r.threadId, evidence: r.confirmation };
      } catch (e) {
        if (e instanceof SourceHttpError && (e.status === 404 || e.status === 409)) {
          return { ok: false, channel: 'form', error: `${listing.title} is no longer available on Huisje` };
        }
        throw e;
      }
    },

    async inbox(ctx, since) {
      const res = await authed(ctx, () =>
        ctx.fetch(`${base}/huisje/api/inbox?since=${encodeURIComponent(since.toISOString())}`, {
          headers: headers({ accept: 'application/json' }),
        }),
      );
      const { messages } = res.json<{ messages: InboxMessage[] }>();
      return messages.map((m): InboundMessage => {
        const msg: InboundMessage = {
          id: `huisje:${m.id}`,
          channel: 'platform',
          sourceId: 'huisje',
          threadId: m.threadId,
          from: { name: m.from.name },
          subject: m.subject,
          text: m.text,
          at: m.at,
          attachments: m.attachments.map((a) => saveAttachment(m.id, a)),
        };
        return msg;
      });
    },

    async reply(threadId, message, ctx) {
      if (message.dryRun) return { ok: true, channel: 'message', evidence: 'dry run: nothing was sent' };
      const attachments = (message.attachments ?? [])
        .filter((a) => a.path && existsSync(a.path))
        .map((a) => ({
          filename: a.filename,
          contentType: a.contentType ?? 'application/octet-stream',
          data: readFileSync(a.path!).toString('base64'),
        }));
      try {
        const res = await authed(ctx, () =>
          ctx.fetch(`${base}/huisje/api/threads/${encodeURIComponent(threadId)}/reply`, {
            method: 'POST',
            headers: headers(JSON_HEADERS),
            body: JSON.stringify({ body: message.body, subject: message.subject ?? '', attachments }),
          }),
        );
        const r = res.json<{ id: string }>();
        return { ok: true, channel: 'message', externalId: `huisje:${r.id}` };
      } catch (e) {
        if (e instanceof SourceHttpError && e.status === 404)
          return { ok: false, channel: 'message', error: `Huisje has no thread ${threadId}` };
        throw e;
      }
    },

    /**
     * 'ok' when the adapter can act: logged in, or a guest while Huisje does
     * not ask for a login. 'expired' when a session cookie stopped working,
     * 'none' when a login is required and there is no session.
     */
    async checkSession(ctx) {
      if (!cookie && credentials(ctx)) await login(ctx).catch(() => false);
      const res = await ctx.fetch(`${base}/huisje/api/session`, {
        headers: headers({ accept: 'application/json' }),
      });
      const s = res.json<{ loggedIn: boolean; loginRequired: boolean }>();
      if (s.loggedIn || !s.loginRequired) return 'ok';
      if (cookie) {
        cookie = undefined;
        return 'expired';
      }
      return 'none';
    },
  };
  return adapter;
}
