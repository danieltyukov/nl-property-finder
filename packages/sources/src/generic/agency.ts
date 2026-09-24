import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { load, type Cheerio, type CheerioAPI } from 'cheerio';
import {
  fromAmsterdam,
  trimTrailingSlashes,
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
import {
  AgencyDefError,
  parseAgencyDef,
  parseAgencyYaml,
  type AgencyDef,
  type AgencyFormDef,
  type FieldSpec,
} from './agency-def.js';

type AnyNode = Exclude<Parameters<typeof load>[0], string | Buffer | readonly unknown[]>;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

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
  return (trimTrailingSlashes(u.pathname) || '/') + u.search;
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

const AVAILABILITY_WORD = /\b(beschikbaar|available|oplevering|ingangsdatum|per direct|vanaf)\b/i;

/* ---------- the adapter ---------- */

export interface AgencyAdapterOptions {
  /** How long to wait for the confirmation after sending a form. Default 20 s. */
  confirmTimeoutMs?: number;
}

/**
 * Builds a source adapter from an agency definition: HTML cards read with
 * CSS selectors or a JSON list read with paths, an optional detail page, and
 * contact by the agent's web form (filled in a headless browser), by email
 * (sent by the daemon's mailbox) or not at all.
 */
export function createAgencyAdapter(input: AgencyDef, options: AgencyAdapterOptions = {}): SourceAdapter {
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
        const sentence = out.description.split(/[.\n]/).find((s) => AVAILABILITY_WORD.test(s));
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
    const confirmTimeoutMs = options.confirmTimeoutMs ?? 20_000;
    adapter.contact = (listing, message, ctx) => submitForm(def, form, listing, message, ctx, contactUrlFor, confirmTimeoutMs);
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
  confirmTimeoutMs: number,
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
      await confirmation.waitFor({ state: 'visible', timeout: confirmTimeoutMs });
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
