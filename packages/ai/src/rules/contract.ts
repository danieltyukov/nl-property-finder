import type { ContractReview, Lang } from '@nlpf/core';
import type { ContractReviewRequest } from '../types.js';
import { formatEur, normalise } from '../text.js';

type Finding = ContractReview['findings'][number];

const WORD_NUMBERS: Record<string, number> = {
  een: 1, 'één': 1, twee: 2, drie: 3, vier: 4, vijf: 5, zes: 6, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
};
const COUNT = String.raw`(\d+(?:[.,]\d+)?|een|twee|drie|vier|vijf|zes|one|two|three|four|five|six)`;
const count = (s: string | undefined) => WORD_NUMBERS[s ?? ''] ?? Number((s ?? '').replace(',', '.'));

/** "3.600", "3.600,00", "3,600", "3600" as euros. */
export function parseAmount(s: string): number {
  const x = s.replace(/,-$/, '');
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(x)) return Number(x.replace(/\./g, '').replace(',', '.'));
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(x)) return Number(x.replace(/,/g, ''));
  return Number(x.replace(',', '.'));
}

/**
 * True when a negation comes shortly before the match ("geen bemiddelingskosten",
 * "without agency fee") or right after it ("bemiddelingskosten: geen", "agency fee: none").
 */
function negated(t: string, index: number, end: number): boolean {
  if (/\b(?:geen|zonder|niet|no|without|not)\b[^.;\n]{0,25}$/.test(t.slice(Math.max(0, index - 40), index))) return true;
  return /^\s*[:=]?\s*(?:geen|nee|none|no|nil|n\.?v\.?t\.?|niet van toepassing|not applicable|n\/a|0\b|eur\s*0\b|\u20ac\s*0\b)/.test(t.slice(end, end + 30));
}

function firstUnnegated(t: string, re: RegExp): RegExpMatchArray | undefined {
  const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  for (const m of t.matchAll(global)) if (!negated(t, m.index ?? 0, (m.index ?? 0) + m[0].length)) return m;
  return undefined;
}

/**
 * A first check of a Dutch rental contract or offer against the rules a
 * tenant most often runs into. It flags; it does not give legal advice.
 */
