/**
 * Funda (funda.nl, huur): the largest free-sector portal, and the best free
 * way to reach a landlord: its contact form is a guest form (question,
 * email, first name, last name, phone) with no login and no payment.
 *
 * Verified live on 2026-09-24:
 * - The search page `/zoeken/huur?selected_area=[...]&price="0-1400"&...`
 *   server-renders every listing in `#__NUXT_DATA__` (Nuxt 3 devalue):
 *   address with postcode and house number, rent, floor area, rooms, status,
 *   publish date, agent and the global id used by the contact form. Several
 *   areas fit in one request. `availability=["available"]` leaves out homes
 *   under option.
 * - Akamai now answers plain HTTP clients with a "Je bent bijna op de pagina
 *   die je zoekt" page, while a headless Chromium gets the real page. The
 *   adapter tries a plain request first and falls back to the browser, then
 *   stays in the browser for a while.
 * - `listing-detail-summary.funda.io/api/v1/listing/nl/{globalId}` answers
 *   plain requests and says whether a home is rented (used by isAvailable).
 * - `/makelaar-contact/?listingId={globalId}` renders the guest form with
 *   `#questionInput`, `#emailAddress`, `#firstName`, `#lastName`,
 *   `#phoneNumber` and a "Verstuur" submit button, behind a Didomi consent
 *   banner. The form was never submitted, so the confirmation text after
 *   sending is not known; the adapter accepts the usual Dutch wording and
 *   otherwise asks a person to check.
 * - The mobile search API is closed (App Check since 2026-08-18) and is not used.
 */
import { load, type CheerioAPI } from 'cheerio';
import type { Page } from 'playwright-core';
import type {
  ContactResult,
  InboundMessage,
  NamedSearch,
  OutboundMessage,
  PropertyType,
  RawListing,
  SearchRequest,
  SourceAdapter,
  SourceContext,
} from '@nlpf/core';
import { trimTrailingSlashes } from '@nlpf/core';
import { NeedsLoginError, SourceBlockedError, SourceHttpError } from '../runtime/errors.js';
import { normalisePostcode, splitAddress } from '../util/address.js';
import {
  detectFurnishing,
  detectType,
  parseBedrooms,
  parseDutchDate,
  parsePrice,
  parseRooms,
  parseSize,
} from '../util/parse.js';
import {
  alertCards,
  clean,
  compact,
  filterKey,
  firstLine,
  firstVisible,
  isObj,
  isoInstant,
  num,
  pageText,
  positive,
  searchMunicipalities,
  senderIs,
  showsCaptcha,
  slugify,
  str,
  waitForConfirmation,
} from './json-shared.js';

/* ---------- Nuxt payloads ---------- */

const WRAPPERS = new Set(['Reactive', 'ShallowReactive', 'Ref', 'ShallowRef', 'EmptyRef', 'EmptyShallowRef']);

/**
 * Rebuilds the value in a Nuxt 3 `__NUXT_DATA__` payload (devalue format: a
 * flat array where objects and arrays refer to other entries by index, and
 * tagged arrays such as ["Reactive", i] wrap values). Unknown tags become
 * undefined rather than throwing.
 */
