import type { Page, Response } from 'playwright-core';
import { amsterdamDate, type NamedSearch, type PropertyType, type RawListing, type SearchRequest, type SourceAdapter } from '@nlpf/core';
import { SourceBlockedError, SourceHttpError } from '../runtime/errors.js';
import { normalisePostcode } from '../util/address.js';
import { detectType } from '../util/parse.js';

/*
 * WoningNet on the DAK platform (https://<region>.mijndak.nl), the social
 * housing portals of Amsterdam, Utrecht and a few other regions. It is an
 * OutSystems app: the list comes from the screen action
 * DataActionHaalUitgelogdAanbod, whose apiVersion token changes with every
 * deploy, so the adapter loads /Woningaanbod in a browser and reads that
 * response instead of calling the action itself. A fresh profile gets an
 * empty list on its first visit (the region is not in the client variables
 * yet) and the full list after a reload (VERIFIED 2026-09-24 on Amsterdam:
 * 0, then 170 publications). Reacting needs a portal account.
 */

/**
 * The DAK regions and the municipalities they serve. The hosts were VERIFIED
 * to exist (docs/research/platforms.md, section 4.22); the municipality lists
 * follow the regions' own descriptions and were not checked one by one.
 */
export const DAK_REGIONS: Record<string, { name: string; municipalities: string[] }> = {
  amsterdam: {
    name: 'Regio Amsterdam',
    municipalities: [
      'amsterdam', 'aalsmeer', 'amstelveen', 'diemen', 'edam-volendam', 'haarlemmermeer', 'landsmeer', 'oostzaan',
      'ouder-amstel', 'purmerend', 'uithoorn', 'waterland', 'wormerland', 'zaanstad',
    ],
  },
  utrecht: {
    name: 'Regio Utrecht',
    municipalities: [
      'utrecht', 'bunnik', 'de bilt', 'houten', 'ijsselstein', 'lopik', 'montfoort', 'nieuwegein', 'oudewater', 'stichtse vecht',
      'utrechtse heuvelrug', 'vijfheerenlanden', 'wijk bij duurstede', 'woerden', 'zeist',
    ],
  },
  studentenwoning: { name: 'Studentenwoning Utrecht', municipalities: ['utrecht'] },
  almere: { name: 'Almere', municipalities: ['almere'] },
  middenholland: { name: 'Midden-Holland', municipalities: ['gouda', 'bodegraven-reeuwijk', 'krimpenerwaard', 'waddinxveen', 'zuidplas'] },
  gooienvecht: { name: 'Gooi en Vecht', municipalities: ['hilversum', 'huizen', 'gooise meren', 'blaricum', 'laren', 'wijdemeren', 'eemnes'] },
  eemvallei: { name: 'Eemvallei', municipalities: ['amersfoort', 'baarn', 'bunschoten', 'leusden', 'soest', 'woudenberg'] },
  groningenhuurt: { name: 'Groningen', municipalities: ['groningen'] },
};

const ACTION = '/DataActionHaalUitgelogdAanbod';

interface Adres {
  Straatnaam?: string;
  Huisnummer?: number;
  Huisletter?: string;
  HuisnummerToevoeging?: string;
  Postcode?: string;
  Woonplaats?: string;
  Wijk?: string;
}
interface Cluster {
  Naam?: string;
  DetailSoort?: string;
  Doelgroep?: string;
  PrijsMinBekend?: boolean;
  PrijsMin?: string;
  WoonVertrekkenTotOppMin?: number;
  AantalKamersMin?: number;
  Lengtegraad?: string;
  Breedtegraad?: string;
  Eigenaar?: string;
}
interface Eenheid {
  DetailSoort?: string;
  Bestemming?: string;
  AantalKamers?: number;
  TotaleOppervlakte?: string;
  WoonVertrekkenTotOpp?: string;
  Doelgroep?: string;
  NettoHuurBekend?: boolean;
  NettoHuur?: string;
  BrutoHuurBekend?: boolean;
  Brutohuur?: string;
  Lengtegraad?: string;
  Breedtegraad?: string;
  EnergieLabel?: string;
  Eigenaar?: string;
}
interface Publicatie {
  Id: string;
  EinddatumTijd?: string;
  PublicatieModel?: string;
  PublicatieModule?: string;
  PublicatieDatum?: string;
  Foto_Locatie?: string;
  IsCluster?: boolean;
  EenheidSoort?: string;
  Adres?: Adres;
  Cluster?: Cluster;
  Eenheid?: Eenheid;
  PublicatieLabel?: string;
  ContractVorm?: string;
  PublicatieOmschrijving?: { Tekst?: string };
  AantalReactiesOpPublicatie?: string;
  Opleverdatum?: string;
  Verdieping?: string;
  AantalEenhedenBeschikbaar?: number;
}

