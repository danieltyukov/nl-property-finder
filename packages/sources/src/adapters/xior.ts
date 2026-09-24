import { load } from 'cheerio';
import type { Page } from 'playwright-core';
import type { NamedSearch, PropertyType, RawListing, SearchRequest, SourceAdapter, SourceConfig, SourceContext } from '@nlpf/core';
import { SourceBlockedError } from '../runtime/errors.js';
import { sleep } from '../runtime/fetch.js';
import { parsePrice, parseSize } from '../util/parse.js';
import { areasFromSearches, dedupeListings, loadPage, searchUrlRequests, withBrowserPage } from './pararius.js';

/**
 * Xior's Dutch city pages (menu links on xiorstudenthousing.eu, recorded
 * 2026-09-24), keyed by our municipality slug.
 */
export const XIOR_CITIES: Record<string, string> = {
  amsterdam: 'amsterdam',
  breda: 'breda',
  delft: 'delft',
  eindhoven: 'eindhoven',
  enschede: 'enschede',
  groningen: 'groningen',
  leeuwarden: 'leeuwarden',
  maastricht: 'maastricht',
  'den-haag': 'the-hague',
  utrecht: 'utrecht',
  venlo: 'venlo',
  wageningen: 'wageningen',
};

const CITY_NAMES: Record<string, string> = { 'the-hague': 'Den Haag' };
const cityName = (slug: string) => CITY_NAMES[slug] ?? slug.replace(/(^|-)([a-z])/g, (_, d: string, c: string) => `${d ? ' ' : ''}${c.toUpperCase()}`);

export interface XiorOptions {
  /** Site root, for tests against a local server. Default https://www.xiorstudenthousing.eu */
  baseUrl?: string;
  waitMs?: number;
  /** Residences read per city page. Default 8. */
  maxResidences?: number;
  /** Ask the booking modal's availability endpoint which rooms are free. Default true. */
  checkAvailability?: boolean;
  /** Pause between two requests to Xior in one search. Default 3 s (the endpoint is rate limited per IP, REPORTED). */
  gapMs?: number;
}

export interface XiorResidence {
  name: string;
  url: string;
  fromPriceEur?: number;
}

export interface XiorRoomType {
  id: string;
  name: string;
  priceEur?: number;
  sizeM2?: number;
  /** The room card has a "Controleer beschikbaarheid" button that opens the booking modal. */
  bookable: boolean;
  /** "These rooms are exclusively reserved for partner universities." */
  partnerOnly: boolean;
  privateRoom: boolean;
  image?: string;
}

export interface XiorResidencePage {
  propertyPageId?: string;
  semesterId?: string;
  ajaxUrl?: string;
  roomTypes: XiorRoomType[];
}

const clean = (s: string | undefined) => (s ?? '').replace(/[\s ]+/g, ' ').trim();

/** Residences on a city page: `.filtered-homes-content` with a name, "Vanaf EUR 813,00 per maand" and a link. */
export function parseXiorCity(html: string, baseUrl: string): XiorResidence[] {
  const $ = load(html);
  const out: XiorResidence[] = [];
  $('.filtered-homes-content').each((_, el) => {
    const block = $(el);
    const name = clean(block.find('h3').first().text());
    const href = block.find('.filtered-button a[href], a.btn-primary[href]').first().attr('href');
    if (!name || !href) return;
    const price = parsePrice(clean(block.find('.filtered-button-price').first().text())).priceEur;
    out.push({ name, url: new URL(href, baseUrl).toString(), ...(price !== undefined ? { fromPriceEur: price } : {}) });
  });
  return out;
}

