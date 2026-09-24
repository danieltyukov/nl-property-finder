import type { Lang } from '@nlpf/core';

/* ---------- copy rules ---------- */

const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}‍︎️⃣]/gu;
const DASH = '[\\u2012\\u2013\\u2014\\u2015\\u2212]';

/**
 * The owner's copy rules for anything sent in their name: no emojis, and no
 * em or en dashes used as punctuation. A dash between two numbers becomes a
 * hyphen; anywhere else it becomes a comma.
 */
export function cleanCopy(text: string): string {
  return text
    .replace(EMOJI, '')
    .replace(new RegExp(`(\\d)\\s*${DASH}\\s*(\\d)`, 'g'), '$1-$2')
    .replace(new RegExp(`[ \\t]*${DASH}+[ \\t]*`, 'g'), ', ')
    .replace(/,\s*,/g, ',')
    .replace(/[ \t]+([,.!?;:])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+$/gm, '')
    .trim();
}

/* ---------- sensitive data ---------- */

/** The Dutch eleven test ("elfproef") for a nine digit BSN. */
export function isValidBsn(digits: string): boolean {
  if (!/^\d{9}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += Number(digits[i]) * (9 - i);
  sum -= Number(digits[8]);
  return sum % 11 === 0 && digits !== '000000000';
}

const IBAN = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,3})?\b/gi;
const LABELLED_BSN = /\b(?:bsn|burgerservicenummer|sofi(?:nummer)?|citizen service number)\b[\s:#.-]*(?:is\s+|nummer\s+|number\s+)?\d[\d .]{7,12}\d/gi;
const NINE_DIGITS = /(?<![\d.,])\d{3}[ .]?\d{3}[ .]?\d{3}(?![\d,]|\.\d)/g;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

export const REMOVED = '[removed]';

export interface ScrubOptions {
  allowEmails?: string[];
}

/**
 * Removes what must never leave the machine in a message or reach the
 * dashboard from a model: IBANs, BSNs and email addresses other than the
 * allowed ones (the person's own mailbox).
 */
export function scrubSensitive(text: string, opts: ScrubOptions = {}): string {
  const allowed = new Set((opts.allowEmails ?? []).filter(Boolean).map((e) => e.toLowerCase()));
  return text
    .replace(IBAN, (m) => (looksLikeIban(m) ? REMOVED : m))
    .replace(LABELLED_BSN, REMOVED)
    .replace(NINE_DIGITS, (m) => (isValidBsn(m.replace(/[ .]/g, '')) ? REMOVED : m))
    .replace(EMAIL, (m) => (allowed.has(m.toLowerCase()) ? m : REMOVED));
}

function looksLikeIban(candidate: string): boolean {
  const compact = candidate.replace(/ /g, '');
  // Country code, check digits, then at least one letter or a long digit run (account numbers).
  return compact.length >= 14 && /^[A-Z]{2}\d{2}/i.test(compact) && /\d{6,}/.test(compact.slice(4));
}

/** Applies `scrubSensitive` to every string inside a value. */
export function scrubDeep<T>(value: T, opts: ScrubOptions = {}): T {
  if (typeof value === 'string') return scrubSensitive(value, opts) as T;
  if (Array.isArray(value)) return value.map((v) => scrubDeep(v, opts)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubDeep(v, opts)])) as T;
  }
  return value;
}

const MONEY = String.raw`(?:borg|waarborgsom|deposit|aanbetaling|huur|rent|fee|kosten|reserveringskosten|bedrag|geld|money|payment|betaling|euro|eur|reservering|reservation)`;
const PAYMENT_PROMISE = new RegExp(
  [
    // Dutch: "ik betaal", "wij storten", "ik zal het overmaken", "ik maak de borg over"
    String.raw`\b(?:ik|wij|we)\b[^.!?\n]{0,40}\b(?:betaal|betalen|stort|storten|overmaken|over\s+te\s+maken|voldoe|voldoen)\b`,
    String.raw`\b(?:ik|wij|we)\b[^.!?\n]{0,10}\b(?:maak|maken)\b[^.!?\n]{0,30}\b${MONEY}\b[^.!?\n]{0,20}\bover\b`,
    // English: "I will pay", "I'll transfer", "we can wire"
    String.raw`\b(?:i|we)\b(?:'ll|\s+will|\s+can|\s+shall|\s+am\s+happy\s+to|\s+would)?[^.!?\n]{0,20}\b(?:pay|transfer|wire|send\s+(?:the\s+)?(?:money|deposit|payment))\b`,
  ].join('|'),
  'i',
);
const MONEY_WORD = new RegExp(String.raw`\b${MONEY}\b|€`, 'i');

/**
 * Drops sentences in which the person would promise a payment. Payments are
 * always a human decision, whatever a model or template produced.
 */
export function dropPaymentPromises(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const sentences = line.match(/[^.!?]+[.!?]*\s*/g) ?? [line];
      return sentences.filter((s) => !(PAYMENT_PROMISE.test(s) && MONEY_WORD.test(s))).join('').trimEnd();
    })
    .join('\n')
    .trim();
}

/* ---------- prompt data blocks ---------- */

