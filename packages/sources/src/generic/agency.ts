import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { load, type Cheerio, type CheerioAPI } from 'cheerio';
import YAML from 'yaml';
import {
  fromAmsterdam,
  type ContactResult,
  type Listing,
  type OutboundMessage,
  type RawListing,
  type SourceAdapter,
  type SourceContext,
} from '@nlpf/core';
import { NeedsLoginError, SourceHttpError } from '../runtime/errors.js';
import { normalisePostcode, splitAddress } from '../util/address.js';
import { detectFurnishing, detectType, parseBedrooms, parseDutchDate, parsePrice, parseRooms, parseSize } from '../util/parse.js';
import { AGENCY_PRESETS, type AgencyPresetName } from './presets.js';

type AnyNode = Exclude<Parameters<typeof load>[0], string | Buffer | readonly unknown[]>;

/* ---------- definition ---------- */

export const AGENCY_FIELDS = [
  'url', 'externalId', 'title', 'street', 'address', 'postcode', 'city', 'price', 'size', 'rooms', 'bedrooms',
  'type', 'furnishing', 'availableFrom', 'status', 'image', 'publishedAt', 'lat', 'lon', 'description', 'energyLabel',
] as const;
export type AgencyField = (typeof AGENCY_FIELDS)[number];

/**
 * Where one value comes from. In YAML a plain string is short for
 * `{ selector: ... }` (HTML) or `{ path: ... }` (JSON).
 */
export interface FieldSpec {
  /** CSS selector inside the card or page. Omitted: the card itself. */
  selector?: string;
  /** Read this attribute instead of the text. "data-src|src" tries each in turn. */
  attr?: string;
  /** Dotted path inside a JSON item ("price.amount", "photos.0.url"). */
  path?: string;
  /** Regular expression (case-insensitive); the first group, or the whole match, becomes the value. */
  pattern?: string;
  /** Replaces whole values, case-insensitive ("true": "gemeubileerd"). */
  map?: Record<string, string>;
  /** Skip the listing when the value contains one of these words (case-insensitive). */
  exclude?: string[];
  /** Skip the listing unless the value contains one of these words. */
  require?: string[];
}

export type AgencyFields = Partial<Record<AgencyField, FieldSpec>>;

export interface AgencyListDef {
  url: string | string[];
  format: 'html' | 'json';
  /** HTML: CSS selector matching one listing card. */
  item?: string;
  /** JSON: dotted path to the array of listings; omitted means the response is the array. */
  items?: string;
  fields: AgencyFields;
  /** Extra conditions every listing must meet, such as `{ path: isRentals, require: [true] }`. */
  filters?: FieldSpec[];
  /** HTML: the link to the next page of results. */
  next?: FieldSpec;
  /** Pages to read when `next` is set. Default 3. */
  maxPages?: number;
}

export interface AgencyDetailDef {
  description?: FieldSpec;
  images?: FieldSpec;
  /** Status on the detail page; with `exclude` it decides whether the listing is still available. */
  status?: FieldSpec;
  /** More fields read from the detail page; they fill what the card did not have. */
  fields?: AgencyFields;
}

export interface AgencyFormDef {
  /** Full name field. Use `firstName` and `lastName` when the form splits them. */
  name?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  subject?: string;
  message: string;
  /** Checkboxes to tick, such as the privacy consent. */
  check?: string[];
  /** Clicked first when visible, for forms hidden behind a tab or button. */
  open?: string;
  submit: string;
  /** Playwright selector that appears after a successful send, like "text=/bedankt/i". */
  success: string;
}

export interface AgencyContactDef {
  kind: 'form' | 'email' | 'none';
  /** Page with the form. "{url}" is the listing URL, "{id}" its external id, "{homepage}" the agency homepage. */
  url?: string;
  form?: AgencyFormDef;
  email?: string;
}

export interface AgencyDef {
  /** Lowercase letters, digits and dashes; the source id becomes "agency:<id>". */
  id: string;
  name: string;
  homepage: string;
  regions?: string[];
  preset?: AgencyPresetName;
  intervalSec?: number;
  list: AgencyListDef;
  detail?: AgencyDetailDef;
  contact?: AgencyContactDef;
  terms?: 'allows' | 'forbids' | 'unknown';
}

export class AgencyDefError extends Error {
  override readonly name = 'AgencyDefError';
  readonly issues: string[];
  readonly file?: string;

