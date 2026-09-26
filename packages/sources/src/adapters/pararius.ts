import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import type { Page, Request, Response } from 'playwright-core';
import type {
  ContactResult,
  InboundMessage,
  Listing,
  NamedSearch,
  OutboundMessage,
  PropertyType,
  RawListing,
  SearchRequest,
  SourceAdapter,
  SourceConfig,
  SourceContext,
} from '@nlpf/core';
import { trimTrailingSlashes } from '@nlpf/core';
import { NeedsLoginError, SourceBlockedError, SourceHttpError } from '../runtime/errors.js';
import { detectChallenge, sleep } from '../runtime/fetch.js';
import {
  isUnavailableLabel,
  parariusListingId,
  parseParariusCards,
  parseParariusDetail,
  parseSubtitle,
  type ParsedDetailPage,
} from '../parsers/pararius-cards.js';
import { splitAddress } from '../util/address.js';
import { detectFurnishing, detectType, parsePrice, parseRooms, parseSize } from '../util/parse.js';

/* ================================================================
 * Shared by the browser-driven adapters (Pararius, Huurwoningen,
 * Kamer.nl, Xior, Holland2Stay): reading a page in the source's
 * persistent browser, and turning the user's searches into areas.
 * ================================================================ */

export interface LoadOptions {
  /** CSS selector (checked with cheerio on the page HTML) that is present once the page we asked for has rendered. */
  ready: string;
  /** How long a bot check may take to clear. Cloudflare's managed challenge usually takes 5 to 10 s in a headed window. Default 30 s. */
  waitMs?: number;
  /** Time between looks at the page. Default 500 ms. */
  pollMs?: number;
  /** Navigation timeout. Default 45 s. */
  navTimeoutMs?: number;
  signal?: AbortSignal;
}

export interface LoadedPage {
  html: string;
  /** URL after redirects. */
  url: string;
  /** Status of the last main-frame document response, when one was seen. */
  status?: number;
}

/**
 * Opens a page in this source's browser profile and always closes it.
 * `headed` sessions run in a real window on the pool's private display,
 * which Cloudflare's managed challenge lets through (docs/research/platforms.md, finding 1).
 */
export async function withBrowserPage<T>(ctx: SourceContext, fn: (page: Page) => Promise<T>, headed = true): Promise<T> {
  const session = await ctx.browser({ headed });
  try {
    return await fn(session.page);
  } finally {
    await session.close().catch(() => undefined);
  }
}

/**
 * Throws `SourceHttpError` for a navigation that cannot recover: a timeout,
 * or a network error such as a DNS failure or a refused connection. An
 * aborted navigation (a challenge page replacing itself) is left to the caller.
 */
export function failedNavigation(e: unknown, url: string): void {
  if (!(e instanceof Error)) return;
  if (e.name === 'TimeoutError') throw new SourceHttpError(`${url} did not load in time`, { status: 0, url, cause: e });
  const net = /net::(ERR_[A-Z_]+)/.exec(e.message)?.[1];
  if (net && net !== 'ERR_ABORTED') throw new SourceHttpError(`${url} failed: ${net}`, { status: 0, url, cause: e });
}

/**
 * Navigates and waits until the `ready` selector shows up. A Cloudflare
 * check that clears by itself (it reloads the page) is waited out; one that
 * is still there after `waitMs` throws `SourceBlockedError`, so the
 * scheduler backs off. A 404 or 410 throws `SourceHttpError`.
 */
export async function loadPage(page: Page, url: string, opts: LoadOptions): Promise<LoadedPage> {
  const waitMs = opts.waitMs ?? 30_000;
  const pollMs = opts.pollMs ?? 500;
  let status: number | undefined;
  const onResponse = (res: Response) => {
    try {
      if (res.request().isNavigationRequest() && res.frame() === page.mainFrame()) status = res.status();
    } catch {
      // a response of a page that is already gone
    }
  };
  page.on('response', onResponse);
  try {
    try {
      const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: opts.navTimeoutMs ?? 45_000 });
      if (res && status === undefined) status = res.status();
    } catch (e) {
      opts.signal?.throwIfAborted();
      failedNavigation(e, url);
      // A challenge page that reloads itself interrupts the first navigation (net::ERR_ABORTED); look at what is there now.
    }
    const deadline = Date.now() + waitMs;
    let html = '';
    for (;;) {
      html = await page.content().catch(() => html);
      if (load(html)(opts.ready).length > 0) return { html, url: page.url(), ...(status !== undefined ? { status } : {}) };
      const marker = detectChallenge(html);
      if (!marker && (status === 404 || status === 410)) {
        throw new SourceHttpError(`${url} returned HTTP ${status}`, { status, url: page.url() });
      }
      if (Date.now() >= deadline) {
        const host = new URL(url).host;
        if (marker) {
          throw new SourceBlockedError(`${host} kept showing a bot check (${marker}) for ${Math.round(waitMs / 1000)} s`, {
            status: status ?? 403,
            marker,
            url,
          });
        }
        if (status === 403 || status === 429) throw new SourceBlockedError(`${host} refused the page with HTTP ${status}`, { status, url });
        throw new SourceHttpError(`${url} did not show the expected page within ${Math.round(waitMs / 1000)} s`, { status: status ?? 0, url: page.url() });
      }
      await sleep(pollMs, opts.signal);
    }
  } finally {
    page.off('response', onResponse);
  }
}

