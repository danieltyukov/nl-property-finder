import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import type { NamedSearch, PropertyType, RawListing, SearchRequest, SourceAdapter, SourceConfig } from '@nlpf/core';
import { UNAVAILABLE_STATUS } from '../generic/presets.js';
import { SourceHttpError } from '../runtime/errors.js';
import { detectType, parseDutchDate, parsePrice, parseRooms, parseSize } from '../util/parse.js';

/*
 * Directwonen: a paid rental platform. Its city pages are server-rendered
 * cards (VERIFIED 2026-09-24). Reacting needs a paid account, and "Smart"
 * cards link to the payment page, so the adapter only ingests listings for
 * discovery, dedupe and the paywall router. Price and type filters are kept
 * in cookies, so only the city goes in the URL.
 */

const BASE = 'https://directwonen.nl';

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

function extraUrls(source: SourceConfig): SearchRequest[] {
  return source.searchUrls.map((url) => ({
    key: `url-${createHash('sha1').update(url).digest('hex').slice(0, 10)}`,
    label: `Directwonen: ${url}`,
    url,
  }));
}

const TYPES: Record<string, PropertyType> = { kamer: 'room', studio: 'studio', appartement: 'apartment', woning: 'house', huis: 'house' };

/** "4 dagen geleden", "vandaag", "gisteren", "3 uur geleden" as an ISO time. */
function ago(text: string, now: Date): string | undefined {
  const t = text.toLowerCase();
  let days: number | undefined;
  if (/vandaag|uur geleden|minuten? geleden/.test(t)) days = 0;
  else if (/gisteren/.test(t)) days = 1;
  else {
    const m = /(\d+)\s*(dag|dagen|week|weken)\s+geleden/.exec(t);
    if (m) days = Number(m[1]) * (m[2]?.startsWith('we') ? 7 : 1);
  }
  return days === undefined ? undefined : new Date(now.getTime() - days * 86_400_000).toISOString();
}

/** Reads the cards of a /huurwoningen-huren/<city> page. */
export function parseDirectwonenList(html: string, pageUrl: string, now: Date = new Date()): RawListing[] {
  const $ = load(html);
  const out: RawListing[] = [];
  $('.tile').each((_, el) => {
    const tile = $(el);
    const link = tile.find('a.inner-content').first();
    const href = link.attr('href');
    if (!href) return;
    const banners = clean(tile.find('.new-advert-banner').text()).toLowerCase();
    if (UNAVAILABLE_STATUS.some((w) => banners.includes(w))) return;
    // "Smart" cards link to the payment page; the listing itself is in its returnUrl.
    const abs = new URL(href, pageUrl);
    const target = abs.pathname.startsWith('/premiumaccountpayment') ? abs.searchParams.get('returnUrl') : abs.toString();
    if (!target) return;
    const url = new URL(target, BASE).toString();
    const id = /-(\d+)$/.exec(new URL(url).pathname)?.[1] ?? abs.searchParams.get('entityId') ?? new URL(url).pathname;
    // The title attribute has the full street: "Te huur: Kamer Oude Delft, Delft - 1".
    const m = /^Te huur:\s*(\S+)\s+(.*?),\s*([^,]+?)\s*-\s*\d+$/i.exec(clean(link.attr('title')));
    const kind = clean(tile.find('.advert-location-header').text()) || m?.[1] || '';
    const street = m?.[2] ?? clean(tile.find('.location-text').text()).split(',')[0];
    const city = m?.[3] ?? clean(tile.find('.location-text').text()).split(',')[1]?.trim();
    const price = parsePrice(`${tile.find('.advert-location-price').first().text()} ${tile.find('.kale-huur').first().text()}`);
    const available = tile
      .find('.advert-content-detail tr')
      .toArray()
      .map((tr) => $(tr).find('td'))
      .find((tds) => /beschikbaar per/i.test(tds.first().text()));
    const image = tile.find('.advert-thumbnail img').attr('src');
    const smartOnly = /smart only/.test(banners);
    const listing: RawListing = {
      sourceId: 'directwonen',
      externalId: id,
      url,
      title: [street, city].filter(Boolean).join(', ') || url,
      priceEur: price.priceEur,
      priceBasis: price.priceEur !== undefined ? price.basis : undefined,
      sizeM2: parseSize(clean(tile.find('.small-banner.surface .small-banner-top').text())),
      rooms: parseRooms(clean(tile.find('.small-banner.rooms .small-banner-top').text())),
      type: TYPES[kind.toLowerCase()] ?? detectType(kind),
      address: { ...(street ? { street } : {}), ...(city ? { city } : {}) },
      availableFrom: available ? parseDutchDate(clean(available.eq(1).text()), now) : undefined,
      images: image ? [new URL(image, BASE).toString()] : undefined,
      publishedAt: ago(clean(tile.find('.added-days-count-info').attr('title') ?? tile.find('.added-days-count-info').text()), now),
      agent: { name: 'Directwonen', url: BASE },
      contact: 'none',
      language: 'nl',
      extra: smartOnly ? { smartOnly: true } : undefined,
    };
    for (const k of Object.keys(listing) as (keyof RawListing)[]) if (listing[k] === undefined) delete listing[k];
    out.push(listing);
  });
  return out;
}

export function createDirectwonenAdapter(): SourceAdapter {
  return {
    id: 'directwonen',
    name: 'Directwonen',
    homepage: BASE,
    regions: 'nl',
    defaultIntervalSec: 900,
    capabilities: {
      search: 'html',
      detail: false,
      contact: 'none',
      login: 'required',
      paid: { feature: 'contact', plan: 'directwonen-premium' },
      terms: 'unknown',
    },

    buildSearches(searches, source) {
      // There is no national list page, so a search without municipalities adds nothing here.
      const cities = searchCities(searches) ?? [];
      const reqs = [...new Map(cities.map((c) => [slug(c), c])).entries()].map(([s, city]) => ({
        key: s,
        label: `Directwonen: ${city}`,
        url: `${BASE}/huurwoningen-huren/${s}`,
      }));
      return [...reqs, ...extraUrls(source)];
    },

    async search(req, ctx) {
      const url = req.url ?? `${BASE}/huurwoningen-huren`;
      const res = await ctx.fetch(url);
      return parseDirectwonenList(res.text, res.url || url, ctx.now());
    },

    async isAvailable(listing, ctx) {
      try {
        const res = await ctx.fetch(listing.url);
        return new URL(res.url || listing.url).pathname === new URL(listing.url).pathname;
      } catch (e) {
        if (e instanceof SourceHttpError && (e.status === 404 || e.status === 410)) return false;
        throw e;
      }
    },
  };
}
