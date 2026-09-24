/*
 * Renders the posters and section stills of the Street and writes
 * `src/stage/stills.json` (the projected anchors plus the scene source hash).
 * Run it after any change under `src/stage/`, and commit what it writes:
 *
 *   npx tsx site/scripts/render-stills.ts            # stills, OG image, icons
 *   npx tsx site/scripts/render-stills.ts --only=og   # one step: stills | og | icons | media
 *
 * The outputs are committed so CI never needs a GPU. Chromium comes from
 * Playwright's cache and is launched with ANGLE on Vulkan so WebGL runs on the
 * machine's GPU; when that fails it falls back to SwiftShader (slower, same
 * look). ImageMagick (`convert`, with libheif) encodes AVIF and WebP, so no
 * image library is needed in the repository.
 *
 * Budgets (docs/design/site-3d.md section 7.7): the hero poster at 1440w is
 * 65 KB or less and at 2160w 100 KB or less, each section still 60 KB or less.
 * Quality steps down until a file fits.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright-core';
import { createServer } from 'vite';
import { sceneHash } from './scene-hash';

const site = fileURLToPath(new URL('..', import.meta.url));
const stillsDir = join(site, 'public/stills');
const tmp = mkdtempSync(join(tmpdir(), 'nlpf-stills-'));
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
const run = (step: string) => !only || only === step;

type Theme = 'light' | 'dark';
interface Job { key: number; portrait?: boolean; themes: Theme[]; sizes: { w: number; h: number; dpr: number; name: string; budget: number }[] }

const LAND = { w: 1440, h: 900 };
const JOBS: Job[] = [
  { key: 0, themes: ['light', 'dark'], sizes: [{ ...LAND, dpr: 1, name: '1440', budget: 65 }, { ...LAND, dpr: 1.5, name: '2160', budget: 100 }] },
  { key: 0, portrait: true, themes: ['light', 'dark'], sizes: [{ w: 390, h: 844, dpr: 2, name: '780', budget: 60 }] },
  ...[1, 2, 4, 6, 8].map((key): Job => ({ key, themes: ['light', 'dark'], sizes: [{ ...LAND, dpr: 1, name: '1440', budget: 60 }] })),
  // The Claude band and the footer are night in both themes, so one render each.
  ...[5, 9].map((key): Job => ({ key, themes: ['dark'], sizes: [{ ...LAND, dpr: 1, name: '1440', budget: 60 }] })),
];

function kb(file: string): number {
  return statSync(file).size / 1024;
}

/** Encode a PNG to AVIF and WebP under a size budget in KB (the WebP gets 1.6 times the budget). */
function encode(png: string, out: string, budget: number): { avif: number; webp: number } {
  let q = 56;
  for (;;) {
    execFileSync('convert', [png, '-quality', String(q), `${out}.avif`]);
    if (kb(`${out}.avif`) <= budget || q <= 24) break;
    q -= 6;
  }
  let wq = 84;
  for (;;) {
    execFileSync('convert', [png, '-quality', String(wq), '-define', 'webp:method=6', '-define', 'webp:alpha-quality=80', `${out}.webp`]);
    if (kb(`${out}.webp`) <= budget * 1.6 || wq <= 40) break;
    wq -= 8;
  }
  return { avif: Math.round(kb(`${out}.avif`)), webp: Math.round(kb(`${out}.webp`)) };
}

