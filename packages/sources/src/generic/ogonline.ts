import { load } from 'cheerio';
import type { Locator, Page } from 'playwright-core';
import type { ContactResult, Listing, OutboundMessage, Profile, PropertyType, RawListing, SourceAdapter } from '@nlpf/core';
import { SourceHttpError } from '../runtime/errors.js';
import { normalisePostcode, splitAddress } from '../util/address.js';
import { detectType, parseDutchDate } from '../util/parse.js';
import { UNAVAILABLE_STATUS } from './presets.js';
import { filterParams, htmlToText, placePasses, portalFilters, readFilters } from './zig.js';

/*
 * The generic adapter for estate agents whose website is built by OGonline.
 * Every such site serves its whole offer, sales and rentals, as JSON at
 * /nl/realtime-listings/consumer (docs/research/platforms.md section 6.3).
 * Agencies are seeded in instances/ogonline-agencies.ts; the YAML route
 * (preset "ogonline" in generic/presets.ts) reads the same JSON for agencies a
 * user adds by hand.
 *
 * The contact form on a listing page is the shared OGonline markup: a
 * `form.form-ajax` posting to /forms/reply/consumer/<id> or
 * /forms/contact/details_consumer/<id>, with `.form-ajax-success`,
 * `.form-ajax-warning` and `.form-ajax-error` blocks the site's script shows
 * after sending. Field names vary a little per site (name, or first and last
 * name); the markup of 20 live sites was read on 2026-09-24. No form was ever
 * submitted to a live site.
 */

export const OGONLINE_LIST_PATH = '/nl/realtime-listings/consumer';

export interface OgonlineAgencyDef {
  /** Lowercase letters, digits and dashes; the source id becomes "ogonline:<id>". */
  id: string;
  name: string;
  /** Site origin without a trailing slash. */
  homepage: string;
  /** Municipalities (lowercase) the agency rents in; the registry enables it only for matching searches. */
  regions: string[];
  /**
   * How to reach the agency about a listing: its web form, or email when the
   * form has a captcha the agent must not solve or was not seen.
   */
  contact: 'form' | 'email';
  /** The agency's public address, used for `contact: email` and as a fallback. */
  email?: string;
  /** Why the contact mode was chosen, for the dashboard. */
  note?: string;
  /** Date the JSON endpoint last answered a check (YYYY-MM-DD). */
  verifiedAt?: string;
  intervalSec?: number;
}

/** One entry of the realtime-listings JSON (the fields this adapter reads). */
export interface OgonlineItem {
  url?: string;
  address?: string;
  city?: string;
  zipcode?: string;
  country?: string;
  isRentals?: boolean;
  isSales?: boolean;
  rentalsPrice?: number | string;
  price?: string;
  status?: string;
  added?: number | string;
  livingSurface?: number;
  rooms?: number;
  bedrooms?: number;
  mainType?: string;
  type?: string | false;
  isFurnished?: boolean;
  isPartlyFurnished?: boolean;
  isDecorated?: boolean;
  lat?: number | string;
  lng?: number | string;
  photo?: string;
  acceptance?: string | false;
  energyLabel?: string | false;
  isShortStay?: boolean;
  district?: string;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const positive = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

function compact<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
  return o;
}

const decode = (s: string) =>
  s
    .replace(/&euro;/g, 'EUR ')
    .replace(/&mdash;|&ndash;/g, '-')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');

/** "EUR 1.795 p.m. ex." is exclusive of service costs; "p.m. incl." inclusive. */
export function ogonlineBasis(price: string | undefined): 'excl' | 'incl' | 'unknown' {
  const rent = decode(price ?? '').split(/k\.k\.|v\.o\.n\./i).pop() ?? '';
  if (/p\.?\s*m\.?\s*(?:ex\b|excl)/i.test(rent)) return 'excl';
  if (/p\.?\s*m\.?\s*(?:inc\b|incl)/i.test(rent)) return 'incl';
  return 'unknown';
}

