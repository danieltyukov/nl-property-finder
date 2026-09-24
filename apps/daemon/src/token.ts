import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { Paths } from '@nlpf/core';

/** The API token, created once per installation and readable only by the user. */
export function ensureToken(paths: Paths): string {
  if (existsSync(paths.tokenFile)) {
    const t = readFileSync(paths.tokenFile, 'utf8').trim();
    if (t.length >= 32) return t;
  }
  const token = randomBytes(32).toString('hex');
  writeFileSync(paths.tokenFile, token + '\n', { mode: 0o600 });
  chmodSync(paths.tokenFile, 0o600);
  return token;
}
