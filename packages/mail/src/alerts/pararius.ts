import type { InboundMessage, PropertyType, RawListing } from '@nlpf/core';
import { extractAlertListings, hostIs, titleCaseSlug, type UrlMatch } from './extract.js';
import type { AlertPlatform } from './types.js';

const TYPES: Record<string, PropertyType> = {
  appartement: 'apartment', apartment: 'apartment', huis: 'house', house: 'house', studio: 'studio', kamer: 'room', room: 'room',
};

// Detail pages look like /appartement-te-huur/delft/fd826b6c/kruisstraat (pararius.com: /apartment-for-rent/...).
// The 8-hex segment is the listing id (docs/research/platforms.md 4.1).
const DETAIL = /^\/(appartement|huis|studio|kamer|apartment|house|room)-(?:te-huur|for-rent)\/([a-z0-9-]+)\/([0-9a-f]{8})\/([a-z0-9-]+)\/?$/i;

export const pararius: AlertPlatform = {
  id: 'pararius',
  senderDomains: ['pararius.nl', 'pararius.com'],
  match(url: URL): UrlMatch | null {
    if (!hostIs(url.hostname, this.senderDomains)) return null;
    const m = DETAIL.exec(url.pathname);
    if (!m?.[1] || !m[2] || !m[3] || !m[4]) return null;
    return {
      sourceId: 'pararius',
      externalId: m[3].toLowerCase(),
      url: `https://${url.hostname.toLowerCase()}${url.pathname.replace(/\/$/, '')}`,
      contact: 'form',
      type: TYPES[m[1].toLowerCase()],
      city: titleCaseSlug(m[2]),
      street: titleCaseSlug(m[4]),
    };
  },
};

export const parseParariusAlert = (mail: InboundMessage): RawListing[] =>
  extractAlertListings(mail, (u) => pararius.match(u));
