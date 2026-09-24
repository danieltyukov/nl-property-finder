import { describe, expect, test } from 'vitest';
import { ConfigSchema, type Listing, type RawListing, type SourceAdapter } from '@nlpf/core';
import { portalAdapters } from '../../src/builtin/portals.js';
import {
  amsterdamLocalToIso,
  createZigAdapter,
  htmlToText,
  placePasses,
  portalFilters,
  zigEnergyLabel,
  zigModel,
  type ZigObject,
} from '../../src/generic/zig.js';
import { hollandRijnland } from '../../src/instances/holland-rijnland.js';
import { plaza } from '../../src/instances/plaza.js';
import { roommatch } from '../../src/instances/roommatch.js';
import { woonnetHaaglanden } from '../../src/instances/woonnet-haaglanden.js';
import { createRegistry } from '../../src/runtime/registry.js';
import { fixtureContext } from '../../src/testing.js';

const NOW = new Date('2026-09-24T08:00:00Z');

async function searchFixture(adapter: SourceAdapter, file: string, config?: Record<string, unknown>): Promise<RawListing[]> {
  const ctx = fixtureContext({ sourceId: adapter.id, routes: { getallobjects: file }, now: NOW, config });
  const [req] = adapter.buildSearches(ctx.searches, ctx.source);
  return adapter.search(req!, ctx);
}

const asListing = (raw: RawListing): Listing => ({
  ...raw,
  id: `${raw.sourceId}:${raw.externalId}`,
  propertyId: null,
  firstSeenAt: '2026-09-24T08:00:00Z',
  lastSeenAt: '2026-09-24T08:00:00Z',
  state: 'active',
  via: 'poll',
});

