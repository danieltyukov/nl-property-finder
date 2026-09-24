import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { sandbox, type TestSandbox } from './helpers.js';

let box: TestSandbox;

beforeAll(async () => {
  box = await sandbox();
});
afterAll(async () => {
  await box.stop();
});
afterEach(() => {
  box.control.reset();
});

const get = (path: string, init?: RequestInit) => fetch(`${box.url}${path}`, init);
const postJson = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${box.url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
    body: JSON.stringify(body),
  });

describe('Huisje search API', () => {
  test('filters on the server by city, price, size and type', async () => {
    const res = await get('/huisje/api/search?city=rotterdam&priceMax=1200&sizeMin=40');
    const data = (await res.json()) as { items: { id: string; address: { city: string }; price: { amount: number }; size: number }[]; total: number };
    expect(data.items.length).toBeGreaterThan(0);
    expect(data.total).toBe(data.items.length);
    for (const i of data.items) {
      expect(i.address.city).toBe('Rotterdam');
      expect(i.price.amount).toBeLessThanOrEqual(1200);
      expect(i.size).toBeGreaterThanOrEqual(40);
    }
    const studios = (await (await get('/huisje/api/search?type=studio')).json()) as { items: { type: string }[] };
    expect(studios.items.length).toBeGreaterThan(0);
    expect(studios.items.every((i) => i.type === 'studio')).toBe(true);
  });

  test('pages through results newest first', async () => {
    const one = (await (await get('/huisje/api/search?pageSize=5&page=1')).json()) as { items: { id: string; publishedAt: string }[]; pages: number; total: number };
    const two = (await (await get('/huisje/api/search?pageSize=5&page=2')).json()) as { items: { id: string }[] };
    expect(one.items).toHaveLength(5);
    expect(one.pages).toBe(Math.ceil(one.total / 5));
    expect(two.items.map((i) => i.id)).not.toContain(one.items[0]!.id);
    const times = one.items.map((i) => i.publishedAt);
    expect([...times].sort().reverse()).toEqual(times);
  });

  test('a new listing shows up first; a removed one disappears and its pages answer 404', async () => {
    const added = box.control.addListing();
    const data = (await (await get('/huisje/api/search?city=delft')).json()) as { items: { id: string }[] };
    expect(data.items[0]!.id).toBe(added.id);
    expect((await get(`/huisje/listing/${added.id}`)).status).toBe(200);
    box.control.removeListing(added.id);
    const after = (await (await get('/huisje/api/search?city=delft')).json()) as { items: { id: string }[] };
    expect(after.items.map((i) => i.id)).not.toContain(added.id);
    expect((await get(`/huisje/listing/${added.id}`)).status).toBe(404);
    expect((await get(`/huisje/api/listings/${added.id}`)).status).toBe(404);
  });
});

describe('Huisje pages and login', () => {
  test('the detail page shows the listing and a contact form', async () => {
    const html = await (await get('/huisje/listing/hj-1001')).text();
    expect(html).toContain('Tulpgracht 12-A');
    expect(html).toContain('action="/huisje/listing/hj-1001/contact"');
    expect(html).toContain('€ 1.175');
  });

  test('a person can use the contact form and gets a thank-you page', async () => {
    const res = await fetch(`${box.url}/huisje/listing/hj-1003/contact`, {
      method: 'POST',
      body: new URLSearchParams({ name: 'Sam de Vries', email: 'sam@nlpf.test', message: 'Is de kamer nog vrij?' }),
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Bedankt');
    expect(box.control.submissions()[0]).toMatchObject({ listingId: 'hj-1003', channel: 'form', message: 'Is de kamer nog vrij?' });
  });

  test('login sets a session cookie that /api/me accepts', async () => {
    expect((await get('/huisje/api/me')).status).toBe(401);
    const res = await postJson('/huisje/api/login', { email: 'sam@nlpf.test', password: 'x' });
    expect(res.status).toBe(200);
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith('huisje_session='))!;
    expect(cookie).toContain('HttpOnly');
    const me = await get('/huisje/api/me', { headers: { cookie: cookie.split(';')[0]! } });
    expect(await me.json()).toEqual({ email: 'sam@nlpf.test' });
    expect((await postJson('/huisje/api/login', { email: 'sam@nlpf.test' })).status).toBe(400);
  });

  test('with the login wall up, contact needs a session', async () => {
    box.control.setLoginRequired(true);
    const guest = await postJson('/huisje/listing/hj-1001/contact', { name: 'Sam', email: 'sam@nlpf.test', message: 'Hallo' });
    expect(guest.status).toBe(401);
    expect(await guest.json()).toMatchObject({ error: 'login_required', loginUrl: `${box.url}/huisje/login` });
    const page = await get('/huisje/listing/hj-1001');
    expect(await page.text()).toContain('Log in om te reageren');

    const login = await postJson('/huisje/api/login', { email: 'sam@nlpf.test', password: 'x' });
    const cookie = login.headers.getSetCookie()[0]!.split(';')[0]!;
    const res = await postJson('/huisje/listing/hj-1001/contact', { name: 'Sam', email: 'sam@nlpf.test', message: 'Hallo' }, { cookie });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; submissionId: string; threadId: string };
    expect(body.ok).toBe(true);
    expect(body.submissionId).toMatch(/^sub-\d+$/);
    // Ids keep counting across resets, so a daemon never mixes up old and new threads.
    expect(body.threadId).toBe(body.submissionId.replace('sub-', 'th-'));
  });

  test('the login page form logs a person in and sends them back', async () => {
    const res = await fetch(`${box.url}/huisje/login`, {
      method: 'POST',
      body: new URLSearchParams({ email: 'sam@nlpf.test', password: 'x', next: '/huisje/listing/hj-1001' }),
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/huisje/listing/hj-1001');
    expect(res.headers.getSetCookie()[0]).toMatch(/^huisje_session=/);
  });
});

describe('blocking', () => {
  test('setBlocked answers every Huisje request with 429 and leaves De Gracht and the controls alone', async () => {
    box.control.setBlocked('huisje', true, { retryAfterSec: 30 });
    const api = await get('/huisje/api/search');
    expect(api.status).toBe(429);
    expect(api.headers.get('retry-after')).toBe('30');
    expect((await get('/huisje/listing/hj-1001')).status).toBe(429);
    expect((await get('/gracht/aanbod/woningaanbod/huur/')).status).toBe(200);
    expect((await get('/_control')).status).toBe(200);
    box.control.setBlocked('huisje', false);
    expect((await get('/huisje/api/search')).status).toBe(200);
  });

  test('without retryAfterSec the 429 has no Retry-After header', async () => {
    box.control.setBlocked('gracht', true);
    const res = await get('/gracht/aanbod/woningaanbod/huur/');
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBeNull();
  });
});
