import type { APIRequestContext, Page, Request } from 'playwright-core';
import type { ContactResult, PropertyType, RawListing, SourceAdapter, SourceContext } from '@nlpf/core';
import { NeedsLoginError, SourceBlockedError, SourceHttpError } from '../runtime/errors.js';
import { normalisePostcode, splitAddress } from '../util/address.js';
import { detectType } from '../util/parse.js';
import { filterParams, htmlToText, placePasses, portalFilters, readFilters, round2 } from './zig.js';

/*
 * The generic adapter for Embrace Cloud housing portals (Woonnet Rijnmond and
 * other corporations on the same "mesh router" GraphQL gateway). The gateway
 * answers the offer anonymously, keyed by tenant and portal id; applying
 * needs the user's Keycloak session, which the portal's own page picks up in
 * the persistent browser profile.
 *
 * Checked on 2026-09-24 against Woonnet Rijnmond: the list query below (a
 * trimmed copy of the page's own widgetListGetPublications) answered 88
 * publications in one page; the precheck and application-details queries are
 * the page's own and answered anonymously ("Je moet inloggen om te
 * reageren"). The apply mutation is the page's own text; it was never sent.
 */

export const EMBRACE_GATEWAY = 'https://portal.mesh-router.embracecloud.nl/graphql';

export interface EmbracePortalDef {
  /** Source id, such as "woonnet-rijnmond". */
  id: string;
  name: string;
  /** Portal origin without a trailing slash. */
  homepage: string;
  /** Locale segment of the portal's URLs and the gateway's `locale` variable. */
  locale: string;
  /** `tenantName` and `portalId` from the portal's /base/config.json. */
  tenantId: string;
  portalId: string;
  /** Default: the shared mesh router. Tests point it at a local server. */
  gateway?: string;
  /** Path of a publication page; the unit slug is appended. */
  detailPath: string;
  /** Municipalities (lowercase) the portal covers. */
  regions: string[];
  /** Places the portal names that belong to a municipality of another name ("hoogvliet" is in "rotterdam"). */
  places?: Record<string, string>;
  /** What reacting needs, in one line: account and fee. */
  registration: string;
  /** Where the login starts. Default: the homepage, which has the login button. */
  loginUrl?: string;
  /** The Keycloak realm URL; no cookie there means no session, without loading the portal. */
  authRealmUrl?: string;
  intervalSec?: number;
  /** Publications per request. Default 100, which covered the whole Woonnet Rijnmond offer. */
  pageSize?: number;
  /** At most this many pages per poll. Default 5. */
  maxPages?: number;
}

/** The list query the adapter sends: the portal's own operation, trimmed to the fields it maps. */
export const EMBRACE_LIST_QUERY = `query widgetListGetPublications($orderBy: HousingPublicationsOrder = STARTDATE_ASC, $first: Int = 20, $after: String, $filter: HousingWherePublicationFilterInput, $locale: String = "nl-NL") {
  housingPublications(orderBy: $orderBy, filter: $filter, locale: $locale) {
    nodes(first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          startTime
          stopTime
          totalNumberOfApplications
          allocationProcess { id name applicationMethod }
          unit {
            id
            description
            slug { value }
            unitUsageType
            suitability
            basicRent { exact }
            grossRent { exact }
            thumbnails: photos(size: PRESENTATION) { edges { node { url } } }
            location { id addressLine1 addressLine2 }
            types { edges { node { name } } }
            availableDate
            endDateTemporaryRentalAgreement
            externalApplyUrl { value }
            dimensions { edges { node { area surfaceArea } } }
            energyRating { name }
            numberOfBedrooms { exact }
            availableFor { name }
          }
        }
      }
    }
  }
}`;

/** The filter the portal's own list widget sends: ordinary units and clusters open to everyone. */
export const EMBRACE_LIST_FILTER = {
  and: [
    { or: [{ suitability: { eq: 'NO_PREFERENCE' } }] },
    { or: [{ unitUsageType: { eq: 'STANDARD' } }, { unitUsageType: { eq: 'CLUSTER' } }] },
  ],
};

