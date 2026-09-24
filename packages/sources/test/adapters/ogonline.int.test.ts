import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { ConfigSchema, memoryLogger, type Listing, type OutboundMessage } from '@nlpf/core';
import { createOgonlineAdapter } from '../../src/generic/ogonline.js';
import { createBrowserPool, type BrowserPool } from '../../src/runtime/browser.js';
import { resolveChromium } from '../../src/runtime/chromium.js';
import { createSourceContext } from '../../src/runtime/context.js';
import { createPoliteFetch } from '../../src/runtime/fetch.js';
import { startFixtureServer, type FixtureServer, type ServerReply } from '../../src/testing.js';

const REPLY = '/nl/woning/den-haag/proefplein-1-a/6a0000000000000000000001';
const DETAILS = '/nl/woning/rotterdam/proefweg-2/6a0000000000000000000002';
const CAPTCHA = '/nl/woning/den-haag/proefplein-3/6a0000000000000000000003';

const PROFILE = { firstName: 'Sam', lastName: 'de Vries', email: 'sam@nlpf.test', phone: '0612345678', facts: { salutation: 'dhr' } };

describe.skipIf(!resolveChromium())('OGonline contact form in a real browser', () => {
  let server: FixtureServer;
  let pool: BrowserPool;
  let dir: string;
  let answer: () => ServerReply | Promise<ServerReply> = () => ({ body: { success: true } });

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'nlpf-ogonline-'));
    pool = createBrowserPool({ dir, log: memoryLogger() });
    server = await startFixtureServer({
      [REPLY]: 'ogonline-forms/reply.html',
      [DETAILS]: 'ogonline-forms/details-consumer.html',
      [CAPTCHA]: 'ogonline-forms/captcha.html',
      '/nl/bedankt/aanbod': 'ogonline-forms/thanks.html',
      'POST /nl/forms/reply/consumer/6a0000000000000000000001': () => answer(),
      'POST /nl/forms/contact/details_consumer/6a0000000000000000000002': () => ({ body: { success: true } }),
      'POST /nl/forms/reply/consumer/6a0000000000000000000003': () => ({ body: { success: true } }),
    });
  });

  afterAll(async () => {
    await pool.closeAll();
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function setup(profile: Record<string, unknown> = PROFILE) {
    const config = ConfigSchema.parse({ profile });
    const adapter = createOgonlineAdapter(
      { id: 'voorbeeld', name: 'Voorbeeld Makelaars', homepage: server.url, regions: ['den haag', 'rotterdam'], contact: 'form' },
      { confirmTimeoutMs: 2_000 },
    );
    const ctx = createSourceContext({
      fetch: createPoliteFetch({ minGapMs: 0, log: memoryLogger() }),
      pool,
      log: memoryLogger(),
      config,
      sourceId: adapter.id,
      signal: new AbortController().signal,
    });
    const listing = (path: string, city: string): Listing => ({
      id: `${adapter.id}:${path}`,
      sourceId: adapter.id,
      externalId: path.split('/').pop() ?? path,
      url: `${server.url}${path}`,
      contactUrl: `${server.url}${path}`,
      title: 'Proefplein 1 A',
      address: { street: 'Proefplein', houseNumber: '1', addition: 'A', city },
      contact: 'form',
      propertyId: null,
      firstSeenAt: '2026-09-24T08:00:00Z',
      lastSeenAt: '2026-09-24T08:00:00Z',
      state: 'active',
      via: 'poll',
    });
    const message = (dryRun: boolean): OutboundMessage => ({
      body: 'Beste makelaar, ik heb interesse in Proefplein 1 A en kom graag kijken.',
      language: 'nl',
      profile: config.profile,
      dryRun,
    });
    return { adapter, ctx, listing, message };
  }

  const posts = (path: string) => server.requests.filter((r) => r.method === 'POST' && r.path === path);

  test('a dry run opens the tab, fills the form and sends nothing', async () => {
    const { adapter, ctx, listing, message } = setup();
    const before = posts('/nl/forms/reply/consumer/6a0000000000000000000001').length;
    const result = await adapter.contact!(listing(REPLY, 'Den Haag'), message(true), ctx);
    expect(result).toEqual({ ok: true, channel: 'form', evidence: 'dry run: the form was filled and not sent' });
    expect(posts('/nl/forms/reply/consumer/6a0000000000000000000001').length).toBe(before);
  });

  test('sends the reply form with the profile and message and reads the confirmation', async () => {
    answer = () => ({ body: { success: true } });
    const { adapter, ctx, listing, message } = setup();
    const result = await adapter.contact!(listing(REPLY, 'Den Haag'), message(false), ctx);
    expect(result.ok).toBe(true);
    expect(result.evidence).toContain('Uw bericht is naar ons verzonden');
    const sent = new URLSearchParams(posts('/nl/forms/reply/consumer/6a0000000000000000000001').at(-1)?.body);
    expect(sent.get('gender')).toBe('male');
    expect(sent.get('name')).toBe('Sam de Vries');
    expect(sent.get('telephone')).toBe('0612345678');
    expect(sent.get('email')).toBe('sam@nlpf.test');
    expect(sent.get('question')).toContain('Proefplein 1 A');
    expect(sent.get('privacy')).toBe('on');
    // The newsletter box stays unticked.
    expect(sent.has('nieuwsbrief')).toBe(false);
  });

  test('the details form: first and last name, the office for the listing city, a confirmation page', async () => {
    const { adapter, ctx, listing, message } = setup();
    const result = await adapter.contact!(listing(DETAILS, 'Rotterdam'), message(false), ctx);
    expect(result).toMatchObject({ ok: true, channel: 'form' });
    expect(result.evidence).toContain('/nl/bedankt/aanbod');
    const sent = new URLSearchParams(posts('/nl/forms/contact/details_consumer/6a0000000000000000000002').at(-1)?.body);
    expect(sent.get('first_name')).toBe('Sam');
    expect(sent.get('last_name')).toBe('de Vries');
    expect(sent.get('branch')).toBe('rotterdam@example.test');
    expect(sent.get('to')).toBe('verhuur@example.test');
  });

  test('a field the browser would refuse is reported before sending', async () => {
    const { adapter, ctx, listing, message } = setup({ ...PROFILE, email: 'sam-at-nlpf' });
    const before = posts('/nl/forms/contact/details_consumer/6a0000000000000000000002').length;
    const result = await adapter.contact!(listing(DETAILS, 'Rotterdam'), message(false), ctx);
    expect(result).toMatchObject({ ok: false, needs: 'human' });
    expect(result.error).toContain('still needs: email');
    expect(posts('/nl/forms/contact/details_consumer/6a0000000000000000000002').length).toBe(before);
  });

  test('a sum question is a captcha: nothing is filled or sent', async () => {
    const { adapter, ctx, listing, message } = setup();
    const result = await adapter.contact!(listing(CAPTCHA, 'Den Haag'), message(false), ctx);
    expect(result).toMatchObject({ ok: false, channel: 'form', needs: 'captcha' });
    expect(posts('/nl/forms/reply/consumer/6a0000000000000000000003')).toHaveLength(0);
  });

  test('a required salutation the profile does not give asks a person', async () => {
    const { adapter, ctx, listing, message } = setup({ ...PROFILE, facts: {} });
    const before = posts('/nl/forms/reply/consumer/6a0000000000000000000001').length;
    const result = await adapter.contact!(listing(REPLY, 'Den Haag'), message(false), ctx);
    expect(result).toMatchObject({ ok: false, needs: 'human' });
    expect(result.error).toContain('salutation');
    expect(posts('/nl/forms/reply/consumer/6a0000000000000000000001').length).toBe(before);
  });

  test('the site answering with its bot warning or an error is reported as such', async () => {
    const { adapter, ctx, listing, message } = setup();
    answer = () => ({ body: { success: false, warning: true } });
    expect(await adapter.contact!(listing(REPLY, 'Den Haag'), message(false), ctx)).toMatchObject({ ok: false, needs: 'captcha' });
    answer = () => ({ body: { success: false } });
    const error = await adapter.contact!(listing(REPLY, 'Den Haag'), message(false), ctx);
    expect(error.ok).toBe(false);
    expect(error.needs).toBeUndefined();
    expect(error.error).toContain('reported an error');
  });

  test('no confirmation after sending asks a person to check instead of retrying', async () => {
    const { adapter, ctx, listing, message } = setup();
    answer = () => new Promise((resolve) => setTimeout(() => resolve({ body: { success: true } }), 4_000));
    const result = await adapter.contact!(listing(REPLY, 'Den Haag'), message(false), ctx);
    expect(result).toMatchObject({ ok: false, channel: 'form', needs: 'human' });
    answer = () => ({ body: { success: true } });
  });
});
