import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { sceneHash } from '../scripts/scene-hash';

/*
 * The performance budget as a test: a real `vite build` into a temporary
 * directory, then the gzip sizes (GitHub Pages serves gzip) checked against
 * `.size-limit.json`, which keeps the numbers in size-limit's format so a CI
 * step can run size-limit on the same file. No new dependency is needed.
 */
const site = fileURLToPath(new URL('..', import.meta.url));
interface Limit { name: string; path: string; limit: string; gzip: boolean }
const limits = JSON.parse(readFileSync(join(site, '.size-limit.json'), 'utf8')) as Limit[];
let out = '';

beforeAll(async () => {
  out = mkdtempSync(join(tmpdir(), 'nlpf-site-'));
  // Vitest sets NODE_ENV to "test", which would make this a development build.
  const env = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    await build({ configFile: join(site, 'vite.config.ts'), root: site, mode: 'production', logLevel: 'silent', build: { outDir: out, emptyOutDir: true } });
  } finally {
    process.env.NODE_ENV = env;
  }
}, 180_000);

afterAll(() => {
  if (out) rmSync(out, { recursive: true, force: true });
});

/** The files a size-limit path matches, with `*` and `{a,b}` as its only glob syntax. */
function matching(pattern: string): string[] {
  const rel = pattern.replace(/^dist\//, '');
  const dir = join(out, dirname(rel));
  const re = new RegExp(
    `^${basename(rel)
      .replace(/[.+^$()|[\]\\]/g, '\\$&')
      .replace(/\{([^}]+)\}/g, (_, alt: string) => `(${alt.split(',').join('|')})`)
      .replace(/\*/g, '[^/]*')}$`,
  );
  return readdirSync(dir).filter((f) => re.test(f)).map((f) => join(dir, f));
}

const bytes = (f: string, gzip: boolean) => (gzip ? gzipSync(readFileSync(f), { level: 9 }).length : statSync(f).size);
const read = (pattern: string) => matching(pattern).map((f) => readFileSync(f, 'utf8')).join('\n');

describe('size budget', () => {
  for (const l of limits) {
    test(`${l.name}: ${l.limit}${l.gzip ? ' gzip' : ''}`, () => {
      const files = matching(l.path);
      expect(files.length, l.path).toBeGreaterThan(0);
      const kb = files.reduce((n, f) => n + bytes(f, l.gzip), 0) / 1024;
      expect(kb).toBeLessThanOrEqual(Number.parseFloat(l.limit));
    });
  }
});

describe('what loads when', () => {
  test('three.js is only in the stage chunk, GSAP only in the motion chunk', () => {
    const main = read('dist/assets/main-*.js');
    expect(main).not.toMatch(/WebGLRenderer|__THREE__/);
    expect(main).not.toMatch(/gsap|GreenSock/i);
    expect(read('dist/assets/stage-*.js')).toMatch(/WebGLRenderer|__THREE__/);
    expect(read('dist/assets/motion-*.js')).toMatch(/GreenSock|gsap/i);
  });

  test('nothing is preloaded at page load except the fonts and the poster', () => {
    const html = readFileSync(join(out, 'index.html'), 'utf8');
    expect(html).not.toContain('modulepreload');
    expect(html.match(/rel="preload"/g)).toHaveLength(2);
  });

  test('the entry never runs requestAnimationFrame, and ScrollTrigger (which keeps a loop running) is not shipped', () => {
    expect(read('dist/assets/main-*.js')).not.toContain('requestAnimationFrame');
    // GSAP core names the ScrollTrigger global; the plugin itself would bring these.
    expect(read('dist/assets/motion-*.js')).not.toMatch(/pinSpacing|scrollerProxy/);
  });

  test('development hooks are not in the production stage', () => {
    expect(read('dist/assets/stage-*.js')).not.toContain('__nlpf');
  });
});

describe('posters', () => {
  test("stills.json was rendered from the current scene source", () => {
    const stills = JSON.parse(readFileSync(join(site, 'src/stage/stills.json'), 'utf8')) as { hash: string; anchors: Record<string, number[]> };
    expect(stills.hash, 'posters are stale: run npx tsx site/scripts/render-stills.ts').toBe(sceneHash());
    expect(Object.keys(stills.anchors)).toContain('k0.w32');
  });

  test('every anchor in the HTML got its position from stills.json', () => {
    const html = readFileSync(join(out, 'index.html'), 'utf8');
    for (const [, id, style] of html.matchAll(/data-anchor="([\w.]+)"( style="[^"]*--ax:[^"]*")?/g)) expect(style, id).toBeTruthy();
  });
});
