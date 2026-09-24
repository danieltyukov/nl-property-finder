import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

/*
 * The project site: one page, plain TypeScript, three.js and GSAP loaded late.
 *
 * It shares `packages/design/tokens.css` and `fonts.css` with the dashboard, so
 * the page cannot drift away from the product it shows. Vite rebases the
 * `@font-face` URLs against the file that declared them, so the fonts are
 * self-hosted without a second copy in the repository, and the preload links
 * in index.html point at the same files and get the same hashed names.
 *
 * Two build-time steps live here as tiny plugins, because the page must be
 * complete without JavaScript:
 * - `anchors` writes the projected 3D positions from `src/stage/stills.json`
 *   into the HTML, so callouts and labels line up with the posters.
 * - `sources` replaces the static list of site names with the generated one
 *   from `docs/SOURCES.md` once that file exists (Task 16 writes it).
 */
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const repoRoot = here('..');

export default defineConfig({
  // The repository is published at danieltyukov.github.io/nl-property-finder/.
  base: '/nl-property-finder/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    assetsInlineLimit: 0,
    // Nothing is preloaded at page load: the motion and stage chunks are
    // fetched only when their import() runs, after first paint.
    modulePreload: { polyfill: false },
    // three.js alone is about 570 KB minified; it is loaded late and only on capable devices.
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      output: {
        // Keep /*! @license */ headers: GSAP's terms say its notices must not be removed.
        comments: { legal: true, annotation: false, jsdoc: false },
        entryFileNames: 'assets/main-[hash].js',
        chunkFileNames: (chunk) =>
          chunk.facadeModuleId?.replace(/\\/g, '/').endsWith('/stage/index.ts') ? 'assets/stage-[hash].js' : 'assets/[name]-[hash].js',
      },
    },
  },
  server: {
    port: 5180,
    // tokens.css, the fonts and the logo live above this root.
    fs: { allow: [repoRoot] },
  },
  preview: { port: 4180 },
  plugins: [anchors(), sources()],
});

interface Stills {
  hash: string;
  anchors: Record<string, [number, number]>;
}

/**
 * `data-anchor="k0.callout"` becomes `style="--ax:560.2;--ay:224.9"`, the
 * point's position on the 1440x900 poster. CSS turns it into a position on the
 * cover-fitted poster at any viewport size (container query units).
 */
function anchors(): Plugin {
  const file = here('./src/stage/stills.json');
  return {
    name: 'nlpf-anchors',
    transformIndexHtml(html) {
      let stills: Stills;
      try {
        stills = JSON.parse(readFileSync(file, 'utf8')) as Stills;
      } catch {
        // Not rendered yet (or mid-render): the CSS defaults place the anchors.
        return html;
      }
      return html.replace(/data-anchor="([\w.]+)"(?: style="([^"]*)")?/g, (whole, id: string, style?: string) => {
        const a = stills.anchors[id];
        if (!a) return whole;
        const vars = `--ax:${a[0].toFixed(1)};--ay:${a[1].toFixed(1)}`;
        return `data-anchor="${id}" style="${vars}${style ? `;${style}` : ''}"`;
      });
    },
  };
}

/**
 * The sources band lists site names as text. Until `docs/SOURCES.md` exists
 * the static list in index.html (from the adapter registry in the plan) is
 * used. When it exists, the names are read from its first table column
 * between `<!-- sources:start -->` and `<!-- sources:end -->`.
 */
function sources(): Plugin {
  const file = here('../docs/SOURCES.md');
  return {
    name: 'nlpf-sources',
    transformIndexHtml(html) {
      if (!existsSync(file)) return html;
      const md = readFileSync(file, 'utf8');
      const block = md.split('<!-- sources:start -->')[1]?.split('<!-- sources:end -->')[0];
      if (!block) return html;
      const names = block
        .split('\n')
        .filter((l) => l.startsWith('|') && !/^\|\s*-/.test(l))
        .slice(1)
        .map((l) => l.split('|')[1]?.replace(/[*`[\]]|\(.*?\)/g, '').trim())
        .filter((n): n is string => Boolean(n));
      if (names.length === 0) return html;
      const items = names.map((n) => `<li>${n.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</li>`).join('');
      return html.replace(/(<ul class="src-list"[^>]*>)[\s\S]*?(<\/ul>)/g, `$1${items}$2`);
    },
  };
}
