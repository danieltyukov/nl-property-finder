import type { InboundMessage, PropertyType, RawListing } from '@nlpf/core';
import { extractAlertListings, hostIs, type UrlMatch } from './extract.js';
import type { AlertPlatform } from './types.js';

// Only rental categories of Huizen en Kamers. The "op zoek naar" (wanted) categories are not listings.
const CATEGORY_TYPE: Record<string, PropertyType | undefined> = {
  'kamers-te-huur': 'room',
  'huizen-te-huur': 'house',
  'expat-rentals': undefined,
  'anti-kraak': 'other',
};

// /v/huizen-en-kamers/kamers-te-huur/m2198765432-ruime-kamer-in-delft-centrum (docs/research/platforms.md 4.19).
const DETAIL = /^\/[va]\/huizen-en-kamers\/([a-z-]+)\/(m\d{6,})(-[a-z0-9-]*)?\/?$/i;

export const marktplaats: AlertPlatform = {
  id: 'marktplaats',
  senderDomains: ['marktplaats.nl'],
  match(url: URL): UrlMatch | null {
    if (!hostIs(url.hostname, this.senderDomains)) return null;
    const m = DETAIL.exec(url.pathname);
    const category = m?.[1]?.toLowerCase();
    if (!m?.[2] || !category || !(category in CATEGORY_TYPE)) return null;
    const match: UrlMatch = {
      sourceId: 'marktplaats',
      externalId: m[2].toLowerCase(),
      url: `https://www.marktplaats.nl${url.pathname.replace(/\/$/, '')}`,
      contact: 'message',
    };
    // The category is a weak hint: studios and apartments are posted under "kamers" and "huizen" too.
    const hint = CATEGORY_TYPE[category];
    if (hint) match.typeHint = hint;
    return match;
  },
};

export const parseMarktplaatsAlert = (mail: InboundMessage): RawListing[] =>
  extractAlertListings(mail, (u) => marktplaats.match(u));