export function reviveNuxt(payload: unknown): unknown {
  if (!Array.isArray(payload)) return undefined;
  const arr = payload as unknown[];
  const memo = new Map<number, unknown>();
  const at = (x: unknown, depth: number): unknown =>
    typeof x === 'number' ? hydrate(x, depth + 1) : undefined;
  function hydrate(i: number, depth: number): unknown {
    if (!Number.isInteger(i) || i < 0 || i >= arr.length || depth > 400) return undefined;
    if (memo.has(i)) return memo.get(i);
    const v = arr[i];
    if (Array.isArray(v)) {
      if (typeof v[0] === 'string') {
        const tag = v[0];
        if (WRAPPERS.has(tag)) {
          const r = at(v[1], depth);
          memo.set(i, r);
          return r;
        }
        if (tag === 'Date') {
          memo.set(i, v[1]);
          return v[1];
        }
        if (tag === 'Set') {
          const out: unknown[] = [];
          memo.set(i, out);
          for (const x of v.slice(1)) out.push(at(x, depth));
          return out;
        }
        if (tag === 'Map' || tag === 'null') {
          const out: Record<string, unknown> = {};
          memo.set(i, out);
          for (let k = 1; k + 1 < v.length; k += 2) {
            const key = tag === 'Map' ? at(v[k], depth) : v[k];
            out[String(key)] = at(v[k + 1], depth);
          }
          return out;
        }
        memo.set(i, undefined);
        return undefined;
      }
      const out: unknown[] = [];
      memo.set(i, out);
      for (const x of v) out.push(at(x, depth));
      return out;
    }
    if (isObj(v)) {
      const out: Record<string, unknown> = {};
      memo.set(i, out);
      for (const [k, x] of Object.entries(v)) out[k] = at(x, depth);
      return out;
    }
    memo.set(i, v);
    return v;
  }
  return hydrate(0, 0);
}

function nuxtRoot($: CheerioAPI): Record<string, unknown> | undefined {
  const raw = $('script#__NUXT_DATA__').first().text();
  if (!raw) return undefined;
  try {
    const root = reviveNuxt(JSON.parse(raw));
    return isObj(root) ? root : undefined;
  } catch {
    return undefined;
  }
}

/** The search results array: `pinia.search.listings`, or any array of objects with a detail URL. */
function findListings(root: Record<string, unknown>): Record<string, unknown>[] | undefined {
  const direct = (root.pinia as Record<string, Record<string, unknown>> | undefined)?.search?.listings;
  if (Array.isArray(direct)) return direct.filter(isObj);
  const seen = new Set<unknown>();
  const walk = (o: unknown, depth: number): Record<string, unknown>[] | undefined => {
    if (depth > 12 || !o || typeof o !== 'object' || seen.has(o)) return undefined;
    seen.add(o);
    if (Array.isArray(o)) {
      if (o.length && o.every((x) => isObj(x) && 'object_detail_page_relative_url' in x))
        return o as Record<string, unknown>[];
      for (const x of o) {
        const r = walk(x, depth + 1);
        if (r) return r;
      }
      return undefined;
    }
    for (const x of Object.values(o)) {
      const r = walk(x, depth + 1);
      if (r) return r;
    }
    return undefined;
  };
  return walk(root, 0);
}

/* ---------- helpers ---------- */

const AKAMAI_PAGE = /Je bent bijna op de pagina die je zoekt|<title>\s*Access Denied\s*<\/title>/i;

/** tinyId from `/detail/huur/{city}/{type}-{street}/{tinyId}/` (or the older `/huur/{city}/{type}-{tinyId}-{street}/`). */
export function fundaTinyId(pathOrUrl: string): string | undefined {
  let path = pathOrUrl;
  try {
    path = new URL(pathOrUrl, 'https://www.funda.nl').pathname;
  } catch {
    // keep as is
  }
  return (
    /\/detail\/(?:huur|koop)\/[^/]+\/[^/]+\/(\d{6,})\/?$/.exec(path)?.[1] ??
    /\/huur\/[^/]+\/[a-z]+-(\d{6,})-[^/]+\/?$/.exec(path)?.[1]
  );
}

const OBJECT_TYPE: Record<string, PropertyType> = { apartment: 'apartment', house: 'house' };

/** Statuses of a listing that is still open to reactions. */
const OPEN_STATUS = new Set(['none', 'available', 'beschikbaar']);

/** Funda's area id for a municipality: "den haag" is "den-haag". */
export function fundaArea(municipality: string): string {
  return slugify(municipality);
}

/**
 * Funda's object types for the searched home types. Without this filter the
 * rental search also returns parking spaces, storage and berths (seen live).
 */
function objectTypes(types: PropertyType[]): string[] {
  if (types.includes('other')) return [];
  const out = new Set<string>();
  if (types.some((t) => t === 'room' || t === 'studio' || t === 'apartment')) out.add('apartment');
  if (types.includes('house')) out.add('house');
  return [...out];
}