  constructor(message: string, issues: string[], file?: string) {
    super(message);
    this.issues = issues;
    if (file !== undefined) this.file = file;
  }
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function deepMerge(base: unknown, over: unknown): unknown {
  if (isObj(base) && isObj(over)) {
    const out: Obj = { ...base };
    for (const [k, v] of Object.entries(over)) out[k] = v === undefined ? base[k] : deepMerge(base[k], v);
    return out;
  }
  return over === undefined ? base : over;
}

const FIELD_KEYS = ['selector', 'attr', 'path', 'pattern', 'map', 'exclude', 'require'];
const PRESET_NAMES = ['realworks', 'kolibri', 'ogonline', 'none'];

class Checker {
  issues: string[] = [];

  add(path: string, msg: string) {
    this.issues.push(`${path}: ${msg}`);
  }

  keys(v: Obj, allowed: string[], path: string) {
    for (const k of Object.keys(v)) {
      if (!allowed.includes(k)) this.add(path ? `${path}.${k}` : k, `unknown key; expected one of ${allowed.join(', ')}`);
    }
  }

  str(v: unknown, path: string, required = false): string | undefined {
    if (v === undefined || v === null) {
      if (required) this.add(path, 'is required');
      return undefined;
    }
    if (typeof v !== 'string' || !v.trim()) {
      this.add(path, 'must be a non-empty string');
      return undefined;
    }
    return v.trim();
  }

  url(v: unknown, path: string, required = false): string | undefined {
    const s = this.str(v, path, required);
    if (s === undefined) return undefined;
    try {
      const u = new URL(s);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('not http');
      return s;
    } catch {
      this.add(path, `must be an http or https URL, got "${s}"`);
      return undefined;
    }
  }

  words(v: unknown, path: string): string[] | undefined {
    if (v === undefined || v === null) return undefined;
    const list = Array.isArray(v) ? v : [v];
    if (!list.every((w) => typeof w === 'string' || typeof w === 'number' || typeof w === 'boolean')) {
      this.add(path, 'must be a list of words');
      return undefined;
    }
    return list.map(String);
  }

  field(v: unknown, path: string, format: 'html' | 'json'): FieldSpec | undefined {
    if (v === undefined || v === null) return undefined;
    if (typeof v === 'string') return format === 'json' ? { path: v } : { selector: v };
    if (!isObj(v)) {
      this.add(path, 'must be a selector string or a mapping with selector, attr, path, pattern, map, exclude or require');
      return undefined;
    }
    this.keys(v, FIELD_KEYS, path);
    const spec: FieldSpec = {};
    const selector = this.str(v.selector, `${path}.selector`);
    const attr = this.str(v.attr, `${path}.attr`);
    const p = this.str(v.path, `${path}.path`);
    const pattern = this.str(v.pattern, `${path}.pattern`);
    if (selector) spec.selector = selector;
    if (attr) spec.attr = attr;
    if (p) spec.path = p;
    if (pattern) {
      try {
        new RegExp(pattern, 'i');
        spec.pattern = pattern;
      } catch (e) {
        this.add(`${path}.pattern`, `is not a valid regular expression (${(e as Error).message})`);
      }
    }
    if (v.map !== undefined) {
      if (!isObj(v.map)) this.add(`${path}.map`, 'must be a mapping from value to replacement');
      else spec.map = Object.fromEntries(Object.entries(v.map).map(([k, val]) => [k, val == null ? '' : String(val)]));
    }
    const exclude = this.words(v.exclude, `${path}.exclude`);
    const require = this.words(v.require, `${path}.require`);
    if (exclude) spec.exclude = exclude;
    if (require) spec.require = require;
    return spec;
  }

