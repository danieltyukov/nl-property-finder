import { load } from 'cheerio';
import type { APIRequestContext } from 'playwright-core';
import {
  fromAmsterdam,
  trimTrailingSlashes,
  type ContactResult,
  type NamedSearch,
  type PropertyType,
  type RawListing,
  type SearchRequest,
  type SourceAdapter,
  type SourceContext,
} from '@nlpf/core';
import { NeedsLoginError, SourceBlockedError, SourceHttpError } from '../runtime/errors.js';
import { normalisePostcode } from '../util/address.js';
import { detectFurnishing, detectType, parseDutchDate } from '../util/parse.js';

/*
 * The generic adapter for Zig Websoftware housing portals ("Woonmatch",
 * also sold as Hexia). One JSON endpoint lists a portal's whole offer; a
 * reaction goes through the portal's own form endpoints with the user's
 * logged-in session, which lives in the persistent browser profile.
 *
 * Endpoints and the reaction flow: docs/research/platforms.md section 6.1,
 * checked on 2026-09-24 against RoomMatch, Woonnet Haaglanden, Plaza and
 * Huren in Holland Rijnland (listing, getobject, getaccount and the form
 * configuration answered anonymously). The react and active-reaction calls
 * follow the flow documented by open source clients that used real accounts;
 * they were never called live from this project.
 */

export const ZIG_PATHS = {
  allObjects: '/portal/object/frontend/getallobjects/format/json',
  object: '/portal/object/frontend/getobject/format/json',
  account: '/portal/account/frontend/getaccount/format/json',
  formConfig: '/portal/core/frontend/getformsubmitonlyconfiguration/format/json',
  react: '/portal/object/frontend/react/format/json',
  activeReactions: '/portal/registration/frontend/getactievereacties/format/json',
  login: '/redirect?code=portal-login-page',
} as const;

export interface ZigPortalDef {
  /** Source id, such as "roommatch". */
  id: string;
  name: string;
  /** Portal origin without a trailing slash, such as "https://www.roommatch.nl". */
  homepage: string;
  /** Path the detail pages live under; the object's urlKey is appended. */
  detailPath: string;
  /** Municipalities (lowercase) the portal publishes in; the registry enables it only for matching searches. */
  regions: string[] | 'nl';
  /** What reacting needs, in one line: account and fee. Shown with every listing. */
  registration: string;
  /** How many open reactions the portal allows at once, when known. */
  maxActiveReactions?: number;
  /** Organisations that publish on the portal, such as DUWO on RoomMatch. */
  publishers?: string[];
  /**
   * Whether `sleepingRoom.amountOfRooms` is the number of rooms. RoomMatch
   * and Plaza fill it with a constant, so they set this to false.
   */
  roomsField?: boolean;
  /** Default poll interval. First come, first served portals poll every minute. */
  intervalSec?: number;
  /** Login page. Default: the portal's own `/redirect?code=portal-login-page`. */
  loginUrl?: string;
}

/* ---------- search filters shared by the portal adapters ---------- */

/** The part of the user's searches a portal adapter can apply before listings enter the pipeline. */
export interface PortalFilters {
  /** Lowercase municipality names; absent when some search is not drawn with municipalities. */
  municipalities?: string[];
  /** The highest `priceMaxEur` over all searches; absent when some search has no maximum. */
  maxRentEur?: number;
}

const MUNICIPALITY_ALIASES: Record<string, string> = {
  "'s-gravenhage": 'den haag',
  's-gravenhage': 'den haag',
  'the hague': 'den haag',
};

/** A municipality name as the portals write it: lowercase, "'s-Gravenhage" and "The Hague" as "den haag". */
export function normaliseMunicipality(name: string): string {
  const n = name.trim().toLowerCase().replace(/\s+/g, ' ');
  return MUNICIPALITY_ALIASES[n] ?? n;
}

/**
 * Filters every enabled search agrees on: the union of their municipalities
 * (only when each search names municipalities) and the highest maximum rent
 * (only when each search sets one). Anything looser would drop listings a
 * search still wants.
 */
