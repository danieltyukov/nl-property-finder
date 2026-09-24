/**
 * Kamernet (kamernet.nl): rooms, studios and apartments, mostly from private
 * landlords. Listings come from the site's own JSON search API; reacting is
 * a platform message that needs a login and, except for listings marked
 * "reageer gratis" (`isReactForFree`), a Premium plan.
 *
 * Verified live on 2026-09-24: `POST /services/api/listing/findlistings`
 * (body and enums below, including the price, size and radius ladders read
 * from the web bundle), the detail page's `__NEXT_DATA__.listingDetails`,
 * and that `/en/start-conversation/{id}` answers 401 "Je bent niet ingelogd"
 * without a session. The logged-in message form (`#Message`) and its
 * confirmation are taken from the kamernet-mcp project and were not seen
 * live, because that needs an account.
 */
import { load } from 'cheerio';
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
import { detectFurnishing, detectType, parseDutchDate, parsePrice, parseSize } from '../util/parse.js';
import {
  alertCards,
  clean,
  compact,
  filterKey,
  firstLine,
  firstVisible,
  isObj,
  isoInstant,
  municipalityName,
  num,
  pageText,
  positive,
  searchMunicipalities,
  senderIs,
  showsCaptcha,
  slugify,
  str,
  waitForConfirmation,
  ymd,
} from './json-shared.js';

/** `ListingType` enum from the Kamernet web bundle. */
const TYPES: Record<number, { slug: string; label: string; type: PropertyType }> = {
  1: { slug: 'kamer', label: 'Kamer', type: 'room' },
  2: { slug: 'appartement', label: 'Appartement', type: 'apartment' },
  4: { slug: 'studio', label: 'Studio', type: 'studio' },
  8: { slug: 'anti-kraak', label: 'Anti-kraak', type: 'other' },
  16: { slug: 'studentenwoning', label: 'Studentenwoning', type: 'room' },
};

/** `Furnishing` enum: Uncarpeted (kaal), Unfurnished (gestoffeerd), Furnished. */
const FURNISHING: Record<number, Furnishing> = { 1: 'unfurnished', 2: 'upholstered', 4: 'furnished' };

/** `MaxRentalPrice` enum: id per euro step (100 to 1500 in hundreds, then 250s up to 6000). */
const PRICE_STEPS: [number, number][] = [
  ...Array.from({ length: 15 }, (_, i): [number, number] => [(i + 1) * 100, i + 1]),
  ...Array.from({ length: 18 }, (_, i): [number, number] => [1750 + i * 250, 16 + i]),
];

/** `SurfaceMinimum` enum: id per m2 step. */
const SIZE_STEPS: [number, number][] = [
  [6, 2],
  [8, 3],
  [10, 4],
  [12, 5],
  [14, 6],
  [16, 7],
  [18, 8],
  [20, 9],
  [22, 10],
  [24, 11],
  [26, 12],
  [28, 13],
  [30, 14],
  [32, 15],
  [34, 16],
  [36, 17],
  [38, 18],
  [40, 19],
  [45, 20],
  [50, 21],
  [60, 22],
  [70, 23],
  [80, 24],
  [90, 25],
  [100, 26],
];

/** The smallest ladder step at or above the maximum rent, so nothing under the cap is dropped. 0 means no limit. */
export function kamernetPriceId(maxEur: number | undefined): number {
  if (maxEur === undefined) return 0;
  return PRICE_STEPS.find(([eur]) => eur >= maxEur)?.[1] ?? 0;
}

/** The largest ladder step at or below the minimum size. 0 means no minimum. */
export function kamernetSizeId(minM2: number | undefined): number {
  if (minM2 === undefined) return 0;
  let id = 0;
  for (const [m2, step] of SIZE_STEPS) if (m2 <= minM2) id = step;
  return id;
}

function listingTypeIds(types: PropertyType[]): number[] {
  const all: PropertyType[] = ['room', 'studio', 'apartment', 'house'];
  if (types.includes('other') || all.every((t) => types.includes(t))) return [];
  const ids = new Set<number>();
  if (types.includes('room')) [1, 16].forEach((i) => ids.add(i));
  if (types.includes('studio')) ids.add(4);
  if (types.includes('apartment') || types.includes('house')) ids.add(2);
  return [...ids].sort((a, b) => a - b);
}

/** Radius ids: Km0 is 1 (only the city itself). */
const RADIUS_CITY = 1;

const IMAGE_BASE = 'https://resources.kamernet.nl/image';

