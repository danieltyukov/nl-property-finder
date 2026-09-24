import { describe, expect, test } from 'vitest';
import { evaluateFilters } from '../src/filters.js';
import { inPolygon, inRegion, pc4InRanges } from '../src/regions.js';
import { listing, profile, search } from './helpers.js';

// Roughly the Delft city centre, as [lat, lon] pairs the way Leaflet draws them.
const delftCentre: [number, number][] = [
  [52.018, 4.348],
  [52.018, 4.368],
  [52.005, 4.368],
  [52.005, 4.348],
];
const rotterdam = { lat: 51.9225, lon: 4.4792 };

describe('regions', () => {
  test('PC4 range 2611-2629 accepts 2613 AB and rejects 2630 AA', () => {
    expect(pc4InRanges('2613 AB', ['2611-2629'])).toBe(true);
    expect(pc4InRanges('2630AA', ['2611-2629'])).toBe(false);
    expect(pc4InRanges('2611 BC', ['2611'])).toBe(true);
    expect(pc4InRanges(undefined, ['2611-2629'])).toBe(false);
  });

  test('polygon around Delft centre accepts (52.0116, 4.3571) and rejects Rotterdam', () => {
    expect(inPolygon({ lat: 52.0116, lon: 4.3571 }, delftCentre)).toBe(true);
    expect(inPolygon(rotterdam, delftCentre)).toBe(false);
  });

  test('polygons drawn as [lon, lat] (GeoJSON order) work too', () => {
    const swapped = delftCentre.map(([la, lo]) => [lo, la] as [number, number]);
    expect(inPolygon({ lat: 52.0116, lon: 4.3571 }, swapped)).toBe(true);
    expect(inPolygon(rotterdam, swapped)).toBe(false);
  });

  test('a region matches on any of municipality, PC4 range or polygon', () => {
    const region = { name: 'Delft', municipalities: ['delft'], postcodes: ['2611-2629'], polygon: undefined };
    expect(inRegion({ city: 'Delft' }, region)).toBe(true);
    expect(inRegion({ municipality: 'DELFT' }, region)).toBe(true);
    expect(inRegion({ postcode: '2625 AB', city: 'Den Hoorn' }, region)).toBe(true);
    expect(inRegion({ city: 'Rotterdam', postcode: '3011 AA' }, region)).toBe(false);
    expect(inRegion({ city: 'Delft' }, { name: 'Delft', municipalities: [], postcodes: [] })).toBe(true);
  });
});

describe('evaluateFilters', () => {
  const p = profile();

  test('passes a listing inside every rule', () => {
    const s = search({
      regions: [{ name: 'Delft', municipalities: ['Delft'], postcodes: [] }],
      priceMaxEur: 1400,
    });
    expect(evaluateFilters(listing({ priceEur: 1200 }), s, p)).toEqual({ passed: true });
  });

  test('region failure names the rule', () => {
    const s = search({ regions: [{ name: 'Delft', municipalities: [], postcodes: ['2611-2629'] }] });
    expect(evaluateFilters(listing({ address: { city: 'Rotterdam', postcode: '3011 AA' } }), s, p)).toEqual({
      passed: false,
      failedRule: 'region',
    });
  });

  test('polygon regions use the geocoded coordinates', () => {
    const s = search({
      regions: [{ name: 'Centre', municipalities: [], postcodes: [], polygon: delftCentre }],
    });
    expect(
      evaluateFilters(listing({ address: { city: 'Delft', lat: 52.0116, lon: 4.3571 } }), s, p).passed,
    ).toBe(true);
    expect(evaluateFilters(listing({ address: { city: 'Rotterdam', ...rotterdam } }), s, p).passed).toBe(
      false,
    );
  });

  test('price 1300 excl plus 120 service costs fails a 1400 maximum when service costs count', () => {
    const l = listing({ priceEur: 1300, priceBasis: 'excl', serviceCostsEur: 120 });
    expect(evaluateFilters(l, search({ priceMaxEur: 1400, priceIncludesServiceCosts: true }), p)).toEqual({
      passed: false,
      failedRule: 'price 1420 > 1400',
    });
    expect(
      evaluateFilters(l, search({ priceMaxEur: 1400, priceIncludesServiceCosts: false }), p).passed,
    ).toBe(true);
    expect(evaluateFilters({ ...l, priceBasis: 'incl' }, search({ priceMaxEur: 1400 }), p).passed).toBe(true);
  });

  test('price minimum, size, rooms and bedrooms', () => {
    expect(evaluateFilters(listing({ priceEur: 400 }), search({ priceMinEur: 500 }), p)).toEqual({
      passed: false,
      failedRule: 'price 400 < 500',
    });
    expect(evaluateFilters(listing({ sizeM2: 18 }), search({ sizeMinM2: 25 }), p)).toEqual({
      passed: false,
      failedRule: 'size 18 < 25',
    });
    expect(evaluateFilters(listing({ sizeM2: undefined }), search({ sizeMinM2: 25 }), p).passed).toBe(true);
    expect(evaluateFilters(listing({ rooms: 1 }), search({ roomsMin: 2 }), p)).toEqual({
      passed: false,
      failedRule: 'rooms 1 < 2',
    });
    expect(evaluateFilters(listing({ bedrooms: 1 }), search({ bedroomsMin: 2 }), p)).toEqual({
      passed: false,
      failedRule: 'bedrooms 1 < 2',
    });
  });

  test('type and furnishing', () => {
    expect(evaluateFilters(listing({ type: 'room' }), search({ types: ['studio', 'apartment'] }), p)).toEqual(
      { passed: false, failedRule: 'type room' },
    );
    expect(
      evaluateFilters(
        listing({ furnishing: 'furnished' }),
        search({ furnishing: ['unfurnished', 'upholstered'] }),
        p,
      ),
    ).toEqual({
      passed: false,
      failedRule: 'furnishing furnished',
    });
    expect(
      evaluateFilters(
        listing({ furnishing: undefined }),
        search({ furnishing: ['unfurnished', 'unknown'] }),
        p,
      ).passed,
    ).toBe(true);
  });

  test('available too late for the search or for the profile', () => {
    expect(
      evaluateFilters(listing({ availableFrom: '2026-12-01' }), search({ availableBy: '2026-11-01' }), p),
    ).toEqual({
      passed: false,
      failedRule: 'available 2026-12-01 after 2026-11-01',
    });
    expect(
      evaluateFilters(
        listing({ availableFrom: '2026-12-01' }),
        search(),
        profile({ moveInLatest: '2026-10-15' }),
      ).passed,
    ).toBe(false);
  });

  test('deal-breaker "anti-kraak" rejects a listing mentioning "Antikraak"', () => {
    const l = listing({ description: 'Tijdelijke bewoning via Antikraak organisatie.' });
    expect(evaluateFilters(l, search({ dealBreakers: ['anti-kraak'] }), p)).toEqual({
      passed: false,
      failedRule: 'deal-breaker anti-kraak',
    });
    expect(
      evaluateFilters(listing({ title: 'Anti Kraak woning' }), search({ dealBreakers: ['antikraak'] }), p)
        .passed,
    ).toBe(false);
  });

  test('works on a property with a description', () => {
    const property = {
      id: 'p1',
      key: 'k',
      address: { city: 'Delft' },
      title: 'Oude Delft 12A',
      priceEur: 1500,
      createdAt: 't',
      updatedAt: 't',
      description: 'x',
    };
    expect(evaluateFilters(property, search({ priceMaxEur: 1400 }), p)).toEqual({
      passed: false,
      failedRule: 'price 1500 > 1400',
    });
  });
});