export const EMBRACE_DETAILS_QUERY =
  'query widgetReactionGetApplicationDetails($publicationId: String, $locale: String) {\n  applicationDetails: housingPublications(\n    where: {publicationId: {eq: $publicationId}}\n    locale: $locale\n  ) {\n    nodes {\n      edges {\n        node {\n          id\n          startTime\n          stopTime\n          totalNumberOfApplications\n          allocationProcess {\n            id\n            description\n            applicationMethod\n            __typename\n          }\n          applicantSpecific {\n            applicantId\n            allocationRanking\n            sortingGroup {\n              id\n              category\n              __typename\n            }\n            __typename\n          }\n          useDigitalIncome\n          unit {\n            id\n            ...WidgetPublicationReactionHousingPublicationUnit\n            __typename\n          }\n          __typename\n        }\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n}\n\nfragment WidgetPublicationReactionHousingPublicationUnit on HousingPublicationUnit {\n  unitUsageType\n  externalApplyUrl {\n    value\n    __typename\n  }\n  location {\n    id\n    address {\n      addressLine\n      __typename\n    }\n    __typename\n  }\n  availableDate\n  photos {\n    items {\n      id: url\n      url\n      __typename\n    }\n    __typename\n  }\n  __typename\n}';

export const EMBRACE_PRECHECK_QUERY =
  'query widgetReactionGetPrecheckStatus($slug: ID!, $locale: String) {\n  precheckStatus: housingApplicationPrecheck(\n    input: {publicationId: $slug}\n    locale: $locale\n  ) {\n    ...ReactionPrecheckStatus\n    __typename\n  }\n}\n\nfragment ReactionPrecheckStatus on HousingApplyOutput {\n  state\n  canApply\n  description\n  userErrors {\n    field\n    message {\n      locale\n      text\n      __typename\n    }\n    __typename\n  }\n  __typename\n}';

export const EMBRACE_APPLY_MUTATION = `mutation widgetSharedFloatingReactionApplyUnit($publicationId: ID!, $interestedInAlternatives: Boolean! = false, $preferences: [HousingPublicationPreferencesItemInput!] = [], $locale: String) {
  application: housingApplyToUnit(
    input: {publicationId: $publicationId, preference: {interestedInAlternatives: $interestedInAlternatives, preferences: $preferences}}
    locale: $locale
  ) {
    state
    userErrors {
      field
      message {
        locale
        text
      }
    }
  }
}`;

/* ---------- mapping ---------- */

interface Edge<T> {
  node?: T | null;
}
interface Connection<T> {
  edges?: Edge<T>[] | null;
}

export interface EmbracePublication {
  id?: string;
  startTime?: string | null;
  stopTime?: string | null;
  totalNumberOfApplications?: number | null;
  allocationProcess?: { id?: string; name?: string | null; applicationMethod?: string | null } | null;
  unit?: {
    id?: string;
    description?: string | null;
    slug?: { value?: string | null } | null;
    unitUsageType?: string | null;
    basicRent?: { exact?: number | null } | null;
    grossRent?: { exact?: number | null } | null;
    thumbnails?: Connection<{ url?: string | null }> | null;
    location?: { id?: string | null; addressLine1?: string | null; addressLine2?: string | null } | null;
    types?: Connection<{ name?: string | null }> | null;
    availableDate?: string | null;
    endDateTemporaryRentalAgreement?: string | null;
    externalApplyUrl?: { value?: string | null } | null;
    dimensions?: Connection<{ area?: string | null; surfaceArea?: number | null }> | null;
    energyRating?: { name?: string | null } | null;
    numberOfBedrooms?: { exact?: number | null } | null;
    availableFor?: { name?: string | null } | null;
  } | null;
}

const nodes = <T>(c: Connection<T> | null | undefined): T[] =>
  (c?.edges ?? []).map((e) => e?.node).filter((n): n is T => Boolean(n));

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const positive = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);

function compact<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
  return o;
}

