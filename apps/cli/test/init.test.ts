import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, test } from 'vitest';
import { ConfigSchema, loadConfig, loadSecrets, resolvePaths, saveConfig, type Paths } from '@nlpf/core';
import {
  createReadlinePrompter,
  parseAvailability,
  parseRegions,
  runInit,
  suggestTopic,
  type Prompter,
} from '../src/commands/init.js';

const home = (): Paths => resolvePaths({ NLPF_HOME: mkdtempSync(join(tmpdir(), 'nlpf-init-')) });

/** Answers questions by matching their text; anything unmatched takes the default. */
function scripted(rules: [RegExp, string][]): Prompter & { said: string[]; asked: string[] } {
  const said: string[] = [];
  const asked: string[] = [];
  const answer = (q: string): string | undefined => rules.find(([re]) => re.test(q))?.[1];
  return {
    said,
    asked,
    say: (t) => said.push(t),
    ask: async (q, opts) => {
      asked.push(q);
      return answer(q) ?? opts?.default ?? '';
    },
    secret: async (q) => {
      asked.push(q);
      return answer(q) ?? '';
    },
    confirm: async (q, def) => {
      asked.push(q);
      const a = answer(q);
      return a === undefined ? def : /^y/i.test(a);
    },
    close: () => {},
  };
}

const silent: Prompter = {
  say: () => {},
  ask: async () => {
    throw new Error('asked a question in --yes mode');
  },
  secret: async () => {
    throw new Error('asked for a secret in --yes mode');
  },
  confirm: async () => {
    throw new Error('asked to confirm in --yes mode');
  },
  close: () => {},
};

