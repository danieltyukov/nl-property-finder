import { load } from 'cheerio';
import type { RawListing, SourceAdapter } from '@nlpf/core';
import { UNAVAILABLE_STATUS } from '../generic/presets.js';
import { SourceHttpError } from '../runtime/errors.js';
import { splitAddress } from '../util/address.js';
import { parseBedrooms, parseDutchDate, parsePrice, parseSize } from '../util/parse.js';

/*
 * Van der Linden (MODX site behind a BitNinja WAF that lets plain requests
 * through). /woning-huren/ is one server-rendered page with every rental,
 * about 200 cards, and no filters (VERIFIED 2026-09-24). Cards labelled
 * "Belangstellendenlijst" are interest lists for new-build projects, not
 * homes. Reacting uses a form that creates an IDD account and asks for
 * income and employment details behind reCAPTCHA, so a person reacts.
 */

const BASE = 'https://www.vanderlinden.nl';
const LIST_URL = `${BASE}/woning-huren/`;

/** Municipalities where its rentals are, from the recorded list (mostly Amsterdam, Almere and the Utrecht region). */
const REGIONS = [
  'aalsmeer', 'alkmaar', 'almere', 'amersfoort', 'amstelveen', 'amsterdam', 'apeldoorn', 'beverwijk', 'bunnik', 'de bilt', 'diemen',
  'dijk en waard', 'dronten', 'elburg', 'epe', 'gooise meren', 'haarlem', 'haarlemmermeer', 'harderwijk', 'heerde', 'hilversum', 'huizen',
  'kampen', 'laren', 'lelystad', 'nunspeet', 'oldebroek', 'oudewater', 'putten', 'stichtse vecht', 'utrecht', 'utrechtse heuvelrug',
  'vijfheerenlanden', 'waalwijk', 'wijdemeren', 'woerden', 'zaanstad', 'zaltbommel', 'zeewolde', 'zeist',
];

const SKIP = [...UNAVAILABLE_STATUS, 'belangstellendenlijst'];

const clean = (s: string | undefined) => (s ?? '').replace(/[\s ]+/g, ' ').trim();

/** Reads the cards of /woning-huren/. */
export function parseVanderlindenList(html: string, now: Date = new Date()): RawListing[] {
  const $ = load(html);
  const out: RawListing[] = [];
  $('.woninginfo').each((_, el) => {
    const card = $(el);
    const label = clean(card.find('.fotolabel').first().text());
    if (SKIP.some((w) => label.toLowerCase().includes(w))) return;
    const href = card.find('a.blocklink').attr('href');
    if (!href) return;
    const url = new URL(href, BASE).toString();
    const addressText = clean(card.find('strong').first().text());
    // The place line can carry a note after the town: "Nunspeet  Seniorenhuisvesting".
    const placeLine = card.find('.fa-location-dot').parent().clone();
    const note = clean(placeLine.find('span').text());
    placeLine.find('span').remove();
    const city = clean(placeLine.text());
    const address = { ...splitAddress(addressText), ...(city ? { city } : {}) };
    const size = card.find('.kiko-square-footage').parent().text();
    const bedrooms = card.find('.kiko-bedroom').parent().text();
    const energy = clean(card.find('.energielabel').first().text());
    const price = parsePrice(clean(card.find('.mt-2').first().text()));
    const image = card.find('img').first().attr('src');
    const listing: RawListing = {
      sourceId: 'vanderlinden',
      externalId: /\/(\d+)\/?$/.exec(new URL(url).pathname)?.[1] ?? new URL(url).pathname,
      url,
      title: [addressText, city].filter(Boolean).join(', ') || url,
      priceEur: price.priceEur,
      priceBasis: price.priceEur !== undefined ? price.basis : undefined,
      sizeM2: parseSize(clean(size)),
      bedrooms: parseBedrooms(clean(bedrooms)),
      address,
      // "Direct beschikbaar" is today; "Binnenkort beschikbaar" has no date.
      availableFrom: /direct/i.test(label) ? parseDutchDate(label, now) : undefined,
      images: image ? [new URL(image, BASE).toString()] : undefined,
      energyLabel: /^[A-G]\+*$/i.test(energy) ? energy.toUpperCase() : undefined,
      agent: { name: 'Van der Linden', url: BASE },
      contact: 'none',
      language: 'nl',
      extra: label || note ? { ...(label ? { label } : {}), ...(note ? { note } : {}) } : undefined,
    };
    for (const k of Object.keys(listing) as (keyof RawListing)[]) if (listing[k] === undefined) delete listing[k];
    out.push(listing);
  });
  return out;
}

export function createVanderlindenAdapter(): SourceAdapter {
  return {
    id: 'vanderlinden',
    name: 'Van der Linden',
    homepage: BASE,
    regions: REGIONS,
    defaultIntervalSec: 600,
    capabilities: { search: 'html', detail: false, contact: 'none', login: 'optional', terms: 'unknown' },

    buildSearches() {
      return [{ key: 'woning-huren', label: 'Van der Linden', url: LIST_URL }];
    },

    async search(req, ctx) {
      const res = await ctx.fetch(req.url ?? LIST_URL);
      return parseVanderlindenList(res.text, ctx.now());
    },

    async isAvailable(listing, ctx) {
      try {
        const res = await ctx.fetch(listing.url);
        if (new URL(res.url || listing.url).pathname !== new URL(listing.url).pathname) return false;
        const status = clean(load(res.text)('.woningdetails .status').first().text()).toLowerCase();
        return !SKIP.some((w) => status.includes(w));
      } catch (e) {
        if (e instanceof SourceHttpError && (e.status === 404 || e.status === 410)) return false;
        throw e;
      }
    },
  };
}