  fields(v: unknown, path: string, format: 'html' | 'json'): AgencyFields {
    const out: AgencyFields = {};
    if (v === undefined || v === null) return out;
    if (!isObj(v)) {
      this.add(path, 'must be a mapping of field name to selector');
      return out;
    }
    for (const [k, val] of Object.entries(v)) {
      if (!(AGENCY_FIELDS as readonly string[]).includes(k)) {
        this.add(`${path}.${k}`, `unknown field; expected one of ${AGENCY_FIELDS.join(', ')}`);
        continue;
      }
      const spec = this.field(val, `${path}.${k}`, format);
      if (spec) out[k as AgencyField] = spec;
    }
    return out;
  }
}

/**
 * Validates an agency definition (the parsed YAML), fills in its preset and
 * returns the normalised form. Throws `AgencyDefError` listing every mistake
 * with its path, such as "list.item: is required".
 */
export function parseAgencyDef(input: unknown, origin = 'agency definition'): AgencyDef {
  const c = new Checker();
  const fail = () => new AgencyDefError(`${origin}: ${c.issues.join('; ')}`, c.issues, origin);
  if (!isObj(input)) {
    c.add('(root)', 'must be a mapping');
    throw fail();
  }

  let raw: Obj = input;
  const presetName = input.preset ?? 'none';
  if (typeof presetName !== 'string' || !PRESET_NAMES.includes(presetName)) {
    c.add('preset', `must be one of ${PRESET_NAMES.join(', ')}`);
  } else if (presetName !== 'none') {
    const preset = AGENCY_PRESETS[presetName as Exclude<AgencyPresetName, 'none'>];
    raw = deepMerge(structuredClone(preset.defaults), input) as Obj;
    const list = isObj(raw.list) ? raw.list : {};
    if (list.url === undefined && typeof raw.homepage === 'string') {
      try {
        raw.list = { ...list, url: new URL(preset.listPath, raw.homepage).toString() };
      } catch {
        // homepage is reported below
      }
    }
  }

  c.keys(raw, ['id', 'name', 'homepage', 'regions', 'preset', 'intervalSec', 'list', 'detail', 'contact', 'terms'], '');
  const id = c.str(raw.id, 'id', true);
  if (id && !/^[a-z0-9][a-z0-9-]*$/.test(id)) c.add('id', 'must use lowercase letters, digits and dashes only');
  const name = c.str(raw.name, 'name', true);
  const homepage = c.url(raw.homepage, 'homepage', true);
  const regions = c.words(raw.regions, 'regions')?.map((r) => r.trim().toLowerCase()).filter(Boolean);
  let intervalSec: number | undefined;
  if (raw.intervalSec !== undefined) {
    if (typeof raw.intervalSec !== 'number' || !Number.isInteger(raw.intervalSec) || raw.intervalSec < 60) {
      c.add('intervalSec', 'must be a whole number of seconds, at least 60');
    } else intervalSec = raw.intervalSec;
  }
  let terms: AgencyDef['terms'];
  if (raw.terms !== undefined) {
    if (raw.terms === 'allows' || raw.terms === 'forbids' || raw.terms === 'unknown') terms = raw.terms;
    else c.add('terms', 'must be allows, forbids or unknown');
  }

  // list
  let list: AgencyListDef = { url: '', format: 'html', fields: {} };
  if (!isObj(raw.list)) c.add('list', 'is required');
  else {
    const l = raw.list;
    c.keys(l, ['url', 'format', 'item', 'items', 'fields', 'filters', 'next', 'maxPages'], 'list');
    const format = l.format === undefined ? 'html' : l.format;
    if (format !== 'html' && format !== 'json') c.add('list.format', 'must be html or json');
    const fmt = format === 'json' ? 'json' : 'html';
    let url: string | string[] = '';
    if (Array.isArray(l.url)) {
      const urls = l.url.map((u, i) => c.url(u, `list.url.${i}`, true)).filter((u): u is string => Boolean(u));
      if (urls.length === 0) c.add('list.url', 'needs at least one URL');
      url = urls;
    } else url = c.url(l.url, 'list.url', true) ?? '';
    list = { url, format: fmt, fields: c.fields(l.fields, 'list.fields', fmt) };
    if (fmt === 'html') {
      const item = c.str(l.item, 'list.item', true);
      if (item) list.item = item;
    } else {
      const items = c.str(l.items, 'list.items');
      if (items) list.items = items;
    }
    if (!isObj(l.fields)) c.add('list.fields', 'is required');
    else if (!list.fields.url) c.add('list.fields.url', 'is required');
    if (l.filters !== undefined) {
      if (!Array.isArray(l.filters)) c.add('list.filters', 'must be a list');
      else list.filters = l.filters.map((f, i) => c.field(f, `list.filters.${i}`, fmt)).filter((f): f is FieldSpec => Boolean(f));
    }
    const next = c.field(l.next, 'list.next', 'html');
    if (next) list.next = next;
    if (l.maxPages !== undefined) {
      if (typeof l.maxPages !== 'number' || !Number.isInteger(l.maxPages) || l.maxPages < 1 || l.maxPages > 20) {
        c.add('list.maxPages', 'must be a whole number from 1 to 20');
      } else list.maxPages = l.maxPages;
    }
  }

  // detail
  let detail: AgencyDetailDef | undefined;
  if (raw.detail !== undefined && raw.detail !== null) {
    if (!isObj(raw.detail)) c.add('detail', 'must be a mapping');
    else {
      const d = raw.detail;
      c.keys(d, ['description', 'images', 'status', 'fields'], 'detail');
      detail = {};
      const description = c.field(d.description, 'detail.description', 'html');
      const images = c.field(d.images, 'detail.images', 'html');
      const status = c.field(d.status, 'detail.status', 'html');
      if (description) detail.description = description;
      if (images) detail.images = images;
      if (status) detail.status = status;
      if (d.fields !== undefined) detail.fields = c.fields(d.fields, 'detail.fields', 'html');
    }
  }

  // contact
  let contact: AgencyContactDef | undefined;
  if (raw.contact !== undefined && raw.contact !== null) {
    if (!isObj(raw.contact)) c.add('contact', 'must be a mapping');
    else {
      const k = raw.contact;
      c.keys(k, ['kind', 'url', 'form', 'email'], 'contact');
      const kind = k.kind;
      if (kind !== 'form' && kind !== 'email' && kind !== 'none') c.add('contact.kind', 'must be form, email or none');
      const email = c.str(k.email, 'contact.email', kind === 'email');
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) c.add('contact.email', `"${email}" is not an email address`);
      contact = { kind: kind === 'form' || kind === 'email' ? kind : 'none' };
      const url = c.str(k.url, 'contact.url');
      if (url) contact.url = url;
      if (email) contact.email = email;
      if (kind === 'form') {
        if (!isObj(k.form)) c.add('contact.form', 'is required when kind is form');
        else {
          const f = k.form;
          c.keys(f, ['name', 'firstName', 'lastName', 'email', 'phone', 'subject', 'message', 'check', 'open', 'submit', 'success'], 'contact.form');
          const form: AgencyFormDef = {
            message: c.str(f.message, 'contact.form.message', true) ?? '',
            submit: c.str(f.submit, 'contact.form.submit', true) ?? '',
            success: c.str(f.success, 'contact.form.success', true) ?? '',
          };
          for (const key of ['name', 'firstName', 'lastName', 'email', 'phone', 'subject', 'open'] as const) {
            const s = c.str(f[key], `contact.form.${key}`);
            if (s) form[key] = s;
          }
          const check = c.words(f.check, 'contact.form.check');
          if (check) form.check = check;
          contact.form = form;
        }
      }
    }
  }

