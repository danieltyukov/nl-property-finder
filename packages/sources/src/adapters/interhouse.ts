import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import type { Furnishing, NamedSearch, PropertyType, RawListing, SearchRequest, SourceAdapter, SourceConfig } from '@nlpf/core';
import { trimTrailingSlashes } from '@nlpf/core';
import { createAgencyAdapter } from '../generic/agency.js';
import { UNAVAILABLE_STATUS } from '../generic/presets.js';
import { SourceHttpError } from '../runtime/errors.js';
import { normalisePostcode, splitAddress } from '../util/address.js';
import { detectFurnishing, detectType, parseBedrooms, parseDutchDate, parsePrice, parseRooms, parseSize } from '../util/parse.js';

/*
 * Interhouse: furnished and upholstered rentals for expats, first come,
 * first served ("wie het eerst komt, die het eerst maalt", REPORTED). The
 * /aanbod/ page now loads its results with a WordPress AJAX action,
 * building_results_action, whose query takes the city, a price step and
 * sort=date-desc and filters on the server (VERIFIED 2026-09-24). Viewings
 * are requested with a Gravity Forms form on the listing page that needs no
 * login and shows no captcha (VERIFIED markup, never submitted); it is sent
 * with the generic agency form filler.
 */

const BASE = 'https://interhouse.nl';
export const INTERHOUSE_AJAX = `${BASE}/wp-admin/admin-ajax.php`;
/** Steps of the maximum_price select. */
const PRICE_STEPS = [900, 1000, 1250, 1500, 1750, 2000, 3000, 4000, 5000, 6000];

/** Towns with an Interhouse office and their neighbours. */
const REGIONS = [
  'almere', 'amersfoort', 'amstelveen', 'amsterdam', 'breda', 'de bilt', 'delft', 'den haag', "'s-gravenhage", 'diemen', 'eindhoven',
  'gooise meren', 'haarlem', 'haarlemmermeer', 'heemstede', 'hilversum', 'huizen', 'leiden', 'leidschendam-voorburg', 'nieuwegein', 'oegstgeest',
  'rijswijk', 'rotterdam', 'teylingen', 'utrecht', 'wassenaar', 'zeist', 'zoetermeer',
];

const clean = (s: string | undefined) => (s ?? '').replace(/[\s ]+/g, ' ').trim();

function coveredCities(searches: NamedSearch[]): string[] | null {
  const all = new Set<string>();
  for (const s of searches) {
    if (s.enabled === false) continue;
    if (s.regions.length === 0) return null;
    for (const r of s.regions) {
      if (r.municipalities.length === 0) return null;
      for (const m of r.municipalities) if (m.trim()) all.add(m.trim());
    }
  }
  const covered = [...all].filter((m) => REGIONS.includes(m.toLowerCase()));
  return covered.length ? covered : [...all];
}

function maxPrice(searches: NamedSearch[]): number | undefined {
  let max = 0;
  for (const s of searches) {
    if (s.enabled === false) continue;
    if (s.priceMaxEur === undefined) return undefined;
    max = Math.max(max, s.priceMaxEur);
  }
  return max > 0 ? max : undefined;
}

const keyOf = (city: string) =>
  city
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** The results action query for a city (or everything), as the site's own search form builds it. */
function resultsQuery(city: string | undefined, step: number | undefined): string {
  const q = new URLSearchParams({ offer: 'huur' });
  if (city) {
    q.set('search_terms', city);
    q.set('search_type', 'city');
    q.set('search_city', city);
  }
  if (step !== undefined) q.set('maximum_price', String(step));
  q.set('number_of_results', '18');
  q.set('sort', 'date-desc');
  q.set('display', 'grid');
  q.set('paging', '1');
  q.set('language', 'nl_NL');
  return `?${q}`;
}

/** A search URL someone copied from the site: /aanbod/?offer=huur&..., or /aanbod/huur/<city>/. */
function queryFromUrl(url: string): string {
  const u = new URL(url);
  const q = new URLSearchParams(u.search);
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts[0] === 'aanbod' && parts[1]) q.set('offer', parts[1]);
  if (parts[0] === 'aanbod' && parts[2]) {
    q.set('search_terms', parts[2]);
    q.set('search_type', 'city');
    q.set('search_city', parts[2]);
  }
  if (!q.has('offer')) q.set('offer', 'huur');
  if (!q.has('sort')) q.set('sort', 'date-desc');
  return `?${q}`;
}

function extraUrls(source: SourceConfig): SearchRequest[] {
  return source.searchUrls.map((url) => ({
    key: `url-${createHash('sha1').update(url).digest('hex').slice(0, 10)}`,
    label: `Interhouse: ${url}`,
    url: INTERHOUSE_AJAX,
    params: { query: queryFromUrl(url) },
  }));
}

function furnishingOf(text: string): Furnishing | undefined {
  if (/^gedeeltelijk/i.test(text.trim())) return 'upholstered';
  const f = detectFurnishing(text);
  return f === 'unknown' ? undefined : f;
}

