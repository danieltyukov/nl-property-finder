import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { ConfigSchema, memoryLogger, type Listing, type OutboundMessage } from '@nlpf/core';
import { createKamernetAdapter } from '../../src/adapters/kamernet.js';
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
  profile: { firstName: 'Sam', lastName: 'de Vries', email: 'sam@nlpf.test' },
});

/*
 * A stand-in for Kamernet's conversation page. The anonymous 401 page is the
 * one recorded live (fixtures/kamernet/login-wall.html). The logged-in form
 * (#Message and a send button, from the kamernet-mcp project), the Premium
 * offer and the confirmation were not seen live and are modelled here.
 */
const page = (body: string) =>
  `<!doctype html><html lang="en"><head><title>Kamernet</title></head><body>${body}</body></html>`;
const FORM = (extra = '') =>
  page(`<h1>Contact the landlord</h1>
<form method="post">
  ${extra}
  <label for="Message">Your message</label>
  <textarea id="Message" name="Message" required></textarea>
  <button type="submit">Send message</button>
</form>`);
const PREMIUM = page(`<div class="modal"><h2>Gelijk reageren op deze woning? Kies dan Premium</h2>
<p>Reageer onbeperkt op alle woningen</p><a href="/en/premium-account-payment/2weeks">Premium</a></div>`);

describe.skipIf(!resolveChromium())('kamernet message flow in a real browser', () => {
  let server: FixtureServer;
  let pool: BrowserPool;
  let dir: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'nlpf-kamernet-'));
    pool = createBrowserPool({ dir, log: memoryLogger() });
    server = await startFixtureServer({
      'GET /en/start-conversation/1001': { body: FORM() },
      'POST /en/start-conversation/1001': {
        body: page('<p class="toast">Je bericht is verstuurd naar de verhuurder.</p>'),
      },
      '/en/start-conversation/1002': { status: 401, file: 'kamernet/login-wall.html' },
      '/en/start-conversation/1003': { body: PREMIUM },
      '/en/start-conversation/1004': { body: FORM('<input id="DateOfBirth" name="DateOfBirth" required>') },
      'GET /en/start-conversation/1005': { body: FORM() },
      'POST /en/start-conversation/1005': { body: page('<p>Er ging iets mis.</p>') },
    });
  });

  afterAll(async () => {
    await pool.closeAll();
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function setup(id: string) {
    const adapter = createKamernetAdapter({ baseUrl: server.url, headed: false, confirmTimeoutMs: 2_500 });
    const ctx = createSourceContext({
      fetch: createPoliteFetch({ minGapMs: 0, log: memoryLogger() }),
      pool,
      log: memoryLogger(),
      config,
      sourceId: adapter.id,
      signal: new AbortController().signal,
    });
    const listing: Listing = {
      id: `kamernet:${id}`,
      sourceId: 'kamernet',
      externalId: id,
      url: `${server.url}/huren/kamer-delft/voorbeeldstraat/kamer-${id}`,
      title: 'Kamer Voorbeeldstraat',
      address: { street: 'Voorbeeldstraat', city: 'Delft' },
      contact: 'message',
      propertyId: null,
      firstSeenAt: '2026-09-24T10:00:00Z',
      lastSeenAt: '2026-09-24T10:00:00Z',
      state: 'active',
      via: 'poll',
    };
    const message = (dryRun: boolean): OutboundMessage => ({
      body: 'Hoi, ik ben Sam en heb interesse in de kamer.',
      language: 'nl',
      profile: config.profile,
      dryRun,
    });
    return { adapter, ctx, listing, message };
  }

  const posts = (id: string) =>
    server.requests.filter((r) => r.method === 'POST' && r.path === `/en/start-conversation/${id}`);

  test('a dry run fills the message and sends nothing', async () => {
    const { adapter, ctx, listing, message } = setup('1001');
    const result = await adapter.contact!(listing, message(true), ctx);
    expect(result).toEqual({
      ok: true,
      channel: 'message',
      evidence: 'dry run: the message was filled and not sent',
    });
    expect(posts('1001')).toHaveLength(0);
  });

  test('sends only the message and reports the confirmation', async () => {
    const { adapter, ctx, listing, message } = setup('1001');
    const result = await adapter.contact!(listing, message(false), ctx);
    expect(result).toMatchObject({ ok: true, channel: 'message' });
    expect(result.evidence).toContain('Je bericht is verstuurd');
    const fields = new URLSearchParams(posts('1001').at(-1)?.body);
    expect([...fields.keys()]).toEqual(['Message']);
    expect(fields.get('Message')).toBe('Hoi, ik ben Sam en heb interesse in de kamer.');
  });

  test('the anonymous page throws NeedsLoginError with the sign-in URL', async () => {
    const { adapter, ctx, listing, message } = setup('1002');
    const err = await adapter.contact!(listing, message(false), ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NeedsLoginError);
    expect((err as NeedsLoginError).loginUrl).toBe(`${server.url}/oauth/signin`);
  });

  test('the Premium offer is a paid wall', async () => {
    const { adapter, ctx, listing, message } = setup('1003');
    expect(await adapter.contact!(listing, message(false), ctx)).toMatchObject({
      ok: false,
      channel: 'message',
      needs: 'paid',
    });
  });

  test('extra questions from the landlord go to a person', async () => {
    const { adapter, ctx, listing, message } = setup('1004');
    const result = await adapter.contact!(listing, message(false), ctx);
    expect(result).toMatchObject({ ok: false, channel: 'message', needs: 'human' });
    expect(result.error).toContain('DateOfBirth');
    expect(posts('1004')).toHaveLength(0);
  });

  test('no confirmation after sending asks a person to check', async () => {
    const { adapter, ctx, listing, message } = setup('1005');
    expect(await adapter.contact!(listing, message(false), ctx)).toMatchObject({
      ok: false,
      channel: 'message',
      needs: 'human',
    });
  });
});
