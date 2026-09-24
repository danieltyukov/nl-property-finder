import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { createApp, staticFile } from '../src/api/app.js';
import { fakeContext, req, TOKEN } from './helpers.js';

function layout() {
  const root = mkdtempSync(join(tmpdir(), 'nlpf-static-'));
  const dist = join(root, 'dist');
  mkdirSync(join(dist, 'assets'), { recursive: true });
  writeFileSync(join(dist, 'index.html'), '<html><head></head><body>app</body></html>');
  writeFileSync(join(dist, 'assets', 'app.js'), 'console.log(1)');
  mkdirSync(join(root, 'dist-other'));
  writeFileSync(join(root, 'dist-other', 'secret.txt'), 'secret');
  writeFileSync(join(root, 'outside.txt'), 'outside');
  symlinkSync(join(root, 'outside.txt'), join(dist, 'link.txt'));
  return { root, dist };
}

test('staticFile serves only real files inside the build folder', () => {
  const { dist } = layout();
  expect(staticFile(dist, '/assets/app.js')).toMatch(/assets\/app\.js$/);
  expect(staticFile(dist, '/../outside.txt')).toBeUndefined();
  expect(staticFile(dist, '/%2e%2e/outside.txt')).toBeUndefined();
  expect(staticFile(dist, '/../dist-other/secret.txt')).toBeUndefined();
  expect(staticFile(dist, '/link.txt')).toBeUndefined();
  expect(staticFile(dist, '/assets')).toBeUndefined();
  expect(staticFile(dist, '/missing.js')).toBeUndefined();
});

test('the dashboard gets its token only with the session cookie', async () => {
  const { dist } = layout();
  const app = createApp(fakeContext({ dashboardDir: dist }));
  const signin = await app.fetch(req(`/?t=${TOKEN}`, { token: null }));
  const cookie = (signin.headers.get('set-cookie') ?? '').split(';')[0]!;
  const page = await (await app.fetch(req('/', { token: null, headers: { cookie } }))).text();
  expect(page).toContain('window.__NLPF__');
  expect(page).toContain(TOKEN);
  const anonymous = await (await app.fetch(req('/', { token: null }))).text();
  expect(anonymous).not.toContain(TOKEN);
  const asset = await app.fetch(req('/assets/app.js', { token: null }));
  expect(asset.headers.get('content-type')).toContain('javascript');
  expect((await app.fetch(req('/../outside.txt', { token: null }))).status).toBe(200);
  expect(await (await app.fetch(req('/../outside.txt', { token: null }))).text()).not.toContain('outside');
});