const DATA_TAGS = /<(\/?)\s*(listing|message|contract|profile|search|template|our_last_message)\b/gi;

/** Escapes tags inside untrusted text so it cannot close or open one of our data blocks. */
export function neutraliseTags(text: string): string {
  return text.replace(DATA_TAGS, (_m, slash: string, name: string) => `&lt;${slash}${name}`);
}

/* ---------- language ---------- */

const NL_WORDS = new Set([
  'de', 'het', 'een', 'en', 'van', 'is', 'met', 'voor', 'niet', 'geen', 'op', 'te', 'aan', 'u', 'uw', 'je', 'ik', 'wij',
  'huur', 'woning', 'kamer', 'per', 'maand', 'bij', 'ook', 'zijn', 'wordt', 'graag', 'beste', 'groet', 'vriendelijke',
  'bezichtiging', 'inclusief', 'exclusief', 'beschikbaar', 'vanaf', 'heeft', 'naar', 'deze', 'dit', 'kunt',
]);
const EN_WORDS = new Set([
  'the', 'a', 'an', 'and', 'of', 'is', 'with', 'for', 'not', 'no', 'on', 'to', 'at', 'you', 'your', 'i', 'we',
  'rent', 'apartment', 'room', 'month', 'per', 'also', 'are', 'be', 'please', 'dear', 'regards', 'kind', 'viewing',
  'including', 'excluding', 'available', 'from', 'has', 'this', 'can', 'would', 'located', 'bedroom',
]);

/** Dutch or English by counting common words. Ties go to Dutch, the default language of Dutch listings. */
export function detectLanguage(text: string): Lang {
  const words = text.toLowerCase().match(/[a-zà-ÿ']+/g) ?? [];
  let nl = 0;
  let en = 0;
  for (const w of words) {
    if (NL_WORDS.has(w)) nl++;
    if (EN_WORDS.has(w)) en++;
  }
  return en > nl ? 'en' : 'nl';
}

/** The language the person reads: the first of `profile.languages`, Dutch or English. */
export function userLanguage(languages: readonly string[] | undefined): Lang {
  const first = (languages?.[0] ?? 'en').toLowerCase();
  return first.startsWith('nl') || first.startsWith('dutch') || first.startsWith('nederlands') ? 'nl' : 'en';
}

/* ---------- formatting ---------- */

export function formatEur(amount: number, lang: Lang): string {
  const rounded = Math.round(amount);
  return `EUR ${new Intl.NumberFormat(lang === 'nl' ? 'nl-NL' : 'en-GB', { maximumFractionDigits: 0 }).format(rounded)}`;
}

/** "1 oktober 2026" or "1 October 2026" from YYYY-MM-DD. */
export function formatDate(ymd: string, lang: Lang): string {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  return new Intl.DateTimeFormat(lang === 'nl' ? 'nl-NL' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}

/** "donderdag 1 oktober om 18:30" or "Thursday 1 October at 18:30", in Amsterdam time. */
export function formatSlot(iso: string, lang: Lang): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const locale = lang === 'nl' ? 'nl-NL' : 'en-GB';
  const day = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Amsterdam' }).format(date);
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Amsterdam' }).format(date);
  return `${day.replace(',', '')} ${lang === 'nl' ? 'om' : 'at'} ${time}`;
}

/* ---------- length ---------- */

/**
 * Shortens a message to `maxChars` by removing whole paragraphs from the
 * middle (keeping the greeting and the closing), then by cutting the last
 * remaining middle paragraph at a sentence end.
 */
export function fitToLength(body: string, maxChars?: number): string {
  if (!maxChars || body.length <= maxChars) return body;
  const paragraphs = body.split(/\n{2,}/);
  if (paragraphs.length < 3) return cutAtSentence(body, maxChars);
  const head = paragraphs[0] ?? '';
  const tail = paragraphs[paragraphs.length - 1] ?? '';
  const middle = paragraphs.slice(1, -1);
  const join = (mid: string[]) => [head, ...mid, tail].join('\n\n');
  while (middle.length > 1 && join(middle).length > maxChars) middle.pop();
  let out = join(middle);
  if (out.length > maxChars && middle.length === 1) {
    const room = maxChars - (head.length + tail.length + 4);
    const cut = room > 20 ? cutAtSentence(middle[0] ?? '', room) : '';
    out = cut ? join([cut]) : [head, tail].join('\n\n');
  }
  return out.length > maxChars ? cutAtSentence(out, maxChars) : out;
}

function cutAtSentence(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const slice = text.slice(0, maxChars);
  const end = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('.\n'), slice.lastIndexOf('? '), slice.lastIndexOf('! '));
  if (end > maxChars * 0.5) return slice.slice(0, end + 1).trim();
  const space = slice.lastIndexOf(' ');
  return (space > 0 ? slice.slice(0, space) : slice).trim();
}

/* ---------- misc ---------- */

/** Lowercase, accents removed, whitespace collapsed: the form phrase lists match against. */
export function normalise(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function firstNameOf(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const cleaned = name.replace(/["']/g, '').trim();
  if (!cleaned || cleaned.includes('@')) return undefined;
  return cleaned;
}
