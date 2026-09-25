// Bundles the CLI into dist/nlpf.mjs, the file the `nlpf` bin and the service run.
//
// Workspace packages (@nlpf/*) are bundled from their TypeScript source, since
// they are not published on their own. Every other package stays an import and
// is resolved from node_modules at run time.
//
// Code splitting keeps `import('@nlpf/daemon')` lazy: the daemon and its heavy
// dependencies (the browser driver, SQLite, the HTTP server) load only for
// `nlpf daemon` and `nlpf demo`, so every other command starts fast and still
// works when one of those dependencies is broken.
import { build } from 'esbuild';
import { chmodSync, cpSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const outdir = join(here, 'dist');

/** Resolves `@nlpf/<name>` to the package's TypeScript entry, falling back to src/index.ts. */
function workspaceEntry(name) {
  for (const dir of ['packages', 'apps']) {
    const pkgDir = join(root, dir, name);
    const manifest = join(pkgDir, 'package.json');
    if (!existsSync(manifest)) continue;
    const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
    const entry = typeof pkg.exports === 'string' ? pkg.exports : (pkg.exports?.['.'] ?? 'src/index.ts');
    return resolve(pkgDir, typeof entry === 'string' ? entry : 'src/index.ts');
  }
  return null;
}

const dependencies = {
  name: 'dependencies',
  setup(b) {
    b.onResolve({ filter: /^@nlpf\/[^/]+$/ }, (args) => {
      const entry = workspaceEntry(args.path.slice('@nlpf/'.length));
      return entry ? { path: entry } : { errors: [{ text: `workspace package ${args.path} not found` }] };
    });
    b.onResolve({ filter: /^[^./]/ }, (args) => {
      if (args.kind === 'entry-point' || isAbsolute(args.path) || args.path.startsWith('@nlpf/'))
        return undefined;
      return { path: args.path, external: true };
    });
  },
};

rmSync(outdir, { recursive: true, force: true });

await build({
  entryPoints: { nlpf: join(here, 'src', 'main.ts') },
  outdir,
  bundle: true,
  splitting: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outExtension: { '.js': '.mjs' },
  chunkNames: 'chunks/[name]-[hash]',
  banner: { js: '#!/usr/bin/env node' },
  plugins: [dependencies],
  logLevel: 'warning',
});

chmodSync(join(outdir, 'nlpf.mjs'), 0o755);

// The daemon serves the dashboard from dist/dashboard when it runs from this
// bundle, so an installed nlpf needs no source tree beside it.
const dashboard = join(root, 'apps', 'dashboard', 'dist');
if (existsSync(join(dashboard, 'index.html')))
  cpSync(dashboard, join(outdir, 'dashboard'), { recursive: true });
else console.warn('apps/dashboard/dist is missing; build the dashboard first so the bundle can serve it.');

// nlpf on installs this into the icon theme, so the launcher it writes shows the app icon.
cpSync(
  join(root, 'packages', 'design', 'logo', 'app-icon.svg'),
  join(outdir, 'icons', 'nl-property-finder.svg'),
);

console.log(`Built ${join(outdir, 'nlpf.mjs')}`);
