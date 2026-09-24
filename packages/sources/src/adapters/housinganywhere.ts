/**
 * HousingAnywhere (housinganywhere.com): furnished rooms, studios and
 * apartments for international students and young professionals. Listings
 * come from the public Algolia index the site's own search uses; messaging
 * a landlord needs a login and, for Dutch listings, a paid subscription
 * ("NL subscriptions" in the listing data).
 *
 * Verified live on 2026-09-24: the Algolia app id, search key and the
 * `production_listings_most_recent` index (from the search page config);
 * `city:"..."` and `priceEUR <= n` filters; hit fields; the listing page's
 * `window.__PRELOADED_STATE__` (description, deposit, `activeConversationCount`,
 * `authLogic.isAuthenticated`); `/oauth/signin` redirecting to
 * id.housinganywhere.com. Anonymous visitors only see "Apply to rent"
 * (`ListingActionButtonsContact/CheckAvailability`). What a logged-in tenant
 * sees after that button (message box, subscription offer, date picker) was
 * not seen live; `contact` handles each of those outcomes and hands anything
 * unexpected to a person.
 */
import type {
  ContactResult,
  Furnishing,
  InboundMessage,
  Listing,
  NamedSearch,
  PropertyType,
  RawListing,
  SearchRequest,
  SourceAdapter,
  SourceContext,
} from '@nlpf/core';
import { NeedsLoginError, SourceHttpError } from '../runtime/errors.js';
import { normalisePostcode } from '../util/address.js';
import { detectFurnishing, parseBedrooms, parseDutchDate, parsePrice, parseSize } from '../util/parse.js';
import {
  alertCards,
  assignedJson,
  clean,
  compact,
  filterKey,
  firstLine,
  firstVisible,
  isObj,
  municipalityName,
  num,
  pageText,
  positive,
  reencode,
  searchMunicipalities,
  senderIs,
  showsCaptcha,
  str,
  waitForConfirmation,
  ymd,
} from './json-shared.js';

const ALGOLIA_APP = 'Y8L112MIBF';
const ALGOLIA_KEY = '170cf5d8f85035f219107d6fb900e3dd';
const INDEX = 'production_listings_most_recent';

/** Hit fields the adapter reads; asking only for these keeps each poll small. */
const ATTRIBUTES = [
  'objectID',
  'internalID',
  'unitTypeInternalID',
  'path',
  'unitTypePath',
  'city',
  'street',
  'neighborhood',
  'countryCode',
  '_geoloc',
  'propertyType',
  'priceEUR',
  'priceType',
  'utilities',
  'estimatedBillsEUR',
  'facility_total_size',
  'facility_bedroom_size',
  'facility_bedroom_count',
  'apartmentBedroomCount',
  'facility_bedroom_furnished',
  'facility_registration_possible',
  'facility_tenant_status',
  'minimumStayMonths',
  'dateFrom',
  'dateTo',
  'creationDate',
  'creationDateTS',
  'photos',
  'description',
  'advertiserFirstName',
  'advertiserId',
  'landlordType',
  'favoritesCount',
  'isSearchable',
];

const TYPES: Record<string, { type: PropertyType; label: string }> = {
  PRIVATE_ROOM: { type: 'room', label: 'Private room' },
  SHARED_ROOM: { type: 'room', label: 'Shared room' },
  STUDIO: { type: 'studio', label: 'Studio' },
  APARTMENT: { type: 'apartment', label: 'Apartment' },
  HOUSE: { type: 'house', label: 'House' },
};

/** HousingAnywhere's city names differ from Dutch municipality names in a few places. */
const CITY: Record<string, string> = { 'den haag': 'The Hague', 'den bosch': "'s-Hertogenbosch" };
const DUTCH_CITY: Record<string, string> = { 'The Hague': 'Den Haag' };

export function housingAnywhereCity(municipality: string): string {
  return CITY[municipality] ?? municipalityName(municipality);
}

function propertyTypes(types: PropertyType[]): string[] {
  if (types.includes('other')) return [];
  const out: string[] = [];
  if (types.includes('room')) out.push('PRIVATE_ROOM', 'SHARED_ROOM');
  if (types.includes('studio')) out.push('STUDIO');
  if (types.includes('apartment')) out.push('APARTMENT');
  if (types.includes('house')) out.push('HOUSE');
  return out.length === 5 ? [] : out;
}

