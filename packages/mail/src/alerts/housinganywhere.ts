import type { InboundMessage, PropertyType, RawListing } from '@nlpf/core';
import { extractAlertListings, hostIs, titleCaseSlug, type UrlMatch } from './extract.js';
import type { AlertPlatform } from './types.js';

const TYPES: Record<string, PropertyType> = {
  room: 'room', 'private-room': 'room', 'shared-room': 'room', studio: 'studio', apartment: 'apartment', house: 'house',
};

// /room/ut1848326/nl/Delft/phoenixstraat: kind, unit type id, country, city, street slug.
const DETAIL = /^\/(?:[a-z]{2}\/)?(room|private-room|shared-room|studio|apartment|house)\/(ut\d{4,})\/[a-z]{2}\/([A-Za-z0-9-]+)(?:\/([a-z0-9-]+))?\/?$/;

export const housinganywhere: AlertPlatform = {
  id: 'housinganywhere',
  senderDomains: ['housinganywhere.com'],
  match(url: URL): UrlMatch | null {
    if (!hostIs(url.hostname, this.senderDomains)) return null;
    const m = DETAIL.exec(url.pathname);
    if (!m?.[1] || !m[2] || !m[3]) return null;
    const match: UrlMatch = {
      sourceId: 'housinganywhere',
      externalId: m[2],
      url: `https://housinganywhere.com${url.pathname.replace(/\/$/, '')}`,
      contact: 'message',
      type: TYPES[m[1]],
      city: titleCaseSlug(m[3]),
    };
    if (m[4]) match.street = titleCaseSlug(m[4]);
    return match;
  },
};

export const parseHousingAnywhereAlert = (mail: InboundMessage): RawListing[] =>
  extractAlertListings(mail, (u) => housinganywhere.match(u));
