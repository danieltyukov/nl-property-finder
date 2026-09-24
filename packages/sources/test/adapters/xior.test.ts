import { describe, expect, test } from 'vitest';
import { memoryLogger } from '@nlpf/core';
import { createXiorAdapter, parseXiorCity, parseXiorResidence, xior } from '../../src/adapters/xior.js';
import { fixtureContext, readFixture } from '../../src/testing.js';
import { fakeBrowser } from './fake-page.js';

const now = new Date('2026-09-24T10:00:00Z');
const BASE = 'https://www.xiorstudenthousing.eu/nl/netherlands/delft';
const routes = {
  [`${BASE}/`]: 'xior/city-delft.html',
  [`${BASE}/antonia-veerstraat-student-accommodation/`]: 'xior/residence-antonia-veerstraat.html',
  [`${BASE}/phoenixstraat-student-accommodation/`]: 'xior/residence-phoenixstraat.html',
  // Barbarasteeg was not recorded: the fake answers 404 and the adapter skips it.
};
const config = {
  searches: [
    {
      id: 'main',
      name: 'Main',
      regions: [
        { name: 'Delft', municipalities: ['Delft'] },
        { name: 'Rotterdam', municipalities: ['Rotterdam'] },
        { name: 'Den Haag', municipalities: ['Den Haag'] },
      ],
      priceMaxEur: 1400,
    },
  ],
};

function setup(answer?: (body: URLSearchParams) => { status: number; text: string }) {
  const browser = fakeBrowser(routes);
  const calls: URLSearchParams[] = [];
  browser.evaluate = (_fn, arg) => {
    const body = new URLSearchParams((arg as { form: string }).form);
    calls.push(body);
    return answer?.(body) ?? { status: 200, text: '{"success":false,"data":{"message":"Please complete the verification."}}' };
  };
  const log = memoryLogger();
  const ctx = fixtureContext({ sourceId: 'xior', routes: [], config, browser, now, log });
  return { ctx, browser, calls, log };
}

