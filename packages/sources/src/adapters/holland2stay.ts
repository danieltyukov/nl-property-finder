import { load } from 'cheerio';
import type { Page, Response } from 'playwright-core';
import type { ContactResult, Listing, NamedSearch, OutboundMessage, RawListing, SearchRequest, SourceAdapter, SourceConfig, SourceContext } from '@nlpf/core';
import { trimTrailingSlashes } from '@nlpf/core';
import { SourceBlockedError, SourceHttpError } from '../runtime/errors.js';
import { detectChallenge, sleep } from '../runtime/fetch.js';
import { splitAddress } from '../util/address.js';
import { detectFurnishing, detectType, parseRooms, parseSize } from '../util/parse.js';
import { areasFromSearches, failedNavigation, searchUrlRequests, withBrowserPage } from './pararius.js';

/*
 * Holland2Stay (holland2stay.com). What is known, and how sure:
 *
 * - VERIFIED 2026-09-24 (fixtures/holland2stay/challenge.html): the residences
 *   page answers 307 then 403 with an interactive Cloudflare Turnstile
 *   ("Ik ben geen robot"), even in a headed browser. It needs a person.
 * - REPORTED by 751K/holland2stay-monitor (docs/H2S.md, h2s_gql.py, 2026-08):
 *   the page loads its units with a Magento GraphQL query `GetCategories`
 *   (products { aggregations, items { name sku city url_key available_to_book
 *   next_contract_startdate living_area no_of_rooms finishing basic_rent
 *   price_range energy_label media_gallery ... } page_info total_count }),
 *   sent since 2026-08-17 through an encrypted envelope (POST /api/__enc__,
 *   AES-GCM) that the page decrypts itself with WebCrypto. Status ids: 179
 *   available to book, 336 lottery. Next contract dates of 2050 or later mean
 *   "no date".
 *
 * So this adapter does not call the API. It lets the real page load in the
 * source's own browser profile (after a person has passed the Turnstile once
 * with `nlpf connect holland2stay`) and reads the GraphQL results the page
 * receives: plain JSON responses through Playwright, and encrypted ones at
 * the point the page decrypts them. UNVERIFIED end to end, because the page
 * could not be reached while recording.
 */

/** City filter values in the site's own URLs ("Label,option id"). Only Delft is VERIFIED (docs/research/platforms.md 4.10). */
const CITY_FILTERS: Record<string, string> = { delft: 'Delft,6186' };

const STATUS: Record<string, 'available' | 'lottery'> = { '179': 'available', '336': 'lottery' };

/**
 * Hooks WebCrypto's decrypt on our own polling page so the plaintext the
 * page gets from /api/__enc__ can be read back. Kept as a string so it runs
 * as written in the browser. The page's own scripts see the same results.
 */
const CAPTURE_SCRIPT = `(() => {
  if (window.__nlpfH2S) return;
  const store = [];
  Object.defineProperty(window, '__nlpfH2S', { value: store });
  if (typeof SubtleCrypto === 'undefined' || !SubtleCrypto.prototype.decrypt) return;
  const decrypt = SubtleCrypto.prototype.decrypt;
  SubtleCrypto.prototype.decrypt = function () {
    return decrypt.apply(this, arguments).then((out) => {
      try {
        const text = new TextDecoder().decode(out);
        if (text.indexOf('"products"') !== -1) store.push(text);
      } catch (e) {}
      return out;
    });
  };
})();`;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

interface ProductsBlock {
  items: Record<string, unknown>[];
  aggregations: Record<string, unknown>[];
}

/** Every `products` block with items in a parsed GraphQL response (or a Next.js data blob). */
export function findProducts(value: unknown, out: ProductsBlock[] = [], depth = 0): ProductsBlock[] {
  if (depth > 12) return out;
  if (Array.isArray(value)) {
    for (const v of value) findProducts(v, out, depth + 1);
    return out;
  }
  if (!isObj(value)) return out;
  const items = value.items;
  if (Array.isArray(items) && items.some((i) => isObj(i) && 'sku' in i && 'url_key' in i)) {
    out.push({ items: items.filter(isObj), aggregations: Array.isArray(value.aggregations) ? value.aggregations.filter(isObj) : [] });
    return out;
  }
  for (const v of Object.values(value)) findProducts(v, out, depth + 1);
  return out;
}

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : Number(text(v).replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

/** YYYY-MM-DD, or undefined for empty values and the 2050 "no date" placeholder. */
function contractDate(v: unknown): string | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text(v));
  if (!m || Number(m[1]) >= 2050) return undefined;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