const RANDSTAD_SEARCH = {
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

describe('Zig portal adapter', () => {
  test('capabilities: portal reaction behind a login, terms unknown, no paid plan', () => {
    const adapter = createZigAdapter(roommatch);
    expect(adapter.id).toBe('roommatch');
    expect(adapter.capabilities).toEqual({ search: 'json', detail: true, contact: 'form', login: 'required', terms: 'unknown' });
    expect(adapter.capabilities.paid).toBeUndefined();
    expect(adapter.loginUrl).toBe('https://www.roommatch.nl/redirect?code=portal-login-page');
    expect(adapter.regions).toContain('delft');
    expect(adapter.defaultIntervalSec).toBe(60);
    expect(typeof adapter.checkSession).toBe('function');
    expect(typeof adapter.contact).toBe('function');
  });

  test('RoomMatch: maps objects to listings with absolute URLs, net rent and service costs', async () => {
    const listings = await searchFixture(createZigAdapter(roommatch), 'zig-roommatch/getallobjects.json');
    expect(listings.map((l) => l.externalId)).toEqual(['139315', '139350', '139460', '139546', '139386', '139616']);
    const [first] = listings;
    expect(first).toMatchObject({
      sourceId: 'roommatch',
      externalId: '139315',
      url: 'https://www.roommatch.nl/aanbod/studentenwoningen/details/139315-rntgenweg-255-delft',
      contactUrl: 'https://www.roommatch.nl/aanbod/studentenwoningen/details/139315-rntgenweg-255-delft',
      title: 'Röntgenweg 255',
      priceEur: 548.56,
      priceBasis: 'excl',
      serviceCostsEur: 103.41,
      sizeM2: 27,
      type: 'studio',
      furnishing: 'unfurnished',
      address: {
        street: 'Röntgenweg',
        houseNumber: '255',
        postcode: '2624 BD',
        city: 'Delft',
        municipality: 'Delft',
        neighbourhood: 'Voorhof',
        lat: 51.9994,
        lon: 4.35794,
      },
      availableFrom: '2026-10-17',
      energyLabel: 'A',
      publishedAt: '2026-09-17T10:28:00.000Z',
      contact: 'form',
      language: 'nl',
      images: [
        'https://www.roommatch.nl/portal/uploads/dwelling/pictures/139315-6aaa9dc27a68e.jpg',
        'https://www.roommatch.nl/portal/uploads/dwelling/pictures/139315-6aaa9dc591922.jpg',
      ],
      extra: {
        platform: 'zig',
        objectId: '139315',
        model: 'inschrijfduur',
        firstComeFirstServed: false,
        closingAt: '2026-09-24T10:28:00.000Z',
        registrationRequired: true,
        maxActiveReactions: 5,
        targetGroups: ['jongeren'],
      },
    });
    expect(first?.extra?.registration).toMatch(/EUR 35/);
    // RoomMatch fills the rooms field with a constant, so it is not used.
    expect(first?.rooms).toBeUndefined();
    const byId = Object.fromEntries(listings.map((l) => [l.externalId, l]));
    expect(byId['139460']).toMatchObject({ type: 'room', furnishing: 'furnished', address: { addition: '11B-7', city: 'Wageningen' } });
    expect(byId['139546']?.extra).toMatchObject({ model: 'reactiedatum', firstComeFirstServed: true });
    expect(byId['139386']?.extra).toMatchObject({ model: 'hospiteren-inschrijfduur' });
    expect(byId['139616']).toMatchObject({ type: 'room', extra: { model: 'hospiteren' } });
  });

  test('RoomMatch: closed ads are skipped', async () => {
    const adapter = createZigAdapter(roommatch);
    const ctx = fixtureContext({ routes: { getallobjects: 'zig-roommatch/getallobjects.json' }, now: new Date('2027-01-01T00:00:00Z') });
    const [req] = adapter.buildSearches(ctx.searches, ctx.source);
    expect(await adapter.search(req!, ctx)).toEqual([]);
  });

  test('Plaza: reactiedatum is first come, first served; parking, invitation-only rooms and homes abroad are skipped', async () => {
    const listings = await searchFixture(createZigAdapter(plaza), 'zig-plaza/getallobjects.json');
    expect(listings.map((l) => l.externalId)).toEqual(['9537', '17246', '17247', '17279']);
    expect(listings[0]).toMatchObject({
      title: 'Jan de Oudeweg 496',
      url: 'https://plaza.newnewnew.space/aanbod/huurwoningen/details/9537-jandeoudeweg-496-delft',
      priceEur: 877,
      serviceCostsEur: 296.95,
      type: 'apartment',
      address: { city: 'Delft', postcode: '2628 SK' },
      extra: { model: 'reactiedatum', firstComeFirstServed: true, registration: 'Plaza account, EUR 27.50 per year' },
    });
    expect(listings[1]).toMatchObject({ type: 'room', sizeM2: 15, address: { city: 'Rijswijk' } });
    expect(listings.every((l) => l.rooms === undefined)).toBe(true);
  });

  test('Woonnet Haaglanden: home swaps are skipped and lotteries are called loting', async () => {
    const listings = await searchFixture(createZigAdapter(woonnetHaaglanden), 'zig-woonnet-haaglanden/getallobjects.json');
    expect(listings.map((l) => l.externalId)).toEqual(['266497', '266783', '267161', '267041', '267138']);
    expect(listings[0]).toMatchObject({
      url: 'https://www.woonnet-haaglanden.nl/aanbod/nu-te-huur/te-huur/details/266497-janwillemfrisostraat-52-delft',
      type: 'house',
      rooms: 3,
      sizeM2: 65,
      extra: { model: 'inschrijfduur', maxActiveReactions: 2 },
    });
    expect(listings[1]?.type).toBe('apartment');
    expect(listings[2]?.extra).toMatchObject({ model: 'loting', modelCode: 'random', firstComeFirstServed: false });
    expect(listings[4]?.address).toMatchObject({ city: 'Leidschendam', municipality: 'Leidschendam-Voorburg' });
  });

  test('Huren in Holland Rijnland: parking is skipped', async () => {
    const listings = await searchFixture(createZigAdapter(hollandRijnland), 'zig-holland-rijnland/getallobjects.json');
    expect(listings.map((l) => l.externalId)).toEqual(['187818', '187806', '187840', '187843']);
    expect(listings[2]?.address).toMatchObject({ city: 'Warmond', municipality: 'Teylingen' });
    expect(listings[3]?.sizeM2).toBeUndefined();
    expect(listings[0]?.url).toBe(
      'https://www.hureninhollandrijnland.nl/aanbod/nu-te-huur/huurwoningen/details/187818-spoorlaan-78-leiden',
    );
  });

  test('buildSearches: one request per poll that carries the search filters; search applies them', async () => {
    const adapter = createZigAdapter(woonnetHaaglanden);
    const config = ConfigSchema.parse(RANDSTAD_SEARCH);
    const reqs = adapter.buildSearches(config.searches, config.sources['woonnet-haaglanden'] ?? { enabled: true, searchUrls: [], options: {} });
    expect(reqs).toEqual([
      {
        key: 'all',
        label: 'Woonnet Haaglanden: current offer',
        url: 'https://www.woonnet-haaglanden.nl/portal/object/frontend/getallobjects/format/json',
        params: { municipalities: 'delft,den haag,rotterdam', maxRentEur: 1400 },
      },
    ]);
    const ctx = fixtureContext({ routes: { getallobjects: 'zig-woonnet-haaglanden/getallobjects.json' }, now: NOW, config: RANDSTAD_SEARCH });
    const listings = await adapter.search(reqs[0]!, ctx);
    // Zoetermeer and Leidschendam-Voorburg are outside the searches.
    expect(listings.map((l) => l.externalId)).toEqual(['266497', '266783', '267161']);
    expect(ctx.requests).toHaveLength(1);
    expect(ctx.requests[0]).toMatchObject({ method: 'POST', url: reqs[0]!.url });
    expect(ctx.requests[0]?.headers['x-requested-with']).toBe('XMLHttpRequest');
  });

  test('buildSearches: a lower maximum rent drops dearer homes', async () => {
    const adapter = createZigAdapter(woonnetHaaglanden);
    const config = { searches: [{ id: 'cheap', name: 'Cheap', regions: [{ name: 'Delft', municipalities: ['Delft'] }], priceMaxEur: 930 }] };
    const listings = await searchFixture(adapter, 'zig-woonnet-haaglanden/getallobjects.json', config);
    // Net rent 932.93 is above 930; 925.35 is not.
    expect(listings.map((l) => l.externalId)).toEqual(['266783']);
  });

  test("buildSearches: the official name 's-Gravenhage matches the portals' Den Haag", async () => {
    const config = { searches: [{ id: 'dh', name: 'Den Haag', regions: [{ name: 'Den Haag', municipalities: ["'s-Gravenhage"] }] }] };
    const listings = await searchFixture(createZigAdapter(woonnetHaaglanden), 'zig-woonnet-haaglanden/getallobjects.json', config);
    expect(listings.map((l) => l.address.city)).toEqual(['Den Haag']);
  });

  test('portalFilters: no municipality filter when a search is drawn without municipalities', () => {
    const config = ConfigSchema.parse({
      searches: [
        { id: 'a', name: 'A', regions: [{ name: 'Delft', municipalities: ['Delft'] }], priceMaxEur: 900 },
        { id: 'b', name: 'B', regions: [{ name: 'Centre', postcodes: ['2611-2613'] }] },
      ],
    });
    expect(portalFilters(config.searches)).toEqual({});
  });

  test('detail reads the full object: description, pictures and requirements', async () => {
    const adapter = createZigAdapter(woonnetHaaglanden);
    const [first] = await searchFixture(adapter, 'zig-woonnet-haaglanden/getallobjects.json');
    const ctx = fixtureContext({ routes: [{ match: '/getobject/', method: 'POST', file: 'zig-woonnet-haaglanden/getobject.json' }], now: NOW });
    const full = await adapter.detail!(first!, ctx);
    expect(full.description).toContain('Deze gezellige wijk');
    expect(full.description).not.toContain('<p>');
    expect(full.images).toHaveLength(3);
    expect(full.extra).toMatchObject({ minimumHouseholdSize: 2, maximumHouseholdSize: 4, minimumAge: 18, numberOfReactions: 339 });
    expect(ctx.requests[0]?.body).toBe('id=266497');
    expect(ctx.requests[0]?.headers['content-type']).toContain('application/x-www-form-urlencoded');
  });

  test('isAvailable: true while the portal still publishes the object, false when it is gone or closed', async () => {
    const adapter = createZigAdapter(woonnetHaaglanden);
    const [first] = await searchFixture(adapter, 'zig-woonnet-haaglanden/getallobjects.json');
    const listing = asListing(first!);
    const up = fixtureContext({ routes: { getobject: 'zig-woonnet-haaglanden/getobject.json' }, now: NOW });
    expect(await adapter.isAvailable!(listing, up)).toBe(true);
    const gone = fixtureContext({ routes: [{ match: 'getobject', body: { sAngularServiceData: '[]', result: null } }], now: NOW });
    expect(await adapter.isAvailable!(listing, gone)).toBe(false);
    const closed = fixtureContext({ routes: { getobject: 'zig-woonnet-haaglanden/getobject.json' }, now: new Date('2026-09-25T00:00:00Z') });
    expect(await adapter.isAvailable!(listing, closed)).toBe(false);
    const garbled = fixtureContext({ routes: [{ match: 'getobject', body: { sAngularServiceData: '[]' } }], now: NOW });
    await expect(adapter.isAvailable!(listing, garbled)).rejects.toThrow(/without a result/);
  });

  test('a changed endpoint fails loudly instead of reporting zero listings', async () => {
    const adapter = createZigAdapter(plaza);
    const ctx = fixtureContext({ routes: [{ match: 'getallobjects', body: { sAngularServiceData: '[]' } }], now: NOW });
    const [req] = adapter.buildSearches(ctx.searches, ctx.source);
    await expect(adapter.search(req!, ctx)).rejects.toThrow(/without a result list/);
  });
});

describe('portal helpers', () => {
  test('placePasses rules out only places known to be another municipality', () => {
    const known = new Set(['rotterdam', 'vlaardingen']);
    const aliases = { hoogvliet: 'rotterdam' };
    expect(placePasses('Vlaardingen', ['rotterdam'], known, aliases)).toBe(false);
    expect(placePasses('Hoogvliet', ['rotterdam'], known, aliases)).toBe(true);
    expect(placePasses('Rozenburg', ['rotterdam'], known, aliases)).toBe(true);
    expect(placePasses('Vlaardingen', undefined, known, aliases)).toBe(true);
  });

  test('Amsterdam wall-clock times become UTC, across the summer time change', () => {
    expect(amsterdamLocalToIso('2026-09-17 12:28:00')).toBe('2026-09-17T10:28:00.000Z');
    expect(amsterdamLocalToIso('2026-11-02 12:00:00')).toBe('2026-11-02T11:00:00.000Z');
    expect(amsterdamLocalToIso('0000-00-00 00:00:00')).toBeUndefined();
  });

  test('htmlToText keeps paragraphs and drops markup', () => {
    expect(htmlToText('<p>Eerste regel.</p><p>Tweede&nbsp;regel<br>derde</p>')).toBe('Eerste regel.\nTweede regel\nderde');
    expect(htmlToText('')).toBeUndefined();
  });
});

describe('Zig models and labels', () => {
  const obj = (model: ZigObject['model']): ZigObject => ({ model });
  test('first come, first served models', () => {
    expect(zigModel(obj({ modelCategorie: { code: 'reactiedatum' } }))).toEqual({ model: 'reactiedatum', code: 'reactiedatum', firstComeFirstServed: true });
    expect(zigModel(obj({ modelCategorie: { code: null }, advertentieSluitenNaEersteReactie: true }))).toEqual({
      model: 'eerste-reactie',
      firstComeFirstServed: true,
    });
    expect(zigModel(obj({ modelCategorie: { code: 'inschrijfduur' } })).firstComeFirstServed).toBe(false);
    expect(zigModel(obj({ modelCategorie: { code: 'random' } })).model).toBe('loting');
    expect(zigModel(obj(null)).model).toBe('unknown');
  });

  test('energy label icons', () => {
    expect(zigEnergyLabel('icon_label_a_plus_plus')).toBe('A++');
    expect(zigEnergyLabel('icon_label_c')).toBe('C');
    expect(zigEnergyLabel('')).toBeUndefined();
  });
});

describe('portalAdapters', () => {
  test('returns every portal and agency once, with the ids the router expects', () => {
    const adapters = portalAdapters();
    const ids = adapters.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(['roommatch', 'woonnet-haaglanden', 'plaza', 'holland-rijnland', 'woonnet-rijnmond']));
    const agencies = ids.filter((id) => id.startsWith('ogonline:'));
    expect(agencies.length).toBeGreaterThanOrEqual(15);
    expect(agencies.length).toBeLessThanOrEqual(40);
  });

  test('the registry enables portals and agencies only for searches in their municipalities', () => {
    const registry = createRegistry(portalAdapters());
    const delft = ConfigSchema.parse({ searches: [{ id: 'd', name: 'Delft', regions: [{ name: 'Delft', municipalities: ['Delft'] }] }] });
    const ids = registry.enabled(delft).map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining(['roommatch', 'woonnet-haaglanden', 'plaza', 'ogonline:verra', 'ogonline:bjornd']));
    expect(ids).not.toContain('holland-rijnland');
    expect(ids).not.toContain('woonnet-rijnmond');
    expect(ids).not.toContain('ogonline:perfect-rent');
    expect(ids).not.toContain('ogonline:amsterdam-housing');
  });
});
