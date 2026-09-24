import { chmodSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { resolvePaths } from '@nlpf/core';
import { ensureToken } from '../src/token.js';

function paths() {
  const p = resolvePaths({ NLPF_HOME: mkdtempSync(join(tmpdir(), 'nlpf-token-')) });
  mkdirSync(dirname(p.tokenFile), { recursive: true });
  return p;
}
const mode = (file: string) => statSync(file).mode & 0o777;

describe.skipIf(process.platform === 'win32')('ensureToken', () => {
  test('creates a 64-character token readable only by the user', () => {
    const p = paths();
    const token = ensureToken(p);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(readFileSync(p.tokenFile, 'utf8')).toBe(`${token}\n`);
    expect(mode(p.tokenFile)).toBe(0o600);
  });

  test('keeps a token that is already there', () => {
    const p = paths();
    const first = ensureToken(p);
    expect(ensureToken(p)).toBe(first);
  });

  test('replaces a short token and tightens a loose mode before writing', () => {
    const p = paths();
    writeFileSync(p.tokenFile, 'short\n');
    chmodSync(p.tokenFile, 0o644);
    const token = ensureToken(p);
    expect(token).not.toBe('short');
    expect(mode(p.tokenFile)).toBe(0o600);
    expect(readFileSync(p.tokenFile, 'utf8')).toBe(`${token}\n`);
  });
});
