import type { Address, ComposeInput, ComposeOutput, Lang, Listing, Profile } from '@nlpf/core';
import {
  addressee, closing, contactSentence, fullName, greeting, householdSentence, incomeSentence, lifestyleSentence,
  moveInSentence, occupationSentence,
} from '../profile.js';
import { formatDate, formatEur, userLanguage } from '../text.js';
import { extractRequirements } from './extract.js';

/**
 * The built-in first messages, used when the configured template for the
 * language is empty. Placeholders are listed in `templateValues`; a line
 * whose placeholders all come out empty is left out.
 */
export const BUILT_IN_TEMPLATES: Record<Lang, string> = {
  nl: [
    '{greeting}',
    '',
    'Met interesse las ik uw advertentie voor {listingRef}. Graag kom ik de woning bezichtigen.',
    '',
    '{nameLine} {occupationLine} {incomeLine}',
    '{householdLine} {lifestyleLine} {moveInLine}',
    '',
    '{about}',
    '',
    '{contactLine}',
    '',
    '{closing}',
  ].join('\n'),
  en: [
    '{greeting}',
    '',
    'I read your listing for {listingRef} with interest and would like to arrange a viewing.',
    '',
    '{nameLine} {occupationLine} {incomeLine}',
    '{householdLine} {lifestyleLine} {moveInLine}',
    '',
    '{about}',
    '',
    '{contactLine}',
    '',
    '{closing}',
  ].join('\n'),
};

export function houseNumber(addr: Address): string {
  if (!addr.houseNumber) return '';
  const add = (addr.addition ?? '').replace(/^[\s-]+/, '').trim();
  if (!add) return addr.houseNumber;
  if (/^[a-z]$/i.test(add)) return `${addr.houseNumber}${add.toUpperCase()}`;
  if (/^\d+$/.test(add)) return `${addr.houseNumber}-${add}`;
  return `${addr.houseNumber} ${add}`;
}

export function streetLine(addr: Address): string {
  return [addr.street, houseNumber(addr)].filter(Boolean).join(' ');
}

export function listingRef(listing: Pick<Listing, 'address' | 'title'>, lang: Lang): string {
  const street = streetLine(listing.address);
  const city = listing.address.city;
  if (street) return city ? `${street} in ${city}` : street;
  if (listing.title) return listing.title;
  if (city) return lang === 'nl' ? `de woning in ${city}` : `the home in ${city}`;
  return lang === 'nl' ? 'de woning' : 'the home';
}

const OCCUPATION_WORD: Record<Profile['occupation'], [string, string]> = {
  student: ['student', 'student'],
  phd: ['PhD candidate', 'promovendus'],
  employed: ['employed', 'werkzaam in loondienst'],
  self_employed: ['self-employed', 'zelfstandig ondernemer'],
  starting_job: ['starting a new job', 'start binnenkort een nieuwe baan'],
  other: ['', ''],
};

/** Every value a template may use, keyed by lowercase placeholder name. */
export function templateValues(listing: Listing, profile: Profile, lang: Lang): Record<string, string> {
  const nl = lang === 'nl';
  const who = addressee(listing.agent?.name);
  const agentName = who.kind === 'unknown' ? (nl ? 'verhuurder' : 'landlord') : who.name;
  const addr = listing.address;
  // A student with a job leads with the job where the listing turns students away.
  const noStudents = extractRequirements(`${listing.title}\n${listing.description ?? ''}`).studentsAllowed === false;
  const values: Record<string, string> = {
    firstname: profile.firstName,
    lastname: profile.lastName,
    fullname: fullName(profile),
    name: fullName(profile),
    street: addr.street ?? '',
    housenumber: houseNumber(addr),
    streetline: streetLine(addr),
    address: [streetLine(addr), [addr.postcode, addr.city].filter(Boolean).join(' ')].filter(Boolean).join(', '),
    city: addr.city ?? '',
    postcode: addr.postcode ?? '',
    price: listing.priceEur !== undefined ? formatEur(listing.priceEur, lang) : '',
    priceeur: listing.priceEur !== undefined ? String(listing.priceEur) : '',
    size: listing.sizeM2 !== undefined ? `${listing.sizeM2} m2` : '',
    sizem2: listing.sizeM2 !== undefined ? String(listing.sizeM2) : '',
    rooms: listing.rooms !== undefined ? String(listing.rooms) : '',
    title: listing.title,
    url: listing.url,
    availablefrom: listing.availableFrom ? formatDate(listing.availableFrom, lang) : '',
    landlordname: agentName,
    agentname: agentName,
    greeting: greeting(who, lang),
    occupation: OCCUPATION_WORD[profile.occupation][nl ? 1 : 0],
    organisation: profile.organisation ?? '',
    income: profile.incomeMonthlyGrossEur ? formatEur(profile.incomeMonthlyGrossEur, lang) : '',
    moveinfrom: profile.moveInFrom ? formatDate(profile.moveInFrom, lang) : '',
    staymonths: profile.stayMonths ? String(profile.stayMonths) : '',
    about: profile.about.trim(),
    email: profile.email,
    phone: profile.phone ?? '',
    signature: (profile.signature ?? '').trim() || fullName(profile),
    listingref: listingRef(listing, lang),
    nameline: fullName(profile) ? (nl ? `Mijn naam is ${fullName(profile)}.` : `My name is ${fullName(profile)}.`) : '',
    occupationline: occupationSentence(profile, lang, noStudents ? { focus: 'job' } : {}),
    incomeline: incomeSentence(profile, lang),
    householdline: householdSentence(profile, lang),
    lifestyleline: lifestyleSentence(profile, lang),
    moveinline: moveInSentence(profile, lang),
    contactline: contactSentence(profile, lang),
    closing: closing(profile, lang),
  };
  return values;
}