const TYPES: Record<string, PropertyType> = { woning: 'house', appartement: 'apartment', studio: 'studio', kamer: 'room' };
const NOT_HOMES = /bog|bedrijf|kantoor|winkel|parkeer|garage|berging/i;

/** Reads the result cards the results action returns. */
export function parseInterhouseResults(html: string, now: Date = new Date()): RawListing[] {
  const $ = load(html);
  const out: RawListing[] = [];
  $('a.c-result-item').each((_, el) => {
    const card = $(el);
    const href = card.attr('href');
    if (!href) return;
    const kind = clean(card.find('.c-result-item__title-type').text()).replace(/\s*te huur$/i, '');
    if (NOT_HOMES.test(kind)) return;
    const status = clean(card.find('.building-status').text()).toLowerCase();
    const labels = clean(card.find('.c-result-item__image-label').text()).toLowerCase();
    if (UNAVAILABLE_STATUS.some((w) => status.includes(w) || labels.includes(w))) return;
    const url = new URL(href, BASE).toString();
    const addressText = clean(card.find('.c-result-item__title-address').text());
    const city = clean(card.find('.c-result-item__location-label').text());
    const address = { ...splitAddress(addressText), ...(city ? { city } : {}) };
    const values = card
      .find('.c-result-item__data-value')
      .toArray()
      .map((v) => clean($(v).text()));
    const price = parsePrice(`${clean(card.find('.c-result-item__price-label').text())} ${clean(card.find('.c-result-item__price-notes').text())}`);
    const date = values.find((v) => /^\d{2}-\d{2}-\d{4}$/.test(v) || /per direct/i.test(v));
    const bedrooms = values.find((v) => /^\d{1,2}$/.test(v));
    const furnishing = values.map((v) => furnishingOf(v)).find(Boolean);
    const image = /url\(([^)]+)\)/.exec(card.find('.c-result-item__image').attr('style') ?? '')?.[1]?.replace(/^['"]|['"]$/g, '');
    const path = trimTrailingSlashes(new URL(url).pathname);
    const listing: RawListing = {
      sourceId: 'interhouse',
      externalId: path,
      url,
      title: [addressText, city].filter(Boolean).join(', ') || url,
      priceEur: price.priceEur,
      priceBasis: price.priceEur !== undefined ? price.basis : undefined,
      sizeM2: parseSize(values.find((v) => /m\s*2|m²/i.test(v)) ?? ''),
      bedrooms: bedrooms ? Number(bedrooms) : undefined,
      type: TYPES[kind.toLowerCase()] ?? detectType(kind),
      furnishing,
      address,
      availableFrom: date ? parseDutchDate(date, now) : undefined,
      images: image ? [new URL(image, BASE).toString()] : undefined,
      agent: { name: 'Interhouse', url: BASE },
      contact: 'form',
      contactUrl: url,
      language: 'nl',
    };
    for (const k of Object.keys(listing) as (keyof RawListing)[]) if (listing[k] === undefined) delete listing[k];
    out.push(listing);
  });
  return out;
}

/** Adds the full address (from the page's propertyData), deposit, rooms, energy label, description and branch email. */
export function parseInterhouseDetail(listing: RawListing, html: string, now: Date = new Date()): RawListing {
  const $ = load(html);
  const out: RawListing = { ...listing, address: { ...listing.address } };
  const data = /var propertyData = (\{[^;]*\});/.exec(html)?.[1];
  if (data) {
    try {
      const p = JSON.parse(data) as Record<string, string | undefined>;
      if (p.address_1) out.address.street = p.address_1.trim();
      if (p.house_number && /^\d+$/.test(p.house_number.trim())) out.address.houseNumber = p.house_number.trim();
      // house_number_addition sometimes holds the office reference ("HLV-6442"); only short values are additions.
      const addition = p.house_number_addition?.trim();
      if (addition && /^[A-Za-z0-9]{1,4}$/.test(addition)) out.address.addition = addition.toUpperCase();
      const postcode = normalisePostcode(p.zipcode ?? '');
      if (postcode) out.address.postcode = postcode;
      if (p.city) out.address.city = p.city.trim();
    } catch {
      // the table below still has most of it
    }
  }
  const facts = new Map<string, string>();
  $('.property-data-table dl').each((_, dl) => {
    $(dl)
      .find('dt')
      .each((__, dt) => {
        const key = clean($(dt).text()).toLowerCase();
        if (key && !facts.has(key)) facts.set(key, clean($(dt).next('dd').text()));
      });
  });
  if (!out.address.postcode) {
    const postcode = normalisePostcode(facts.get('postcode') ?? '');
    if (postcode) out.address.postcode = postcode;
  }
  const deposit = parsePrice(facts.get('waarborgsom') ?? '').priceEur;
  if (deposit !== undefined) out.depositEur = deposit;
  const rooms = parseRooms(facts.get('aantal kamers') ?? '');
  if (rooms !== undefined) out.rooms = rooms;
  const bedrooms = parseBedrooms(facts.get('aantal slaapkamers') ?? '');
  if (bedrooms !== undefined) out.bedrooms ??= bedrooms;
  const label = facts.get('energieklasse');
  if (label && /^[A-G]\+*$/i.test(label)) out.energyLabel = label.toUpperCase();
  const furnishing = furnishingOf(facts.get('interieur') ?? '');
  if (furnishing) out.furnishing = furnishing;
  const start = facts.get('aanvaardingsdatum');
  const date = start ? parseDutchDate(start, now) : undefined;
  if (date) out.availableFrom = date;
  const size = parseSize(facts.get('woonoppervlakte') ?? '');
  if (size !== undefined) out.sizeM2 ??= size;

  const content = $('.property-description .property-content').first().clone();
  content.find('p').each((_, p) => {
    $(p).append('\n\n');
  });
  content.find('br').replaceWith('\n');
  const description = content
    .text()
    .split('\n')
    .map((l) => clean(l))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (description) out.description = description;

  const email = $('input[name="input_6"]').attr('value')?.trim();
  if (email && /@/.test(email)) out.agent = { ...out.agent, email };
  return out;
}

export interface InterhouseOptions {
  /** How long to wait for the confirmation after sending the viewing form. Default 20 s. */
  confirmTimeoutMs?: number;
}

export function createInterhouseAdapter(opts: InterhouseOptions = {}): SourceAdapter {
  // The viewing form is sent by the generic agency form filler; only its
  // selectors are specific to Interhouse (Gravity Forms form 12).
  const form = createAgencyAdapter(
    {
      id: 'interhouse',
      name: 'Interhouse',
      homepage: BASE,
      list: { url: `${BASE}/aanbod/?offer=huur`, format: 'html', item: 'a.c-result-item', fields: { url: { attr: 'href' } } },
      contact: {
        kind: 'form',
        url: '{url}',
        form: {
          firstName: '#gform_12 input[name="input_3"]',
          lastName: '#gform_12 input[name="input_14"]',
          email: '#gform_12 input[name="input_4"]',
          phone: '#gform_12 input[name="input_5"]',
          message: '#gform_12 textarea[name="input_1"]:visible, #gform_12 textarea[name="input_24"]:visible',
          submit: '#gform_submit_button_12',
          success: '.gform_confirmation_message, #gform_confirmation_message_12',
        },
      },
    },
    { confirmTimeoutMs: opts.confirmTimeoutMs },
  );

  return {
    id: 'interhouse',
    name: 'Interhouse',
    homepage: BASE,
    regions: REGIONS,
    // First come, first served: poll often.
    defaultIntervalSec: 180,
    capabilities: { search: 'html', detail: true, contact: 'form', login: 'none', terms: 'unknown' },

    buildSearches(searches, source) {
      const cities = coveredCities(searches);
      const max = maxPrice(searches);
      const step = max === undefined ? undefined : PRICE_STEPS.find((p) => p >= max);
      const reqs: SearchRequest[] =
        cities === null
          ? [{ key: 'nl', label: 'Interhouse: alle huurwoningen', url: INTERHOUSE_AJAX, params: { query: resultsQuery(undefined, step) } }]
          : [...new Map(cities.map((c) => [keyOf(c), c])).entries()].map(([key, city]) => ({
              key,
              label: `Interhouse: ${city}`,
              url: INTERHOUSE_AJAX,
              params: { query: resultsQuery(city, step) },
            }));
      return [...reqs, ...extraUrls(source)];
    },

    async search(req, ctx) {
      const query = String(req.params?.query ?? resultsQuery(undefined, undefined));
      const res = await ctx.fetch(req.url ?? INTERHOUSE_AJAX, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'x-requested-with': 'XMLHttpRequest',
          referer: `${BASE}/aanbod/${query}`,
        },
        body: new URLSearchParams({ action: 'building_results_action', query }),
      });
      return parseInterhouseResults(res.text, ctx.now());
    },

    async detail(listing, ctx) {
      const res = await ctx.fetch(listing.url);
      return parseInterhouseDetail(listing, res.text, ctx.now());
    },

    async isAvailable(listing, ctx) {
      try {
        const res = await ctx.fetch(listing.url);
        if (new URL(res.url || listing.url).pathname !== new URL(listing.url).pathname) return false;
        const $ = load(res.text);
        const status = clean($('.c-sale-status').first().text()).toLowerCase();
        return !UNAVAILABLE_STATUS.some((w) => status.includes(w));
      } catch (e) {
        if (e instanceof SourceHttpError && (e.status === 404 || e.status === 410)) return false;
        throw e;
      }
    },

    async contact(listing, message, ctx) {
      // The form requires a phone number; without one it would not send and
      // the result would look like a lost confirmation.
      if (!message.profile.phone?.trim()) {
        return { ok: false, channel: 'form', error: 'the Interhouse viewing form requires a phone number; add one to the profile' };
      }
      return form.contact!(listing, message, ctx);
    },
  };
}
