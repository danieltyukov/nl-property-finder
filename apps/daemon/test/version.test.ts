import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { VERSION } from '../src/start.js';

test('the daemon reports the version in its package.json, so a release bump reaches /status', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  expect(VERSION).toBe(pkg.version);
});