const quote = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** The `ut<digits>` id of a listing path such as `/room/ut1739453/nl/Rotterdam/insulindestraat`. */
export function unitTypeId(path: string): string | undefined {
  return /\/(ut\d{4,})(?:\/|$)/.exec(path)?.[1];
}

const DETAIL_PATH =
  /^\/(?:[a-z]{2}\/)?(room|private-room|shared-room|studio|apartment|house)\/(ut\d{4,})\/[a-z]{2}\/([^/]+)(?:\/([^/?#]+))?\/?$/i;

export interface HousingAnywhereOptions {
  /** Site root, for tests against a local server. Default https://housinganywhere.com. */
  baseUrl?: string;
  /** Algolia endpoint. Default the public DSN host of the site's app. */
  algoliaUrl?: string;
  /** How long to wait for the confirmation after sending a message. Default 20 s. */
  confirmTimeoutMs?: number;
}

const ALERT_DOMAINS = ['housinganywhere.com'];

export function createHousingAnywhereAdapter(options: HousingAnywhereOptions = {}): SourceAdapter {
  const base = (options.baseUrl ?? 'https://housinganywhere.com').replace(/\/+$/, '');
  const algolia =
    options.algoliaUrl ??
    `https://${ALGOLIA_APP.toLowerCase()}-dsn.algolia.net/1/indexes/*/queries?x-algolia-api-key=${ALGOLIA_KEY}&x-algolia-application-id=${ALGOLIA_APP}`;
  const confirmTimeoutMs = options.confirmTimeoutMs ?? 20_000;
  const loginUrl = `${base}/oauth/signin`;
  const listingUrl = (path: string) => `${base}${reencode(path)}`;

  async function query(
    ctx: SourceContext,
    filters: string,
    hitsPerPage: number,
    attributes = ATTRIBUTES,
  ): Promise<{ hits: Record<string, unknown>[]; nbHits: number }> {
    const res = await ctx.fetch(algolia, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        origin: base,
        referer: `${base}/`,
      },
      body: JSON.stringify({
        requests: [
          {
            indexName: INDEX,
            query: '',
            hitsPerPage,
            page: 0,
            filters,
            attributesToRetrieve: attributes,
            attributesToHighlight: [],
          },
        ],
      }),
    });
    const result = res.json<{ results?: { hits?: unknown[]; nbHits?: number }[] }>().results?.[0];
    return { hits: (result?.hits ?? []).filter(isObj), nbHits: result?.nbHits ?? 0 };
  }

  function toRaw(h: Record<string, unknown>): RawListing | undefined {
    const path = str(h.path) ?? str(h.unitTypePath);
    const id = path ? unitTypeId(path) : undefined;
    if (!path || !id || h.isSearchable === false) return undefined;
    const t = TYPES[str(h.propertyType) ?? ''];
    const city = str(h.city);
    const street = str(h.street);
    const price = positive(h.priceEUR);
    const utilities = str(h.utilities);
    const basis = utilities === 'I' ? 'incl' : utilities === 'E' ? 'excl' : 'unknown';
    const bills = basis === 'excl' ? positive(h.estimatedBillsEUR) : undefined;
    const furnished = str(h.facility_bedroom_furnished);
    const furnishing: Furnishing | undefined =
      furnished === 'yes' ? 'furnished' : furnished === 'no' ? 'unfurnished' : undefined;
    const geo = isObj(h._geoloc) ? h._geoloc : {};
    const photos = Array.isArray(h.photos) ? h.photos.filter((p): p is string => typeof p === 'string') : [];
    const created = num(h.creationDateTS);
    const reg = str(h.facility_registration_possible);
    // For rooms, `facility_total_size` is the whole house; only the bedroom size describes the room.
    const isRoom = t?.type === 'room';
    const size = isRoom ? positive(h.facility_bedroom_size) : positive(h.facility_total_size);
    return compact<RawListing>({
      sourceId: 'housinganywhere',
      externalId: id,
      url: listingUrl(path),
      title: clean(`${t?.label ?? 'Place'} in ${street ?? city ?? ''}${street && city ? `, ${city}` : ''}`),
      priceEur: price,
      priceBasis: price === undefined ? undefined : basis,
      serviceCostsEur: bills,
      sizeM2: size,
      bedrooms: isRoom
        ? undefined
        : (positive(h.facility_bedroom_count) ?? positive(h.apartmentBedroomCount)),
      type: t?.type ?? 'other',
      furnishing,
      address: compact({
        street,
        city: city ? (DUTCH_CITY[city] ?? city) : undefined,
        neighbourhood: str(h.neighborhood),
        lat: num(geo.lat),
        lon: num(geo.lng),
      }),
      availableFrom: ymd(h.dateFrom),
      description: str(h.description),
      images: photos.length ? photos.slice(0, 5) : undefined,
      agent: compact({ name: str(h.advertiserFirstName) }),
      contact: 'message',
      contactUrl: listingUrl(path),
      publishedAt: created ? new Date(created * 1000).toISOString() : undefined,
      language: 'en',
      extra: compact({
        advertiserId: num(h.advertiserId),
        landlordType: str(h.landlordType),
        minimumStayMonths: positive(h.minimumStayMonths),
        registrationPossible: reg === 'yes' ? true : reg === 'no' ? false : undefined,
        tenantStatus: str(h.facility_tenant_status),
        availableUntil: ymd(h.dateTo)?.startsWith('9999') ? undefined : ymd(h.dateTo),
        favorites: num(h.favoritesCount),
        houseSizeM2: isRoom ? positive(h.facility_total_size) : undefined,
      }),
    });
  }

  const adapter: SourceAdapter = {
    id: 'housinganywhere',
    name: 'HousingAnywhere',
    homepage: 'https://housinganywhere.com',
    regions: 'nl',
    defaultIntervalSec: 60,
    capabilities: {
      search: 'json',
      detail: true,
      contact: 'message',
      login: 'required',
      paid: { feature: 'contact', plan: 'housinganywhere-plus' },
      terms: 'forbids',
      browser: 'headless',
    },
    loginUrl,
    alertSenders: ['no-reply@housinganywhere.com', 'housinganywhere.com'],

    buildSearches(searches: NamedSearch[]): SearchRequest[] {
      const out = new Map<string, SearchRequest>();
      for (const search of searches) {
        const cities = searchMunicipalities(search).map(housingAnywhereCity);
        const kinds = propertyTypes(search.types);
        const parts = ['isSearchable:true', 'exclusivityPartnerIDs:0'];
        parts.push(
          cities.length ? `(${cities.map((c) => `city:${quote(c)}`).join(' OR ')})` : 'country:Netherlands',
        );
        if (search.priceMaxEur !== undefined) parts.push(`priceEUR <= ${search.priceMaxEur}`);
        if (search.priceMinEur !== undefined) parts.push(`priceEUR >= ${search.priceMinEur}`);
        if (kinds.length) parts.push(`(${kinds.map((k) => `propertyType:${k}`).join(' OR ')})`);
        const filters = parts.join(' AND ');
        const key = `${cities.join(',') || 'nl'}?${filterKey({ max: search.priceMaxEur, min: search.priceMinEur, types: kinds.join(',') })}`;
        if (!out.has(key))
          out.set(key, {
            key,
            label: `HousingAnywhere ${cities.join(', ') || 'Netherlands'}`,
            url: algolia,
            params: { index: INDEX, filters, hitsPerPage: 40 },
          });
      }
      return [...out.values()];
    },

    async search(req, ctx) {
      const p = req.params ?? {};
      const { hits } = await query(
        ctx,
        String(p.filters ?? 'isSearchable:true AND country:Netherlands'),
        Number(p.hitsPerPage ?? 40),
      );
      const out: RawListing[] = [];
      const seen = new Set<string>();
      for (const h of hits) {
        const raw = toRaw(h);
        // One unit can appear once per bookable period; keep the newest.
        if (raw && !seen.has(raw.externalId)) {
          seen.add(raw.externalId);
          out.push(raw);
        }
      }
      ctx.log.debug('housinganywhere listings read', { count: out.length });
      return out;
    },

    async detail(listing, ctx) {
      const res = await ctx.fetch(listing.url);
      const state = assignedJson(res.text, '__PRELOADED_STATE__');
      const l = isObj(state?.listing) ? state.listing : undefined;
      const e = isObj(l?.entity) ? l.entity : undefined;
      if (!e) return listing;
      const out: RawListing = { ...listing, address: { ...listing.address }, extra: { ...listing.extra } };
      const extra = out.extra as Record<string, unknown>;
      const description = str(e.description);
      if (description) out.description = description;
      const postcode = normalisePostcode(str(e.zip) ?? '');
      if (postcode) out.address.postcode = postcode;
      const number = str(e.housenumber);
      if (number) out.address.houseNumber = number;
      const costs = isObj(e.costs) && isObj(e.costs.costs) ? e.costs.costs : {};
      const deposit = isObj(costs['security-deposit'])
        ? positive(costs['security-deposit'].value)
        : undefined;
      if (deposit) out.depositEur = deposit / 100;
      const perMonth = isObj(e.costs) ? positive(e.costs.requiredPerMonth) : undefined;
      if (perMonth && out.priceBasis === 'excl') out.serviceCostsEur = perMonth / 100;
      // How many tenants are already talking to the landlord.
      const conversations = num(e.activeConversationCount);
      if (conversations !== undefined) extra.reactions = conversations;
      const proposals = num(e.proposalCount);
      if (proposals !== undefined) extra.proposals = proposals;
      if (e.tenantFeeRuleName) extra.feeRule = e.tenantFeeRuleName;
      const advertiser = isObj(l?.advertiser) && isObj(l.advertiser.data) ? l.advertiser.data : undefined;
      const name = str(advertiser?.firstName);
      if (name) out.agent = { ...out.agent, name };
      return out;
    },

    async isAvailable(listing, ctx) {
      const digits = /^ut(\d+)$/.exec(listing.externalId)?.[1];
      if (!digits) return true;
      try {
        const { nbHits } = await query(ctx, `unitTypeInternalID:${digits} AND isSearchable:true`, 1, [
          'objectID',
        ]);
        return nbHits > 0;
      } catch (e) {
        if (e instanceof SourceHttpError && (e.status === 404 || e.status === 410)) return false;
        throw e;
      }
    },

    async checkSession(ctx) {
      const session = await ctx.browser();
      try {
        await session.page.goto(`${base}/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        return (await isAuthenticated(session.page)) ? 'ok' : 'none';
      } finally {
        await session.close().catch(() => undefined);
      }
    },

    contact: (listing, message, ctx) => sendMessage(listing, message.body, message.dryRun, ctx),

    parseAlertEmail(mail: InboundMessage): RawListing[] {
      if (mail.channel !== 'email' || !senderIs(mail, ALERT_DOMAINS)) return [];
      const cards = alertCards(mail, (u) =>
        /(^|\.)housinganywhere\.com$/i.test(u.hostname) ? DETAIL_PATH.exec(u.pathname)?.[2] : undefined,
      );
      return cards.map((card) => {
        const m = DETAIL_PATH.exec(card.url.pathname);
        const kind = m?.[1]?.toLowerCase() ?? '';
        const city = m?.[3] ? decodeURIComponent(m[3]).replace(/-/g, ' ') : undefined;
        const text = card.lines.join('\n');
        const price = parsePrice(card.lines.find((l) => /€|\beur\b/i.test(l)) ?? '');
        const featureLine = card.lines.find((l) => /m²|m2/i.test(l)) ?? '';
        const furnishing = detectFurnishing(featureLine);
        const availableLine = card.lines.find((l) => /available|beschikbaar/i.test(l));
        const street = /\bin\s+(.+)$/i.exec(card.title)?.[1];
        const type: PropertyType =
          kind === 'studio'
            ? 'studio'
            : kind === 'apartment'
              ? 'apartment'
              : kind === 'house'
                ? 'house'
                : /room/.test(kind)
                  ? 'room'
                  : 'other';
        return compact<RawListing>({
          sourceId: 'housinganywhere',
          externalId: card.id,
          url: `https://housinganywhere.com${card.url.pathname.replace(/\/+$/, '')}`,
          title: card.title,
          priceEur: price.priceEur,
          priceBasis: price.priceEur === undefined ? undefined : price.basis,
          sizeM2: parseSize(featureLine),
          bedrooms: parseBedrooms(featureLine),
          type,
          furnishing: furnishing === 'unknown' ? undefined : furnishing,
          address: compact({ street, city: city ? (DUTCH_CITY[city] ?? city) : undefined }),
          availableFrom: availableLine ? parseDutchDate(availableLine, new Date(mail.at)) : undefined,
          images: card.image ? [card.image] : undefined,
          contact: 'message',
          language: /\b(available|month|furnished)\b/i.test(text) ? 'en' : undefined,
          extra: { via: 'alert', alertMessageId: mail.id },
        });
      });
    },
  };

  async function isAuthenticated(page: import('playwright-core').Page): Promise<boolean> {
    return page
      .evaluate(() => {
        const state = (
          window as unknown as { __PRELOADED_STATE__?: { authLogic?: { isAuthenticated?: boolean } } }
        ).__PRELOADED_STATE__;
        return state?.authLogic?.isAuthenticated === true;
      })
      .catch(() => false);
  }

  /**
   * Messages a landlord from the listing page in the persistent browser
   * profile. Stops at the login wall (NeedsLoginError), at a subscription
   * offer (`needs: 'paid'`), and at anything asking for choices we cannot
   * make for the user, such as move-in dates (`needs: 'human'`).
   */
  async function sendMessage(
    listing: Listing,
    body: string,
    dryRun: boolean,
    ctx: SourceContext,
  ): Promise<ContactResult> {
    const url = listing.contactUrl ?? listing.url;
    const session = await ctx.browser();
    const { page } = session;
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      if (
        /(^|\.)id\.housinganywhere\.com$/i.test(new URL(page.url()).hostname) ||
        !(await isAuthenticated(page))
      ) {
        throw new NeedsLoginError('HousingAnywhere asks for a login before messaging a landlord', {
          loginUrl,
        });
      }
      const trigger = await firstVisible(page, [
        '[data-test-locator^="ListingActionButtonsContact"]',
        'button:has-text("Contact landlord")',
        'button:has-text("Send a message")',
        'button:has-text("Apply to rent")',
      ]);
      if (!trigger)
        return { ok: false, channel: 'message', needs: 'human', error: `no contact button on ${url}` };
      await page.locator(trigger).first().click({ timeout: 10_000 });

      // Wait for what the button opened: a message box, a subscription offer, or something else.
      const PAYWALL =
        /subscri(be|ption)|unlock messaging|get (a |the )?plan|upgrade to message|pricing\/tenants/i;
      const opened = await (async (): Promise<'message' | 'paid' | 'captcha' | 'other'> => {
        const deadline = Date.now() + 10_000;
        let seen: 'other' | undefined;
        while (Date.now() < deadline) {
          if (
            await page
              .locator('textarea')
              .first()
              .isVisible()
              .catch(() => false)
          )
            return 'message';
          if (
            PAYWALL.test(page.url()) ||
            (await page.locator('a[href*="/pricing/tenants"]').count()) > 0 ||
            PAYWALL.test(await pageText(page))
          )
            return 'paid';
          if (await showsCaptcha(page)) return 'captcha';
          if (
            await page
              .locator('[role="dialog"], dialog[open]')
              .first()
              .isVisible()
              .catch(() => false)
          ) {
            // A dialog without a message box: give it a moment to finish rendering, then stop.
            if (seen) return 'other';
            seen = 'other';
          }
          await page.waitForTimeout(250).catch(() => undefined);
        }
        return 'other';
      })();
      if (opened === 'paid') {
        return {
          ok: false,
          channel: 'message',
          needs: 'paid',
          error: 'a HousingAnywhere subscription is needed to message landlords in the Netherlands',
        };
      }
      if (opened === 'captcha')
        return {
          ok: false,
          channel: 'message',
          needs: 'captcha',
          error: `HousingAnywhere shows a captcha on ${url}`,
        };
      if (opened === 'other') {
        return {
          ok: false,
          channel: 'message',
          needs: 'human',
          error: `HousingAnywhere asked for more than a message on ${url} (for example move-in dates)`,
        };
      }
      try {
        await page.locator('textarea').first().fill(body, { timeout: 10_000 });
      } catch (e) {
        return {
          ok: false,
          channel: 'message',
          error: `could not fill the message on ${url}: ${firstLine(e)}`,
        };
      }
      if (dryRun)
        return { ok: true, channel: 'message', evidence: 'dry run: the message was filled and not sent' };
      try {
        await page
          .getByRole('button', { name: /^(send|send message|send request|verstuur)/i })
          .first()
          .click({ timeout: 10_000 });
      } catch (e) {
        return { ok: false, channel: 'message', error: `could not press send on ${url}: ${firstLine(e)}` };
      }
      const confirmation = await waitForConfirmation(page, {
        success:
          /message (has been |was )?sent|your message is on its way|we('ve| have) sent your message|bericht (is )?verstuurd/i,
        successUrl: /\/(my\/)?(talk|conversations?|inbox)\b/i,
        timeoutMs: confirmTimeoutMs,
      });
      if (!confirmation) {
        return {
          ok: false,
          channel: 'message',
          needs: 'human',
          error: `sent the message on ${url} but no confirmation appeared; check HousingAnywhere before sending again`,
        };
      }
      return { ok: true, channel: 'message', evidence: confirmation.text.slice(0, 200) };
    } finally {
      await session.close().catch(() => undefined);
    }
  }

  return adapter;
}

export const housinganywhere = createHousingAnywhereAdapter();
