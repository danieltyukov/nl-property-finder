import { expect, test } from 'vitest';
import { createApp } from '../src/api/app.js';
import { fakeContext, req, TOKEN } from './helpers.js';

const app = createApp(fakeContext());

test('missing token is 401, wrong Host is 403, foreign Origin is 403, correct token is 200', async () => {
  expect((await app.fetch(req('/api/v1/status', { token: null }))).status).toBe(401);
  expect((await app.fetch(req('/api/v1/status', { token: 'nope' }))).status).toBe(401);
  expect((await app.fetch(req('/api/v1/status', { host: 'evil.example:7431' }))).status).toBe(403);
  expect((await app.fetch(req('/api/v1/status', { headers: { origin: 'https://evil.example' } }))).status).toBe(403);
  expect((await app.fetch(req('/api/v1/status', { headers: { origin: 'http://127.0.0.1:7431' } }))).status).toBe(200);
  expect((await app.fetch(req('/api/v1/status', { host: 'localhost:7431' }))).status).toBe(200);
});

test('a token in the query works only for the calendar and the event stream', async () => {
  expect((await app.fetch(req(`/api/v1/status?token=${TOKEN}`, { token: null }))).status).toBe(401);
  expect((await app.fetch(req(`/calendar.ics?token=${TOKEN}`, { token: null }))).status).toBe(200);
});

test('responses never contain secrets', async () => {
  const res = await app.fetch(req('/api/v1/config'));
  const text = await res.text();
  expect(text).not.toContain('sk-ant-secret-value-123');
  expect(JSON.parse(text).secretsPresent).toEqual(['ANTHROPIC_API_KEY']);
});

test('the dashboard page is locked until nlpf open signs the browser in', async () => {
  const locked = await app.fetch(req('/', { token: null }));
  expect(await locked.text()).toContain('nlpf open');
  const signin = await app.fetch(req(`/?t=${TOKEN}`, { token: null }));
  expect(signin.status).toBe(302);
  const cookie = signin.headers.get('set-cookie') ?? '';
  expect(cookie).toContain('HttpOnly');
  expect(cookie).toContain('SameSite=Strict');
  const session = cookie.split(';')[0]!;
  const status = await app.fetch(req('/api/v1/status', { token: null, headers: { cookie: session } }));
  expect(status.status).toBe(200);
});

test('invalid bodies are 400 with the field path', async () => {
  const res = await app.fetch(req('/api/v1/config', { method: 'PATCH', body: JSON.stringify({ section: 'nope', value: 1 }) }));
  expect(res.status).toBe(400);
  expect((await res.json()).error.message).toContain('section');
});
