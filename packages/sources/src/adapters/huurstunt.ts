import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import type { NamedSearch, RawListing, SearchRequest, SourceAdapter, SourceConfig } from '@nlpf/core';
import { UNAVAILABLE_STATUS } from '../generic/presets.js';
import { SourceHttpError } from '../runtime/errors.js';
import { detectType, parsePrice, parseRooms, parseSize } from '../util/parse.js';

/*
 * Huurstunt: a paid aggregator ("Huurstunt Premium", 14 days free, VERIFIED
 * text). City pages are server-rendered (VERIFIED 2026-09-24): a JSON-LD
 * ItemList with url, name ("Appartement te huur in Delft | Kruisstraat |
 * prijs: € 2.450 excl."), price, datePosted and photos, next to cards with
 * size, rooms and a status badge. Rented cards have no link. Filters are
 * posted by a Symfony live component, so only the city goes in the URL.
 * Ingest only.
 */

const BASE = 'https://www.huurstunt.nl';

const clean = (s: string | undefined) => (s ?? '').replace(/[\s ]+/g, ' ').trim();
const known = (s: string | undefined) => (s && !/^onbekend$/i.test(s) ? s : undefined);

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
    label: `Huurstunt: ${url}`,
    url,
  }));
}

interface LdListing {
  '@type'?: string;
  url?: string;
  name?: string;
  offers?: { price?: number | string };
  datePosted?: string;
  image?: { url?: string }[] | { url?: string } | string;
}

/** Every RealEstateListing in the page's JSON-LD, by URL. */
function ldListings(html: string): Map<string, LdListing> {
  const out = new Map<string, LdListing>();
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) return v.forEach(visit);
    if (!v || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    if (o['@type'] === 'RealEstateListing' && typeof o.url === 'string') {
      out.set(o.url, o as LdListing);
      return;
    }
    Object.values(o).forEach(visit);
  };
  const $ = load(html);
  $('script[type="application/ld+json"]').each((_, s) => {
    try {
      visit(JSON.parse($(s).text()));
    } catch {
      // a broken block does not hide the others
    }
  });
  return out;
}

/** "Appartement te huur in Delft | Kruisstraat | prijs: € 2.450 excl." */
function splitName(name: string): { kind?: string; city?: string; street?: string; priceText?: string } {
  const parts = name.split('|').map((p) => p.trim());
  const head = /^(.*?)\s+te huur in\s+(.*)$/i.exec(parts[0] ?? '');
  const priceText = parts.find((p) => /^prijs/i.test(p));
  const street = parts.length >= 3 ? parts[1] : undefined;
  return { kind: head?.[1], city: head?.[2], street, priceText };
}

const images = (img: LdListing['image']): string[] => {
  const list = Array.isArray(img) ? img : img ? [img] : [];
  return list.map((i) => (typeof i === 'string' ? i : i.url)).filter((u): u is string => Boolean(u));
};

/** Reads a /huren/<city> page: the JSON-LD list for the facts, the cards for status, size and rooms. */
export function parseHuurstuntPage(html: string, pageUrl: string): RawListing[] {
  const ld = ldListings(html);
  const $ = load(html);
  const out: RawListing[] = [];
  const seen = new Set<string>();
  $('article').each((_, el) => {
    const card = $(el);
    const href = card.find('a[href*="/huren/in/"]').first().attr('href');
    if (!href) return;
    const url = new URL(href, pageUrl).toString();
    if (seen.has(url)) return;
    const badges = card
      .find('ul')
      .first()
      .find('li')
      .toArray()
      .map((li) => clean($(li).text()).toLowerCase());
    if (badges.some((b) => UNAVAILABLE_STATUS.some((w) => b.includes(w)))) return;
    const accountOnly = /heb je een account nodig/i.test(card.text());
    const facts = card
      .find('header li')
      .toArray()
      .map((li) => clean($(li).text()));
    const item = ld.get(url);
    const name = splitName(clean(item?.name));
    const heading = known(clean(card.find('header h3').first().text()));
    const cardCity = known(facts.at(-1));
    const street = name.street ?? (heading && !/ in /i.test(heading) ? heading : undefined);
    const city = name.city ?? cardCity;
    const price = parsePrice(name.priceText ?? clean(card.find('footer p').first().text()));
    const ldPrice = Number(item?.offers?.price);
    const priceEur = Number.isFinite(ldPrice) && ldPrice > 0 ? ldPrice : price.priceEur;
    const segment = new URL(url).pathname.split('/')[1] ?? '';
    const posted = item?.datePosted ? Date.parse(item.datePosted) : NaN;
    const pics = images(item?.image);
    seen.add(url);
    const listing: RawListing = {
      sourceId: 'huurstunt',
      externalId: new URL(url).pathname.split('/').filter(Boolean).at(-1) ?? url,
      url,
      title: [street, city].filter(Boolean).join(', ') || heading || url,
      priceEur,
      priceBasis: priceEur !== undefined ? price.basis : undefined,
      sizeM2: parseSize(known(facts.find((f) => /m2|m²/i.test(f))) ?? ''),
      rooms: parseRooms(known(facts.find((f) => /kamer/i.test(f))) ?? ''),
      type: detectType(segment) ?? detectType(name.kind ?? ''),
      address: { ...(street ? { street } : {}), ...(city ? { city } : {}) },
      images: pics.length ? pics : undefined,
      publishedAt: Number.isNaN(posted) ? undefined : new Date(posted).toISOString(),
      agent: { name: 'Huurstunt', url: BASE },
      contact: 'none',
      language: 'nl',
      extra: accountOnly ? { accountOnly: true } : undefined,
    };
    for (const k of Object.keys(listing) as (keyof RawListing)[]) if (listing[k] === undefined) delete listing[k];
    out.push(listing);
  });
  return out;
}

export function createHuurstuntAdapter(): SourceAdapter {
  return {
    id: 'huurstunt',
    name: 'Huurstunt',
    homepage: BASE,
    regions: 'nl',
    defaultIntervalSec: 900,
    capabilities: {
      search: 'html',
      detail: false,
      contact: 'none',
      login: 'required',
      paid: { feature: 'contact', plan: 'huurstunt-premium' },
      terms: 'unknown',
    },

    buildSearches(searches, source) {
      const cities = searchCities(searches);
      const reqs: SearchRequest[] =
        cities === null
          ? [{ key: 'nederland', label: 'Huurstunt: heel Nederland', url: `${BASE}/huren/nederland` }]
          : [...new Map(cities.map((c) => [slug(c), c])).entries()].map(([s, city]) => ({
              key: s,
              label: `Huurstunt: ${city}`,
              url: `${BASE}/huren/${s}`,
            }));
      return [...reqs, ...extraUrls(source)];
    },

    async search(req, ctx) {
      const url = req.url ?? `${BASE}/huren/nederland`;
      const res = await ctx.fetch(url);
      return parseHuurstuntPage(res.text, res.url || url);
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