const num = (v: string | number | undefined) => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};
const realDate = (v: string | undefined) => (v && !v.startsWith('1900') ? v : undefined);

function dakType(detail: string | undefined): PropertyType | undefined {
  const d = (detail ?? '').toLowerCase();
  if (!d) return undefined;
  if (/kamer|onzelfstandig/.test(d)) return 'room';
  if (/studio/.test(d)) return 'studio';
  if (/flat|portiek|galerij|corridor|boven|beneden|maisonnette|appartement|etage/.test(d)) return 'apartment';
  if (/tussen|eind|hoek|eengezins|woonhuis|onder-een-kap|vrijstaand|herenhuis|patio/.test(d)) return 'house';
  return detectType(d);
}

function coordinates(lat?: string, lon?: string): { lat?: number; lon?: number } {
  const a = num(lat);
  const o = num(lon);
  return a !== undefined && o !== undefined ? { lat: a, lon: o } : {};
}

function mapPublicatie(p: Publicatie, region: string, origin: string): RawListing | undefined {
  const e = p.Eenheid ?? {};
  const c = p.Cluster ?? {};
  const a = p.Adres ?? {};
  if (/parkeer/i.test(p.EenheidSoort ?? '') || /koop/i.test(`${p.PublicatieModule ?? ''} ${e.Bestemming ?? ''}`)) return undefined;
  const cluster = Boolean(p.IsCluster);
  const addition = [a.Huisletter?.trim(), a.HuisnummerToevoeging?.replace(/^[-\s]+/, '').trim()].filter(Boolean).join('-');
  const houseNumber = !cluster && a.Huisnummer ? String(a.Huisnummer) : undefined;
  const wijk = a.Wijk?.trim().replace(/^\((.*)\)$/, '$1');
  const address: RawListing['address'] = {
    street: a.Straatnaam || undefined,
    houseNumber,
    addition: houseNumber && addition ? addition : undefined,
    postcode: normalisePostcode(a.Postcode ?? ''),
    city: a.Woonplaats || undefined,
    neighbourhood: wijk || undefined,
    ...(cluster ? coordinates(c.Breedtegraad, c.Lengtegraad) : coordinates(e.Breedtegraad, e.Lengtegraad)),
  };
  for (const k of Object.keys(address) as (keyof typeof address)[]) if (address[k] === undefined) delete address[k];

  const net = cluster ? (c.PrijsMinBekend ? num(c.PrijsMin) : undefined) : e.NettoHuurBekend ? num(e.NettoHuur) : undefined;
  const gross = !cluster && e.BrutoHuurBekend ? num(e.Brutohuur) : undefined;
  const service = net !== undefined && gross !== undefined && gross > net ? Math.round((gross - net) * 100) / 100 : undefined;
  const size = cluster ? num(c.WoonVertrekkenTotOppMin) : (num(e.TotaleOppervlakte) ?? num(e.WoonVertrekkenTotOpp));
  const opleverdatum = realDate(p.Opleverdatum);
  const numberText = houseNumber ? `${houseNumber}${addition ? (/^\d/.test(addition) ? '-' : '') + addition : ''}` : '';
  const title = cluster && c.Naam ? c.Naam : [a.Straatnaam, numberText].filter(Boolean).join(' ') + (a.Woonplaats ? `, ${a.Woonplaats}` : '');
  const owner = (cluster ? c.Eigenaar : e.Eigenaar) || undefined;
  const label = p.PublicatieLabel?.split('~').map((s) => s.trim()).filter(Boolean).join(', ');
  const reactions = num(p.AantalReactiesOpPublicatie);

  const extra: Record<string, unknown> = {
    region,
    deadline: realDate(p.EinddatumTijd),
    model: p.PublicatieModel || undefined,
    sector: p.PublicatieModule || undefined,
    label: label || undefined,
    contract: p.ContractVorm || undefined,
    target: (cluster ? c.Doelgroep : e.Doelgroep) || undefined,
    floor: p.Verdieping || undefined,
    units: cluster ? num(p.AantalEenhedenBeschikbaar) : undefined,
    reactions,
  };
  for (const k of Object.keys(extra)) if (extra[k] === undefined) delete extra[k];

  const listing: RawListing = {
    sourceId: 'woningnet-dak',
    externalId: p.Id,
    url: `${origin}/HuisDetails?PublicatieId=${encodeURIComponent(p.Id)}`,
    title: title || `Publicatie ${p.Id}`,
    priceEur: net,
    priceBasis: net !== undefined ? 'excl' : undefined,
    serviceCostsEur: service,
    sizeM2: size !== undefined ? Math.round(size) : undefined,
    rooms: cluster ? num(c.AantalKamersMin) : num(e.AantalKamers),
    type: dakType(cluster ? c.DetailSoort : e.DetailSoort),
    address,
    availableFrom: opleverdatum ? amsterdamDate(new Date(opleverdatum)) : undefined,
    description: p.PublicatieOmschrijving?.Tekst?.trim() || undefined,
    images: p.Foto_Locatie ? [p.Foto_Locatie] : undefined,
    energyLabel: /^[A-G]\+*$/i.test(e.EnergieLabel ?? '') ? e.EnergieLabel!.toUpperCase() : undefined,
    publishedAt: realDate(p.PublicatieDatum),
    agent: owner ? { name: owner } : undefined,
    contact: 'none',
    language: 'nl',
    extra,
  };
  for (const k of Object.keys(listing) as (keyof RawListing)[]) if (listing[k] === undefined) delete listing[k];
  return listing;
}

