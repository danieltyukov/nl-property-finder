import { randomInt } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import {
  ConfigSchema,
  NamedSearchSchema,
  loadConfig,
  loadSecrets,
  saveConfig,
  setSecret,
  writeJsonSchema,
  type AutomationConfig,
  type Config,
  type Paths,
  type RegionConfig,
} from '@nlpf/core';

/*
 * `nlpf init`: a short interview that writes config.yaml and secrets.env.
 * Every question has a flag, so `nlpf init --yes --first-name Sam ...` does the
 * same without a terminal. Nothing is written until the review is confirmed,
 * and secrets are never echoed or printed.
 */

export interface Prompter {
  say(text: string): void;
  ask(
    question: string,
    opts?: { default?: string; validate?: (answer: string) => string | null },
  ): Promise<string>;
  secret(question: string): Promise<string>;
  confirm(question: string, defaultValue: boolean): Promise<boolean>;
  close(): void;
}

export interface InitFlags {
  yes?: boolean;
  firstName?: string;
  lastName?: string;
  birthYear?: string;
  occupation?: string;
  organisation?: string;
  income?: string;
  guarantorRelation?: string;
  guarantorIncome?: string;
  phone?: string;
  moveIn?: string;
  moveInLatest?: string;
  adults?: string;
  children?: string;
  pets?: boolean;
  smoker?: boolean;
  language?: string;
  about?: string;
  regions?: string;
  budget?: string;
  minSize?: string;
  types?: string;
  furnishing?: string;
  availability?: string;
  mailAddress?: string;
  ntfyTopic?: string;
  ntfyServer?: string;
  ai?: string;
  dryRun?: boolean;
  secretsFromEnv?: boolean;
}

export interface InitResult {
  written: boolean;
  configFile: string;
  schemaFile: string;
  secretsFile: string;
  secretsSaved: string[];
  ntfyTopic?: string;
}

export class InitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InitError';
  }
}

const OCCUPATIONS = ['student', 'phd', 'employed', 'self_employed', 'starting_job', 'other'] as const;
const TYPES = ['room', 'studio', 'apartment', 'house', 'other'] as const;
const FURNISHING = ['unfurnished', 'upholstered', 'furnished', 'unknown'] as const;
const LANGUAGES = ['auto', 'nl', 'en'] as const;
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
type Day = (typeof DAYS)[number];

const DAY_NAMES: Record<string, Day> = {
  mon: 'mon',
  monday: 'mon',
  ma: 'mon',
  maandag: 'mon',
  tue: 'tue',
  tuesday: 'tue',
  di: 'tue',
  dinsdag: 'tue',
  wed: 'wed',
  wednesday: 'wed',
  wo: 'wed',
  woensdag: 'wed',
  thu: 'thu',
  thursday: 'thu',
  do: 'thu',
  donderdag: 'thu',
  fri: 'fri',
  friday: 'fri',
  vr: 'fri',
  vrijdag: 'fri',
  sat: 'sat',
  saturday: 'sat',
  za: 'sat',
  zaterdag: 'sat',
  sun: 'sun',
  sunday: 'sun',
  zo: 'sun',
  zondag: 'sun',
};

// Names people type for a municipality whose official name is different.
const MUNICIPALITY_ALIASES: Record<string, string> = {
  'den haag': "'s-Gravenhage",
  'the hague': "'s-Gravenhage",
  "'s-gravenhage": "'s-Gravenhage",
  's-gravenhage': "'s-Gravenhage",
  'den bosch': "'s-Hertogenbosch",
  "'s-hertogenbosch": "'s-Hertogenbosch",
  's-hertogenbosch': "'s-Hertogenbosch",
};

/* ---------- parsers (each throws a plain sentence when the answer does not fit) ---------- */

export function parseRegions(text: string): RegionConfig[] {
  const names = text
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (names.length === 0) throw new Error('Name at least one city or municipality, for example Delft.');
  return names.map((name) => {
    if (/^\d{4}(-\d{4})?$/.test(name)) return { name, municipalities: [], postcodes: [name] };
    return { name, municipalities: [MUNICIPALITY_ALIASES[name.toLowerCase()] ?? name], postcodes: [] };
  });
}

