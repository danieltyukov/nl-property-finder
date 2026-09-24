import { chmodSync, existsSync, readFileSync, renameSync, watch, writeFileSync } from 'node:fs';
import { dirname, basename } from 'node:path';
import YAML from 'yaml';
import { z } from 'zod';
import type { Paths } from '../paths.js';
import { ConfigSchema, type Config } from './schema.js';

export interface LoadedConfig {
  config: Config;
  errors: string[];
  fromLastGood: boolean;
}

const HEADER = `# nl-property-finder configuration.
# Edit by hand or from the dashboard. Your editor can autocomplete this file
# with config.schema.json, which sits next to it.
# yaml-language-server: $schema=./config.schema.json
`;

function formatIssues(err: z.ZodError): string[] {
  return err.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
}

function readLastGood(paths: Paths): Config {
  try {
    return ConfigSchema.parse(JSON.parse(readFileSync(paths.lastGoodFile, 'utf8')));
  } catch {
    return ConfigSchema.parse({});
  }
}

/**
 * Reads config.yaml. A missing file is the default config. A file that does
 * not parse, or does not match the schema, is not fatal: the last good config
 * is used and the errors are returned so the daemon can raise a task.
 */
export function loadConfig(paths: Paths): LoadedConfig {
  if (!existsSync(paths.configFile)) {
    return { config: ConfigSchema.parse({}), errors: [], fromLastGood: false };
  }
  let raw: unknown;
  try {
    raw = YAML.parse(readFileSync(paths.configFile, 'utf8')) ?? {};
  } catch (e) {
    return { config: readLastGood(paths), errors: [`config.yaml: ${(e as Error).message.split('\n')[0]}`], fromLastGood: true };
  }
  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) {
    return { config: readLastGood(paths), errors: formatIssues(parsed.error), fromLastGood: true };
  }
  writeAtomic(paths.lastGoodFile, JSON.stringify(parsed.data));
  return { config: parsed.data, errors: [], fromLastGood: false };
}

function writeAtomic(file: string, content: string, mode?: number): void {
  const tmp = `${dirname(file)}/.${basename(file)}.${process.pid}.tmp`;
  writeFileSync(tmp, content, mode ? { mode } : undefined);
  renameSync(tmp, file);
  if (mode) chmodSync(file, mode);
}

/** Validates and writes config.yaml atomically, then records it as the last good config. */
export function saveConfig(paths: Paths, next: Config): Config {
  const valid = ConfigSchema.parse(next);
  writeAtomic(paths.configFile, HEADER + YAML.stringify(valid, { lineWidth: 0 }));
  writeAtomic(paths.lastGoodFile, JSON.stringify(valid));
  return valid;
}

/** Replaces one top-level section and saves. Throws a ZodError when the result is invalid. */
export function patchConfig(paths: Paths, section: keyof Config, value: unknown): LoadedConfig {
  const current = loadConfig(paths).config;
  const next = ConfigSchema.parse({ ...current, [section]: value });
  const config = saveConfig(paths, next);
  return { config, errors: [], fromLastGood: false };
}

/**
 * Calls back when config.yaml changes. Watches the folder rather than the file
 * because editors and our own atomic writes replace the file, which ends a
 * watch on the old inode.
 */
export function watchConfig(paths: Paths, onChange: (c: LoadedConfig) => void): () => void {
  let timer: NodeJS.Timeout | undefined;
  const target = basename(paths.configFile);
  const watcher = watch(dirname(paths.configFile), (_event, name) => {
    if (name !== target) return;
    clearTimeout(timer);
    timer = setTimeout(() => onChange(loadConfig(paths)), 200);
  });
  return () => {
    clearTimeout(timer);
    watcher.close();
  };
}

/** Parses secrets.env (KEY=value lines, # comments, optional quotes). */
export function loadSecrets(paths: Paths): Record<string, string> {
  if (!existsSync(paths.secretsFile)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(paths.secretsFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trimStart().startsWith('#')) continue;
    let v = m[2] ?? '';
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]!] = v;
  }
  return out;
}

/** Sets or removes (empty value) one secret, keeping the file private. */
export function setSecret(paths: Paths, name: string, value: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`invalid secret name: ${name}`);
  const current = loadSecrets(paths);
  if (value) current[name] = value;
  else delete current[name];
  const body =
    '# nl-property-finder secrets. Private to you: this file is readable only by your user.\n' +
    Object.entries(current)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join('\n') +
    '\n';
  writeAtomic(paths.secretsFile, body, 0o600);
}

/** Writes config.schema.json so editors can validate and autocomplete config.yaml. */
export function writeJsonSchema(paths: Paths): void {
  const schema = z.toJSONSchema(ConfigSchema, { io: 'input', unrepresentable: 'any' });
  writeFileSync(paths.schemaFile, JSON.stringify(schema, null, 2) + '\n');
}