export function reviewContractRules(input: ContractReviewRequest): ContractReview {
  const lang: Lang = input.language;
  const nl = lang === 'nl';
  const t = normalise(input.text ?? '');
  if (!t) {
    return {
      summary: input.pdfPath
        ? nl
          ? 'De PDF kon zonder AI niet worden gelezen. Controleer zelf de borg (maximaal twee keer de kale huur), kosten voor de huurder en de looptijd.'
          : 'Could not read the PDF without AI. Check the deposit (at most twice the base rent), any fees charged to you and the contract term yourself.'
        : nl ? 'Er was geen tekst om te controleren.' : 'There was no text to check.',
      findings: [],
    };
  }
  const findings: Finding[] = [];
  const add = (severity: Finding['severity'], topic: string, en: string, nlText: string) => findings.push({ severity, topic, text: nl ? nlText : en });

  /* deposit: at most twice the base rent (Wet goed verhuurderschap, 1 July 2023) */
  const DEPOSIT = String.raw`(?:waarborgsom|borgsom|borg|security deposit|deposit)`;
  // "binnen 3 maanden terugbetaald" is a refund period, not the size of the deposit.
  const monthsMatch = new RegExp(String.raw`${DEPOSIT}([^.;\n]{0,60}?)${COUNT}\s*(?:x\s*)?(?:maanden|maand|months?|maal|keer|x)\b`).exec(t);
  const months = monthsMatch && !/\b(?:binnen|within|na|after|uiterlijk|terug\w*|refund\w*|return\w*)\s*$/.test(monthsMatch[1] ?? '') ? [monthsMatch[0], monthsMatch[2]] : undefined;
  const amount = new RegExp(String.raw`${DEPOSIT}[^.;\n]{0,40}?(?:€|eur|euro)\s*(\d{1,3}(?:[.,]\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)`).exec(t);
  if (months && count(months[1]) > 2) {
    const n = count(months[1]);
    add('illegal', 'deposit',
      `A deposit of ${n} months' base rent is more than the legal maximum of twice the base rent (Wet goed verhuurderschap, since 1 July 2023).`,
      `Een waarborgsom van ${n} maanden kale huur is meer dan het wettelijke maximum van twee keer de kale huur (Wet goed verhuurderschap, sinds 1 juli 2023).`);
  } else if (amount && input.priceEur) {
    const deposit = parseAmount(amount[1] ?? '');
    if (deposit > input.priceEur * 2 + 1) {
      add('illegal', 'deposit',
        `The deposit of ${formatEur(deposit, lang)} is more than twice the base rent of ${formatEur(input.priceEur, lang)}, the legal maximum since 1 July 2023 (Wet goed verhuurderschap).`,
        `De waarborgsom van ${formatEur(deposit, lang)} is meer dan twee keer de kale huur van ${formatEur(input.priceEur, lang)}, het wettelijke maximum sinds 1 juli 2023 (Wet goed verhuurderschap).`);
    }
  }

  /* fees */
  if (firstUnnegated(t, /\b(?:bemiddelingskosten|bemiddelingsfee|makelaarskosten|makelaarscourtage|courtage|agency fee|mediation fee|agent'?s? fee|finder'?s? fee|brokerage fee)\b/)) {
    add('illegal', 'mediation_fee',
      'Mediation fees may not be charged to the tenant when the agent also works for the landlord, which is almost always the case.',
      'Bemiddelingskosten mogen niet aan de huurder worden doorberekend als de makelaar ook voor de verhuurder werkt, wat bijna altijd zo is.');
  }
  if (firstUnnegated(t, /\b(?:administratiekosten|contractkosten|dossierkosten|opstelkosten|administration (?:fee|costs)|contract (?:fee|costs)|booking fee)\b/)) {
    add('warning', 'mediation_fee',
      'Administration or contract costs charged to the tenant are often a disguised mediation fee. Ask what they cover.',
      'Administratie- of contractkosten voor de huurder zijn vaak verkapte bemiddelingskosten. Vraag wat ze dekken.');
  }
  if (firstUnnegated(t, /\b(?:sleutelgeld|key money)\b/)) {
    add('illegal', 'key_money',
      'Key money is not allowed. A payment for handing over the keys does not have to be paid and can be claimed back.',
      'Sleutelgeld is niet toegestaan. Een betaling voor het overdragen van de sleutels hoeft u niet te betalen en kunt u terugvorderen.');
  }
  if (/\b(?:overname|overnamekosten|overnamesom|overnemen)\b[^.;\n]{0,60}\b(?:vloer|vloerbedekking|gordijnen|meubels|inventaris|keuken|furniture|floor|curtains)\b/.test(t)) {
    add('warning', 'key_money',
      'A takeover payment is only allowed for movable items at a fair price. Anything above that counts as key money.',
      'Een overnamesom mag alleen voor roerende zaken tegen een redelijke prijs. Alles daarboven geldt als sleutelgeld.');
  }

  /* temporary contracts: Wet vaste huurcontracten, 1 July 2024 */
  const temporary = firstUnnegated(t, /\b(?:tijdelijke?|bepaalde tijd|fixed[- ]term|temporary)\b/);
  if (temporary) {
    const room = /\b(?:onzelfstandige?|kamer|room|hospita)\b/.test(t) && !/\bzelfstandige (?:woonruimte|woning)\b/.test(t);
    const limit = room ? 60 : 24;
    const term = /(?:duur van|periode van|looptijd van|termijn van|term of|period of|voor|for)\s*(\d{1,3})\s*(maanden|months?|jaar|years?)\b/.exec(t);
    const termMonths = term ? (/^(jaar|year)/.test(term[2] ?? '') ? Number(term[1]) * 12 : Number(term[1])) : undefined;
    const ground = /\b(?:campuscontract|studentencontract|jongerencontract|promovend|leegstandswet|hospitahuur|short stay)\b/.test(t);
    if (termMonths && termMonths > limit) {
      add('warning', 'temporary_contract',
        `A temporary contract of ${termMonths} months is longer than the ${room ? 'five years allowed for a room' : 'two years allowed for an independent home'}. Since 1 July 2024 a temporary contract also needs a legal ground; without one it counts as indefinite.`,
        `Een tijdelijk contract van ${termMonths} maanden is langer dan de ${room ? 'vijf jaar die voor een kamer is toegestaan' : 'twee jaar die voor een zelfstandige woning is toegestaan'}. Sinds 1 juli 2024 heeft een tijdelijk contract ook een wettelijke grond nodig; zonder grond geldt het als contract voor onbepaalde tijd.`);
    } else if (!ground) {
      add('warning', 'temporary_contract',
        'Since 1 July 2024 (Wet vaste huurcontracten) a temporary contract is only allowed in specific cases, such as student, youth or PhD contracts. Without such a ground it counts as indefinite.',
        'Sinds 1 juli 2024 (Wet vaste huurcontracten) mag een tijdelijk contract alleen in bepaalde gevallen, zoals een studenten-, jongeren- of promovendicontract. Zonder zo\'n grond geldt het als contract voor onbepaalde tijd.');
    } else {
      add('info', 'temporary_contract',
        'The contract is temporary and names a ground for it (for example a student, youth or vacancy act contract).',
        'Het contract is tijdelijk en noemt een grond (bijvoorbeeld een studenten-, jongeren- of leegstandswetcontract).');
    }
  }

  /* notice period for the tenant: equal to the payment period, at least one and at most three months */
  const notice = new RegExp(String.raw`(?:opzegtermijn|notice period)([^.;\n]{0,60}?)${COUNT}\s*(?:maanden|maand|months?)\b`).exec(t);
  if (notice && !/\b(?:verhuurder|landlord)\b/.test(notice[1] ?? '')) {
    const n = count(notice[2]);
    if (n > 3) {
      add('illegal', 'notice_period',
        `A notice period of ${n} months for the tenant is longer than the legal maximum of three months, so it does not apply.`,
        `Een opzegtermijn van ${n} maanden voor de huurder is langer dan het wettelijke maximum van drie maanden en geldt dus niet.`);
    } else if (n > 1) {
      add('warning', 'notice_period',
        `A notice period of ${n} months for the tenant: by law it equals the rent payment period, usually one month.`,
        `Een opzegtermijn van ${n} maanden voor de huurder: volgens de wet is die gelijk aan de betaaltermijn, meestal een maand.`);
    }
  }

  /* registration at the address */
  if (/in\s*(?:te\s+)?schrij(?:ven|ving)[^.;\n]{0,40}?(?:niet|geen)\s+(?:toegestaan|mogelijk|toestaan)|(?:geen|niet)\s+(?:te\s+)?in\s*(?:te\s+)?schrij(?:ven|ving)|registration[^.;\n]{0,40}?not\s+(?:allowed|permitted|possible)|may not register/.test(t)) {
    add('warning', 'registration',
      'The contract forbids registering at the address. Registering where you live for more than four months is a legal duty (BRP), and a clause against it cannot be enforced.',
      'Het contract verbiedt inschrijving op het adres. Inschrijven waar u langer dan vier maanden woont is een wettelijke plicht (BRP), en een clausule daartegen is niet afdwingbaar.');
  }

  /* service costs */
  if (/\bservicekosten|service costs|service charges\b/.test(t) && /\b(?:geen afrekening|niet (?:verrekend|afgerekend)|all[- ]in|vast bedrag|no (?:settlement|reconciliation)|fixed amount)\b/.test(t)) {
    add('warning', 'service_costs',
      'Service costs must be settled against the actual costs once a year. A fixed amount without a yearly statement is not allowed.',
      'Servicekosten moeten jaarlijks worden afgerekend op basis van de werkelijke kosten. Een vast bedrag zonder jaarlijkse afrekening mag niet.');
  }

  /* rent increases */
  const increase = /\b(?:huurverhoging|indexering|indexatie|rent increase|indexation)\b[^.;\n]{0,80}?(\d+(?:[.,]\d+)?)\s*%/.exec(t);
  if (increase) {
    const pct = String(increase[1]).replace('.', nl ? ',' : '.');
    add('info', 'rent_increase',
      `The contract sets rent increases of ${pct}%. Yearly increases are capped by law; an increase above the cap for that year does not have to be paid.`,
      `Het contract noemt huurverhogingen van ${pct}%. Jaarlijkse verhogingen zijn wettelijk gemaximeerd; een verhoging boven het maximum van dat jaar hoeft u niet te betalen.`);
  }

  /* penalties and other clauses worth a look */
  if (/\b(?:boete|boeteclausule|penalty|penalties)\b/.test(t)) {
    add('warning', 'penalty',
      'The contract contains a penalty clause. Check the amounts; an unreasonable penalty can be challenged.',
      'Het contract bevat een boeteclausule. Controleer de bedragen; een onredelijke boete kan worden aangevochten.');
  }
  if (/\bdiplomatenclausule|diplomat(?:ic)? clause\b/.test(t)) {
    add('info', 'other',
      'The contract has a diplomat clause: the landlord may end it when returning to live in the home.',
      'Het contract heeft een diplomatenclausule: de verhuurder mag het beëindigen als hij zelf terugkeert in de woning.');
  }

  const illegal = findings.filter((f) => f.severity === 'illegal').length;
  const warnings = findings.filter((f) => f.severity === 'warning').length;
  const summary = findings.length === 0
    ? nl ? 'De automatische controle vond geen problemen. Dit is geen juridisch advies; lees het contract zorgvuldig.' : 'The automatic check found no problems. This is not legal advice; read the contract carefully.'
    : nl
      ? `${illegal} ${illegal === 1 ? 'onwettige clausule' : 'onwettige clausules'} en ${warnings} ${warnings === 1 ? 'waarschuwing' : 'waarschuwingen'} gevonden. Dit is een automatische eerste controle, geen juridisch advies.`
      : `Found ${illegal} illegal ${illegal === 1 ? 'clause' : 'clauses'} and ${warnings} ${warnings === 1 ? 'warning' : 'warnings'}. This is an automatic first check, not legal advice.`;
  return { summary, findings };
}