interface KnListing {
  listingId?: number;
  street?: string;
  streetSlug?: string;
  city?: string;
  citySlug?: string;
  totalRentalPrice?: number;
  utilitiesIncluded?: boolean;
  surfaceArea?: number;
  listingType?: number;
  furnishingId?: number;
  availabilityStartDate?: string;
  availabilityEndDate?: string | null;
  isNewAdvert?: boolean;
  isReactForFree?: boolean;
  isTopAdvert?: boolean;
  isStudentHouseAdvert?: boolean;
  fullPreviewImageUrl?: string;
  thumbnailUrl?: string;
}

export interface KamernetOptions {
  /** Site root, for tests against a local server. Default https://kamernet.nl. */
  baseUrl?: string;
  /** How long to wait for the confirmation after sending a message. Default 20 s. */
  confirmTimeoutMs?: number;
  /** Contact runs in a headed browser (reCAPTCHA Enterprise scores headless ones low). Default true. */
  headed?: boolean;
}

const ALERT_DOMAINS = ['kamernet.nl'];

const DETAIL_PATH =
  /^\/(?:en\/)?(?:huren|for-rent)\/([a-z-]+)-([a-z0-9-]+)\/([a-z0-9-]+)\/[a-z-]+-(\d{5,})\/?$/i;

