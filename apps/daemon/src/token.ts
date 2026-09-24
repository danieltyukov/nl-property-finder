import { randomBytes } from 'node:crypto';
import { closeSync, fchmodSync, openSync, readFileSync, writeSync } from 'node:fs';
import type { Paths } from '@nlpf/core';

/** The API token, created once per installation and readable only by the user. */
export function ensureToken(paths: Paths): string {
  try {
    const t = readFileSync(paths.tokenFile, 'utf8').trim();
    if (t.length >= 32) return t;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  const token = randomBytes(32).toString('hex');
  // An older file may have a looser mode: fix it on the open descriptor before writing.
  const fd = openSync(paths.tokenFile, 'w', 0o600);
  try {
    fchmodSync(fd, 0o600);
    writeSync(fd, token + '\n');
  } finally {
    closeSync(fd);
  }
  return token;
}
