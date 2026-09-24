import { load, type Cheerio, type CheerioAPI } from 'cheerio';
import { fromAmsterdam, type Address, type Furnishing, type PropertyType, type RawListing } from '@nlpf/core';
import { normalisePostcode, splitAddress } from '../util/address.js';
import { detectFurnishing, detectType, parseBedrooms, parseDutchDate, parsePrice, parseRooms, parseSize } from '../util/parse.js';

/*
 * Pararius and Huurwoningen.nl (both Treehouse Groep) render the same markup
 * for search result cards and listing pages. Selectors below were read from
 * pages recorded on 2026-09-24 (packages/sources/fixtures/pararius and
 * fixtures/huurwoningen):
 *
 *   card            section.listing-search-item (inside wc-search-list)
 *   link, title     a.listing-search-item__link--title ("Appartement Kruisstraat 46")
 *   subtitle        .listing-search-item__sub-title ("2611 MJ Delft (In de Veste)")
 *   price           .listing-search-item__price-main, or on Huurwoningen the pair
 *                   .listing-search-item__price-bare (kale huur) and
 *                   .price-transparency-badge__total-price-value (totale huur)
 *   features        .illustrated-features__item--surface-area | --number-of-rooms | --interior
 *   label           .listing-label--new | --under-option | --rented-under-reservation
 *   agent           .listing-search-item__info a (Pararius only)
 *   listing uuid    [data-listing-id] (favourite form) or data-listing-search-item-id
 *   no results      .no-search-results__title; the cards below it are "in de buurt"
 */

type AnyNode = Exclude<Parameters<typeof load>[0], string | Buffer | readonly unknown[]>;

const clean = (s: string | undefined) => (s ?? '').replace(/[\s ]+/g, ' ').trim();

function compact<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
  return o;
}