describe('xior', () => {
  test('notify only: booking contact, a headed browser, terms unknown', () => {
    expect(xior.capabilities).toMatchObject({ search: 'browser', contact: 'booking', login: 'required', terms: 'unknown', browser: 'headed' });
    expect(xior.contact).toBeUndefined();
    expect(xior.regions).toContain('delft');
  });

  test('buildSearches asks the city pages Xior has', () => {
    const { ctx } = setup();
    expect(xior.buildSearches(ctx.searches, ctx.source).map((r) => r.url)).toEqual([`${BASE}/`, 'https://www.xiorstudenthousing.eu/nl/netherlands/the-hague/']);
  });

  test('reads residences from the city page and room types from a residence page', () => {
    expect(parseXiorCity(readFixture('xior/city-delft.html'), `${BASE}/`)).toEqual([
      { name: 'Antonia Veerstraat', url: `${BASE}/antonia-veerstraat-student-accommodation/`, fromPriceEur: 813 },
      { name: 'Barbarasteeg', url: `${BASE}/barbarasteeg-student-accommodation/`, fromPriceEur: expect.any(Number) },
      { name: 'Phoenixstraat', url: `${BASE}/phoenixstraat-student-accommodation/`, fromPriceEur: expect.any(Number) },
    ]);
    const antonia = parseXiorResidence(readFixture('xior/residence-antonia-veerstraat.html'));
    expect(antonia).toMatchObject({ propertyPageId: '13867', semesterId: '3281', ajaxUrl: 'https://www.xiorstudenthousing.eu/wp-admin/admin-ajax.php' });
    expect(antonia.roomTypes).toEqual([
      expect.objectContaining({ id: '33935', name: 'Comfy (1 pers)', priceEur: 813, sizeM2: 24, bookable: true, partnerOnly: false, privateRoom: true }),
      expect.objectContaining({ id: '33936', name: 'Comfy (2 pers)', priceEur: 1000, sizeM2: 35, bookable: true, partnerOnly: false }),
    ]);
    const phoenix = parseXiorResidence(readFixture('xior/residence-phoenixstraat.html'));
    expect(phoenix.roomTypes.map((t) => [t.name, t.partnerOnly])).toEqual([
      ['Comfy S', true],
      ['Comfy M', true],
      ['Comfy L', true],
    ]);
  });

  test('lists the free units the booking modal would show, and skips partner-only rooms', async () => {
    const adapter = createXiorAdapter({ gapMs: 0 });
    const { ctx, browser, calls, log } = setup((body) =>
      body.get('room_type_id') === '33935' ? { status: 200, text: readFixture('xior/availability-33935.json') } : { status: 200, text: '{"success":false}' },
    );
    const listings = await adapter.search(adapter.buildSearches(ctx.searches, ctx.source)[0]!, ctx);
    expect(browser.sessions).toEqual([{ headed: true }]);
    expect(calls.map((c) => Object.fromEntries(c))).toEqual([
      { action: 'yardi_room_availability', property_page_id: '13867', room_type_id: '33935', semester_id: '3281' },
    ]);
    expect(listings).toEqual([
      {
        sourceId: 'xior',
        externalId: 'unit-402419',
        url: `${BASE}/antonia-veerstraat-student-accommodation/`,
        title: 'Comfy (1 pers) AV.1.07, Antonia Veerstraat',
        priceEur: 813,
        priceBasis: 'unknown',
        sizeM2: 24,
        depositEur: 813,
        availableFrom: '2026-11-01',
        type: 'studio',
        address: { street: 'Antonia Veerstraat', city: 'Delft' },
        images: [expect.stringMatching(/^https:\/\/www\.xiorstudenthousing\.eu\/wp-content\//)],
        contact: 'booking',
        contactUrl: 'https://xior.securerc.co.uk/onlineleasing/example/oleapplication.aspx?UnitID=402419',
        language: 'nl',
        extra: { residence: 'Antonia Veerstraat', roomType: 'Comfy (1 pers)', roomTypeId: '33935', propertyPageId: '13867', unitStatus: 'Notice Unrented', maxRentEur: 845 },
      },
      expect.objectContaining({ externalId: 'unit-402431', priceEur: 829, sizeM2: 25 }),
    ]);
    expect(listings[1]?.availableFrom).toBeUndefined();
    expect(log.entries.some((e) => e.msg === 'could not read a Xior residence')).toBe(true);
  });

  test('when the availability check is refused, each bookable room type is listed for a person to check', async () => {
    const adapter = createXiorAdapter({ gapMs: 0 });
    const { ctx } = setup();
    const listings = await adapter.search(adapter.buildSearches(ctx.searches, ctx.source)[0]!, ctx);
    expect(listings).toEqual([
      expect.objectContaining({ externalId: 'type-13867-33935', title: 'Comfy (1 pers), Antonia Veerstraat', priceEur: 813, sizeM2: 24, contact: 'booking', extra: expect.objectContaining({ availability: 'unknown' }) }),
      expect.objectContaining({ externalId: 'type-13867-33936', title: 'Comfy (2 pers), Antonia Veerstraat', priceEur: 1000, sizeM2: 35 }),
    ]);
  });

  test('one failed answer does not hide the other room types', async () => {
    const adapter = createXiorAdapter({ gapMs: 0 });
    const twoPers = JSON.stringify({
      success: true,
      data: { units: [{ apartmentId: 402500, apartmentName: 'AV.3.02', minimumRent: 1000, sqm: 35, availableDate: '01/12/2026' }], availability_by_room: { '33936': 1 } },
    });
    const { ctx, calls } = setup((body) => (body.get('room_type_id') === '33935' ? { status: 500, text: 'error' } : { status: 200, text: twoPers }));
    const listings = await adapter.search(adapter.buildSearches(ctx.searches, ctx.source)[0]!, ctx);
    expect(calls.map((c) => c.get('room_type_id'))).toEqual(['33935', '33936']);
    expect(listings).toEqual([
      expect.objectContaining({ externalId: 'type-13867-33935', extra: expect.objectContaining({ availability: 'unknown' }) }),
      expect.objectContaining({ externalId: 'unit-402500', title: 'Comfy (2 pers) AV.3.02, Antonia Veerstraat', availableFrom: '2026-12-01' }),
    ]);
  });

  test('without the availability check no request is made to the endpoint', async () => {
    const adapter = createXiorAdapter({ gapMs: 0, checkAvailability: false });
    const { ctx, calls } = setup();
    expect(await adapter.search(adapter.buildSearches(ctx.searches, ctx.source)[0]!, ctx)).toHaveLength(2);
    expect(calls).toHaveLength(0);
  });
});
