import type { ExtractInput, ExtractOutput, Lang, Listing, Profile, Requirements, SearchConfig } from '@nlpf/core';
import { approximateAge, durationPhrase } from '../profile.js';
import { detectLanguage, formatDate, formatEur, normalise, userLanguage } from '../text.js';

/* ---------- requirements ---------- */

const NUM = String.raw`(\d+(?:[.,]\d+)?)`;
const INT = String.raw`(\d{1,3})`;
const INSCHR = String.raw`in\s*(?:te\s+)?schrij(?:ven|ving|f)`;
const UNIT = String.raw`(maanden|maand|mnd|months?|jaar|years?|jr)\b`;

const toNumber = (s: string | undefined) => Number((s ?? '').replace(',', '.'));
const toMonths = (n: number, unit: string | undefined) => (/^(jaar|year|jr)/.test(unit ?? '') ? n * 12 : n);
const isYears = (unit: string | undefined) => /^(jaar|year|jr)/.test(unit ?? '');

function first(t: string, patterns: RegExp[]): RegExpExecArray | undefined {
  let best: RegExpExecArray | undefined;
  for (const re of patterns) {
    const m = re.exec(t);
    if (m && (!best || m.index < best.index)) best = m;
  }
  return best;
}
const any = (t: string, patterns: RegExp[]) => patterns.some((re) => re.test(t));

/** Negative phrases are checked first, so "geen inschrijving mogelijk" never reads as allowed. */
function flag(t: string, neg: RegExp[], pos: RegExp[]): boolean | undefined {
  if (any(t, neg)) return false;
  if (any(t, pos)) return true;
  return undefined;
}

