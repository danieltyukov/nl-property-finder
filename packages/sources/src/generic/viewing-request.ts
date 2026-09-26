import type { ContactResult, Listing, OutboundMessage, Profile, SourceContext } from '@nlpf/core';
import type { Locator, Page } from 'playwright-core';
import { firstLine, pageText, waitForConfirmation } from '../adapters/json-shared.js';
import { NeedsLoginError } from '../runtime/errors.js';

/*
 * The viewing-request portal MVGM (ikwilhuren.nu) and Vesteda
 * (hurenbij.vesteda.com) share. Read live on 2026-09-26 in a logged-in
 * account: `/bezichtigingsaanvraag/<id>/` (MVGM) and `/aanvraag/<id>/`
 * (Vesteda) render one form whose steps (details, housing and work,
 * documents, declaration) show one at a time behind "Opslaan en volgende" or
 * "Save and next", ending in "Verstuur formulier" or "Send form". The field
 * names are the same on both (a_geslacht, a_postcode, a_maandinkomen, ...).
 * The portal keeps the answers and documents of the previous application, so
 * only empty fields are filled here, and a step the portal rejects for a field
 * the profile cannot answer stops the request for a person. After sending, the
 * requests overview (/mijnwoning/) lists the home ("Uw interesse staat
 * genoteerd"). MVGM allows at most five open viewing requests; the portal says
 * so when the limit is reached, and that text reaches the person.
 *
 * Documents are never uploaded here: the portal reuses what the person
 * uploaded with a first application of their own. The agreement box on the
 * last step (Vesteda) is ticked because the person opted in to automatic
 * contact on that platform; MVGM's last step has none.
 */

export interface ViewingRequestPortal {
  /** Shown in errors and tasks. */
  name: string;
  /** The portal's origin, such as https://ikwilhuren.nu. */
  base: string;
  /** The application page's path for a listing, or undefined when the listing has no portal id. */
  requestPath(listing: Listing): string | undefined;
}

/** What the profile says for each field: text values, radio values and acceptable select options. */
export interface Answers {
  text: Record<string, string>;
  choice: Record<string, string[]>;
  select: Record<string, string[]>;
}

const MONTHS_NL = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
const MONTHS_EN = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** "Daniel Alexander" becomes "D.A.". */
export function initials(firstNames: string): string {
  return firstNames
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((n) => `${n[0]!.toUpperCase()}.`)
    .join('');
}

/** "+31 6 2732 1612" becomes "0627321612"; other numbers keep their digits and a leading plus. */
export function dutchPhone(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, '');
  if (digits.startsWith('+31')) return `0${digits.slice(3)}`;
  if (digits.startsWith('0031')) return `0${digits.slice(4)}`;
  return digits;
}

/**
 * The options of "Wanneer wilt u gaan huren?" that fit the move-in date:
 * "Per direct" or "Now" when it has passed or is this month, otherwise the
 * month and year in Dutch and English.
 */
export function moveInChoices(moveInFrom: string | undefined, now: Date): string[] {
  const from = moveInFrom ? new Date(`${moveInFrom}T00:00:00Z`) : now;
  const sameOrPast =
    from.getUTCFullYear() < now.getUTCFullYear() ||
    (from.getUTCFullYear() === now.getUTCFullYear() && from.getUTCMonth() <= now.getUTCMonth());
  if (sameOrPast) return ['Per direct', 'Now'];
  const m = from.getUTCMonth();
  const y = from.getUTCFullYear();
  return [`${MONTHS_NL[m]} ${y}`, `${MONTHS_EN[m]} ${y}`];
}

