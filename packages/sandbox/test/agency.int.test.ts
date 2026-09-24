import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { memoryLogger } from '@nlpf/core';
import {
  createAgencyAdapter,
  createBrowserPool,
  createPoliteFetch,
  createSourceContext,
  parseAgencyYaml,
  resolveChromium,
  type BrowserPool,
} from '@nlpf/sources';
import { GRACHT_EMAIL, grachtAgencyYaml } from '../src/index.js';
import { asListing, config, message, sandbox, type TestSandbox } from './helpers.js';

describe.skipIf(!resolveChromium())('De Gracht contact form in a real browser', () => {
  let box: TestSandbox;
  let pool: BrowserPool;
  let dir: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'nlpf-sandbox-browser-'));
    pool = createBrowserPool({ dir, log: memoryLogger() });
    box = await sandbox({ autoReply: true, speed: 1000 });
  });
  afterAll(async () => {
    await pool.closeAll();
    await box.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  test('the agency adapter fills and sends the form; the agent answers by email in the thread', async () => {
    const adapter = createAgencyAdapter(parseAgencyYaml(grachtAgencyYaml(box.url)), {
      confirmTimeoutMs: 5000,
    });
    const ctx = createSourceContext({
      fetch: createPoliteFetch({ minGapMs: 0, log: memoryLogger() }),
      pool,
      log: memoryLogger(),
      config,
      sourceId: adapter.id,
      signal: new AbortController().signal,
    });
    const [req] = adapter.buildSearches(ctx.searches, ctx.source);
    const raw = (await adapter.search(req!, ctx)).find((l) => l.title === 'Tulpgracht 12 a')!;
    const listing = asListing(raw);

    const dry = await adapter.contact!(listing, message('Goedemiddag, ik kom graag kijken.', true), ctx);
    expect(dry.ok).toBe(true);
    expect(box.control.submissions()).toHaveLength(0);

    const result = await adapter.contact!(
      listing,
      message('Goedemiddag, ik kom graag kijken bij Tulpgracht 12 a.'),
      ctx,
    );
    expect(result).toMatchObject({ ok: true, channel: 'form' });
    expect(result.evidence).toMatch(/Bedankt voor uw reactie/);
    const [sub] = box.control.submissions();
    expect(sub).toMatchObject({
      listingId: 'dg-2001',
      name: 'Sam de Vries',
      email: 'sam@nlpf.test',
      phone: '0600000000',
    });

    const [reply] = await box.waitForMail(1);
    expect(reply).toMatchObject({ from: { address: GRACHT_EMAIL }, subject: 'Re: Tulpgracht 12 a' });
    expect(reply!.text).toMatch(/bezichtiging/i);
  });
});