/** Decodes a Relay id ("SG91c2luZ1B1YmxpY2F0aW9uOjEwMDEyMzMxMw==" is "HousingPublication:100123313") to its part after the colon. */
export function relayKey(id: string | null | undefined): string | undefined {
  if (!id) return undefined;
  try {
    const text = Buffer.from(id, 'base64').toString('utf8');
    const i = text.indexOf(':');
    return i > 0 && /^[A-Za-z]+$/.test(text.slice(0, i)) ? text.slice(i + 1) : undefined;
  } catch {
    return undefined;
  }
}

/** The location id carries postcode, house number and addition: "HousingLocation:3073EJ;16;B;". */
export function embraceLocation(id: string | null | undefined): { postcode?: string; houseNumber?: string; addition?: string } {
  const key = relayKey(id);
  if (!key) return {};
  const [pc, nr, add] = key.split(';');
  return compact({
    postcode: normalisePostcode(pc ?? ''),
    houseNumber: nr && nr !== '0' ? nr : undefined,
    addition: add ? (/^\p{L}$/u.test(add) ? add.toUpperCase() : add) : undefined,
  });
}

/** The allocation model in the product's words, from the portal's own name for it. */
export function embraceModel(name: string | null | undefined): { model: string; firstComeFirstServed: boolean } {
  const n = (name ?? '').toLowerCase();
  if (/inschrijfduur/.test(n)) return { model: 'inschrijfduur', firstComeFirstServed: false };
  if (/loting/.test(n)) return { model: 'loting', firstComeFirstServed: false };
  // DirectKans: react between 20:00 and 20:15, then a lottery sets the order.
  if (/directkans/.test(n)) return { model: 'directkans', firstComeFirstServed: false };
  if (/eerste|snel/.test(n)) return { model: 'eerste-reactie', firstComeFirstServed: true };
  if (/extern/.test(n)) return { model: 'extern', firstComeFirstServed: false };
  if (/wens/.test(n)) return { model: 'wens-en-wacht', firstComeFirstServed: false };
  const slug = n.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return { model: slug || 'unknown', firstComeFirstServed: false };
}

const NOT_A_HOME = /garage|parkeer|berging|bedrijf|winkel|opslag|kantoor/i;

function embraceType(names: string[]): PropertyType | undefined {
  const text = names.join(' ');
  const direct = detectType(text);
  if (direct) return direct;
  if (/flat|maisonnette|portiek|galerij|appartement|bovenwoning|benedenwoning|etage/i.test(text)) return 'apartment';
  if (/eengezins|woonhuis|hoekwoning|tussenwoning|herenhuis|seniorenwoning/i.test(text)) return 'house';
  return undefined;
}

/** "2026-09-22T00:00:00+02:00" is the Amsterdam date 2026-09-22. */
const localDate = (v: string | null | undefined) => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : undefined);

const toIso = (v: string | null | undefined) => {
  const t = v ? Date.parse(v) : NaN;
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
};