/** The answers the profile gives, by field name. Fields the profile does not know are left to the portal's saved answers. */
export function applicationAnswers(p: Profile, now: Date): Answers {
  const text: Record<string, string> = {};
  const choice: Record<string, string[]> = {};
  const select: Record<string, string[]> = {};
  const first = p.firstName.trim();
  if (first) {
    text.a_roepnaam = first.split(/\s+/)[0]!;
    text.a_voornamen = first;
    text.a_voorletters = initials(first);
  }
  if (p.lastName.trim()) text.a_achternaam = p.lastName.trim();
  if (p.birthDate) {
    const [y, m, d] = p.birthDate.split('-');
    text.a_geboortedatum = `${d}-${m}-${y}`;
  }
  if (p.address) {
    text.a_postcode = p.address.postcode.replace(/\s+/g, '').toUpperCase();
    text.a_huisnummer = p.address.houseNumber;
    if (p.address.addition) text.a_huisnummertoevoeging = p.address.addition;
    text.a_straat = p.address.street;
    text.a_woonplaats = p.address.city;
    select.a_land = /^(nederland|netherlands|nl)$/i.test(p.address.country) ? ['NL', 'Nederland'] : [p.address.country];
  }
  if (p.phone) text.a_telefoon = dutchPhone(p.phone);
  if (p.email) text.a_email = p.email;
  if (p.incomeMonthlyGrossEur) text.a_maandinkomen = String(Math.round(p.incomeMonthlyGrossEur));
  if (p.salutation === 'dhr') choice.a_geslacht = ['M'];
  else if (p.salutation === 'mevr') choice.a_geslacht = ['V'];
  else if (p.salutation === 'none') choice.a_geslacht = ['O'];
  choice.a_samenhuren = [p.coApplicants.length > 0 || p.household.adults > 1 ? 'Samen' : 'Alleen'];
  select.gez_pers = [String(Math.min(7, p.household.adults + p.household.children))];
  select.gez_kind = [String(Math.min(7, p.household.children))];
  if (p.job || ['employed', 'phd', 'starting_job'].includes(p.occupation)) choice.a_werksituatie = ['Loondienst'];
  else if (p.occupation === 'self_employed') choice.a_werksituatie = ['Zelfstandig'];
  select.a_wanneerhuren = moveInChoices(p.moveInFrom, now);
  return { text, choice, select };
}

const NEXT = /^\s*(opslaan en volgende|save and next)\s*$/i;
const SEND = /^\s*(verstuur formulier|send form)\s*$/i;
const LOGIN_PATH = /\/(login|inloggen)(\/|$)/i;
const SUCCESS = /genoteerd|bedankt|ontvangen|verzonden|thank you|we have received|has been registered|is registered/i;

/** The step that shows now, or the whole form when the portal shows no steps. */
function currentStep(page: Page): Locator {
  return page.locator('[role="tabpanel"]:visible, .tab-pane:visible').first();
}

/** Fills the empty fields of the current step from the answers; filled fields keep the portal's saved values. */
async function fillStep(step: Locator, answers: Answers): Promise<void> {
  for (const [name, value] of Object.entries(answers.text)) {
    const field = step.locator(`input[name="${name}"], textarea[name="${name}"]`).first();
    if (!(await field.count()) || !(await field.isVisible().catch(() => false))) continue;
    if ((await field.inputValue()) === '') await field.fill(value);
  }
  for (const [name, values] of Object.entries(answers.choice)) {
    const group = step.locator(`input[type="radio"][name="${name}"]`);
    if (!(await group.count())) continue;
    if (await step.locator(`input[type="radio"][name="${name}"]:checked`).count()) continue;
    for (const value of values) {
      const radio = step.locator(`input[type="radio"][name="${name}"][value="${value}"]`);
      if (await radio.count()) {
        await radio.first().check({ force: true });
        break;
      }
    }
  }
  for (const [name, wanted] of Object.entries(answers.select)) {
    const select = step.locator(`select[name="${name}"]`).first();
    if (!(await select.count()) || !(await select.isVisible().catch(() => false))) continue;
    if ((await select.inputValue()) !== '') continue;
    const options = await select
      .locator('option')
      .evaluateAll((os) => os.map((o) => ({ value: (o as HTMLOptionElement).value, text: (o.textContent ?? '').trim() })));
    const want = wanted.map((w) => w.toLowerCase());
    const hit = options.find((o) => o.value && (want.includes(o.value.toLowerCase()) || want.includes(o.text.toLowerCase())));
    if (hit) await select.selectOption(hit.value);
  }
}

/** Visible validation messages on the page, without the bare "*" required markers. */
async function stepErrors(page: Page): Promise<string[]> {
  const texts = await page
    .locator('.invalid-feedback:visible, .field-validation-error:visible, .alert-danger:visible, .error:visible')
    .allInnerTexts()
    .catch(() => [] as string[]);
  return texts.map((t) => t.replace(/\s+/g, ' ').trim()).filter((t) => t && t !== '*');
}

/** A step's identity, to see whether "next" moved on. */
async function stepKey(page: Page): Promise<string> {
  const id = await currentStep(page)
    .getAttribute('id')
    .catch(() => null);
  return `${new URL(page.url()).hash}|${id ?? ''}`;
}

