import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { ConfigSchema, SourceConfigSchema, memoryLogger, type Listing, type OutboundMessage } from '@nlpf/core';
import { createInterhouseAdapter, INTERHOUSE_AJAX } from '../../src/adapters/interhouse.js';
import { NeedsLoginError, createBrowserPool, createPoliteFetch, createSourceContext, resolveChromium, type BrowserPool } from '../../src/index.js';
import { fixtureContext, startFixtureServer, type FixtureServer } from '../../src/testing.js';

const NOW = new Date('2026-09-24T10:30:00Z');
const config = ConfigSchema.parse({
  searches: [
    { id: 'main', name: 'Main', priceMaxEur: 1400, regions: [{ name: 'Randstad', municipalities: ['Delft', 'Rotterdam', 'Den Haag'] }] },
  ],
});

describe('interhouse', () => {
  const adapter = createInterhouseAdapter();

  test('is a regional agent with a viewing form that needs no login', () => {
    expect(adapter.id).toBe('interhouse');
    expect(adapter.capabilities).toEqual({ search: 'html', detail: true, contact: 'form', login: 'none', terms: 'unknown' });
    expect(adapter.regions).toEqual(expect.arrayContaining(['delft', 'rotterdam', 'den haag', 'amsterdam', 'utrecht']));
    expect(adapter.contact).toBeTypeOf('function');
  });

  test('buildSearches sends the city, the next price step and newest-first sorting to the results action', () => {
    const reqs = adapter.buildSearches(config.searches, SourceConfigSchema.parse({}));
    expect(reqs.map((r) => r.key)).toEqual(['delft', 'rotterdam', 'den-haag']);
    for (const r of reqs) expect(r.url).toBe(INTERHOUSE_AJAX);
    const query = new URLSearchParams(String(reqs[1]?.params?.query).replace(/^\?/, ''));
    expect(Object.fromEntries(query)).toMatchObject({
      offer: 'huur',
      search_terms: 'Rotterdam',
      search_type: 'city',
      search_city: 'Rotterdam',
      maximum_price: '1500',
      sort: 'date-desc',
      number_of_results: '18',
      paging: '1',
    });
  });

  test('search posts the query and maps the Rotterdam results, skipping rented and commercial property', async () => {
    const ctx = fixtureContext({
      sourceId: 'interhouse',
      config,
      now: NOW,
      routes: [{ match: 'admin-ajax.php', method: 'POST', file: 'interhouse/results-rotterdam.html', headers: { 'content-type': 'text/html' } }],
    });
    const req = adapter.buildSearches(ctx.searches, ctx.source).find((r) => r.key === 'rotterdam');
    const listings = await adapter.search(req!, ctx);
    const body = new URLSearchParams(ctx.requests[0]?.body);
    expect(ctx.requests[0]?.method).toBe('POST');
    expect(body.get('action')).toBe('building_results_action');
    expect(body.get('query')).toContain('search_city=Rotterdam');
    // Five results: one commercial unit, one "Verhuurd o.v." and one "Verhuurd".
    expect(listings.map((l) => l.address.street)).toEqual(['Vondelweg', 'Kruisplein']);
  });

  test('search maps the recorded national results', async () => {
    const ctx = fixtureContext({
      sourceId: 'interhouse',
      now: NOW,
      routes: [{ match: 'admin-ajax.php', method: 'POST', file: 'interhouse/results.html', headers: { 'content-type': 'text/html' } }],
    });
    const [req] = adapter.buildSearches(ConfigSchema.parse({}).searches, SourceConfigSchema.parse({}));
    const listings = await adapter.search(req!, ctx);
    expect(listings).toHaveLength(18);
    expect(listings[0]).toMatchObject({
      sourceId: 'interhouse',
      externalId: '/vastgoed/huur/hollandsche-rading/woning/dennenlaan',
      url: 'https://interhouse.nl/vastgoed/huur/hollandsche-rading/woning/dennenlaan/',
      title: 'Dennenlaan, Hollandsche Rading',
      priceEur: 2250,
      priceBasis: 'excl',
      sizeM2: 115,
      bedrooms: 3,
      type: 'house',
      furnishing: 'upholstered',
      availableFrom: '2026-11-01',
      address: { street: 'Dennenlaan', city: 'Hollandsche Rading' },
      contact: 'form',
      contactUrl: 'https://interhouse.nl/vastgoed/huur/hollandsche-rading/woning/dennenlaan/',
      agent: { name: 'Interhouse', url: 'https://interhouse.nl' },
    });
    expect(listings[0]?.images?.[0]).toBe('https://interhouse.nl/wp-content/uploads/2026/09/1012954-15385296.jpeg');
    expect(listings[1]).toMatchObject({ type: 'apartment', furnishing: 'furnished', availableFrom: '2026-09-28' });
    expect(listings[2]?.address).toEqual({ street: 'Grote Houtstraat', houseNumber: '9', addition: 'J', city: 'Haarlem' });
    expect(listings[6]?.availableFrom).toBe('2026-09-24');
    expect(listings[16]?.address).toEqual({ street: 'Neuweg', houseNumber: '11', addition: 'B', city: 'Hilversum' });
  });

  test('detail reads the full address, deposit and branch email from the listing page', async () => {
    const list = fixtureContext({
      sourceId: 'interhouse',
      now: NOW,
      routes: [{ match: 'admin-ajax.php', method: 'POST', file: 'interhouse/results.html', headers: { 'content-type': 'text/html' } }],
    });
    const [card] = await adapter.search(adapter.buildSearches(ConfigSchema.parse({}).searches, SourceConfigSchema.parse({}))[0]!, list);
    const ctx = fixtureContext({ sourceId: 'interhouse', now: NOW, routes: { '/woning/dennenlaan/': 'interhouse/detail-dennenlaan.html' } });
    const full = await adapter.detail!(card!, ctx);
    expect(full).toMatchObject({
      address: { street: 'Dennenlaan', houseNumber: '41', postcode: '3739 KM', city: 'Hollandsche Rading' },
      depositEur: 4400,
      rooms: 4,
      energyLabel: 'D',
      agent: { name: 'Interhouse', url: 'https://interhouse.nl', email: 'hilversum.vh@interhouse.nl' },
    });
    // "HLV-6442" in the page data is the office reference, not a house number addition.
    expect(full.address.addition).toBeUndefined();
    expect(full.description).toMatch(/^Op één van de mooiste plekken van Hollandsche Rading/);
  });

  test('contact without a phone number stops before opening the form, which requires one', async () => {
    // This context has no browser: opening the form would throw.
    const ctx = fixtureContext({ sourceId: 'interhouse', config, routes: [] });
    const listing = { url: 'https://interhouse.nl/vastgoed/huur/x/woning/y/', contactUrl: 'https://interhouse.nl/vastgoed/huur/x/woning/y/' } as Listing;
    const result = await adapter.contact!(listing, { body: 'Hallo', language: 'nl', profile: config.profile, dryRun: true }, ctx);
    expect(result).toMatchObject({ ok: false, channel: 'form' });
    expect(result.error).toMatch(/phone/);
  });
});

