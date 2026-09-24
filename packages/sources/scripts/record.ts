/**
 * Records live pages for one source into packages/sources/fixtures/<id>/, so
 * adapter tests can run offline against real markup.
 *
 *   npx tsx packages/sources/scripts/record.ts <source-id> [options]
 *
 *   --url <url>        record this URL instead of the adapter's searches (a detail page, say)
 *   --name <file>      file name for --url (default: made from the URL)
 *   --browser <mode>   headless or headed: load --url in the browser pool and save the rendered HTML
 *   --all              run every search the adapter builds (default: only the first)
 *   --config <file>    a config.yaml whose searches and sources shape buildSearches
 *   --agencies <dir>   another folder of agency YAML files (examples/agencies is always read)
 *
 * It is gentle on purpose: the polite fetch keeps 4 s between requests to a
 * host, and by default only the first search runs. It talks to live sites, so
 * it refuses to run when CI is set. Keys the site embeds in its pages (a Google
 * Maps key, say) are replaced with placeholders on save. Check the saved files
 * for anything personal before committing them.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import YAML from 'yaml';
import { ConfigSchema, SourceConfigSchema, createLogger, type BrowserSession, type Config, type SourceAdapter } from '@nlpf/core';
import {
  createBrowserPool,
  createPoliteFetch,
  createSourceContext,
  findCredentials,
  loadAgencyAdapters,
  scrubCredentials,
  type BrowserMode,
  type PoliteFetch,
} from '../src/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, '..');
const REPO = resolve(PKG, '..', '..');

const USAGE = 'usage: npx tsx packages/sources/scripts/record.ts <source-id> [--url <url>] [--name <file>] [--browser headless|headed] [--all] [--config <file>] [--agencies <dir>]';

function extensionFor(contentType: string | null, text: string): string {
  const ct = contentType ?? '';
  if (ct.includes('json')) return 'json';
  if (ct.includes('html')) return 'html';
  if (ct.includes('xml')) return 'xml';
  const start = text.trimStart();
  if (start.startsWith('{') || start.startsWith('[')) return 'json';
  if (start.startsWith('<')) return 'html';
  return 'txt';
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'page'
  );
}

async function loadAdapters(extraAgencyDirs: string[]): Promise<SourceAdapter[]> {
  const adapters: SourceAdapter[] = [];
  // Built-in adapters arrive with the adapter tasks; load them when present.
  const builtin = join(PKG, 'src', 'builtin.ts');
  if (existsSync(builtin)) {
    const mod = (await import(pathToFileURL(builtin).href)) as { builtinAdapters?: () => SourceAdapter[] };
    adapters.push(...(mod.builtinAdapters?.() ?? []));
  }
  for (const dir of [join(REPO, 'examples', 'agencies'), ...extraAgencyDirs]) {
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f) && !f.startsWith('_'));
    adapters.push(
      ...loadAgencyAdapters(files, dir, {
        onError: (file, err) => console.warn(`skipping ${file}: ${err.issues.join('; ')}`),
      }),
    );
  }
  return adapters;
}

function loadConfig(file: string | undefined): Config {
  if (!file) return ConfigSchema.parse({});
  return ConfigSchema.parse(YAML.parse(readFileSync(file, 'utf8')) ?? {});
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      url: { type: 'string' },
      name: { type: 'string' },
      browser: { type: 'string' },
      all: { type: 'boolean', default: false },
      config: { type: 'string' },
      agencies: { type: 'string', multiple: true, default: [] },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  const sourceId = positionals[0];
  if (values.help || !sourceId) {
    console.log(USAGE);
    return values.help ? 0 : 1;
  }
  if (process.env.CI) {
    console.error('record.ts talks to live websites and does not run in CI.');
    return 1;
  }
  const mode = values.browser as BrowserMode | undefined;
  if (mode !== undefined && mode !== 'headless' && mode !== 'headed') {
    console.error('--browser must be headless or headed');
    return 1;
  }

  // "agency:de-gracht" is recorded into fixtures/agency-de-gracht/.
  const outDir = join(PKG, 'fixtures', sourceId.replace(/[^a-zA-Z0-9.-]+/g, '-'));
  mkdirSync(outDir, { recursive: true });
  const log = createLogger({ level: 'info', stderr: true, bindings: { scope: 'record' } });
  const config = loadConfig(values.config);
  const pool = createBrowserPool({ dir: join(REPO, '.nlpf-dev', 'browser'), log });
  const saved: string[] = [];
  const save = (name: string, text: string) => {
    const file = join(outDir, name);
    const hits = findCredentials(text);
    writeFileSync(file, scrubCredentials(text));
    saved.push(file);
    console.log(`saved ${file} (${text.length} characters)`);
    for (const h of hits) console.log(`  scrubbed a ${h.name} on line ${h.line}`);
  };

  try {
    if (values.url) {
      const url = values.url;
      if (mode) {
        const session = await pool.session(sourceId, { mode });
        try {
          await session.page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
          save(values.name ?? `${slug(new URL(url).pathname)}.html`, await session.page.content());
        } finally {
          await session.close();
        }
      } else {
        const res = await createPoliteFetch({ log })(url);
        save(values.name ?? `${slug(new URL(url).pathname)}.${extensionFor(res.headers.get('content-type'), res.text)}`, res.text);
      }
      return 0;
    }

    const adapters = await loadAdapters(values.agencies ?? []);
    const adapter = adapters.find((a) => a.id === sourceId);
    if (!adapter) {
      console.error(`no source "${sourceId}". Known: ${adapters.map((a) => a.id).join(', ') || '(none)'}`);
      return 1;
    }
    const polite = createPoliteFetch({ log });
    const searches = config.searches.filter((s) => s.enabled);
    const requests = adapter.buildSearches(searches, config.sources[adapter.id] ?? SourceConfigSchema.parse({}));
    if (requests.length === 0) {
      console.error(`${adapter.id} built no searches for this config; pass --config with a search it can use`);
      return 1;
    }

    for (const req of values.all ? requests : requests.slice(0, 1)) {
      let n = 0;
      const next = (ext: string) => `search-${slug(req.key)}${++n > 1 ? `-${n}` : ''}.${ext}`;
      const recordingFetch: PoliteFetch = async (url, init) => {
        const res = await polite(url, init);
        save(next(extensionFor(res.headers.get('content-type'), res.text)), res.text);
        return res;
      };
      const recordingPool = {
        async session(id: string, o?: { mode?: BrowserMode }): Promise<BrowserSession> {
          const s = await pool.session(id, o);
          return {
            page: s.page,
            close: async () => {
              if (!s.page.isClosed()) save(next('html'), await s.page.content());
              await s.close();
            },
          };
        },
      };
      const ctx = createSourceContext({
        fetch: recordingFetch,
        pool: recordingPool,
        log,
        config,
        sourceId: adapter.id,
        signal: new AbortController().signal,
      });
      console.log(`running search "${req.label}" (${req.url ?? JSON.stringify(req.params ?? {})})`);
      const listings = await adapter.search(req, ctx);
      console.log(`${listings.length} listings parsed`);
      if (listings[0]) console.log(JSON.stringify(listings[0], null, 2));
    }
    return 0;
  } finally {
    await pool.closeAll();
    if (saved.length) console.log(`\n${saved.length} file(s) in ${outDir}. Check them for personal data before committing.`);
  }
}

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
