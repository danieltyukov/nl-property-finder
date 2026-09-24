import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { ConfigSchema, type RawListing, type SourceAdapter } from '@nlpf/core';
import {
  AgencyDefError,
  createAgencyAdapter,
  loadAgencyAdapters,
  parseAgencyDef,
  parseAgencyYaml,
} from '../src/index.js';
import { fixtureContext, readFixture } from '../src/testing.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const TEMPLATE = 'examples/agencies/_template.yaml';
const LIST_URL = 'https://www.example-makelaar.nl/aanbod/woningaanbod/huur/';

function templateAdapter(): SourceAdapter {
  const [adapter] = loadAgencyAdapters([TEMPLATE], repoRoot);
  if (!adapter) throw new Error('template did not load');
  return adapter;
}

async function searchTemplate(): Promise<RawListing[]> {
  const adapter = templateAdapter();
  const ctx = fixtureContext({ sourceId: adapter.id, routes: { [LIST_URL]: 'agency-example/list.html' } });
  const [req] = adapter.buildSearches(ctx.searches, ctx.source);
  return adapter.search(req!, ctx);
}

describe('the template agency', () => {
  test('describes itself as an agency source', () => {
    const adapter = templateAdapter();
    expect(adapter.id).toBe('agency:example-makelaar');
    expect(adapter.name).toBe('Example Makelaardij');
    expect(adapter.regions).toEqual(['delft', 'rijswijk']);
    expect(adapter.capabilities).toEqual({ search: 'html', detail: true, contact: 'form', login: 'none', terms: 'unknown' });
    expect(adapter.defaultIntervalSec).toBe(300);
  });

  test('buildSearches polls the list page plus any imported search URLs', () => {
    const adapter = templateAdapter();
    const config = ConfigSchema.parse({ sources: { 'agency:example-makelaar': { searchUrls: ['https://www.example-makelaar.nl/aanbod/?plaats=delft'] } } });
    const reqs = adapter.buildSearches(config.searches, config.sources['agency:example-makelaar']!);
    expect(reqs[0]).toEqual({ key: 'list', label: 'Example Makelaardij', url: LIST_URL });
    expect(reqs[1]?.url).toBe('https://www.example-makelaar.nl/aanbod/?plaats=delft');
    expect(reqs[1]?.key).toMatch(/^url-[0-9a-f]{10}$/);
  });

  test('search returns listings with absolute URLs, parsed price and size, and skips rented cards', async () => {
    const listings = await searchTemplate();
    expect(listings.map((l) => l.url)).toEqual([
      'https://www.example-makelaar.nl/aanbod/woningaanbod/delft/huur/appartement-101-voorbeeldstraat-12-a/',
      'https://www.example-makelaar.nl/aanbod/woningaanbod/rijswijk/huur/studio-102-proefweg-7/',
      'https://www.example-makelaar.nl/aanbod/woningaanbod/delft/huur/kamer-105-schetsstraat-2-bis/',
    ]);
    const [first, studio, room] = listings;
    expect(first).toMatchObject({
      sourceId: 'agency:example-makelaar',
      externalId: '/aanbod/woningaanbod/delft/huur/appartement-101-voorbeeldstraat-12-a',
      title: 'Voorbeeldstraat 12-A',
      priceEur: 1250,
      priceBasis: 'excl',
      sizeM2: 62,
      type: 'apartment',
      furnishing: 'upholstered',
      address: { street: 'Voorbeeldstraat', houseNumber: '12', addition: 'A', city: 'Delft' },
      contact: 'form',
      contactUrl: 'https://www.example-makelaar.nl/aanbod/woningaanbod/delft/huur/appartement-101-voorbeeldstraat-12-a/#contact',
      agent: { name: 'Example Makelaardij', url: 'https://www.example-makelaar.nl', email: 'info@example-makelaar.nl' },
      language: 'nl',
    });
    expect(studio).toMatchObject({ priceEur: 975, priceBasis: 'incl', sizeM2: 28, type: 'studio', furnishing: 'furnished', address: { city: 'Rijswijk' } });
    expect(room?.priceEur).toBeUndefined();
    expect(room).toMatchObject({ sizeM2: 14, type: 'room', address: { street: 'Schetsstraat', houseNumber: '2', addition: 'bis' } });
  });

  test('detail adds the description, absolute images and the availability date', async () => {
    const adapter = templateAdapter();
    const [first] = await searchTemplate();
    const ctx = fixtureContext({ sourceId: adapter.id, routes: { 'appartement-101': 'agency-example/detail.html' } });
    const full = await adapter.detail!(first!, ctx);
    expect(full.description).toContain('Licht en gestoffeerd appartement');
    expect(full.description).toContain('\n');
    expect(full.images).toEqual([
      'https://www.example-makelaar.nl/media/101/1.jpg',
      'https://www.example-makelaar.nl/media/101/2.jpg',
      'https://cdn.example-makelaar.nl/media/101/3.jpg',
    ]);
    expect(full.availableFrom).toBe('2026-11-01');
    expect(full.priceEur).toBe(1250);
    // The configured address stays; a mailto on the page only fills a missing one.
    expect(full.agent?.email).toBe('info@example-makelaar.nl');
  });

  test('isAvailable is false once the listing page is gone', async () => {
    const adapter = templateAdapter();
    const [first] = await searchTemplate();
    const listing = { ...first!, id: 'x', propertyId: null, firstSeenAt: '', lastSeenAt: '', state: 'active' as const, via: 'poll' as const };
    const up = fixtureContext({ routes: { 'appartement-101': 'agency-example/detail.html' } });
    expect(await adapter.isAvailable!(listing, up)).toBe(true);
    const gone = fixtureContext({ routes: [{ match: 'appartement-101', status: 404 }] });
    expect(await adapter.isAvailable!(listing, gone)).toBe(false);
  });
});