/** Maps the JSON of DataActionHaalUitgelogdAanbod to listings; `origin` is the region's site. */
export function parseDakOffer(json: unknown, region: string, origin: string, _now: Date = new Date()): RawListing[] {
  const list = (json as { data?: { PublicatieLijst?: { List?: Publicatie[] } } })?.data?.PublicatieLijst?.List;
  if (!Array.isArray(list)) throw new Error('WoningNet DAK: the response has no data.PublicatieLijst.List');
  return list.map((p) => mapPublicatie(p, region, origin)).filter((l): l is RawListing => Boolean(l));
}

const listLength = (json: unknown) =>
  (json as { data?: { PublicatieLijst?: { List?: unknown[] } } })?.data?.PublicatieLijst?.List?.length ?? 0;

/** Loads the offer page and returns the data action's JSON, reloading once when a fresh profile gets an empty list. */
async function readOffer(page: Page, url: string, timeoutMs: number): Promise<unknown> {
  const isAction = (r: Response) => r.url().includes(ACTION) && r.request().method() === 'POST';
  const once = async (load: () => Promise<unknown>) => {
    const [res] = await Promise.all([page.waitForResponse(isAction, { timeout: timeoutMs }), load()]);
    const status = res.status();
    if (status === 403 || status === 429) throw new SourceBlockedError(`WoningNet refused the offer request with HTTP ${status}`, { status, url: res.url() });
    if (!res.ok()) throw new SourceHttpError(`WoningNet offer request returned HTTP ${status}`, { status, url: res.url() });
    return (await res.json()) as unknown;
  };
  const first = await once(() => page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs }));
  if (listLength(first) > 0) return first;
  return once(() => page.reload({ waitUntil: 'domcontentloaded', timeout: timeoutMs }));
}

function searchCities(searches: NamedSearch[]): Set<string> | null {
  const out = new Set<string>();
  for (const s of searches) {
    if (s.enabled === false) continue;
    if (s.regions.length === 0) return null;
    for (const r of s.regions) {
      if (r.municipalities.length === 0) return null;
      for (const m of r.municipalities) out.add(m.trim().toLowerCase());
    }
  }
  return out;
}

export interface WoningnetDakOptions {
  /** Site of a region. Default `https://<region>.mijndak.nl`; tests point it at a local server. */
  baseUrl?: (region: string) => string;
  /** How long to wait for the page and its data action. Default 45 s. */
  responseTimeoutMs?: number;
}

export function createWoningnetDakAdapter(opts: WoningnetDakOptions = {}): SourceAdapter {
  const baseUrl = opts.baseUrl ?? ((region: string) => `https://${region}.mijndak.nl`);
  const timeoutMs = opts.responseTimeoutMs ?? 45_000;
  const municipalities = [...new Set(Object.values(DAK_REGIONS).flatMap((r) => r.municipalities))];

  return {
    id: 'woningnet-dak',
    name: 'WoningNet (DAK)',
    homepage: 'https://www.woningnet.nl',
    regions: municipalities,
    // Offers stay open for about a week and most are ranked by registration
    // time, so a slow poll loses nothing.
    defaultIntervalSec: 1800,
    capabilities: { search: 'browser', detail: false, contact: 'none', login: 'required', terms: 'unknown', browser: 'headless' },

    buildSearches(searches) {
      const cities = searchCities(searches);
      const reqs: SearchRequest[] = [];
      for (const [region, def] of Object.entries(DAK_REGIONS)) {
        if (cities !== null && !def.municipalities.some((m) => cities.has(m))) continue;
        reqs.push({ key: region, label: `WoningNet ${def.name}`, url: `${baseUrl(region)}/Woningaanbod`, params: { region } });
      }
      return reqs;
    },

    async search(req, ctx) {
      const region = String(req.params?.region ?? req.key);
      const url = req.url ?? `${baseUrl(region)}/Woningaanbod`;
      const session = await ctx.browser();
      try {
        const json = await readOffer(session.page, url, timeoutMs);
        const listings = parseDakOffer(json, region, new URL(url).origin, ctx.now());
        ctx.log.debug('woningnet offer read', { region, count: listings.length });
        return listings;
      } finally {
        await session.close().catch(() => undefined);
      }
    },
  };
}
