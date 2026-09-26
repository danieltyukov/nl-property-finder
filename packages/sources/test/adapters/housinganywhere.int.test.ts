import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { ConfigSchema, memoryLogger, type Listing, type OutboundMessage } from '@nlpf/core';
import { createHousingAnywhereAdapter } from '../../src/adapters/housinganywhere.js';
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
 * A stand-in for a HousingAnywhere listing page. Verified live: the
 * `window.__PRELOADED_STATE__.authLogic.isAuthenticated` flag and the
 * "Apply to rent" button with data-test-locator
 * "ListingActionButtonsContact/CheckAvailability". What the button opens
 * for a logged-in tenant (a message box, a subscription offer or a date
 * picker) is modelled here and was not seen live.
 */
function listingPage(opts: { authenticated: boolean; opens: 'message' | 'subscription' | 'dates'; signInLink?: boolean }): string {
  // The live logged-out header links to /oauth/signin?target=tenant; a logged-in one shows the avatar instead.
  const header = opts.signInLink ?? !opts.authenticated ? '<header><a href="/oauth/signin?target=tenant">Log in</a></header>' : '<header><span>DT</span></header>';
  const panel = {
    message: `<div role="dialog"><label for="msg">Message to the landlord</label><textarea id="msg"></textarea>
      <button type="button" id="send">Send message</button></div>`,
    subscription: `<div role="dialog"><h2>Subscribe to message landlords in the Netherlands</h2>
      <a href="/pricing/tenants">See plans</a></div>`,
    dates: `<div role="dialog"><h2>When do you want to move in?</h2><input type="date" id="movein"></div>`,
  }[opts.opens];
  return `<!doctype html><html lang="en"><head><title>Studio for rent in Delft | HousingAnywhere</title></head><body>
<script>window.__PRELOADED_STATE__= (${JSON.stringify({ authLogic: { user: null, isAuthenticated: opts.authenticated } })});</script>
${header}
<main><h1>Studio in Teststraat</h1>
<button type="button" data-test-locator="ListingActionButtonsContact/CheckAvailability">Apply to rent</button>
<template id="panel">${panel}</template></main>
<script>
document.querySelector('[data-test-locator]').addEventListener('click', () => {
  document.querySelector('main').append(document.getElementById('panel').content.cloneNode(true));
  const send = document.getElementById('send');
  if (send) send.addEventListener('click', async () => {
    await fetch('/api/conversations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: document.getElementById('msg').value }) });
    const note = document.createElement('p');
    note.textContent = 'Message sent. The landlord usually replies within a day.';
    document.querySelector('main').append(note);
  });
});
</script></body></html>`;
}

describe.skipIf(!resolveChromium())('housinganywhere message flow in a real browser', () => {
  let server: FixtureServer;
  let pool: BrowserPool;
  let dir: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'nlpf-ha-'));
    pool = createBrowserPool({ dir, log: memoryLogger() });
    server = await startFixtureServer({
      '/room/ut1000001/nl/Delft/teststraat': { body: listingPage({ authenticated: true, opens: 'message' }) },
      '/room/ut1000002/nl/Delft/teststraat': {
        body: listingPage({ authenticated: false, opens: 'message' }),
      },
      '/room/ut1000003/nl/Delft/teststraat': {
        body: listingPage({ authenticated: true, opens: 'subscription' }),
      },
      '/room/ut1000004/nl/Delft/teststraat': { body: listingPage({ authenticated: true, opens: 'dates' }) },
      // Logged in, but the preloaded state is filled in only after the page loads.
      '/room/ut1000005/nl/Delft/teststraat': {
        body: listingPage({ authenticated: false, opens: 'message', signInLink: false }),
      },
      'POST /api/conversations': { body: { ok: true } },
    });
  });

  afterAll(async () => {
    await pool.closeAll();
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function setup(n: number) {
    const adapter = createHousingAnywhereAdapter({ baseUrl: server.url, confirmTimeoutMs: 2_500 });
    const ctx = createSourceContext({
      fetch: createPoliteFetch({ minGapMs: 0, log: memoryLogger() }),
      pool,
      log: memoryLogger(),
      config,
      sourceId: adapter.id,
      signal: new AbortController().signal,
    });
    const url = `${server.url}/room/ut100000${n}/nl/Delft/teststraat`;
    const listing: Listing = {
      id: `housinganywhere:ut100000${n}`,
      sourceId: 'housinganywhere',
      externalId: `ut100000${n}`,
      url,
      contactUrl: url,
      title: 'Studio in Teststraat, Delft',
      address: { street: 'Teststraat', city: 'Delft' },
      contact: 'message',
      propertyId: null,
      firstSeenAt: '2026-09-24T10:00:00Z',
      lastSeenAt: '2026-09-24T10:00:00Z',
      state: 'active',
      via: 'poll',
    };
    const message = (dryRun: boolean): OutboundMessage => ({
      body: 'Hi, I am Sam and I would like to rent this studio.',
      language: 'en',
      profile: config.profile,
      dryRun,
    });
    return { adapter, ctx, listing, message };
  }

  const posts = () => server.requests.filter((r) => r.method === 'POST' && r.path === '/api/conversations');

  test('a dry run fills the message and sends nothing', async () => {
    const { adapter, ctx, listing, message } = setup(1);
    expect(await adapter.contact!(listing, message(true), ctx)).toEqual({
      ok: true,
      channel: 'message',
      evidence: 'dry run: the message was filled and not sent',
    });
    expect(posts()).toHaveLength(0);
  });

  test('sends the message and reports the confirmation', async () => {
    const { adapter, ctx, listing, message } = setup(1);
    const result = await adapter.contact!(listing, message(false), ctx);
    expect(result).toMatchObject({ ok: true, channel: 'message' });
    expect(result.evidence).toContain('Message sent');
    expect(JSON.parse(posts().at(-1)?.body ?? '{}')).toEqual({
      message: 'Hi, I am Sam and I would like to rent this studio.',
    });
  });

  test('a visitor who is not logged in gets NeedsLoginError', async () => {
    const { adapter, ctx, listing, message } = setup(2);
    const err = await adapter.contact!(listing, message(false), ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NeedsLoginError);
    expect((err as NeedsLoginError).loginUrl).toBe(`${server.url}/oauth/signin`);
  });

  test('a logged-in page whose preloaded state still says logged out is recognised by its header', async () => {
    const { adapter, ctx, listing, message } = setup(5);
    expect(await adapter.contact!(listing, message(true), ctx)).toMatchObject({ ok: true, channel: 'message' });
  });

  test('a subscription offer is a paid wall', async () => {
    const { adapter, ctx, listing, message } = setup(3);
    expect(await adapter.contact!(listing, message(false), ctx)).toMatchObject({
      ok: false,
      channel: 'message',
      needs: 'paid',
    });
  });

  test('a date picker instead of a message box goes to a person', async () => {
    const { adapter, ctx, listing, message } = setup(4);
    expect(await adapter.contact!(listing, message(false), ctx)).toMatchObject({
      ok: false,
      channel: 'message',
      needs: 'human',
    });
  });
});
