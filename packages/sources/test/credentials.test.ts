import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { findCredentials, scrubCredentials } from '../src/index.js';

// Sample keys are assembled at run time so this file never holds one.
const googleKey = ['AI', 'za', 'Sy', 'D'.repeat(33)].join('');
const githubToken = ['gh', 'p_', 'a1'.repeat(18)].join('');

describe('scrubCredentials', () => {
  test('replaces a Google Maps key in a data attribute and in a static map URL', () => {
    const page = [
      `<div data-google-maps-api-key="${googleKey}"></div>`,
      `<img src="https://maps.googleapis.com/maps/api/staticmap?center=52,4&amp;key=${googleKey}&amp;markers=52,4">`,
    ].join('\n');
    expect(findCredentials(page).map((h) => [h.name, h.line])).toEqual([
      ['Google API key', 1],
      ['Google API key', 2],
    ]);
    const clean = scrubCredentials(page);
    expect(clean).not.toContain(googleKey);
    expect(clean).toContain('data-google-maps-api-key="AIza-redacted"');
    expect(clean).toContain('&amp;key=AIza-redacted&amp;markers');
  });

  test('scrubbing twice changes nothing, and the placeholders are not found again', () => {
    const text = `a ${googleKey} b ${githubToken} c`;
    const once = scrubCredentials(text);
    expect(scrubCredentials(once)).toBe(once);
    expect(findCredentials(once)).toEqual([]);
  });

  test('a hit shows only the start of the match', () => {
    const [hit] = findCredentials(`token=${githubToken}`);
    expect(hit?.preview).toBe(`${githubToken.slice(0, 8)}...`);
  });

  test('leaves ordinary text alone, including the short fake keys the tests use', () => {
    const text = 'AIza-redacted sk-ant-api03-abcDEF_123-xyz key=1234 AKIA12';
    expect(scrubCredentials(text)).toBe(text);
  });
});

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const BINARY = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.woff', '.woff2', '.ttf', '.otf', '.pdf', '.glb', '.mp4', '.webm', '.zip', '.gz']);

function repoFiles(): string[] | undefined {
  try {
    const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: REPO, encoding: 'utf8' });
    return out.split('\0').filter(Boolean);
  } catch {
    return undefined;
  }
}

const files = repoFiles();

describe.skipIf(!files)('the repository', () => {
  test('holds no credential-shaped strings (recorded pages included)', () => {
    const found: string[] = [];
    for (const rel of files!) {
      if (BINARY.has(extname(rel).toLowerCase())) continue;
      const abs = join(REPO, rel);
      let text: string;
      try {
        if (!statSync(abs).isFile()) continue;
        text = readFileSync(abs, 'utf8');
      } catch {
        continue; // listed by git but deleted in the working tree
      }
      if (text.includes('\0')) continue;
      for (const h of findCredentials(text)) found.push(`${rel}:${h.line} ${h.name} (${h.preview})`);
    }
    expect(found, 'scrub these with scrubCredentials, or re-record the fixture').toEqual([]);
  });
});
