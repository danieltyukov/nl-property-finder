import { readdirSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import YAML from 'yaml';
import { ConfigSchema } from '../src/index.js';

const dir = new URL('../../../examples/configs/', import.meta.url);

test.each(readdirSync(dir).filter((f) => f.endsWith('.yaml')))('%s is a valid config', (file) => {
  const parsed = ConfigSchema.safeParse(YAML.parse(readFileSync(new URL(file, dir), 'utf8')));
  expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
});