export function portalFilters(searches: NamedSearch[]): PortalFilters {
  const active = searches.filter((s) => s.enabled !== false);
  if (active.length === 0) return {};
  const out: PortalFilters = {};
  const names = new Set<string>();
  let everyNamed = true;
  for (const s of active) {
    if (s.regions.length === 0) everyNamed = false;
    for (const r of s.regions) {
      if (r.municipalities.length === 0) everyNamed = false;
      for (const m of r.municipalities) names.add(normaliseMunicipality(m));
    }
  }
  if (everyNamed && names.size > 0) out.municipalities = [...names].sort();
  const maxima = active.map((s) => s.priceMaxEur);
  if (maxima.every((p): p is number => typeof p === 'number')) out.maxRentEur = Math.max(...maxima);
  return out;
}

/** The filters as `SearchRequest.params`, so a request shows what it asks for. */
export function filterParams(f: PortalFilters): Record<string, string | number> {
  const p: Record<string, string | number> = {};
  if (f.municipalities?.length) p.municipalities = f.municipalities.join(',');
  if (f.maxRentEur !== undefined) p.maxRentEur = f.maxRentEur;
  return p;
}

/** Reads the filters back from a request built by `filterParams`. */
export function readFilters(req: SearchRequest): PortalFilters {
  const out: PortalFilters = {};
  const m = req.params?.municipalities;
  if (typeof m === 'string' && m.trim()) out.municipalities = m.split(',').map(normaliseMunicipality).filter(Boolean);
  const max = Number(req.params?.maxRentEur);
  if (req.params?.maxRentEur !== undefined && Number.isFinite(max)) out.maxRentEur = max;
  return out;
}

/**
 * Whether a place name passes a municipality filter when the source names
 * places rather than municipalities. A place maps to its municipality
 * through `aliases` ("hoogvliet" is in "rotterdam"). Only places known to be
 * a municipality the source covers can be ruled out; anything else passes,
 * so a village the source never mentioned before is not dropped by mistake.
 */
export function placePasses(
  place: string | undefined,
  filter: string[] | undefined,
  known: ReadonlySet<string>,
  aliases: Record<string, string> = {},
): boolean {
  if (!filter?.length || !place) return true;
  const p = normaliseMunicipality(place);
  const municipality = aliases[p] ?? p;
  if (!known.has(municipality)) return true;
  return filter.includes(municipality) || filter.includes(p);
}

/* ---------- small helpers shared by the portal adapters ---------- */

/** Plain text from an HTML fragment, keeping paragraph breaks. */
export function htmlToText(html: string | null | undefined): string | undefined {
  if (!html) return undefined;
  const $ = load(`<div id="root">${html}</div>`);
  const root = $('#root');
  root.find('script, style').remove();
  root.find('br').replaceWith('\n');
  root.find('p, div, li, h1, h2, h3, h4, h5, h6, tr').each((_, n) => {
    $(n).append('\n');
  });
  const text = root
    .text()
    .split('\n')
    .map((l) => l.replace(/[ \t ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text || undefined;
}

/** "2026-09-17 12:28:00" (Amsterdam wall clock) as an ISO UTC string. */
export function amsterdamLocalToIso(text: string | null | undefined): string | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(text ?? '');
  if (!m || m[1] === '0000') return undefined;
  return fromAmsterdam(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0)).toISOString();
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

const num = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v.replace(',', '.')) : NaN;
  return Number.isFinite(n) ? n : undefined;
};
const positive = (v: unknown): number | undefined => {
  const n = num(v);
  return n !== undefined && n > 0 ? n : undefined;
};
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

function compact<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
  return o;
}

/* ---------- the Zig object ---------- */

interface Named {
  name?: string | null;
  localizedName?: string | null;
}

