import YAML from 'yaml';
import { AGENCY_PRESETS, type AgencyPresetName } from './presets.js';

/*
 * The agency definition: the shape of an agency YAML file, and the
 * validation that turns a parsed file into a normalised AgencyDef.
 */

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
