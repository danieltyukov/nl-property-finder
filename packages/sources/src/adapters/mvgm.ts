import { createHash } from 'node:crypto';
import { load, type CheerioAPI } from 'cheerio';
import type { NamedSearch, RawListing, SearchRequest, SourceAdapter, SourceConfig } from '@nlpf/core';
import { trimTrailingSlashes } from '@nlpf/core';
import { UNAVAILABLE_STATUS } from '../generic/presets.js';
import { checkPortalSession, requestViewing, type ViewingRequestPortal } from '../generic/viewing-request.js';
import { SourceHttpError } from '../runtime/errors.js';
import { splitAddress } from '../util/address.js';
import { detectType, parseBedrooms, parseDutchDate, parsePrice, parseSize } from '../util/parse.js';

/*
 * MVGM (ikwilhuren.nu). Server-rendered cards at /aanbod/<city>/ sorted
 * newest first with ?sort=aanbodDESC (VERIFIED 2026-09-24). The price,
 * size and type filters are posted into the session with a CSRF token, so
 * only the city goes in the URL; a GET price parameter is ignored
 * (VERIFIED). Reacting is a viewing request in a free account, on the portal
 * MVGM shares with Vesteda (generic/viewing-request.ts): the object URL ends
 * in the id of /bezichtigingsaanvraag/<id>/ (VERIFIED 2026-09-26).
 */

const BASE = 'https://ikwilhuren.nu';
const AGENT = { name: 'MVGM', url: BASE };

const clean = (s: string | undefined) => (s ?? '').replace(/[\s ]+/g, ' ').trim();

function slug(city: string): string {
  const s = city
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s === 's-gravenhage' ? 'den-haag' : s;
}

/** Municipalities of the enabled searches, or null when one of them covers the whole country. */
function searchCities(searches: NamedSearch[]): string[] | null {
  const out = new Set<string>();
  for (const s of searches) {
    if (s.enabled === false) continue;
    if (s.regions.length === 0) return null;
    for (const r of s.regions) {
      if (r.municipalities.length === 0) return null;
      for (const m of r.municipalities) if (m.trim()) out.add(m.trim());
    }
  }
  return [...out];
}

function extraUrls(source: SourceConfig, label: string): SearchRequest[] {
  return source.searchUrls.map((url) => ({
    key: `url-${createHash('sha1').update(url).digest('hex').slice(0, 10)}`,
    label: `${label}: ${url}`,
    url,
  }));
}

/** The 32-character hash at the end of an object URL, which stays the same when the slug changes. */
function objectId(url: string): string {
  const path = trimTrailingSlashes(new URL(url).pathname);
  return /-([0-9a-f]{32})$/.exec(path)?.[1] ?? path;
}

/** The viewing-request portal: the application page's id is the one at the end of the object URL. */
const PORTAL: ViewingRequestPortal = {
  name: 'MVGM',
  base: BASE,
  requestPath: (listing) => {
    const id = objectId(listing.url);
    return /^[0-9a-f]{32}$/.test(id) ? `/bezichtigingsaanvraag/${id}/` : undefined;
  },
};

const unavailable = (status: string) => UNAVAILABLE_STATUS.some((w) => status.toLowerCase().includes(w));

/** Reads the result cards of an /aanbod/ page. */
export function parseMvgmList(html: string, now: Date = new Date()): RawListing[] {
  const $ = load(html);
  const out: RawListing[] = [];
  $('.card.card-woning').each((_, el) => {
    const card = $(el);
    // The status badge is the one with a coloured dot; others carry notes such as upholstery costs.
    const status = clean(card.find('.badges .badge').has('.status-dot').first().text());
    if (unavailable(status)) return;
    const link = card.find('.card-title a').first();
    const href = link.attr('href');
    if (!href) return;
    const url = new URL(href, BASE).toString();
    const title = clean(link.text());
    // The image alt is the address alone; the title starts with the type.
    const addressText = clean(card.find('.card-img-top img').attr('alt')) || title;
    const address = splitAddress(addressText);
    // "3012AH Rotterdam", with " - 1Km." on city pages.
    const place = splitAddress(clean(card.find('.card-body > span').eq(1).text()).replace(/\s+-\s+[\d.,]+\s*km\.?$/i, ''));
    if (place.postcode) address.postcode = place.postcode;
    if (place.city) address.city = place.city;
    // "Direct beschikbaar" or "Beschikbaar vanaf 01-12-2026".
    const available = clean(card.find('.card-body .small > span').first().text());
    const since = /Sinds\s+([\d.]+)\s+dagen online/i.exec(card.find('[title^="Sinds"]').attr('title') ?? '')?.[1];
    const spans = card.find('.dotted-spans > span').toArray().map((s) => clean($(s).text()));
    const price = parsePrice(spans.find((s) => s.includes('€')) ?? '');
    const image = card.find('.card-img-top img').attr('src');
    out.push(
      compact<RawListing>({
        sourceId: 'mvgm',
        externalId: objectId(url),
        url,
        title: addressText,
        priceEur: price.priceEur,
        // The card shows the bare rent; the detail page lists service costs apart.
        priceBasis: price.priceEur !== undefined ? 'excl' : undefined,
        sizeM2: parseSize(spans.find((s) => /m2|m²/i.test(s)) ?? ''),
        bedrooms: parseBedrooms(spans.find((s) => /slaapkamer/i.test(s)) ?? ''),
        type: detectType(title),
        address,
        availableFrom: available ? parseDutchDate(available, now) : undefined,
        images: image ? [new URL(image, BASE).toString()] : undefined,
        publishedAt: since ? new Date(now.getTime() - Number(since) * 86_400_000).toISOString() : undefined,
        agent: { ...AGENT },
        contact: 'form',
        language: 'nl',
      }),
    );
  });
  return out;
}