describe('presets', () => {
  test('realworks: only a homepage is needed; follows the next-page link', async () => {
    const adapter = createAgencyAdapter(
      parseAgencyDef({ id: 'voorbeeld', name: 'Voorbeeld Makelaars', homepage: 'https://www.voorbeeld-makelaars.test/', preset: 'realworks' }),
    );
    const ctx = fixtureContext({
      sourceId: adapter.id,
      routes: {
        '/aanbod/woningaanbod/huur/pagina-2/': 'agency-realworks/list-page-2.html',
        '/aanbod/woningaanbod/huur/': 'agency-realworks/list.html',
      },
    });
    const [req] = adapter.buildSearches(ctx.searches, ctx.source);
    expect(req?.url).toBe('https://www.voorbeeld-makelaars.test/aanbod/woningaanbod/huur/');
    const listings = await adapter.search(req!, ctx);
    expect(ctx.requests.map((r) => r.url)).toEqual([
      'https://www.voorbeeld-makelaars.test/aanbod/woningaanbod/huur/',
      'https://www.voorbeeld-makelaars.test/aanbod/woningaanbod/huur/pagina-2/',
    ]);
    expect(listings.map((l) => l.address.street)).toEqual(['Proefgracht', 'Schetslaan', 'Toetsstraat']);
    expect(listings[0]).toMatchObject({
      url: 'https://www.voorbeeld-makelaars.test/aanbod/woningaanbod/delft/huur/appartement-20000001-Proefgracht-8-B/',
      title: 'Proefgracht 8 B',
      priceEur: 1395,
      sizeM2: 71,
      rooms: 3,
      type: 'apartment',
      address: { street: 'Proefgracht', houseNumber: '8', addition: 'B', postcode: '2611 ZZ', city: 'Delft' },
      images: ['https://images.realworks.nl/servlets/images/media.objectmedia/1001.webp?height=280&width=420'],
    });
    expect(listings[1]).toMatchObject({ priceEur: 925, priceBasis: 'incl', type: 'studio' });
    expect(listings[2]?.address).toMatchObject({ houseNumber: '40', addition: '2' });
    expect(adapter.capabilities.contact).toBe('form');
  });

  test('ogonline: reads the realtime-listings JSON and keeps available rentals only', async () => {
    const adapter = createAgencyAdapter(
      parseAgencyDef({ id: 'og', name: 'OG Voorbeeld', homepage: 'https://www.example-ogonline.test', preset: 'ogonline', regions: ['Delft'] }),
    );
    expect(adapter.capabilities.search).toBe('json');
    expect(adapter.regions).toEqual(['delft']);
    const ctx = fixtureContext({ sourceId: adapter.id, routes: { '/nl/realtime-listings/consumer': 'agency-ogonline/listings.json' } });
    const [req] = adapter.buildSearches(ctx.searches, ctx.source);
    expect(req?.url).toBe('https://www.example-ogonline.test/nl/realtime-listings/consumer');
    const listings = await adapter.search(req!, ctx);
    expect(listings.map((l) => l.title)).toEqual(['Proefweg 9 A', 'Schetsplein 2']);
    expect(listings[0]).toMatchObject({
      url: 'https://www.example-ogonline.test/nl/aanbod/woning/delft/proefweg-9-a/',
      externalId: '/nl/aanbod/woning/delft/proefweg-9-a',
      priceEur: 1275,
      sizeM2: 64,
      rooms: 3,
      bedrooms: 2,
      type: 'apartment',
      address: { street: 'Proefweg', houseNumber: '9', addition: 'A', postcode: '2611 ZY', city: 'Delft', lat: 52.0101, lon: 4.3571 },
      publishedAt: new Date(1790150400 * 1000).toISOString(),
      images: ['https://images.example-ogonline.test/rw-api-sha/1.jpg'],
    });
    expect(listings[1]).toMatchObject({ type: 'studio', furnishing: 'furnished', images: ['https://www.example-ogonline.test/media/2.jpg'] });
  });
});

