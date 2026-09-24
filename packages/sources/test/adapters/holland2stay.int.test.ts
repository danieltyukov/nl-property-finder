/**
 * How the Holland2Stay adapter reads unit data, in a real (headless)
 * Chromium against local pages that load it the two ways the site is
 * reported to: a plain GraphQL JSON response, and an encrypted response the
 * page decrypts itself with WebCrypto. Requests off 127.0.0.1 are aborted.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { ConfigSchema, memoryLogger } from '@nlpf/core';
import { createHolland2StayAdapter } from '../../src/adapters/holland2stay.js';
import { createBrowserPool, type BrowserPool } from '../../src/runtime/browser.js';
import { resolveChromium } from '../../src/runtime/chromium.js';
import { createSourceContext, type SessionProvider } from '../../src/runtime/context.js';
import { createPoliteFetch } from '../../src/runtime/fetch.js';
import { startFixtureServer, type FixtureServer } from '../../src/testing.js';

const plainPage = `<!doctype html><title>Residences</title><div id="__next">Loading</div>
<script>
fetch('/api/graphql', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operationName: 'GetCategories' }) })
  .then((r) => r.json())
  .then((j) => { document.getElementById('__next').textContent = j.data.products.total_count + ' residences'; });
</script>`;

// Stands in for the /api/__enc__ channel: the page receives ciphertext and decrypts it with WebCrypto.
const encryptedPage = `<!doctype html><title>Residences</title><div id="__next">Loading</div>
<script>
(async () => {
  const plain = await (await fetch('/api/envelope')).text();
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain));
  const opened = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, sealed);
  document.getElementById('__next').textContent = JSON.parse(new TextDecoder().decode(opened)).data.products.total_count + ' residences';
})();
</script>`;

describe.skipIf(!resolveChromium())('holland2stay reads the data its page receives', () => {
  let server: FixtureServer;
  let pool: BrowserPool;
  let dir: string;
  const provider: SessionProvider = {
    async session(sourceId) {
      const s = await pool.session(sourceId, { mode: 'headless' });
      await s.page.context().route((u) => u.hostname !== '127.0.0.1', (route) => route.abort());
      return s;
    },
  };

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'nlpf-h2s-'));
    pool = createBrowserPool({ dir, log: memoryLogger() });
    server = await startFixtureServer({
      '/plain/residences': { body: plainPage, headers: { 'content-type': 'text/html; charset=utf-8' } },
      'POST /api/graphql': 'holland2stay/products.json',
      '/enc/residences': { body: encryptedPage, headers: { 'content-type': 'text/html; charset=utf-8' } },
      // Plain text on purpose, so only the decrypt hook can see it.
      '/api/envelope': { file: 'holland2stay/products.json', headers: { 'content-type': 'text/plain' } },
    });
  });

  afterAll(async () => {
    await pool.closeAll();
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const ctx = () =>
    createSourceContext({
      fetch: createPoliteFetch({ minGapMs: 0, log: memoryLogger() }),
      pool: provider,
      log: memoryLogger(),
      config: ConfigSchema.parse({ searches: [{ id: 'main', name: 'Main', regions: [{ name: 'Delft', municipalities: ['Delft'] }] }] }),
      sourceId: 'holland2stay',
      signal: new AbortController().signal,
    });

  test('from a plain GraphQL response', async () => {
    const adapter = createHolland2StayAdapter({ baseUrl: `${server.url}/plain`, waitMs: 10_000 });
    const c = ctx();
    const [req] = adapter.buildSearches(c.searches, c.source);
    const listings = await adapter.search(req!, c);
    expect(listings.map((l) => l.externalId)).toEqual(['VBL-12-301', 'VBL-12-512']);
    expect(listings[0]?.extra?.bookingUrl).toBe(`${server.url}/plain/residences/voorbeeldlaan-12-301.html`);
  });

  test('from a response the page decrypts itself', async () => {
    const adapter = createHolland2StayAdapter({ baseUrl: `${server.url}/enc`, waitMs: 10_000 });
    const c = ctx();
    const [req] = adapter.buildSearches(c.searches, c.source);
    expect((await adapter.search(req!, c)).map((l) => l.externalId)).toEqual(['VBL-12-301', 'VBL-12-512']);
  });
});