export function createKamernetAdapter(options: KamernetOptions = {}): SourceAdapter {
  const base = (options.baseUrl ?? 'https://kamernet.nl').replace(/\/+$/, '');
  const confirmTimeoutMs = options.confirmTimeoutMs ?? 20_000;
  const headed = options.headed ?? true;
  const loginUrl = `${base}/oauth/signin`;

  const detailUrl = (l: KnListing): string | undefined => {
    const t = TYPES[l.listingType ?? 1] ?? TYPES[1];
    if (!l.listingId || !l.citySlug) return undefined;
    return `${base}/huren/${t?.slug}-${l.citySlug}/${l.streetSlug || slugify(l.street ?? '') || 'straat'}/${t?.slug}-${l.listingId}`;
  };

  const conversationUrl = (id: string) => `${base}/en/start-conversation/${encodeURIComponent(id)}`;

  function toRaw(l: KnListing): RawListing | undefined {
    const url = detailUrl(l);
    if (!url || !l.listingId) return undefined;
    const t = TYPES[l.listingType ?? 0];
    const image = str(l.fullPreviewImageUrl) ?? str(l.thumbnailUrl);
    const free = l.isReactForFree === true;
    return compact<RawListing>({
      sourceId: 'kamernet',
      externalId: String(l.listingId),
      url,
      title: clean(`${t?.label ?? 'Woonruimte'} ${l.street ?? ''}`),
      priceEur: positive(l.totalRentalPrice),
      priceBasis:
        positive(l.totalRentalPrice) === undefined ? undefined : l.utilitiesIncluded ? 'incl' : 'excl',
      sizeM2: positive(l.surfaceArea),
      type: t?.type,
      furnishing: FURNISHING[l.furnishingId ?? 0],
      address: compact({ street: str(l.street), city: str(l.city) }),
      availableFrom: ymd(l.availabilityStartDate),
      images: image ? [image] : undefined,
      contact: 'message',
      contactUrl: conversationUrl(String(l.listingId)),
      // Premium is needed to message a landlord, except on listings Kamernet
      // marks as free to react to. The router reads `isReactForFree`.
      extra: compact({
        reactForFree: free ? true : undefined,
        isReactForFree: free ? true : undefined,
        topAdvert: l.isTopAdvert ? true : undefined,
        studentHouse: l.isStudentHouseAdvert ? true : undefined,
        availableUntil: ymd(l.availabilityEndDate ?? undefined),
      }),
    });
  }

  async function fetchDetails(url: string, ctx: SourceContext): Promise<Record<string, unknown> | undefined> {
    const res = await ctx.fetch(url);
    const $ = load(res.text);
    const raw = $('script#__NEXT_DATA__').first().text();
    if (!raw) return undefined;
    const data = JSON.parse(raw) as {
      props?: { pageProps?: { targetPageProps?: { listingDetails?: unknown } } };
    };
    const details = data.props?.pageProps?.targetPageProps?.listingDetails;
    return isObj(details) ? details : undefined;
  }

  const adapter: SourceAdapter = {
    id: 'kamernet',
    name: 'Kamernet',
    homepage: 'https://kamernet.nl',
    regions: 'nl',
    defaultIntervalSec: 60,
    capabilities: {
      search: 'json',
      detail: true,
      contact: 'message',
      login: 'required',
      paid: { feature: 'contact', plan: 'kamernet-premium' },
      terms: 'forbids',
      browser: 'headed',
    },
    loginUrl,
    // Kamernet sends saved-search alerts from its own domain; entries are
    // full addresses or bare domains.
    alertSenders: ['noreply@kamernet.nl', 'kamernet.nl'],

    buildSearches(searches: NamedSearch[]): SearchRequest[] {
      const out = new Map<string, SearchRequest>();
      for (const search of searches) {
        const priceId = kamernetPriceId(search.priceMaxEur);
        const sizeId = kamernetSizeId(search.sizeMinM2);
        const typeIds = listingTypeIds(search.types);
        for (const m of searchMunicipalities(search)) {
          const citySlug = slugify(m);
          const key = `${citySlug}?${filterKey({ price: priceId || undefined, size: sizeId || undefined, types: typeIds.join(',') })}`;
          if (out.has(key)) continue;
          out.set(key, {
            key,
            label: `Kamernet ${municipalityName(m)}`,
            url: `${base}/services/api/listing/findlistings`,
            params: {
              cityName: municipalityName(m),
              citySlug,
              radiusId: RADIUS_CITY,
              maxRentalPriceId: priceId,
              surfaceMinimumId: sizeId,
              listingTypeIds: typeIds.join(','),
            },
          });
        }
      }
      return [...out.values()];
    },

    async search(req, ctx) {
      const p = req.params ?? {};
      const cityName = String(p.cityName ?? '');
      const citySlug = String(p.citySlug ?? slugify(cityName));
      const body = {
        location: { name: cityName, cityName, citySlug },
        citySlug,
        radiusId: Number(p.radiusId ?? RADIUS_CITY),
        listingTypeIds: String(p.listingTypeIds ?? '')
          .split(',')
          .filter(Boolean)
          .map(Number),
        maxRentalPriceId: Number(p.maxRentalPriceId ?? 0),
        surfaceMinimumId: Number(p.surfaceMinimumId ?? 0),
        listingSortOptionId: 1, // NewestFirst
        pageNo: 1,
        rowsPerPage: 20,
        searchview: 1,
      };
      const res = await ctx.fetch(req.url ?? `${base}/services/api/listing/findlistings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
      });
      const data = res.json<{ listings?: KnListing[]; topAdListings?: KnListing[] | null }>();
      const out: RawListing[] = [];
      const seen = new Set<string>();
      for (const l of [...(data.topAdListings ?? []), ...(data.listings ?? [])]) {
        const raw = toRaw(l);
        if (raw && !seen.has(raw.externalId)) {
          seen.add(raw.externalId);
          out.push(raw);
        }
      }
      ctx.log.debug('kamernet listings read', { count: out.length, city: citySlug });
      return out;
    },

    async detail(listing, ctx) {
      const d = await fetchDetails(listing.url, ctx);
      if (!d) return listing;
      const out: RawListing = { ...listing, address: { ...listing.address }, extra: { ...listing.extra } };
      const description = str(d.dutchDescription) ?? str(d.englishDescription);
      if (description) out.description = description.replace(/\r\n/g, '\n');
      const postcode = normalisePostcode(String(d.postalCode ?? ''));
      if (postcode) out.address.postcode = postcode;
      const number = str(d.houseNumber);
      if (number) out.address.houseNumber = number;
      const addition = str(d.houseNumberAddition);
      if (addition) out.address.addition = addition;
      const lat = num(d.postalCodeLat);
      const lon = num(d.postalCodeLong);
      if (lat !== undefined && lon !== undefined) Object.assign(out.address, { lat, lon });
      const published = isoInstant(d.publishDate) ?? isoInstant(d.createDate);
      if (published) out.publishedAt = published;
      const deposit = positive(d.deposit);
      if (deposit) out.depositEur = deposit;
      const rooms = positive(d.numOfRooms);
      if (rooms) out.rooms = rooms;
      const bedrooms = positive(d.numOfBedrooms);
      if (bedrooms) out.bedrooms = bedrooms;
      // `imageList` holds image keys; the site serves them from resources.kamernet.nl.
      const images = Array.isArray(d.imageList)
        ? d.imageList
            .map((i) => (typeof i === 'string' ? i : isObj(i) ? (str(i.url) ?? str(i.imageUrl)) : undefined))
            .filter((s): s is string => Boolean(s))
            .map((s) => (/^https?:/i.test(s) ? s : `${IMAGE_BASE}/${s}`))
        : [];
      if (images.length) out.images = images;
      const landlord = str(d.landlordDisplayName);
      if (landlord) out.agent = { ...out.agent, name: landlord };
      if (d.isReactForFree === true)
        Object.assign(out.extra ?? {}, { reactForFree: true, isReactForFree: true });
      Object.assign(
        out.extra ?? {},
        compact({
          registrationAllowed:
            typeof d.isRegistrationAllowed === 'boolean' ? d.isRegistrationAllowed : undefined,
          petsAllowed: typeof d.candidatePetsAllowed === 'boolean' ? d.candidatePetsAllowed : undefined,
          smokingAllowed:
            typeof d.candidateSmokingAllowed === 'boolean' ? d.candidateSmokingAllowed : undefined,
          suitableForPersons: positive(d.suitableForNumberOfPersons),
          landlordResponseRate: str(d.responseRateText),
          viewingDate: ymd(d.viewingDate),
          rentExclUtilitiesEur: positive(d.rentalPrice),
        }),
      );
      if (!out.furnishing) out.furnishing = FURNISHING[num(d.furnishingId) ?? 0];
      return out;
    },

    async isAvailable(listing, ctx) {
      let d: Record<string, unknown> | undefined;
      try {
        d = await fetchDetails(listing.url, ctx);
      } catch (e) {
        if (e instanceof SourceHttpError && (e.status === 404 || e.status === 410)) return false;
        throw e;
      }
      // A withdrawn listing renders the search page instead of the listing.
      if (!d || String(d.listingId ?? '') !== listing.externalId) return false;
      return d.isActive !== false && d.isBlocked !== true;
    },

    async checkSession(ctx) {
      const session = await ctx.browser({ headed });
      try {
        await session.page.goto(`${base}/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        const profile = await session.page
          .evaluate(() => {
            const el = document.querySelector('script#__NEXT_DATA__');
            const data = el?.textContent
              ? (JSON.parse(el.textContent) as {
                  props?: { pageProps?: { authState?: { userProfile?: unknown } } };
                })
              : undefined;
            return Boolean(data?.props?.pageProps?.authState?.userProfile);
          })
          .catch(() => false);
        return profile ? 'ok' : 'none';
      } finally {
        await session.close().catch(() => undefined);
      }
    },

    contact: (listing, message, ctx) => sendMessage(listing, message.body, message.dryRun, ctx),

    parseAlertEmail(mail: InboundMessage): RawListing[] {
      if (mail.channel !== 'email' || !senderIs(mail, ALERT_DOMAINS)) return [];
      const cards = alertCards(mail, (u) => {
        if (!/(^|\.)kamernet\.nl$/i.test(u.hostname)) return undefined;
        return DETAIL_PATH.exec(u.pathname)?.[4];
      });
      return cards.map((card) => {
        const m = DETAIL_PATH.exec(card.url.pathname);
        const kind = m?.[1]?.toLowerCase() ?? '';
        const text = card.lines.join('\n');
        const priceLine = card.lines.find((l) => /€|\beur\b/i.test(l)) ?? '';
        const price = parsePrice(priceLine);
        const availableLine = card.lines.find((l) => /beschikbaar|available/i.test(l));
        const typeEntry = Object.values(TYPES).find((t) => t.slug === kind);
        const cityLine = card.lines.find(
          (l) =>
            l !== card.title &&
            /^[\p{L}' -]+$/u.test(l) &&
            !/beschikbaar|gemeubileerd|gestoffeerd|kaal/i.test(l),
        );
        const furnishing = detectFurnishing(text);
        return compact<RawListing>({
          sourceId: 'kamernet',
          externalId: m?.[4] ?? card.id,
          url: `https://kamernet.nl${card.url.pathname.replace(/\/+$/, '')}`,
          title: card.title || clean(`${typeEntry?.label ?? ''} ${m?.[3] ?? ''}`),
          priceEur: price.priceEur,
          priceBasis: price.priceEur === undefined ? undefined : price.basis,
          sizeM2: parseSize(card.lines.find((l) => /m²|m2/i.test(l)) ?? ''),
          type: typeEntry?.type ?? detectType(card.title),
          furnishing: furnishing === 'unknown' ? undefined : furnishing,
          address: compact({ city: cityLine }),
          availableFrom: availableLine ? parseDutchDate(availableLine, new Date(mail.at)) : undefined,
          images: card.image ? [card.image] : undefined,
          contact: 'message',
          contactUrl: m?.[4] ? conversationUrl(m[4]) : undefined,
          extra: { via: 'alert', alertMessageId: mail.id },
        });
      });
    },
  };

  /**
   * Sends a message through Kamernet's conversation page in the persistent
   * browser profile (where `nlpf connect kamernet` logged in). Anonymous
   * sessions get the "niet ingelogd" page (verified), which becomes a
   * NeedsLoginError. Without Premium Kamernet shows an upgrade offer instead
   * of the form: that is a paid wall, never something to get around.
   */
  async function sendMessage(
    listing: Listing,
    body: string,
    dryRun: boolean,
    ctx: SourceContext,
  ): Promise<ContactResult> {
    const url = conversationUrl(listing.externalId);
    const session = await ctx.browser({ headed });
    const { page } = session;
    try {
      const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      const path = new URL(page.url()).pathname;
      const text = await pageText(page);
      if (
        res?.status() === 401 ||
        /\/(oauth\/signin|login|inloggen)\b/i.test(path) ||
        /niet ingelogd|not logged in/i.test(text)
      ) {
        throw new NeedsLoginError('Kamernet asks for a login before messaging a landlord', { loginUrl });
      }
      if (await showsCaptcha(page)) {
        return {
          ok: false,
          channel: 'message',
          needs: 'captcha',
          error: `Kamernet shows a captcha on ${url}`,
        };
      }
      const field = await firstVisible(page, [
        '#Message',
        'textarea[name="Message"]',
        'textarea[name="message"]',
      ]);
      if (!field) {
        if (/premium/i.test(text) || (await page.locator('a[href*="premium"]').count()) > 0) {
          return {
            ok: false,
            channel: 'message',
            needs: 'paid',
            error: 'Kamernet Premium is needed to message this landlord',
          };
        }
        return { ok: false, channel: 'message', needs: 'human', error: `no message form on ${url}` };
      }
      // Landlords can ask extra questions ("barrier" fields such as date of
      // birth or move-in date). We only send the message; a form with
      // unanswered required questions goes to a person.
      const unanswered = await page
        .locator('form input[required], form select[required], form textarea[required]')
        .evaluateAll(
          (els, skip) =>
            els
              .filter((el) => {
                const e = el as HTMLInputElement;
                return (
                  e.id !== skip &&
                  e.name !== 'Message' &&
                  e.type !== 'hidden' &&
                  !e.value &&
                  e.offsetParent !== null
                );
              })
              .map((el) => (el as HTMLInputElement).name || el.id),
          field.startsWith('#') ? field.slice(1) : '',
        )
        .catch(() => [] as string[]);
      if (unanswered.length) {
        return {
          ok: false,
          channel: 'message',
          needs: 'human',
          error: `the landlord asks extra questions (${unanswered.join(', ')}); answer them on Kamernet`,
        };
      }
      try {
        await page.locator(field).first().fill(body, { timeout: 10_000 });
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
        const submit = page
          .locator('form button[type="submit"], form input[type="submit"]')
          .or(page.getByRole('button', { name: /send message|verstuur|verzend|stuur bericht/i }))
          .first();
        await submit.click({ timeout: 10_000 });
      } catch (e) {
        return { ok: false, channel: 'message', error: `could not press send on ${url}: ${firstLine(e)}` };
      }
      const confirmation = await waitForConfirmation(page, {
        success:
          /bericht (is )?(verstuurd|verzonden)|reactie (is )?(verstuurd|verzonden)|message (has been )?sent|your reaction has been sent/i,
        successUrl: /\/(conversation|conversations|messages|berichten)\//i,
        timeoutMs: confirmTimeoutMs,
      });
      if (!confirmation) {
        return {
          ok: false,
          channel: 'message',
          needs: 'human',
          error: `sent the message on ${url} but no confirmation appeared; check Kamernet before sending again`,
        };
      }
      const thread = /\/(?:conversation|conversations|messages|berichten)\/([\w-]+)/i.exec(page.url())?.[1];
      return compact({
        ok: true,
        channel: 'message' as const,
        externalId: thread,
        evidence: confirmation.text.slice(0, 200),
      });
    } finally {
      await session.close().catch(() => undefined);
    }
  }

  return adapter;
}

export const kamernet = createKamernetAdapter();