function parseDays(text: string): Day[] {
  const out: Day[] = [];
  for (const part of text
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)) {
    const range = part.split('-');
    if (range.length === 2) {
      const from = DAY_NAMES[range[0]!];
      const to = DAY_NAMES[range[1]!];
      if (!from || !to) throw new Error(`"${part}" is not a day range like mon-fri.`);
      let i = DAYS.indexOf(from);
      for (;;) {
        out.push(DAYS[i]!);
        if (DAYS[i] === to) break;
        i = (i + 1) % 7;
      }
    } else {
      const day = DAY_NAMES[part];
      if (!day) throw new Error(`"${part}" is not a day. Use mon, tue, wed, thu, fri, sat or sun.`);
      out.push(day);
    }
  }
  if (out.length === 0) throw new Error('Name at least one day.');
  return [...new Set(out)];
}

/** "mon-fri 17:00-21:00; sat 10:00-16:00" to availability windows. */
export function parseAvailability(text: string): AutomationConfig['availability'] {
  const entries = text
    .split(/[;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (entries.length === 0) throw new Error('Give at least one window, for example mon-fri 17:00-21:00.');
  return entries.map((entry) => {
    const m = entry.match(/^(.+?)\s+([01]\d|2[0-3]):([0-5]\d)\s*-\s*([01]\d|2[0-3]):([0-5]\d)$/);
    if (!m) throw new Error(`"${entry}" should look like mon-fri 17:00-21:00.`);
    const start = `${m[2]}:${m[3]}`;
    const end = `${m[4]}:${m[5]}`;
    if (end <= start) throw new Error(`In "${entry}" the end time comes before the start time.`);
    return { days: parseDays(m[1]!), start, end };
  });
}

export function formatAvailability(list: AutomationConfig['availability']): string {
  return list
    .map((w) => {
      const idx = w.days.map((d) => DAYS.indexOf(d)).sort((a, b) => a - b);
      const consecutive = idx.length > 2 && idx.every((v, i) => i === 0 || v === idx[i - 1]! + 1);
      const days = consecutive
        ? `${DAYS[idx[0]!]}-${DAYS[idx[idx.length - 1]!]}`
        : idx.map((i) => DAYS[i]).join(',');
      return `${days} ${w.start}-${w.end}`;
    })
    .join('; ');
}

/** A topic name that is hard to guess, because anyone who knows an ntfy topic can read it. */
export function suggestTopic(random: () => string = randomChars): string {
  return `nlpf-${random()}`;
}

function randomChars(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 10; i++) s += alphabet[randomInt(alphabet.length)];
  return s;
}

const optionalText = (s: string): string | undefined => s || undefined;

const required =
  (what: string) =>
  (s: string): string => {
    if (!s) throw new Error(`${what} is needed.`);
    return s;
  };

function optionalYear(s: string): number | undefined {
  if (!s) return undefined;
  const year = Number(s);
  if (!/^\d{4}$/.test(s) || year < 1900 || year > new Date().getFullYear())
    throw new Error(`"${s}" is not a year of birth.`);
  return year;
}

function optionalDate(s: string): string | undefined {
  if (!s) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) {
    throw new Error(`"${s}" is not a date like 2026-11-01.`);
  }
  return s;
}

function optionalEuros(s: string): number | undefined {
  if (!s) return undefined;
  let t = s.replace(/[€\s]|eur(o|os)?/gi, '');
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  t = t.replace(',', '.');
  const n = Number(t);
  if (!/^\d+(\.\d{1,2})?$/.test(t) || n <= 0) throw new Error(`"${s}" is not an amount in euros, like 1400.`);
  return n;
}

function optionalNumber(s: string): number | undefined {
  if (!s) return undefined;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`"${s}" is not a positive number.`);
  return n;
}

const count =
  (min: number) =>
  (s: string): number => {
    const n = Number(s);
    if (!/^\d+$/.test(s) || n < min) throw new Error(`"${s}" should be a whole number of at least ${min}.`);
    return n;
  };

function oneOf<T extends string>(allowed: readonly T[]) {
  return (s: string): T => {
    const v = s.toLowerCase().replace(/[\s-]/g, '_') as T;
    if (!allowed.includes(v)) throw new Error(`Choose one of: ${allowed.join(', ')}.`);
    return v;
  };
}