/** Room types on a residence page, and the ids its booking modal sends to the availability endpoint. */
export function parseXiorResidence(html: string): XiorResidencePage {
  const $ = load(html);
  const roomTypes: XiorRoomType[] = [];
  $('.rooms-slider-content').each((_, el) => {
    const block = $(el);
    const name = clean(block.find('h3').first().text());
    const button = block.find('.open-yardi-popup[data-room-id]').first();
    const id = button.attr('data-room-id') ?? /room-features-list-(\d+)/.exec(block.html() ?? '')?.[1];
    if (!name || !id) return;
    const info = block.find('.key-info-list li').toArray().map((li) => clean($(li).text()));
    const text = clean(block.text());
    const price = parsePrice(clean(block.find('.rooms-slider-button-price, h5').first().text())).priceEur;
    const size = info.map((i) => parseSize(i.replace(/m\s*2$/i, 'm2'))).find((n) => n !== undefined);
    const image = block.closest('.rooms-slider-block').find('img[src^="http"]').first().attr('src');
    roomTypes.push({
      id,
      name,
      ...(price !== undefined ? { priceEur: price } : {}),
      ...(size !== undefined ? { sizeM2: size } : {}),
      bookable: button.length > 0,
      partnerOnly: /reserved for partner universit|partneruniversiteit|via de universiteit/i.test(text),
      privateRoom: info.some((i) => /^(privé|prive|private)$/i.test(i)),
      ...(image ? { image } : {}),
    });
  });
  const scripts = $('script').text();
  return {
    ...(/propertyPageId\s*=\s*(\d+)/.exec(scripts)?.[1] ? { propertyPageId: /propertyPageId\s*=\s*(\d+)/.exec(scripts)?.[1] } : {}),
    ...($('input[name="semester"]').attr('value') ? { semesterId: $('input[name="semester"]').attr('value') } : {}),
    ...(/ajaxUrl\s*=\s*'([^']+)'/.exec(scripts)?.[1] ? { ajaxUrl: /ajaxUrl\s*=\s*'([^']+)'/.exec(scripts)?.[1] } : {}),
    roomTypes,
  };
}

export interface XiorUnit {
  apartmentId?: number | string;
  apartmentName?: string;
  floorplanName?: string;
  minimumRent?: number | string;
  maximumRent?: number | string;
  sqm?: number | string;
  sqM?: number | string;
  deposit?: number | string;
  availableDate?: string;
  unitStatus?: string;
  applyOnlineURL?: string;
}

export interface XiorAvailability {
  units: XiorUnit[];
  byRoom: Record<string, number>;
}

/** The availability endpoint's answer, or undefined when it refused or failed. */
export function parseXiorAvailability(text: string): XiorAvailability | undefined {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return undefined;
  }
  const j = json as { success?: boolean; data?: { units?: unknown; availability_by_room?: unknown; availability_response?: { errorCode?: unknown } } };
  if (!j?.success || !j.data) return undefined;
  const code = Number(j.data.availability_response?.errorCode ?? 200);
  // 2xx means the lookup worked (204 is "nothing free"); anything else is a failure upstream (751K docs/XIOR.md 3.3).
  if (Number.isFinite(code) && (code < 200 || code >= 300)) return undefined;
  const byRoom: Record<string, number> = {};
  const raw = j.data.availability_by_room;
  if (raw && typeof raw === 'object') for (const [k, v] of Object.entries(raw)) if (Number.isFinite(Number(v))) byRoom[k] = Number(v);
  return { units: Array.isArray(j.data.units) ? (j.data.units as XiorUnit[]) : [], byRoom };
}

/** "01/11/2026" (day first, as Yardi sends it) to 2026-11-01. */
function dmy(text: string | undefined): string | undefined {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text?.trim() ?? '');
  if (!m) return undefined;
  return `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
}

const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

/**
 * Asks the residence page's own availability endpoint, the call its booking
 * modal makes (`admin-ajax.php`, action `yardi_room_availability`, with
 * `property_page_id`, `room_type_id` and `semester_id`; recorded from the
 * page script on 2026-09-24). The page sends a Turnstile token as well;
 * 751K/holland2stay-monitor reports the endpoint does not check it
 * (REPORTED 2026-08, UNVERIFIED here). A refusal leaves availability unknown.
 */
async function askAvailability(page: Page, ajaxUrl: string, params: Record<string, string>): Promise<XiorAvailability | undefined> {
  const body = new URLSearchParams({ action: 'yardi_room_availability', ...params }).toString();
  const res = await page
    .evaluate(
      async ({ url, form }) => {
        const r = await fetch(url, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8', 'x-requested-with': 'XMLHttpRequest' },
          body: form,
        });
        return { status: r.status, text: await r.text() };
      },
      { url: ajaxUrl, form: body },
    )
    .catch(() => undefined);
  if (!res) return undefined;
  if (res.status === 403 || res.status === 429) throw new SourceBlockedError(`Xior's availability endpoint refused with HTTP ${res.status}`, { status: res.status, url: ajaxUrl });
  return res.status === 200 ? parseXiorAvailability(res.text) : undefined;
}

