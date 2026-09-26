import { mkdtempSync, writeFileSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { loadConfig, saveConfig, setSecret, loadSecrets, resolvePaths, ConfigSchema, patchConfig, writeJsonSchema } from '../src/index.js';

const home = () => resolvePaths({ NLPF_HOME: mkdtempSync(join(tmpdir(), 'nlpf-')) });

test('a missing or empty file is a valid config with defaults', () => {
  const p = home();
  expect(loadConfig(p).config.server.port).toBe(7431);
  writeFileSync(p.configFile, '');
  const { config, errors } = loadConfig(p);
  expect(errors).toEqual([]);
  expect(config.automation.sendWindow).toEqual({ start: '07:00', end: '23:30' });
  expect(config.searches[0]?.id).toBe('main');
  expect(config.ai.extract.model).toBe('claude-opus-5');
});

test('an invalid edit keeps the last good config and reports the path', () => {
  const p = home();
  saveConfig(p, ConfigSchema.parse({ automation: { dailyCap: 12 } }));
  writeFileSync(p.configFile, 'automation:\n  dailyCap: lots\n');
  const res = loadConfig(p);
  expect(res.fromLastGood).toBe(true);
  expect(res.config.automation.dailyCap).toBe(12);
  expect(res.errors[0]).toContain('automation.dailyCap');
});

test('broken YAML also falls back', () => {
  const p = home();
  saveConfig(p, ConfigSchema.parse({}));
  writeFileSync(p.configFile, 'search: [unclosed');
  expect(loadConfig(p).fromLastGood).toBe(true);
});

test('saved config round-trips and patchConfig replaces one section', () => {
  const p = home();
  saveConfig(p, ConfigSchema.parse({ profile: { firstName: 'Sam' } }));
  expect(readFileSync(p.configFile, 'utf8')).toContain('yaml-language-server');
  const res = patchConfig(p, 'searches', [{ id: 'delft', name: 'Delft rooms', priceMaxEur: 750 }]);
  expect(res.config.profile.firstName).toBe('Sam');
  expect(loadConfig(p).config.searches[0]?.priceMaxEur).toBe(750);
  expect(() => patchConfig(p, 'searches', [{ id: 'Bad Id', name: 'x' }])).toThrow();
});

test('secrets file is private and parses quotes', () => {
  const p = home();
  setSecret(p, 'ANTHROPIC_API_KEY', 'sk-test');
  setSecret(p, 'NLPF_MAIL_PASSWORD', 'abcd efgh ijkl mnop');
  expect(loadSecrets(p)).toEqual({ ANTHROPIC_API_KEY: 'sk-test', NLPF_MAIL_PASSWORD: 'abcd efgh ijkl mnop' });
  expect(statSync(p.secretsFile).mode & 0o777).toBe(0o600);
  setSecret(p, 'ANTHROPIC_API_KEY', '');
  expect(loadSecrets(p).ANTHROPIC_API_KEY).toBeUndefined();
});

test('a secret with backslashes, quotes and dollar signs reads back exactly as it was set', () => {
  const p = home();
  const tricky = 'a\\b"c$d?e*f]g';
  setSecret(p, 'NLPF_MAIL_PASSWORD', tricky);
  setSecret(p, 'OTHER', 'x');
  expect(loadSecrets(p).NLPF_MAIL_PASSWORD).toBe(tricky);
  // A hand-written file keeps working: a quoted value that is not a JSON string is taken as it is.
  writeFileSync(p.secretsFile, 'A="C:\\path\\x"\nB=\'single $quoted\'\nC=bare\\value\n');
  expect(loadSecrets(p)).toEqual({ A: 'C:\\path\\x', B: 'single $quoted', C: 'bare\\value' });
});

test('the JSON schema is written for editors', () => {
  const p = home();
  writeJsonSchema(p);
  const schema = JSON.parse(readFileSync(p.schemaFile, 'utf8'));
  expect(schema.properties.searches).toBeDefined();
});