/** Maps one publication, or returns undefined for clusters, parking and closed ads. */
export function embraceListing(def: EmbracePortalDef, p: EmbracePublication, now: Date): RawListing | undefined {
  const u = p.unit;
  const slug = str(u?.slug?.value);
  if (!u || !p.id || !slug) return undefined;
  // A cluster ("Wens&Wacht") is a complex to register interest in, not a vacancy.
  if (u.unitUsageType && u.unitUsageType !== 'STANDARD') return undefined;
  const typeNames = nodes(u.types).map((t) => str(t.name)).filter((t): t is string => Boolean(t));
  if (typeNames.some((t) => NOT_A_HOME.test(t))) return undefined;
  const stop = toIso(p.stopTime);
  if (stop && Date.parse(stop) < now.getTime()) return undefined;

  const url = `${def.homepage}${def.detailPath}${slug}`;
  const line1 = str(u.location?.addressLine1) ?? slug;
  const fromId = embraceLocation(u.location?.id);
  const split = splitAddress(line1);
  const basic = positive(u.basicRent?.exact ?? undefined);
  const gross = positive(u.grossRent?.exact ?? undefined);
  const total = nodes(u.dimensions).find((d) => d.area === 'TOTAL');
  // Surfaces come in millionths of a square metre (68500000 is 68.5 m2).
  const size = positive(total?.surfaceArea ?? undefined);
  const method = str(p.allocationProcess?.applicationMethod ?? undefined)?.toUpperCase();
  const external = str(u.externalApplyUrl?.value ?? undefined);
  const model = embraceModel(p.allocationProcess?.name);
  const images = nodes(u.thumbnails)
    .map((n) => str(n.url))
    .filter((x): x is string => Boolean(x))
    .slice(0, 12);

  return compact<RawListing>({
    sourceId: def.id,
    externalId: relayKey(p.id) ?? p.id,
    url,
    title: line1,
    priceEur: basic ?? gross,
    priceBasis: basic !== undefined ? 'excl' : gross !== undefined ? 'incl' : undefined,
    serviceCostsEur: basic !== undefined && gross !== undefined && gross > basic ? round2(gross - basic) : undefined,
    sizeM2: size !== undefined ? Math.round(size / 1_000_000) || undefined : undefined,
    bedrooms: positive(u.numberOfBedrooms?.exact ?? undefined),
    type: embraceType(typeNames),
    address: compact({
      street: split.street,
      houseNumber: fromId.houseNumber ?? split.houseNumber,
      addition: fromId.addition ?? split.addition,
      postcode: fromId.postcode,
      city: str(u.location?.addressLine2 ?? undefined),
    }),
    availableFrom: localDate(u.availableDate),
    description: htmlToText(u.description),
    images: images.length ? images : undefined,
    energyLabel: str(u.energyRating?.name ?? undefined)?.toUpperCase(),
    publishedAt: toIso(p.startTime),
    agent: { name: def.name, url: def.homepage },
    contact: method === 'EXTERNAL' || method === 'FORM' ? 'none' : 'form',
    contactUrl: method === 'EXTERNAL' && external ? external : url,
    language: 'nl',
    extra: compact({
      platform: 'embrace',
      publicationId: p.id,
      model: model.model,
      modelName: str(p.allocationProcess?.name ?? undefined),
      applicationMethod: method,
      firstComeFirstServed: model.firstComeFirstServed,
      closingAt: stop,
      applications: typeof p.totalNumberOfApplications === 'number' ? p.totalNumberOfApplications : undefined,
      availableFor: str(u.availableFor?.name ?? undefined),
      temporaryUntil: localDate(u.endDateTemporaryRentalAgreement),
      externalApplyUrl: external,
      registration: def.registration,
    }),
  });
}

/* ---------- the adapter ---------- */

export interface EmbraceAdapterOptions {
  /** How long to wait for the portal page to show a logged-in request. Default 8 s after the page settled. */
  tokenWaitMs?: number;
}

type GraphQlBody = { data?: Record<string, unknown> | null; errors?: { message?: string }[] };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Builds the adapter for one Embrace portal. Search asks the gateway for the
 * whole offer (a page of 100) with the portal's own anonymous filter, then
 * applies the search filters. Contact applies with the user's session: it
 * opens the publication page in the persistent profile, takes the bearer
 * token the page itself sends to the gateway, runs the portal's precheck and
 * then its apply mutation.
 */