  if (c.issues.length) throw fail();
  const def: AgencyDef = { id: id!, name: name!, homepage: homepage!, list };
  if (regions?.length) def.regions = regions;
  if (typeof presetName === 'string' && presetName !== 'none') def.preset = presetName as AgencyPresetName;
  if (intervalSec !== undefined) def.intervalSec = intervalSec;
  if (detail) def.detail = detail;
  if (contact) def.contact = contact;
  if (terms) def.terms = terms;
  return def;
}

/** Parses and validates one agency YAML document. */
export function parseAgencyYaml(text: string, origin = 'agency YAML'): AgencyDef {
  let raw: unknown;
  try {
    raw = YAML.parse(text);
  } catch (e) {
    const msg = `invalid YAML: ${(e as Error).message.split('\n')[0]}`;
    throw new AgencyDefError(`${origin}: ${msg}`, [msg], origin);
  }
  return parseAgencyDef(raw, origin);
}

/**
 * One adapter per agency YAML file. Relative paths resolve against `baseDir`
 * (the config folder for `config.agencies`). A broken file throws an
 * `AgencyDefError` naming it, unless `onError` is given: then the file is
 * skipped and reported, and the other agencies still load.
 */
export function loadAgencyAdapters(
  files: string[],
  baseDir: string,
  opts: { onError?: (file: string, error: AgencyDefError) => void } = {},
): SourceAdapter[] {
  const out: SourceAdapter[] = [];
  const seen = new Map<string, string>();
  for (const f of files) {
    const file = isAbsolute(f) ? f : resolve(baseDir, f);
    try {
      let text: string;
      try {
        text = readFileSync(file, 'utf8');
      } catch (e) {
        const msg = `cannot read the file (${(e as NodeJS.ErrnoException).code ?? (e as Error).message})`;
        throw new AgencyDefError(`${file}: ${msg}`, [msg], file);
      }
      const adapter = createAgencyAdapter(parseAgencyYaml(text, file));
      const other = seen.get(adapter.id);
      if (other) {
        const msg = `duplicate agency id "${adapter.id.slice('agency:'.length)}", also used in ${other}`;
        throw new AgencyDefError(`${file}: ${msg}`, [msg], file);
      }
      seen.set(adapter.id, file);
      out.push(adapter);
    } catch (e) {
      const err = e instanceof AgencyDefError ? e : new AgencyDefError(`${file}: ${(e as Error).message}`, [(e as Error).message], file);
      if (!opts.onError) throw err;
      opts.onError(file, err);
    }
  }
  return out;
}