export interface MapOptions {
  baseUrl?: string;
  /** Keep only units in these towns (lowercase names). */
  cities?: string[];
}

/**
 * Maps GraphQL `products` blocks to listings: units available to book
 * (`contact: 'booking'`, first come first served) and units in the weekly
 * lottery (`contact: 'lottery'`). Reserved and rented units are skipped.
 * Select attributes (city, finishing, rooms, energy label) arrive as option
 * ids and are named with the response's own `aggregations`.
 */
export function mapHolland2StayProducts(blocks: ProductsBlock[], opts: MapOptions = {}): RawListing[] {
  const base = trimTrailingSlashes(opts.baseUrl ?? 'https://www.holland2stay.com');
  const labels = new Map<string, Map<string, string>>();
  for (const b of blocks) {
    for (const agg of b.aggregations) {
      const code = text(agg.attribute_code);
      if (!code) continue;
      const m = labels.get(code) ?? new Map<string, string>();
      for (const o of Array.isArray(agg.options) ? agg.options.filter(isObj) : []) m.set(text(o.value), text(o.label));
      labels.set(code, m);
    }
  }
  const label = (code: string, v: unknown) => {
    const raw = text(v);
    return labels.get(code)?.get(raw) ?? raw;
  };
  const wanted = opts.cities?.length ? new Set(opts.cities.map((c) => c.toLowerCase())) : undefined;

  const out: RawListing[] = [];
  const seen = new Set<string>();
  for (const item of blocks.flatMap((b) => b.items)) {
    const sku = text(item.sku);
    const status = STATUS[text(item.available_to_book)];
    if (!sku || !status || seen.has(sku)) continue;
    const city = label('city', item.city);
    if (wanted && !wanted.has(city.toLowerCase())) continue;
    seen.add(sku);
    const urlKey = text(item.url_key);
    // UNVERIFIED path: Magento's url_key with .html under /residences, as the site's listing links are reported to look.
    const url = urlKey ? `${base}/residences/${urlKey}.html` : `${base}/residences`;
    const name = text(item.name);
    const street = splitAddress(name);
    const basic = num(item.basic_rent);
    const priceRange = isObj(item.price_range) && isObj(item.price_range.minimum_price) && isObj(item.price_range.minimum_price.regular_price)
      ? num(item.price_range.minimum_price.regular_price.value)
      : undefined;
    const roomsLabel = label('no_of_rooms', item.no_of_rooms);
    const rooms = /studio/i.test(roomsLabel) ? 1 : parseRooms(roomsLabel);
    const furnishing = detectFurnishing(label('finishing', item.finishing));
    const energy = /^[A-G]\+*$/i.exec(label('energy_label', item.energy_label))?.[0]?.toUpperCase();
    const size = parseSize(label('living_area', item.living_area));
    const from = contractDate(item.available_startdate) ?? contractDate(item.next_contract_startdate);
    const images = (Array.isArray(item.media_gallery) ? item.media_gallery.filter(isObj) : [])
      .filter((m) => m.disabled !== true && typeof m.url === 'string')
      .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0))
      .map((m) => String(m.url));
    const listing: RawListing = {
      sourceId: 'holland2stay',
      externalId: sku,
      url,
      title: city ? `${name}, ${city}` : name,
      address: { ...street, ...(city ? { city } : {}) },
      type: detectType(roomsLabel) ?? (rooms && rooms > 1 ? 'apartment' : 'studio'),
      contact: status === 'available' ? 'booking' : 'lottery',
      contactUrl: url,
      language: 'en',
      extra: {
        sku,
        status,
        statusId: text(item.available_to_book),
        bookingUrl: url,
        ...(num(item.current_lottery_subscribers) !== undefined ? { lotterySubscribers: num(item.current_lottery_subscribers) } : {}),
        ...(text(item.minimum_stay) ? { minimumStayMonths: num(item.minimum_stay) } : {}),
        ...(text(item.type_of_contract) ? { contract: label('type_of_contract', item.type_of_contract) } : {}),
        ...(num(item.maximum_number_of_persons) !== undefined ? { maxPersons: num(item.maximum_number_of_persons) } : {}),
        ...(text(item.offer_text) ? { offer: text(item.offer_text) } : {}),
      },
    };
    if (basic !== undefined) {
      Object.assign(listing, { priceEur: basic, priceBasis: 'excl' });
      if (priceRange !== undefined && priceRange > basic) listing.serviceCostsEur = Math.round((priceRange - basic) * 100) / 100;
    } else if (priceRange !== undefined) {
      Object.assign(listing, { priceEur: priceRange, priceBasis: 'incl' });
    }
    if (size) listing.sizeM2 = size;
    if (rooms) listing.rooms = rooms;
    if (furnishing !== 'unknown') listing.furnishing = furnishing;
    if (energy) listing.energyLabel = energy;
    if (from) listing.availableFrom = from;
    if (images.length) listing.images = images;
    out.push(listing);
  }
  return out;
}

