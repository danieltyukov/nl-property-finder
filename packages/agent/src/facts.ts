import type { Address, Store } from '@nlpf/core';
import { normAddition, normPostcode } from './cluster.js';
import { pdokLookup, type FetchJson } from './geocode.js';
import { normaliseLabel, type PropertyFacts } from './rentcheck.js';

/*
 * Free official data about a home, for the legal-rent check:
 * - BAG through the PDOK OGC API (no key): usable floor area and use of the
 *   verblijfsobject, build year of its pand.
 * - WOZ-waardeloket (no key): the latest WOZ value and its peildatum. The
 *   public site calls https://api.kadaster.nl/lvwoz/wozwaardeloket-api/v1/,
 *   which answers plain requests; www.wozwaardeloket.nl itself only serves the app.
 * - EP-Online (free key from RVO, sent in the Authorization header): the
 *   registered energy label.
 * Ids come from PDOK Locatieserver: adresseerbaarobject_id is the BAG
 * verblijfsobject, nummeraanduiding_id the address the WOZ loket wants.
 */

const BAG = 'https://api.pdok.nl/kadaster/bag/ogc/v2/collections';
const WOZ = 'https://api.kadaster.nl/lvwoz/wozwaardeloket-api/v1/wozwaarde/nummeraanduiding';
const EP_ONLINE = 'https://public.ep-online.nl/api/v5/PandEnergielabel/AdresseerbaarObject';
const CACHE_DAYS = 180;

interface BagFeatureCollection {
  features?: {
    properties?: { oppervlakte?: number; gebruiksdoel?: string | string[]; 'pand.href'?: string[] };
  }[];
}
interface BagPand {
  properties?: { bouwjaar?: number };
}
interface WozResponse {
  wozWaarden?: { peildatum?: string; vastgesteldeWaarde?: number }[];
}
interface EpLabel {
  Registratiedatum?: string;
  Geldig_tot?: string;
  IsVereenvoudigdLabel?: boolean;
  Energieklasse?: string;
  EnergieIndex?: number | null;
}

const isNotFound = (e: unknown) => {
  const status = (e as { status?: number })?.status;
  return status === 404 || (status === undefined && /\b404\b/.test(String((e as Error)?.message ?? e)));
};

/**
 * The label that counts for the WWS (Beleidsboek 2.4.2 and 2.4.3): not
 * expired, not a simplified label from 2015 to 2020, newest registration
 * first.
 */
function validLabel(labels: EpLabel[], now: Date): string | undefined {
  // From 2015 to 2020 only an energy index counts; a bare label letter from that period is the simplified label.
  const simplified = (l: EpLabel) =>
    l.IsVereenvoudigdLabel === true ||
    (l.Registratiedatum !== undefined &&
      l.Registratiedatum >= '2015-01-01' &&
      l.Registratiedatum < '2021-01-01' &&
      l.EnergieIndex == null);
  return labels
    .filter((l) => !simplified(l) && (!l.Geldig_tot || Date.parse(l.Geldig_tot) > now.getTime()))
    .sort((a, b) => (b.Registratiedatum ?? '').localeCompare(a.Registratiedatum ?? ''))
    .map((l) => normaliseLabel(l.Energieklasse))
    .find((l) => l !== undefined);
}

/**
 * Looks up floor area, build year, WOZ value and energy label for an
 * address. Each service is optional: a failure leaves its fields out, and a
 * result with any failure is not cached so the next evaluation tries again.
 * Complete results are cached in `store.geocode` under
 * `facts:<postcode><number><addition>` for 180 days.
 */
export async function lookupPropertyFacts(
  addr: Address,
  deps: { fetchJson: FetchJson; epOnlineKey?: string; store: Store; now?: Date },
): Promise<PropertyFacts> {
  const now = deps.now ?? new Date();
  let hit;
  try {
    hit = await pdokLookup(addr, { store: deps.store, fetchJson: deps.fetchJson });
  } catch {
    return { sources: [] };
  }
  if (!hit) return { sources: [] };

  const cacheKey = `facts:${normPostcode(hit.postcode)}${hit.houseNumber}${normAddition(hit.addition)}${deps.epOnlineKey ? ':ep' : ''}`;
  const cached = deps.store.geocode.get(cacheKey) as { at: string; facts: PropertyFacts } | undefined;
  if (cached && now.getTime() - Date.parse(cached.at) < CACHE_DAYS * 86_400_000) return cached.facts;

  const facts: PropertyFacts = { sources: [] };
  let failed = false;

  if (hit.vboId) {
    try {
      const vbo = (await deps.fetchJson(
        `${BAG}/verblijfsobject/items?identificatie=${hit.vboId}&f=json`,
      )) as BagFeatureCollection;
      const props = vbo.features?.[0]?.properties;
      if (props) {
        if (typeof props.oppervlakte === 'number') facts.sizeM2 = props.oppervlakte;
        const use = Array.isArray(props.gebruiksdoel) ? props.gebruiksdoel.join(',') : props.gebruiksdoel;
        if (use) facts.residential = use.includes('woonfunctie');
        const pandHref = props['pand.href']?.[0];
        if (pandHref) {
          const pand = (await deps.fetchJson(
            `${pandHref}${pandHref.includes('?') ? '&' : '?'}f=json`,
          )) as BagPand;
          if (typeof pand.properties?.bouwjaar === 'number') facts.buildYear = pand.properties.bouwjaar;
        }
        facts.sources.push('bag');
      }
    } catch {
      failed = true;
    }
  }

  if (hit.numId) {
    try {
      const woz = (await deps.fetchJson(`${WOZ}/${hit.numId}`)) as WozResponse;
      const latest = [...(woz.wozWaarden ?? [])]
        .filter((w) => typeof w.vastgesteldeWaarde === 'number' && w.peildatum)
        .sort((a, b) => b.peildatum!.localeCompare(a.peildatum!))[0];
      if (latest) {
        facts.wozEur = latest.vastgesteldeWaarde;
        facts.wozPeildatum = latest.peildatum;
        facts.sources.push('woz');
      }
    } catch {
      failed = true;
    }
  }

  if (deps.epOnlineKey && hit.vboId) {
    try {
      const labels = (await deps.fetchJson(`${EP_ONLINE}/${hit.vboId}`, {
        headers: { Authorization: deps.epOnlineKey },
      })) as EpLabel[];
      const label = Array.isArray(labels) ? validLabel(labels, now) : undefined;
      facts.labelChecked = true;
      if (label) {
        facts.energyLabel = label;
        facts.sources.push('ep-online');
      }
    } catch (e) {
      if (isNotFound(e)) facts.labelChecked = true;
      else failed = true;
    }
  }

  if (!failed) deps.store.geocode.put(cacheKey, { at: now.toISOString(), facts }, now.toISOString());
  return facts;
}