/** The fields of a Zig object this adapter reads (docs/research/platforms.md section 6.1). */
export interface ZigObject {
  id?: string | number;
  urlKey?: string;
  street?: string;
  houseNumber?: string | number;
  houseNumberAddition?: string | null;
  postalcode?: string;
  city?: Named;
  municipality?: Named;
  quarter?: Named;
  dwellingType?: { categorie?: string | null; localizedName?: string | null };
  woningsoort?: { localizedNaam?: string | null } | null;
  isZelfstandig?: boolean;
  aantalMedebewoners?: number;
  netRent?: number | string;
  totalRent?: number | string;
  serviceCosts?: number | string;
  areaDwelling?: number | string;
  sleepingRoom?: { amountOfRooms?: string | number | null } | null;
  energyLabel?: { icon?: string | null } | null;
  availableFrom?: string;
  availableFromDate?: string;
  publicationDate?: string;
  closingDate?: string;
  model?: {
    modelCategorie?: { code?: string | null } | null;
    advertentieSluitenNaEersteReactie?: boolean;
    isHospiteren?: boolean;
  } | null;
  rentBuy?: string;
  inschrijvingVereistVoorReageren?: boolean;
  doelgroepen?: { code?: string | null }[];
  pictures?: { uri?: string }[];
  infoveldKort?: string;
  latitude?: string | number;
  longitude?: string | number;
  isExtraAanbod?: boolean;
  isWoningruil?: boolean;
  isGepubliceerd?: boolean;
  land?: { id?: string | null } | null;
  description?: string;
  minimumIncome?: number;
  maximumIncome?: number;
  minimumHouseholdSize?: number;
  maximumHouseholdSize?: number;
  minimumAge?: number;
  maximumAge?: number;
  numberOfReactions?: number;
  reactionData?: ZigReactionData | null;
}

export interface ZigReactionData {
  kanReageren?: boolean;
  loggedin?: boolean;
  action?: string;
  url?: string;
  redenMagNietReagerenCode?: string | null;
}

/** The allocation model of an object, in the words the rest of the product uses. */
export interface ZigModel {
  /** inschrijfduur, loting, reactiedatum, eerste-reactie, hospiteren, hospiteren-inschrijfduur, or the portal's own code. */
  model: string;
  /** The portal's code as sent, when it sent one. */
  code?: string;
  /** True when the first suitable reaction wins, so speed matters. */
  firstComeFirstServed: boolean;
}

/**
 * `reactiedatum` ("Snelle reageerder") and ads that close after the first
 * reaction ("Eerste reactie", no model code at all on Plaza) are first come,
 * first served. Lottery, waiting time and resident choice are not.
 */
export function zigModel(o: ZigObject): ZigModel {
  const code = str(o.model?.modelCategorie?.code)?.toLowerCase();
  if (o.model?.advertentieSluitenNaEersteReactie) return compact({ model: 'eerste-reactie', code, firstComeFirstServed: true });
  switch (code) {
    case 'reactiedatum':
      return { model: 'reactiedatum', code, firstComeFirstServed: true };
    case 'random':
    case 'loting':
      return { model: 'loting', code, firstComeFirstServed: false };
    case 'hospitereninschrijfduur':
      return { model: 'hospiteren-inschrijfduur', code, firstComeFirstServed: false };
    case undefined:
      return { model: 'unknown', firstComeFirstServed: false };
    default:
      return { model: code, code, firstComeFirstServed: false };
  }
}

const NOT_A_HOME_MODEL = new Set(['woningruil', 'parkeren']);

/** Why an object is not a rental home someone could react to now, or undefined when it is. */
export function zigSkipReason(o: ZigObject, now: Date): string | undefined {
  if (o.rentBuy && o.rentBuy !== 'Huur') return 'not for rent';
  const category = o.dwellingType?.categorie;
  if (category && category !== 'woning') return 'not a home';
  if (o.isWoningruil) return 'home swap';
  const code = str(o.model?.modelCategorie?.code)?.toLowerCase();
  if (code && NOT_A_HOME_MODEL.has(code)) return code === 'woningruil' ? 'home swap' : 'parking';
  // Extra aanbod is offered to invited applicants only (Plaza's reserved
  // university rooms); an ordinary account cannot react.
  if (o.isExtraAanbod) return 'invitation only';
  if (o.isGepubliceerd === false) return 'not published';
  const land = str(o.land?.id);
  if (land && land !== '524' && land !== '0') return 'abroad';
  const closing = amsterdamLocalToIso(o.closingDate);
  if (closing && Date.parse(closing) < now.getTime()) return 'closed';
  return undefined;
}