function listOf<T extends string>(allowed: readonly T[]) {
  return (s: string): T[] => {
    const items = s
      .split(/[,\s]+/)
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean) as T[];
    const bad = items.filter((x) => !allowed.includes(x));
    if (bad.length) throw new Error(`Unknown: ${bad.join(', ')}. Choose from: ${allowed.join(', ')}.`);
    if (items.length === 0) throw new Error(`Choose at least one of: ${allowed.join(', ')}.`);
    return [...new Set(items)];
  };
}

function optionalEmail(s: string): string | undefined {
  if (!s) return undefined;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw new Error(`"${s}" is not an email address.`);
  return s.toLowerCase();
}

function topicOrNone(s: string): string | undefined {
  if (s.toLowerCase() === 'none') return undefined;
  if (!/^[-_A-Za-z0-9]{1,64}$/.test(s))
    throw new Error('A topic uses letters, digits, dashes and underscores only.');
  return s;
}

const kebab = (key: string) => key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const str = (v: unknown) => (v === undefined || v === null ? '' : String(v));

function dropUndefined<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

/* ---------- the interview ---------- */

export async function runInit(opts: {
  paths: Paths;
  prompter: Prompter;
  flags: InitFlags;
  env: NodeJS.ProcessEnv;
  random?: () => string;
}): Promise<InitResult> {
  const { paths, prompter: p, flags, env } = opts;
  const yes = Boolean(flags.yes);
  const hadConfig = existsSync(paths.configFile);
  const loaded = hadConfig ? loadConfig(paths) : null;
  const cfg: Config = structuredClone(loaded?.config ?? ConfigSchema.parse({}));
  const secrets = loadSecrets(paths);
  const pending: [string, string][] = [];

  async function value<T>(
    key: keyof InitFlags,
    question: string,
    def: string,
    parse: (s: string) => T,
  ): Promise<T> {
    const flag = flags[key];
    if (typeof flag === 'string') {
      try {
        return parse(flag.trim());
      } catch (e) {
        throw new InitError(`--${kebab(key)}: ${message(e)}`);
      }
    }
    if (yes) {
      try {
        return parse(def);
      } catch (e) {
        throw new InitError(`--${kebab(key)}: ${message(e)}`);
      }
    }
    const validate = (a: string) => {
      try {
        parse(a.trim() || def);
        return null;
      } catch (e) {
        return message(e);
      }
    };
    for (let attempt = 0; attempt < 5; attempt++) {
      const raw = (await p.ask(question, { default: def || undefined, validate })).trim();
      try {
        return parse(raw || def);
      } catch (e) {
        p.say(`  ${message(e)}`);
      }
    }
    throw new InitError(`No usable answer for "${question}".`);
  }

  async function yesNo(key: keyof InitFlags, question: string, def: boolean): Promise<boolean> {
    const flag = flags[key];
    if (typeof flag === 'boolean') return flag;
    if (yes) return def;
    return p.confirm(question, def);
  }

  /** A secret from the environment (with consent) or typed with hidden input. Queued, written after the review. */
  async function secret(name: string, question: string, label: string, whenEmpty?: string): Promise<boolean> {
    const saved = Boolean(secrets[name]);
    const fromEnv = env[name];
    if (flags.secretsFromEnv && fromEnv) {
      pending.push([name, fromEnv]);
      return true;
    }
    if (yes) return saved;
    if (fromEnv && !saved && (await p.confirm(`Use the ${label} in ${name} from your environment?`, true))) {
      pending.push([name, fromEnv]);
      return true;
    }
    const hint = saved ? ', Enter keeps the saved one' : whenEmpty ? `, ${whenEmpty}` : '';
    const typed = (await p.secret(`${question} (input hidden${hint})`)).trim();
    if (typed) {
      pending.push([name, typed]);
      return true;
    }
    return saved;
  }

  p.say('NL Property Finder setup');
  p.say(
    `Settings go to ${paths.configFile}; passwords and keys go to ${paths.secretsFile}, which only you can read.`,
  );
  if (!yes) p.say('Press Enter to keep the value in brackets. Ctrl+C stops without writing anything.');
  if (loaded?.errors.length) {
    p.say(`Your config has errors, so this starts from the last good version: ${loaded.errors.join('; ')}`);
  }

  /* About you */
  const pr = cfg.profile;
  if (!yes) p.say('\nAbout you. Landlords read this, so write it the way you would introduce yourself.');
  pr.firstName = await value('firstName', 'First name', pr.firstName, required('A first name'));
  pr.lastName = await value('lastName', 'Last name', pr.lastName, (s) => s);
  pr.birthYear = await value('birthYear', 'Year of birth (optional)', str(pr.birthYear), optionalYear);
  pr.occupation = await value(
    'occupation',
    `Occupation (${OCCUPATIONS.join(', ')})`,
    pr.occupation,
    oneOf(OCCUPATIONS),
  );
  pr.organisation = await value(
    'organisation',
    'University or employer (optional)',
    pr.organisation ?? '',
    optionalText,
  );
  pr.incomeMonthlyGrossEur = await value(
    'income',
    'Gross monthly income in euros (optional)',
    str(pr.incomeMonthlyGrossEur),
    optionalEuros,
  );
  if (flags.guarantorRelation !== undefined || flags.guarantorIncome !== undefined) {
    pr.guarantor = dropUndefined({
      relation: await value(
        'guarantorRelation',
        "Guarantor's relation to you",
        pr.guarantor?.relation ?? 'parent',
        required('A relation'),
      ),
      incomeMonthlyGrossEur: await value(
        'guarantorIncome',
        "Guarantor's gross monthly income in euros (optional)",
        str(pr.guarantor?.incomeMonthlyGrossEur),
        optionalEuros,
      ),
    });
  } else if (!yes && (!pr.incomeMonthlyGrossEur || pr.occupation === 'student')) {
    p.say('Many landlords ask for an income of three to four times the rent, or a guarantor who has it.');
    if (await p.confirm('Do you have a guarantor?', Boolean(pr.guarantor))) {
      pr.guarantor = dropUndefined({
        relation: await value(
          'guarantorRelation',
          "Guarantor's relation to you",
          pr.guarantor?.relation ?? 'parent',
          required('A relation'),
        ),
        incomeMonthlyGrossEur: await value(
          'guarantorIncome',
          "Guarantor's gross monthly income in euros (optional)",
          str(pr.guarantor?.incomeMonthlyGrossEur),
          optionalEuros,
        ),
      });
    } else {
      pr.guarantor = undefined;
    }
  }
  pr.phone = await value('phone', 'Phone number for landlords (optional)', pr.phone ?? '', optionalText);
  pr.moveInFrom = await value(
    'moveIn',
    'Earliest move-in date, YYYY-MM-DD (optional)',
    pr.moveInFrom ?? '',
    optionalDate,
  );
  pr.moveInLatest = await value(
    'moveInLatest',
    'Latest move-in date, YYYY-MM-DD (optional)',
    pr.moveInLatest ?? '',
    optionalDate,
  );
  pr.household.adults = await value(
    'adults',
    'How many adults move in',
    String(pr.household.adults),
    count(1),
  );
  pr.household.children = await value(
    'children',
    'How many children',
    String(pr.household.children),
    count(0),
  );
  pr.household.pets = await yesNo('pets', 'Pets?', pr.household.pets);
  pr.smoker = await yesNo('smoker', 'Do you smoke?', pr.smoker);
  pr.messageLanguage = await value(
    'language',
    'Message language: auto follows the listing, or always nl or en',
    pr.messageLanguage,
    oneOf(LANGUAGES),
  );
  pr.about = await value(
    'about',
    'A few sentences about you, in your own words, for the agent to use in messages (optional)',
    pr.about,
    (s) => s,
  );

  /* The search */
  const search = cfg.searches[0] ?? NamedSearchSchema.parse({ id: 'main', name: 'Main search' });
  if (!yes) p.say('\nYour search. You can add more searches and draw areas on a map in the dashboard later.');
  const regionsText = search.regions.map((r) => r.name).join(', ');
  search.regions = await value(
    'regions',
    'Cities or municipalities, separated by commas',
    regionsText,
    (s) => (s === regionsText && search.regions.length ? search.regions : parseRegions(s)),
  );
  search.priceMaxEur = await value(
    'budget',
    'Maximum rent per month in euros (optional)',
    str(search.priceMaxEur),
    optionalEuros,
  );
  search.sizeMinM2 = await value(
    'minSize',
    'Minimum living area in m2 (optional)',
    str(search.sizeMinM2),
    optionalNumber,
  );
  search.types = await value(
    'types',
    `Types (${TYPES.slice(0, 4).join(', ')})`,
    search.types.join(', '),
    listOf(TYPES),
  );
  search.furnishing = await value(
    'furnishing',
    `Furnishing (${FURNISHING.join(', ')})`,
    search.furnishing.join(', '),
    listOf(FURNISHING),
  );
  cfg.searches[0] = search;
  cfg.automation.availability = await value(
    'availability',
    'When can you go to viewings? For example mon-fri 17:00-21:00; sat 10:00-16:00',
    formatAvailability(cfg.automation.availability),
    parseAvailability,
  );

  /* Mail */
  if (!yes) {
    p.say(
      '\nMail. The agent writes to landlords and reads their replies from its own Gmail address, so nothing reaches your personal inbox.',
    );
    p.say(
      'Create a new Gmail account, turn on 2-Step Verification, then make an app password at https://myaccount.google.com/apppasswords',
    );
  }
  const address = await value(
    'mailAddress',
    'Dedicated Gmail address (leave empty to set up mail later)',
    cfg.mail.provider === 'imap' ? cfg.mail.address : '',
    optionalEmail,
  );
  let mailPassword = false;
  if (address) {
    cfg.mail.provider = 'imap';
    cfg.mail.address = address;
    cfg.mail.user = address;
    pr.email = address;
    mailPassword = await secret(cfg.mail.passwordEnv, 'App password', 'mail password');
  } else if (cfg.mail.provider === 'imap') {
    cfg.mail.provider = 'none';
  }

  /* Notifications */
  if (!yes)
    p.say(
      '\nPhone alerts through ntfy. Anyone who knows the topic name can read it, so keep the random part.',
    );
  const topic = await value(
    'ntfyTopic',
    'ntfy topic (type none for no phone alerts)',
    cfg.notify.ntfy?.topic ?? suggestTopic(opts.random),
    topicOrNone,
  );
  if (topic) {
    const server = await value(
      'ntfyServer',
      'ntfy server',
      cfg.notify.ntfy?.server ?? 'https://ntfy.sh',
      (s) => {
        if (!/^https?:\/\/\S+$/.test(s)) throw new Error(`"${s}" is not a URL.`);
        return s.replace(/\/+$/, '');
      },
    );
    cfg.notify.ntfy = { server, topic, actions: cfg.notify.ntfy?.actions ?? true };
  } else {
    cfg.notify.ntfy = undefined;
  }

  /* AI */
  if (!yes)
    p.say(
      '\nAI. With an Anthropic API key the agent reads listings and writes messages with Claude. Without one it uses templates and rules, which also work.',
    );
  const hasKey = await secret(cfg.ai.keyEnv, 'Anthropic API key', 'API key', 'leave empty to use rules');
  const ai = flags.ai === undefined ? undefined : oneOfOrThrow('ai', flags.ai, ['claude', 'rules'] as const);
  cfg.ai.provider = ai ?? (hasKey ? 'claude' : cfg.ai.provider === 'demo' ? 'demo' : 'rules');

  /* Automation */
  cfg.automation.dryRun = await yesNo(
    'dryRun',
    'Start in dry run? The agent then drafts messages but sends nothing until you turn it off',
    cfg.automation.dryRun,
  );

  /* Review */
  const summary = [
    `Name: ${[pr.firstName, pr.lastName].filter(Boolean).join(' ')} (${pr.occupation}${pr.organisation ? `, ${pr.organisation}` : ''})`,
    `Search: ${search.regions.map((r) => r.name).join(', ')}${search.priceMaxEur ? `, up to EUR ${search.priceMaxEur}` : ''}, ${search.types.join(', ')}`,
    `Mail: ${cfg.mail.provider === 'imap' ? `${cfg.mail.address}${mailPassword ? '' : ' (no app password yet)'}` : 'not set up'}`,
    `Phone alerts: ${cfg.notify.ntfy ? `${cfg.notify.ntfy.server}/${cfg.notify.ntfy.topic}` : 'off'}`,
    `AI: ${cfg.ai.provider}`,
    `Dry run: ${cfg.automation.dryRun ? 'yes, nothing is sent' : 'no'}`,
  ];
  p.say('\nReview');
  for (const line of summary) p.say(`  ${line}`);

  const result: InitResult = {
    written: false,
    configFile: paths.configFile,
    schemaFile: paths.schemaFile,
    secretsFile: paths.secretsFile,
    secretsSaved: [],
    ntfyTopic: cfg.notify.ntfy?.topic,
  };
  if (!yes && !(await p.confirm('Write this configuration?', true))) {
    p.say('Nothing was written.');
    return result;
  }

  cfg.profile = dropUndefined(pr);
  saveConfig(paths, ConfigSchema.parse(cfg));
  writeJsonSchema(paths);
  for (const [name, v] of pending) setSecret(paths, name, v);
  result.written = true;
  result.secretsSaved = pending.map(([name]) => name);

  p.say(`\nSaved ${paths.configFile}.`);
  if (cfg.notify.ntfy)
    p.say(
      `Install the ntfy app and subscribe to the topic ${cfg.notify.ntfy.topic} to get alerts on your phone.`,
    );
  p.say(
    'Next: nlpf doctor checks that everything is reachable, nlpf on starts the agent now and at every login, and nlpf open shows the dashboard.',
  );
  return result;
}