export interface Holland2StayOptions {
  baseUrl?: string;
  /** How long to wait for the page's unit data (or give up on a challenge). Default 30 s. */
  waitMs?: number;
  /** A shorter wait for `checkSession`, which runs every few seconds while someone connects. Default 8 s. */
  checkWaitMs?: number;
}

type Outcome = { blocks: ProductsBlock[] } | { challenge: string; status?: number };

/**
 * Loads a residences page and collects the unit data it receives, until
 * some arrives or `waitMs` passes. An interactive Turnstile that stays up is
 * reported as a challenge; nothing here ever clicks it.
 */
async function watchResidences(page: Page, url: string, waitMs: number, signal: AbortSignal): Promise<Outcome> {
  const texts: string[] = [];
  let status: number | undefined;
  const onResponse = (res: Response) => {
    try {
      if (res.request().isNavigationRequest() && res.frame() === page.mainFrame()) status = res.status();
      if (!/\/api\//.test(new URL(res.url()).pathname)) return;
      if (!/json/i.test(res.headers()['content-type'] ?? '')) return;
      void res.text().then(
        (t) => {
          if (t.includes('"products"')) texts.push(t);
        },
        () => undefined,
      );
    } catch {
      // a response of a page that is already gone
    }
  };
  page.on('response', onResponse);
  try {
    await page.addInitScript({ content: CAPTURE_SCRIPT });
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    } catch (e) {
      signal.throwIfAborted();
      failedNavigation(e, url);
    }
    const deadline = Date.now() + waitMs;
    let html = '';
    let settled = false;
    for (;;) {
      const captured = await page.evaluate('window.__nlpfH2S ? Array.from(window.__nlpfH2S) : []').catch(() => []);
      html = await page.content().catch(() => html);
      const blocks: ProductsBlock[] = [];
      for (const t of [...texts, ...(Array.isArray(captured) ? captured : [])]) {
        try {
          findProducts(typeof t === 'string' ? JSON.parse(t) : t, blocks);
        } catch {
          // not JSON after all
        }
      }
      const nextData = load(html)('script#__NEXT_DATA__').text();
      if (nextData) {
        try {
          findProducts(JSON.parse(nextData), blocks);
        } catch {
          // not the pages-router data blob
        }
      }
      if (blocks.length) {
        // The page may ask for more than one list (say, bookable units and lottery units); give the rest a moment.
        if (settled) return { blocks };
        settled = true;
        await sleep(1_000, signal);
        continue;
      }
      if (Date.now() >= deadline) {
        const marker = detectChallenge(html);
        if (marker) return { challenge: /turnstile|cf-turnstile-response/i.test(html) ? 'turnstile' : marker, ...(status !== undefined ? { status } : {}) };
        if (/clearance_required|browser verification required/i.test(html)) return { challenge: 'h2s-clearance', ...(status !== undefined ? { status } : {}) };
        throw new SourceHttpError(`${url} showed no residence data within ${Math.round(waitMs / 1000)} s`, { status: status ?? 0, url });
      }
      await sleep(500, signal);
    }
  } finally {
    page.off('response', onResponse);
  }
}