describe.skipIf(!resolveChromium())('interhouse contact form in a real browser against a local copy', () => {
  const PATH = '/vastgoed/huur/hollandsche-rading/woning/dennenlaan/';
  let server: FixtureServer;
  let pool: BrowserPool;
  let dir: string;
  let confirm = true;

  const profile = ConfigSchema.parse({
    profile: { firstName: 'Sam', lastName: 'de Vries', email: 'sam@nlpf.test', phone: '0612345678' },
  }).profile;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'nlpf-interhouse-'));
    pool = createBrowserPool({ dir, log: memoryLogger() });
    server = await startFixtureServer({
      [PATH]: 'interhouse/contact-form.html',
      // Gravity Forms answers with its confirmation block; the text here is made up.
      [`POST ${PATH}`]: () =>
        confirm
          ? {
              body: "<!doctype html><title>Dennenlaan</title><div id='gform_confirmation_wrapper_12' class='gform_confirmation_wrapper'><div id='gform_confirmation_message_12' class='gform_confirmation_message_12 gform_confirmation_message'>Bedankt voor je aanvraag, we nemen zo snel mogelijk contact met je op.</div></div>",
              headers: { 'content-type': 'text/html; charset=utf-8' },
            }
          : { body: '<!doctype html><title>Dennenlaan</title><p>Er ging iets mis.</p>', headers: { 'content-type': 'text/html; charset=utf-8' } },
      '/old-listing/': { status: 302, headers: { location: '/inloggen/' } },
      '/inloggen/': { body: '<!doctype html><title>Inloggen</title><form></form>', headers: { 'content-type': 'text/html' } },
    });
  }, 60_000);

  afterAll(async () => {
    await pool.closeAll();
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function setup() {
    const adapter = createInterhouseAdapter({ confirmTimeoutMs: 3_000 });
    const ctx = createSourceContext({
      fetch: createPoliteFetch({ minGapMs: 0, log: memoryLogger() }),
      pool,
      log: memoryLogger(),
      config: ConfigSchema.parse({ profile }),
      sourceId: adapter.id,
      signal: new AbortController().signal,
    });
    const url = `${server.url}${PATH}`;
    const listing: Listing = {
      id: 'interhouse:dennenlaan',
      sourceId: 'interhouse',
      externalId: '/vastgoed/huur/hollandsche-rading/woning/dennenlaan',
      url,
      contactUrl: url,
      title: 'Dennenlaan, Hollandsche Rading',
      address: { street: 'Dennenlaan', city: 'Hollandsche Rading' },
      contact: 'form',
      propertyId: null,
      firstSeenAt: '2026-09-24T10:00:00Z',
      lastSeenAt: '2026-09-24T10:00:00Z',
      state: 'active',
      via: 'poll',
    };
    const message = (dryRun: boolean): OutboundMessage => ({
      body: 'Goedemiddag, ik wil graag de woning aan de Dennenlaan bezichtigen.',
      language: 'nl',
      profile,
      dryRun,
    });
    return { adapter, ctx, listing, message };
  }

  const posts = () => server.requests.filter((r) => r.method === 'POST');

  test('a dry run fills the form and sends nothing', async () => {
    const { adapter, ctx, listing, message } = setup();
    const before = posts().length;
    const result = await adapter.contact!(listing, message(true), ctx);
    expect(result).toEqual({ ok: true, channel: 'form', evidence: 'dry run: the form was filled and not sent' });
    expect(posts().length).toBe(before);
  }, 60_000);

  test('sends name, email, phone and message, leaves the honeypot empty and reads the confirmation', async () => {
    confirm = true;
    const { adapter, ctx, listing, message } = setup();
    const result = await adapter.contact!(listing, message(false), ctx);
    expect(result).toMatchObject({ ok: true, channel: 'form' });
    expect(result.evidence).toContain('Bedankt voor je aanvraag');
    const fields = new URLSearchParams(posts().at(-1)?.body);
    expect(fields.get('input_3')).toBe('Sam');
    expect(fields.get('input_14')).toBe('de Vries');
    expect(fields.get('input_4')).toBe('sam@nlpf.test');
    expect(fields.get('input_5')).toBe('0612345678');
    expect(fields.get('input_1')).toContain('Dennenlaan bezichtigen');
    expect(fields.get('input_30')).toBe('');
    // The listing fields the site fills in itself go along unchanged.
    expect(fields.get('input_17')).toBe('41');
  }, 60_000);

  test('no confirmation after sending asks a person to check instead of retrying', async () => {
    confirm = false;
    const { adapter, ctx, listing, message } = setup();
    const result = await adapter.contact!(listing, message(false), ctx);
    expect(result).toMatchObject({ ok: false, channel: 'form', needs: 'human' });
  }, 60_000);

  test('a redirect to a login page throws NeedsLoginError', async () => {
    const { adapter, ctx, listing, message } = setup();
    const moved = { ...listing, url: `${server.url}/old-listing/`, contactUrl: `${server.url}/old-listing/` };
    await expect(adapter.contact!(moved, message(true), ctx)).rejects.toBeInstanceOf(NeedsLoginError);
  }, 60_000);
});