function oneOfOrThrow<T extends string>(key: string, v: string, allowed: readonly T[]): T {
  try {
    return oneOf(allowed)(v);
  } catch (e) {
    throw new InitError(`--${key}: ${message(e)}`);
  }
}

/* ---------- the terminal prompter ---------- */

/** Passes writes through to the real output, except while a secret is typed. */
class MutableOutput extends Writable {
  muted = false;
  constructor(private readonly target: NodeJS.WritableStream) {
    super();
  }
  override _write(chunk: Buffer | string, _enc: BufferEncoding, done: (e?: Error | null) => void): void {
    if (!this.muted) this.target.write(chunk);
    done();
  }
  get columns(): number | undefined {
    return (this.target as { columns?: number }).columns;
  }
  get isTTY(): boolean {
    return Boolean((this.target as { isTTY?: boolean }).isTTY);
  }
}

export class InitAborted extends Error {
  constructor() {
    super('Setup stopped before the end. Nothing was written.');
    this.name = 'InitAborted';
  }
}

/**
 * A Prompter on node:readline/promises. Lines are queued as they arrive, so
 * answers piped in all at once are not lost between questions.
 */
export function createReadlinePrompter(
  opts: { input?: NodeJS.ReadableStream; output?: NodeJS.WritableStream } = {},
): Prompter {
  const input = opts.input ?? process.stdin;
  const output = opts.output ?? process.stdout;
  const muted = new MutableOutput(output);
  const terminal = Boolean((input as { isTTY?: boolean }).isTTY);
  const rl = createInterface({ input, output: muted, terminal });
  const lines: string[] = [];
  const waiting: ((line: string | null) => void)[] = [];
  let closed = false;

  rl.on('line', (line) => {
    const next = waiting.shift();
    if (next) next(line);
    else lines.push(line);
  });
  rl.on('close', () => {
    closed = true;
    for (const w of waiting.splice(0)) w(null);
  });
  rl.on('SIGINT', () => {
    output.write('\nStopped. Nothing was written.\n');
    rl.close();
    process.exit(130);
  });

  const nextLine = (): Promise<string> => {
    const queued = lines.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    if (closed) return Promise.reject(new InitAborted());
    return new Promise((resolve, reject) =>
      waiting.push((l) => (l === null ? reject(new InitAborted()) : resolve(l))),
    );
  };

  const question = async (prompt: string, hidden = false): Promise<string> => {
    rl.setPrompt(prompt);
    rl.prompt(true);
    muted.muted = hidden;
    try {
      return await nextLine();
    } finally {
      if (hidden) {
        muted.muted = false;
        if (terminal) output.write('\n');
      }
    }
  };

  return {
    say: (text) => {
      output.write(`${text}\n`);
    },
    async ask(q, o = {}) {
      for (;;) {
        const answer = (await question(o.default ? `${q} [${o.default}]: ` : `${q}: `)).trim();
        const value = answer || o.default || '';
        const problem = o.validate?.(value);
        if (!problem) return value;
        output.write(`  ${problem}\n`);
      }
    },
    secret: (q) => question(`${q}: `, true),
    async confirm(q, def) {
      const answer = (await question(`${q} ${def ? '[Y/n]' : '[y/N]'} `)).trim().toLowerCase();
      if (!answer) return def;
      return answer.startsWith('y') || answer.startsWith('j');
    },
    close: () => rl.close(),
  };
}