describe('nlpf init, interactive', () => {
  test('writes the profile, search, mail, notifications and AI settings, and keeps passwords in secrets.env', async () => {
    const paths = home();
    const p = scripted([
      [/first name/i, 'Sam'],
      [/last name/i, 'de Vries'],
      [/year of birth/i, '1999'],
      [/occupation/i, 'phd'],
      [/university or employer/i, 'TU Delft'],
      [/income/i, '2900'],
      [/earliest move-in/i, '2026-11-01'],
      [/pets/i, 'n'],
      [/about you/i, 'I am a quiet PhD student who cycles everywhere.'],
      [/cities/i, 'Delft, Rotterdam, Den Haag'],
      [/maximum rent/i, '1400'],
      [/types/i, 'studio, apartment'],
      [/viewings/i, 'mon-fri 17:00-21:00; sat 10:00-16:00'],
      [/gmail address/i, 'sam.nlpf@gmail.com'],
      [/app password/i, 'abcd efgh ijkl mnop'],
      [/anthropic api key/i, 'sk-ant-test-key-123456'],
      [/write this/i, 'y'],
    ]);
    const res = await runInit({ paths, prompter: p, flags: {}, env: {}, random: () => 'k3j9x0q2ab' });

    const { config, errors } = loadConfig(paths);
    expect(errors).toEqual([]);
    expect(config.profile).toMatchObject({
      firstName: 'Sam',
      lastName: 'de Vries',
      birthYear: 1999,
      occupation: 'phd',
      organisation: 'TU Delft',
      incomeMonthlyGrossEur: 2900,
      moveInFrom: '2026-11-01',
      email: 'sam.nlpf@gmail.com',
      about: 'I am a quiet PhD student who cycles everywhere.',
    });
    const search = config.searches[0]!;
    expect(search.regions.map((r) => r.name)).toEqual(['Delft', 'Rotterdam', 'Den Haag']);
    expect(search.regions[2]?.municipalities).toEqual(["'s-Gravenhage"]);
    expect(search.priceMaxEur).toBe(1400);
    expect(search.types).toEqual(['studio', 'apartment']);
    expect(config.automation.availability).toEqual([
      { days: ['mon', 'tue', 'wed', 'thu', 'fri'], start: '17:00', end: '21:00' },
      { days: ['sat'], start: '10:00', end: '16:00' },
    ]);
    expect(config.mail).toMatchObject({
      provider: 'imap',
      address: 'sam.nlpf@gmail.com',
      user: 'sam.nlpf@gmail.com',
    });
    expect(config.notify.ntfy).toMatchObject({ server: 'https://ntfy.sh', topic: 'nlpf-k3j9x0q2ab' });
    expect(config.ai.provider).toBe('claude');

    expect(loadSecrets(paths)).toEqual({
      NLPF_MAIL_PASSWORD: 'abcd efgh ijkl mnop',
      ANTHROPIC_API_KEY: 'sk-ant-test-key-123456',
    });
    expect(existsSync(paths.schemaFile)).toBe(true);
    expect(res).toMatchObject({
      configFile: paths.configFile,
      secretsSaved: ['NLPF_MAIL_PASSWORD', 'ANTHROPIC_API_KEY'],
    });
    const printed = p.said.join('\n');
    expect(printed).not.toContain('abcd efgh');
    expect(printed).not.toContain('sk-ant-test');
  });

  test('asks about a guarantor when there is no income, and uses rules without an AI key', async () => {
    const paths = home();
    const p = scripted([
      [/first name/i, 'Noor'],
      [/cities/i, 'Utrecht'],
      [/guarantor\?/i, 'y'],
      [/guarantor's relation/i, 'parent'],
      [/guarantor's gross/i, '5200'],
    ]);
    await runInit({ paths, prompter: p, flags: {}, env: {} });
    const { config } = loadConfig(paths);
    expect(config.profile.guarantor).toEqual({ relation: 'parent', incomeMonthlyGrossEur: 5200 });
    expect(config.ai.provider).toBe('rules');
    expect(config.mail.provider).toBe('none');
  });

  test('re-asks when an answer does not parse', async () => {
    const paths = home();
    let budgetAsks = 0;
    const base = scripted([
      [/first name/i, 'Sam'],
      [/cities/i, 'Delft'],
    ]);
    const p: Prompter = {
      ...base,
      ask: async (q, opts) => {
        if (/maximum rent/i.test(q)) {
          budgetAsks++;
          const answer = budgetAsks === 1 ? 'about a thousand' : '1000';
          if (opts?.validate) {
            const problem = opts.validate(answer);
            if (problem) return p.ask(q, opts);
          }
          return answer;
        }
        return base.ask(q, opts);
      },
    };
    await runInit({ paths, prompter: p, flags: {}, env: {} });
    expect(budgetAsks).toBe(2);
    expect(loadConfig(paths).config.searches[0]?.priceMaxEur).toBe(1000);
  });

  test('saying no at the review writes nothing', async () => {
    const paths = home();
    const p = scripted([
      [/first name/i, 'Sam'],
      [/cities/i, 'Delft'],
      [/write this/i, 'n'],
    ]);
    const res = await runInit({ paths, prompter: p, flags: {}, env: {} });
    expect(res.written).toBe(false);
    expect(existsSync(paths.configFile)).toBe(false);
  });
});

describe('nlpf init --yes', () => {
  test('takes everything from flags and asks nothing', async () => {
    const paths = home();
    const res = await runInit({
      paths,
      prompter: silent,
      env: {},
      random: () => 'aaaaaaaaaa',
      flags: {
        yes: true,
        firstName: 'Sam',
        lastName: 'de Vries',
        occupation: 'employed',
        income: '4100',
        regions: 'Amsterdam',
        budget: '1800',
        minSize: '35',
        types: 'apartment',
        furnishing: 'unfurnished,upholstered',
        mailAddress: 'sam@gmail.com',
        dryRun: true,
      },
    });
    const { config } = loadConfig(paths);
    expect(config.profile).toMatchObject({
      firstName: 'Sam',
      occupation: 'employed',
      incomeMonthlyGrossEur: 4100,
    });
    expect(config.searches[0]).toMatchObject({
      priceMaxEur: 1800,
      sizeMinM2: 35,
      types: ['apartment'],
      furnishing: ['unfurnished', 'upholstered'],
    });
    expect(config.automation.dryRun).toBe(true);
    expect(config.mail.provider).toBe('imap');
    expect(config.notify.ntfy?.topic).toBe('nlpf-aaaaaaaaaa');
    expect(config.ai.provider).toBe('rules');
    expect(res.secretsSaved).toEqual([]);
  });

  test('--secrets-from-env copies known secrets from the environment without printing them', async () => {
    const paths = home();
    const said: string[] = [];
    await runInit({
      paths,
      prompter: { ...silent, say: (t) => said.push(t) },
      env: { ANTHROPIC_API_KEY: 'sk-ant-from-env-999999', NLPF_MAIL_PASSWORD: 'pass word here' },
      flags: {
        yes: true,
        firstName: 'Sam',
        regions: 'Delft',
        mailAddress: 'sam@gmail.com',
        secretsFromEnv: true,
      },
    });
    expect(loadSecrets(paths)).toEqual({
      ANTHROPIC_API_KEY: 'sk-ant-from-env-999999',
      NLPF_MAIL_PASSWORD: 'pass word here',
    });
    expect(loadConfig(paths).config.ai.provider).toBe('claude');
    expect(said.join('\n')).not.toContain('sk-ant-from-env');
  });

  test('keeps what an earlier run saved', async () => {
    const paths = home();
    saveConfig(
      paths,
      ConfigSchema.parse({
        profile: { firstName: 'Sam', about: 'Hello' },
        searches: [
          {
            id: 'main',
            name: 'Main',
            regions: [{ name: 'Delft', postcodes: ['2611-2629'] }],
            priceMaxEur: 900,
          },
        ],
        notify: { ntfy: { topic: 'nlpf-existing01' } },
      }),
    );
    await runInit({ paths, prompter: silent, env: {}, flags: { yes: true, budget: '950' } });
    const { config } = loadConfig(paths);
    expect(config.profile).toMatchObject({ firstName: 'Sam', about: 'Hello' });
    expect(config.searches[0]?.regions).toEqual([
      { name: 'Delft', municipalities: [], postcodes: ['2611-2629'] },
    ]);
    expect(config.searches[0]?.priceMaxEur).toBe(950);
    expect(config.notify.ntfy?.topic).toBe('nlpf-existing01');
  });

  test('a flag that does not parse is an error that names the flag', async () => {
    const paths = home();
    await expect(
      runInit({
        paths,
        prompter: silent,
        env: {},
        flags: { yes: true, firstName: 'Sam', regions: 'Delft', budget: 'lots' },
      }),
    ).rejects.toThrow(/--budget/);
    await expect(
      runInit({ paths, prompter: silent, env: {}, flags: { yes: true, firstName: 'Sam' } }),
    ).rejects.toThrow(/--regions/);
  });
});

describe('parsers', () => {
  test('regions map common names to their municipality', () => {
    expect(parseRegions('Delft, The Hague , den bosch')).toEqual([
      { name: 'Delft', municipalities: ['Delft'], postcodes: [] },
      { name: 'The Hague', municipalities: ["'s-Gravenhage"], postcodes: [] },
      { name: 'den bosch', municipalities: ["'s-Hertogenbosch"], postcodes: [] },
    ]);
  });

  test('availability reads day ranges and lists', () => {
    expect(parseAvailability('sat,sun 10:00-18:00')).toEqual([
      { days: ['sat', 'sun'], start: '10:00', end: '18:00' },
    ]);
    expect(parseAvailability('fri-mon 09:00-12:00')).toEqual([
      { days: ['fri', 'sat', 'sun', 'mon'], start: '09:00', end: '12:00' },
    ]);
    expect(() => parseAvailability('weekends')).toThrow();
    expect(() => parseAvailability('mon 18:00-09:00')).toThrow();
  });

  test('the ntfy topic is hard to guess', () => {
    expect(suggestTopic()).toMatch(/^nlpf-[a-z0-9]{10}$/);
    expect(suggestTopic()).not.toBe(suggestTopic());
  });
});

describe('readline prompter', () => {
  test('shows the default, returns the typed answer, and falls back to the default on Enter', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let shown = '';
    output.on('data', (c) => (shown += String(c)));
    const p = createReadlinePrompter({ input, output });
    const first = p.ask('First name', { default: 'Sam' });
    input.write('Kim\n');
    expect(await first).toBe('Kim');
    const second = p.ask('Last name', { default: 'de Vries' });
    input.write('\n');
    expect(await second).toBe('de Vries');
    const yes = p.confirm('Pets?', false);
    input.write('y\n');
    expect(await yes).toBe(true);
    p.close();
    expect(shown).toContain('First name [Sam]: ');
    expect(shown).toContain('Pets? [y/N] ');
  });
});