/* ---------- reading pages ---------- */

interface Item {
  value(spec?: FieldSpec): string | undefined;
  values(spec?: FieldSpec): string[];
  text(): string;
}

const clean = (s: string) => s.replace(/[\s ]+/g, ' ').trim();

function post(raw: string | undefined, spec: FieldSpec): string | undefined {
  if (raw === undefined) return undefined;
  let v = clean(raw);
  if (spec.pattern) {
    const m = new RegExp(spec.pattern, 'i').exec(v);
    if (!m) return undefined;
    v = (m[1] ?? m[0]).trim();
  }
  if (spec.map) {
    const hit = Object.entries(spec.map).find(([k]) => k.toLowerCase() === v.toLowerCase());
    if (hit) v = hit[1];
  }
  return v || undefined;
}

function passes(spec: FieldSpec, value: string | undefined): boolean {
  const v = (value ?? '').toLowerCase();
  if (spec.exclude?.some((w) => v.includes(w.toLowerCase()))) return false;
  if (spec.require && !spec.require.some((w) => v.includes(w.toLowerCase()))) return false;
  return true;
}

function readAttr(el: Cheerio<AnyNode>, attr: string): string | undefined {
  for (const name of attr.split('|')) {
    const v = el.attr(name.trim());
    if (v && v.trim()) return v;
  }
  return undefined;
}