const NOT_A_HOME = /parkeer|garage|berging|bouwgrond|bedrijf|kantoor|winkel|opslag|ligplaats/i;

/** Where OGonline listing pages keep the description, in the order the templates use them. */
const DESCRIPTION = ['.object-description', '#tab-omschrijving', '#omschrijving', '#description'];

function ogonlineType(item: OgonlineItem): PropertyType | undefined {
  const label = typeof item.type === 'string' ? item.type : '';
  const found = detectType(label);
  if (found) return found;
  if (item.mainType === 'house') return 'house';
  if (item.mainType === 'apartment') return 'apartment';
  return undefined;
}

/** The 24-character object id at the end of an OGonline listing URL. */
export function ogonlineObjectId(url: string): string | undefined {
  return /\/([0-9a-f]{24})\/?(?:[?#].*)?$/i.exec(url)?.[1]?.toLowerCase();
}

/** Why an item is not a rental home on offer, or undefined when it is. */
export function ogonlineSkipReason(item: OgonlineItem): string | undefined {
  if (item.isRentals !== true) return 'not for rent';
  const status = (item.status ?? '').toLowerCase();
  if (UNAVAILABLE_STATUS.some((w) => status.includes(w))) return 'not available';
  if (item.country && !/nederland|netherlands/i.test(item.country)) return 'abroad';
  if (!str(item.url)) return 'no page';
  const label = typeof item.type === 'string' ? item.type : '';
  if (NOT_A_HOME.test(label) || item.mainType === 'buildLot' || (item.mainType === 'other' && !detectType(label))) return 'not a home';
  return undefined;
}

export function ogonlineListing(def: OgonlineAgencyDef, item: OgonlineItem, now: Date): RawListing | undefined {
  if (ogonlineSkipReason(item)) return undefined;
  let url: string;
  try {
    url = new URL(item.url ?? '', `${def.homepage}/`).toString();
  } catch {
    return undefined;
  }
  const objectId = ogonlineObjectId(url);
  const title = str(item.address) ?? url;
  const address = splitAddress(title);
  const postcode = normalisePostcode(item.zipcode ?? '');
  const lat = positive(item.lat);
  const lon = positive(item.lng);
  const price = positive(item.rentalsPrice);
  const photo = str(item.photo);
  const image = photo && !/no-image/i.test(photo) ? new URL(photo, `${def.homepage}/`).toString() : undefined;
  const addedSec = positive(item.added);
  const acceptance = typeof item.acceptance === 'string' ? item.acceptance : '';
  const label = typeof item.energyLabel === 'string' ? item.energyLabel.trim().toUpperCase() : '';

  return compact<RawListing>({
    sourceId: `ogonline:${def.id}`,
    externalId: objectId ?? new URL(url).pathname.replace(/\/+$/, ''),
    url,
    title,
    priceEur: price,
    priceBasis: price !== undefined ? ogonlineBasis(item.price) : undefined,
    sizeM2: positive(item.livingSurface),
    rooms: positive(item.rooms),
    bedrooms: positive(item.bedrooms),
    type: ogonlineType(item),
    furnishing: item.isFurnished ? 'furnished' : item.isPartlyFurnished || item.isDecorated ? 'upholstered' : undefined,
    address: compact({
      ...address,
      postcode: postcode ?? address.postcode,
      city: str(item.city),
      neighbourhood: str(item.district),
      lat: lat !== undefined && lon !== undefined ? lat : undefined,
      lon: lat !== undefined && lon !== undefined ? lon : undefined,
    }),
    availableFrom: acceptance ? parseDutchDate(acceptance, now) : undefined,
    images: image ? [image] : undefined,
    energyLabel: /^[A-G]\+*$/.test(label) ? label : undefined,
    publishedAt: addedSec !== undefined ? new Date(addedSec * 1000).toISOString() : undefined,
    agent: compact({ name: def.name, url: def.homepage, email: def.email }),
    contact: def.contact,
    contactUrl: def.contact === 'form' ? url : undefined,
    language: 'nl',
    extra: compact({ platform: 'ogonline', agency: def.id, objectId, shortStay: item.isShortStay ? true : undefined }),
  });
}

/* ---------- the adapter ---------- */

export interface OgonlineAdapterOptions {
  /** How long to wait for the site's confirmation after sending. Default 20 s. */
  confirmTimeoutMs?: number;
}

/**
 * Builds the adapter for one OGonline agency. One GET per poll reads the
 * agency's whole offer (conditional, so an unchanged list costs a 304 where
 * the site supports it). Contact fills the listing page's own form in a
 * headless browser, or leaves the listing to the daemon's mailbox when the
 * agency is reached by email.
 */
export function createOgonlineAdapter(def: OgonlineAgencyDef, options: OgonlineAdapterOptions = {}): SourceAdapter {
  const home = def.homepage.replace(/\/+$/, '');
  const d: OgonlineAgencyDef = { ...def, homepage: home };
  const listUrl = `${home}${OGONLINE_LIST_PATH}`;
  const known = new Set(def.regions.map((r) => r.toLowerCase()));

  async function readList(ctx: Parameters<SourceAdapter['search']>[1]): Promise<OgonlineItem[]> {
    const res = await ctx.fetch(listUrl, { headers: { accept: 'application/json, text/plain, */*' } });
    const data = res.json<unknown>();
    if (!Array.isArray(data)) throw new Error(`${def.name}: ${OGONLINE_LIST_PATH} did not answer with a list`);
    return data as OgonlineItem[];
  }

  const adapter: SourceAdapter = {
    id: `ogonline:${def.id}`,
    name: def.name,
    homepage: home,
    regions: def.regions,
    defaultIntervalSec: def.intervalSec ?? 300,
    capabilities: { search: 'json', detail: true, contact: def.contact, login: 'none', terms: 'unknown' },

    buildSearches(searches) {
      return [{ key: 'list', label: `${def.name}: rentals`, url: listUrl, params: filterParams(portalFilters(searches)) }];
    },

    async search(req, ctx) {
      const items = await readList(ctx);
      const filters = readFilters(req);
      const now = ctx.now();
      const out: RawListing[] = [];
      const seen = new Set<string>();
      for (const item of items) {
        const listing = ogonlineListing(d, item, now);
        if (!listing || seen.has(listing.externalId)) continue;
        if (!placePasses(listing.address.city, filters.municipalities, known)) continue;
        // Agents quote rent without service costs, the lowest figure, so this never drops a home a search still wants.
        if (filters.maxRentEur !== undefined && listing.priceEur !== undefined && listing.priceEur > filters.maxRentEur) continue;
        seen.add(listing.externalId);
        out.push(listing);
      }
      ctx.log.debug('ogonline listings read', { total: items.length, kept: out.length });
      return out;
    },

    async detail(listing, ctx) {
      const res = await ctx.fetch(listing.url);
      const $ = load(res.text);
      const out: RawListing = { ...listing, address: { ...listing.address } };
      for (const selector of DESCRIPTION) {
        const block = $(selector).first();
        if (!block.length) continue;
        block.find('h1, h2, h3, script, style, form').remove();
        const text = htmlToText(block.html());
        if (text) {
          out.description = text;
          break;
        }
      }
      if (!out.agent?.email) {
        const mail = $('a[href^="mailto:"]').first().attr('href')?.slice('mailto:'.length).split('?')[0];
        if (mail && /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(mail)) out.agent = { ...out.agent, email: decodeURIComponent(mail) };
      }
      return out;
    },

    async isAvailable(listing, ctx) {
      let items: OgonlineItem[];
      try {
        items = await readList(ctx);
      } catch (e) {
        if (e instanceof SourceHttpError && (e.status === 404 || e.status === 410)) return false;
        throw e;
      }
      const id = String(listing.extra?.objectId ?? '') || ogonlineObjectId(listing.url);
      const item = items.find((i) => {
        const url = i.url ? new URL(i.url, `${home}/`).toString() : '';
        return url === listing.url || (id !== undefined && ogonlineObjectId(url) === id);
      });
      return item !== undefined && ogonlineSkipReason(item) === undefined;
    },
  };

  if (def.contact === 'form') {
    const confirmTimeoutMs = options.confirmTimeoutMs ?? 20_000;
    adapter.contact = async (listing, message, ctx) => {
      const session = await ctx.browser();
      try {
        return await sendOgonlineForm(session.page, listing, message, ctx.profile, confirmTimeoutMs);
      } finally {
        await session.close().catch(() => undefined);
      }
    };
  }
  return adapter;
}

/* ---------- the OGonline contact form ---------- */

/** Forms that ask about one listing, in order of preference. A full rental application ("/forms/rent/") is never used. */
const FORM_ACTIONS = ['/forms/reply/consumer/', '/forms/contact/details_consumer/', '/forms/rent-interesse/'];

const FIELDS = {
  name: ['input[name="name"]'],
  firstName: ['input[name="first_name"]', 'input[name="firstName"]', 'input[name="firstname"]', 'input[name="voornaam"]'],
  lastName: ['input[name="last_name"]', 'input[name="lastName"]', 'input[name="surname"]', 'input[name="achternaam"]'],
  email: ['input[name="email"]', 'input[name="email_address"]', 'input[name="e_mail"]'],
  phone: ['input[name="telephone"]', 'input[name="phone_number"]', 'input[name="phone"]', 'input[name="telefoon"]'],
  message: ['textarea[name="question"]', 'textarea[name="introduction"]', 'textarea[name="message"]', 'textarea[name="bericht"]'],
  consent: ['input[type="checkbox"][name="privacy"]', 'input[type="checkbox"][name="privacyPolicy"]', 'input[type="checkbox"][name="avg"]'],
};

/** A captcha the agent must not try to get past: OGonline's sum question, reCAPTCHA v2, Turnstile, hCaptcha. */
const CAPTCHA =
  'input[name="captcha"], .g-recaptcha, iframe[src*="recaptcha"]:not([src*="size=invisible"]), .cf-turnstile, iframe[src*="hcaptcha.com"], altcha-widget';

const MALE = /^(?:m|male|man|dhr\.?|de heer|heer|mr\.?|mister)$/i;
const FEMALE = /^(?:f|v|female|vrouw|mw\.?|mevr\.?|mevrouw|ms\.?|mrs\.?)$/i;

/** The salutation from `profile.facts` ("salutation", "aanhef" or "gender"), as male or female. */
export function salutationOf(profile: Profile): 'male' | 'female' | undefined {
  const raw = profile.facts?.salutation ?? profile.facts?.aanhef ?? profile.facts?.gender ?? '';
  const v = raw.trim();
  if (MALE.test(v)) return 'male';
  if (FEMALE.test(v)) return 'female';
  return undefined;
}

async function first(form: Locator, selectors: string[]): Promise<Locator | undefined> {
  for (const s of selectors) {
    const l = form.locator(s).first();
    if ((await l.count()) > 0) return l;
  }
  return undefined;
}

async function setValue(field: Locator, value: string): Promise<void> {
  if (await field.isVisible().catch(() => false)) {
    await field.fill(value, { timeout: 10_000 });
    return;
  }
  // Forms inside a closed tab: set the value the way typing would.
  await field.evaluate((el, v) => {
    const input = el as HTMLInputElement;
    input.value = v;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

async function setChecked(box: Locator): Promise<void> {
  if (await box.isVisible().catch(() => false)) {
    await box.check({ timeout: 10_000 });
    return;
  }
  await box.evaluate((el) => {
    const input = el as HTMLInputElement;
    input.checked = true;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function chooseOption(select: Locator, pick: (options: { value: string; text: string }[]) => string | undefined): Promise<boolean> {
  const options = await select.evaluate((el) =>
    Array.from((el as HTMLSelectElement).options).map((o) => ({ value: o.value, text: (o.textContent ?? '').trim() })),
  );
  const value = pick(options);
  if (value === undefined) return false;
  if (await select.isVisible().catch(() => false)) await select.selectOption(value, { timeout: 10_000 });
  else {
    await select.evaluate((el, v) => {
      const s = el as HTMLSelectElement;
      s.value = v;
      s.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
  }
  return true;
}

async function acceptCookieWall(page: Page): Promise<void> {
  const button = page.locator('form:has(input[name="AVG_CHECKS[isAvgForm]"]) button[type="submit"]').first();
  if (await button.isVisible().catch(() => false)) {
    await Promise.all([page.waitForLoadState('domcontentloaded').catch(() => undefined), button.click({ timeout: 5_000 }).catch(() => undefined)]);
  }
}

async function pickForm(page: Page): Promise<Locator | undefined> {
  for (const action of FORM_ACTIONS) {
    const form = page.locator(`form[action*="${action}"]`).first();
    if ((await form.count()) > 0) return form;
  }
  return undefined;
}

async function reveal(page: Page, form: Locator): Promise<void> {
  if (await form.isVisible().catch(() => false)) return;
  const ids = await form.evaluate((el) => {
    const out: string[] = [];
    for (let n = el.parentElement; n; n = n.parentElement) if (n.id) out.push(n.id);
    return out;
  });
  for (const id of ids) {
    const opener = page.locator(`a[href="#${id}"], [data-target="#${id}"], [data-bs-target="#${id}"], [aria-controls="${id}"]`).first();
    if (await opener.isVisible().catch(() => false)) {
      await opener.click({ timeout: 5_000 }).catch(() => undefined);
      if (await form.isVisible().catch(() => false)) return;
    }
  }
}

type Outcome = 'success' | 'error' | 'bot' | 'timeout';

async function outcome(page: Page, form: Locator, startUrl: string, timeoutMs: number): Promise<{ kind: Outcome; text?: string }> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const url = page.url();
    if (url !== startUrl && /bedankt|thank|success|succes/i.test(url)) return { kind: 'success', text: `confirmation page ${new URL(url).pathname}` };
    for (const [selector, kind] of [
      ['.form-ajax-success', 'success'],
      ['.form-ajax-warning', 'bot'],
      ['.form-ajax-error', 'error'],
    ] as const) {
      const block = form.locator(selector).first();
      if (await block.isVisible().catch(() => false)) {
        const text = ((await block.textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim();
        return { kind, text };
      }
    }
    if (Date.now() >= deadline) return { kind: 'timeout' };
    await page.waitForTimeout(250);
  }
}

/**
 * Fills and sends the contact form on an OGonline listing page. Stops short
 * of sending on a dry run, and before filling anything when the form shows a
 * captcha or asks for a salutation or phone number the profile does not have.
 */
export async function sendOgonlineForm(
  page: Page,
  listing: Listing,
  message: OutboundMessage,
  profile: Profile,
  confirmTimeoutMs: number,
): Promise<ContactResult> {
  const url = listing.contactUrl ?? listing.url;
  const fail = (error: string, needs?: ContactResult['needs']): ContactResult => compact({ ok: false, channel: 'form' as const, error, needs });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await acceptCookieWall(page);
  const form = await pickForm(page);
  if (!form) return fail(`no contact form for this listing on ${url}`, 'human');
  if ((await form.locator(CAPTCHA).count()) > 0) return fail(`the contact form on ${url} has a captcha`, 'captcha');
  await reveal(page, form);

  const p = message.profile ?? profile;
  const fullName = `${p.firstName} ${p.lastName}`.trim();
  try {
    const email = await first(form, FIELDS.email);
    const text = await first(form, FIELDS.message);
    if (!email || !text) return fail(`the form on ${url} has no email or message field`, 'human');

    const gender = form.locator('select[name="gender"]').first();
    if ((await gender.count()) > 0) {
      const salutation = salutationOf(p);
      const required = await gender.evaluate((el) => (el as HTMLSelectElement).required);
      const wanted = salutation === 'male' ? MALE : FEMALE;
      // Sites use "male"/"female", "MAN"/"VROUW" or only the label ("Dhr.", "Mw.").
      const chosen =
        salutation !== undefined &&
        (await chooseOption(
          gender,
          (options) => options.find((o) => o.value && (wanted.test(o.value.trim()) || wanted.test(o.text.replace(/\*$/, '').trim())))?.value,
        ));
      if (!chosen && required) {
        return fail('the form asks for a salutation; set profile.facts.salutation to "dhr" or "mw" to let the agent fill it', 'human');
      }
    }

    const phone = await first(form, FIELDS.phone);
    if (phone) {
      if (p.phone) await setValue(phone, p.phone);
      else if (await phone.evaluate((el) => (el as HTMLInputElement).required)) {
        return fail('the form asks for a phone number and the profile has none', 'human');
      }
    }

    const nameField = await first(form, FIELDS.name);
    const firstField = await first(form, FIELDS.firstName);
    const lastField = await first(form, FIELDS.lastName);
    if (nameField && fullName) await setValue(nameField, fullName);
    if (firstField && p.firstName) await setValue(firstField, p.firstName);
    if (lastField && p.lastName) await setValue(lastField, p.lastName);
    await setValue(email, p.email);
    await setValue(text, message.body);
    for (const selector of FIELDS.consent) {
      const box = form.locator(selector).first();
      if ((await box.count()) > 0) await setChecked(box);
    }
    // Other required choices, such as the office a message goes to: the one
    // named after the listing's city, else the first real option.
    const city = (listing.address.city ?? '').toLowerCase();
    for (const select of await form.locator('select[required]:not([name="gender"])').all()) {
      const current = await select.inputValue().catch(() => '');
      if (current) continue;
      await chooseOption(
        select,
        (options) =>
          (city ? options.find((o) => o.value && o.text.toLowerCase().includes(city))?.value : undefined) ??
          options.find((o) => o.value)?.value,
      );
    }
  } catch (e) {
    return fail(`could not fill the form on ${url}: ${(e as Error).message.split('\n')[0]}`);
  }

  // A field the browser would refuse to send (required and empty, a bad
  // email) is reported now; otherwise it would look like a send without a
  // confirmation.
  const invalid = await form.evaluate((el) =>
    Array.from((el as HTMLFormElement).elements)
      .filter((f) => 'validity' in f && !(f as HTMLInputElement).validity.valid)
      .map((f) => (f as HTMLInputElement).name || f.tagName.toLowerCase()),
  );
  if (invalid.length) return fail(`the form on ${url} still needs: ${invalid.join(', ')}`, 'human');

  if (message.dryRun) return { ok: true, channel: 'form', evidence: 'dry run: the form was filled and not sent' };

  const startUrl = page.url();
  try {
    const submit = form.locator('button[type="submit" i], input[type="submit"]').first();
    if (await submit.isVisible().catch(() => false)) await submit.click({ timeout: 10_000 });
    else await form.evaluate((el) => (el as HTMLFormElement).requestSubmit());
  } catch (e) {
    return fail(`could not press send on ${url}: ${(e as Error).message.split('\n')[0]}`);
  }
  const result = await outcome(page, form, startUrl, confirmTimeoutMs);
  switch (result.kind) {
    case 'success':
      return { ok: true, channel: 'form', evidence: (result.text || 'confirmation shown').slice(0, 200) };
    case 'bot':
      return fail(`the site did not accept the form as sent by a person: ${result.text ?? ''}`.trim(), 'captcha');
    case 'error':
      return fail(`the site reported an error after sending: ${result.text ?? ''}`.trim());
    default:
      return fail(`sent the form on ${url} but no confirmation appeared; check before sending again`, 'human');
  }
}
