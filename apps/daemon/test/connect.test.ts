import { expect, test, vi } from 'vitest';
import type { SourceView } from '@nlpf/core';
import { createApp } from '../src/api/app.js';
import type { DaemonActions } from '../src/context.js';
import { fakeContext, req } from './helpers.js';

const source = (id: string, canConnect: boolean) =>
  ({ sourceId: id, name: id === 'pararius' ? 'Pararius' : 'Marktplaats', enabled: true, health: 'ok', canConnect }) as unknown as SourceView;

function app() {
  const connectSource = vi.fn(async () => undefined);
  const ctx = fakeContext({
    sources: () => [source('pararius', true), source('marktplaats', false)],
    actions: { connectSource } as unknown as DaemonActions,
  });
  return { app: createApp(ctx), connectSource };
}

test('connect opens a login window for a source with a login', async () => {
  const { app: a, connectSource } = app();
  const res = await a.fetch(req('/api/v1/sources/pararius/connect', { method: 'POST' }));
  expect(res.status).toBe(202);
  expect(connectSource).toHaveBeenCalledWith('pararius');
});

test('connect says so, instead of claiming a window opens, for a source without a login', async () => {
  const { app: a, connectSource } = app();
  const res = await a.fetch(req('/api/v1/sources/marktplaats/connect', { method: 'POST' }));
  expect(res.status).toBe(400);
  expect((await res.json()).error.message).toMatch(/Marktplaats has no login/);
  expect(connectSource).not.toHaveBeenCalled();
});

test('connect to an unknown source is a 404', async () => {
  const { app: a } = app();
  expect((await a.fetch(req('/api/v1/sources/nope/connect', { method: 'POST' }))).status).toBe(404);
});
