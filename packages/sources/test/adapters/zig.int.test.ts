import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { ConfigSchema, memoryLogger, type Listing, type OutboundMessage } from '@nlpf/core';
import { createZigAdapter, ZIG_PATHS, type ZigReactionData } from '../../src/generic/zig.js';
import { woonnetHaaglanden } from '../../src/instances/woonnet-haaglanden.js';
import { createBrowserPool, type BrowserPool } from '../../src/runtime/browser.js';
import { resolveChromium } from '../../src/runtime/chromium.js';
import { createSourceContext } from '../../src/runtime/context.js';
import { NeedsLoginError } from '../../src/runtime/errors.js';
import { createPoliteFetch } from '../../src/runtime/fetch.js';
import { readFixture, startFixtureServer, type FixtureServer, type ServerRequest } from '../../src/testing.js';

const OBJECT = JSON.parse(readFixture('zig-woonnet-haaglanden/getobject.json')) as { result: Record<string, unknown> };
const SESSION = 'PHPSESSID=logged-in';

interface Scenario {
  reaction: ZigReactionData;
  closesAfterFirstReaction: boolean;
  /** Whether a posted reaction shows up among the active reactions. */
  listReaction: boolean;
}

describe.skipIf(!resolveChromium())('Zig portal reaction in a real browser (local portal)', () => {
  let server: FixtureServer;
  let pool: BrowserPool;
  let dir: string;
  let scenario: Scenario;
  let active: string[] = [];

  const loggedIn = (req: ServerRequest) => (req.headers.cookie ?? '').includes(SESSION);

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'nlpf-zig-'));
    pool = createBrowserPool({ dir, log: memoryLogger() });
    server = await startFixtureServer({
      [`POST ${ZIG_PATHS.object}`]: (req) => {
        const id = new URLSearchParams(req.body).get('id');
        if (id !== '266497') return { body: { sAngularServiceData: '[]', result: null } };
        const reactionData = { ...scenario.reaction, loggedin: loggedIn(req) };
        const model = { ...(OBJECT.result.model as object), advertentieSluitenNaEersteReactie: scenario.closesAfterFirstReaction };
        return { body: { sAngularServiceData: '[]', result: { ...OBJECT.result, model, reactionData } } };
      },
      [`GET ${ZIG_PATHS.formConfig}`]: 'zig-woonnet-haaglanden/formconfig.json',
      [`POST ${ZIG_PATHS.react}`]: (req) => {
        if (!loggedIn(req)) return { body: { sAngularServiceData: '[]', success: false } };
        const dwelling = new URLSearchParams(req.body).get('dwellingID') ?? '';
        if (scenario.listReaction) active.push(dwelling);
        return { body: { sAngularServiceData: '[]', success: true, reactionId: 555, messages: [] } };
      },
      [`POST ${ZIG_PATHS.activeReactions}`]: (req) => ({
        body: { sAngularServiceData: '[]', result: { items: loggedIn(req) ? active.map((id) => ({ id: 555, object: { id } })) : [] } },
      }),
      [`POST ${ZIG_PATHS.account}`]: (req) =>
        loggedIn(req)
          ? { body: { sAngularServiceData: '[]', account: { username: 'sam', persons: [{}] } } }
          : { file: 'zig-woonnet-haaglanden/getaccount-anonymous.json' },
    });
  });

  afterAll(async () => {
    await pool.closeAll();
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    active = [];
    scenario = {
      reaction: { kanReageren: true, action: 'add', url: '?add=168867&dwellingID=266497', redenMagNietReagerenCode: null },
      closesAfterFirstReaction: false,
      listReaction: true,
    };
  });

  const adapter = () => createZigAdapter({ ...woonnetHaaglanden, homepage: server.url }, { confirmTimeoutMs: 1_500 });

  const context = (sourceId: string) =>
    createSourceContext({
      fetch: createPoliteFetch({ minGapMs: 0, log: memoryLogger() }),
      pool,
      log: memoryLogger(),
      config: ConfigSchema.parse({ profile: { firstName: 'Sam', lastName: 'de Vries', email: 'sam@nlpf.test' } }),
      sourceId,
      signal: new AbortController().signal,
    });

  async function setSession(sourceId: string, on: boolean) {
    const s = await pool.session(sourceId);
    try {
      const jar = s.page.context();
      await jar.clearCookies();
      if (on) {
        await jar.addCookies([
          { name: 'PHPSESSID', value: 'logged-in', url: server.url, expires: Math.floor(Date.now() / 1000) + 3600 },
        ]);
      }
    } finally {
      await s.close();
    }
  }

  const listing = (): Listing => ({
    id: 'woonnet-haaglanden:266497',
    sourceId: 'woonnet-haaglanden',
    externalId: '266497',
    url: `${server.url}/aanbod/nu-te-huur/te-huur/details/266497-janwillemfrisostraat-52-delft`,
    title: 'Jan Willem Frisostraat 52',
    address: { street: 'Jan Willem Frisostraat', houseNumber: '52', city: 'Delft' },
    contact: 'form',
    extra: { objectId: '266497' },
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

  const reactPosts = () => server.requests.filter((r) => r.method === 'POST' && r.path === ZIG_PATHS.react);

  test('checkSession reads the account with the cookies of the persistent profile', async () => {
    const a = adapter();
    await setSession(a.id, false);
    expect(await a.checkSession!(context(a.id))).toBe('none');
    await setSession(a.id, true);
    expect(await a.checkSession!(context(a.id))).toBe('ok');
  });

  test('without a session contact throws NeedsLoginError and posts nothing', async () => {
    const a = adapter();
    await setSession(a.id, false);
    const before = reactPosts().length;
    const error = await a.contact!(listing(), message(false), context(a.id)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NeedsLoginError);
    expect((error as NeedsLoginError).loginUrl).toBe(`${server.url}/redirect?code=portal-login-page`);
    expect(reactPosts().length).toBe(before);
  });

  test('a dry run checks the session and the form token and does not react', async () => {
    const a = adapter();
    await setSession(a.id, true);
    const before = reactPosts().length;
    const result = await a.contact!(listing(), message(true), context(a.id));
    expect(result).toEqual({ ok: true, channel: 'form', evidence: 'dry run: logged in and the portal accepts a reaction; nothing was sent' });
    expect(reactPosts().length).toBe(before);
    expect(server.requests.some((r) => r.path === ZIG_PATHS.formConfig)).toBe(true);
  });

  test('reacts with the form token and the parameters the portal gave, then confirms it among the active reactions', async () => {
    const a = adapter();
    await setSession(a.id, true);
    const result = await a.contact!(listing(), message(false), context(a.id));
    expect(result).toEqual({ ok: true, channel: 'form', externalId: '555', evidence: 'the reaction is listed among the active reactions' });
    const post = reactPosts().at(-1);
    expect(post?.headers['content-type']).toContain('application/x-www-form-urlencoded');
    expect(post?.headers['x-requested-with']).toBe('XMLHttpRequest');
    expect(Object.fromEntries(new URLSearchParams(post?.body))).toEqual({
      __id__: 'Portal_Form_SubmitOnly',
      __hash__: '0123456789abcdef0123456789abcdef',
      add: '168867',
      dwellingID: '266497',
    });
  });

  test('an existing reaction is reported as done and never withdrawn', async () => {
    const a = adapter();
    await setSession(a.id, true);
    scenario.reaction = { kanReageren: true, action: 'remove', url: '?remove=999&dwellingID=266497' };
    const before = reactPosts().length;
    const result = await a.contact!(listing(), message(false), context(a.id));
    expect(result).toMatchObject({ ok: true, channel: 'form' });
    expect(result.evidence).toContain('already reacted');
    expect(reactPosts().length).toBe(before);
  });

  test('an ad that books the home for good on the first reaction is left to a person', async () => {
    const a = adapter();
    await setSession(a.id, true);
    scenario.closesAfterFirstReaction = true;
    const before = reactPosts().length;
    const result = await a.contact!(listing(), message(false), context(a.id));
    expect(result).toMatchObject({ ok: false, channel: 'form', needs: 'human' });
    expect(result.error).toContain('definitief boeken');
    expect(reactPosts().length).toBe(before);
  });

  test('a refusal code from the portal is passed on without posting', async () => {
    const a = adapter();
    await setSession(a.id, true);
    scenario.reaction = { kanReageren: false, action: 'add', url: '', redenMagNietReagerenCode: 'WINKEL-REACTIE-MAXIMUM' };
    const before = reactPosts().length;
    const result = await a.contact!(listing(), message(false), context(a.id));
    expect(result).toMatchObject({ ok: false, needs: 'human' });
    expect(result.error).toContain('WINKEL-REACTIE-MAXIMUM');
    scenario.reaction = { kanReageren: false, action: 'add', url: '', redenMagNietReagerenCode: 'WINKEL-REACTIE-DUBBEL' };
    expect(await a.contact!(listing(), message(false), context(a.id))).toMatchObject({ ok: true, evidence: 'already reacted' });
    expect(reactPosts().length).toBe(before);
  });

  test('a reaction that does not show up among the active reactions asks a person to check', async () => {
    const a = adapter();
    await setSession(a.id, true);
    scenario.listReaction = false;
    const result = await a.contact!(listing(), message(false), context(a.id));
    expect(result).toMatchObject({ ok: false, channel: 'form', needs: 'human' });
  });
});
