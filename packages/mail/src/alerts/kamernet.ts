import type { InboundMessage, PropertyType, RawListing } from '@nlpf/core';
import { extractAlertListings, hostIs, titleCaseSlug, type UrlMatch } from './extract.js';
import type { AlertPlatform } from './types.js';

const TYPES: Record<string, PropertyType> = {
  kamer: 'room', room: 'room', studentenkamer: 'room', 'student-housing': 'room', studio: 'studio',
  appartement: 'apartment', apartment: 'apartment', 'anti-kraak': 'other', antisquat: 'other',
};
const KINDS = Object.keys(TYPES).join('|');

// /huren/kamer-delft/van-der-heimstraat/kamer-2407683 and /en/for-rent/room-delft/.../room-2407683
// (docs/research/platforms.md 4.3). The trailing number is the listingId.
const DETAIL = new RegExp(String.raw`^\/(?:en\/)?(?:huren|for-rent)\/(${KINDS})-([a-z0-9-]+)\/([a-z0-9-]+)\/(?:${KINDS})-(\d{5,})\/?$`, 'i');

export const kamernet: AlertPlatform = {
  id: 'kamernet',
  senderDomains: ['kamernet.nl'],
  match(url: URL): UrlMatch | null {
    if (!hostIs(url.hostname, this.senderDomains)) return null;
    const m = DETAIL.exec(url.pathname);
    if (!m?.[1] || !m[2] || !m[3] || !m[4]) return null;
    return {
      sourceId: 'kamernet',
      externalId: m[4],
      url: `https://kamernet.nl${url.pathname.replace(/\/$/, '')}`,
      contact: 'message',
      type: TYPES[m[1].toLowerCase()],
      city: titleCaseSlug(m[2]),
      street: titleCaseSlug(m[3]),
    };
  },
};

export const parseKamernetAlert = (mail: InboundMessage): RawListing[] =>
  extractAlertListings(mail, (u) => kamernet.match(u));