function absolute(href: string | undefined, base: string): string | undefined {
  if (!href) return undefined;
  try {
    const u = new URL(href.trim(), base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** Listing page URL without query or fragment. */
function canonical(url: string): string {
  const u = new URL(url);
  u.search = '';
  u.hash = '';
  return u.toString();
}

/**
 * The 8-hex id in a Pararius-family listing URL: `/appartement-te-huur/delft/fd826b6c/kruisstraat`
 * (Pararius), `/apartment-for-rent/...` (pararius.com) or `/huren/delft/1a2838c6/pierre-van-hauwelaan/`
 * (Huurwoningen). The alert-email parser in @nlpf/mail keys Pararius listings on the same segment.
 */
export function parariusListingId(url: string): string | undefined {
  let path: string;
  try {
    path = new URL(url, 'https://www.pararius.nl').pathname;
  } catch {
    return undefined;
  }
  const m = /^\/(?:[a-z]+-(?:te-huur|for-rent)|huren)\/[a-z0-9-]+\/([0-9a-f]{8})(?:\/|$)/i.exec(path);
  return m?.[1]?.toLowerCase();
}

const TYPE_WORDS: Record<string, PropertyType> = {
  appartement: 'apartment', apartment: 'apartment', huis: 'house', house: 'house', studio: 'studio', kamer: 'room', room: 'room',
};

/** "Appartement Kruisstraat 46" is `{ type: 'apartment', rest: 'Kruisstraat 46' }`. */
function splitTitle(title: string): { type?: PropertyType; rest: string } {
  const m = /^(appartement|apartment|huis|house|studio|kamer|room)\s+(.*)$/i.exec(title);
  if (!m) return { type: detectType(title), rest: title };
  return { type: TYPE_WORDS[(m[1] ?? '').toLowerCase()], rest: m[2] ?? '' };
}

/** "2611 MJ Delft (In de Veste)" into postcode, city and neighbourhood. */
export function parseSubtitle(text: string): Pick<Address, 'postcode' | 'city' | 'neighbourhood'> {
  const t = clean(text);
  const m = /^(?:([1-9]\d{3}\s?[a-z]{2})\s+)?(.*?)(?:\s*\(([^)]*)\))?$/i.exec(t);
  if (!m) return {};
  return compact({
    postcode: m[1] ? normalisePostcode(m[1]) : undefined,
    city: clean(m[2]) || undefined,
    neighbourhood: clean(m[3]) || undefined,
  });
}

const UNAVAILABLE_LABEL = /onder optie|verhuurd|rented|under option|in behandeling|option/i;

/** Whether a card or listing page label means the home is no longer free to react on. */
export function isUnavailableLabel(label: string | undefined, classes = ''): boolean {
  return /listing-label--(under-option|rented)/.test(classes) || UNAVAILABLE_LABEL.test(label ?? '');
}

function firstImage(card: Cheerio<AnyNode>): string | undefined {
  for (const img of card.find('img').toArray()) {
    const src = img.attribs.src;
    if (src && /^https?:/i.test(src)) return src;
  }
  return undefined;
}

/** The photo's origin (`original_uri`) names the agent's software: realworks, ogonline, pararius-office and so on. */
function imageOrigin(html: string): string | undefined {
  const m = /original_uri=([^&"\s]+)/.exec(html);
  if (!m?.[1]) return undefined;
  try {
    return new URL(decodeURIComponent(m[1])).host;
  } catch {
    return undefined;
  }
}

interface PriceFields {
  priceEur?: number;
  priceBasis?: RawListing['priceBasis'];
  serviceCostsEur?: number;
}

function readPrice(scope: Cheerio<AnyNode>): PriceFields {
  const bare = clean(scope.find('.listing-search-item__price-bare .listing-search-item__price-value').first().text());
  const total = clean(scope.find('.price-transparency-badge__total-price-value').first().text());
  if (bare) {
    // Huurwoningen shows "Kale huurprijs" and "Totale huurprijs": the difference is service costs.
    const b = parsePrice(bare).priceEur;
    const t = total ? parsePrice(total).priceEur : undefined;
    if (b !== undefined) {
      return compact({
        priceEur: b,
        priceBasis: 'excl' as const,
        serviceCostsEur: t !== undefined && t > b ? Math.round((t - b) * 100) / 100 : undefined,
      });
    }
  }
  const main = clean(scope.find('.listing-search-item__price-main').first().text()) || clean(scope.find('.listing-search-item__price').first().text());
  const p = parsePrice(main);
  return p.priceEur === undefined ? {} : { priceEur: p.priceEur, priceBasis: p.basis };
}

export interface ParsedCardsPage {
  listings: RawListing[];
  /** Cards skipped because they are under option or rented. */
  skipped: number;
  /** The page said there are no results for the search itself; the cards it shows are nearby homes. */
  noResults: boolean;
  /** "23 woningen gevonden". */
  total?: number;
  /** Absolute URL of the next page of results. */
  nextPage?: string;
}

export interface CardParseOptions {
  sourceId: string;
  /** Page URL, for resolving relative links. */
  baseUrl: string;
}

/**
 * Reads the result cards of a Pararius or Huurwoningen search page. Cards
 * labelled "Onder optie" or "Verhuurd onder voorbehoud" are skipped, and a
 * page that says it found nothing yields no listings (the cards it shows
 * belong to other towns). Contact fields are left to the adapter.
 */
export function parseParariusCards(html: string, opts: CardParseOptions): ParsedCardsPage {
  const $ = load(html);
  const noResults = $('.no-search-results__title, .no-search-results__heading').length > 0;
  const totalText = clean($('.search-list-header__count').first().text());
  const total = /^\d+$/.test(totalText) ? Number(totalText) : undefined;
  const next = absolute($('a.pagination__link--next').first().attr('href'), opts.baseUrl);
  if (noResults) return { listings: [], skipped: 0, noResults: true, ...(total !== undefined ? { total } : {}) };

  const listings: RawListing[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  $('section.listing-search-item').each((_, el) => {
    const card = $(el);
    const labelEl = card.find('.listing-search-item__label .listing-label').first();
    const label = clean(labelEl.text()) || clean(card.find('.listing-search-item__label').first().text());
    if (isUnavailableLabel(label, labelEl.attr('class') ?? '')) {
      skipped += 1;
      return;
    }
    const listing = cardToListing($, card, opts, label);
    if (listing && !seen.has(listing.externalId)) {
      seen.add(listing.externalId);
      listings.push(listing);
    }
  });
  return compact({ listings, skipped, noResults: false, total, nextPage: next });
}

function cardToListing($: CheerioAPI, card: Cheerio<AnyNode>, opts: CardParseOptions, label: string): RawListing | undefined {
  const link = card.find('a.listing-search-item__link--title').first();
  const href = absolute(link.attr('href'), opts.baseUrl);
  if (!href) return undefined;
  const url = canonical(href);
  const uuid = card.attr('data-listing-search-item-id') ?? card.find('[data-listing-id]').first().attr('data-listing-id');
  const externalId = parariusListingId(url) ?? uuid?.slice(0, 8).toLowerCase();
  if (!externalId) return undefined;

  const title = clean(card.find('.listing-search-item__title').first().text()) || clean(link.text());
  const { type: titleType, rest } = splitTitle(title);
  const street = splitAddress(rest);
  const sub = parseSubtitle(card.find('.listing-search-item__sub-title').first().text());
  const address: Address = compact({
    street: street.street,
    houseNumber: street.houseNumber,
    addition: street.addition,
    postcode: sub.postcode,
    city: sub.city,
    neighbourhood: sub.neighbourhood,
  });

  const feature = (name: string) => clean(card.find(`.illustrated-features__item--${name}`).first().text());
  const interior = feature('interior');
  const furnishing: Furnishing | undefined = interior ? detectFurnishing(interior) : undefined;
  const agentLink = card.find('.listing-search-item__info a').first();
  const agentName = clean(agentLink.text()) || clean(card.find('.listing-search-item__info').first().text()) || undefined;
  const agentPage = absolute(agentLink.attr('href'), opts.baseUrl);
  const image = firstImage(card);
  const origin = imageOrigin($.html(card));

  return compact<RawListing>({
    sourceId: opts.sourceId,
    externalId,
    url,
    title,
    ...readPrice(card),
    sizeM2: parseSize(feature('surface-area')),
    rooms: parseRooms(feature('number-of-rooms')),
    type: titleType ?? detectType(url),
    furnishing: furnishing && furnishing !== 'unknown' ? furnishing : undefined,
    address,
    images: image ? [image] : undefined,
    agent: agentName ? { name: agentName } : undefined,
    contact: 'none',
    language: 'nl',
    extra: compact({
      uuid,
      agentId: card.attr('data-listing-search-item-agent-id'),
      agentPage,
      label: label || undefined,
      isNew: /nieuw|new/i.test(label) || undefined,
      imageOrigin: origin,
    }),
  });
}

/* ---------- listing pages ---------- */

export interface ParsedDetailPage {
  title?: string;
  description?: string;
  priceEur?: number;
  priceBasis?: RawListing['priceBasis'];
  serviceCostsEur?: number;
  depositEur?: number;
  sizeM2?: number;
  rooms?: number;
  bedrooms?: number;
  type?: PropertyType;
  furnishing?: Furnishing;
  energyLabel?: string;
  availableFrom?: string;
  publishedAt?: string;
  address: Pick<Address, 'postcode' | 'city' | 'neighbourhood'>;
  images: string[];
  agent: { name?: string; phone?: string; page?: string };
  /** "Te huur", "Onder optie", "Verhuurd". */
  status?: string;
  /** The page's own label ("Nieuw", "Onder optie"). */
  label?: string;
  unavailable: boolean;
  /** The contact button opens "Contact met de aanbieder": the home is advertised on another website. */
  clickout: boolean;
  /** A direct link to the advertiser's website on the page, when there is one. */
  externalUrl?: string;
  /** Pararius contact form URL (`/contact/<uuid>`), for listings handled on Pararius itself. */
  contactUrl?: string;
  uuid?: string;
}

/** Terms in the "Kenmerken" lists (dt.listing-features__term, dd.listing-features__description). */
function featureMap($: CheerioAPI): Map<string, string> {
  const out = new Map<string, string>();
  $('dt.listing-features__term').each((_, dt) => {
    const term = clean($(dt).text()).toLowerCase();
    const dd = $(dt).next('dd');
    const value = clean(dd.find('.listing-features__main-description').first().text()) || clean(dd.text());
    if (term && value && !out.has(term)) out.set(term, value);
  });
  return out;
}

const HOSTS = /(^|\.)(pararius\.(nl|com)|huurwoningen\.nl)$/i;

/** Midnight in Amsterdam on a YYYY-MM-DD date, as an ISO timestamp. */
function startOfDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return fromAmsterdam(y ?? 0, m ?? 1, d ?? 1, 0, 0).toISOString();
}

/**
 * Reads a Pararius or Huurwoningen listing page: the "Kenmerken" terms
 * (Huurprijs, Borg, Beschikbaar, Aangeboden sinds, Energielabel, ...), the
 * description, photos, the agent block, and whether contact happens on the
 * platform or on the advertiser's own site.
 */
export function parseParariusDetail(html: string, pageUrl: string, now: Date = new Date()): ParsedDetailPage {
  const $ = load(html);
  const f = featureMap($);
  const get = (...terms: string[]) => {
    for (const t of terms) {
      const v = f.get(t);
      if (v) return v;
    }
    return undefined;
  };

  const rawTitle = clean($('.listing-detail-summary__title').first().text()).replace(/^te huur:\s*/i, '');
  const title = rawTitle.replace(/\s+in\s+[^,]+$/i, '') || undefined;
  const address = parseSubtitle($('.listing-detail-summary__location').first().text());

  const priceText = get('huurprijs', 'kale huurprijs', 'rental price') ?? clean($('.listing-detail-summary__price-main').first().text());
  const price = priceText ? parsePrice(priceText) : undefined;
  const serviceText = get('servicekosten', 'service costs');
  const serviceCostsEur = serviceText ? parsePrice(serviceText).priceEur : undefined;
  const depositText = get('borg', 'waarborgsom', 'deposit');
  const depositEur = depositText ? parsePrice(depositText).priceEur : undefined;
  const available = get('beschikbaar', 'beschikbaar vanaf', 'available', 'aanvaarding');
  const since = get('aangeboden sinds', 'offered since');
  const sinceDate = since ? parseDutchDate(since, now) : undefined;
  const energy = /\b([A-G]\+*)(?![a-z])/i.exec(get('energielabel', 'energy rating') ?? '')?.[1]?.toUpperCase();
  const furnishing = detectFurnishing(get('interieur', 'interior') ?? '');
  const status = get('status');
  const labelEl = $('.listing-detail-summary__label .listing-label').first();
  const label = clean(labelEl.text()) || undefined;

  const description = (() => {
    const el = $('.listing-detail-description__content').first().clone();
    if (!el.length) return undefined;
    el.find('br').replaceWith('\n');
    el.find('p, li, div').each((_, n) => {
      $(n).append('\n');
    });
    const text = el
      .text()
      .split('\n')
      .map((l) => l.replace(/[ \t ]+/g, ' ').trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return text || undefined;
  })();

  const images = [
    ...new Set(
      $('.carrousel--listing-detail img, wc-carrousel img, .page__carrousel img')
        .toArray()
        .map((img) => img.attribs.src)
        .filter((s): s is string => Boolean(s && /^https?:/i.test(s))),
    ),
  ];

  const agentBlock = $('.agent-summary').first();
  const agentName = clean(agentBlock.find('.agent-summary__title').first().text()) || undefined;
  const phone = agentBlock.find('a[href^="tel:"]').first().attr('href')?.slice(4).replace(/\s+/g, '') || undefined;
  const agentPage = absolute(agentBlock.find('.agent-summary__title-link, a.agent-summary__link--agent-page').first().attr('href'), pageUrl);

  // A clickout listing has <wc-listing-reaction-button class="listing-reaction-button--click-out"> with a
  // button that opens "Contact met de aanbieder" (read from ListingReactionButton.wc.js on 2026-09-24).
  // Huurwoningen's .listing-contact-info--external is its own account-and-premium reaction flow, not a clickout.
  const clickout = $('.listing-reaction-button--click-out').length > 0;
  const externalUrl = clickout
    ? $('.agent-summary a[href^="http"], .listing-reaction-button--click-out a[href^="http"], a[data-tracking-id="button_agent_website"]')
        .toArray()
        .map((a) => a.attribs.href)
        .find((h): h is string => {
          try {
            return Boolean(h) && !HOSTS.test(new URL(h as string).hostname);
          } catch {
            return false;
          }
        })
    : undefined;
  const contactHref = $('.listing-reaction-button--contact-agent a[href*="/contact/"]').first().attr('href');
  const contactUrl = absolute(contactHref, pageUrl);
  const uuid =
    /\/contact\/([0-9a-f-]{36})/i.exec(contactHref ?? '')?.[1] ??
    $('[data-listing-id]').first().attr('data-listing-id') ??
    undefined;

  return compact<ParsedDetailPage>({
    title,
    description,
    priceEur: price?.priceEur,
    priceBasis: price?.priceEur !== undefined ? price.basis : undefined,
    serviceCostsEur,
    depositEur,
    sizeM2: parseSize(get('woonoppervlakte', 'surface area') ?? ''),
    rooms: parseRooms(get('aantal kamers', 'number of rooms') ?? ''),
    bedrooms: parseBedrooms(get('aantal slaapkamers', 'number of bedrooms') ?? ''),
    type: detectType(get('type woning', 'dwelling type') ?? '') ?? detectType(title ?? ''),
    furnishing: furnishing === 'unknown' ? undefined : furnishing,
    energyLabel: energy,
    availableFrom: available ? parseDutchDate(available, now) : undefined,
    publishedAt: sinceDate ? startOfDay(sinceDate) : undefined,
    address,
    images,
    agent: compact({ name: agentName, phone, page: agentPage }),
    status,
    label,
    unavailable: isUnavailableLabel(label, labelEl.attr('class') ?? '') || /verhuurd|onder optie|rented/i.test(status ?? ''),
    clickout,
    externalUrl,
    contactUrl: clickout ? undefined : contactUrl,
    uuid,
  });
}
