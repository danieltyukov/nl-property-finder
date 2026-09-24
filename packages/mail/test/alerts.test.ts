import { readFileSync } from 'node:fs';
import type { InboundMessage } from '@nlpf/core';
import { describe, expect, test } from 'vitest';
import { parseAlertEmail } from '../src/alerts/index.js';
import { cityFromLocationLine, findPostcode, findPrice, parseEuroNumber, streetFromTitle, unwrapUrl } from '../src/alerts/extract.js';
import { parseEmail } from '../src/parse.js';

const load = (name: string): Promise<InboundMessage> =>
  parseEmail(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

const summary = (r: ReturnType<typeof parseAlertEmail>) =>
  r?.listings.map((l) => [l.externalId, l.title, l.priceEur, l.address.city]);

describe('platform alert emails (synthetic fixtures)', () => {
  test('Pararius', async () => {
    const r = parseAlertEmail(await load('alert-pararius.eml'));
    expect(r?.sourceId).toBe('pararius');
    expect(summary(r)).toEqual([
      ['fd826b6c', 'Appartement Kruisstraat', 1395, 'Delft'],
      ['a3b1c2d4', 'Studio Phoenixstraat', 975, 'Delft'],
      ['9e8d7c6b', 'Huis Van Foreestweg', 2150, 'Delft'],
    ]);
    expect(r?.listings[0]).toMatchObject({
      sourceId: 'pararius',
      url: 'https://www.pararius.nl/appartement-te-huur/delft/fd826b6c/kruisstraat',
      sizeM2: 48,
      rooms: 2,
      type: 'apartment',
      furnishing: 'upholstered',
      address: { street: 'Kruisstraat', postcode: '2611 ML', city: 'Delft', neighbourhood: 'Centrum' },
      images: ['https://casco.cmcdn.nl/pararius/fd826b6c/foto-1.jpg'],
      contact: 'form',
    });
    expect(r?.listings[1]).toMatchObject({ type: 'studio', furnishing: 'furnished', sizeM2: 28, rooms: 1 });
    expect(r?.listings[2]).toMatchObject({
      type: 'house',
      furnishing: 'unfurnished',
      sizeM2: 112,
      rooms: 5,
      address: { street: 'Van Foreestweg', postcode: '2614 BA', neighbourhood: 'Tanthof-West' },
    });
  });

  test('Funda, including a click-tracking link and the older URL format', async () => {
    const r = parseAlertEmail(await load('alert-funda.eml'));
    expect(r?.sourceId).toBe('funda');
    expect(summary(r)).toEqual([
      ['43123456', 'Oude Delft 12 A', 1495, 'Delft'],
      ['43127890', 'Westvest 95', 1850, 'Delft'],
      ['43129999', 'Mathenesserlaan 120 B', 1250, 'Rotterdam'],
    ]);
    expect(r?.listings[0]).toMatchObject({
      url: 'https://www.funda.nl/detail/huur/delft/appartement-oude-delft-12-a/43123456/',
      sizeM2: 52,
      rooms: 2,
      energyLabel: 'C',
      type: 'apartment',
      address: { street: 'Oude Delft', houseNumber: '12', addition: 'A', postcode: '2611 BC', city: 'Delft' },
      images: ['https://cloud.funda.nl/valentina_media/212/345/678_720x480.jpg'],
      contact: 'form',
    });
    expect(r?.listings[1]).toMatchObject({ type: 'house', rooms: 4, bedrooms: 3, address: { street: 'Westvest', houseNumber: '95' } });
    expect(r?.listings[2]).toMatchObject({
      url: 'https://www.funda.nl/huur/rotterdam/appartement-43129999-mathenesserlaan-120-b/',
      address: { street: 'Mathenesserlaan', houseNumber: '120', addition: 'B', postcode: '3021 HK' },
    });
  });

  test('Kamernet', async () => {
    const r = parseAlertEmail(await load('alert-kamernet.eml'));
    expect(r?.sourceId).toBe('kamernet');
    expect(summary(r)).toEqual([
      ['2407683', 'Kamer Van der Heimstraat', 625, 'Delft'],
      ['2411022', 'Studio Voorstraat', 890, 'Delft'],
      ['2412345', 'Appartement West-Kruiskade', 1150, 'Rotterdam'],
    ]);
    expect(r?.listings[0]).toMatchObject({
      url: 'https://kamernet.nl/huren/kamer-delft/van-der-heimstraat/kamer-2407683',
      priceBasis: 'incl',
      sizeM2: 14,
      type: 'room',
      furnishing: 'furnished',
      availableFrom: '2026-10-01',
      address: { street: 'Van der Heimstraat', city: 'Delft' },
      contact: 'message',
    });
    // "vanaf 15 oktober" has no year; the next 15 October after the mail date is meant.
    expect(r?.listings[1]).toMatchObject({ type: 'studio', furnishing: 'upholstered', availableFrom: '2026-10-15' });
    // "per direct" means the day the alert was sent, in Amsterdam.
    expect(r?.listings[2]).toMatchObject({ priceBasis: 'excl', type: 'apartment', furnishing: 'unfurnished', availableFrom: '2026-09-23' });
  });

  test('HousingAnywhere', async () => {
    const r = parseAlertEmail(await load('alert-housinganywhere.eml'));
    expect(r?.sourceId).toBe('housinganywhere');
    expect(summary(r)).toEqual([
      ['ut1848326', 'Private room in Phoenixstraat', 750, 'Delft'],
      ['ut1852210', 'Studio in Witte de Withstraat', 1150, 'Rotterdam'],
      ['ut1850001', 'Apartment in Prinsegracht', 1450, 'Den Haag'],
    ]);
    expect(r?.listings[0]).toMatchObject({
      url: 'https://housinganywhere.com/room/ut1848326/nl/Delft/phoenixstraat',
      sizeM2: 16,
      type: 'room',
      furnishing: 'furnished',
      availableFrom: '2026-10-01',
      address: { street: 'Phoenixstraat', city: 'Delft' },
      contact: 'message',
    });
    expect(r?.listings[2]).toMatchObject({ type: 'apartment', bedrooms: 2, furnishing: 'unfurnished', availableFrom: '2026-11-01' });
  });

  test('Marktplaats', async () => {
    const r = parseAlertEmail(await load('alert-marktplaats.eml'));
    expect(r?.sourceId).toBe('marktplaats');
    expect(summary(r)).toEqual([
      ['m2198765432', 'Ruime kamer in Delft centrum', 675, 'Delft'],
      ['m2198700011', 'Studio te huur Rotterdam Noord, 25 m2', 950, 'Rotterdam'],
      ['m2198711122', 'Appartement 2 kamers', undefined, 'Den Haag'],
    ]);
    expect(r?.listings[0]).toMatchObject({
      url: 'https://www.marktplaats.nl/v/huizen-en-kamers/kamers-te-huur/m2198765432-ruime-kamer-in-delft-centrum',
      type: 'room',
      contact: 'message',
    });
    expect(r?.listings[1]).toMatchObject({ type: 'studio', sizeM2: 25 });
    expect(r?.listings[2]).toMatchObject({ type: 'apartment', rooms: 2 });
  });

  test('an agency mailing its own listings becomes an alert:<domain> source', () => {
    const r = parseAlertEmail({
      id: '<wm-1@vandam-makelaars.example>',
      channel: 'email',
      from: { name: 'Van Dam Makelaars', address: 'nieuwsbrief@vandam-makelaars.example' },
      subject: 'Nieuw aanbod huurwoningen',
      text: '',
      html: '<p><a href="https://www.vandam-makelaars.example/aanbod/huur/delft/verwersdijk-44/3843?utm_source=mail">Verwersdijk 44</a></p><p>2611 NK Delft</p><p>Huurprijs &euro; 1.275 per maand</p>',
      at: '2026-09-24T07:00:00.000Z',
      attachments: [],
    });
    expect(r?.sourceId).toBe('alert:vandam-makelaars.example');
    expect(r?.listings[0]).toMatchObject({
      externalId: 'aanbod/huur/delft/verwersdijk-44/3843',
      url: 'https://www.vandam-makelaars.example/aanbod/huur/delft/verwersdijk-44/3843',
      title: 'Verwersdijk 44',
      priceEur: 1275,
      address: { street: 'Verwersdijk', houseNumber: '44', postcode: '2611 NK', city: 'Delft' },
      contact: 'none',
    });
  });

  test('generic plain text alert from a smaller site', async () => {
    const r = parseAlertEmail(await load('alert-generic.eml'));
    expect(r?.sourceId).toBe('wonen123');
    expect(summary(r)).toEqual([
      ['huur/delft/appartement/hugo-de-grootstraat-18-4891', 'Appartement Hugo de Grootstraat 18, Delft', 1325, 'Delft'],
      ['huur/delft/studio/brabantse-turfmarkt-40-a-4907', 'Studio Brabantse Turfmarkt 40 A, Delft', 895, 'Delft'],
    ]);
    expect(r?.listings[0]).toMatchObject({
      url: 'https://www.123wonen.nl/huur/delft/appartement/hugo-de-grootstraat-18-4891',
      sizeM2: 55,
      rooms: 2,
      type: 'apartment',
      address: { street: 'Hugo de Grootstraat', houseNumber: '18', city: 'Delft' },
    });
    expect(r?.listings[1]).toMatchObject({
      priceBasis: 'incl',
      sizeM2: 27,
      type: 'studio',
      address: { street: 'Brabantse Turfmarkt', houseNumber: '40', addition: 'A' },
    });
  });
});

test('when the HTML part has no listing links the text part is read instead', () => {
  const r = parseAlertEmail({
    id: '<img-only@x>',
    channel: 'email',
    from: { address: 'noreply@kamernet.nl' },
    subject: 'Nieuwe kamers voor je alert',
    text: 'Kamer Oude Delft\n€ 700,- incl.\nhttps://kamernet.nl/huren/kamer-delft/oude-delft/kamer-2400001\n',
    html: '<p><img src="https://resources.kamernet.nl/email/banner.png"></p>',
    at: '2026-09-23T08:00:00.000Z',
    attachments: [],
  });
  expect(r?.listings.map((l) => [l.externalId, l.priceEur])).toEqual([['2400001', 700]]);
});

describe('messages that are not alerts', () => {
  test('a platform message notification that links to a listing', async () => {
    expect(parseAlertEmail(await load('kamernet-message.eml'))).toBeNull();
  });

  test('a landlord reply from the thread', async () => {
    expect(parseAlertEmail(await load('plain-reply.eml'))).toBeNull();
  });

  test('a mail from a platform domain whose links point elsewhere', () => {
    const spoof: InboundMessage = {
      id: '<spoof@x>',
      channel: 'email',
      from: { address: 'noreply@pararius.nl' },
      subject: 'Nieuw aanbod voor je zoekopdracht',
      text: '',
      html: '<p><a href="https://evil.example/appartement-te-huur/delft/fd826b6c/kruisstraat">Appartement Kruisstraat</a></p><p>&euro; 900 per maand</p>',
      at: '2026-09-23T08:00:00.000Z',
      attachments: [],
    };
    expect(parseAlertEmail(spoof)).toBeNull();
  });
});

describe('hostile input', () => {
  test('a huge alert with long lines and many links is parsed quickly', () => {
    const card = (i: number) =>
      `<p><a href="https://www.pararius.nl/appartement-te-huur/delft/${i.toString(16).padStart(8, '0')}/straat">${'Oude Delft '.repeat(200)}</a></p><p>${'1'.repeat(20000)} ${'Beschikbaar per '.repeat(300)} &euro; 1.200</p>`;
    const html = Array.from({ length: 300 }, (_, i) => card(i)).join('');
    const t0 = performance.now();
    const r = parseAlertEmail({
      id: '<big@x>',
      channel: 'email',
      from: { address: 'noreply@pararius.nl' },
      subject: 'Nieuw aanbod',
      text: '',
      html,
      at: '2026-09-23T08:00:00.000Z',
      attachments: [],
    });
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(r?.listings).toHaveLength(300);
  });

  test.each([
    ['hyphenated words', `${'Den-'.repeat(40)}x · nope`],
    ['particles', `Den ${'de '.repeat(40)}x · nope`],
    ['spaced words', `${'Den '.repeat(40)}x · nope`],
  ])('address helpers stay linear on %s', (_name, line) => {
    const t0 = performance.now();
    cityFromLocationLine([line]);
    findPostcode(`2611 AB ${line}`);
    streetFromTitle(line);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});

describe('helpers', () => {
  test.each([
    ['1.395', 1395],
    ['1,150', 1150],
    ['675,00', 675],
    ['625,', 625],
    ['2.150,50', 2150.5],
    ['950', 950],
  ])('parseEuroNumber(%s) is %s', (input, expected) => {
    expect(parseEuroNumber(input)).toBe(expected);
  });

  test('a deposit or service costs before the rent are not taken for the rent', () => {
    expect(findPrice(['Borg € 1.300 · Huur € 650 per maand'])).toEqual({ value: 650 });
    expect(findPrice(['Servicekosten € 45, kale huur € 1.100'])).toEqual({ value: 1100, basis: 'excl' });
  });

  test('unwrapUrl follows a destination carried in a query parameter', () => {
    expect(unwrapUrl('https://click.example/?qs=1&u=https%3A%2F%2Fwww.funda.nl%2Fdetail%2Fx%2F')?.href).toBe(
      'https://www.funda.nl/detail/x/',
    );
    expect(unwrapUrl('mailto:someone@example.test')).toBeNull();
  });
});