const SLUG_ALIASES: Record<string, string> = {
  "'s-gravenhage": 'den-haag',
  's-gravenhage': 'den-haag',
  'the hague': 'den-haag',
  "'s-hertogenbosch": 's-hertogenbosch',
};

/** "Den Haag" is "den-haag", "Alphen aan den Rijn" is "alphen-aan-den-rijn". */
export function citySlug(name: string): string {
  const n = name.trim().toLowerCase();
  const alias = SLUG_ALIASES[n];
  if (alias) return alias;
  return n
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const ALL_TYPES: PropertyType[] = ['room', 'studio', 'apartment', 'house'];

/** One municipality (or the whole country) with the widest price range and types the searches ask for there. */
export interface Area {
  slug: string;
  name: string;
  /** Undefined when some search has no minimum. */
  minPrice?: number;
  /** Undefined when some search has no maximum. */
  maxPrice?: number;
  /** Undefined when the searches together want every type. */
  types?: PropertyType[];
}

/**
 * Collapses the user's searches into areas, so each municipality is
 * requested once with the widest filters any search needs. A search with a
 * region drawn only by postcodes or a polygon covers the whole country
 * (`nationwide`), because the platforms filter by town.
 */
export function areasFromSearches(searches: NamedSearch[], nationwide = 'nederland'): Area[] {
  const acc = new Map<string, { name: string; mins: (number | undefined)[]; maxes: (number | undefined)[]; types: Set<PropertyType> }>();
  for (const s of searches) {
    const named = s.regions.length > 0 && s.regions.every((r) => r.municipalities.length > 0);
    const places = named ? s.regions.flatMap((r) => r.municipalities) : [nationwide];
    for (const place of places) {
      const slug = citySlug(place);
      if (!slug) continue;
      const a = acc.get(slug) ?? { name: place.trim(), mins: [], maxes: [], types: new Set<PropertyType>() };
      a.mins.push(s.priceMinEur);
      a.maxes.push(s.priceMaxEur);
      for (const t of s.types.length ? s.types : ALL_TYPES) a.types.add(t);
      acc.set(slug, a);
    }
  }
  return [...acc.entries()].map(([slug, a]) => {
    const minPrice = a.mins.some((v) => v === undefined) ? undefined : Math.min(...(a.mins as number[]));
    const maxPrice = a.maxes.some((v) => v === undefined) ? undefined : Math.max(...(a.maxes as number[]));
    const types = ALL_TYPES.every((t) => a.types.has(t)) ? undefined : ALL_TYPES.filter((t) => a.types.has(t));
    return {
      slug,
      name: a.name,
      ...(minPrice !== undefined && minPrice > 0 ? { minPrice } : {}),
      ...(maxPrice !== undefined ? { maxPrice } : {}),
      ...(types ? { types } : {}),
    };
  });
}

/** Search requests for the URLs in `sources.<id>.searchUrls`, keyed by a hash of the URL. */
export function searchUrlRequests(source: SourceConfig, label: string, taken: SearchRequest[]): SearchRequest[] {
  const out: SearchRequest[] = [];
  for (const url of source.searchUrls) {
    const key = `url-${createHash('sha1').update(url).digest('hex').slice(0, 10)}`;
    if (!taken.some((r) => r.key === key || r.url === url) && !out.some((r) => r.key === key)) out.push({ key, label: `${label}: ${url}`, url });
  }
  return out;
}

export function dedupeListings(listings: RawListing[]): RawListing[] {
  const seen = new Set<string>();
  return listings.filter((l) => (seen.has(l.externalId) ? false : (seen.add(l.externalId), true)));
}

/* ================================================================
 * Pararius
 * ================================================================ */

export interface ParariusOptions {
  /** Site root, for tests against a local server. Default https://www.pararius.nl */
  baseUrl?: string;
  /** How long a page may take to get past a bot check. Default 30 s. */
  waitMs?: number;
  /** How long to wait for the confirmation after sending the contact form. Default 20 s. */
  confirmTimeoutMs?: number;
  /** Result pages read per search. Default 2. */
  maxPages?: number;
  /** Pause between two pages of one search. Default 4 s. */
  pageGapMs?: number;
}

/** Path segment per type (links on the search page, recorded 2026-09-24). */
const PARARIUS_TYPE: Partial<Record<PropertyType, string>> = { room: 'kamer', studio: 'studio', apartment: 'appartement', house: 'huis' };

/** The values of Pararius's price dropdown. A maximum is rounded up to one of them, a minimum down. */
const PRICE_STEPS = [200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1300, 1400, 1500, 1750, 2000, 2250, 2500, 3000, 4000, 6000];

function priceSegment(min: number | undefined, max: number | undefined): string | undefined {
  if (max === undefined) return undefined;
  const hi = PRICE_STEPS.find((s) => s >= max);
  if (hi === undefined) return undefined;
  const lo = min === undefined ? 0 : ([...PRICE_STEPS].reverse().find((s) => s <= min) ?? 0);
  return `${lo}-${hi}`;
}

/**
 * `/huurwoningen/{city}[/{type}][/{min}-{max}]/sinds-3`: the order of the
 * segments was checked on 2026-09-24 (the page's own filter state echoed
 * `price: {min: 0, max: 1500}, since: "1"` for `/rotterdam/0-1500/sinds-1`).
 */
export function parariusSearchUrl(base: string, area: Area): string {
  const parts = [`${base}/huurwoningen`, area.slug];
  const type = area.types?.length === 1 ? PARARIUS_TYPE[area.types[0] as PropertyType] : undefined;
  if (type) parts.push(type);
  const price = priceSegment(area.minPrice, area.maxPrice);
  if (price) parts.push(price);
  // Three days, not one: a first check then sees homes still on offer from the weekend,
  // and every later check is still small (at most two pages).
  parts.push('sinds-3');
  return parts.join('/');
}

const SEARCH_READY = 'section.listing-search-item, .no-search-results__title, .search-list-header__count';
const DETAIL_READY = '.listing-detail-summary, .page--listing-detail, .no-search-results__title, .search-list-header__count';
const CONTACT_READY = 'form textarea, .form--login-email, input[type="password"], .listing-reaction-button--click-out, .listing-detail-summary';

const LOGIN_PATH = /^\/(inloggen|login|account\/inloggen)(\/|$)/i;

const VISIBLE_CAPTCHA =
  'iframe[src*="recaptcha"]:not([src*="size=invisible"]), iframe[src*="hcaptcha.com"], .cf-turnstile, iframe[src*="challenges.cloudflare.com"]';

const SUCCESS_TEXT =
  /bedankt voor je (bericht|reactie|interesse)|je (bericht|reactie) is (verstuurd|verzonden|ontvangen)|bericht (is )?verzonden|reactie (is )?verzonden|thank you for your (message|interest)|your message (has been|was) sent/i;

/** Pararius-family login state from the masthead: 'in', 'out', or 'unknown' when the page has no masthead. */
export function mastheadLoginState(html: string): 'in' | 'out' | 'unknown' {
  const $ = load(html);
  if ($('[data-is-logged-in]').toArray().some((e) => /^(1|true)$/i.test(e.attribs['data-is-logged-in'] ?? ''))) return 'in';
  if ($('.masthead__button--login, .masthead a[href*="/inloggen"], wc-masthead a[href*="/inloggen"]').length > 0) return 'out';
  // Logged in, the masthead has no login button (inferred: no logged-in page was recorded).
  if ($('wc-masthead, .masthead').length > 0) return 'in';
  return 'unknown';
}

/** Detail-page fields merged over a listing: the page fills what the card lacked and corrects contact routing. */
export function mergeDetail(listing: RawListing, d: ParsedDetailPage): RawListing {
  const out: RawListing = { ...listing, address: { ...listing.address }, extra: { ...listing.extra } };
  const fill = <K extends keyof RawListing>(key: K, value: RawListing[K] | undefined) => {
    if (value !== undefined && out[key] === undefined) out[key] = value;
  };
  if (d.description) out.description = d.description;
  if (d.images.length) out.images = d.images;
  fill('priceEur', d.priceEur);
  if (d.priceEur !== undefined && listing.priceEur === undefined) out.priceBasis = d.priceBasis;
  fill('serviceCostsEur', d.serviceCostsEur);
  fill('depositEur', d.depositEur);
  fill('sizeM2', d.sizeM2);
  fill('rooms', d.rooms);
  fill('bedrooms', d.bedrooms);
  fill('type', d.type);
  fill('furnishing', d.furnishing);
  fill('energyLabel', d.energyLabel);
  fill('availableFrom', d.availableFrom);
  fill('publishedAt', d.publishedAt);
  for (const k of ['postcode', 'city', 'neighbourhood'] as const) if (!out.address[k] && d.address[k]) out.address[k] = d.address[k];
  if (d.agent.name || d.agent.phone) out.agent = { ...out.agent, ...(d.agent.name ? { name: d.agent.name } : {}), ...(d.agent.phone ? { phone: d.agent.phone } : {}) };
  if (d.uuid && out.extra) out.extra.uuid = d.uuid;
  if (d.status && out.extra) out.extra.status = d.status;
  return out;
}

/**
 * Pararius, the largest free-sector rental portal. Behind a Cloudflare
 * managed challenge, so every page is read in a headed browser. Reacting is
 * free but needs an account (`/contact/<uuid>` redirects to `/inloggen`
 * without one). Some listings are "found outside our own network": their
 * contact button leads to the advertiser's website, and those return
 * `contact: 'form'` with a `contactUrl` on that website.
 */
export function createParariusAdapter(options: ParariusOptions = {}): SourceAdapter {
  const base = trimTrailingSlashes(options.baseUrl ?? 'https://www.pararius.nl');
  const host = new URL(base).host;
  const waitMs = options.waitMs ?? 30_000;
  const confirmTimeoutMs = options.confirmTimeoutMs ?? 20_000;
  const maxPages = options.maxPages ?? 2;
  const pageGapMs = options.pageGapMs ?? 4_000;
  const onSite = (url: string) => {
    try {
      return new URL(url).host === host;
    } catch {
      return false;
    }
  };

  /** A listing contact page the session check opens; found on the first check. */
  let probeUrl: string | undefined;

  const withContact = (l: RawListing): RawListing => {
    const uuid = typeof l.extra?.uuid === 'string' ? l.extra.uuid : undefined;
    return { ...l, contact: 'form', ...(uuid ? { contactUrl: `${base}/contact/${uuid}` } : {}) };
  };

  async function readDetail(page: Page, url: string, ctx: SourceContext): Promise<{ loaded: LoadedPage; detail: ParsedDetailPage }> {
    const loaded = await loadPage(page, url, { ready: DETAIL_READY, waitMs, signal: ctx.signal });
    return { loaded, detail: parseParariusDetail(loaded.html, loaded.url, ctx.now()) };
  }

  /**
   * Where "Contact met de aanbieder" leads. The page's clickout form
   * (form[name=clickout_contact_form], action /clickout, fields _token and
   * listing_id; recorded 2026-09-24) sends the visitor to the advertiser.
   * This submits it the way the button does and notes the first address
   * off Pararius, from the redirect or the navigation that follows. No
   * message is sent. UNVERIFIED: no clickout form was submitted while
   * recording, so the redirect itself has only been seen in tests.
   */
  async function resolveClickout(page: Page, ctx: SourceContext): Promise<string | undefined> {
    const form = page.locator('form[name="clickout_contact_form"]').first();
    if ((await form.count()) === 0) return undefined;
    let target: string | undefined;
    const offSite = (u: string) => {
      try {
        const parsed = new URL(u);
        return /^https?:$/.test(parsed.protocol) && parsed.host !== host ? parsed.toString() : undefined;
      } catch {
        return undefined;
      }
    };
    // Only the main frame counts: ad frames on the page navigate to other hosts all the time.
    const main = (req: Request) => req.isNavigationRequest() && req.frame() === page.mainFrame();
    const onResponse = (res: Response) => {
      try {
        const status = res.status();
        if (status >= 300 && status < 400 && res.request().method() === 'POST' && main(res.request())) {
          const loc = res.headers().location;
          if (loc) target ??= offSite(new URL(loc, res.url()).toString());
        }
      } catch {
        // a frame that detached while the page navigated away
      }
    };
    const onRequest = (req: Request) => {
      try {
        if (main(req)) target ??= offSite(req.url());
      } catch {
        // as above
      }
    };
    page.on('response', onResponse);
    page.on('request', onRequest);
    try {
      await form.evaluate((f) => (f as HTMLFormElement).submit());
      const deadline = Date.now() + 15_000;
      while (!target && Date.now() < deadline) await sleep(200, ctx.signal);
      return target;
    } finally {
      page.off('response', onResponse);
      page.off('request', onRequest);
    }
  }

  async function fillAndSend(page: Page, url: string, message: OutboundMessage, ctx: SourceContext): Promise<ContactResult> {
    const form = page.locator('form:has(textarea)').first();
    if (await page.locator(VISIBLE_CAPTCHA).first().isVisible().catch(() => false)) {
      return { ok: false, channel: 'form', needs: 'captcha', error: `the contact form on ${url} shows a captcha` };
    }
    const p = message.profile;
    // [selector, value, overwrite what the account filled in]. The email is always the profile's
    // (the dedicated mailbox), so the landlord's answer reaches the agent; names and phone are
    // only filled where the account left them empty.
    const fields: [string, string | undefined, boolean][] = [
      ['input[autocomplete="given-name"], input[name*="first" i], input[name*="voornaam" i]', p.firstName, false],
      ['input[autocomplete="family-name"], input[name*="last" i], input[name*="achternaam" i]', p.lastName, false],
      ['input[autocomplete="name"], input[name="name"], input[name$="[name]"], input[name*="naam" i]:not([name*="voornaam" i]):not([name*="achternaam" i])', `${p.firstName} ${p.lastName}`.trim(), false],
      ['input[type="email"], input[name*="email" i]', p.email, true],
      ['input[type="tel"], input[name*="phone" i], input[name*="telefoon" i]', p.phone, false],
    ];
    try {
      await form.locator('textarea').first().fill(message.body, { timeout: 10_000 });
      for (const [selector, value, overwrite] of fields) {
        if (!value) continue;
        const input = form.locator(selector).first();
        if ((await input.count()) === 0 || !(await input.isEditable().catch(() => false))) continue;
        if (overwrite || !(await input.inputValue())) await input.fill(value, { timeout: 10_000 });
      }
      const required = form.locator('input[type="checkbox"][required]');
      for (let i = 0; i < (await required.count()); i++) {
        const box = required.nth(i);
        // Styled checkboxes are often visually hidden; set them directly when a click cannot reach them.
        await box.check({ timeout: 3_000 }).catch(() =>
          box.evaluate((el) => {
            (el as HTMLInputElement).checked = true;
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }),
        );
      }
    } catch (e) {
      return { ok: false, channel: 'form', error: `could not fill the contact form on ${url}: ${(e as Error).message.split('\n')[0]}` };
    }
    // The browser would refuse to submit a form with a required field left empty; say which, and send nothing.
    const missing = await form
      .evaluate((f) =>
        Array.from((f as HTMLFormElement).elements)
          .filter((el) => 'checkValidity' in el && !(el as HTMLInputElement).checkValidity())
          .map((el) => (el as HTMLInputElement).name || (el as HTMLInputElement).id || el.tagName.toLowerCase()),
      )
      .catch(() => [] as string[]);
    if (missing.length) return { ok: false, channel: 'form', error: `the contact form on ${url} still needs: ${missing.join(', ')}` };
    if (message.dryRun) return { ok: true, channel: 'form', evidence: 'dry run: the form was filled and not sent' };

    // Text the page showed before sending does not count as a confirmation.
    const shownBefore = SUCCESS_TEXT.test(load(await page.content().catch(() => '')).root().text());
    const before = page.url();
    try {
      await form.locator('button[type="submit"], input[type="submit"], .form__button--submit').first().click({ timeout: 10_000 });
    } catch (e) {
      return { ok: false, channel: 'form', error: `could not press send on ${url}: ${(e as Error).message.split('\n')[0]}` };
    }
    const deadline = Date.now() + confirmTimeoutMs;
    while (Date.now() < deadline) {
      await sleep(300, ctx.signal);
      const html = await page.content().catch(() => '');
      const $ = load(html);
      const notice = $('.notification--success, .notification--confirmation, .form__success, .contact-confirmation').first().text();
      const text = $('main').text() || $('body').text();
      const hit = SUCCESS_TEXT.exec(notice) ?? (shownBefore ? null : SUCCESS_TEXT.exec(text));
      if (hit || (page.url() !== before && /bedankt|verzonden|success|bevestig/i.test(page.url()))) {
        return { ok: true, channel: 'form', evidence: (notice.replace(/\s+/g, ' ').trim() || hit?.[0] || page.url()).slice(0, 200) };
      }
      const errors = $('.form-errors:not(.form-errors--hidden) li, .form__error, .text-control__error')
        .toArray()
        .map((e) => $(e).text().replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      if (errors.length) return { ok: false, channel: 'form', error: `the form on ${url} was not accepted: ${errors.join('; ').slice(0, 300)}` };
    }
    return { ok: false, channel: 'form', needs: 'human', error: `sent the form on ${url} but no confirmation appeared; check before sending again` };
  }

  const adapter: SourceAdapter = {
    id: 'pararius',
    name: 'Pararius',
    homepage: 'https://www.pararius.nl',
    regions: 'nl',
    defaultIntervalSec: 180,
    capabilities: {
      search: 'browser',
      detail: true,
      contact: 'form',
      login: 'required',
      terms: 'forbids',
      browser: 'headed',
    },
    loginUrl: `${base}/inloggen`,
    // REPORTED sender for saved-search mails; the @nlpf/mail parser also matches on the domain.
    alertSenders: ['noreply@pararius.nl', 'noreply@pararius.com'],

    buildSearches(searches: NamedSearch[], source: SourceConfig) {
      const reqs: SearchRequest[] = areasFromSearches(searches).map((area) => ({
        key: `${area.slug}:${area.types?.length === 1 ? area.types[0] : 'all'}:${area.minPrice ?? 0}-${area.maxPrice ?? ''}`,
        label: `Pararius ${area.name}`,
        url: parariusSearchUrl(base, area),
      }));
      return [...reqs, ...searchUrlRequests(source, 'Pararius', reqs)];
    },

    async search(req, ctx) {
      const first = req.url ?? `${base}/huurwoningen/nederland/sinds-3`;
      return withBrowserPage(ctx, async (page) => {
        const out: RawListing[] = [];
        let url: string | undefined = first;
        for (let n = 0; n < maxPages && url; n++) {
          if (n > 0) await sleep(pageGapMs, ctx.signal);
          const loaded = await loadPage(page, url, { ready: SEARCH_READY, waitMs, signal: ctx.signal });
          const parsed = parseParariusCards(loaded.html, { sourceId: 'pararius', baseUrl: loaded.url });
          out.push(...parsed.listings.map(withContact));
          ctx.log.debug('pararius page read', { url: loaded.url, listings: parsed.listings.length, skipped: parsed.skipped, noResults: parsed.noResults });
          url = parsed.listings.length > 0 ? parsed.nextPage : undefined;
        }
        return dedupeListings(out);
      });
    },

    async detail(listing, ctx) {
      return withBrowserPage(ctx, async (page) => {
        const { detail } = await readDetail(page, listing.url, ctx);
        const merged = mergeDetail(listing, detail);
        if (!detail.clickout) {
          return { ...merged, contact: 'form', ...(detail.contactUrl ? { contactUrl: detail.contactUrl } : {}) };
        }
        const external = detail.externalUrl ?? (await resolveClickout(page, ctx));
        merged.extra = { ...merged.extra, clickout: true };
        if (!external) return { ...merged, contact: 'form', contactUrl: listing.url };
        const agentUrl = new URL(external).origin;
        return { ...merged, contact: 'form', contactUrl: external, agent: { ...merged.agent, url: agentUrl } };
      });
    },

    async isAvailable(listing, ctx) {
      return withBrowserPage(ctx, async (page) => {
        let loaded: LoadedPage;
        try {
          loaded = await loadPage(page, listing.url, { ready: DETAIL_READY, waitMs, signal: ctx.signal });
        } catch (e) {
          if (e instanceof SourceHttpError && (e.status === 404 || e.status === 410)) return false;
          throw e;
        }
        // A withdrawn listing sends the visitor to a search page.
        if (!parariusListingId(loaded.url)) return false;
        return !parseParariusDetail(loaded.html, loaded.url, ctx.now()).unavailable;
      });
    },

    async contact(listing: Listing, message: OutboundMessage, ctx: SourceContext): Promise<ContactResult> {
      if (listing.contactUrl && !onSite(listing.contactUrl)) {
        return { ok: false, channel: 'form', error: `this home is advertised on the landlord's own website; react there: ${listing.contactUrl}` };
      }
      return withBrowserPage(ctx, async (page) => {
        let url = listing.contactUrl;
        if (!url) {
          // Listings from alert emails carry no listing uuid: read it from the listing page.
          const { detail } = await readDetail(page, listing.url, ctx);
          if (detail.clickout) return { ok: false, channel: 'form', error: `this home is advertised on the landlord's own website; react there: ${listing.url}` };
          if (!detail.contactUrl) return { ok: false, channel: 'form', error: `no contact button on ${listing.url}` };
          url = detail.contactUrl;
        }
        const loaded = await loadPage(page, url, { ready: CONTACT_READY, waitMs, signal: ctx.signal });
        const $ = load(loaded.html);
        if (LOGIN_PATH.test(new URL(loaded.url).pathname) || $('.form--login-email, input[type="password"]').length > 0) {
          throw new NeedsLoginError('Pararius asks for a login before its contact form', { loginUrl: `${base}/inloggen` });
        }
        if ($('form textarea').length === 0) {
          if ($('.listing-reaction-button--click-out').length > 0) {
            return { ok: false, channel: 'form', error: `this home is advertised on the landlord's own website; react there: ${listing.url}` };
          }
          const label = $('.listing-detail-summary__label').text();
          if (isUnavailableLabel(label)) return { ok: false, channel: 'form', error: `${listing.url} is no longer available (${label.trim()})` };
          return { ok: false, channel: 'form', error: `no contact form on ${loaded.url}` };
        }
        return fillAndSend(page, loaded.url, message, ctx);
      });
    },

    async checkSession(ctx) {
      // Checked the way sending needs it: a listing's contact page sends a
      // visitor without a session to /inloggen and shows the message form to
      // one with a session. The masthead alone said "logged in" for pages
      // whose login button it did not see, and closed login windows early.
      return withBrowserPage(ctx, async (page) => {
        if (!probeUrl) {
          const found = await loadPage(page, `${base}/huurwoningen/nederland`, { ready: SEARCH_READY, waitMs, signal: ctx.signal });
          probeUrl = parseParariusCards(found.html, { sourceId: 'pararius', baseUrl: found.url })
            .listings.map((l) => withContact(l).contactUrl)
            .find((u): u is string => !!u);
          if (!probeUrl) return 'none';
        }
        const loaded = await loadPage(page, probeUrl, { ready: CONTACT_READY, waitMs, signal: ctx.signal });
        const $ = load(loaded.html);
        if (LOGIN_PATH.test(new URL(loaded.url).pathname) || $('.form--login-email, input[type="password"]').length > 0) return 'none';
        if ($('form textarea').length > 0) return 'ok';
        probeUrl = undefined; // gone or advertised elsewhere: try another listing next time
        return 'none';
      });
    },

    parseAlertEmail(mail: InboundMessage): RawListing[] {
      return parseParariusAlert(mail, base);
    },
  };
  return adapter;
}

/* ---------- alert emails ---------- */

const PARARIUS_HOST = /(^|\.)pararius\.(nl|com)$/i;
const GENERIC_LINK = /^(bekijk( de)? woning|bekijk|view( property)?|meer info(rmatie)?|lees meer)$/i;
const ALERT = /zoekopdracht|zoekprofiel|nieuwe? (huur)?woning|nieuw aanbod|woningen gevonden|search alert|saved search|new (listings?|properties|rentals?|homes?)\b/i;
const NOT_ALERT = /\b(reactie|gereageerd|bericht van|bezichtiging|uitnodiging|viewing|message from|replied|wachtwoord|password|account)\b/i;

function alertListing(url: URL, text: string, title: string | undefined): RawListing | undefined {
  const externalId = parariusListingId(url.toString());
  if (!externalId) return undefined;
  const canonicalUrl = `https://${url.host.toLowerCase()}${url.pathname.replace(/\/$/, '')}`;
  const t = text.replace(/[\s ]+/g, ' ').trim();
  const name = title?.replace(/[\s ]+/g, ' ').trim();
  const typeWord = /^\/([a-z]+)-(?:te-huur|for-rent)\//i.exec(url.pathname)?.[1]?.toLowerCase();
  const pc = /([1-9]\d{3}\s?[A-Z]{2})\s+([^,(€\d]+?)(?:\s*\(([^)]*)\))?(?=\s*(?:,|€|$|\d))/.exec(t);
  const sub = pc ? parseSubtitle(pc[0]) : {};
  const price = parsePrice(/€\s*[\d.,]+[^,·]*/.exec(t)?.[0] ?? '');
  const streetPart = name?.replace(/^(appartement|apartment|huis|house|studio|kamer|room)\s+/i, '');
  const street = streetPart ? splitAddress(streetPart) : {};
  const furnishing = detectFurnishing(t);
  const listing: RawListing = {
    sourceId: 'pararius',
    externalId,
    url: canonicalUrl,
    title: name || canonicalUrl,
    address: {
      ...(street.street ? { street: street.street } : {}),
      ...(street.houseNumber ? { houseNumber: street.houseNumber } : {}),
      ...(street.addition ? { addition: street.addition } : {}),
      ...sub,
    },
    contact: 'form',
    language: 'nl',
  };
  if (price.priceEur !== undefined) Object.assign(listing, { priceEur: price.priceEur, priceBasis: price.basis });
  const size = parseSize(t);
  if (size) listing.sizeM2 = size;
  const rooms = parseRooms(t);
  if (rooms) listing.rooms = rooms;
  const type = detectType(name ?? '') ?? (typeWord ? detectType(typeWord) : undefined);
  if (type) listing.type = type;
  if (furnishing !== 'unknown') listing.furnishing = furnishing;
  return listing;
}

/**
 * Listings from a Pararius saved-search email. Each listing link (the same
 * `/<type>-te-huur/<city>/<8 hex>/<street>` pages the site shows) becomes
 * one listing, with price, postcode and features read from the block
 * around it. The id is the 8-hex segment, so an emailed listing and a
 * polled one are the same listing.
 */
export function parseParariusAlert(mail: InboundMessage, base = 'https://www.pararius.nl'): RawListing[] {
  // Other Pararius mails (a reaction sent, a message from an agent) link to listings too; those are
  // messages for the inbox, not new listings, so only saved-search mails are read here.
  const bodyText = mail.html ? load(mail.html).root().text() : mail.text;
  const subject = mail.subject ?? '';
  if (NOT_ALERT.test(subject) || !ALERT.test(`${subject}\n${bodyText.slice(0, 20_000)}`)) return [];
  const byId = new Map<string, RawListing>();
  const add = (l: RawListing | undefined) => {
    if (!l) return;
    const prev = byId.get(l.externalId);
    if (!prev || (prev.priceEur === undefined && l.priceEur !== undefined) || (prev.title === prev.url && l.title !== l.url)) byId.set(l.externalId, l);
  };
  if (mail.html) {
    const $ = load(mail.html);
    const groups = new Map<string, { url: URL; titles: string[]; container?: ReturnType<typeof $> }>();
    $('a[href]').each((_, a) => {
      let url: URL;
      try {
        url = new URL($(a).attr('href') ?? '', base);
      } catch {
        return;
      }
      if (!PARARIUS_HOST.test(url.hostname)) return;
      const id = parariusListingId(url.toString());
      if (!id) return;
      const g = groups.get(id) ?? { url, titles: [] };
      const text = $(a).text().replace(/[\s ]+/g, ' ').trim() || $(a).find('img').attr('alt')?.trim() || '';
      if (text && !GENERIC_LINK.test(text)) g.titles.push(text);
      // The smallest block around the link that mentions a price holds this listing's details.
      if (!g.container) {
        let el = $(a).parent();
        while (el.length && !/€|eur\b/i.test(el.text())) el = el.parent();
        if (el.length && el.find('a[href*="-te-huur/"], a[href*="-for-rent/"]').toArray().every((x) => parariusListingId(new URL($(x).attr('href') ?? '', base).toString()) === id)) {
          g.container = el;
        }
      }
      groups.set(id, g);
    });
    for (const g of groups.values()) {
      const title = g.titles.sort((x, y) => y.length - x.length)[0];
      add(alertListing(g.url, g.container?.text() ?? '', title));
    }
  }
  if (byId.size === 0 && mail.text) {
    const lines = mail.text.split(/\r?\n/).map((l) => l.trim());
    lines.forEach((line, i) => {
      const m = /https?:\/\/[^\s<>"]+/.exec(line);
      if (!m) return;
      let url: URL;
      try {
        url = new URL(m[0]);
      } catch {
        return;
      }
      if (!PARARIUS_HOST.test(url.hostname)) return;
      const prev = lines.slice(0, i).reverse().find((l) => l && !/^https?:/.test(l)) ?? '';
      add(alertListing(url, prev, prev.split(',')[0]));
    });
  }
  return [...byId.values()];
}

export const pararius = createParariusAdapter();
