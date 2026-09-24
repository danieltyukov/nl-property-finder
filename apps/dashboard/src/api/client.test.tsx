import { expect, test, vi } from 'vitest';
import { ApiError, buildPath, createApi, httpTransport } from './client';

function fakeFetch(response: Response) {
  return vi.fn(async (_url: string, _init?: RequestInit) => response);
}

test('paths come from ROUTES with the API prefix, encoded parameters and a query', () => {
  expect(buildPath({ method: 'GET', path: '/properties/:id' }, { params: { id: 'p 1/2' } })).toBe('/api/v1/properties/p%201%2F2');
  expect(buildPath({ method: 'GET', path: '/tasks' }, { query: { state: 'open', empty: '', none: undefined } })).toBe('/api/v1/tasks?state=open');
  expect(() => buildPath({ method: 'GET', path: '/properties/:id' })).toThrow(/Missing path parameter/);
});

test('every request carries X-NLPF-Token and JSON bodies', async () => {
  const fetch = fakeFetch(new Response(JSON.stringify({ id: 't1', state: 'done' }), { headers: { 'content-type': 'application/json' } }));
  const api = createApi(httpTransport({ token: () => 's3cret', fetch: fetch as unknown as typeof globalThis.fetch }));
  const result = await api.resolveTask('t1', { action: 'approve' });
  expect(result).toEqual({ id: 't1', state: 'done' });
  const [url, init] = fetch.mock.calls[0]!;
  expect(url).toBe('/api/v1/tasks/t1/resolve');
  expect(init?.method).toBe('POST');
  expect((init?.headers as Record<string, string>)['X-NLPF-Token']).toBe('s3cret');
  expect(init?.body).toBe(JSON.stringify({ action: 'approve' }));
});

test('patchConfig sends the section and value the daemon validates', async () => {
  const fetch = fakeFetch(new Response(null, { status: 204 }));
  const api = createApi(httpTransport({ token: () => 't', fetch: fetch as unknown as typeof globalThis.fetch }));
  await api.patchConfig('profile', { firstName: 'Sam' });
  const [url, init] = fetch.mock.calls[0]!;
  expect(url).toBe('/api/v1/config');
  expect(init?.method).toBe('PATCH');
  expect(JSON.parse(String(init?.body))).toEqual({ section: 'profile', value: { firstName: 'Sam' } });
});

test('the daemon error shape becomes an ApiError with code and message', async () => {
  const fetch = fakeFetch(
    new Response(JSON.stringify({ error: { code: 'invalid_body', message: 'searches.0.priceMaxEur: expected number' } }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    }),
  );
  const api = createApi(httpTransport({ token: () => 't', fetch: fetch as unknown as typeof globalThis.fetch }));
  const error = await api.config().catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ApiError);
  expect(error).toMatchObject({ status: 400, code: 'invalid_body', message: 'searches.0.priceMaxEur: expected number' });
});