/**
 * Holland2Stay: furnished studios and apartments for students and young
 * professionals, booked online first come first served ("Book directly")
 * or through a weekly lottery. The terms forbid automated bookings, so the
 * adapter runs in assisted mode: it finds new units and its `contact`
 * always returns `needs: 'human'`; every listing carries `extra.bookingUrl`,
 * which the daemon opens on the person's own screen.
 */
export function createHolland2StayAdapter(options: Holland2StayOptions = {}): SourceAdapter {
  const base = trimTrailingSlashes(options.baseUrl ?? 'https://www.holland2stay.com');
  const waitMs = options.waitMs ?? 30_000;
  const checkWaitMs = options.checkWaitMs ?? 8_000;

  const residencesUrl = (cityFilter?: string) => {
    const u = new URL(`${base}/residences`);
    u.searchParams.set('page', '1');
    if (cityFilter) u.searchParams.set('city[filter]', cityFilter);
    return u.toString();
  };

  return {
    id: 'holland2stay',
    name: 'Holland2Stay',
    homepage: 'https://www.holland2stay.com',
    regions: 'nl',
    defaultIntervalSec: 120,
    capabilities: {
      search: 'browser',
      detail: false,
      contact: 'booking',
      login: 'required',
      terms: 'forbids',
      browser: 'headed',
    },
    // `nlpf connect holland2stay` opens the residences page: the person passes the Turnstile there and can log in from the site's menu.
    loginUrl: `${base}/residences`,

    buildSearches(searches: NamedSearch[], source: SourceConfig) {
      const areas = areasFromSearches(searches);
      const reqs: SearchRequest[] = [];
      const rest: string[] = [];
      let nationwide = false;
      for (const area of areas) {
        const filter = CITY_FILTERS[area.slug];
        if (filter) reqs.push({ key: `city:${area.slug}`, label: `Holland2Stay ${area.name}`, url: residencesUrl(filter), params: { cities: area.name.toLowerCase() } });
        else if (area.slug === 'nederland') nationwide = true;
        else rest.push(area.name.toLowerCase());
      }
      if (nationwide || rest.length) {
        // Towns without a known filter id: the unfiltered list, narrowed to those towns here.
        reqs.push({ key: nationwide ? 'all' : `towns:${rest.join(',')}`, label: 'Holland2Stay', url: residencesUrl(), params: nationwide ? {} : { cities: rest.join(',') } });
      }
      return [...reqs, ...searchUrlRequests(source, 'Holland2Stay', reqs)];
    },

    async search(req, ctx) {
      const url = req.url ?? residencesUrl();
      const cities = typeof req.params?.cities === 'string' && req.params.cities ? req.params.cities.split(',') : undefined;
      return withBrowserPage(ctx, async (page) => {
        const outcome = await watchResidences(page, url, waitMs, ctx.signal);
        if ('challenge' in outcome) {
          throw new SourceBlockedError(
            `Holland2Stay shows a check only a person can pass (${outcome.challenge}); run nlpf connect holland2stay and tick it once`,
            { status: outcome.status ?? 403, marker: outcome.challenge, url },
          );
        }
        return mapHolland2StayProducts(outcome.blocks, { baseUrl: base, ...(cities ? { cities } : {}) });
      });
    },

    async contact(listing: Listing, _message: OutboundMessage, _ctx: SourceContext): Promise<ContactResult> {
      const bookingUrl = typeof listing.extra?.bookingUrl === 'string' ? listing.extra.bookingUrl : (listing.contactUrl ?? listing.url);
      return {
        ok: false,
        channel: 'booking',
        needs: 'human',
        error: `Holland2Stay bookings are made by a person (its terms forbid automated bookings): ${bookingUrl}`,
        evidence: bookingUrl,
      };
    },

    async checkSession(ctx) {
      // 'ok' once the residences page shows its data, which means the Turnstile was passed in this profile.
      return withBrowserPage(ctx, async (page) => {
        try {
          const outcome = await watchResidences(page, residencesUrl(), checkWaitMs, ctx.signal);
          return 'challenge' in outcome ? 'expired' : 'ok';
        } catch (e) {
          if (e instanceof SourceHttpError) return 'none';
          throw e;
        }
      });
    },
  };
}

export const holland2stay = createHolland2StayAdapter();