async function launch(): Promise<{ browser: Browser; gpu: string }> {
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || chromium.executablePath();
  const probe = async (args: string[]) => {
    const browser = await chromium.launch({ executablePath, args });
    const page = await browser.newPage();
    const gpu = await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      const ext = gl?.getExtension('WEBGL_debug_renderer_info');
      return gl && ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'none';
    });
    await page.close();
    return { browser, gpu };
  };
  try {
    const r = await probe(['--use-angle=vulkan', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist']);
    if (!/swiftshader|none/i.test(r.gpu)) return r;
    await r.browser.close();
  } catch {
    // No Vulkan: SwiftShader below.
  }
  console.warn('No GPU WebGL found, rendering with SwiftShader.');
  return probe(['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']);
}

const server = await createServer({ configFile: join(site, 'vite.config.ts'), root: site, logLevel: 'warn', server: { port: 5190, strictPort: false } });
await server.listen();
const base = server.resolvedUrls!.local[0]!;
const { browser, gpu } = await launch();
console.log(`Rendering on ${gpu}`);

try {
  if (run('stills')) {
    mkdirSync(stillsDir, { recursive: true });
    const anchors: Record<string, [number, number]> = {};
    for (const job of JOBS) {
      for (const theme of job.themes) {
        for (const size of job.sizes) {
          const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: size.dpr });
          const page = await ctx.newPage();
          page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
          await page.goto(`${base}?stills=${job.key}${job.portrait ? 'p' : ''}&theme=${theme}`);
          await page.waitForSelector('html[data-still-ready]', { timeout: 60_000 });
          const info = await page.evaluate(() => (window as unknown as { __stills: { anchors: Record<string, [number, number]> } }).__stills);
          if (!job.portrait && size.dpr === 1) Object.assign(anchors, info.anchors);
          const png = join(tmp, `k${job.key}.png`);
          await page.screenshot({ path: png, omitBackground: true });
          const name = `k${job.key}${job.portrait ? 'p' : ''}-${theme}-${size.name}`;
          const sizes = encode(png, join(stillsDir, name), size.budget);
          console.log(`${name}: avif ${sizes.avif} KB, webp ${sizes.webp} KB`);
          await ctx.close();
        }
      }
    }
    const file = join(site, 'src/stage/stills.json');
    // One anchor per line, so a re-render reads well in a diff.
    const rows = Object.entries(anchors)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, [x, y]]) => `    ${JSON.stringify(k)}: [${x}, ${y}]`);
    const renderer = gpu.replace(/\s*\(0x[0-9a-f]+\)/gi, '');
    writeFileSync(file, `{\n  "hash": ${JSON.stringify(sceneHash())},\n  "renderer": ${JSON.stringify(renderer)},\n  "anchors": {\n${rows.join(',\n')}\n  }\n}\n`);
    console.log(`Wrote ${file}`);
  }

  if (run('og')) {
    // 1200x630: the street at night with the chip and the headline in the site's own fonts.
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(`${base}?stills=0&theme=dark`);
    await page.waitForSelector('html[data-still-ready]', { timeout: 60_000 });
    await page.evaluate(async () => {
      const style = document.createElement('style');
      style.textContent = `
        .stills-mode body { background: var(--bleed), var(--bg) !important; }
        .og { position: fixed; inset: 0; z-index: 5; color: var(--on-bleed); font-family: var(--font-mono); }
        .og::after { content: ""; position: absolute; inset: 0; background: var(--grain-tile); background-size: 160px; opacity: var(--grain-alpha); }
        .og .brand { position: absolute; left: 44px; top: 36px; display: flex; gap: 10px; align-items: center; font: 600 22px/1 var(--font-sans); color: var(--text); }
        .og .brand svg { width: 24px; height: 24px; }
        .og .head { position: absolute; left: 44px; bottom: 44px; }
        .og .chip { display: inline-flex; gap: 4px; margin-bottom: 14px; }
        .og .chip span { background: var(--on-bleed); color: var(--bleed-base); font: 500 15px/1 var(--font-mono); text-transform: uppercase; padding: 7px 12px 6px; }
        .og .chip i { width: 4px; background: var(--on-bleed); }
        .og h1 { margin: 0; font: 500 64px/.98 var(--font-mono); letter-spacing: -.045em; text-transform: uppercase; }
        .og h1 span { display: block; }
        .og h1 em { font: italic 400 80px/1 var(--font-display); letter-spacing: -.02em; text-transform: none; }`;
      document.head.append(style);
      const og = document.createElement('div');
      og.className = 'og';
      og.innerHTML = `<p class="brand"><svg viewBox="0 0 16 16"><path fill="currentColor" fill-rule="evenodd" d="M2 15V7h2V4h2V1h4v3h2v3h2v8zM9 9h3v3H9z"/><rect x="9" y="9" width="3" height="3" fill="var(--oranje)"/></svg>nl-property-finder</p>
        <div class="head"><p class="chip"><span>Local agent for</span><i></i><i></i></p><h1><span>Renting in</span><span>the <em>Netherlands</em></span></h1></div>`;
      document.querySelector('.stage-layer')!.append(og);
      await document.fonts.ready;
    });
    await page.waitForTimeout(300);
    const out = join(site, 'public/og.jpg');
    await page.screenshot({ path: out, type: 'jpeg', quality: 82 });
    console.log(`og.jpg: ${Math.round(kb(out))} KB`);
    await ctx.close();
  }

  if (run('icons')) {
    const logo = (f: string) => readFileSync(join(site, '../packages/design/logo', f), 'utf8');
    writeFileSync(join(site, 'public/favicon.svg'), logo('favicon.svg'));
    const ctx = await browser.newContext({ deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    for (const [svg, size, name] of [['mark-color.svg', 32, 'favicon-32.png'], ['app-icon.svg', 180, 'apple-touch-icon.png']] as const) {
      const src = `data:image/svg+xml;base64,${Buffer.from(logo(svg)).toString('base64')}`;
      await page.setViewportSize({ width: size, height: size });
      await page.setContent(`<html><body style="margin:0;background:transparent"><img src="${src}" width="${size}" height="${size}" style="display:block"></body></html>`);
      await page.screenshot({ path: join(site, 'public', name), omitBackground: true });
      console.log(`${name}: ${size}x${size}`);
    }
    await ctx.close();
  }

  if (run('media')) {
    // Placeholders for the Action inbox screenshots, cut from the dashboard
    // design render at the final size (1440x900). The end-to-end run
    // (e2e/scripts/media.ts) overwrites site/public/media/inbox-{light,dark}.webp
    // with real screenshots; existing files are never replaced here.
    const refs = join(site, '../docs/design/refs');
    for (const theme of ['light', 'dark'] as const) {
      const out = join(site, `public/media/inbox-${theme}.webp`);
      if (existsSync(out)) continue;
      mkdirSync(join(site, 'public/media'), { recursive: true });
      const src = join(refs, `99-proof-${theme}.webp`);
      // The dashboard's page colour, read from the shared tokens (light block first, then dark).
      const sunk = [...readFileSync(join(site, '../packages/design/tokens.css'), 'utf8').matchAll(/--bg-sunk:\s*(#[0-9a-f]{6})/gi)].map((m) => m[1]!);
      const bg = theme === 'light' ? sunk[0]! : sunk[sunk.length - 1]!;
      execFileSync('convert', [
        '-size', '1440x900', `xc:${bg}`,
        '(', src, '-crop', '522x218+27+647', '+repage', '-resize', '160%', ')', '-geometry', '+36+36', '-composite',
        '(', src, '-crop', '374x218+560+647', '+repage', '-resize', '146%', ')', '-geometry', '+880+36', '-composite',
        '(', src, '-crop', '278x166+504+146', '+repage', '-resize', '196%', ')', '-geometry', '+36+400', '-composite',
        '(', src, '-crop', '196x84+712+306', '+repage', '-resize', '200%', ')', '-geometry', '+620+400', '-composite',
        '-quality', '80', out,
      ]);
      console.log(`${out}: ${Math.round(kb(out))} KB (placeholder)`);
    }
  }
} finally {
  await browser.close();
  await server.close();
}