/** Object types that are never a home, dropped even when a search asks for 'other'. */
const NOT_A_HOME = new Set(['parking', 'storage', 'storage_space', 'land', 'berth', 'pitch', 'substructure']);

const q = (v: unknown) => encodeURIComponent(JSON.stringify(v));

export interface FundaOptions {
  /** Site root, for tests against a local server. Default https://www.funda.nl. */
  baseUrl?: string;
  /** Root of the listing summary API. Default https://listing-detail-summary.funda.io. */
  summaryUrl?: string;
  /** How long to wait for the confirmation after sending the form. Default 20 s. */
  confirmTimeoutMs?: number;
  /** After a plain request is refused, read pages in the browser for this long. Default 30 minutes. */
  browserStickyMs?: number;
}

const ALERT_DOMAINS = ['funda.nl'];

export function createFundaAdapter(options: FundaOptions = {}): SourceAdapter {
  const base = trimTrailingSlashes(options.baseUrl ?? 'https://www.funda.nl');
  const summaryBase = trimTrailingSlashes(options.summaryUrl ?? 'https://listing-detail-summary.funda.io');
  const confirmTimeoutMs = options.confirmTimeoutMs ?? 20_000;
  const stickyMs = options.browserStickyMs ?? 30 * 60_000;
  let browserUntil = 0;

  const contactUrlFor = (globalId: unknown) =>
    num(globalId) ? `${base}/makelaar-contact/?listingId=${num(globalId)}` : undefined;
  const imageUrl = (id: string) =>
    /^https?:/i.test(id) ? id : `https://cloud.funda.nl/${id.replace(/^\/+/, '')}?options=width=720`;

  /**
   * One Funda page: a plain request while Akamai allows it, else the
   * headless browser (which Akamai lets through today). After a refusal the
   * browser is used directly for `browserStickyMs`.
   */
  async function loadPage(url: string, ctx: SourceContext): Promise<{ html: string; url: string }> {
    if (ctx.now().getTime() >= browserUntil) {
      try {
        const res = await ctx.fetch(url);
        if (!AKAMAI_PAGE.test(res.text)) return { html: res.text, url: res.url || url };
      } catch (e) {
        if (!(e instanceof SourceBlockedError)) throw e;
      }
      browserUntil = ctx.now().getTime() + stickyMs;
      ctx.log.info('funda refused a plain request; reading pages in the browser for a while', {
        minutes: Math.round(stickyMs / 60_000),
      });
    }
    const session = await ctx.browser();
    try {
      const res = await session.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      const status = res?.status() ?? 200;
      if (status === 404 || status === 410)
        throw new SourceHttpError(`${url} returned HTTP ${status}`, { status, url });
      const html = await session.page.content();
      if (AKAMAI_PAGE.test(html) || status === 403 || status === 429) {
        throw new SourceBlockedError(`${url} showed Funda's bot check in the browser too`, {
          status,
          marker: 'akamai',
          url,
        });
      }
      return { html, url: session.page.url() };
    } finally {
      await session.close().catch(() => undefined);
    }
  }

  function toRaw(l: Record<string, unknown>): RawListing | undefined {
    const relative = str(l.object_detail_page_relative_url);
    const tinyId = relative ? fundaTinyId(relative) : undefined;
    if (!relative || !tinyId) return undefined;
    const status = (str(l.status) ?? 'none').toLowerCase();
    if (!OPEN_STATUS.has(status)) return undefined;
    if (NOT_A_HOME.has(str(l.object_type) ?? '')) return undefined;
    const a = isObj(l.address) ? l.address : {};
    const street = str(a.street_name);
    const number = str(a.house_number);
    const suffix = str(a.house_number_suffix);
    const price = isObj(l.price) ? l.price : {};
    const monthly = !price.rent_price_condition || price.rent_price_condition === 'per_month';
    const rent = monthly && Array.isArray(price.rent_price) ? positive(price.rent_price[0]) : undefined;
    const agent = Array.isArray(l.agent) ? l.agent.find(isObj) : undefined;
    const photos = Array.isArray(l.photo_image_id)
      ? l.photo_image_id.filter((x): x is string => typeof x === 'string')
      : [];
    const label = str(l.energy_label);
    const title =
      clean(`${street ?? ''} ${number ?? ''}${suffix ? ` ${suffix}` : ''}`) || titleFromPath(relative);
    return compact<RawListing>({
      sourceId: 'funda',
      externalId: tinyId,
      url: `${base}${relative}`,
      title,
      priceEur: rent,
      priceBasis: rent === undefined ? undefined : 'unknown',
      sizeM2: Array.isArray(l.floor_area) ? positive(l.floor_area[0]) : positive(l.floor_area),
      rooms: positive(l.number_of_rooms),
      bedrooms: positive(l.number_of_bedrooms),
      type: OBJECT_TYPE[str(l.object_type) ?? ''] ?? 'other',
      address: compact({
        street,
        houseNumber: number,
        addition: suffix,
        postcode: normalisePostcode(str(a.postal_code) ?? ''),
        city: str(a.city),
        municipality: str(a.municipality),
        neighbourhood: str(a.neighbourhood),
      }),
      images: photos.length ? photos.slice(0, 10).map(imageUrl) : undefined,
      energyLabel: label && label !== 'unknown' ? label.toUpperCase() : undefined,
      agent: agent
        ? compact({
            name: str(agent.name),
            url: str(agent.relative_url) ? `${base}${str(agent.relative_url)}` : undefined,
          })
        : undefined,
      contact: 'form',
      contactUrl: contactUrlFor(l.id),
      publishedAt: isoInstant(l.publish_date),
      language: 'nl',
      extra: compact({ globalId: num(l.id), project: isObj(l.project) ? true : undefined }),
    });
  }

  function titleFromPath(path: string): string {
    const slug = /\/[a-z]+-([a-z0-9-]+)\/\d{6,}\/?$/.exec(path)?.[1] ?? '';
    return clean(slug.replace(/-/g, ' ')).replace(/^\p{L}/u, (c) => c.toUpperCase());
  }

  /** Card fallback for a page without Nuxt data: the address link, price and features of each card. */
  function parseCards($: CheerioAPI): RawListing[] {
    const out: RawListing[] = [];
    $('a[data-testid="listingDetailsAddress"]').each((_, a) => {
      const link = $(a);
      const href = link.attr('href') ?? '';
      const tinyId = fundaTinyId(href);
      if (!tinyId) return;
      // The card is the largest element around this address link that holds no other listing.
      let card = link.parent();
      while (
        card.parent().length &&
        !card.parent().is('body') &&
        card.parent().find('a[data-testid="listingDetailsAddress"]').length === 1
      ) {
        card = card.parent();
      }
      const text = clean(card.text());
      if (/verhuurd|onder optie|onder voorbehoud|in onderhandeling/i.test(text)) return;
      const street = clean(link.find('span').first().text());
      const place = clean(link.find('div').last().text());
      const priceText = card
        .find('*')
        .filter((_i, el) => /€/.test($(el).text()) && $(el).children().length === 0)
        .first()
        .text();
      const price = parsePrice(priceText);
      const features = card
        .find('li')
        .toArray()
        .map((li) => clean($(li).text()));
      out.push(
        compact<RawListing>({
          sourceId: 'funda',
          externalId: tinyId,
          url: new URL(href, `${base}/`).toString(),
          title: street,
          priceEur: price.priceEur,
          priceBasis: price.priceEur === undefined ? undefined : 'unknown',
          sizeM2: parseSize(features.find((f) => /m²|m2/.test(f)) ?? ''),
          rooms: parseRooms(features.join(' ')),
          address: splitAddress(`${street}, ${place}`),
          contact: 'form',
          language: 'nl',
        }),
      );
    });
    return out;
  }

  function parseSearchPage(html: string): RawListing[] {
    const $ = load(html);
    const root = nuxtRoot($);
    const items = root ? findListings(root) : undefined;
    const out: RawListing[] = [];
    const seen = new Set<string>();
    const listings = items ? items.map(toRaw).filter((l): l is RawListing => Boolean(l)) : parseCards($);
    for (const l of listings) {
      if (seen.has(l.externalId)) continue;
      seen.add(l.externalId);
      out.push(l);
    }
    return out;
  }

  /** Reads the detail page's cached listing data into the listing. */
  function applyDetail(listing: RawListing, html: string, now: Date): RawListing {
    const $ = load(html);
    const root = nuxtRoot($);
    const data = isObj(root?.data) ? root.data : {};
    const key = Object.keys(data).find((k) => k.startsWith('cachedListingData'));
    const d = key && isObj(data[key]) ? data[key] : undefined;
    const out: RawListing = { ...listing, address: { ...listing.address }, extra: { ...listing.extra } };
    if (!d) return out;
    const extra = out.extra as Record<string, unknown>;
    const globalId = num(d.globalId);
    if (globalId) {
      extra.globalId = globalId;
      out.contactUrl ??= contactUrlFor(globalId);
    }
    if (d.isSoldOrRented === true) extra.soldOrRented = true;
    const description = isObj(d.description) ? str(d.description.content) : undefined;
    if (description) out.description = description;
    const addr = isObj(d.address) ? d.address : {};
    const postcode = normalisePostcode(str(addr.postcode) ?? '');
    if (postcode) out.address.postcode = postcode;
    out.address.houseNumber ??= str(addr.houseNumber);
    out.address.city ??= str(addr.city);
    if (isObj(addr.neighborhood)) out.address.neighbourhood ??= str(addr.neighborhood.name);
    if (isObj(d.coordinates)) {
      const lat = num(d.coordinates.lat);
      const lon = num(d.coordinates.lng);
      if (lat !== undefined && lon !== undefined) Object.assign(out.address, { lat, lon });
    }
    if (out.priceEur === undefined && isObj(d.price)) {
      const p = positive(d.price.numericPrice);
      if (p) out.priceEur = p;
    }
    const features = new Map<string, string>();
    const collect = (list: unknown) => {
      if (!Array.isArray(list)) return;
      for (const f of list) {
        if (!isObj(f)) continue;
        const label = str(f.Label) ?? str(f.Title);
        const value = str(f.Value);
        if (label && value && !features.has(label.toLowerCase())) features.set(label.toLowerCase(), value);
        collect(f.KenmerkenList);
      }
    };
    collect(d.features);
    const rentText = features.get('huurprijs');
    if (rentText) {
      if (
        /servicekosten\s+(inbegrepen|inclusief)|inclusief servicekosten|incl\.?\s*servicekosten/i.test(
          rentText,
        )
      )
        out.priceBasis = 'incl';
      else if (
        /exclusief servicekosten|excl\.?\s*servicekosten|servicekosten\s+(exclusief|niet inbegrepen)/i.test(
          rentText,
        )
      )
        out.priceBasis = 'excl';
      const service = /servicekosten[^€\d]{0,20}€\s*([\d.,]+)/i.exec(rentText)?.[1];
      const serviceEur = service ? parsePrice(`€ ${service}`).priceEur : undefined;
      if (serviceEur) out.serviceCostsEur = serviceEur;
    }
    const deposit = features.get('waarborgsom');
    const depositEur = deposit ? parsePrice(deposit).priceEur : undefined;
    if (depositEur) out.depositEur = depositEur;
    const acceptance = features.get('aanvaarding') ?? features.get('beschikbaar per');
    const available = acceptance ? parseDutchDate(acceptance, now) : undefined;
    if (available) out.availableFrom = available;
    const label = /^([A-G]\+*)/.exec(features.get('energielabel') ?? '')?.[1];
    if (label) out.energyLabel = label;
    const roomsText = features.get('aantal kamers');
    if (roomsText) {
      out.rooms ??= parseRooms(roomsText);
      out.bedrooms ??= parseBedrooms(roomsText);
    }
    out.sizeM2 ??= parseSize(features.get('wonen') ?? features.get('woonoppervlakte') ?? '');
    const kind = features.get('soort appartement') ?? features.get('soort woonhuis');
    const refined = kind ? detectType(kind) : undefined;
    if (refined === 'room' || refined === 'studio') out.type = refined;
    const furnishingText = [...features.entries()]
      .filter(([k]) => /interieur|specificaties|inrichting|oplevering/.test(k))
      .map(([, v]) => v)
      .join(' ');
    const furnishing = detectFurnishing(furnishingText || description || '');
    if (furnishing !== 'unknown') out.furnishing ??= furnishing;
    const contract = features.get('huurovereenkomst');
    if (contract) extra.contract = contract;
    if (isObj(d.objectInsights)) {
      const views = num(d.objectInsights.views);
      const saves = num(d.objectInsights.saves);
      if (views !== undefined) extra.views = views;
      if (saves !== undefined) extra.saves = saves;
    }
    const photos =
      isObj(d.media) && isObj(d.media.photos) && Array.isArray(d.media.photos.items)
        ? d.media.photos.items
        : [];
    const images = photos
      .map((p) => (isObj(p) ? str(p.id) : undefined))
      .filter((s): s is string => Boolean(s))
      .slice(0, 10)
      .map((id) => `https://cloud.funda.nl/valentina_media/${id}.jpg`);
    if (images.length) out.images = images;
    out.publishedAt ??= isoInstant(d.publicationDate);
    return out;
  }

  const adapter: SourceAdapter = {
    id: 'funda',
    name: 'Funda',
    homepage: 'https://www.funda.nl',
    regions: 'nl',
    defaultIntervalSec: 90, // Funda now needs a browser page load per check, so a little slower
    capabilities: {
      search: 'html',
      detail: true,
      contact: 'form',
      login: 'none',
      terms: 'forbids',
      browser: 'headless',
    },
    alertSenders: ['zoekopdracht@mail.funda.nl', 'funda.nl'],

    buildSearches(searches: NamedSearch[]): SearchRequest[] {
      const out = new Map<string, SearchRequest>();
      for (const search of searches) {
        const areas = searchMunicipalities(search).map(fundaArea);
        const selected = areas.length ? areas : ['nl'];
        const min = search.priceMinEur;
        const max = search.priceMaxEur;
        const price = min !== undefined || max !== undefined ? `${min ?? 0}-${max ?? ''}` : undefined;
        const kinds = objectTypes(search.types);
        const size = search.sizeMinM2 !== undefined ? `${search.sizeMinM2}-` : undefined;
        const rooms = search.roomsMin !== undefined ? `${search.roomsMin}-` : undefined;
        const params = [
          `selected_area=${q(selected)}`,
          price ? `price=${q(price)}` : '',
          kinds.length ? `object_type=${q(kinds)}` : '',
          size ? `floor_area=${q(size)}` : '',
          rooms ? `rooms=${q(rooms)}` : '',
          `availability=${q(['available'])}`,
          `sort=${q('date_down')}`,
        ].filter(Boolean);
        const url = `${base}/zoeken/huur?${params.join('&')}`;
        const key = `${selected.join(',')}?${filterKey({ price, types: kinds.join(','), size, rooms })}`;
        if (!out.has(key)) out.set(key, { key, label: `Funda ${selected.join(', ')}`, url });
      }
      return [...out.values()];
    },

    async search(req, ctx) {
      const { html } = await loadPage(req.url ?? `${base}/zoeken/huur?sort=${q('date_down')}`, ctx);
      const listings = parseSearchPage(html);
      ctx.log.debug('funda listings read', { count: listings.length });
      return listings;
    },

    async detail(listing, ctx) {
      const { html } = await loadPage(listing.url, ctx);
      return applyDetail(listing, html, ctx.now());
    },

    async isAvailable(listing, ctx) {
      const globalId = num(listing.extra?.globalId);
      if (globalId) {
        let summary: { isSoldOrRented?: boolean; tracking?: { values?: { listing_status?: string } } };
        try {
          summary = (
            await ctx.fetch(`${summaryBase}/api/v1/listing/nl/${globalId}`, {
              headers: { accept: 'application/json' },
            })
          ).json();
        } catch (e) {
          if (e instanceof SourceHttpError && (e.status === 404 || e.status === 410)) return false;
          throw e;
        }
        if (summary.isSoldOrRented === true) return false;
        const status = summary.tracking?.values?.listing_status?.toLowerCase();
        return !status || OPEN_STATUS.has(status);
      }
      try {
        const detailed = applyDetail(listing, (await loadPage(listing.url, ctx)).html, ctx.now());
        return detailed.extra?.soldOrRented !== true;
      } catch (e) {
        if (e instanceof SourceHttpError && (e.status === 404 || e.status === 410)) return false;
        throw e;
      }
    },

    async contact(listing, message, ctx) {
      let url = listing.contactUrl ?? contactUrlFor(listing.extra?.globalId);
      if (!url) {
        // Listings from alert emails only carry the tinyId; the detail page has the global id.
        url = (await adapter.detail!(listing, ctx)).contactUrl;
      }
      if (!url) return { ok: false, channel: 'form', error: 'no Funda listing id for the contact form' };
      return fillContactForm(url, message, ctx);
    },

    parseAlertEmail(mail: InboundMessage): RawListing[] {
      if (mail.channel !== 'email' || !senderIs(mail, ALERT_DOMAINS)) return [];
      const cards = alertCards(mail, (u) =>
        /(^|\.)funda\.nl$/i.test(u.hostname) && !/^(click|links?|email|mail)\./i.test(u.hostname)
          ? fundaTinyId(u.pathname)
          : undefined,
      );
      return cards.map((card) => {
        const text = card.lines.join('\n');
        const place = card.lines.find((l) => /\b[1-9]\d{3}\s?[A-Z]{2}\b/.test(l));
        const address = splitAddress(place ? `${card.title}, ${place}` : card.title);
        const priceLine = card.lines.find((l) => /€|\beur\b/i.test(l)) ?? '';
        const price = parsePrice(priceLine);
        const featureLine = card.lines.find((l) => /m²|m2|kamers?\b/i.test(l)) ?? '';
        const kind = /\/(?:detail\/huur\/[^/]+\/|huur\/[^/]+\/)([a-z]+)-/.exec(card.url.pathname)?.[1];
        const label = /energielabel\s+([A-G]\+*)/i.exec(text)?.[1];
        return compact<RawListing>({
          sourceId: 'funda',
          externalId: card.id,
          url: `https://www.funda.nl${card.url.pathname.endsWith('/') ? card.url.pathname : `${card.url.pathname}/`}`,
          title: card.title,
          priceEur: price.priceEur,
          priceBasis: price.priceEur === undefined ? undefined : price.basis,
          sizeM2: parseSize(featureLine),
          rooms: parseRooms(featureLine),
          bedrooms: parseBedrooms(featureLine),
          type: kind === 'huis' ? 'house' : kind === 'appartement' ? 'apartment' : detectType(card.title),
          address,
          energyLabel: label?.toUpperCase(),
          images: card.image ? [card.image] : undefined,
          contact: 'form',
          language: 'nl',
          extra: { via: 'alert', alertMessageId: mail.id },
        });
      });
    },
  };

  /**
   * Fills Funda's guest form in the headless browser. Nothing is sent in a
   * dry run. A validation message under a field means the form was not
   * sent; no confirmation after sending means a person should check.
   */
  async function fillContactForm(
    url: string,
    message: OutboundMessage,
    ctx: SourceContext,
  ): Promise<ContactResult> {
    const p = message.profile;
    const missing = [!p.email && 'email', !p.firstName && 'first name', !p.lastName && 'last name'].filter(
      Boolean,
    );
    if (missing.length)
      return {
        ok: false,
        channel: 'form',
        error: `the profile has no ${missing.join(', ')}; Funda's form needs them`,
      };
    const session = await ctx.browser();
    const { page } = session;
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      const host = new URL(page.url()).host;
      if (
        /^login\./i.test(host) ||
        /\/(login|inloggen|account\/login)\b/i.test(new URL(page.url()).pathname)
      ) {
        throw new NeedsLoginError('Funda asked for a login before its contact form', {
          loginUrl: page.url(),
        });
      }
      if (AKAMAI_PAGE.test(await page.content())) {
        return {
          ok: false,
          channel: 'form',
          needs: 'captcha',
          error: `Funda showed its bot check on ${url}`,
        };
      }
      await dismissConsent(page);
      const ready = await page
        .locator('#questionInput')
        .first()
        .waitFor({ state: 'visible', timeout: 15_000 })
        .then(() => true)
        .catch(() => false);
      if (await showsCaptcha(page))
        return {
          ok: false,
          channel: 'form',
          needs: 'captcha',
          error: `the Funda form on ${url} shows a captcha`,
        };
      if (!ready)
        return {
          ok: false,
          channel: 'form',
          needs: 'human',
          error: `the Funda contact form did not appear on ${url}`,
        };

      const phone = (p.phone ?? '').replace(/[^\d+]/g, '').slice(0, 15);
      const values: [string, string][] = [
        ['#questionInput', message.body],
        ['#emailAddress', p.email],
        ['#firstName', p.firstName],
        ['#lastName', p.lastName],
      ];
      if (phone) values.push(['#phoneNumber', phone]);
      try {
        for (const [selector, value] of values)
          await page.locator(selector).first().fill(value, { timeout: 10_000 });
      } catch (e) {
        return {
          ok: false,
          channel: 'form',
          error: `could not fill the Funda form on ${url}: ${firstLine(e)}`,
        };
      }
      if (message.dryRun)
        return { ok: true, channel: 'form', evidence: 'dry run: the form was filled and not sent' };

      try {
        await page
          .locator('form:has(#questionInput) button[type="submit"]')
          .first()
          .click({ timeout: 10_000 });
      } catch (e) {
        return { ok: false, channel: 'form', error: `could not press send on ${url}: ${firstLine(e)}` };
      }
      const confirmation = await waitForConfirmation(page, {
        success:
          /bedankt|verstuurd|verzonden|gelukt|we hebben je (bericht|vraag|aanvraag)|thank you|message (has been )?sent/i,
        successUrl: /bedankt|bevestig|verzonden|success/i,
        timeoutMs: confirmTimeoutMs,
        failure: async () => {
          const errors = await page
            .locator('[id$="-error"]')
            .allInnerTexts()
            .catch(() => [] as string[]);
          const text = errors.map(clean).filter(Boolean).join('; ');
          return text || undefined;
        },
      });
      if (confirmation?.failed)
        return { ok: false, channel: 'form', error: `Funda did not accept the form: ${confirmation.text}` };
      if (!confirmation) {
        return {
          ok: false,
          channel: 'form',
          needs: 'human',
          error: `sent the Funda form on ${url} but no confirmation appeared; check before sending again`,
        };
      }
      return { ok: true, channel: 'form', evidence: confirmation.text.slice(0, 200) };
    } finally {
      await session.close().catch(() => undefined);
    }
  }

  return adapter;
}

/** Declines Funda's Didomi consent banner when it covers the page. */
async function dismissConsent(page: Page): Promise<void> {
  const button = await firstVisible(page, [
    '#didomi-notice-disagree-button',
    'button:has-text("Alles weigeren")',
  ]);
  if (button)
    await page
      .locator(button)
      .first()
      .click({ timeout: 5_000 })
      .catch(() => undefined);
  else if (/Alles weigeren/.test(await pageText(page))) {
    await page
      .getByRole('button', { name: /alles weigeren/i })
      .first()
      .click({ timeout: 5_000 })
      .catch(() => undefined);
  }
}

export const funda = createFundaAdapter();