function blockText($: CheerioAPI, el: Cheerio<AnyNode>): string {
  const copy = el.clone();
  copy.find('script, style, noscript, h1, h2, h3, h4').remove();
  copy.find('br').replaceWith('\n');
  copy.find('p, div, li, tr, h5, h6').each((_, n) => {
    $(n).append('\n');
  });
  return copy
    .text()
    .split('\n')
    .map((l) => l.replace(/[ \t ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function htmlItem($: CheerioAPI, el: Cheerio<AnyNode>): Item {
  const targets = (spec: FieldSpec): Cheerio<AnyNode> => {
    if (!spec.selector) return el;
    return el.is(spec.selector) ? el : el.find(spec.selector);
  };
  const read = (t: Cheerio<AnyNode>, spec: FieldSpec) => (spec.attr ? readAttr(t, spec.attr) : t.text());
  return {
    value(spec) {
      if (!spec) return undefined;
      const t = targets(spec).first();
      return t.length ? post(read(t, spec), spec) : undefined;
    },
    values(spec) {
      if (!spec) return [];
      return targets(spec)
        .toArray()
        .map((n) => post(read($(n), spec), spec))
        .filter((v): v is string => Boolean(v));
    },
    text: () => clean(el.text()),
  };
}

function getPath(obj: unknown, path: string | undefined): unknown {
  if (!path) return obj;
  let cur: unknown = obj;
  for (const key of path.split('.')) {
    if (Array.isArray(cur)) cur = cur[Number(key)];
    else if (isObj(cur)) cur = cur[key];
    else return undefined;
  }
  return cur;
}

const scalar = (v: unknown): string | undefined =>
  typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : undefined;

function jsonItem(obj: unknown): Item {
  const pick = (v: unknown, spec: FieldSpec) => (isObj(v) && spec.attr ? scalar(v[spec.attr]) : scalar(v));
  return {
    value(spec) {
      if (!spec) return undefined;
      const raw = getPath(obj, spec.path ?? spec.selector);
      return post(pick(Array.isArray(raw) ? raw[0] : raw, spec), spec);
    },
    values(spec) {
      if (!spec) return [];
      const raw = getPath(obj, spec.path ?? spec.selector);
      return (Array.isArray(raw) ? raw : [raw]).map((v) => post(pick(v, spec), spec)).filter((v): v is string => Boolean(v));
    },
    text: () => '',
  };
}

function absolute(href: string | undefined, base: string): string | undefined {
  if (!href || /^(javascript|mailto|tel):/i.test(href.trim())) return undefined;
  try {
    const u = new URL(href.trim(), base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** A stable id from a listing URL: its path without the trailing slash, plus the query. */
function idFromUrl(url: string): string {
  const u = new URL(url);
  return (u.pathname.replace(/\/+$/, '') || '/') + u.search;
}

function toIso(v: string | undefined, now: Date): string | undefined {
  if (!v) return undefined;
  if (/^\d{9,10}$/.test(v)) return new Date(Number(v) * 1000).toISOString();
  if (/^\d{12,13}$/.test(v)) return new Date(Number(v)).toISOString();
  const d = parseDutchDate(v, now);
  if (d) {
    const [y, m, day] = d.split('-').map(Number);
    return fromAmsterdam(y ?? 0, m ?? 1, day ?? 1, 0, 0).toISOString();
  }
  const t = Date.parse(v);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

function energyLabel(v: string | undefined): string | undefined {
  const m = v ? /\b([A-G]\+*)(?![a-z])/i.exec(v) : null;
  return m?.[1]?.toUpperCase();
}

const num = (v: string | undefined) => {
  const n = v === undefined ? NaN : Number(v.replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
};

function compact<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
  return o;
}

const AVAILABILITY_SENTENCE = /[^.\n]*\b(beschikbaar|available|oplevering|ingangsdatum|per direct|vanaf)\b[^.\n]*/i;

/* ---------- the adapter ---------- */

/**
 * Builds a source adapter from an agency definition: HTML cards read with
 * CSS selectors or a JSON list read with paths, an optional detail page, and
 * contact by the agent's web form (filled in a headless browser), by email
 * (sent by the daemon's mailbox) or not at all.
 */
export function createAgencyAdapter(input: AgencyDef): SourceAdapter {
  const def = parseAgencyDef(input, input?.id ? `agency ${input.id}` : undefined);
  const id = `agency:${def.id}`;
  const listUrls = Array.isArray(def.list.url) ? def.list.url : [def.list.url];
  const contactKind = def.contact?.kind ?? 'none';
  const f = def.list.fields;
  const agent = compact({ name: def.name, url: def.homepage, email: def.contact?.email });

  const contactUrlFor = (url: string, externalId: string): string | undefined => {
    if (contactKind !== 'form') return undefined;
    const tpl = def.contact?.url ?? '{url}';
    const expanded = tpl.replaceAll('{url}', url).replaceAll('{id}', encodeURIComponent(externalId)).replaceAll('{homepage}', def.homepage);
    return absolute(expanded, url);
  };

  function toListing(item: Item, base: string, now: Date): RawListing | undefined {
    for (const spec of [...(def.list.filters ?? []), ...Object.values(f)]) {
      if ((spec.exclude || spec.require) && !passes(spec, item.value(spec))) return undefined;
    }
    const url = absolute(item.value(f.url), base);
    if (!url) return undefined;
    const externalId = item.value(f.externalId) ?? idFromUrl(url);
    const addressText = item.value(f.address) ?? item.value(f.street);
    const title = item.value(f.title) ?? addressText ?? url;
    const address = splitAddress(addressText ?? title);
    const cityText = item.value(f.city);
    if (cityText) {
      const fromCity = splitAddress(cityText);
      if (fromCity.postcode && !address.postcode) address.postcode = fromCity.postcode;
      address.city = fromCity.postcode ? (fromCity.city ?? address.city) : cityText;
    }
    const postcode = normalisePostcode(item.value(f.postcode) ?? '');
    if (postcode) address.postcode = postcode;
    const lat = num(item.value(f.lat));
    const lon = num(item.value(f.lon));
    if (lat !== undefined && lon !== undefined) Object.assign(address, { lat, lon });

    const cardText = item.text();
    const priceText = item.value(f.price);
    const price = priceText ? parsePrice(priceText) : undefined;
    const furnishing = detectFurnishing(item.value(f.furnishing) ?? cardText);
    const image = absolute(item.value(f.image), base);
    const available = item.value(f.availableFrom);

    return compact<RawListing>({
      sourceId: id,
      externalId,
      url,
      title,
      priceEur: price?.priceEur,
      priceBasis: price?.priceEur !== undefined ? price.basis : undefined,
      sizeM2: parseSize(item.value(f.size) ?? ''),
      rooms: parseRooms(item.value(f.rooms) ?? ''),
      bedrooms: parseBedrooms(item.value(f.bedrooms) ?? ''),
      type: detectType(item.value(f.type) ?? '') ?? detectType(title) ?? detectType(cardText),
      furnishing: furnishing === 'unknown' ? undefined : furnishing,
      address,
      availableFrom: available ? parseDutchDate(available, now) : undefined,
      description: item.value(f.description),
      images: image ? [image] : undefined,
      energyLabel: energyLabel(item.value(f.energyLabel)),
      publishedAt: toIso(item.value(f.publishedAt), now),
      agent: { ...agent },
      contact: contactKind,
      contactUrl: contactUrlFor(url, externalId),
      language: 'nl',
    });
  }

  const adapter: SourceAdapter = {
    id,
    name: def.name,
    homepage: def.homepage,
    regions: def.regions?.length ? def.regions : 'nl',
    defaultIntervalSec: def.intervalSec ?? 300,
    capabilities: {
      search: def.list.format === 'json' ? 'json' : 'html',
      detail: Boolean(def.detail),
      contact: contactKind,
      login: 'none',
      terms: def.terms ?? 'unknown',
    },

    buildSearches(_searches, source) {
      const reqs = listUrls.map((url, i) => ({ key: listUrls.length === 1 ? 'list' : `list-${i + 1}`, label: def.name, url }));
      for (const url of source.searchUrls) {
        const key = `url-${createHash('sha1').update(url).digest('hex').slice(0, 10)}`;
        if (!reqs.some((r) => r.key === key || r.url === url)) reqs.push({ key, label: `${def.name}: ${url}`, url });
      }
      return reqs;
    },

    async search(req, ctx) {
      const out: RawListing[] = [];
      const seen = new Set<string>();
      const pages = def.list.next ? (def.list.maxPages ?? 3) : 1;
      let url: string | undefined = req.url ?? listUrls[0];
      const visited = new Set<string>();
      for (let page = 0; page < pages && url && !visited.has(url); page++) {
        visited.add(url);
        const res = await ctx.fetch(url);
        const base = res.url || url;
        let items: Item[];
        let next: string | undefined;
        if (def.list.format === 'json') {
          const data = getPath(res.json(), def.list.items);
          if (!Array.isArray(data)) throw new Error(`${def.name}: ${def.list.items ?? 'the response'} is not a list`);
          items = data.map(jsonItem);
        } else {
          const $ = load(res.text);
          items = $(def.list.item ?? '')
            .toArray()
            .map((n) => htmlItem($, $(n)));
          next = def.list.next ? absolute(htmlItem($, $.root()).value(def.list.next), base) : undefined;
        }
        for (const item of items) {
          const listing = toListing(item, base, ctx.now());
          if (listing && !seen.has(listing.externalId)) {
            seen.add(listing.externalId);
            out.push(listing);
          }
        }
        url = next;
      }
      ctx.log.debug('agency listings read', { count: out.length });
      return out;
    },

    async isAvailable(listing, ctx) {
      let res;
      try {
        res = await ctx.fetch(listing.url);
      } catch (e) {
        if (e instanceof SourceHttpError && (e.status === 404 || e.status === 410)) return false;
        throw e;
      }
      // Agents often redirect a withdrawn listing to their overview page.
      const finalPath = new URL(res.url || listing.url).pathname;
      if (finalPath !== new URL(listing.url).pathname && listUrls.some((u) => new URL(u).pathname === finalPath)) return false;
      const status = def.detail?.status;
      if (status) {
        const $ = load(res.text);
        if (!passes(status, htmlItem($, $.root()).value(status))) return false;
      }
      return true;
    },
  };

  const detailDef = def.detail;
  if (detailDef) {
    adapter.detail = async (listing, ctx) => {
      const res = await ctx.fetch(listing.url);
      const base = res.url || listing.url;
      const $ = load(res.text);
      const page = htmlItem($, $.root());
      const out: RawListing = { ...listing, address: { ...listing.address } };
      if (detailDef.description) {
        const target = $.root().find(detailDef.description.selector ?? 'body').first();
        const text = target.length ? blockText($, target) : undefined;
        if (text) out.description = text;
      }
      if (detailDef.images) {
        const images = [...new Set(page.values(detailDef.images).map((s) => absolute(s, base)).filter((s): s is string => Boolean(s)))];
        if (images.length) out.images = images;
      }
      if (detailDef.fields) {
        // Values from the detail page only fill what the card did not have.
        const d = detailDef.fields;
        const fill = <K extends keyof RawListing>(key: K, value: RawListing[K] | undefined) => {
          if (out[key] === undefined && value !== undefined) out[key] = value;
        };
        const priceText = page.value(d.price);
        const price = priceText ? parsePrice(priceText) : undefined;
        if (price?.priceEur !== undefined && out.priceEur === undefined) {
          out.priceEur = price.priceEur;
          out.priceBasis = price.basis;
        }
        fill('sizeM2', parseSize(page.value(d.size) ?? ''));
        fill('rooms', parseRooms(page.value(d.rooms) ?? ''));
        fill('bedrooms', parseBedrooms(page.value(d.bedrooms) ?? ''));
        fill('energyLabel', energyLabel(page.value(d.energyLabel)));
        const available = page.value(d.availableFrom);
        fill('availableFrom', available ? parseDutchDate(available, ctx.now()) : undefined);
        const type = page.value(d.type);
        fill('type', type ? detectType(type) : undefined);
        const furnishing = page.value(d.furnishing);
        if (furnishing && out.furnishing === undefined) {
          const found = detectFurnishing(furnishing);
          if (found !== 'unknown') out.furnishing = found;
        }
      }
      if (!out.availableFrom && out.description) {
        const sentence = AVAILABILITY_SENTENCE.exec(out.description)?.[0];
        const date = sentence ? parseDutchDate(sentence, ctx.now()) : undefined;
        if (date) out.availableFrom = date;
      }
      if (!out.furnishing && out.description) {
        const found = detectFurnishing(out.description);
        if (found !== 'unknown') out.furnishing = found;
      }
      if (!out.agent?.email) {
        const mail = $('a[href^="mailto:"]').first().attr('href')?.slice('mailto:'.length).split('?')[0];
        if (mail) out.agent = { ...out.agent, email: decodeURIComponent(mail) };
      }
      return out;
    };
  }

  const form = def.contact?.form;
  if (contactKind === 'form' && form) {
    adapter.contact = (listing, message, ctx) => submitForm(def, form, listing, message, ctx, contactUrlFor);
  }
  return adapter;
}

const VISIBLE_CAPTCHA =
  'iframe[src*="recaptcha"]:not([src*="size=invisible"]), iframe[src*="hcaptcha.com"], .cf-turnstile, iframe[src*="challenges.cloudflare.com"]';

async function submitForm(
  def: AgencyDef,
  form: AgencyFormDef,
  listing: Listing,
  message: OutboundMessage,
  ctx: SourceContext,
  contactUrlFor: (url: string, externalId: string) => string | undefined,
): Promise<ContactResult> {
  const url = listing.contactUrl ?? contactUrlFor(listing.url, listing.externalId) ?? listing.url;
  const session = await ctx.browser();
  const { page } = session;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    if (/\/(inloggen|login|aanmelden)\b/i.test(new URL(page.url()).pathname)) {
      throw new NeedsLoginError(`${def.name} asks for a login before its contact form`, { loginUrl: page.url() });
    }
    if (form.open) {
      const opener = page.locator(form.open).first();
      if (await opener.isVisible().catch(() => false)) await opener.click({ timeout: 5_000 }).catch(() => undefined);
    }
    if (await page.locator(VISIBLE_CAPTCHA).first().isVisible().catch(() => false)) {
      return { ok: false, channel: 'form', needs: 'captcha', error: `the contact form on ${url} shows a captcha` };
    }

    const p = message.profile;
    const values: [string | undefined, string | undefined][] = [
      [form.name, `${p.firstName} ${p.lastName}`.trim()],
      [form.firstName, p.firstName],
      [form.lastName, p.lastName],
      [form.email, p.email],
      [form.phone, p.phone],
      [form.subject, message.subject],
      [form.message, message.body],
    ];
    try {
      for (const [selector, value] of values) {
        if (selector && value) await page.locator(selector).first().fill(value, { timeout: 10_000 });
      }
      for (const selector of form.check ?? []) await page.locator(selector).first().check({ timeout: 10_000 });
    } catch (e) {
      return { ok: false, channel: 'form', error: `could not fill the form on ${url}: ${(e as Error).message.split('\n')[0]}` };
    }
    if (message.dryRun) return { ok: true, channel: 'form', evidence: 'dry run: the form was filled and not sent' };

    try {
      await page.locator(form.submit).first().click({ timeout: 10_000 });
    } catch (e) {
      return { ok: false, channel: 'form', error: `could not press send on ${url}: ${(e as Error).message.split('\n')[0]}` };
    }
    try {
      const confirmation = page.locator(form.success).first();
      await confirmation.waitFor({ state: 'visible', timeout: 20_000 });
      const text = clean((await confirmation.textContent()) ?? '');
      return { ok: true, channel: 'form', evidence: text.slice(0, 200) || 'confirmation shown' };
    } catch {
      // The form was sent but we cannot tell whether it arrived: a person
      // should look before anything is sent again.
      return {
        ok: false,
        channel: 'form',
        needs: 'human',
        error: `sent the form on ${url} but no confirmation appeared; check before sending again`,
      };
    }
  } finally {
    await session.close().catch(() => undefined);
  }
}
