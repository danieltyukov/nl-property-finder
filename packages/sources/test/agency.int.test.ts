import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { ConfigSchema, memoryLogger, type Listing, type OutboundMessage } from '@nlpf/core';
import {
  createAgencyAdapter,
  createBrowserPool,
  createPoliteFetch,
  createSourceContext,
  parseAgencyYaml,
  resolveChromium,
  type BrowserPool,
} from '../src/index.js';
import { readFixture, startFixtureServer, type FixtureServer } from '../src/testing.js';

const TEMPLATE = readFixture('_template.yaml', new URL('../../../examples/agencies/', import.meta.url).pathname);

const config = ConfigSchema.parse({
  profile: { firstName: 'Sam', lastName: 'de Vries', email: 'sam@nlpf.test', phone: '0612345678' },
});

describe.skipIf(!resolveChromium())('agency contact form in a real browser', () => {
  let server: FixtureServer;
  let pool: BrowserPool;
  let dir: string;
  let confirm = true;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'nlpf-agency-'));
    pool = createBrowserPool({ dir, log: memoryLogger() });
    server = await startFixtureServer({
      '/aanbod/woningaanbod/delft/huur/appartement-101-voorbeeldstraat-12-a/': 'agency-example/detail.html',
      'POST /contact': () =>
        confirm
          ? { body: '<!doctype html><title>Verzonden</title><p class="melding">Bedankt voor uw bericht, wij nemen snel contact op.</p>' }
          : { body: '<!doctype html><title>Contact</title><p>Er ging iets mis.</p>' },
    });
  });

  afterAll(async () => {
    await pool.closeAll();
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function setup() {
    // The template, pointed at the local server instead of the example domain.
    const def = parseAgencyYaml(TEMPLATE.replaceAll('https://www.example-makelaar.nl', server.url));
    const adapter = createAgencyAdapter(def);
    const ctx = createSourceContext({
      fetch: createPoliteFetch({ minGapMs: 0, log: memoryLogger() }),
      pool,
      log: memoryLogger(),
      config,
      sourceId: adapter.id,
      signal: new AbortController().signal,
    });
    const url = `${server.url}/aanbod/woningaanbod/delft/huur/appartement-101-voorbeeldstraat-12-a/`;
    const listing: Listing = {
      id: `${adapter.id}:x`,
      sourceId: adapter.id,
      externalId: '/aanbod/woningaanbod/delft/huur/appartement-101-voorbeeldstraat-12-a',
      url,
      contactUrl: `${url}#contact`,
      title: 'Voorbeeldstraat 12-A',
      address: { street: 'Voorbeeldstraat', houseNumber: '12', addition: 'A', city: 'Delft' },
      contact: 'form',
      propertyId: null,
      firstSeenAt: '2026-09-23T10:00:00Z',
      lastSeenAt: '2026-09-23T10:00:00Z',
      state: 'active',
      via: 'poll',
    };
    const message = (dryRun: boolean): OutboundMessage => ({
      body: 'Goedemiddag, ik heb interesse in Voorbeeldstraat 12-A en kom graag kijken.',
      language: 'nl',
      profile: config.profile,
      dryRun,
    });
    return { adapter, ctx, listing, message };
  }

  test('a dry run fills the form and sends nothing', async () => {
    const { adapter, ctx, listing, message } = setup();
    const before = server.requests.filter((r) => r.method === 'POST').length;
    const result = await adapter.contact!(listing, message(true), ctx);
    expect(result).toEqual({ ok: true, channel: 'form', evidence: 'dry run: the form was filled and not sent' });
    expect(server.requests.filter((r) => r.method === 'POST').length).toBe(before);
  });

  test('sends the form with the profile and message and reports the confirmation', async () => {
    confirm = true;
    const { adapter, ctx, listing, message } = setup();
    const result = await adapter.contact!(listing, message(false), ctx);
    expect(result.ok).toBe(true);
    expect(result.channel).toBe('form');
    expect(result.evidence).toContain('Bedankt voor uw bericht');
    const post = server.requests.filter((r) => r.method === 'POST').at(-1);
    const fields = new URLSearchParams(post?.body);
    expect(fields.get('naam')).toBe('Sam de Vries');
    expect(fields.get('email')).toBe('sam@nlpf.test');
    expect(fields.get('telefoon')).toBe('0612345678');
    expect(fields.get('bericht')).toContain('Voorbeeldstraat 12-A');
    expect(fields.get('object')).toBe('101');
  });

  test('no confirmation after sending asks a person to check instead of retrying', async () => {
    confirm = false;
    const { adapter, ctx, listing, message } = setup();
    const result = await adapter.contact!(listing, message(false), ctx);
    expect(result).toMatchObject({ ok: false, channel: 'form', needs: 'human' });
  }, 40_000);
});
