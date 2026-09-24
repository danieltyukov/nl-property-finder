import type { ContactResult, Listing, NamedSearch, OutboundMessage, RawListing, SearchRequest, SourceAdapter, SourceConfig, SourceContext } from '@nlpf/core';
import { trimTrailingSlashes } from '@nlpf/core';
import { SourceHttpError } from '../runtime/errors.js';
import { sleep } from '../runtime/fetch.js';
import { parariusListingId, parseParariusCards, parseParariusDetail } from '../parsers/pararius-cards.js';
import {
  areasFromSearches,
  dedupeListings,
  loadPage,
  mastheadLoginState,
  mergeDetail,
  searchUrlRequests,
  withBrowserPage,
  type Area,
  type LoadedPage,
} from './pararius.js';

export interface HuurwoningenOptions {
  /** Site root, for tests against a local server. Default https://www.huurwoningen.nl */
  baseUrl?: string;
  /** How long a page may take to get past a bot check. Default 30 s. */
  waitMs?: number;
  /** Result pages read per search. Default 2. */
  maxPages?: number;
  /** Pause between two pages of one search. Default 4 s. */
  pageGapMs?: number;
}

/**
 * `/in/{city}/?price={min}-{max}&since=1`. Checked on 2026-09-24: the page's
 * own filter state echoed `price: {min: 0, max: 1500}, since: "3"` for
 * `/in/rotterdam/?price=0-1500&since=3`, and "1 dag" is `since=1`.
 */
export function huurwoningenSearchUrl(base: string, area: Area): string {
  const u = new URL(`${base}/in/${area.slug}/`);
  if (area.maxPrice !== undefined) u.searchParams.set('price', `${Math.floor(area.minPrice ?? 0)}-${Math.ceil(area.maxPrice)}`);
  u.searchParams.set('since', '3'); // three days: a first check sees what is still on offer
  return u.toString();
}

const SEARCH_READY = 'section.listing-search-item, .no-search-results__title, .search-list-header__count';
const DETAIL_READY = '.listing-detail-summary, .page--listing-detail, .no-search-results__title, .search-list-header__count';
const MASTHEAD_READY = 'wc-masthead, .masthead';

/**
 * Huurwoningen.nl, Pararius's sister site with the same card markup. Most
 * homes are also on Pararius or the agent's own site, so it mainly feeds
 * duplicates and the paywall router: reacting needs Premium (EUR 29.95 a
 * month, REPORTED), and without that plan the router looks for a free copy
 * of the same home elsewhere.
 */
export function createHuurwoningenAdapter(options: HuurwoningenOptions = {}): SourceAdapter {
  const base = trimTrailingSlashes(options.baseUrl ?? 'https://www.huurwoningen.nl');
  const waitMs = options.waitMs ?? 30_000;
  const maxPages = options.maxPages ?? 2;
  const pageGapMs = options.pageGapMs ?? 4_000;

  const withContact = (l: RawListing): RawListing => ({ ...l, contact: 'form', contactUrl: l.url });

  return {
    id: 'huurwoningen',
    name: 'Huurwoningen',
    homepage: 'https://www.huurwoningen.nl',
    regions: 'nl',
    defaultIntervalSec: 300,
    capabilities: {
      search: 'browser',
      detail: true,
      contact: 'form',
      login: 'required',
      paid: { feature: 'contact', plan: 'huurwoningen-premium' },
      terms: 'forbids',
      browser: 'headed',
    },
    loginUrl: `${base}/account/inloggen/`,

    buildSearches(searches: NamedSearch[], source: SourceConfig) {
      const reqs: SearchRequest[] = areasFromSearches(searches).map((area) => ({
        key: `${area.slug}:${area.minPrice ?? 0}-${area.maxPrice ?? ''}`,
        label: `Huurwoningen ${area.name}`,
        url: huurwoningenSearchUrl(base, area),
      }));
      return [...reqs, ...searchUrlRequests(source, 'Huurwoningen', reqs)];
    },

    async search(req, ctx) {
      return withBrowserPage(ctx, async (page) => {
        const out: RawListing[] = [];
        let url: string | undefined = req.url ?? `${base}/in/nederland/?since=3`;
        for (let n = 0; n < maxPages && url; n++) {
          if (n > 0) await sleep(pageGapMs, ctx.signal);
          const loaded = await loadPage(page, url, { ready: SEARCH_READY, waitMs, signal: ctx.signal });
          const parsed = parseParariusCards(loaded.html, { sourceId: 'huurwoningen', baseUrl: loaded.url });
          out.push(...parsed.listings.map(withContact));
          url = parsed.listings.length > 0 ? parsed.nextPage : undefined;
        }
        return dedupeListings(out);
      });
    },

    async detail(listing, ctx) {
      return withBrowserPage(ctx, async (page) => {
        const loaded = await loadPage(page, listing.url, { ready: DETAIL_READY, waitMs, signal: ctx.signal });
        return withContact(mergeDetail(listing, parseParariusDetail(loaded.html, loaded.url, ctx.now())));
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
        if (!parariusListingId(loaded.url)) return false;
        return !parseParariusDetail(loaded.html, loaded.url, ctx.now()).unavailable;
      });
    },

    async contact(listing: Listing, _message: OutboundMessage, ctx: SourceContext): Promise<ContactResult> {
      if (!ctx.source.paidPlan) {
        return { ok: false, channel: 'form', needs: 'paid', error: 'reacting on Huurwoningen needs Premium (huurwoningen-premium)' };
      }
      // The Premium reaction form could not be recorded without an account, so it is not automated yet.
      return { ok: false, channel: 'form', error: `automatic reactions on Huurwoningen are not supported yet; react on ${listing.url}` };
    },

    async checkSession(ctx) {
      return withBrowserPage(ctx, async (page) => {
        const loaded = await loadPage(page, `${base}/`, { ready: MASTHEAD_READY, waitMs, signal: ctx.signal });
        return mastheadLoginState(loaded.html) === 'in' ? 'ok' : 'none';
      });
    },
  };
}

export const huurwoningen = createHuurwoningenAdapter();
