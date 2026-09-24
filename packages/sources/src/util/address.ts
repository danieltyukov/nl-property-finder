import type { Address } from '@nlpf/core';

const POSTCODE = /(?<![\d\p{L}])([1-9]\d{3})\s?([A-Za-z]{2})(?!\p{L})/u;

/** "2611bc" becomes "2611 BC"; anything that is not a full Dutch postcode is undefined. */
export function normalisePostcode(text: string): string | undefined {
  const m = /^\s*([1-9]\d{3})\s*([A-Za-z]{2})\s*$/.exec(text ?? '');
  return m ? `${m[1]} ${m[2]?.toUpperCase()}` : undefined;
}

/**
 * House number additions as Dutch sites write them: a letter ("12A"), a
 * floor ("12-3", "12 III", "7 2-hoog"), "bis", "hs" (huis, the ground floor
 * in Amsterdam) and a few others.
 */
const ADDITION =
  /^(?:\p{L}|[ivx]{1,4}|\d{1,4}|\d{1,2}-?(?:hoog|hg|h|e|ste|de)|\p{L}\d{1,3}|\d{1,4}\p{L}{1,2}|bis|hs|huis|bg|bgg|sous|bov|boven|beneden|ben|zw|rd|hg|hoog)$/iu;

const STREET_AND_NUMBER = /^(?<street>.*?\p{L}{2,}.*?)\s+(?<num>\d{1,5})(?!\d)(?<tail>.*)$/u;

function normaliseAddition(a: string): string {
  if (/^\p{L}$/u.test(a) || /^[ivx]{1,4}$/i.test(a)) return a.toUpperCase();
  return a;
}

const clean = (s: string) => s.replace(/\s+/g, ' ').replace(/^[\s,]+|[\s,]+$/g, '');

/**
 * Splits an address as written on a listing into street, house number,
 * addition, postcode and city. Handles "Oude Delft 12-A", "Oude Delft 12A",
 * "Oude Delft 12 a" (all addition "A"), "Laan van Meerdervoort 123 bis",
 * "2611 BC Delft" and combinations with commas. Text without a number is
 * taken as a street. Fields that are not present are left out.
 */
export function splitAddress(text: string): Address {
  let t = clean((text ?? '').replace(/ /g, ' '));
  t = t.replace(/^(?:te huur|for rent|huur)\s*:?\s*/i, '');
  const out: Address = {};
  if (!t) return out;

  const pm = POSTCODE.exec(t);
  let rest = t;
  if (pm) {
    out.postcode = `${pm[1]} ${pm[2]?.toUpperCase()}`;
    const after = t.slice(pm.index + pm[0].length);
    const cm = /^\s*([^,\d][^,]*)/u.exec(after);
    if (cm && /\p{L}/u.test(cm[1] ?? '')) out.city = clean(cm[1] ?? '');
    rest = `${t.slice(0, pm.index)},${after.slice(cm ? cm[0].length : 0)}`;
  }

  const segments = rest.split(',').map(clean).filter(Boolean);
  let streetIdx = segments.findIndex((s) => /\d/.test(s));
  if (streetIdx === -1 && segments.length > 0) streetIdx = 0;
  const streetSeg = segments[streetIdx];
  const others = segments.filter((_, i) => i !== streetIdx);
  let tailCity: string | undefined;

  if (streetSeg) {
    const m = STREET_AND_NUMBER.exec(streetSeg);
    if (m?.groups) {
      out.street = clean(m.groups.street ?? '');
      out.houseNumber = m.groups.num;
      const tail = (m.groups.tail ?? '').replace(/^\s*[-/]?\s*/, '');
      if (tail) {
        const tokens = tail.split(' ');
        const first = tokens[0] ?? '';
        if (ADDITION.test(first)) {
          out.addition = normaliseAddition(first);
          if (tokens.length > 1) tailCity = clean(tokens.slice(1).join(' '));
        } else {
          tailCity = clean(tail);
        }
      }
    } else if (/\p{L}/u.test(streetSeg)) {
      out.street = streetSeg;
    }
  }

  if (!out.city) {
    const city = tailCity || [...others].reverse().find((s) => /\p{L}/u.test(s) && !/\d/.test(s));
    if (city) out.city = city;
  }
  // Keep a stable key order: street, houseNumber, addition, postcode, city.
  const ordered: Address = {};
  for (const k of ['street', 'houseNumber', 'addition', 'postcode', 'city'] as const) {
    if (out[k]) ordered[k] = out[k];
  }
  return ordered;
}
