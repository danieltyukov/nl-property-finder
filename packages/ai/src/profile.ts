import type { Lang, Profile } from '@nlpf/core';
import { formatDate, formatEur, scrubSensitive } from './text.js';

/* ---------- what may be used ---------- */

const SENSITIVE_KEY =
  /bsn|burgerservice|sofi|iban|bank|rekening|account|passport|paspoort|id.?(?:kaart|card|nummer|number|doc)|identiteit|legitimatie|password|wachtwoord|\bpin\b|credit.?card|creditcard|tax.?(?:id|number)|belasting/i;

/**
 * Profile facts the agent may use in messages: keys that name identity or
 * bank data are dropped, and so are values that contain a BSN or IBAN.
 */
export function safeFacts(profile: Profile): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(profile.facts ?? {})) {
    if (SENSITIVE_KEY.test(key)) continue;
    if (scrubSensitive(value, { allowEmails: [profile.email] }) !== value) continue;
    out[key] = value;
  }
  return out;
}

/** The profile as the prompts show it: stable key order, sensitive facts removed. */
export function promptProfile(profile: Profile): Record<string, unknown> {
  return {
    firstName: profile.firstName,
    lastName: profile.lastName,
    email: profile.email,
    phone: profile.phone ?? null,
    birthYear: profile.birthYear ?? null,
    nationality: profile.nationality ?? null,
    occupation: profile.occupation,
    organisation: profile.organisation ?? null,
    incomeMonthlyGrossEur: profile.incomeMonthlyGrossEur ?? null,
    guarantor: profile.guarantor ?? null,
    coApplicants: profile.coApplicants,
    household: profile.household,
    smoker: profile.smoker,
    moveInFrom: profile.moveInFrom ?? null,
    moveInLatest: profile.moveInLatest ?? null,
    stayMonths: profile.stayMonths ?? null,
    languages: profile.languages,
    messageLanguage: profile.messageLanguage,
    about: scrubSensitive(profile.about, { allowEmails: [profile.email] }),
    facts: safeFacts(profile),
    signature: profile.signature ?? null,
  };
}

export function fullName(p: Profile): string {
  return `${p.firstName} ${p.lastName}`.replace(/\s+/g, ' ').trim();
}

/* ---------- greetings and closings ---------- */

const COMPANY =
  /\b(?:makelaars?|makelaardij|vastgoed|wonen|woningen|beheer|verhuur|housing|real estate|estates?|rentals?|propert(?:y|ies)|b\.?v\.?|n\.?v\.?|group|groep|holding|management|agency|kantoor|living|homes|team|service|support|info)\b|&/i;
const NOT_A_NAME = /@|no-?reply|do-?not-?reply|mailer|notifications?|^info$|^admin$/i;

export type Addressee = { kind: 'person' | 'company'; name: string } | { kind: 'unknown' };

