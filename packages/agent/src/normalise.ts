import type { Furnishing, PropertyType, RawListing } from '@nlpf/core';
import { canonicalAddress } from './cluster.js';
import { fold, guessLanguage } from './text.js';

const PARTICLES = new Set(['aan', 'den', 'de', 'der', 'van', 'op', 'in', 'bij', 'het', 'onder', 'over', 'en', 'te', 'ter', 'ten', 'a', 'd']);

/** "alphen aan den rijn" -> "Alphen aan den Rijn", "'S-GRAVENHAGE" -> "'s-Gravenhage". */
export function titleCaseCity(city: string): string {
  const parts = city.trim().replace(/\s+/g, ' ').toLowerCase().split(/([\s-])/);
  let first = true;
  return parts
    .map((p) => {
      if (p === ' ' || p === '-' || p === '') return p;
      const isFirst = first;
      first = false;
      if (p === "'s" || p === "'t") return p;
      if (!isFirst && PARTICLES.has(p)) return p;
      if (p.startsWith('ij')) return `IJ${p.slice(2)}`;
      return p.charAt(0).toUpperCase() + p.slice(1);
    })
    .join('');
}

const TYPE_PATTERNS: [PropertyType, RegExp][] = [
  ['studio', /\bstudio'?s?\b/],
  ['room', /(?<!\d[\s-]?)\b(kamer|room|studentenkamer|onzelfstandige woonruimte)\b/],
  ['apartment', /\b(appartement|apartment|flat|bovenwoning|benedenwoning|penthouse|maisonnette|portiekwoning|galerijflat|bovenhuis|benedenhuis)\b/],
  ['house', /\b(eengezinswoning|tussenwoning|hoekwoning|rijtjeshuis|rijwoning|vrijstaande woning|twee-onder-een-kap|house|woonhuis|herenhuis|villa)\b/],
];

/** Earliest mention wins, so "Kamer in appartement" is a room and "Appartement met 2 kamers" is an apartment. */
export function detectType(text: string): PropertyType | undefined {
  const t = fold(text);
  let best: { type: PropertyType; at: number } | undefined;
  for (const [type, re] of TYPE_PATTERNS) {
    const m = re.exec(t);
    if (m && (!best || m.index < best.at)) best = { type, at: m.index };
  }
  return best?.type;
}

/** Negated forms are checked first: "unfurnished" contains "furnished". */
export function detectFurnishing(text: string): Furnishing {
  const t = fold(text);
  if (/\b(ongemeubileerd|ongemeubeld|unfurnished|kaal|shell)\b/.test(t)) return 'unfurnished';
  if (/(gestoffeerd|upholstered|semi[\s-]?furnished|semi[\s-]?gemeubileerd)/.test(t)) return 'upholstered';
  if (/(gemeubileerd|gemeubeld|furnished)/.test(t)) return 'furnished';
  return 'unknown';
}

const clean = (s: string | undefined): string | undefined => {
  const t = s?.replace(/\s+/g, ' ').trim();
  return t ? t : undefined;
};

/**
 * Trims text, fills type and furnishing from the text when the source left
 * them out, formats the postcode as "2611 BC", splits "12-A" into number and
 * addition, and title-cases the city.
 */
export function normaliseListing(raw: RawListing): RawListing {
  const text = [raw.title, raw.description].filter(Boolean).join(' ');
  const address = canonicalAddress({
    ...raw.address,
    street: clean(raw.address.street),
    houseNumber: clean(raw.address.houseNumber),
    addition: clean(raw.address.addition),
    postcode: clean(raw.address.postcode),
    city: raw.address.city ? titleCaseCity(raw.address.city) : undefined,
    municipality: raw.address.municipality ? titleCaseCity(raw.address.municipality) : undefined,
  });
  for (const k of Object.keys(address) as (keyof typeof address)[]) if (address[k] === undefined) delete address[k];
  const out: RawListing = {
    ...raw,
    url: raw.url.trim(),
    title: clean(raw.title) ?? '',
    address,
  };
  if (raw.description !== undefined) out.description = raw.description.trim();
  if (raw.contactUrl) out.contactUrl = raw.contactUrl.trim();
  if (!out.type) {
    const type = detectType(text);
    if (type) out.type = type;
  }
  if (!out.furnishing || out.furnishing === 'unknown') out.furnishing = detectFurnishing(text);
  if (!out.language) {
    const lang = guessLanguage(text);
    if (lang) out.language = lang;
  }
  return out;
}