function zigType(o: ZigObject): PropertyType | undefined {
  const label = o.dwellingType?.localizedName ?? '';
  const fromLabel = detectType(label) ?? (/senioren|hat-woning|flat/i.test(label) ? 'apartment' : undefined);
  if (fromLabel) return fromLabel;
  // RoomMatch labels its units by furnishing and says in "woningsoort"
  // whether they are self-contained. "isZelfstandig" alone is not enough:
  // Woonnet Haaglanden sends false for family houses.
  const soort = o.woningsoort?.localizedNaam ?? '';
  if (/\bonzelfstandig/i.test(soort)) return 'room';
  if (/\bzelfstandig/i.test(soort)) {
    const area = positive(o.areaDwelling);
    return area !== undefined && area <= 40 ? 'studio' : 'apartment';
  }
  return undefined;
}

function zigFurnishing(o: ZigObject): RawListing['furnishing'] {
  const label = o.dwellingType?.localizedName ?? '';
  if (/zelf inrichten|\bkaal\b/i.test(label)) return 'unfurnished';
  const f = detectFurnishing(label);
  return f === 'unknown' ? undefined : f;
}

/** "icon_label_a_plus_plus" is "A++". */
export function zigEnergyLabel(icon: string | null | undefined): string | undefined {
  const m = /label_([a-g])((?:_plus)*)$/i.exec(icon ?? '');
  if (!m) return undefined;
  return `${m[1]?.toUpperCase()}${'+'.repeat(((m[2] ?? '').match(/_plus/g) ?? []).length)}`;
}

function absolute(uri: string | undefined, base: string): string | undefined {
  if (!uri) return undefined;
  try {
    return new URL(uri, `${base}/`).toString();
  } catch {
    return undefined;
  }
}

function addition(v: string | null | undefined): string | undefined {
  const a = str(v ?? undefined)?.replace(/^[-\s]+/, '');
  if (!a) return undefined;
  return /^\p{L}$/u.test(a) ? a.toUpperCase() : a;
}

/** Maps one Zig object to a listing, or undefined when it is not a rental home (see `zigSkipReason`). */
export function zigListing(def: ZigPortalDef, o: ZigObject, now: Date): RawListing | undefined {
  if (zigSkipReason(o, now)) return undefined;
  const id = str(o.id !== undefined ? String(o.id) : undefined);
  const urlKey = str(o.urlKey);
  if (!id || !urlKey) return undefined;
  const url = `${def.homepage}${def.detailPath}${urlKey}`;
  const houseNumber = str(o.houseNumber !== undefined ? String(o.houseNumber) : undefined);
  const add = addition(o.houseNumberAddition);
  const street = str(o.street);
  const title = [street, [houseNumber, add].filter(Boolean).join(' ')].filter(Boolean).join(' ') || urlKey;

  const net = positive(o.netRent);
  const total = positive(o.totalRent);
  const priceEur = net ?? total;
  const service = net !== undefined && total !== undefined && total > net ? round2(total - net) : undefined;
  const lat = num(o.latitude);
  const lon = num(o.longitude);
  const rooms = def.roomsField === false ? undefined : positive(o.sleepingRoom?.amountOfRooms);
  const model = zigModel(o);
  const closingAt = amsterdamLocalToIso(o.closingDate);
  const images = (o.pictures ?? [])
    .map((p) => absolute(p.uri, def.homepage))
    .filter((u): u is string => Boolean(u))
    .slice(0, 12);

  return compact<RawListing>({
    sourceId: def.id,
    externalId: id,
    url,
    title,
    priceEur,
    priceBasis: priceEur === undefined ? undefined : net !== undefined ? 'excl' : 'incl',
    serviceCostsEur: service,
    sizeM2: positive(o.areaDwelling) === undefined ? undefined : Math.round(positive(o.areaDwelling) ?? 0),
    rooms: rooms === undefined ? undefined : Math.round(rooms),
    type: zigType(o),
    furnishing: zigFurnishing(o),
    address: compact({
      street,
      houseNumber,
      addition: add,
      postcode: normalisePostcode(o.postalcode ?? ''),
      city: str(o.city?.name ?? undefined),
      municipality: str(o.municipality?.name ?? undefined),
      neighbourhood: str(o.quarter?.name ?? undefined),
      lat: lat !== undefined && lon !== undefined ? lat : undefined,
      lon: lat !== undefined && lon !== undefined ? lon : undefined,
    }),
    availableFrom: str(o.availableFromDate)?.slice(0, 10) ?? parseDutchDate(o.availableFrom ?? '', now),
    description: str(o.infoveldKort),
    images: images.length ? images : undefined,
    energyLabel: zigEnergyLabel(o.energyLabel?.icon),
    publishedAt: amsterdamLocalToIso(o.publicationDate),
    agent: { name: def.name, url: def.homepage },
    contact: 'form',
    contactUrl: url,
    language: 'nl',
    extra: compact({
      platform: 'zig',
      objectId: id,
      model: model.model,
      modelCode: model.code,
      firstComeFirstServed: model.firstComeFirstServed,
      closingAt,
      registrationRequired: o.inschrijvingVereistVoorReageren !== false,
      registration: def.registration,
      maxActiveReactions: def.maxActiveReactions,
      targetGroups: (o.doelgroepen ?? []).map((d) => str(d.code ?? undefined)).filter((c): c is string => Boolean(c)),
      housemates: positive(o.aantalMedebewoners),
    }),
  });
}

