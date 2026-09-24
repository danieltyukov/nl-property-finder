/**
 * The Pararius contact flow in a real (headless) Chromium against a local
 * server that behaves like pararius.nl: /contact/<uuid> redirects to
 * /inloggen without a session cookie and shows the contact form with one.
 * Requests to any host other than 127.0.0.1 and localhost are aborted, so
 * nothing leaves the machine even though the recorded pages link to CDNs.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { BrowserContext } from 'playwright-core';
import { ConfigSchema, memoryLogger, type Listing, type OutboundMessage } from '@nlpf/core';
import { createParariusAdapter } from '../../src/adapters/pararius.js';
import { createBrowserPool, type BrowserPool } from '../../src/runtime/browser.js';
import { resolveChromium } from '../../src/runtime/chromium.js';
import { createSourceContext, type SessionProvider } from '../../src/runtime/context.js';
import { NeedsLoginError } from '../../src/runtime/errors.js';
import { createPoliteFetch } from '../../src/runtime/fetch.js';
import { startFixtureServer, type FixtureServer } from '../../src/testing.js';

const UUID = 'fd826b6c-b92c-59b2-acf8-4175ad916d1f';
const config = ConfigSchema.parse({
  profile: { firstName: 'Sam', lastName: 'de Vries', email: 'sam@nlpf.test', phone: '0612345678' },
});

describe.skipIf(!resolveChromium())('pararius contact in a real browser', () => {
  let server: FixtureServer;
  let pool: BrowserPool;
  let dir: string;
  let loggedIn = false;
  let reply: 'confirm' | 'silent' | 'invalid' = 'confirm';
  const guarded = new WeakSet<BrowserContext>();

  // Headless on purpose: nothing here needs to get past Cloudflare, and no window may open.
  const provider: SessionProvider = {
    async session(sourceId) {
      const s = await pool.session(sourceId, { mode: 'headless' });
      const context = s.page.context();
      if (!guarded.has(context)) {
        guarded.add(context);
        await context.route((u) => !['127.0.0.1', 'localhost'].includes(u.hostname), (route) => route.abort());
      }
      await context.clearCookies();
      if (loggedIn) await context.addCookies([{ name: 'session', value: 'ok', url: server.url }]);
      return s;
    },
  };

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'nlpf-pararius-'));
    pool = createBrowserPool({ dir, log: memoryLogger() });
    server = await startFixtureServer({
      [`/contact/${UUID}`]: (req) =>
        req.headers.cookie?.includes('session=ok')
          ? { file: 'pararius/contact-form.html' }
          : { status: 302, headers: { location: '/inloggen' } },
      [`POST /contact/${UUID}`]: () =>
        reply === 'confirm'
          ? { body: '<!doctype html><title>Verzonden</title><main><div class="notification notification--success">Bedankt voor je bericht. Je bericht is verstuurd naar de makelaar.</div></main>' }
          : reply === 'invalid'
            ? { body: '<!doctype html><main><form><wc-form-errors class="form-errors"><ul><li>Vul een telefoonnummer in.</li></ul></wc-form-errors><textarea></textarea></form></main>' }
            : { file: 'pararius/contact-form.html' },
      '/inloggen': 'pararius/login.html',
      '/appartement-te-huur/delft/aaaaaaaa/teststraat': 'pararius/detail-clickout.html',
      'POST /clickout': () => ({ status: 302, headers: { location: `http://localhost:${server.port}/aanbod/teststraat-12` } }),
      '/aanbod/teststraat-12': { body: '<!doctype html><title>Voorbeeld Verhuur</title><h1>Teststraat 12</h1>' },
    });
  });

  afterAll(async () => {
    await pool.closeAll();
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    loggedIn = false;
    reply = 'confirm';
  });

  function setup() {
    const adapter = createParariusAdapter({ baseUrl: server.url, waitMs: 5_000, confirmTimeoutMs: 2_000 });
    const ctx = createSourceContext({
      fetch: createPoliteFetch({ minGapMs: 0, log: memoryLogger() }),
      pool: provider,
      log: memoryLogger(),
      config,
      sourceId: 'pararius',
      signal: new AbortController().signal,
    });
    const listing: Listing = {
      id: 'pararius:fd826b6c',
      sourceId: 'pararius',
      externalId: 'fd826b6c',
      url: `${server.url}/appartement-te-huur/delft/fd826b6c/kruisstraat`,
      title: 'Appartement Kruisstraat 46',
      address: { street: 'Kruisstraat', houseNumber: '46', postcode: '2611 MJ', city: 'Delft' },
      contact: 'form',
      contactUrl: `${server.url}/contact/${UUID}`,
      extra: { uuid: UUID },
      propertyId: null,
      firstSeenAt: '2026-09-24T10:00:00Z',
      lastSeenAt: '2026-09-24T10:00:00Z',
      state: 'active',
      via: 'poll',
    };
    const message = (dryRun: boolean): OutboundMessage => ({
      body: 'Goedemiddag, ik heb interesse in de woning aan de Kruisstraat 46 en kom graag kijken.',
      language: 'nl',
      profile: config.profile,
      dryRun,
    });
    return { adapter, ctx, listing, message };
  }

  const posts = () => server.requests.filter((r) => r.method === 'POST' && r.path.startsWith('/contact/'));

  test('without a session the redirect to /inloggen becomes NeedsLoginError', async () => {
    const { adapter, ctx, listing, message } = setup();
    const err = await adapter.contact!(listing, message(false), ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NeedsLoginError);
    expect((err as NeedsLoginError).loginUrl).toBe(`${server.url}/inloggen`);
    expect(posts()).toHaveLength(0);
  });

  test('a dry run fills the form and sends nothing', async () => {
    loggedIn = true;
    const { adapter, ctx, listing, message } = setup();
    const before = posts().length;
    expect(await adapter.contact!(listing, message(true), ctx)).toEqual({ ok: true, channel: 'form', evidence: 'dry run: the form was filled and not sent' });
    expect(posts()).toHaveLength(before);
  });

  test('a required field it cannot fill stops the send, and says which', async () => {
    loggedIn = true;
    const { adapter, ctx, listing, message } = setup();
    const before = posts().length;
    const noPhone = { ...message(false), profile: { ...config.profile, phone: undefined } };
    const result = await adapter.contact!(listing, noPhone, ctx);
    expect(result).toMatchObject({ ok: false, channel: 'form' });
    expect(result.needs).toBeUndefined();
    expect(result.error).toContain('contact_agent_form[phone]');
    expect(posts()).toHaveLength(before);
  });

  test('fills the empty fields, uses the dedicated mailbox, and reports the confirmation', async () => {
    loggedIn = true;
    const { adapter, ctx, listing, message } = setup();
    const result = await adapter.contact!(listing, message(false), ctx);
    expect(result).toMatchObject({ ok: true, channel: 'form' });
    expect(result.evidence).toContain('Bedankt voor je bericht');
    const fields = new URLSearchParams(posts().at(-1)?.body);
    expect(fields.get('contact_agent_form[message]')).toContain('Kruisstraat 46');
    expect(fields.get('contact_agent_form[first_name]')).toBe('Sam');
    expect(fields.get('contact_agent_form[last_name]')).toBe('de Vries');
    // The account had its own address prefilled; replies must reach the agent's mailbox.
    expect(fields.get('contact_agent_form[email]')).toBe('sam@nlpf.test');
    expect(fields.get('contact_agent_form[phone]')).toBe('0612345678');
    expect(fields.get('contact_agent_form[privacy]')).toBe('1');
    expect(fields.get('contact_agent_form[_token]')).toBe('csrf-token');
  });

  test('no confirmation after sending asks a person to check instead of retrying', async () => {
    loggedIn = true;
    reply = 'silent';
    const { adapter, ctx, listing, message } = setup();
    expect(await adapter.contact!(listing, message(false), ctx)).toMatchObject({ ok: false, channel: 'form', needs: 'human' });
  });

  test('a form error is reported as not sent', async () => {
    loggedIn = true;
    reply = 'invalid';
    const { adapter, ctx, listing, message } = setup();
    const result = await adapter.contact!(listing, message(false), ctx);
    expect(result).toMatchObject({ ok: false, channel: 'form' });
    expect(result.needs).toBeUndefined();
    expect(result.error).toContain('Vul een telefoonnummer in');
  });

  test('an external listing routes to the form on the advertiser’s site', async () => {
    const { adapter, ctx, listing } = setup();
    const external: Listing = {
      ...listing,
      id: 'pararius:aaaaaaaa',
      externalId: 'aaaaaaaa',
      url: `${server.url}/appartement-te-huur/delft/aaaaaaaa/teststraat`,
      title: 'Appartement Teststraat 12',
      contactUrl: `${server.url}/contact/aaaaaaaa-0000-5000-8000-000000000001`,
      extra: { uuid: 'aaaaaaaa-0000-5000-8000-000000000001' },
    };
    const d = await adapter.detail!(external, ctx);
    expect(d.contact).toBe('form');
    expect(d.contactUrl).toBe(`http://localhost:${server.port}/aanbod/teststraat-12`);
    expect(d.agent).toMatchObject({ name: 'Voorbeeld Verhuur', url: `http://localhost:${server.port}` });
    expect(d.extra).toMatchObject({ clickout: true });
    expect(new URL(d.contactUrl!).host).not.toBe(new URL(server.url).host);

    // Contacting it does not fill any form on Pararius: the router gets a reason to hand it to a person.
    const result = await adapter.contact!({ ...external, ...d } as Listing, { body: 'x', language: 'nl', profile: config.profile, dryRun: false }, ctx);
    expect(result).toMatchObject({ ok: false, channel: 'form' });
    expect(result.error).toContain(`http://localhost:${server.port}/aanbod/teststraat-12`);
  });
});
