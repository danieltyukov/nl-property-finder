import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The hash of the scene source: every `src/stage/*.ts` file, by name and
 * content. The posters are renders of that source, so `stills.json` records
 * the hash it was rendered from and the budget test fails when they differ.
 * Line endings are normalised so a checkout on Windows gives the same hash.
 */
export function sceneHash(): string {
  const dir = fileURLToPath(new URL('../src/stage/', import.meta.url));
  const h = createHash('sha256');
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.ts')).sort()) {
    h.update(name).update('\0').update(readFileSync(dir + name, 'utf8').replace(/\r\n/g, '\n')).update('\0');
  }
  return h.digest('hex').slice(0, 16);
}
