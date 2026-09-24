import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import type { NamedSearch, RawListing, SearchRequest, SourceAdapter, SourceConfig } from '@nlpf/core';
import { UNAVAILABLE_STATUS } from '../generic/presets.js';
import { SourceHttpError } from '../runtime/errors.js';
import { normalisePostcode } from '../util/address.js';
import { detectFurnishing, detectType, parseBedrooms, parseDutchDate, parsePrice, parseRooms, parseSize } from '../util/parse.js';

/*
 * Rotsvast: a rental agent with branches across the country, on WordPress
 * with listings imported from Realworks. /huren/ has server-rendered cards
 * and a GET search form (search, radius, price_to; VERIFIED 2026-09-24).
 * The contact form on a listing requires the applicant's home address (not
 * in the profile) and runs reCAPTCHA v3, so the agent is contacted by email
 * at the branch shown on the listing page, which detail() reads together
 * with the full address from the form's hidden listing fields.
 */

const BASE = 'https://www.rotsvast.nl';
/** Steps of the price_to select on /huren/. */
const PRICE_STEPS = [500, 750, 1000, 1250, 1500, 2000, 2500, 3000, 4000, 5000];

/** Branch towns (the department select on /huren/) and a few neighbours. */
const REGIONS = [
  'alphen aan den rijn', 'amersfoort', 'amstelveen', 'amsterdam', 'bergen op zoom', 'breda', 'delft', 'den bosch', "'s-hertogenbosch", 'den haag',
  "'s-gravenhage", 'dordrecht', 'eindhoven', 'gouda', 'groningen', 'haarlem', 'hilversum', 'leeuwarden', 'leiden', 'leidschendam-voorburg',
  'maastricht', 'middelburg', 'nijmegen', 'purmerend', 'rijswijk', 'roermond', 'rotterdam', 'schiedam', 'tilburg', 'utrecht', 'zoetermeer',
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

function extraUrls(source: SourceConfig): SearchRequest[] {
  return source.searchUrls.map((url) => ({
    key: `url-${createHash('sha1').update(url).digest('hex').slice(0, 10)}`,
    label: `Rotsvast: ${url}`,
    url,
  }));
}

const keyOf = (city: string) =>
  city
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** Reads the cards of a /huren/ page. */
export function parseRotsvastList(html: string, pageUrl: string, now: Date = new Date()): RawListing[] {
  const $ = load(html);
  const out: RawListing[] = [];
  $('a.card.card--house').each((_, el) => {
    const card = $(el);
    if (card.hasClass('card--house-map')) return;
    const href = card.attr('href');
    if (!href || href.includes('{{')) return;
    const label = clean(card.find('.card-house__label').text()).toLowerCase();
    if (UNAVAILABLE_STATUS.some((w) => label.includes(w))) return;
    const url = new URL(href, pageUrl).toString();
    const texts = card.find('.card-house__text').toArray().map((t) => clean($(t).text()));
    const city = texts[0];
    const street = clean(card.find('.card-house__title').text());
    const item = (icon: string) => clean(card.find(`.card-house__list li:has(i.${icon})`).first().text());
    const price = parsePrice(texts.find((t) => t.includes('€')) ?? '');
    const furnishing = detectFurnishing(item('icon-door'));
    const available = item('icon-clock');
    const image = card.find('.card-house__image img').attr('src');
    const listing: RawListing = {
      sourceId: 'rotsvast',
      externalId: /-(h\d+)\/?$/i.exec(new URL(url).pathname)?.[1]?.toUpperCase() ?? new URL(url).pathname,
      url,
      title: [street, city].filter(Boolean).join(', ') || url,
      priceEur: price.priceEur,
      priceBasis: price.priceEur !== undefined ? price.basis : undefined,
      sizeM2: parseSize(item('icon-surface')),
      bedrooms: parseBedrooms(item('icon-bed')),
      furnishing: furnishing === 'unknown' ? undefined : furnishing,
      address: { ...(street ? { street } : {}), ...(city ? { city } : {}) },
      availableFrom: available ? parseDutchDate(available, now) : undefined,
      images: image ? [new URL(image, BASE).toString()] : undefined,
      agent: { name: 'Rotsvast', url: BASE },
      contact: 'email',
      language: 'nl',
    };
    for (const k of Object.keys(listing) as (keyof RawListing)[]) if (listing[k] === undefined) delete listing[k];
    out.push(listing);
  });
  return out;
}

/** Adds the full address (from the contact form's hidden listing fields), deposit, rooms and the branch contact. */
export function parseRotsvastDetail(listing: RawListing, html: string, now: Date = new Date()): RawListing {
  const $ = load(html);
  const out: RawListing = { ...listing, address: { ...listing.address } };
  const values = new URLSearchParams($('input[name="gform_field_values"]').first().attr('value') ?? '');
  const street = values.get('listing_street_value')?.trim();
  const number = values.get('listing_number_value')?.trim();
  const postcode = normalisePostcode(values.get('listing_zipcode_value') ?? '');
  const city = values.get('listing_city_value')?.trim();
  if (street) out.address.street = street;
  if (number && /^\d+/.test(number)) {
    const m = /^(\d+)\s*[-\s]?\s*(.*)$/.exec(number);
    out.address.houseNumber = m?.[1] ?? number;
    if (m?.[2]) out.address.addition = m[2].toUpperCase();
  }
  if (postcode) out.address.postcode = postcode;
  if (city) out.address.city = city;

  const features = new Map<string, string>();
  $('.house-features li').each((_, li) => {
    const key = clean($(li).children('span').first().contents().first().text()).toLowerCase();
    if (key && !features.has(key)) features.set(key, clean($(li).children('strong').first().contents().first().text()));
  });
  const deposit = parsePrice(features.get('borg') ?? '').priceEur;
  if (deposit !== undefined) out.depositEur = deposit;
  const rooms = parseRooms(features.get('aantal kamers') ?? '');
  if (rooms !== undefined) out.rooms = rooms;
  const bedrooms = parseBedrooms(features.get('aantal slaapkamers') ?? '');
  if (bedrooms !== undefined) out.bedrooms ??= bedrooms;
  const type = detectType(features.get('type') ?? '');
  if (type) out.type ??= type;
  const start = features.get('startdatum');
  const date = start ? parseDutchDate(start, now) : undefined;
  if (date) out.availableFrom = date;

  const info = $('.card--info').first();
  const branch = clean(info.find('.card-info__text h6').first().text());
  const email = info.find('a[href^="mailto:"]').first().attr('href')?.slice('mailto:'.length).split('?')[0];
  const phone = info.find('a[href^="tel:"]').first().attr('href')?.slice('tel:'.length);
  out.agent = { ...out.agent, ...(branch ? { name: branch } : {}), ...(email ? { email } : {}), ...(phone ? { phone } : {}) };

  const intro = $('.house-description__intro').first().clone();
  intro.find('br').replaceWith('\n');
  intro.find('p').each((_, p) => {
    $(p).append('\n\n');
  });
  const description = intro
    .text()
    .split('\n')
    .map((l) => clean(l))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (description) out.description = description;
  return out;
}

export function createRotsvastAdapter(): SourceAdapter {
  return {
    id: 'rotsvast',
    name: 'Rotsvast',
    homepage: BASE,
    regions: REGIONS,
    defaultIntervalSec: 600,
    capabilities: { search: 'html', detail: true, contact: 'email', login: 'none', terms: 'unknown' },

    buildSearches(searches, source) {
      const cities = coveredCities(searches);
      const max = maxPrice(searches);
      const step = max === undefined ? undefined : PRICE_STEPS.find((p) => p >= max);
      const url = (city?: string) => {
        const q = new URLSearchParams();
        if (city) {
          q.set('search', city);
          q.set('radius', '5');
        }
        if (step !== undefined) q.set('price_to', String(step));
        const qs = q.toString();
        return `${BASE}/huren/${qs ? `?${qs}` : ''}`;
      };
      const reqs: SearchRequest[] =
        cities === null
          ? [{ key: 'nl', label: 'Rotsvast: alle huurwoningen', url: url() }]
          : [...new Map(cities.map((c) => [keyOf(c), c])).entries()].map(([key, city]) => ({ key, label: `Rotsvast: ${city}`, url: url(city) }));
      return [...reqs, ...extraUrls(source)];
    },

    async search(req, ctx) {
      const url = req.url ?? `${BASE}/huren/`;
      const res = await ctx.fetch(url);
      return parseRotsvastList(res.text, res.url || url, ctx.now());
    },

    async detail(listing, ctx) {
      const res = await ctx.fetch(listing.url);
      return parseRotsvastDetail(listing, res.text, ctx.now());
    },

    async isAvailable(listing, ctx) {
      try {
        const res = await ctx.fetch(listing.url);
        if (new URL(res.url || listing.url).pathname !== new URL(listing.url).pathname) return false;
        const $ = load(res.text);
        const label = clean($('.house-gallery__label .label').text()).toLowerCase();
        return !UNAVAILABLE_STATUS.some((w) => label.includes(w));
      } catch (e) {
        if (e instanceof SourceHttpError && (e.status === 404 || e.status === 410)) return false;
        throw e;
      }
    },
  };
}