export function addressee(name: string | undefined): Addressee {
  const cleaned = (name ?? '').replace(/["']/g, '').replace(/\s+/g, ' ').trim();
  if (!cleaned || NOT_A_NAME.test(cleaned)) return { kind: 'unknown' };
  // "Eva Brouwer | Makelaardij De Gracht", "Eva Brouwer - Verhuur", "Verhuur, Eva Brouwer": greet the person.
  // `cleaned` holds single spaces only, so one optional space on each side is enough.
  const parts = cleaned.split(/ ?[|/] ?| - | ?, ?/).filter(Boolean);
  const person = parts.length > 1 ? parts.find((p) => !COMPANY.test(p) && !NOT_A_NAME.test(p)) : undefined;
  if (person) return { kind: 'person', name: person };
  return COMPANY.test(cleaned) ? { kind: 'company', name: cleaned } : { kind: 'person', name: cleaned };
}

/** "Beste Jan Bakker," / "Beste medewerker van Makelaardij De Gracht," / "Dear landlord,". */
export function greeting(who: Addressee, lang: Lang, opts: { firstNameOnly?: boolean } = {}): string {
  if (who.kind === 'unknown') return lang === 'nl' ? 'Beste verhuurder,' : 'Dear landlord,';
  if (who.kind === 'company') return lang === 'nl' ? `Beste medewerker van ${who.name},` : `Dear ${who.name} team,`;
  const name = opts.firstNameOnly ? (who.name.split(' ')[0] ?? who.name) : who.name;
  return lang === 'nl' ? `Beste ${name},` : `Dear ${name},`;
}

export function closing(p: Profile, lang: Lang): string {
  const word = lang === 'nl' ? 'Met vriendelijke groet,' : 'Kind regards,';
  const sign = (p.signature ?? '').trim() || fullName(p);
  return sign ? `${word}\n${sign}` : word;
}

/* ---------- sentences about the person ---------- */

/** "I work at Acme as an engineer." / "Ik werk bij Acme als engineer.", or '' without a job. */
function jobSentence(p: Profile, lang: Lang): string {
  const employer = p.job?.employer.trim();
  if (!employer) return '';
  const role = p.job?.role?.trim();
  if (lang === 'nl') return `Ik werk bij ${employer}${role ? ` als ${role}` : ''}.`;
  return `I work at ${employer}${role ? ` as ${/^[aeiou]/i.test(role) ? 'an' : 'a'} ${role}` : ''}.`;
}

/**
 * Who the person is, in one sentence. A student with a job is introduced by
 * both, or by the job alone with `focus: 'job'` (for homes that turn students
 * away). Only facts from the profile are used.
 */
export function occupationSentence(p: Profile, lang: Lang, opts: { focus?: 'job' } = {}): string {
  const org = p.organisation?.trim();
  const nl = lang === 'nl';
  const job = p.occupation === 'student' ? jobSentence(p, lang) : '';
  if (job && opts.focus === 'job') return job;
  if (job) {
    const study = nl ? (org ? `Ik studeer aan ${org}` : 'Ik ben student') : org ? `I study at ${org}` : 'I am a student';
    // "I work at Acme." becomes "... and work at Acme."
    return `${study} ${nl ? 'en' : 'and'} ${job.replace(/^(?:I|Ik) /, '')}`;
  }
  switch (p.occupation) {
    case 'student':
      return nl ? (org ? `Ik studeer aan ${org}.` : 'Ik ben student.') : org ? `I study at ${org}.` : 'I am a student.';
    case 'phd':
      return nl ? (org ? `Ik ben promovendus aan ${org}.` : 'Ik ben promovendus.') : org ? `I am a PhD candidate at ${org}.` : 'I am a PhD candidate.';
    case 'employed':
      return nl ? (org ? `Ik werk bij ${org}.` : 'Ik werk in loondienst.') : org ? `I work at ${org}.` : 'I am employed.';
    case 'self_employed':
      return nl ? `Ik ben zelfstandig ondernemer${org ? ` (${org})` : ''}.` : `I am self-employed${org ? ` (${org})` : ''}.`;
    case 'starting_job':
      return nl
        ? org ? `Ik begin binnenkort aan een nieuwe baan bij ${org}.` : 'Ik begin binnenkort aan een nieuwe baan.'
        : org ? `I am about to start a new job at ${org}.` : 'I am about to start a new job.';
    default:
      return '';
  }
}

const RELATIONS: Record<string, { nl: string; en: string; plural?: boolean }> = {
  parent: { nl: 'ouder', en: 'parent' },
  ouder: { nl: 'ouder', en: 'parent' },
  parents: { nl: 'ouders', en: 'parents', plural: true },
  guardian: { nl: 'voogd', en: 'guardian' },
  voogd: { nl: 'voogd', en: 'guardian' },
  grandparent: { nl: 'grootouder', en: 'grandparent' },
  grandparents: { nl: 'grootouders', en: 'grandparents', plural: true },
  uncle: { nl: 'oom', en: 'uncle' },
  oom: { nl: 'oom', en: 'uncle' },
  aunt: { nl: 'tante', en: 'aunt' },
  tante: { nl: 'tante', en: 'aunt' },
  ouders: { nl: 'ouders', en: 'parents', plural: true },
  father: { nl: 'vader', en: 'father' },
  vader: { nl: 'vader', en: 'father' },
  mother: { nl: 'moeder', en: 'mother' },
  moeder: { nl: 'moeder', en: 'mother' },
  partner: { nl: 'partner', en: 'partner' },
  spouse: { nl: 'partner', en: 'partner' },
  husband: { nl: 'partner', en: 'husband' },
  wife: { nl: 'partner', en: 'wife' },
  brother: { nl: 'broer', en: 'brother' },
  broer: { nl: 'broer', en: 'brother' },
  sister: { nl: 'zus', en: 'sister' },
  zus: { nl: 'zus', en: 'sister' },
  friend: { nl: 'huisgenoot', en: 'housemate' },
  roommate: { nl: 'huisgenoot', en: 'housemate' },
  housemate: { nl: 'huisgenoot', en: 'housemate' },
  huisgenoot: { nl: 'huisgenoot', en: 'housemate' },
};
const relation = (r: string) => RELATIONS[r.trim().toLowerCase()];

export function incomeSentence(p: Profile, lang: Lang): string {
  const nl = lang === 'nl';
  const parts: string[] = [];
  const own = p.incomeMonthlyGrossEur;
  const partners = p.coApplicants.filter((c) => c.incomeMonthlyGrossEur);
  if (own) parts.push(nl ? `Mijn bruto maandinkomen is ${formatEur(own, lang)}.` : `My gross monthly income is ${formatEur(own, lang)}.`);
  if (partners.length) {
    const total = (own ?? 0) + partners.reduce((s, c) => s + (c.incomeMonthlyGrossEur ?? 0), 0);
    const names = listJoin(partners.map((c) => c.name), lang);
    parts.push(nl ? `Samen met ${names} is ons bruto maandinkomen ${formatEur(total, lang)}.` : `Together with ${names} our gross monthly income is ${formatEur(total, lang)}.`);
  }
  if (p.guarantor) {
    const rel = relation(p.guarantor.relation);
    const inc = p.guarantor.incomeMonthlyGrossEur;
    if (rel) {
      const incNl = inc ? `, met een bruto maandinkomen van ${formatEur(inc, lang)}` : '';
      const incEn = inc ? `, with a gross monthly income of ${formatEur(inc, lang)}` : '';
      parts.push(nl
        ? `Mijn ${rel.nl} ${rel.plural ? 'staan' : 'staat'} garant${incNl}.`
        : `My ${rel.en} ${rel.plural ? 'will act as guarantors' : 'will act as guarantor'}${incEn}.`);
    } else {
      parts.push(nl
        ? `Ik heb een garantsteller (${p.guarantor.relation})${inc ? ` met een bruto maandinkomen van ${formatEur(inc, lang)}` : ''}.`
        : `I have a guarantor (${p.guarantor.relation})${inc ? ` with a gross monthly income of ${formatEur(inc, lang)}` : ''}.`);
    }
  }
  return parts.join(' ');
}

function plural(p: Profile): boolean {
  return p.coApplicants.length > 0 || p.household.adults > 1;
}

export function householdSentence(p: Profile, lang: Lang): string {
  const nl = lang === 'nl';
  const kids = p.household.children;
  const kidsNl = kids ? ` en ${kids === 1 ? 'ons kind' : `onze ${kids} kinderen`}` : '';
  const kidsEn = kids ? ` and our ${kids === 1 ? 'child' : `${kids} children`}` : '';
  if (p.coApplicants.length) {
    const who = p.coApplicants.map((c) => {
      const rel = relation(c.relation);
      return nl ? `mijn ${rel?.nl ?? c.relation} ${c.name}` : `my ${rel?.en ?? c.relation} ${c.name}`;
    });
    return nl ? `Ik kom samen met ${listJoin(who, lang)}${kidsNl} wonen.` : `I would live there with ${listJoin(who, lang)}${kidsEn}.`;
  }
  if (p.household.adults > 1) {
    return nl
      ? `We zijn met ${p.household.adults} volwassenen${kids ? ` en ${kids} ${kids === 1 ? 'kind' : 'kinderen'}` : ''}.`
      : `We are ${p.household.adults} adults${kids ? ` and ${kids} ${kids === 1 ? 'child' : 'children'}` : ''}.`;
  }
  if (kids) return nl ? `Ik kom samen met ${kids === 1 ? 'mijn kind' : `mijn ${kids} kinderen`} wonen.` : `I would live there with my ${kids === 1 ? 'child' : `${kids} children`}.`;
  return nl ? 'Ik kom alleen wonen.' : 'I would live there on my own.';
}

export function lifestyleSentence(p: Profile, lang: Lang): string {
  const nl = lang === 'nl';
  const we = plural(p);
  const pets = p.household.pets;
  if (!p.smoker && !pets) return nl ? (we ? 'We roken niet en hebben geen huisdieren.' : 'Ik rook niet en heb geen huisdieren.') : we ? 'We do not smoke and have no pets.' : 'I do not smoke and have no pets.';
  if (!p.smoker) return nl ? (we ? 'We roken niet.' : 'Ik rook niet.') : we ? 'We do not smoke.' : 'I do not smoke.';
  if (!pets) return nl ? (we ? 'We hebben geen huisdieren.' : 'Ik heb geen huisdieren.') : we ? 'We have no pets.' : 'I have no pets.';
  return '';
}

export function durationPhrase(months: number, lang: Lang): string {
  if (months % 12 === 0) {
    const years = months / 12;
    return lang === 'nl' ? `${years} jaar` : `${years} ${years === 1 ? 'year' : 'years'}`;
  }
  return lang === 'nl' ? `${months} ${months === 1 ? 'maand' : 'maanden'}` : `${months} ${months === 1 ? 'month' : 'months'}`;
}

export function moveInSentence(p: Profile, lang: Lang): string {
  const nl = lang === 'nl';
  const stay = p.stayMonths ? durationPhrase(p.stayMonths, lang) : undefined;
  if (p.moveInFrom) {
    const date = formatDate(p.moveInFrom, lang);
    if (nl) return `Ik kan per ${date} verhuizen${stay ? ` en wil er graag ${stay} wonen` : ''}.`;
    return `I can move in from ${date}${stay ? ` and would like to stay for ${stay}` : ''}.`;
  }
  if (stay) return nl ? `Ik wil er graag ${stay} wonen.` : `I would like to stay for ${stay}.`;
  return '';
}

export function contactSentence(p: Profile, lang: Lang): string {
  const nl = lang === 'nl';
  const email = p.email.trim();
  const phone = p.phone?.trim();
  if (email && phone) return nl ? `U kunt mij bereiken via ${email} of telefonisch via ${phone}.` : `You can reach me at ${email} or by phone on ${phone}.`;
  if (email) return nl ? `U kunt mij bereiken via ${email}.` : `You can reach me at ${email}.`;
  if (phone) return nl ? `U kunt mij bereiken op ${phone}.` : `You can reach me on ${phone}.`;
  return '';
}

export function listJoin(items: string[], lang: Lang): string {
  if (items.length <= 1) return items[0] ?? '';
  const last = items[items.length - 1];
  return `${items.slice(0, -1).join(', ')} ${lang === 'nl' ? 'en' : 'and'} ${last}`;
}

/** An approximate age, for scoring against age limits only; never written in a message. */
export function approximateAge(p: Profile, now: Date): number | undefined {
  return p.birthYear ? now.getUTCFullYear() - p.birthYear : undefined;
}
