import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { ConfigSchema, memoryLogger, type Listing, type OutboundMessage } from '@nlpf/core';
import { createEmbraceAdapter } from '../../src/generic/embrace.js';
import { woonnetRijnmond } from '../../src/instances/woonnet-rijnmond.js';
import { createBrowserPool, type BrowserPool } from '../../src/runtime/browser.js';
import { resolveChromium } from '../../src/runtime/chromium.js';
import { createSourceContext } from '../../src/runtime/context.js';
import { NeedsLoginError } from '../../src/runtime/errors.js';
import { createPoliteFetch } from '../../src/runtime/fetch.js';
import { readFixture, startFixtureServer, type FixtureServer, type ServerRequest } from '../../src/testing.js';

const PUBLICATION = 'SG91c2luZ1B1YmxpY2F0aW9uOjEwMDEyMzMxMw==';
const SLUG = `Rotterdam-Proefstraat-1-${PUBLICATION}`;
const ANONYMOUS_PRECHECK = readFixture('embrace-woonnet-rijnmond/precheck-anonymous.json');

interface Scenario {
  precheck: { state: string; canApply: boolean; description: string; userErrors: unknown[] };
  apply: { state: string | null; userErrors: unknown[] };
}

describe.skipIf(!resolveChromium())('Embrace portal reaction in a real browser (local portal)', () => {
  let server: FixtureServer;
  let pool: BrowserPool;
  let dir: string;
  let scenario: Scenario;

  const operation = (req: ServerRequest) => (JSON.parse(req.body || '{}') as { operationName?: string }).operationName;
  const bearer = (req: ServerRequest) => req.headers.authorization === 'Bearer test-token';

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'nlpf-embrace-'));
    pool = createBrowserPool({ dir, log: memoryLogger() });
    server = await startFixtureServer({
      [`/nl-NL/aanbod/advertentie/${SLUG}`]: 'embrace-woonnet-rijnmond/portal-page.html',
      '/nl-NL': 'embrace-woonnet-rijnmond/portal-page.html',
      'POST /graphql': (req) => {
        switch (operation(req)) {
          case 'widgetReactionGetPrecheckStatus':
            return bearer(req) ? { body: { data: { precheckStatus: scenario.precheck } } } : { body: ANONYMOUS_PRECHECK };
          case 'widgetSharedFloatingReactionApplyUnit':
            return { body: { data: { application: scenario.apply } } };
          default:
            return { body: { data: { __typename: 'Query' } } };
        }
      },
    });
  });

  afterAll(async () => {
    await pool.closeAll();
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    scenario = {
      precheck: { state: 'CAN_APPLY', canApply: true, description: '', userErrors: [] },
      apply: { state: 'APPLIED', userErrors: [] },
    };
  });

  const adapter = () =>
    createEmbraceAdapter(
      {
        ...woonnetRijnmond,
        homepage: server.url,
        gateway: `${server.url}/graphql`,
        authRealmUrl: `${server.url}/auth/realms/test/`,
      },
      { tokenWaitMs: 1_500 },
    );

  const context = (sourceId: string) =>
    createSourceContext({
      fetch: createPoliteFetch({ minGapMs: 0, log: memoryLogger() }),
      pool,
      log: memoryLogger(),
      config: ConfigSchema.parse({}),
      sourceId,
      signal: new AbortController().signal,
    });

  async function setSession(sourceId: string, on: boolean) {
    const s = await pool.session(sourceId);
    try {
      const jar = s.page.context();
      await jar.clearCookies();
      if (on) {
        const expires = Math.floor(Date.now() / 1000) + 3600;
        await jar.addCookies([
          { name: 'kc', value: '1', url: server.url, expires },
          { name: 'KEYCLOAK_SESSION', value: 'test', url: `${server.url}/auth/realms/test/`, expires },
        ]);
      }
    } finally {
      await s.close();
    }
  }

  const listing = (contact: Listing['contact'] = 'form'): Listing => ({
    id: 'woonnet-rijnmond:100123313',
    sourceId: 'woonnet-rijnmond',
    externalId: '100123313',
    url: `${server.url}/nl-NL/aanbod/advertentie/${SLUG}`,
    title: 'Proefstraat 1',
    address: { street: 'Proefstraat', houseNumber: '1', city: 'Rotterdam' },
    contact,
    extra: { publicationId: PUBLICATION },
    propertyId: null,
    firstSeenAt: '2026-09-24T08:00:00Z',
    lastSeenAt: '2026-09-24T08:00:00Z',
    state: 'active',
    via: 'poll',
  });

  const message = (dryRun: boolean): OutboundMessage => ({
    body: 'Graag reageer ik op deze woning.',
    language: 'nl',
    profile: ConfigSchema.parse({}).profile,
    dryRun,
  });

  const calls = (name: string) => server.requests.filter((r) => r.path === '/graphql' && operation(r) === name);

  test('checkSession: no Keycloak cookie is no session; with one, the portal page must send a token', async () => {
    const a = adapter();
    await setSession(a.id, false);
    const pageLoads = server.requests.filter((r) => r.path === '/nl-NL').length;
    expect(await a.checkSession!(context(a.id))).toBe('none');
    expect(server.requests.filter((r) => r.path === '/nl-NL').length).toBe(pageLoads);
    await setSession(a.id, true);
    expect(await a.checkSession!(context(a.id))).toBe('ok');
  });

  test('without a session contact throws NeedsLoginError and applies nothing', async () => {
    const a = adapter();
    await setSession(a.id, false);
    const before = calls('widgetSharedFloatingReactionApplyUnit').length;
    const error = await a.contact!(listing(), message(false), context(a.id)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NeedsLoginError);
    expect((error as NeedsLoginError).loginUrl).toBe(`${server.url}/nl-NL`);
    expect(calls('widgetSharedFloatingReactionApplyUnit').length).toBe(before);
  });

  test('a dry run runs the precheck with the session and applies nothing', async () => {
    const a = adapter();
    await setSession(a.id, true);
    const before = calls('widgetSharedFloatingReactionApplyUnit').length;
    const result = await a.contact!(listing(), message(true), context(a.id));
    expect(result).toEqual({ ok: true, channel: 'form', evidence: 'dry run: logged in and the precheck allows a reaction; nothing was sent' });
    const precheck = calls('widgetReactionGetPrecheckStatus').at(-1);
    expect(precheck?.headers.authorization).toBe('Bearer test-token');
    expect(JSON.parse(precheck?.body ?? '{}').variables).toEqual({ slug: PUBLICATION, locale: 'nl-NL' });
    expect(calls('widgetSharedFloatingReactionApplyUnit').length).toBe(before);
  });

  test('applies with the page token and the portal headers', async () => {
    const a = adapter();
    await setSession(a.id, true);
    const result = await a.contact!(listing(), message(false), context(a.id));
    expect(result).toEqual({ ok: true, channel: 'form', evidence: 'reaction registered (APPLIED)' });
    const apply = calls('widgetSharedFloatingReactionApplyUnit').at(-1);
    expect(apply?.headers.authorization).toBe('Bearer test-token');
    expect(apply?.headers['x-ec-tenant-id']).toBe('woonnetrijnmond');
    expect(apply?.headers['x-ec-portal-id']).toBe(woonnetRijnmond.portalId);
    expect(JSON.parse(apply?.body ?? '{}').variables).toEqual({ publicationId: PUBLICATION, interestedInAlternatives: false, locale: 'nl-NL' });
  });

  test('a precheck that says no is passed on to a person without applying', async () => {
    const a = adapter();
    await setSession(a.id, true);
    scenario.precheck = { state: 'NOT_ELIGIBLE', canApply: false, description: 'Je inkomen is te hoog voor deze woning', userErrors: [] };
    const before = calls('widgetSharedFloatingReactionApplyUnit').length;
    const result = await a.contact!(listing(), message(false), context(a.id));
    expect(result).toMatchObject({ ok: false, needs: 'human' });
    expect(result.error).toContain('Je inkomen is te hoog');
    expect(calls('widgetSharedFloatingReactionApplyUnit').length).toBe(before);
  });

  test('errors from the apply mutation are reported', async () => {
    const a = adapter();
    await setSession(a.id, true);
    scenario.apply = { state: null, userErrors: [{ field: 'publicationId', message: [{ locale: 'nl-NL', text: 'De reactietermijn is verlopen' }] }] };
    const result = await a.contact!(listing(), message(false), context(a.id));
    expect(result).toMatchObject({ ok: false, channel: 'form' });
    expect(result.error).toContain('De reactietermijn is verlopen');
  });

  test('an external offer is handed to a person without opening the portal', async () => {
    const a = adapter();
    const result = await a.contact!(listing('none'), message(false), context(a.id));
    expect(result).toMatchObject({ ok: false, needs: 'human' });
  });
});