const REGISTRATION_NEG = [
  new RegExp(String.raw`${INSCHR}[^.\n]{0,30}?(?:niet|geen)\s+(?:mogelijk|toegestaan|toegelaten|toestaan|allowed)`),
  new RegExp(String.raw`(?:geen|niet)\s+(?:mogelijk\s+(?:om\s+)?)?(?:te\s+)?${INSCHR}`),
  new RegExp(String.raw`zonder\s+${INSCHR}`),
  /registration[^.\n]{0,40}?(?:not|isn't)\s+(?:possible|allowed|permitted)/,
  /(?:no|not possible to|cannot|can't|unable to|not allowed to)\s+(?:register|registration)\b/,
  /without\s+(?:a\s+)?registration/,
];
const REGISTRATION_POS = [
  new RegExp(String.raw`${INSCHR}[^.\n]{0,25}?(?:is\s+)?(?:mogelijk|toegestaan|allowed)`),
  /registration[^.\n]{0,25}?(?:is\s+)?(?:possible|allowed|permitted)/,
  /(?:you can|possible to|allowed to)\s+register/,
];

const STUDENTS_NEG = [
  /geen\s+student(?:en)?\b/,
  /(?:niet|not)\s+(?:geschikt\s+|suitable\s+)?(?:voor\s+|for\s+)student(?:en|s)?\b/,
  /studenten\s+(?:zijn\s+)?niet\s+(?:toegestaan|welkom|gewenst)/,
  /\bno\s+students\b/,
  /students\s+(?:are\s+)?not\s+(?:allowed|accepted|permitted|welcome)/,
  /alleen\s+(?:voor\s+)?werkenden/,
  /(?:only|alleen)\s+(?:for\s+)?(?:working\s+)?professionals/,
  /professionals\s+only/,
];
const STUDENTS_POS = [
  /studenten\s+(?:zijn\s+)?(?:welkom|toegestaan)/,
  /(?:geschikt|ook)\s+voor\s+studenten/,
  /students?\s+(?:are\s+)?(?:welcome|allowed|accepted)/,
  /suitable\s+for\s+students/,
  /studentenkamer|studentenhuis|studentenwoning|studentencontract|campuscontract|student\s+(?:room|housing|accommodation|studio)|campus\s+contract/,
];

const SHARING_NEG = [
  /(?:geen|niet\s+(?:geschikt\s+)?voor)\s+(?:woning)?delers/,
  /(?:woning)?delers\s+(?:zijn\s+)?niet\s+(?:toegestaan|welkom|mogelijk)/,
  /woningdelen\s+(?:is\s+)?niet\s+(?:toegestaan|mogelijk)/,
  /\bno\s+(?:house\s*)?sharers/,
  /not\s+(?:suitable\s+)?for\s+(?:sharers|sharing|house\s*sharing)/,
  /sharing\s+(?:is\s+)?not\s+(?:allowed|possible)/,
];
const SHARING_POS = [
  /(?:woning)?delers\s+(?:zijn\s+)?(?:welkom|toegestaan)/,
  /geschikt\s+voor\s+(?:2\s+|twee\s+)?(?:woning)?delers/,
  /sharers\s+(?:are\s+)?(?:welcome|allowed)/,
  /suitable\s+for\s+(?:2\s+|two\s+)?sharers/,
  /(?:house\s*)?sharing\s+(?:is\s+)?allowed/,
];

const PETS_NEG = [
  /geen\s+(?:huisdieren|honden|katten)/,
  /huisdieren\s+(?:zijn\s+)?niet\s+(?:toegestaan|toegelaten|welkom|mogelijk)/,
  /\bno\s+pets\b/,
  /pets\s+(?:are\s+)?not\s+(?:allowed|permitted|accepted)/,
  /huisdiervrij/,
];
const PETS_POS = [
  /huisdier(?:en)?\s+(?:zijn\s+|is\s+)?(?:toegestaan|welkom|bespreekbaar|in\s+overleg|mogelijk)/,
  /pets?\s+(?:are\s+|is\s+)?(?:allowed|welcome|negotiable|permitted|on\s+request)/,
  /pet[- ]friendly/,
];

const SMOKING_NEG = [
  /niet[- ]roken/, /rookvrij/, /niet[- ]?rokers?/, /geen\s+rokers/,
  /roken\s+(?:is\s+)?niet\s+(?:toegestaan|toegelaten)/,
  /\bno\s+smok(?:ing|ers)/, /non[- ]?smok(?:ing|ers?)/,
  /smoking\s+(?:is\s+)?not\s+(?:allowed|permitted)/, /smoke[- ]free/,
];
const SMOKING_POS = [/roken\s+(?:is\s+)?(?:toegestaan|mag)/, /rokers\s+(?:zijn\s+)?welkom/, /smoking\s+(?:is\s+)?allowed/, /smokers\s+welcome/];

const GUARANTOR_NEG = [
  /geen\s+garantsteller/,
  /garantsteller(?:s)?\s+(?:is\s+|zijn\s+)?niet\s+(?:mogelijk|toegestaan|geaccepteerd)/,
  /\bno\s+guarantors?/,
  /guarantors?\s+(?:are\s+|is\s+)?not\s+(?:accepted|allowed|possible)/,
];
const GUARANTOR_POS = [
  /garantsteller(?:s)?\s+(?:is\s+|zijn\s+)?(?:mogelijk|toegestaan|geaccepteerd|welkom|bespreekbaar)/,
  /met\s+(?:een\s+)?garantsteller/,
  /(?:ouders|parents)\s+(?:als\s+|as\s+)?(?:garantsteller|guarantors?)/,
  /guarantors?\s+(?:is\s+|are\s+)?(?:accepted|allowed|possible|welcome)/,
  /with\s+(?:a\s+)?guarantor/,
];

const TEMPORARY = [
  /tijdelijke?\s+(?:huur)?(?:contract|huurovereenkomst|overeenkomst|verhuur|huur)/,
  /bepaalde\s+tijd/,
  /temporary\s+(?:rental|contract|lease|let)/,
  /fixed[- ]term/,
  /leegstandswet|leegstandsvergunning/,
  /jongerencontract|campuscontract|studentencontract/,
  /short[- ]stay/,
];
const INDEFINITE = [/onbepaalde\s+tijd/, /vast\s+(?:huur)?contract/, /indefinite/, /permanent\s+(?:contract|lease|rental)/, /unlimited\s+(?:period|duration|contract)/, /open[- ]ended/];

const FEMALE = [
  /alleen\s+(?:voor\s+)?(?:vrouwen|dames|meiden|vrouwelijke)/,
  /(?:vrouwelijke|female)\s+(?:huurders?|student(?:e|en|s)?|tenants?|roommates?|housemates?|huisgeno(?:ot|te))/,
  /females?\s+only/, /only\s+(?:for\s+)?(?:females?|women|ladies|girls)/, /(?:women|ladies|girls)\s+only/, /meidenhuis/,
];
const MALE = [
  /alleen\s+(?:voor\s+)?(?:mannen|heren|jongens|mannelijke)/,
  /(?:mannelijke|\bmale)\s+(?:huurders?|student(?:en|s)?|tenants?|roommates?|housemates?|huisgenoot)/,
  /\bmales?\s+only/, /only\s+(?:for\s+)?(?:males?|men|guys|boys)\b/, /\b(?:men|guys|boys)\s+only/,
];

/** Requirements stated in a listing text, Dutch or English. Unstated fields stay undefined; notes are in `lang`. */
export function extractRequirements(text: string, lang: Lang = 'en'): Requirements {
  const t = normalise(text);
  const req: Requirements = {};

  const multiple = first(t, [
    new RegExp(String.raw`inkomen(?:seis|s?eis|s?eisen)?[^.\n]{0,40}?${NUM}\s*(?:x|keer|maal)\b`),
    new RegExp(String.raw`${NUM}\s*(?:x|keer|maal|times)\s*(?:de\s+|het\s+|the\s+)?(?:(?:bruto|kale|netto|maandelijkse|monthly|gross|basic|base|kale)\s+)*(?:huur|huurprijs|maandhuur|rent)`),
    new RegExp(String.raw`(?:income|earn|verdien)[^.\n]{0,40}?${NUM}\s*(?:x|times|keer)\b`),
  ]);
  if (multiple) {
    const n = toNumber(multiple[1]);
    if (n >= 1 && n <= 6) req.incomeMultiple = n;
  }

  const income = /(?:inkomen|income|salaris|salary)[^.\n]{0,40}?(?:€|eur|euro)?\s*(\d{1,3}(?:[.,]\d{3})+|\d{4,6})(?:,-)?/.exec(t);
  if (income) {
    let n = Number((income[1] ?? '').replace(/[.,]/g, ''));
    if (/jaar|annual|year|p\.?j\.?/.test(income[0])) n = Math.round(n / 12);
    if (n >= 500 && n <= 20000) req.minIncomeEur = n;
  }

  req.registrationAllowed = flag(t, REGISTRATION_NEG, REGISTRATION_POS);
  req.studentsAllowed = flag(t, STUDENTS_NEG, STUDENTS_POS);
  req.sharingAllowed = flag(t, SHARING_NEG, SHARING_POS);
  req.petsAllowed = flag(t, PETS_NEG, PETS_POS);
  req.smokingAllowed = flag(t, SMOKING_NEG, SMOKING_POS);
  req.guarantorAccepted = flag(t, GUARANTOR_NEG, GUARANTOR_POS);

  const temp = first(t, TEMPORARY);
  const indef = first(t, INDEFINITE);
  if (temp && (!indef || temp.index <= indef.index)) req.contract = 'temporary';
  else if (indef) req.contract = 'indefinite';

  // Durations. A number of years above ten is an age ("minimaal 18 jaar"), not a rental period.
  const min = new RegExp(String.raw`(?:min(?:imaal|imum|\.)?|ten\s+minste|at\s+least)\b[a-z\s:.]{0,25}?${INT}\s*${UNIT}`).exec(t);
  if (min && !(isYears(min[2]) && toNumber(min[1]) > 10)) req.minMonths = toMonths(toNumber(min[1]), min[2]);
  const max = new RegExp(String.raw`(?:max(?:imaal|imum|\.)?|ten\s+hoogste|at\s+most|up\s+to)\b[a-z\s:.]{0,25}?${INT}\s*${UNIT}`).exec(t);
  if (max && !(isYears(max[2]) && toNumber(max[1]) > 10)) req.maxMonths = toMonths(toNumber(max[1]), max[2]);
  if (req.contract === 'temporary' && req.maxMonths === undefined) {
    const period = new RegExp(String.raw`(?:voor|for)\s+(?:de\s+duur\s+van\s+|een\s+periode\s+van\s+|a\s+period\s+of\s+)?${INT}\s*${UNIT}`).exec(t);
    if (period && !(isYears(period[2]) && toNumber(period[1]) > 10)) req.maxMonths = toMonths(toNumber(period[1]), period[2]);
  }

  if (any(t, FEMALE)) req.genderRestriction = 'female';
  else if (any(t, MALE)) req.genderRestriction = 'male';

  readAges(t, req);

  const notes = listingNotes(t).map((code) => NOTES[code]?.[lang === 'nl' ? 1 : 0] ?? code);
  if (notes.length) req.notes = notes;

  for (const k of Object.keys(req) as (keyof Requirements)[]) if (req[k] === undefined) delete req[k];
  return req;
}

function readAges(t: string, req: Requirements): void {
  if (/jongerencontract/.test(t)) {
    req.ageMin = 18;
    req.ageMax = 27;
    req.contract ??= 'temporary';
  }
  const range = /(?:(leeftijd(?:sgrens|scategorie)?|age[ds]?|tussen|between|van|from)\s*:?\s*)?\b(1[6-9]|[2-9]\d)\s*(-|tot en met|t\/m|tot|to|and|en)\s*(1[6-9]|[2-9]\d)\b\s*(jaar|years?(?:\s+old)?|jr|jarigen)?/g;
  for (const m of t.matchAll(range)) {
    const lead = m[1];
    const suffix = m[5];
    const ageLead = lead && /^(?:leeftijd|age)/.test(lead);
    if (!ageLead && !suffix) continue;
    if (/^\s*(?:uur|u\b|h\b|:|m2|m²|euro|eur)/.test(t.slice((m.index ?? 0) + m[0].length))) continue;
    const lo = Number(m[2]);
    let hi = Number(m[4]);
    if (m[3] === 'tot') hi -= 1;           // Dutch "tot" excludes the upper bound; "tot en met" includes it
    if (lo < hi) {
      req.ageMin = lo;
      req.ageMax = hi;
      return;
    }
  }
  const minAge = first(t, [
    /(?:leeftijd|age)\s*:?\s*(?:vanaf|minimaal|min\.?|from|at\s+least|minimum)\s*(\d{2})/,
    /(\d{2})\s*(?:jaar|years?)\s*(?:of\s+ouder|en\s+ouder|or\s+older|and\s+older)/,
    /vanaf\s+(\d{2})\s+jaar/,
    /(?:minimaal|minimum|at\s+least)\s+(\d{2})\s+(?:jaar|years)(?:\s+oud|\s+old)?/,
  ]);
  if (minAge && Number(minAge[1]) >= 16) req.ageMin = Number(minAge[1]);
  const maxAge = first(t, [
    /(?:leeftijd|age)\s*:?\s*(tot|max(?:imaal|imum|\.)?|up\s+to|under)\s*(\d{2})/,
    /(?:jongeren|young\s+people|youngsters)\s+(tot|up\s+to|under)\s+(\d{2})/,
    /()(\d{2})\s*(?:jaar|years?)\s*(?:of\s+jonger|en\s+jonger|or\s+younger|and\s+younger)/,
    /(max(?:imaal|imum|\.)?)\s+(\d{2})\s+(?:jaar|years)(?:\s+oud|\s+old)?/,
  ]);
  if (maxAge && Number(maxAge[2]) >= 16) {
    const n = Number(maxAge[2]);
    req.ageMax = maxAge[1] === 'tot' || maxAge[1] === 'under' ? n - 1 : n;
  }
}

const NOTES: Record<string, [string, string]> = {
  lottery: ['Allocated by lottery', 'Toewijzing door loting'],
  first_come_first_served: ['First come, first served', 'Wie het eerst komt, het eerst maalt'],
  diplomat_clause: ['Diplomat clause', 'Diplomatenclausule'],
  mediation_fee: ['Mentions a mediation fee', 'Noemt bemiddelingskosten'],
  hospiteren: ['Housemates choose at a viewing evening (hospiteren)', 'Hospiteeravond'],
  vacancy_act: ['Vacancy Act (Leegstandwet) contract', 'Contract onder de Leegstandwet'],
  key_money: ['Mentions key money', 'Noemt sleutelgeld'],
};

function listingNotes(t: string): string[] {
  const notes: string[] = [];
  if (/\bloting\b|wordt verloot|lottery|by lot\b/.test(t)) notes.push('lottery');
  if (/wie het eerst komt|first come,? first serve/.test(t)) notes.push('first_come_first_served');
  if (/diplomatenclausule|diplomat(?:ic)? clause/.test(t)) notes.push('diplomat_clause');
  if (/(?<!geen\s)(?<!no\s)(?:bemiddelingskosten|makelaarskosten|agency fee|mediation fee)/.test(t)) notes.push('mediation_fee');
  if (/hospiteeravond|hospiteren/.test(t)) notes.push('hospiteren');
  if (/leegstandswet|leegstandsvergunning/.test(t)) notes.push('vacancy_act');
  if (/sleutelgeld|key money/.test(t)) notes.push('key_money');
  return notes;
}

/* ---------- scam wording ---------- */

export function scamSignalsFromText(text: string, listing?: Pick<Listing, 'address'>): string[] {
  const t = normalise(text);
  const out: string[] = [];
  if (
    /(?:betal|overmak|over te maken|pay|transfer|deposit|borg)[^.\n]{0,60}(?:voor|voordat|before|prior to)\s+(?:de\s+|the\s+|a\s+)?(?:bezichtiging|viewing|bezoek|visit|seeing)/.test(t) ||
    /(?:voor|voordat|before)\s+(?:de\s+|the\s+)?(?:bezichtiging|viewing)[^.\n]{0,40}(?:betalen|overmaken|pay|transfer)/.test(t)
  ) out.push('payment_before_viewing');
  if (/(?:currently|momenteel|at the moment|ik woon|i live|i am|i'm|ik ben|ik zit|werk(?:zaam)?)[^.\n]{0,30}(?:abroad|buitenland|out of the country|overseas)/.test(t)) out.push('landlord_abroad');
  if (/(?:keys?|sleutels?)[^.\n]{0,40}(?:\bpost\b|per post|by mail|courier|koerier|opsturen|toesturen|verzenden|\bsend\b|\bmail\b)/.test(t) || /(?:post|send|mail|stuur|sturen)[^.\n]{0,20}(?:the\s+|de\s+)?(?:keys|sleutels?)/.test(t)) out.push('keys_by_post');
  if (/(?:only|alleen|uitsluitend|enkel)[^.\n]{0,20}whats ?app|whats ?app[^.\n]{0,20}(?:only|alleen)/.test(t)) out.push('whatsapp_only');
  if (/(?:contact|mail|e-?mail|mailen|app|bel|call|text|reach)[^.\n]{0,30}(?:directly|direct|rechtstreeks|prive|private|personal)|[a-z0-9._-]+@(?:gmail|hotmail|outlook|yahoo|live|icloud)\.[a-z]+/.test(t)) out.push('off_platform_contact');
  if (/western union|moneygram|bitcoin|crypto|gift ?card/.test(t) && !out.includes('payment_before_viewing')) out.push('payment_before_viewing');
  if (INJECTION.test(t)) out.push('prompt_injection');
  if (listing && !listing.address.street && !listing.address.postcode) out.push('no_address');
  return out;
}

export const INJECTION =
  /(?:ignore|disregard|forget|override)\s+(?:all\s+|any\s+)?(?:the\s+)?(?:previous|prior|above|earlier|your)\s+(?:instructions|prompts?|rules)|(?:negeer|vergeet)\s+(?:alle\s+)?(?:vorige|eerdere|voorgaande|bovenstaande)\s+(?:instructies|opdrachten)|system prompt|you are (?:an ai|a language model|chatgpt|claude)|as an ai (?:assistant|model)|\bai assistant\b/;

/* ---------- score ---------- */

interface Scored { delta: number; reason: string }

const isStudent = (p: Profile) => p.occupation === 'student';

export function scoreListing(
  listing: Listing, req: Requirements, scam: string[], profile: Profile, search: SearchConfig, now: Date, lang: Lang,
): { score: number; reasons: string[] } {
  const nl = lang === 'nl';
  const eur = (n: number) => formatEur(n, lang);
  const items: Scored[] = [];
  const add = (delta: number, en: string, nlText: string) => items.push({ delta, reason: nl ? nlText : en });

  const price = listing.priceEur;
  if (price !== undefined && search.priceMaxEur) {
    const total = price + (listing.priceBasis === 'excl' && search.priceIncludesServiceCosts ? (listing.serviceCostsEur ?? 0) : 0);
    const ratio = total / search.priceMaxEur;
    if (ratio <= 0.85) add(12, `Rent ${eur(total)} is well under your maximum of ${eur(search.priceMaxEur)}.`, `Huur ${eur(total)} ligt ruim onder je maximum van ${eur(search.priceMaxEur)}.`);
    else if (ratio <= 1) add(6, `Rent ${eur(total)} is within your maximum of ${eur(search.priceMaxEur)}.`, `Huur ${eur(total)} past binnen je maximum van ${eur(search.priceMaxEur)}.`);
    else add(-25, `Rent ${eur(total)} is above your maximum of ${eur(search.priceMaxEur)}.`, `Huur ${eur(total)} is hoger dan je maximum van ${eur(search.priceMaxEur)}.`);
  }

  if (listing.sizeM2 !== undefined && search.sizeMinM2) {
    const ratio = listing.sizeM2 / search.sizeMinM2;
    if (ratio >= 1.3) add(8, `${listing.sizeM2} m2 is well above your minimum of ${search.sizeMinM2} m2.`, `${listing.sizeM2} m2 is ruim boven je minimum van ${search.sizeMinM2} m2.`);
    else if (ratio >= 1) add(4, `${listing.sizeM2} m2 meets your minimum of ${search.sizeMinM2} m2.`, `${listing.sizeM2} m2 voldoet aan je minimum van ${search.sizeMinM2} m2.`);
    else add(-15, `${listing.sizeM2} m2 is below your minimum of ${search.sizeMinM2} m2.`, `${listing.sizeM2} m2 is kleiner dan je minimum van ${search.sizeMinM2} m2.`);
  }

  if (listing.availableFrom && profile.moveInLatest) {
    const date = formatDate(listing.availableFrom, lang);
    if (listing.availableFrom <= profile.moveInLatest) add(5, `Available from ${date}, in time for your move.`, `Beschikbaar per ${date}, op tijd voor je verhuizing.`);
    else add(-10, `Only available from ${date}, after your latest move-in date.`, `Pas beschikbaar per ${date}, na je uiterste verhuisdatum.`);
  }

  if (req.registrationAllowed === false) {
    if (search.requireRegistration) add(-40, 'Registering at the address is not possible, and you need registration.', 'Inschrijven op het adres is niet mogelijk, en je wilt je inschrijven.');
    else add(-5, 'Registering at the address is not possible.', 'Inschrijven op het adres is niet mogelijk.');
  } else if (req.registrationAllowed === true) add(5, 'Registering at the address is possible.', 'Inschrijven op het adres is mogelijk.');

  if (req.studentsAllowed === false && isStudent(profile)) add(-45, 'No students, and you are a student.', 'Geen studenten, en je bent student.');
  else if (req.studentsAllowed === true && isStudent(profile)) add(8, 'Students are welcome.', 'Studenten zijn welkom.');

  const household = (profile.incomeMonthlyGrossEur ?? 0) + profile.coApplicants.reduce((s, c) => s + (c.incomeMonthlyGrossEur ?? 0), 0);
  const guarantor = profile.guarantor?.incomeMonthlyGrossEur ?? 0;
  const guarantorOk = req.guarantorAccepted !== false && guarantor > 0;
  const checkIncome = (required: number, en: string, nlText: string) => {
    if (household >= required) add(10, `Your income meets ${en} (${eur(required)}).`, `Je inkomen voldoet aan ${nlText} (${eur(required)}).`);
    else if (guarantorOk && guarantor >= required) add(-5, `Your income is below ${en} (${eur(required)}), but your guarantor meets it.`, `Je inkomen is lager dan ${nlText} (${eur(required)}), maar je garantsteller voldoet.`);
    else if (household === 0 && guarantor === 0) add(-10, `The landlord asks ${en} (${eur(required)}) and your profile has no income.`, `De verhuurder vraagt ${nlText} (${eur(required)}) en je profiel noemt geen inkomen.`);
    else add(-30, `The landlord asks ${en} (${eur(required)}), more than your income.`, `De verhuurder vraagt ${nlText} (${eur(required)}), meer dan je inkomen.`);
  };
  if (req.incomeMultiple && price) {
    const n = String(req.incomeMultiple).replace('.', nl ? ',' : '.');
    checkIncome(req.incomeMultiple * price, `an income of ${n}x the rent`, `een inkomen van ${n}x de huur`);
  } else if (req.minIncomeEur) {
    checkIncome(req.minIncomeEur, 'the minimum income', 'het minimuminkomen');
  }

  if (profile.household.pets && req.petsAllowed === false) add(-40, 'No pets allowed, and you have a pet.', 'Geen huisdieren toegestaan, en je hebt een huisdier.');
  else if (profile.household.pets && req.petsAllowed === true) add(5, 'Pets are allowed.', 'Huisdieren zijn toegestaan.');
  if (profile.smoker && req.smokingAllowed === false) add(-30, 'No smoking, and you smoke.', 'Niet roken, en je rookt.');

  if (req.genderRestriction) add(0, req.genderRestriction === 'female' ? 'Only for women.' : 'Only for men.', req.genderRestriction === 'female' ? 'Alleen voor vrouwen.' : 'Alleen voor mannen.');

  const age = approximateAge(profile, now);
  if (age !== undefined && (req.ageMin !== undefined || req.ageMax !== undefined)) {
    const lo = req.ageMin ?? 0;
    const hi = req.ageMax ?? 200;
    const range = `${req.ageMin ?? ''}${req.ageMin !== undefined && req.ageMax !== undefined ? (nl ? ' tot en met ' : ' to ') : ''}${req.ageMax ?? ''}`;
    if (age < lo || age > hi) add(-40, `Age limit ${range}, which you do not meet.`, `Leeftijdsgrens ${range} jaar, daar val je buiten.`);
    else add(3, `You fit the age limit ${range}.`, `Je past binnen de leeftijdsgrens ${range} jaar.`);
  }

  const sharers = profile.coApplicants.some((c) => !/^(partner|spouse|husband|wife|echtgeno(?:ot|te))$/i.test(c.relation.trim()));
  if (sharers && req.sharingAllowed === false) add(-30, 'Not for sharers, and you would share.', 'Niet voor woningdelers, en jullie willen delen.');

  if (profile.stayMonths && req.maxMonths && req.maxMonths < profile.stayMonths) {
    add(-10, `Temporary up to ${durationPhrase(req.maxMonths, lang)}, shorter than the ${durationPhrase(profile.stayMonths, lang)} you want.`, `Tijdelijk tot ${durationPhrase(req.maxMonths, lang)}, korter dan de ${durationPhrase(profile.stayMonths, lang)} die je zoekt.`);
  }
  if (profile.stayMonths && req.minMonths && req.minMonths > profile.stayMonths) {
    add(-10, `Minimum stay ${durationPhrase(req.minMonths, lang)}, longer than you plan.`, `Minimale huurperiode ${durationPhrase(req.minMonths, lang)}, langer dan je van plan bent.`);
  }

  const text = normalise(`${listing.title} ${listing.description ?? ''}`);
  let mustBonus = 0;
  let mustMalus = 0;
  for (const must of search.mustHaves) {
    const term = normalise(must);
    if (!term) continue;
    if (text.includes(term)) {
      if (mustBonus < 15) add(5, `Mentions ${must}.`, `Noemt ${must}.`);
      mustBonus += 5;
    } else {
      if (mustMalus < 12) add(-4, `Does not mention ${must}.`, `Noemt geen ${must}.`);
      mustMalus += 4;
    }
  }

  if (listing.energyLabel && /^a/i.test(listing.energyLabel)) add(3, `Energy label ${listing.energyLabel.toUpperCase()}.`, `Energielabel ${listing.energyLabel.toUpperCase()}.`);

  for (const signal of scam) {
    if (signal === 'no_address') add(-5, 'The listing gives no address.', 'De advertentie noemt geen adres.');
    else add(-15, `Possible scam sign: ${signal.replace(/_/g, ' ')}.`, `Mogelijk teken van oplichting: ${SIGNAL_NL[signal] ?? signal}.`);
  }

  const score = Math.max(0, Math.min(100, Math.round(50 + items.reduce((s, i) => s + i.delta, 0))));
  const reasons = [...items].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 8).map((i) => i.reason);
  return { score, reasons };
}

const SIGNAL_NL: Record<string, string> = {
  payment_before_viewing: 'betalen voor de bezichtiging',
  landlord_abroad: 'verhuurder in het buitenland',
  keys_by_post: 'sleutels per post',
  off_platform_contact: 'contact buiten het platform',
  whatsapp_only: 'alleen via WhatsApp',
  prompt_injection: 'tekst gericht aan een AI-assistent',
};

/* ---------- summary ---------- */

const TYPE: Record<string, [string, string]> = {
  room: ['Room', 'Kamer'], studio: ['Studio', 'Studio'], apartment: ['Apartment', 'Appartement'], house: ['House', 'Huis'], other: ['Home', 'Woning'],
};
const FURNISHING: Record<string, [string, string]> = {
  furnished: ['furnished', 'gemeubileerd'], upholstered: ['upholstered', 'gestoffeerd'], unfurnished: ['unfurnished', 'kaal'],
};

export function requirementPhrases(req: Requirements, lang: Lang): string[] {
  const nl = lang === 'nl';
  const out: string[] = [];
  if (req.incomeMultiple) out.push(nl ? `inkomen ${String(req.incomeMultiple).replace('.', ',')}x de huur` : `income ${req.incomeMultiple}x the rent`);
  if (req.minIncomeEur) out.push(nl ? `minimaal inkomen ${formatEur(req.minIncomeEur, lang)}` : `minimum income ${formatEur(req.minIncomeEur, lang)}`);
  if (req.studentsAllowed === false) out.push(nl ? 'geen studenten' : 'no students');
  if (req.registrationAllowed === false) out.push(nl ? 'inschrijven niet mogelijk' : 'registration not possible');
  if (req.contract === 'temporary') out.push(nl ? `tijdelijk contract${req.maxMonths ? ` tot ${durationPhrase(req.maxMonths, lang)}` : ''}` : `temporary contract${req.maxMonths ? ` up to ${durationPhrase(req.maxMonths, lang)}` : ''}`);
  if (req.minMonths) out.push(nl ? `minimaal ${durationPhrase(req.minMonths, lang)}` : `at least ${durationPhrase(req.minMonths, lang)}`);
  if (req.petsAllowed === false) out.push(nl ? 'geen huisdieren' : 'no pets');
  if (req.smokingAllowed === false) out.push(nl ? 'niet roken' : 'no smoking');
  if (req.sharingAllowed === false) out.push(nl ? 'geen woningdelers' : 'no sharers');
  if (req.genderRestriction) out.push(nl ? (req.genderRestriction === 'female' ? 'alleen vrouwen' : 'alleen mannen') : req.genderRestriction === 'female' ? 'women only' : 'men only');
  if (req.ageMin !== undefined || req.ageMax !== undefined) {
    const range = [req.ageMin, req.ageMax].filter((x) => x !== undefined).join(nl ? ' tot en met ' : ' to ');
    out.push(nl ? `leeftijd ${req.ageMin === undefined ? 'tot en met ' : req.ageMax === undefined ? 'vanaf ' : ''}${range} jaar` : `age ${req.ageMin === undefined ? 'up to ' : req.ageMax === undefined ? 'from ' : ''}${range}`);
  }
  return out;
}

export function summariseListing(listing: Listing, req: Requirements, lang: Lang): string {
  const nl = lang === 'nl';
  const [typeEn, typeNl] = TYPE[listing.type ?? 'other'] ?? ['Home', 'Woning'];
  const where = listing.address.city ? (nl ? ` in ${listing.address.city}` : ` in ${listing.address.city}`) : '';
  const size = listing.sizeM2 ? (nl ? ` van ${listing.sizeM2} m2` : ` of ${listing.sizeM2} m2`) : '';
  let price = nl ? ', prijs onbekend' : ', price not stated';
  if (listing.priceEur !== undefined) {
    const basis =
      listing.priceBasis === 'incl' ? (nl ? ' inclusief servicekosten' : ' including service costs')
      : listing.serviceCostsEur ? (nl ? ` plus ${formatEur(listing.serviceCostsEur, lang)} servicekosten` : ` plus ${formatEur(listing.serviceCostsEur, lang)} service costs`)
      : '';
    price = nl ? ` voor ${formatEur(listing.priceEur, lang)} per maand${basis}` : ` for ${formatEur(listing.priceEur, lang)} a month${basis}`;
  }
  const furnishing = listing.furnishing && FURNISHING[listing.furnishing];
  const furn = furnishing ? `, ${nl ? furnishing[1] : furnishing[0]}` : '';
  const sentences = [`${nl ? typeNl : typeEn}${size}${where}${price}${furn}.`];
  if (listing.availableFrom) sentences.push(nl ? `Beschikbaar per ${formatDate(listing.availableFrom, lang)}.` : `Available from ${formatDate(listing.availableFrom, lang)}.`);
  const reqs = requirementPhrases(req, lang);
  if (reqs.length) sentences.push(`${nl ? 'Eisen' : 'Requirements'}: ${reqs.join(', ')}.`);
  return sentences.join(' ');
}

/* ---------- operation ---------- */

export function rulesExtract(input: ExtractInput, now: Date): ExtractOutput {
  const { listing, profile, search } = input;
  const text = `${listing.title}\n${listing.description ?? ''}`;
  const lang = userLanguage(profile.languages);
  const requirements = extractRequirements(text, lang);
  if (listing.depositEur) requirements.notes = [...(requirements.notes ?? []), `${lang === 'nl' ? 'Borg' : 'Deposit'} ${formatEur(listing.depositEur, lang)}`];
  const scamSignals = scamSignalsFromText(text, listing);
  const { score, reasons } = scoreListing(listing, requirements, scamSignals, profile, search, now, lang);
  return {
    requirements,
    score,
    reasons,
    scamSignals,
    language: listing.language ?? detectLanguage(listing.description || listing.title),
    summary: summariseListing(listing, requirements, lang),
  };
}
