import {
  ProfileSchema, SearchSchema,
  type InboundMessage, type Listing, type Profile, type SearchConfig,
} from '@nlpf/core';

export function makeListing(partial: Partial<Listing> = {}): Listing {
  return {
    id: 'huisje:1',
    sourceId: 'huisje',
    externalId: '1',
    url: 'http://127.0.0.1/huisje/listing/1',
    title: 'Appartement Oude Delft 12A',
    priceEur: 1150,
    priceBasis: 'excl',
    sizeM2: 42,
    rooms: 2,
    type: 'apartment',
    furnishing: 'upholstered',
    address: { street: 'Oude Delft', houseNumber: '12', addition: 'A', postcode: '2611 BC', city: 'Delft' },
    availableFrom: '2026-10-01',
    description: 'Mooi appartement in het centrum van Delft.',
    contact: 'form',
    propertyId: 'p1',
    firstSeenAt: '2026-09-23T10:00:00.000Z',
    lastSeenAt: '2026-09-23T10:00:00.000Z',
    state: 'active',
    via: 'poll',
    ...partial,
  };
}

export function makeProfile(partial: Record<string, unknown> = {}): Profile {
  return ProfileSchema.parse({
    firstName: 'Sam',
    lastName: 'de Vries',
    email: 'sam.search@example.com',
    phone: '+31 6 12345678',
    birthYear: 1998,
    occupation: 'phd',
    organisation: 'TU Delft',
    incomeMonthlyGrossEur: 3200,
    moveInFrom: '2026-10-01',
    stayMonths: 24,
    languages: ['en', 'nl'],
    about: 'I am quiet, tidy and cycle to campus every day.',
    ...partial,
  });
}

export function makeSearch(partial: Record<string, unknown> = {}): SearchConfig {
  return SearchSchema.parse({ priceMaxEur: 1400, sizeMinM2: 25, ...partial });
}

export function makeMessage(text: string, partial: Partial<InboundMessage> = {}): InboundMessage {
  return {
    id: '<m1@landlord.example>',
    channel: 'email',
    from: { name: 'Jan Bakker', address: 'jan@verhuur.example' },
    subject: 'Oude Delft 12A',
    text,
    at: '2026-09-23T10:00:00.000Z',
    attachments: [],
    ...partial,
  };
}

/** Wednesday 23 September 2026, 12:00 in Amsterdam. */
export const NOW = '2026-09-23T10:00:00.000Z';

/** Every string anywhere inside a value, for assertions over whole outputs. */
export function allStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(allStrings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(allStrings);
  return [];
}
