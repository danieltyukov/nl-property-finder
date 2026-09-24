import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { ConfigSchema, memoryLogger, type Listing, type OutboundMessage } from '@nlpf/core';
import { createFundaAdapter } from '../../src/adapters/funda.js';
import { NeedsLoginError } from '../../src/runtime/errors.js';
import {
  createBrowserPool,
  createPoliteFetch,
  createSourceContext,
  resolveChromium,
  type BrowserPool,
} from '../../src/index.js';
import { startFixtureServer, type FixtureServer } from '../../src/testing.js';

const config = ConfigSchema.parse({
  profile: { firstName: 'Sam', lastName: 'de Vries', email: 'sam@nlpf.test', phone: '06 1234 5678' },
});

/**
 * Stands in for Funda's Nuxt app on the recorded form markup: the consent
 * banner hides on "Alles weigeren", and sending posts the field values to
 * /submit and shows a confirmation, except for listing 2, which never
 * confirms. The real confirmation text was not seen live.
 */
const FORM_JS = `
document.getElementById('didomi-notice-disagree-button').addEventListener('click', () => {
  document.getElementById('didomi-host').remove();
});
const form = document.querySelector('form');
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (document.getElementById('didomi-host')) return;
  const fields = {};
  for (const el of form.querySelectorAll('input, textarea')) fields[el.id] = el.value;
  await fetch('/submit' + location.search, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(fields) });
  if (new URLSearchParams(location.search).get('listingId') === '2') return;
  document.querySelector('main').innerHTML = '<h1>Bedankt!</h1><p>Je bericht is verstuurd naar de makelaar.</p>';
});
`;

describe.skipIf(!resolveChromium())('funda guest contact form in a real browser', () => {
  let server: FixtureServer;
  let pool: BrowserPool;
  let dir: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'nlpf-funda-'));
    pool = createBrowserPool({ dir, log: memoryLogger() });
    server = await startFixtureServer({
      '/makelaar-contact/': 'funda/contact-form.html',
      '/form.js': { body: FORM_JS, headers: { 'content-type': 'text/javascript' } },
      'POST /submit': { body: { ok: true } },
      '/wants-login/': { status: 302, headers: { location: '/login' } },
      '/login': { body: '<!doctype html><title>Inloggen</title><form><input name="email"></form>' },
    });
  });

  afterAll(async () => {
    await pool.closeAll();
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function setup(listingId: string, contactPath?: string) {
    const adapter = createFundaAdapter({ baseUrl: server.url, confirmTimeoutMs: 2_500 });
    const ctx = createSourceContext({
      fetch: createPoliteFetch({ minGapMs: 0, log: memoryLogger() }),
      pool,
      log: memoryLogger(),
      config,
      sourceId: adapter.id,
      signal: new AbortController().signal,
    });
    const listing: Listing = {
      id: `funda:4450984${listingId}`,
      sourceId: 'funda',
      externalId: `4450984${listingId}`,
      url: `${server.url}/detail/huur/delft/appartement-voorbeeldstraat-1/4450984${listingId}/`,
      contactUrl: `${server.url}${contactPath ?? `/makelaar-contact/?listingId=${listingId}`}`,
      title: 'Voorbeeldstraat 1',
      address: { street: 'Voorbeeldstraat', houseNumber: '1', city: 'Delft' },
      contact: 'form',
      extra: { globalId: Number(listingId) },
      propertyId: null,
      firstSeenAt: '2026-09-24T10:00:00Z',
      lastSeenAt: '2026-09-24T10:00:00Z',
      state: 'active',
      via: 'poll',
    };
    const message = (dryRun: boolean): OutboundMessage => ({
      body: 'Goedemiddag, ik heb interesse in Voorbeeldstraat 1 en kom graag kijken.',
      language: 'nl',
      profile: config.profile,
      dryRun,
    });
    return { adapter, ctx, listing, message };
  }

  const posts = () => server.requests.filter((r) => r.method === 'POST' && r.path === '/submit');

  test('a dry run fills the guest form and sends nothing', async () => {
    const { adapter, ctx, listing, message } = setup('1');
    const before = posts().length;
    const result = await adapter.contact!(listing, message(true), ctx);
    expect(result).toEqual({
      ok: true,
      channel: 'form',
      evidence: 'dry run: the form was filled and not sent',
    });
    expect(posts().length).toBe(before);
  });

  test('sends exactly the five guest fields and reports the confirmation', async () => {
    const { adapter, ctx, listing, message } = setup('1');
    const result = await adapter.contact!(listing, message(false), ctx);
    expect(result.ok).toBe(true);
    expect(result.channel).toBe('form');
    expect(result.evidence).toContain('Je bericht is verstuurd');
    const sent = JSON.parse(posts().at(-1)?.body ?? '{}') as Record<string, string>;
    expect(sent).toEqual({
      questionInput: 'Goedemiddag, ik heb interesse in Voorbeeldstraat 1 en kom graag kijken.',
      emailAddress: 'sam@nlpf.test',
      firstName: 'Sam',
      lastName: 'de Vries',
      phoneNumber: '0612345678',
    });
    expect(posts().at(-1)?.query.get('listingId')).toBe('1');
  });

  test('no confirmation after sending asks a person to check instead of retrying', async () => {
    const { adapter, ctx, listing, message } = setup('2');
    const result = await adapter.contact!(listing, message(false), ctx);
    expect(result).toMatchObject({ ok: false, channel: 'form', needs: 'human' });
  });

  test('a redirect to a login page throws NeedsLoginError', async () => {
    const { adapter, ctx, listing, message } = setup('3', '/wants-login/');
    await expect(adapter.contact!(listing, message(false), ctx)).rejects.toBeInstanceOf(NeedsLoginError);
  });
});