describe('definitions', () => {
  test('parseAgencyYaml reads the same shape as the files', () => {
    const def = parseAgencyYaml(readFixture('_template.yaml', join(repoRoot, 'examples/agencies')));
    expect(def.id).toBe('example-makelaar');
    expect(def.list.fields.url).toEqual({ selector: 'a', attr: 'href' });
    expect(def.detail?.description).toEqual({ selector: '.object-description' });
  });

  test('mistakes are reported with their path', () => {
    const base = { id: 'x', name: 'X', homepage: 'https://x.test', list: { url: 'https://x.test/huur', item: '.card', fields: { url: 'a' } } };
    const issues = (input: unknown) => {
      try {
        parseAgencyDef(input);
        return [];
      } catch (e) {
        expect(e).toBeInstanceOf(AgencyDefError);
        return (e as AgencyDefError).issues;
      }
    };
    expect(issues(base)).toEqual([]);
    expect(issues({ ...base, list: { ...base.list, item: undefined } })).toContainEqual(expect.stringContaining('list.item'));
    expect(issues({ ...base, lsit: {} })).toContainEqual(expect.stringContaining('lsit'));
    expect(issues({ ...base, id: 'Has Spaces' })).toContainEqual(expect.stringContaining('id'));
    expect(issues({ ...base, preset: 'wordpress' })).toContainEqual(expect.stringContaining('preset'));
    expect(issues({ ...base, contact: { kind: 'form', form: { message: 'textarea' } } })).toContainEqual(expect.stringContaining('contact.form.submit'));
    expect(issues({ ...base, contact: { kind: 'email' } })).toContainEqual(expect.stringContaining('contact.email'));
    expect(issues({ ...base, list: { ...base.list, fields: { url: { selector: 'a', pattern: '([' } } } })).toContainEqual(
      expect.stringContaining('list.fields.url.pattern'),
    );
  });

  test('loadAgencyAdapters reports a broken file through onError and keeps the good ones', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nlpf-agencies-'));
    writeFileSync(join(dir, 'broken.yaml'), 'id: broken\nname: [unclosed\n');
    writeFileSync(join(dir, 'incomplete.yaml'), 'id: incomplete\nname: Incomplete\n');
    const errors: string[] = [];
    const adapters = loadAgencyAdapters(['broken.yaml', 'incomplete.yaml', join(repoRoot, TEMPLATE)], dir, {
      onError: (file, err) => errors.push(`${file}: ${err.message}`),
    });
    expect(adapters.map((a) => a.id)).toEqual(['agency:example-makelaar']);
    expect(errors).toHaveLength(2);
    expect(errors[1]).toContain('homepage');
    expect(() => loadAgencyAdapters(['incomplete.yaml'], dir)).toThrow(/incomplete\.yaml/);
    expect(() => loadAgencyAdapters([join(repoRoot, TEMPLATE), join(repoRoot, TEMPLATE)], dir)).toThrow(/duplicate/);
  });
});