export function createEmbraceAdapter(def: EmbracePortalDef, options: EmbraceAdapterOptions = {}): SourceAdapter {
  const home = def.homepage.replace(/\/+$/, '');
  const d: EmbracePortalDef = { ...def, homepage: home };
  const gateway = def.gateway ?? EMBRACE_GATEWAY;
  const loginUrl = def.loginUrl ?? `${home}/${def.locale}`;
  const tokenWaitMs = options.tokenWaitMs ?? 8_000;
  const known = new Set([...def.regions, ...Object.values(def.places ?? {})].map((r) => r.toLowerCase()));

  const headers = (authorization = ''): Record<string, string> => ({
    'content-type': 'application/json',
    accept: 'application/graphql-response+json,application/json;q=0.9',
    'x-ec-tenant-id': def.tenantId,
    'x-ec-portal-id': def.portalId,
    origin: home,
    referer: `${home}/`,
    authorization,
  });

  async function query(ctx: SourceContext, operationName: string, q: string, variables: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await ctx.fetch(gateway, { method: 'POST', headers: headers(), body: JSON.stringify({ operationName, query: q, variables }) });
    return graphQlData(res.json<GraphQlBody>(), operationName);
  }

  const adapter: SourceAdapter = {
    id: def.id,
    name: def.name,
    homepage: home,
    regions: def.regions,
    defaultIntervalSec: def.intervalSec ?? 300,
    capabilities: { search: 'json', detail: false, contact: 'form', login: 'required', terms: 'unknown' },
    loginUrl,

    buildSearches(searches) {
      return [{ key: 'all', label: `${def.name}: current offer`, url: gateway, params: filterParams(portalFilters(searches)) }];
    },

    async search(req, ctx) {
      const filters = readFilters(req);
      const now = ctx.now();
      const out: RawListing[] = [];
      const seen = new Set<string>();
      let after: string | undefined;
      for (let page = 0; page < (def.maxPages ?? 5); page++) {
        const data = await query(ctx, 'widgetListGetPublications', EMBRACE_LIST_QUERY, {
          orderBy: 'STARTDATE_ASC',
          first: def.pageSize ?? 100,
          after,
          locale: def.locale,
          filter: EMBRACE_LIST_FILTER,
        });
        const conn = (data.housingPublications as { nodes?: Connection<EmbracePublication> & { pageInfo?: { hasNextPage?: boolean; endCursor?: string } } } | undefined)?.nodes;
        if (!conn) throw new Error(`${def.name}: the gateway answered without housingPublications`);
        for (const p of nodes(conn)) {
          const listing = embraceListing(d, p, now);
          if (!listing || seen.has(listing.externalId)) continue;
          if (!placePasses(listing.address.city, filters.municipalities, known, def.places)) continue;
          if (filters.maxRentEur !== undefined && listing.priceEur !== undefined && listing.priceEur > filters.maxRentEur) continue;
          seen.add(listing.externalId);
          out.push(listing);
        }
        if (!conn.pageInfo?.hasNextPage || !conn.pageInfo.endCursor) break;
        after = conn.pageInfo.endCursor;
      }
      ctx.log.debug('embrace publications read', { kept: out.length });
      return out;
    },

    async isAvailable(listing, ctx) {
      const publicationId = String(listing.extra?.publicationId ?? '');
      if (!publicationId) return true;
      const data = await query(ctx, 'widgetReactionGetApplicationDetails', EMBRACE_DETAILS_QUERY, { publicationId, locale: def.locale });
      const found = nodes((data.applicationDetails as { nodes?: Connection<EmbracePublication> } | undefined)?.nodes);
      const p = found[0];
      if (!p) return false;
      const stop = toIso(p.stopTime);
      return !(stop && Date.parse(stop) < ctx.now().getTime());
    },

    async checkSession(ctx) {
      const session = await ctx.browser();
      try {
        if (def.authRealmUrl && (await session.page.context().cookies(def.authRealmUrl)).length === 0) return 'none';
        const token = await portalToken(session.page, `${home}/${def.locale}`);
        return token ? 'ok' : 'none';
      } finally {
        await session.close().catch(() => undefined);
      }
    },

    async contact(listing, message, ctx) {
      const publicationId = String(listing.extra?.publicationId ?? '');
      if (!publicationId) return { ok: false, channel: 'form', error: `${def.name}: the listing has no publication id` };
      if (listing.contact === 'none') {
        return { ok: false, channel: 'form', needs: 'human', error: `${def.name} takes reactions for this home elsewhere: ${listing.contactUrl ?? listing.url}` };
      }
      const session = await ctx.browser();
      try {
        const token = await portalToken(session.page, listing.url);
        if (!token) throw new NeedsLoginError(`${def.name}: log in with nlpf connect ${def.id} to react`, { loginUrl });
        return await apply(session.page.request, token, publicationId, message.dryRun);
      } finally {
        await session.close().catch(() => undefined);
      }
    },
  };

  /** Opens a portal page and returns the bearer token the page sends to the gateway, if it sends one. */
  async function portalToken(page: Page, url: string): Promise<string | undefined> {
    let token: string | undefined;
    let calls = 0;
    const onRequest = (r: Request) => {
      if (!r.url().startsWith(gateway)) return;
      calls++;
      const auth = r.headers().authorization;
      if (auth && /^bearer\s+\S/i.test(auth)) token = auth;
    };
    page.on('request', onRequest);
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);
      const deadline = Date.now() + tokenWaitMs;
      // The page may still be logging in silently; stop early once it has
      // talked to the gateway without a token for a while.
      while (!token && Date.now() < deadline) {
        await sleep(250);
        if (calls > 0 && Date.now() > deadline - tokenWaitMs / 2) break;
      }
      return token;
    } finally {
      page.off('request', onRequest);
    }
  }

  async function apply(request: APIRequestContext, token: string, publicationId: string, dryRun: boolean): Promise<ContactResult> {
    const call = async (operationName: string, q: string, variables: Record<string, unknown>) => {
      const res = await request.post(gateway, {
        data: { operationName, query: q, variables },
        headers: headers(token),
        timeout: 30_000,
      });
      const status = res.status();
      if (status === 401) throw new NeedsLoginError(`${def.name}: the session expired`, { loginUrl });
      if (status === 403 || status === 429) throw new SourceBlockedError(`${gateway} refused the request`, { status, url: gateway });
      if (status >= 400) throw new SourceHttpError(`${gateway} answered ${status}`, { status, url: gateway });
      return graphQlData((await res.json()) as GraphQlBody, operationName);
    };

    const pre = (await call('widgetReactionGetPrecheckStatus', EMBRACE_PRECHECK_QUERY, { slug: publicationId, locale: def.locale }))
      .precheckStatus as { state?: string; canApply?: boolean; description?: string; userErrors?: UserError[] } | undefined;
    const state = (pre?.state ?? '').toUpperCase();
    if (state === 'NOT_LOGGED_IN') throw new NeedsLoginError(`${def.name}: log in with nlpf connect ${def.id} to react`, { loginUrl });
    if (!pre?.canApply) {
      if (/APPLIED|REACTED/.test(state)) return { ok: true, channel: 'form', evidence: `already reacted (${state})` };
      const why = pre?.description || errorText(pre?.userErrors) || state || 'no reason given';
      return { ok: false, channel: 'form', needs: 'human', error: `${def.name} does not accept a reaction now: ${why}` };
    }
    if (dryRun) return { ok: true, channel: 'form', evidence: 'dry run: logged in and the precheck allows a reaction; nothing was sent' };

    const result = (await call('widgetSharedFloatingReactionApplyUnit', EMBRACE_APPLY_MUTATION, {
      publicationId,
      interestedInAlternatives: false,
      locale: def.locale,
    })).application as { state?: string; userErrors?: UserError[] } | undefined;
    const errors = errorText(result?.userErrors);
    if (errors) return { ok: false, channel: 'form', error: `${def.name} refused the reaction: ${errors}` };
    if (!result?.state) {
      return { ok: false, channel: 'form', needs: 'human', error: `sent the reaction to ${def.name} but it did not confirm; check before reacting again` };
    }
    return { ok: true, channel: 'form', evidence: `reaction registered (${result.state})` };
  }

  return adapter;
}

type UserError = { field?: string; message?: { text?: string } | { text?: string }[] | null };

function errorText(errors: UserError[] | undefined): string | undefined {
  const texts = (errors ?? [])
    .flatMap((e) => (Array.isArray(e.message) ? e.message : [e.message]))
    .map((m) => m?.text)
    .filter((t): t is string => Boolean(t));
  return texts.length ? texts.join('; ') : undefined;
}

function graphQlData(body: GraphQlBody, operation: string): Record<string, unknown> {
  if (body?.errors?.length) throw new Error(`${operation}: ${body.errors.map((e) => e.message).join('; ').slice(0, 300)}`);
  if (!body?.data) throw new Error(`${operation}: the gateway answered without data`);
  return body.data;
}