/** Whether a listing's place passes the municipality filter. Zig sends the municipality, so this is exact. */
function inMunicipalities(listing: RawListing, filter: string[] | undefined): boolean {
  if (!filter?.length) return true;
  const names = [listing.address.municipality, listing.address.city].filter(Boolean).map((s) => normaliseMunicipality(s ?? ''));
  return names.some((n) => filter.includes(n));
}

/* ---------- the adapter ---------- */

export interface ZigAdapterOptions {
  /** How long to wait for a reaction to show up among the active reactions. Default 8 s. */
  confirmTimeoutMs?: number;
}

const XHR_HEADERS = { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json, text/plain, */*' };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Builds the adapter for one Zig portal. Search posts to `getallobjects` once
 * per poll (the portal has no server-side filter, so the search filters are
 * applied to the answer). Contact reacts in the portal with the session in
 * the persistent browser profile: it needs `nlpf connect <id>` first, and
 * throws `NeedsLoginError` without it.
 */
export function createZigAdapter(def: ZigPortalDef, options: ZigAdapterOptions = {}): SourceAdapter {
  const home = trimTrailingSlashes(def.homepage);
  const d: ZigPortalDef = { ...def, homepage: home };
  const loginUrl = def.loginUrl ?? `${home}${ZIG_PATHS.login}`;
  const confirmTimeoutMs = options.confirmTimeoutMs ?? 8_000;

  async function getObject(objectId: string, ctx: SourceContext): Promise<ZigObject | null> {
    const res = await ctx.fetch(`${home}${ZIG_PATHS.object}`, {
      method: 'POST',
      headers: { ...XHR_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: new URLSearchParams({ id: objectId }).toString(),
    });
    const body = res.json<{ result?: ZigObject | null }>();
    // A missing "result" means the request was not understood (the portal
    // answers wrongly encoded requests with 200 and no result), not "gone".
    if (!body || typeof body !== 'object' || !('result' in body)) throw new Error(`${def.name}: getobject answered without a result`);
    return body.result ?? null;
  }

  const adapter: SourceAdapter = {
    id: def.id,
    name: def.name,
    homepage: home,
    regions: def.regions,
    defaultIntervalSec: def.intervalSec ?? 120,
    capabilities: { search: 'json', detail: true, contact: 'form', login: 'required', terms: 'unknown' },
    loginUrl,

    buildSearches(searches) {
      return [
        {
          key: 'all',
          label: `${def.name}: current offer`,
          url: `${home}${ZIG_PATHS.allObjects}`,
          params: filterParams(portalFilters(searches)),
        },
      ];
    },

    async search(req, ctx) {
      const res = await ctx.fetch(req.url ?? `${home}${ZIG_PATHS.allObjects}`, { method: 'POST', headers: XHR_HEADERS });
      const body = res.json<{ result?: ZigObject[] }>();
      if (!body || !Array.isArray(body.result)) throw new Error(`${def.name}: getallobjects answered without a result list`);
      const now = ctx.now();
      const filters = readFilters(req);
      const out: RawListing[] = [];
      const seen = new Set<string>();
      for (const o of body.result) {
        const listing = zigListing(d, o, now);
        if (!listing || seen.has(listing.externalId)) continue;
        if (!inMunicipalities(listing, filters.municipalities)) continue;
        // Net rent is the lowest figure a portal shows, so this never drops a home a search still wants.
        if (filters.maxRentEur !== undefined && listing.priceEur !== undefined && listing.priceEur > filters.maxRentEur) continue;
        seen.add(listing.externalId);
        out.push(listing);
      }
      ctx.log.debug('zig objects read', { total: body.result.length, kept: out.length });
      return out;
    },

    async detail(listing, ctx) {
      const o = await getObject(String(listing.extra?.objectId ?? listing.externalId), ctx);
      if (!o) return listing;
      const out: RawListing = { ...listing, address: { ...listing.address }, extra: { ...listing.extra } };
      const description = htmlToText(o.description);
      if (description) out.description = listing.description && !description.includes(listing.description) ? `${listing.description}\n\n${description}` : description;
      const images = (o.pictures ?? []).map((p) => absolute(p.uri, home)).filter((u): u is string => Boolean(u));
      if (images.length) out.images = images;
      const service = positive(o.serviceCosts);
      if (service !== undefined && out.serviceCostsEur === undefined) out.serviceCostsEur = service;
      out.extra = compact({
        ...out.extra,
        minimumIncomeEur: positive(o.minimumIncome),
        maximumIncomeEur: positive(o.maximumIncome),
        minimumHouseholdSize: positive(o.minimumHouseholdSize),
        maximumHouseholdSize: positive(o.maximumHouseholdSize),
        minimumAge: positive(o.minimumAge),
        maximumAge: positive(o.maximumAge),
        numberOfReactions: num(o.numberOfReactions),
      });
      return out;
    },

    async isAvailable(listing, ctx) {
      const o = await getObject(String(listing.extra?.objectId ?? listing.externalId), ctx);
      if (!o || !o.id) return false;
      if (o.reactionData?.redenMagNietReagerenCode === 'WINKEL-REACTIE-NIETMEERGEPUBLICEERD') return false;
      return zigSkipReason(o, ctx.now()) === undefined;
    },

    async checkSession(ctx) {
      const session = await ctx.browser();
      try {
        const body = await portalPost(session.page.request, `${home}${ZIG_PATHS.account}`, {});
        const account = body.account as { username?: unknown; persons?: unknown } | null | undefined;
        return account && (account.username || account.persons) ? 'ok' : 'none';
      } finally {
        await session.close().catch(() => undefined);
      }
    },

    async contact(listing, message, ctx) {
      const objectId = String(listing.extra?.objectId ?? listing.externalId);
      const session = await ctx.browser();
      try {
        return await react(session.page.request, objectId, message.dryRun, ctx);
      } finally {
        await session.close().catch(() => undefined);
      }
    },
  };

  async function react(request: APIRequestContext, objectId: string, dryRun: boolean, ctx: SourceContext): Promise<ContactResult> {
    const fail = (error: string, needs?: ContactResult['needs']): ContactResult => compact({ ok: false, channel: 'form' as const, error, needs });
    const body = await portalPost(request, `${home}${ZIG_PATHS.object}`, { id: objectId });
    const o = body.result as ZigObject | null | undefined;
    if (!o || typeof o !== 'object') return fail(`${def.name} no longer knows object ${objectId}`);
    const rd = o.reactionData;
    if (!rd || typeof rd !== 'object') throw new Error(`${def.name}: getobject for ${objectId} has no reactionData`);
    // "kanReageren" says whether the ad accepts reactions at all; only
    // "loggedin" says whether this session is recognised.
    if (!rd.loggedin) throw new NeedsLoginError(`${def.name}: log in with nlpf connect ${def.id} to react`, { loginUrl });
    const action = (rd.action ?? '').trim().toLowerCase();
    if (action === 'remove') return { ok: true, channel: 'form', evidence: 'already reacted: the portal offers to withdraw the reaction' };
    if (o.model?.advertentieSluitenNaEersteReactie) {
      return fail(
        `${def.name} asks to book this home for good ("definitief boeken") and to accept no other offer; a person must decide that`,
        'human',
      );
    }
    if (action && action !== 'add') return fail(`${def.name} offers the action "${action}" instead of a reaction`, 'human');
    if (!rd.kanReageren) {
      const code = (rd.redenMagNietReagerenCode ?? '').trim();
      if (code === 'WINKEL-REACTIE-DUBBEL') return { ok: true, channel: 'form', evidence: 'already reacted' };
      if (code === 'WINKEL-REACTIE-NIETMEERGEPUBLICEERD') return fail(`${def.name} no longer publishes this home`);
      return fail(`${def.name} does not accept a reaction from this account (${code || 'no reason given'})`, 'human');
    }
    const params = Object.fromEntries(new URLSearchParams((rd.url ?? '').replace(/^\?/, '')));
    // Two independent signals must both say "add": a "remove" here would withdraw an existing reaction.
    if (!params.add || 'remove' in params) return fail(`${def.name} gave reaction parameters that are not a new reaction`, 'human');

    const config = await portalGet(request, `${home}${ZIG_PATHS.formConfig}`);
    const form = config.form as { id?: string; elements?: { __hash__?: { initialData?: string } } } | undefined;
    const formId = form?.id;
    const hash = form?.elements?.__hash__?.initialData;
    if (!formId || !hash) return fail(`${def.name} did not hand out a form token`);
    if (dryRun) return { ok: true, channel: 'form', evidence: 'dry run: logged in and the portal accepts a reaction; nothing was sent' };

    const answer = await portalPost(request, `${home}${ZIG_PATHS.react}`, { __id__: formId, __hash__: hash, ...params });
    if (answer.success === false) {
      return fail(`${def.name} refused the reaction: ${JSON.stringify(answer.messages ?? answer.sMessage ?? 'no reason given').slice(0, 300)}`);
    }
    const reactionId = answer.reactionId !== undefined && answer.reactionId !== null ? String(answer.reactionId) : undefined;
    const deadline = Date.now() + confirmTimeoutMs;
    for (;;) {
      if (await hasActiveReaction(request, objectId)) {
        return compact({ ok: true, channel: 'form' as const, externalId: reactionId, evidence: 'the reaction is listed among the active reactions' });
      }
      if (Date.now() >= deadline) break;
      ctx.signal.throwIfAborted();
      await sleep(1_000);
    }
    return fail(`reacted on ${def.name} but the reaction is not among the active reactions; check before reacting again`, 'human');
  }

  async function hasActiveReaction(request: APIRequestContext, objectId: string): Promise<boolean> {
    const body = await portalPost(request, `${home}${ZIG_PATHS.activeReactions}`, {});
    const items = (body.result as { items?: { object?: { id?: unknown } }[] } | undefined)?.items ?? [];
    return items.some((it) => String(it?.object?.id ?? '') === objectId);
  }

  return adapter;
}

/* ---------- requests with the browser profile's cookies ---------- */

async function readJson(res: Awaited<ReturnType<APIRequestContext['get']>>, url: string): Promise<Record<string, unknown>> {
  const status = res.status();
  if (status === 403 || status === 429) throw new SourceBlockedError(`${url} refused the request`, { status, url });
  if (status >= 400) throw new SourceHttpError(`${url} answered ${status}`, { status, url });
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new SourceHttpError(`${url} did not answer with JSON`, { status, url });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new SourceHttpError(`${url} answered with something other than an object`, { status, url });
  return body as Record<string, unknown>;
}

/** A form-encoded POST like the portal's own XHR calls. Every endpoint but getallobjects wants this encoding. */
async function portalPost(request: APIRequestContext, url: string, form: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await request.post(url, { form, headers: XHR_HEADERS, timeout: 20_000 });
  return readJson(res, url);
}

async function portalGet(request: APIRequestContext, url: string): Promise<Record<string, unknown>> {
  const res = await request.get(url, { headers: XHR_HEADERS, timeout: 20_000 });
  return readJson(res, url);
}