function row($: CheerioAPI, label: string): string | undefined {
  const th = $('table th')
    .toArray()
    .find((t) => clean($(t).text()).toLowerCase() === label.toLowerCase());
  return th ? clean($(th).next('td').text()) : undefined;
}

/** Fills a listing from its /object/ page: description, service costs, deposit, energy label and availability. */
export function parseMvgmDetail(listing: RawListing, html: string, now: Date = new Date()): RawListing {
  const $ = load(html);
  const out: RawListing = { ...listing, address: { ...listing.address } };
  const paragraph = $('.object-description').first().find('p').first().clone();
  paragraph.find('br').replaceWith('\n');
  const description = paragraph
    .text()
    .split('\n')
    .map((l) => clean(l))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (description) out.description = description;
  const service = parsePrice(row($, 'Servicekosten') ?? '').priceEur;
  if (service !== undefined) out.serviceCostsEur = service;
  const deposit = parsePrice(row($, 'Waarborg') ?? '').priceEur;
  if (deposit !== undefined) out.depositEur = deposit;
  const label = row($, 'Energielabel');
  if (label && /^[A-G]\+*$/i.test(label)) out.energyLabel = label.toUpperCase();
  const size = parseSize(row($, 'Woonoppervlakte') ?? '');
  if (size !== undefined) out.sizeM2 ??= size;
  const bedrooms = parseBedrooms(row($, 'Slaapkamers') ?? '');
  if (bedrooms !== undefined) out.bedrooms ??= bedrooms;
  const available = row($, 'Beschikbaar vanaf');
  const date = available ? parseDutchDate(available, now) : undefined;
  if (date) out.availableFrom = date;
  const heading = splitAddress(clean($('.object-addres h1').first().text()).replace(/^Te huur:\s*/i, ''));
  const place = splitAddress(clean($('.object-addres p').first().text()).replace(/\(.*\)/, ''));
  if (heading.houseNumber && !out.address.houseNumber) Object.assign(out.address, heading);
  if (place.postcode) out.address.postcode = place.postcode;
  const images = $('[data-src*="/media/"]')
    .toArray()
    .map((e) => $(e).attr('data-src'))
    .filter((s): s is string => Boolean(s))
    .map((s) => new URL(s, BASE).toString());
  if (images.length) out.images = [...new Set(images)];
  return out;
}

function compact<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
  return o;
}

export function createMvgmAdapter(): SourceAdapter {
  return {
    id: 'mvgm',
    name: 'MVGM (ikwilhuren.nu)',
    homepage: BASE,
    regions: 'nl',
    defaultIntervalSec: 300,
    capabilities: { search: 'html', detail: true, contact: 'form', login: 'required', terms: 'unknown' },
    loginUrl: `${BASE}/account/`,

    buildSearches(searches, source) {
      const cities = searchCities(searches);
      const reqs: SearchRequest[] =
        cities === null
          ? [{ key: 'nl', label: 'MVGM: heel Nederland', url: `${BASE}/aanbod/?sort=aanbodDESC` }]
          : [...new Map(cities.map((c) => [slug(c), c])).entries()].map(([s, city]) => ({
              key: s,
              label: `MVGM: ${city}`,
              url: `${BASE}/aanbod/${s}/?sort=aanbodDESC`,
            }));
      return [...reqs, ...extraUrls(source, 'MVGM')];
    },

    async search(req, ctx) {
      const res = await ctx.fetch(req.url ?? `${BASE}/aanbod/?sort=aanbodDESC`);
      return parseMvgmList(res.text, ctx.now());
    },

    async detail(listing, ctx) {
      const res = await ctx.fetch(listing.url);
      return parseMvgmDetail(listing, res.text, ctx.now());
    },

    async checkSession(ctx) {
      const session = await ctx.browser();
      try {
        return await checkPortalSession(session.page, PORTAL);
      } finally {
        await session.close().catch(() => undefined);
      }
    },

    contact: (listing, message, ctx) => requestViewing(PORTAL, listing, message, ctx),

    async isAvailable(listing, ctx) {
      try {
        const res = await ctx.fetch(listing.url);
        if (!new URL(res.url || listing.url).pathname.startsWith('/object/')) return false;
        const $ = load(res.text);
        return !unavailable(row($, 'Status') ?? '');
      } catch (e) {
        if (e instanceof SourceHttpError && (e.status === 404 || e.status === 410)) return false;
        throw e;
      }
    },
  };
}
