import type { InboundMessage, PropertyType, RawListing } from '@nlpf/core';
import { extractAlertListings, hostIs, titleCaseSlug, type UrlMatch } from './extract.js';
import type { AlertPlatform } from './types.js';

const typeOf = (word: string): PropertyType => (word === 'appartement' ? 'apartment' : word === 'huis' ? 'house' : 'other');

// Current detail URLs: /detail/huur/{city}/{type}-{street-and-number}/{tinyId}/ (docs/research/platforms.md 4.2).
const DETAIL = /^\/(?:en\/)?detail\/huur\/([a-z0-9-]+)\/([a-z]+)-([a-z0-9-]+)\/(\d{6,})\/?$/i;
// Older links still found in mail: /huur/{city}/{type}-{id}-{street-and-number}/
const LEGACY = /^\/(?:en\/)?huur\/([a-z0-9-]+)\/([a-z]+)-(\d{6,})-([a-z0-9-]+)\/?$/i;

export const funda: AlertPlatform = {
  id: 'funda',
  senderDomains: ['funda.nl'],
  match(url: URL): UrlMatch | null {
    if (!hostIs(url.hostname, this.senderDomains) || /^(click|links?|email|mail)\./i.test(url.hostname)) return null;
    const path = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
    const m = DETAIL.exec(path);
    if (m?.[1] && m[2] && m[4]) {
      return {
        sourceId: 'funda',
        externalId: m[4],
        url: `https://www.funda.nl${path}`,
        contact: 'form',
        type: typeOf(m[2].toLowerCase()),
        city: titleCaseSlug(m[1]),
      };
    }
    const l = LEGACY.exec(path);
    if (l?.[1] && l[2] && l[3]) {
      return {
        sourceId: 'funda',
        externalId: l[3],
        url: `https://www.funda.nl${path}`,
        contact: 'form',
        type: typeOf(l[2].toLowerCase()),
        city: titleCaseSlug(l[1]),
      };
    }
    return null;
  },
};

export const parseFundaAlert = (mail: InboundMessage): RawListing[] => extractAlertListings(mail, (u) => funda.match(u));
