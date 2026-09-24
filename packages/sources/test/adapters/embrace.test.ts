import { describe, expect, test } from 'vitest';
import { ConfigSchema, type Listing, type RawListing } from '@nlpf/core';
import {
  EMBRACE_GATEWAY,
  createEmbraceAdapter,
  embraceLocation,
  embraceModel,
  relayKey,
} from '../../src/generic/embrace.js';
import { woonnetRijnmond } from '../../src/instances/woonnet-rijnmond.js';
import { makeResult } from '../../src/runtime/fetch.js';
import { fixtureContext, readFixture, type FixtureContext } from '../../src/testing.js';

const NOW = new Date('2026-09-24T08:00:00Z');
const PAGE_1 = readFixture('embrace-woonnet-rijnmond/publications-page-1.json');
const PAGE_2 = readFixture('embrace-woonnet-rijnmond/publications-page-2.json');

/** A context whose gateway answers page 1, or page 2 when the request asks for the page after page 1. */
function gatewayContext(opts: { now?: Date; config?: Record<string, unknown>; answer?: (body: Record<string, unknown>) => string } = {}): FixtureContext {
  const ctx = fixtureContext({ sourceId: 'woonnet-rijnmond', routes: [], now: opts.now ?? NOW, config: opts.config });
  ctx.fetch = async (url, init = {}) => {
    const body = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
    ctx.requests.push({
      url,
      method: (init.method ?? 'GET').toUpperCase(),
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      body: String(init.body ?? ''),
    });
    const vars = body.variables as { after?: string } | undefined;
    const text = opts.answer ? opts.answer(body) : vars?.after ? PAGE_2 : PAGE_1;
    return makeResult({ status: 200, url, headers: new Headers({ 'content-type': 'application/json' }), text, notModified: false });
  };
  return ctx;
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

describe('Embrace portal adapter (Woonnet Rijnmond)', () => {
  const adapter = createEmbraceAdapter(woonnetRijnmond);

  test('capabilities: portal reaction behind a login, terms unknown, no paid plan', () => {
    expect(adapter.id).toBe('woonnet-rijnmond');
    expect(adapter.capabilities).toEqual({ search: 'json', detail: false, contact: 'form', login: 'required', terms: 'unknown' });
    expect(adapter.capabilities.paid).toBeUndefined();
    expect(adapter.loginUrl).toBe('https://www.woonnetrijnmond.nl/nl-NL');
    expect(adapter.regions).toContain('rotterdam');
  });

  test('search reads every page and maps publications; clusters and garages are skipped', async () => {
    const ctx = gatewayContext();
    const [req] = adapter.buildSearches(ctx.searches, ctx.source);
    const listings = await adapter.search(req!, ctx);
    expect(listings.map((l) => l.title)).toEqual([
      'Kamperfoeliestraat 16B',
      'Zernikeplaats 908',
      'Stadhouderslaan 119',
      'Sluiskreek 830',
      'Alverstraat 307',
      'Parsifal 86',
    ]);
    expect(listings[0]).toMatchObject({
      sourceId: 'woonnet-rijnmond',
      externalId: '100123313',
      url: 'https://www.woonnetrijnmond.nl/nl-NL/aanbod/advertentie/Rotterdam-Kamperfoeliestraat-16B-SG91c2luZ1B1YmxpY2F0aW9uOjEwMDEyMzMxMw==',
      priceEur: 932.93,
      priceBasis: 'excl',
      serviceCostsEur: 10.8,
      sizeM2: 69,
      bedrooms: 3,
      type: 'apartment',
      address: { street: 'Kamperfoeliestraat', houseNumber: '16', addition: 'B', postcode: '3073 EJ', city: 'Rotterdam' },
      energyLabel: 'A',
      publishedAt: '2026-09-23T18:00:00.000Z',
      contact: 'form',
      language: 'nl',
      extra: {
        platform: 'embrace',
        publicationId: 'SG91c2luZ1B1YmxpY2F0aW9uOjEwMDEyMzMxMw==',
        model: 'inschrijfduur',
        applicationMethod: 'REGISTRATION',
        firstComeFirstServed: false,
        closingAt: '2026-09-26T18:00:00.000Z',
      },
    });
    expect(listings[0]?.description).toContain('Bloemhof');
    expect(listings[0]?.description).not.toContain('<p>');
    expect(listings[3]?.extra).toMatchObject({ model: 'loting', modelName: 'WoningLoting' });
    // External offers take reactions on the corporation's own site.
    expect(listings[4]).toMatchObject({
      contact: 'none',
      contactUrl: 'https://huuraanbod.hefwonen.nl/huuraanbod/alverstraat-307',
      address: { city: 'Hoogvliet', postcode: '3192 TN' },
      extra: { model: 'extern', applicationMethod: 'EXTERNAL' },
    });

    expect(ctx.requests).toHaveLength(2);
    const [first, second] = ctx.requests;
    expect(first).toMatchObject({ method: 'POST', url: EMBRACE_GATEWAY });
    expect(first?.headers['x-ec-tenant-id']).toBe('woonnetrijnmond');
    expect(first?.headers['x-ec-portal-id']).toBe(woonnetRijnmond.portalId);
    const body = JSON.parse(first?.body ?? '{}') as { operationName: string; variables: Record<string, unknown> };
    expect(body.operationName).toBe('widgetListGetPublications');
    expect(body.variables).toMatchObject({ first: 100, locale: 'nl-NL', orderBy: 'STARTDATE_ASC' });
    expect(JSON.parse(second?.body ?? '{}').variables.after).toBe('SG91c2luZ1B1YmxpY2F0aW9uOjQ=');
  });

  test('buildSearches: one request per poll that carries the filters; places map to their municipality', async () => {
    const config = ConfigSchema.parse({
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
    });
    const reqs = adapter.buildSearches(config.searches, { enabled: true, searchUrls: [], options: {} });
    expect(reqs).toEqual([
      {
        key: 'all',
        label: 'Woonnet Rijnmond: current offer',
        url: EMBRACE_GATEWAY,
        params: { municipalities: 'delft,den haag,rotterdam', maxRentEur: 1400 },
      },
    ]);
    const listings = await adapter.search(reqs[0]!, gatewayContext());
    // Vlaardingen and Capelle aan den IJssel are other municipalities; Hoogvliet is part of Rotterdam.
    expect(listings.map((l) => l.title)).toEqual(['Kamperfoeliestraat 16B', 'Zernikeplaats 908', 'Sluiskreek 830', 'Alverstraat 307']);

    const cheap = await adapter.search({ ...reqs[0]!, params: { maxRentEur: 800 } }, gatewayContext());
    expect(cheap.map((l) => l.title)).toEqual(['Zernikeplaats 908', 'Parsifal 86']);
  });

  test('closed publications are skipped', async () => {
    const ctx = gatewayContext({ now: new Date('2026-09-25T00:00:00Z') });
    const [req] = adapter.buildSearches(ctx.searches, ctx.source);
    const titles = (await adapter.search(req!, ctx)).map((l) => l.title);
    expect(titles).not.toContain('Sluiskreek 830');
    expect(titles).toContain('Kamperfoeliestraat 16B');
  });

  test('isAvailable asks the gateway for the publication', async () => {
    const details = readFixture('embrace-woonnet-rijnmond/application-details.json');
    const listing = asListing({
      sourceId: 'woonnet-rijnmond',
      externalId: '100123303',
      url: 'https://www.woonnetrijnmond.nl/nl-NL/aanbod/advertentie/Rotterdam-Beeningerstraat-50D-SG91c2luZ1B1YmxpY2F0aW9uOjEwMDEyMzMwMw==',
      title: 'Beeningerstraat 50D',
      address: { city: 'Rotterdam' },
      contact: 'form',
      extra: { publicationId: 'SG91c2luZ1B1YmxpY2F0aW9uOjEwMDEyMzMwMw==' },
    });
    const up = gatewayContext({ answer: () => details });
    expect(await adapter.isAvailable!(listing, up)).toBe(true);
    const body = JSON.parse(up.requests[0]?.body ?? '{}');
    expect(body.operationName).toBe('widgetReactionGetApplicationDetails');
    expect(body.variables.publicationId).toBe('SG91c2luZ1B1YmxpY2F0aW9uOjEwMDEyMzMwMw==');

    const closed = gatewayContext({ answer: () => details, now: new Date('2026-09-29T00:00:00Z') });
    expect(await adapter.isAvailable!(listing, closed)).toBe(false);
    const gone = gatewayContext({ answer: () => JSON.stringify({ data: { applicationDetails: { nodes: { edges: [] } } } }) });
    expect(await adapter.isAvailable!(listing, gone)).toBe(false);
  });

  test('GraphQL errors fail the poll instead of reporting zero listings', async () => {
    const ctx = gatewayContext({ answer: () => JSON.stringify({ errors: [{ message: 'Cannot query field "foo"' }] }) });
    const [req] = adapter.buildSearches(ctx.searches, ctx.source);
    await expect(adapter.search(req!, ctx)).rejects.toThrow(/Cannot query field/);
  });
});

describe('Embrace ids and models', () => {
  test('relay ids and location ids decode', () => {
    expect(relayKey('SG91c2luZ1B1YmxpY2F0aW9uOjEwMDEyMzMxMw==')).toBe('100123313');
    expect(relayKey('not base64 at all')).toBeUndefined();
    expect(embraceLocation('SG91c2luZ0xvY2F0aW9uOjMwNzNFSjsxNjtCOw==')).toEqual({ postcode: '3073 EJ', houseNumber: '16', addition: 'B' });
  });

  test('allocation models', () => {
    expect(embraceModel('Inschrijfduur')).toEqual({ model: 'inschrijfduur', firstComeFirstServed: false });
    expect(embraceModel('WoningLoting').model).toBe('loting');
    expect(embraceModel('DirectKans')).toEqual({ model: 'directkans', firstComeFirstServed: false });
    expect(embraceModel('Wens&Wacht').model).toBe('wens-en-wacht');
    expect(embraceModel('Overig aanbod').model).toBe('overig-aanbod');
  });
});
