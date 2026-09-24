import { afterEach, describe, expect, test } from 'vitest';
import {
  CATALOGUE,
  demoSeed,
  type SandboxListing,
  type Submission,
  type ThreadMessage,
} from '../src/index.js';
import { sandbox, waitFor, type TestSandbox } from './helpers.js';

const boxes: TestSandbox[] = [];
async function start(opts: Parameters<typeof sandbox>[0] = {}) {
  const box = await sandbox(opts);
  boxes.push(box);
  return box;
}
afterEach(async () => {
  await Promise.all(boxes.splice(0).map((b) => b.stop()));
});

const call = async <T>(
  box: TestSandbox,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: T }> => {
  const res = await fetch(`${box.url}/_control${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json()) as T };
};

describe('starting listings', () => {
  test('the whole catalogue by default', async () => {
    const box = await start();
    expect(box.control.listings()).toHaveLength(CATALOGUE.length);
    const copy = box.control.listings().find((l) => l.id === 'dg-2001')!;
    expect(copy.duplicateOf).toBe('hj-1001');
  });

  test('demoSeed puts five catalogue listings online; publishNext adds the rest one by one', async () => {
    const box = await start({ listings: demoSeed() });
    expect(
      box.control
        .listings()
        .map((l) => l.key)
        .sort(),
    ).toEqual(
      demoSeed()
        .map((i) => i.key)
        .sort(),
    );
    const next = box.control.publishNext()!;
    expect(demoSeed().map((i) => i.key)).not.toContain(next.key);
    expect(box.control.listings()).toHaveLength(6);
  });

  test('drip publishes held catalogue listings on a timer scaled by speed', async () => {
    const box = await start({ listings: 'none', drip: { everySec: 10 }, speed: 1000 });
    expect(box.control.state().drip).toBe(true);
    await waitFor(() => (box.control.listings().length >= 3 ? true : undefined));
    box.control.setDrip(false);
    const n = box.control.listings().length;
    await new Promise((r) => setTimeout(r, 60));
    expect(box.control.listings()).toHaveLength(n);
  });
});

describe('addListing', () => {
  test('defaults to a Delft apartment on Huisje that fits a 1400 budget', async () => {
    const box = await start({ listings: 'none' });
    for (let i = 0; i < 10; i++) {
      const l = box.control.addListing();
      expect(l).toMatchObject({
        source: 'huisje',
        city: 'Delft',
        type: 'apartment',
        status: 'available',
        language: 'nl',
      });
      expect(l.priceEur + (l.serviceCostsEur ?? 0)).toBeLessThanOrEqual(1400);
      expect(l.postcode).toMatch(/^26(1[1-9]|2\d) [A-Z]{2}$/);
      expect(l.description).toMatch(/m² in Delft/);
    }
    expect(new Set(box.control.listings().map((l) => `${l.street} ${l.houseNumber}`)).size).toBe(10);
  });

  test('scenarios: scam, geen studenten, inschrijven niet mogelijk', async () => {
    const box = await start({ listings: 'none' });
    const scam = box.control.addListing({ scenario: 'scam' });
    expect(scam.priceEur).toBeLessThan(500);
    expect(scam.description).toMatch(/abroad/);
    expect(scam.description).toMatch(/keys by post/);
    expect(scam.scenarios).toEqual(['scam']);
    expect(
      box.control.addListing({ scenario: 'no_students', source: 'gracht', city: 'Den Haag' }).description,
    ).toContain('Geen studenten');
    expect(box.control.addListing({ scenario: 'no_registration', city: 'Rotterdam' })).toMatchObject({
      type: 'room',
      description: expect.stringContaining('Inschrijven op dit adres is niet mogelijk'),
    });
  });

  test('duplicateOf puts the same home on the other source with the address written differently', async () => {
    const box = await start({ listings: 'none' });
    const original = box.control.addListing({
      street: 'Tulpgracht',
      houseNumber: '40',
      addition: 'B',
      postcode: '2611 AB',
    });
    expect(original.addressText).toBe('Tulpgracht 40-B');
    const copy = box.control.addListing({ duplicateOf: original.id });
    expect(copy).toMatchObject({
      source: 'gracht',
      duplicateOf: original.id,
      street: 'Tulpgracht',
      houseNumber: '40',
      addition: 'B',
      postcode: '2611 AB',
      priceEur: original.priceEur,
      sizeM2: original.sizeM2,
      landlord: { kind: 'makelaar' },
    });
    expect(copy.addressText).not.toBe(original.addressText);
    expect(copy.title).toBe(copy.addressText);
  });

  test('a catalogue key can be published once', async () => {
    const box = await start({ listings: 'none' });
    expect(box.control.addListing({ key: 'rotterdam-veerpontkade-112c' }).id).toBe('hj-1009');
    expect(() => box.control.addListing({ key: 'rotterdam-veerpontkade-112c' })).toThrow(/already online/);
    expect(() => box.control.addListing({ key: 'nope' })).toThrow(/no catalogue listing/);
  });
});

describe('/_control over HTTP', () => {
  test('add, list, remove and reset', async () => {
    const box = await start({ listings: 'none' });
    const added = await call<SandboxListing>(box, 'POST', '/listings', { city: 'Rotterdam', priceEur: 1100 });
    expect(added.status).toBe(201);
    expect(added.data).toMatchObject({ city: 'Rotterdam', priceEur: 1100 });
    expect((await call<{ listings: SandboxListing[] }>(box, 'GET', '/listings')).data.listings).toHaveLength(
      1,
    );
    expect((await call(box, 'DELETE', `/listings/${added.data.id}`)).status).toBe(200);
    expect((await call<{ listings: SandboxListing[] }>(box, 'GET', '/listings')).data.listings).toHaveLength(
      0,
    );
    expect(
      (await call<{ listings: SandboxListing[] }>(box, 'GET', '/listings?includeRemoved=1')).data.listings,
    ).toHaveLength(1);
    expect((await call(box, 'DELETE', '/listings/nope')).status).toBe(404);
    expect((await call(box, 'POST', '/listings', { key: 'nope' })).status).toBe(400);
    await call(box, 'POST', '/reset');
    expect(box.control.listings()).toHaveLength(0);
  });

  test('submissions, landlord replies, agent email and switches', async () => {
    const box = await start({ listings: demoSeed() });
    await fetch(`${box.url}/huisje/listing/hj-1001/contact`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ name: 'Sam de Vries', email: 'sam@nlpf.test', message: 'Hallo' }),
    });
    const subs = (await call<{ submissions: Submission[] }>(box, 'GET', '/submissions')).data.submissions;
    expect(subs).toHaveLength(1);
    const reply = await call<ThreadMessage>(box, 'POST', `/submissions/${subs[0]!.id}/reply`, {
      kind: 'documents_request',
    });
    expect(reply.data).toMatchObject({ from: 'landlord', kind: 'documents_request', channel: 'platform' });
    expect((await call(box, 'POST', `/submissions/${subs[0]!.id}/reply`, { kind: 'hug' })).status).toBe(400);
    expect((await call(box, 'POST', '/submissions/sub-999/reply', { kind: 'offer' })).status).toBe(404);
    expect((await call<Submission>(box, 'GET', `/submissions/${subs[0]!.id}`)).data.messages).toHaveLength(2);

    const mail = await call<{ submissionId: string | null }>(box, 'POST', '/mail', {
      to: 'nobody@else.example',
      text: 'Hallo',
    });
    expect(mail.data.submissionId).toBeNull();
    expect((await call<{ emails: unknown[] }>(box, 'GET', '/emails')).data.emails).toHaveLength(1);

    const blocked = await call<{ blocked: { huisje: boolean } }>(box, 'POST', '/blocked', {
      source: 'huisje',
      blocked: true,
    });
    expect(blocked.data.blocked.huisje).toBe(true);
    expect((await fetch(`${box.url}/huisje/api/search`)).status).toBe(429);
    expect((await call(box, 'POST', '/blocked', { source: 'funda', blocked: true })).status).toBe(400);
    await call(box, 'POST', '/login-required', { required: true });
    await call(box, 'POST', '/auto-reply', { enabled: true });
    expect((await call<{ state: unknown }>(box, 'GET', '')).data.state).toMatchObject({
      blocked: { huisje: true, gracht: false },
      loginRequired: true,
      autoReply: true,
    });
    const reset = await call<{ blocked: { huisje: boolean }; loginRequired: boolean; autoReply: boolean }>(
      box,
      'POST',
      '/reset',
    );
    expect(reset.data).toMatchObject({ blocked: { huisje: false }, loginRequired: false, autoReply: false });
    expect(box.control.submissions()).toHaveLength(0);
    expect(box.control.listings()).toHaveLength(5);
  });

  test('reads return copies', async () => {
    const box = await start({ listings: demoSeed() });
    const [first] = box.control.listings();
    first!.priceEur = 1;
    expect(box.control.listings()[0]!.priceEur).not.toBe(1);
  });

  test('the landing page links both sites and serves listing pictures', async () => {
    const box = await start({ listings: demoSeed() });
    const html = await (await fetch(`${box.url}/`)).text();
    expect(html).toContain('href="/huisje/"');
    expect(html).toContain('href="/gracht/"');
    const svg = await fetch(`${box.url}/media/hj-1001/1.svg`);
    expect(svg.headers.get('content-type')).toBe('image/svg+xml');
    expect(await svg.text()).toContain('currentColor');
    expect((await fetch(`${box.url}/media/nope/1.svg`)).status).toBe(404);
  });
});