/** Logged in when the requests overview opens without a login redirect and offers a way to log out. */
export async function checkPortalSession(page: Page, portal: ViewingRequestPortal): Promise<'ok' | 'none'> {
  await page.goto(`${portal.base}/mijnwoning/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  if (LOGIN_PATH.test(new URL(page.url()).pathname) || (await page.locator('input[type="password"]').count())) return 'none';
  return (await page.locator('a[href*="logout"], a[href*="uitloggen"]').count()) > 0 ? 'ok' : 'none';
}

/**
 * Asks for a viewing: opens the listing's application, fills the empty
 * fields of each step, puts the message in the remarks, ticks the agreement
 * where there is one, and sends. A dry run fills the first step only, since
 * every "next" saves the step on the portal.
 */
export async function requestViewing(
  portal: ViewingRequestPortal,
  listing: Listing,
  message: OutboundMessage,
  ctx: SourceContext,
): Promise<ContactResult> {
  const path = portal.requestPath(listing);
  if (!path) return { ok: false, channel: 'form', error: `no ${portal.name} application id for ${listing.url} yet` };
  const url = `${portal.base}${path}`;
  const answers = applicationAnswers(message.profile, ctx.now());
  const session = await ctx.browser();
  const { page } = session;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    if (LOGIN_PATH.test(new URL(page.url()).pathname) || (await page.locator('input[type="password"]').count())) {
      throw new NeedsLoginError(`${portal.name} asks for a login before its viewing request`, { loginUrl: page.url() });
    }
    const form = page.locator('form').filter({ has: page.locator('button', { hasText: SEND }) }).first();
    if (!(await form.count())) {
      const why = (await pageText(page)).slice(0, 200);
      return { ok: false, channel: 'form', needs: 'human', error: `${portal.name} showed no viewing request form on ${url}: ${why}` };
    }

    for (let step = 0; step < 8; step++) {
      await fillStep(currentStep(page), answers);
      if (message.dryRun) return { ok: true, channel: 'form', evidence: 'dry run: the first step was filled and nothing was saved' };
      if (await page.locator('button:visible', { hasText: SEND }).count()) break;
      const next = page.locator('button:visible', { hasText: NEXT }).first();
      if (!(await next.count())) return { ok: false, channel: 'form', needs: 'human', error: `no next step on the ${portal.name} form at ${url}` };
      const before = await stepKey(page);
      await next.click({ timeout: 10_000 });
      const deadline = Date.now() + 15_000;
      while ((await stepKey(page)) === before && Date.now() < deadline) {
        if ((await stepErrors(page)).length) break;
        await page.waitForTimeout(250);
      }
      if ((await stepKey(page)) === before) {
        const errors = await stepErrors(page);
        return {
          ok: false,
          channel: 'form',
          needs: 'human',
          error: `${portal.name} wants an answer the profile does not give${errors.length ? `: ${errors.slice(0, 3).join('; ')}` : ''}. Finish it on ${url}; later requests reuse it.`,
        };
      }
    }

    const final = currentStep(page);
    const remarks = final.locator('textarea').first();
    if ((await remarks.count()) && (await remarks.isVisible().catch(() => false)) && (await remarks.inputValue()) === '') {
      await remarks.fill(message.body.slice(0, 2000));
    }
    const agree = final.locator('input[type="checkbox"][name^="akkoord"]');
    for (let i = 0; i < (await agree.count()); i++) await agree.nth(i).check({ force: true });

    try {
      await page.locator('button:visible', { hasText: SEND }).first().click({ timeout: 10_000 });
    } catch (e) {
      return { ok: false, channel: 'form', error: `could not send the ${portal.name} request on ${url}: ${firstLine(e)}` };
    }
    const confirmation = await waitForConfirmation(page, {
      success: SUCCESS,
      successUrl: /\/mijnwoning\/?/,
      timeoutMs: 20_000,
      failure: async () => (await stepErrors(page)).join('; ') || undefined,
    });
    if (confirmation?.failed) return { ok: false, channel: 'form', needs: 'human', error: `${portal.name} did not accept the request: ${confirmation.text}` };
    if (!confirmation) {
      return { ok: false, channel: 'form', needs: 'human', error: `sent the ${portal.name} request on ${url} but saw no confirmation; check its overview before trying again` };
    }
    return { ok: true, channel: 'form', evidence: confirmation.text.slice(0, 200) };
  } finally {
    await session.close().catch(() => undefined);
  }
}