/**
 * Xior student housing. Behind a Cloudflare managed challenge (headed
 * browser). Rooms are booked online by the tenant, first come first served,
 * so this source only notifies: each free unit (or, when availability cannot
 * be read, each bookable room type) is a listing with `contact: 'booking'`.
 * Room types reserved for partner universities are skipped.
 */
export function createXiorAdapter(options: XiorOptions = {}): SourceAdapter {
  const base = (options.baseUrl ?? 'https://www.xiorstudenthousing.eu').replace(/\/+$/, '');
  const waitMs = options.waitMs ?? 30_000;
  const maxResidences = options.maxResidences ?? 8;
  const checkAvailability = options.checkAvailability ?? true;
  const gapMs = options.gapMs ?? 3_000;

  async function readResidence(page: Page, residence: XiorResidence, city: string, ctx: SourceContext): Promise<RawListing[]> {
    const loaded = await loadPage(page, residence.url, { ready: '.rooms-slider-content, .filtered-homes-content', waitMs, signal: ctx.signal });
    const info = parseXiorResidence(loaded.html);
    const open = info.roomTypes.filter((t) => t.bookable && !t.partnerOnly);
    const street = residence.name;
    const common = (t: XiorRoomType): Omit<RawListing, 'externalId' | 'title' | 'url'> => ({
      sourceId: 'xior',
      type: (t.privateRoom ? 'studio' : 'room') as PropertyType,
      address: { street, city },
      contact: 'booking',
      language: 'nl',
      ...(t.image ? { images: [t.image] } : {}),
    });

    let availability: Map<string, XiorAvailability | undefined> | undefined;
    const ajaxUrl = info.ajaxUrl ?? `${new URL(loaded.url).origin}/wp-admin/admin-ajax.php`;
    if (checkAvailability && open.length && info.propertyPageId) {
      availability = new Map();
      const ask = (t: XiorRoomType) =>
        askAvailability(page, ajaxUrl, { property_page_id: info.propertyPageId!, room_type_id: t.id, semester_id: info.semesterId ?? '' });
      // Each room type is asked on its own, so one failed answer does not hide the others. A type an
      // earlier answer already counted as full is skipped, and two failures in a row end the round
      // (the endpoint is rate limited per IP, and a refusal usually repeats).
      let failures = 0;
      for (const [i, t] of open.entries()) {
        const known = [...availability.values()].find((v) => v && t.id in v.byRoom)?.byRoom[t.id];
        if (known !== undefined && known <= 0) continue;
        if (i > 0) await sleep(gapMs, ctx.signal);
        const answer = await ask(t);
        availability.set(t.id, answer);
        failures = answer ? 0 : failures + 1;
        if (failures >= 2) break;
      }
    }

    const out: RawListing[] = [];
    for (const t of open) {
      const a = availability?.get(t.id);
      const counted = availability ? [...availability.values()].find((v) => v && t.id in v.byRoom)?.byRoom[t.id] : undefined;
      if (counted === 0) continue;
      // The endpoint answers with the units of the room type it was asked about.
      const units = a?.units ?? [];
      if (a && units.length) {
        for (const u of units) {
          const id = String(u.apartmentId ?? u.apartmentName ?? '');
          if (!id) continue;
          const price = num(u.minimumRent);
          const size = num(u.sqm ?? u.sqM);
          const from = dmy(u.availableDate);
          out.push({
            ...common(t),
            externalId: `unit-${id}`,
            url: residence.url,
            title: `${t.name}${u.apartmentName ? ` ${u.apartmentName}` : ''}, ${residence.name}`,
            ...(price !== undefined ? { priceEur: price, priceBasis: 'unknown' as const } : {}),
            ...(size !== undefined ? { sizeM2: Math.round(size) } : t.sizeM2 !== undefined ? { sizeM2: t.sizeM2 } : {}),
            ...(num(u.deposit) !== undefined ? { depositEur: num(u.deposit) } : {}),
            ...(from ? { availableFrom: from } : {}),
            contactUrl: u.applyOnlineURL || residence.url,
            extra: {
              residence: residence.name,
              roomType: t.name,
              roomTypeId: t.id,
              propertyPageId: info.propertyPageId,
              ...(u.unitStatus ? { unitStatus: u.unitStatus } : {}),
              ...(num(u.maximumRent) !== undefined ? { maxRentEur: num(u.maximumRent) } : {}),
            },
          });
        }
        continue;
      }
      if (a && !units.length) continue;
      // Availability unknown: the room type itself, so the person can check.
      out.push({
        ...common(t),
        externalId: `type-${info.propertyPageId ?? residence.name}-${t.id}`,
        url: residence.url,
        title: `${t.name}, ${residence.name}`,
        ...(t.priceEur !== undefined ? { priceEur: t.priceEur, priceBasis: 'unknown' as const } : {}),
        ...(t.sizeM2 !== undefined ? { sizeM2: t.sizeM2 } : {}),
        contactUrl: residence.url,
        extra: { residence: residence.name, roomType: t.name, roomTypeId: t.id, propertyPageId: info.propertyPageId, availability: 'unknown', priceFrom: true },
      });
    }
    return out;
  }

  return {
    id: 'xior',
    name: 'Xior',
    homepage: 'https://www.xiorstudenthousing.eu',
    regions: ['amsterdam', 'breda', 'delft', 'eindhoven', 'enschede', 'groningen', 'leeuwarden', 'maastricht', 'den haag', "'s-gravenhage", 'utrecht', 'venlo', 'wageningen'],
    defaultIntervalSec: 1800,
    capabilities: {
      search: 'browser',
      detail: false,
      contact: 'booking',
      login: 'required',
      terms: 'unknown',
      browser: 'headed',
    },
    loginUrl: `${base}/nl/`,

    buildSearches(searches: NamedSearch[], source: SourceConfig) {
      const areas = areasFromSearches(searches);
      const cities = areas.some((a) => a.slug === 'nederland')
        ? Object.values(XIOR_CITIES)
        : areas.map((a) => XIOR_CITIES[a.slug]).filter((c): c is string => Boolean(c));
      const reqs: SearchRequest[] = [...new Set(cities)].map((city) => ({
        key: `city:${city}`,
        label: `Xior ${cityName(city)}`,
        url: `${base}/nl/netherlands/${city}/`,
        params: { city },
      }));
      return [...reqs, ...searchUrlRequests(source, 'Xior', reqs)];
    },

    async search(req, ctx) {
      const city = typeof req.params?.city === 'string' ? req.params.city : (/\/netherlands\/([a-z-]+)\//.exec(req.url ?? '')?.[1] ?? '');
      const url = req.url ?? `${base}/nl/netherlands/${city}/`;
      return withBrowserPage(ctx, async (page) => {
        const loaded = await loadPage(page, url, { ready: '.filtered-homes-content', waitMs, signal: ctx.signal });
        const residences = parseXiorCity(loaded.html, loaded.url).slice(0, maxResidences);
        const out: RawListing[] = [];
        for (const residence of residences) {
          await sleep(gapMs, ctx.signal);
          try {
            out.push(...(await readResidence(page, residence, cityName(city), ctx)));
          } catch (e) {
            if (e instanceof SourceBlockedError) throw e;
            ctx.log.warn('could not read a Xior residence', { url: residence.url, error: (e as Error).message });
          }
        }
        return dedupeListings(out);
      });
    },
  };
}

export const xior = createXiorAdapter();
