import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { ConfigSchema, SourceConfigSchema, memoryLogger } from '@nlpf/core';
import { createWoningnetDakAdapter, DAK_REGIONS, parseDakOffer } from '../../src/adapters/woningnet-dak.js';
import { createBrowserPool, createPoliteFetch, createSourceContext, resolveChromium, type BrowserPool } from '../../src/index.js';
import { readFixture, startFixtureServer, type FixtureServer } from '../../src/testing.js';
import { htmlAdapters } from '../../src/builtin/html.js';

const NOW = new Date('2026-09-24T10:30:00Z');
const OFFER = JSON.parse(readFixture('woningnet-dak/aanbod-amsterdam.json')) as unknown;

function searchFor(...municipalities: string[]) {
  return ConfigSchema.parse({
    searches: [{ id: 'main', name: 'Main', priceMaxEur: 1400, regions: [{ name: 'Area', municipalities }] }],
  }).searches;
}

describe('woningnet-dak', () => {
  const adapter = createWoningnetDakAdapter();

  test('is one of the built-in HTML sources', () => {
    expect(htmlAdapters().map((a) => a.id)).toContain('woningnet-dak');
  });

  test('is a regional portal read in a browser, with reactions on the portal', () => {
    expect(adapter.id).toBe('woningnet-dak');
    expect(adapter.capabilities).toMatchObject({ search: 'browser', contact: 'none', login: 'required', terms: 'unknown', browser: 'headless' });
    expect(adapter.regions).toEqual(expect.arrayContaining(['amsterdam', 'zaanstad', 'utrecht', 'almere', 'amersfoort', 'gouda', 'hilversum']));
    for (const r of adapter.regions as string[]) expect(r).toBe(r.toLowerCase());
  });

  test('buildSearches opens only the DAK regions that cover a searched municipality', () => {
    const none = adapter.buildSearches(searchFor('Delft', 'Rotterdam', 'Den Haag'), SourceConfigSchema.parse({}));
    expect(none).toEqual([]);
    const reqs = adapter.buildSearches(searchFor('Amsterdam', 'Zaanstad', 'Utrecht'), SourceConfigSchema.parse({}));
    expect(reqs.map((r) => r.url)).toEqual([
      'https://amsterdam.mijndak.nl/Woningaanbod',
      'https://utrecht.mijndak.nl/Woningaanbod',
      'https://studentenwoning.mijndak.nl/Woningaanbod',
    ]);
    expect(reqs.map((r) => r.params?.region)).toEqual(['amsterdam', 'utrecht', 'studentenwoning']);
  });

  test('buildSearches covers every region for a search without municipalities', () => {
    const reqs = adapter.buildSearches(ConfigSchema.parse({}).searches, SourceConfigSchema.parse({}));
    expect(reqs.map((r) => r.key).sort()).toEqual(Object.keys(DAK_REGIONS).sort());
  });

  test('parseDakOffer maps the recorded data action and skips parking places', () => {
    const listings = parseDakOffer(OFFER, 'amsterdam', 'https://amsterdam.mijndak.nl', NOW);
    expect(listings).toHaveLength(11);
    expect(listings.some((l) => l.externalId === '382407')).toBe(false);
    expect(listings[0]).toMatchObject({
      sourceId: 'woningnet-dak',
      externalId: '372004',
      url: 'https://amsterdam.mijndak.nl/HuisDetails?PublicatieId=372004',
      title: 'Kalf 470, Zaandam',
      priceEur: 713.02,
      priceBasis: 'excl',
      serviceCostsEur: 14.39,
      sizeM2: 67,
      rooms: 3,
      type: 'apartment',
      energyLabel: 'B',
      availableFrom: '2026-10-06',
      publishedAt: '2026-09-21T22:01:00Z',
      address: { street: 'Kalf', houseNumber: '470', postcode: '1509 BE', city: 'Zaandam', neighbourhood: 'Zaandam Noord' },
      agent: { name: 'Parteon' },
      contact: 'none',
      extra: {
        region: 'amsterdam',
        deadline: '2026-09-28T21:59:00Z',
        model: 'Aanbodmodel',
        sector: 'Sociale huur',
        label: 'Met situatiepunten',
        contract: 'Onbepaalde tijd contract',
        target: 'Gezin',
      },
    });
    expect(listings[0]?.address.lat).toBeCloseTo(52.4717, 3);
    const free = listings.find((l) => l.externalId === '377589');
    expect(free).toMatchObject({ address: { street: 'Orteliuskade', houseNumber: '108', addition: '3', postcode: '1056 NM' }, extra: { model: 'Vrije sector' } });
    const cluster = listings.find((l) => l.externalId === '382412');
    expect(cluster).toMatchObject({ title: 'De Tafelberg 18 t/m 22 jaar*', priceEur: 498.2, sizeM2: 22, rooms: 1, extra: { units: 5 } });
    // A complex with several units has no single house number.
    expect(cluster?.address.houseNumber).toBeUndefined();
    expect(cluster?.address).toMatchObject({ street: 'Tafelbergweg', postcode: '1105 BN', city: 'Amsterdam' });
  });

  test('parseDakOffer rejects a response that is not the offer list', () => {
    expect(() => parseDakOffer({ data: {} }, 'amsterdam', 'https://amsterdam.mijndak.nl', NOW)).toThrow(/PublicatieLijst/);
  });
});

describe.skipIf(!resolveChromium())('woningnet-dak in a real browser against a local copy', () => {
  let server: FixtureServer;
  let pool: BrowserPool;
  let dir: string;
  let posts = 0;

  // The page calls the data action like the OutSystems app does. The first
  // call of a fresh profile answers with an empty list, as the live site does
  // before it knows which region the visitor is in.
  const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Woningaanbod</title></head><body><p>Aanbod</p>
<script>
fetch('/screenservices/DAKWP/Overzicht/Woningaanbod/DataActionHaalUitgelogdAanbod', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ versionInfo: {}, viewName: 'Overzicht.Woningaanbod' })
}).then((r) => r.json()).then((d) => { document.body.dataset.count = String(d.data.PublicatieLijst.List.length); });
</script></body></html>`;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'nlpf-dak-'));
    pool = createBrowserPool({ dir, log: memoryLogger() });
    server = await startFixtureServer({
      '/Woningaanbod': { body: PAGE, headers: { 'content-type': 'text/html; charset=utf-8' } },
      'POST /screenservices/DAKWP/Overzicht/Woningaanbod/DataActionHaalUitgelogdAanbod': () => {
        posts += 1;
        return { file: posts === 1 ? 'woningnet-dak/aanbod-empty.json' : 'woningnet-dak/aanbod-amsterdam.json' };
      },
    });
  }, 60_000);

  afterAll(async () => {
    await pool.closeAll();
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('search reads the data action response and reloads once when the first answer is empty', async () => {
    const adapter = createWoningnetDakAdapter({ baseUrl: () => server.url, responseTimeoutMs: 15_000 });
    const ctx = createSourceContext({
      fetch: createPoliteFetch({ minGapMs: 0, log: memoryLogger() }),
      pool,
      log: memoryLogger(),
      config: ConfigSchema.parse({}),
      sourceId: adapter.id,
      signal: new AbortController().signal,
      now: () => NOW,
    });
    const listings = await adapter.search({ key: 'amsterdam', label: 'x', url: `${server.url}/Woningaanbod`, params: { region: 'amsterdam' } }, ctx);
    expect(posts).toBe(2);
    expect(listings).toHaveLength(11);
    expect(listings[0]?.url).toBe(`${server.url}/HuisDetails?PublicatieId=372004`);
  }, 60_000);
});
