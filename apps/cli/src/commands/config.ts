import { existsSync } from 'node:fs';
import type { Command } from 'commander';
import { ConfigSchema, loadConfig, saveConfig, writeJsonSchema, type Config, type Paths } from '@nlpf/core';
import { UsageError, run, type CliDeps } from './context.js';

/*
 * `nlpf config get|set|edit` work on config.yaml directly, so they also work
 * while the agent is off. A running agent watches the file and picks up the
 * change within a second.
 */

function segments(path: string): string[] {
  const parts = path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean);
  if (parts.length === 0) throw new UsageError('Give a setting, for example automation.dailyCap.');
  return parts;
}

export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const key of segments(path)) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/** Returns a copy of `obj` with the value at `path` replaced, creating objects and arrays on the way. */
export function setPath<T>(obj: T, path: string, value: unknown): T {
  const root = structuredClone(obj) as unknown as Record<string, unknown>;
  const keys = segments(path);
  let cur: Record<string, unknown> = root;
  keys.forEach((key, i) => {
    if (i === keys.length - 1) {
      cur[key] = value;
      return;
    }
    const next = cur[key];
    if (next === null || typeof next !== 'object') cur[key] = /^\d+$/.test(keys[i + 1]!) ? [] : {};
    cur = cur[key] as Record<string, unknown>;
  });
  return root as unknown as T;
}

/** A value typed on the command line: JSON when it parses (numbers, booleans, arrays), otherwise the text itself. */
export function parseValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function currentConfig(paths: Paths): Config {
  const loaded = loadConfig(paths);
  if (loaded.errors.length) {
    throw new UsageError(
      `config.yaml has errors, fix them first with nlpf config edit: ${loaded.errors.join('; ')}`,
    );
  }
  return loaded.config;
}

export function configGet(paths: Paths, path?: string): unknown {
  const config = currentConfig(paths);
  if (!path) return config;
  const value = getPath(config, path);
  if (value === undefined) throw new UsageError(`${path} is not set.`);
  return value;
}

export function configSet(
  paths: Paths,
  path: string,
  raw: string,
): { path: string; value: unknown; previous: unknown } {
  const config = currentConfig(paths);
  const previous = getPath(config, path);
  const candidates = [parseValue(raw)];
  if (typeof candidates[0] !== 'string') candidates.push(raw);
  let firstError: string | undefined;
  for (const candidate of candidates) {
    const parsed = ConfigSchema.safeParse(setPath(config, path, candidate));
    if (!parsed.success) {
      firstError ??= parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      continue;
    }
    const stored = getPath(parsed.data, path);
    if (stored === undefined)
      throw new UsageError(`${path} is not a setting. See config.schema.json for the list.`);
    saveConfig(paths, parsed.data);
    return { path, value: stored, previous };
  }
  throw new UsageError(firstError ?? `Could not set ${path}.`);
}

export function editorCommand(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): [string, string[]] {
  const configured = (env.VISUAL || env.EDITOR || '').trim();
  if (configured) {
    const [cmd, ...args] = configured.split(/\s+/);
    return [cmd!, args];
  }
  return platform === 'win32' ? ['notepad', []] : ['vi', []];
}

export async function configEdit(
  paths: Paths,
  deps: Pick<CliDeps, 'env' | 'platform' | 'spawnEditor'>,
): Promise<{ file: string; valid: boolean; errors: string[] }> {
  if (!existsSync(paths.configFile)) {
    saveConfig(paths, ConfigSchema.parse({}));
    writeJsonSchema(paths);
  }
  const [cmd, args] = editorCommand(deps.env, deps.platform);
  await deps.spawnEditor(cmd, [...args, paths.configFile]);
  const { errors } = loadConfig(paths);
  return { file: paths.configFile, valid: errors.length === 0, errors };
}

const show = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2));

export function registerConfig(program: Command, deps: CliDeps): void {
  const config = program
    .command('config')
    .description('Read or change settings in config.yaml')
    .addHelpText(
      'after',
      '\nSettings are dotted paths, for example automation.dailyCap or searches.0.priceMaxEur.\nA running agent picks up changes by itself.',
    );

  config
    .command('get [path]', { isDefault: true })
    .description('Print one setting, or the whole config')
    .option('--json', 'print JSON')
    .action((path: string | undefined, o: { json?: boolean }) =>
      run(deps, o.json, async () => {
        const value = configGet(deps.paths(), path);
        return { data: value, text: show(value) };
      }),
    );

  config
    .command('set <path> <value>')
    .description('Change one setting. Values are read as JSON when they parse, otherwise as text')
    .option('--json', 'print JSON')
    .action((path: string, value: string, o: { json?: boolean }) =>
      run(deps, o.json, async () => {
        const r = configSet(deps.paths(), path, value);
        return { data: r, text: `${r.path} is now ${JSON.stringify(r.value)}.` };
      }),
    );

  config
    .command('edit')
    .description('Open config.yaml in your editor ($VISUAL or $EDITOR) and check it afterwards')
    .option('--json', 'print JSON')
    .action((o: { json?: boolean }) =>
      run(deps, o.json, async () => {
        const r = await configEdit(deps.paths(), deps);
        return {
          data: r,
          text: r.valid
            ? `Saved ${r.file}.`
            : `The file has errors, so the agent keeps using the last good config until they are fixed:\n${r.errors.join('\n')}`,
          exitCode: r.valid ? 0 : 1,
        };
      }),
    );
}