/** Placeholder names a template may use, for the dashboard's variable chips. Matching ignores case. */
export const TEMPLATE_PLACEHOLDERS = [
  'greeting', 'firstName', 'lastName', 'fullName', 'street', 'houseNumber', 'streetLine', 'address', 'city', 'postcode',
  'price', 'size', 'rooms', 'title', 'url', 'availableFrom', 'landlordName', 'occupation', 'organisation', 'income',
  'moveInFrom', 'stayMonths', 'about', 'email', 'phone', 'signature', 'listingRef', 'nameLine', 'occupationLine',
  'incomeLine', 'householdLine', 'lifestyleLine', 'moveInLine', 'contactLine', 'closing',
] as const;

const PLACEHOLDER = /\{\s*([a-zA-Z]+)\s*\}/g;

/** Fills `{placeholders}`; lines whose placeholders all come out empty are dropped. */
export function renderTemplate(template: string, values: Record<string, string>): string {
  const lines: string[] = [];
  for (const line of template.replace(/\r\n/g, '\n').split('\n')) {
    const names = [...line.matchAll(PLACEHOLDER)].map((m) => (m[1] ?? '').toLowerCase());
    if (names.length && names.every((n) => !(values[n] ?? '').trim())) continue;
    lines.push(line.replace(PLACEHOLDER, (_m, n: string) => values[n.toLowerCase()] ?? ''));
  }
  return lines
    .map((l) => l.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+([,.!?;:])/g, '$1').replace(/\(\s*\)/g, '').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Composes with progressively fewer optional parts until the message fits. */
export function rulesCompose(input: ComposeInput): ComposeOutput {
  const { listing, profile, language: lang, maxChars } = input;
  const configured = input.template.trim();
  const template = configured || BUILT_IN_TEMPLATES[lang];
  const values = templateValues(listing, profile, lang);

  const dropOrder: string[][] = [[], ['about'], ['about', 'lifestyleline', 'householdline'], ['about', 'lifestyleline', 'householdline', 'moveinline', 'incomeline']];
  let body = '';
  let dropped: string[] = [];
  for (const drop of dropOrder) {
    const v = { ...values };
    for (const k of drop) v[k] = '';
    body = renderTemplate(template, v);
    dropped = drop;
    if (!maxChars || body.length <= maxChars) break;
  }

  const who = userLanguage(profile.languages);
  const langName = lang === 'nl' ? (who === 'nl' ? 'Nederlandse' : 'Dutch') : who === 'nl' ? 'Engelse' : 'English';
  const parts: string[] = [];
  if (who === 'nl') {
    parts.push(configured ? `Je ${langName} sjabloon ingevuld met gegevens uit je profiel en de advertentie.` : `Het ingebouwde ${langName} sjabloon ingevuld met gegevens uit je profiel en de advertentie.`);
    if (dropped.length && maxChars) parts.push(`Ingekort tot ${maxChars} tekens.`);
    if (input.variant) parts.push(`Variant ${input.variant}.`);
  } else {
    parts.push(configured ? `Filled your ${langName} template with facts from your profile and the listing.` : `Filled the built-in ${langName} template with facts from your profile and the listing.`);
    if (dropped.length && maxChars) parts.push(`Shortened to fit ${maxChars} characters.`);
    if (input.variant) parts.push(`Variant ${input.variant}.`);
  }

  const subject = input.channel === 'email' || input.channel === 'message'
    ? lang === 'nl' ? `Interesse in ${listingRef(listing, lang)}` : `Viewing request for ${listingRef(listing, lang)}`
    : undefined;
  return { subject, body, rationale: parts.join(' ') };
}
