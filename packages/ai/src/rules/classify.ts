import { fromAmsterdam, amsterdam, type ClassifyInput, type ClassifyOutput, type Intent, type Lang, type ProposedSlot } from '@nlpf/core';
import { parseSimpleSlots } from '../slots.js';
import { formatSlot, normalise } from '../text.js';
import type { DocumentKind } from '../types.js';
import { ABROAD, INJECTION } from './extract.js';

type Weighted = [RegExp, number];

/* ---------- phrase lists (matched against lowercased text without accents) ---------- */

const LISTING_GONE: Weighted[] = [
  [/\b(?:is|zijn|werd|wordt|al|reeds|inmiddels|intussen)\s+(?:al\s+|reeds\s+|inmiddels\s+)?(?:verhuurd|vergeven|weg)\b/, 3],
  [/\bniet\s+(?:meer\s+)?beschikbaar\b/, 3],
  [/\bno longer (?:available|on the market)\b/, 3],
  [/\b(?:already|has been|have been|is)\s+(?:been\s+)?(?:rented|let|taken|leased)(?:\s+out)?\b/, 3],
  [/\bonder optie\b/, 2],
  [/\boffline (?:gehaald|gezet)\b/, 2],
  [/\b(?:advertentie|listing)\s+(?:is\s+)?(?:verwijderd|removed|closed|gesloten)\b/, 2],
  [/\ber is (?:al )?een (?:nieuwe )?huurder gevonden\b/, 3],
  [/\bwe (?:have )?found a (?:new )?tenant\b/, 3],
];

const REJECTION: Weighted[] = [
  [/\bhelaas\b/, 1],
  [/\bunfortunately\b/, 1],
  [/\b(?:een\s+)?andere\s+(?:kandidaat|huurder|gegadigde|aanvrager)\b/, 3],
  [/\b(?:other|another)\s+(?:candidate|applicant|tenant)\b/, 3],
  [/\bniet\s+(?:in aanmerking|geselecteerd|gekozen|uitgenodigd)\b/, 3],
  [/\bnot\s+(?:been\s+)?(?:selected|eligible|chosen|shortlisted|invited)\b/, 3],
  [/\bafgewezen\b/, 3],
  [/\b(?:voldoet|voldoen)\s+(?:helaas\s+)?niet\s+aan\b/, 3],
  [/\b(?:do|does) not (?:meet|qualify)\b/, 3],
  [/\b(?:decided|chosen) to (?:go|proceed) with\b/, 3],
  [/\bwe (?:cannot|can ?not|can't|won't|are unable to) (?:offer|invite)\b/, 3],
  [/\b(?:veel|heel veel) (?:reacties|aanmeldingen)\b/, 1],
  [/\bmany (?:responses|applications|reactions)\b/, 1],
];

const VIEWING: Weighted[] = [
  [/\bbezichtig(?:ing|ingen|en)\b/, 3],
  [/\b(?:kijkmoment|kijkavond|kijkdag|open huis|hospiteeravond)\b/, 3],
  [/\blangs\s*(?:te\s+)?komen\b|\blangskomen\b/, 2],
  [/\bkomen kijken\b/, 2],
  [/\brondleiding\b/, 2],
  [/\bviewings?\b/, 3],
  [/\b(?:view|see) the (?:apartment|room|studio|house|property|place|home|flat)\b/, 3],
  [/\bcome (?:by|and see|over|to see)\b/, 2],
  [/\bshow you (?:around|the)\b/, 2],
  [/\b(?:zullen|kunnen|shall|can)\s+(?:we|wij)\b[^.?!\n]{0,40}\b(?:afspreken|meet|meeten)\b/, 2],
  [/\bafspraak\b/, 1],
];

const SLOT_CHOICE: RegExp[] = [
  /\b(?:welke|welk)\s+(?:tijd|moment|tijdstip|dag|optie)\b/,
  /\bde volgende (?:tijden|momenten|data|tijdstippen)\b/,
  /\bmogelijke (?:tijden|momenten|data)\b/,
  /\bkeuze uit\b/,
  /\btijd ?slot|\btijdvak/,
  /\b(?:which|what) (?:time|day|slot|option)\b/,
  /\bfollowing (?:times|slots|dates)\b/,
  /\b(?:choose|pick|select|book) (?:a|your|one) (?:time|slot|moment)\b/,
  /\bavailable (?:times|slots)\b/,
  /\bcalendly|plan (?:een|uw|je) (?:moment|afspraak) in\b/,
];

const DOCUMENTS: [RegExp, DocumentKind, number][] = [
  [/\b(?:loon|salaris)stro(?:o)?k(?:en)?\b/, 'payslip', 3],
  [/\b(?:pay|salary) ?slips?\b/, 'payslip', 3],
  [/\bwerkgeversverklaring\b/, 'employer_statement', 3],
  [/\bemployer'?s? (?:statement|declaration|letter)\b/, 'employer_statement', 3],
  [/\barbeids(?:contract|overeenkomst)\b|\bemployment contract\b/, 'employment_contract', 3],
  [/\b(?:kopie|copy)\b[^.?!\n]{0,25}\b(?:id|paspoort|passport|identiteitsbewijs|legitimatie|id-?kaart)\b/, 'id', 3],
  [/\b(?:identiteitsbewijs|paspoort|passport|id-?kaart|id card|legitimatiebewijs)\b/, 'id', 2],
  [/\bbankafschrift(?:en)?\b|\bbank statements?\b/, 'bank_statement', 3],
  [/\bjaaropgave(?:n)?\b|\bib ?60\b|\binkomensverklaring\b|\bincome statement\b|\bproof of income\b|\bbewijs van inkomen\b|\binkomensgegevens\b/, 'income_statement', 3],
  [/\binschrijvingsbewijs\b|\bbewijs van inschrijving\b|\bproof of (?:enrol|enroll)ment\b|\bstudentenkaart\b|\bstudentenpas\b|\bstudent (?:card|id)\b|\bcollegegeld/, 'enrolment', 3],
  [/\bverhuurdersverklaring\b|\blandlord (?:reference|statement|declaration)\b|\breferentie van (?:uw|je) (?:vorige )?verhuurder\b/, 'landlord_reference', 3],
  [/\bbkr\b/, 'bkr', 2],
  [/\bgarantstel(?:ler|lings)(?:verklaring|formulier)\b|\bguarantor (?:statement|declaration|form|documents?)\b/, 'guarantor', 3],
  [/\b(?:stuur|sturen|toesturen|opsturen|aanleveren|mailen|ontvangen|uploaden)\b[^.?!\n]{0,40}\b(?:documenten|stukken)\b|\b(?:documenten|stukken)\b[^.?!\n]{0,40}\b(?:sturen|toesturen|opsturen|aanleveren|mailen|ontvangen|uploaden)\b/, 'other', 2],
  [/\b(?:send|provide|submit|upload|share)\b[^.?!\n]{0,40}\b(?:documents|paperwork)\b/, 'other', 2],
];

const APPLICATION_FORM: Weighted[] = [
  [/\b(?:inschrijf|aanmeld|aanvraag|huur|kandidaat|registratie|huurders)formulier\b/, 3],
  [/\bformulier\b[^.?!\n]{0,40}\b(?:invullen|in te vullen|vul)\b|\bvul\b[^.?!\n]{0,40}\bformulier\b/, 3],
  [/\bapplication form\b|\bregistration form\b/, 3],
  [/\b(?:fill in|fill out|complete) (?:the|this|our|an|a) (?:form|questionnaire|application)\b/, 3],
  [/\bvragenlijst\b|\bquestionnaire\b/, 2],
  [/\b(?:registreer|registreren|aanmelden|inschrijven) (?:via|op) (?:onze|de) (?:website|link|portal)\b/, 2],
];

const INFO_REQUEST: Weighted[] = [
  [/\b(?:iets\s+)?(?:meer\s+)?over\s+(?:uzelf|jezelf)\b/, 3],
  [/\b(?:tell|share with) (?:me|us) (?:a bit |a little |some(?:thing)? )?(?:more )?about (?:yourself|you)\b/, 3],
  [/\b(?:kunt|kan|wilt|zou)\s+(?:u|je)\b[^.?!\n]{0,40}\b(?:vertellen|toelichten|laten weten|aangeven)\b/, 2],
  [/\b(?:could|can|would)\s+you\b[^.?!\n]{0,40}\b(?:let (?:me|us) know|tell (?:me|us)|share|explain)\b/, 2],
  [/\b(?:income|inkomen|inkomsten|salary|salaris|guarantor|garantsteller|occupation|beroep|job|baan|aanstelling|household|huishouden|pets|huisdieren|smoke|roken|rookt|move[- ]in|verhuisdatum|ingangsdatum)\b[^.!\n]*\?/, 2],
  [/\bwat\s+(?:is|zijn)\s+(?:uw|je|jouw)\b/, 2],
  [/\b(?:wat|welk)\s+(?:voor\s+)?(?:werk|beroep|studie|opleiding|functie)\b/, 2],
  [/\b(?:met|voor)\s+hoeveel\s+personen\b|\bhoeveel\s+(?:personen|mensen)\b/, 2],
  [/\bper wanneer\b|\bwanneer\s+(?:wilt|zou|kunt|kan)\s+(?:u|je)\b/, 2],
  [/\b(?:rookt|rook)\s+(?:u|je)\b|\bheeft\s+(?:u|je)\s+(?:huisdieren|een huisdier)\b/, 2],
  [/\b(?:what|when|how many|how long|do you|are you|would you|could you tell|can you tell)\b[^?\n]{0,80}\?/, 1],
  [/\bvragen\b|\bquestions?\b/, 1],
  [/\?/, 1],
];

const OFFER: Weighted[] = [
  [/\b(?:willen|wil|zouden)\s+(?:u|je|jou)\s+de\s+woning\s+(?:graag\s+)?(?:aanbieden|toewijzen|verhuren)\b/, 4],
  [/\b(?:bieden|bied)\s+(?:u|je|jou)\s+de\s+(?:woning|kamer|studio)\s+aan\b/, 4],
  [/\b(?:is|wordt)\s+aan\s+(?:u|je|jou)\s+toegewezen\b|\btoegewezen\b/, 3],
  [/\b(?:u|je)\s+(?:bent|is)\s+(?:geselecteerd|gekozen|uitgekozen)\b|\bhebben\s+(?:voor\s+)?(?:u|jou|je)\s+gekozen\b/, 4],
  [/\bgefeliciteerd\b|\bcongratulations\b/, 2],
  [/\b(?:we would like to|we'd like to|happy to|pleased to|glad to) offer you\b|\boffer you the\b/, 4],
  [/\byou have been (?:selected|chosen)\b|\bwe have chosen you\b/, 4],
  [/\bthe (?:apartment|room|studio|house|place|home|flat) is yours\b/, 4],
];

const CONTRACT: Weighted[] = [
  [/\bhuur(?:overeenkomst|contract)\b/, 2],
  [/\b(?:rental|lease|tenancy) (?:agreement|contract)\b/, 2],
  [/\b(?:ondertekenen|ondertekening|tekenen|getekend)\b/, 2],
  [/\b(?:sign|signing|signed|signature)\b/, 2],
  [/\b(?:bijgevoegd|in de bijlage|bijlage|attached|enclosed)\b[^.?!\n]{0,60}\b(?:contract|overeenkomst|agreement)\b/, 3],
  [/\b(?:concept|draft)[ -]?(?:contract|overeenkomst|agreement|huurovereenkomst)\b/, 3],
];

const MONEY = String.raw`(?:borg|waarborgsom|deposit|aanbetaling|reserveringskosten|reservation fee|eerste (?:maand|maandhuur)|first month'?s? rent|huur|bedrag|kosten|fee)`;
const PAY = String.raw`(?:overmaken|over te maken|maak|betalen|betaal|voldoen|storten|transfer|pay|wire|send)`;
const PAYMENT_REQUEST: Weighted[] = [
  [new RegExp(String.raw`\b${MONEY}\b[^.?!\n]{0,60}\b${PAY}\b`), 4],
  [new RegExp(String.raw`\b${PAY}\b[^.?!\n]{0,60}\b${MONEY}\b`), 4],
  [/\b(?:rekeningnummer|iban|bankrekening|bank account|account number)\b/, 2],
  [/\b(?:deposit|borg)\s+(?:before|vooraf|voorafgaand)\b|\bvooraf\s+(?:betalen|overmaken)\b/, 4],
  [/\bbetaling\b|\bpayment\b/, 1],
];

const SCAM: Weighted[] = [
  [/\bwestern union\b|\bmoneygram\b|\bbitcoin\b|\bcrypto\b|\bgift ?card\b|\bcadeaukaart\b/, 4],
  [/\b(?:i am|i'm|ik ben|ik woon|i live|ik zit|momenteel|currently)\b[^.?!\n]{0,30}\b(?:abroad|buitenland|out of the country|overseas)\b/, 4],
  [ABROAD, 3],
  [/\b(?:keys?|sleutels?)\b[^.?!\n]{0,40}\b(?:post|mail|courier|koerier|opsturen|send|verstuur|sturen|toesturen)\b|\b(?:post|send|mail)\b[^.?!\n]{0,20}\b(?:the\s+)?keys\b/, 3],
  [/\bvia airbnb\b/, 2],
  [/\b(?:only|alleen|uitsluitend)\b[^.?!\n]{0,20}\bwhats ?app\b/, 3],
  [/\bwhats ?app\b/, 1],
  [/\b(?:pay|betalen|transfer|overmaken)\b[^.?!\n]{0,60}\b(?:before|voor|voordat)\b[^.?!\n]{0,20}\b(?:viewing|bezichtiging)\b/, 3],
  [INJECTION, 4],
  [/\b(?:bsn|burgerservicenummer|citizen service number)\b/, 2],
  [/\b(?:bank ?details|bankgegevens|bank account details|creditcard|credit card)\b/, 2],
];

const ALERT: Weighted[] = [
  [/\bnieuwe? (?:woningen|woning|kamers?|aanbod|resultaten|advertenties)\b|\bnieuw aanbod\b/, 3],
  [/\bnew (?:listings?|properties|rooms|homes|matches|apartments)\b/, 3],
  [/\bzoekopdracht\b|\bzoekprofiel\b|\bsearch (?:alert|agent|profile)\b|\bwoningalert\b|\bmatches your search\b|\bdaily digest\b|\bdagelijkse update\b/, 3],
];
const ALERT_SENDERS = /(?:pararius|funda|kamernet|huurwoningen|housinganywhere|rentola|huurstunt|directwonen|123wonen|vesteda|holland2stay|marktplaats|rentbird|uprent|roomspot|room\.nl|woonnet|woningnet|ikwilhuren|huurzone|kamerverhuur)/;

const NEWSLETTER: Weighted[] = [
  [/\bnieuwsbrief\b|\bnewsletter\b/, 3],
  [/\bunsubscribe\b|\buitschrijven\b|\bafmelden\b/, 1],
  [/\b(?:view|bekijk) (?:this|deze) (?:e-?mail|mail|nieuwsbrief) in (?:your|je|uw) browser\b/, 2],
];

/** Order used when two intents score the same: the one that needs the most care first. */
const PRIORITY: Intent[] = [
  'scam_suspect', 'payment_request', 'contract', 'offer', 'listing_gone', 'rejection', 'viewing_slots', 'viewing_invite',
  'documents_request', 'application_form', 'info_request', 'alert', 'newsletter', 'other',
];

const score = (t: string, table: Weighted[]) => table.reduce((s, [re, w]) => (re.test(t) ? s + w : s), 0);

/* ---------- helpers ---------- */

/** Cuts the quoted history below a reply ("Op ... schreef", "On ... wrote", "> ..."), unless nothing would be left. */
export function stripQuoted(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  for (const line of lines) {
    if (/^\s*(?:op\s.{3,120}\sschreef|on\s.{3,120}\swrote)\b.*:?\s*$/i.test(line)) break;
    if (/^\s*-{2,}\s*(?:original message|oorspronkelijk bericht|forwarded message|doorgestuurd bericht)/i.test(line)) break;
    if (/^\s*(?:van|from):\s.+/i.test(line) && out.join('').trim().length > 20) break;
    if (/^\s*>/.test(line)) continue;
    out.push(line);
  }
  const stripped = out.join('\n').trim();
  return stripped.length >= 3 ? stripped : text;
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[?.!])\s+|\n+/)
    .map((s) => s.replace(/^[\s\-*•]+/, '').trim())
    .filter(Boolean);
}

const STREET_SUFFIX = '(?:straat|weg|laan|gracht|kade|plein|singel|dijk|park|hof|pad|steeg|dreef|markt|wal|haven|plantsoen|erf|burgwal|boulevard|dam|poort|veld|baan|kanaal|oord|zijde|stede|ring|straatweg)';
const HOUSE_NO = String.raw`\d{1,4}(?:\s?-?\s?[A-Za-z](?![\p{L}])|-\d{1,3}(?!\d))?`;

const NOT_A_STREET = /^(?:maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag|monday|tuesday|wednesday|thursday|friday|saturday|sunday|januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december|january|february|march|may|june|july|august|october|beste|dear|de|het|een|the|a|om|at|kamer|room|nummer|number|tel|telefoon|phone|postbus)$/i;

/** The first street address in a text: after "aan de", "op", "at" and similar, or a name ending in a street word. */
export function findAddress(text: string): string | undefined {
  const lead = new RegExp(
    String.raw`(?:aan de|aan het|aan|op de|op|at|on|adres:?|address:?)\s+((?:[A-Z][\p{L}'.-]*\s){1,3}?${HOUSE_NO})`,
    'gu',
  );
  for (const m of text.matchAll(lead)) {
    const words = (m[1] ?? '').trim().split(/\s+/).slice(0, -1);
    if (words.length && !words.some((w) => NOT_A_STREET.test(w))) return (m[1] ?? '').trim();
  }
  const suffix = new RegExp(String.raw`\b((?:[A-Z][\p{L}'-]*\s)?[A-Z][\p{L}'-]*${STREET_SUFFIX})\s+(${HOUSE_NO})`, 'u').exec(text);
  if (suffix) return `${suffix[1]} ${suffix[2]}`.trim();
  return undefined;
}

export function findDeadline(text: string, now: Date): string | undefined {
  const t = text.toLowerCase();
  const within = /\b(?:binnen|within)\s+(\d{1,3})\s*(uur|hours?|dagen|days?)\b/.exec(t);
  if (within) {
    const n = Number(within[1]);
    const ms = /^(uur|hour)/.test(within[2] ?? '') ? n * 3_600_000 : n * 86_400_000;
    return new Date(now.getTime() + ms).toISOString();
  }
  const kw = /\b(?:uiterlijk|vóór|before|no later than|deadline:?|(?:reageer|reageren|reactie|graag|stuur|sturen)\s+(?:dan\s+)?voor)\s+/g;
  for (const m of t.matchAll(kw)) {
    const snippet = text.slice(m.index + m[0].length, m.index + m[0].length + 45);
    const [slot] = parseSimpleSlots(snippet, now);
    if (!slot) continue;
    const hasTime = /\d{1,2}[:.]\d{2}|\d{1,2}\s*(?:uur|u\b)|\d\s*(?:am|pm)/i.test(snippet.slice(0, slot.text.length + 12));
    if (hasTime) return slot.start;
    const local = amsterdam(new Date(slot.start));
    return fromAmsterdam(local.y, local.m, local.d, 23, 59).toISOString();
  }
  return undefined;
}

/* ---------- summary ---------- */

const DOC_NAMES: Record<DocumentKind, [string, string]> = {
  payslip: ['payslips', 'loonstroken'],
  employer_statement: ["employer's statement", 'werkgeversverklaring'],
  employment_contract: ['employment contract', 'arbeidscontract'],
  id: ['ID', 'identiteitsbewijs'],
  bank_statement: ['bank statements', 'bankafschriften'],
  income_statement: ['income statement', 'inkomensverklaring'],
  enrolment: ['proof of enrolment', 'inschrijvingsbewijs'],
  landlord_reference: ['landlord reference', 'verhuurdersverklaring'],
  bkr: ['BKR check', 'BKR-toets'],
  guarantor: ['guarantor documents', 'stukken van de garantsteller'],
  tenant_profile: ['tenant profile', 'huurdersprofiel'],
  other: ['documents', 'documenten'],
};

export function documentNames(kinds: string[], lang: Lang): string {
  const names = kinds.map((k) => DOC_NAMES[k as DocumentKind]?.[lang === 'nl' ? 1 : 0] ?? k);
  return names.join(', ');
}

function summarise(intent: Intent, out: Omit<ClassifyOutput, 'summary'>, lang: Lang, scamWhy: string[]): string {
  const nl = lang === 'nl';
  const first = out.slots[0];
  switch (intent) {
    case 'viewing_invite':
      return nl
        ? `Uitnodiging voor een bezichtiging${first ? ` op ${formatSlot(first.start, lang)}` : ''}.`
        : `Invites you to a viewing${first ? ` on ${formatSlot(first.start, lang)}` : ''}.`;
    case 'viewing_slots':
      return out.slots.length
        ? nl ? `Biedt ${out.slots.length} tijden voor een bezichtiging aan.` : `Offers ${out.slots.length} viewing times.`
        : nl ? 'Vraagt je een tijd voor de bezichtiging te kiezen.' : 'Asks you to pick a viewing time.';
    case 'info_request':
      return nl
        ? `Stelt ${out.questions.length || 'een aantal'} ${out.questions.length === 1 ? 'vraag' : 'vragen'} over jou.`
        : `Asks ${out.questions.length || 'some'} ${out.questions.length === 1 ? 'question' : 'questions'} about you.`;
    case 'documents_request':
      return nl ? `Vraagt om documenten: ${documentNames(out.documents, lang)}.` : `Asks for documents: ${documentNames(out.documents, lang)}.`;
    case 'application_form':
      return nl ? 'Vraagt je een aanmeldformulier in te vullen.' : 'Asks you to fill in an application form.';
    case 'rejection':
      return nl ? 'Je bent niet gekozen voor deze woning.' : 'You were not selected for this home.';
    case 'listing_gone':
      return nl ? 'De woning is niet meer beschikbaar.' : 'The home is no longer available.';
    case 'offer':
      return nl ? 'Biedt je de woning aan.' : 'Offers you the home.';
    case 'contract':
      return nl ? 'Stuurt of bespreekt het huurcontract.' : 'Sends or discusses the rental contract.';
    case 'payment_request':
      return nl ? 'Vraagt om een betaling. Betaal niets voordat je de woning hebt gezien en het contract klopt.' : 'Asks for a payment. Pay nothing before you have seen the home and checked the contract.';
    case 'scam_suspect':
      return nl ? `Tekenen van oplichting: ${scamWhy.join(', ')}.` : `Signs of a scam: ${scamWhy.join(', ')}.`;
    case 'alert':
      return nl ? 'Een woningalert van een platform.' : 'A listing alert from a platform.';
    case 'newsletter':
      return nl ? 'Een nieuwsbrief.' : 'A newsletter.';
    default:
      return nl ? 'Een bericht dat de regels niet konden indelen.' : 'A message the rules could not classify.';
  }
}

const SCAM_WHY: [RegExp, string, string][] = [
  [/western union|moneygram|bitcoin|crypto|gift ?card|cadeaukaart/, 'untraceable payment method', 'onnaspeurbare betaalmethode'],
  [/abroad|buitenland|out of the country|overseas/, 'landlord abroad', 'verhuurder in het buitenland'],
  [ABROAD, 'landlord lives in another country', 'verhuurder woont in een ander land'],
  [/(?:keys?|sleutels?)[^.?!\n]{0,40}(?:post|mail|courier|koerier|opsturen|send|sturen)/, 'keys by post', 'sleutels per post'],
  [/whats ?app/, 'WhatsApp contact', 'contact via WhatsApp'],
  [INJECTION, 'instructions aimed at an AI assistant', 'instructies gericht aan een AI-assistent'],
  [/bsn|burgerservicenummer|bank ?details|bankgegevens|credit ?card/, 'asks for BSN or bank details', 'vraagt om BSN of bankgegevens'],
  [/(?:pay|betalen|transfer|overmaken)[^.?!\n]{0,60}(?:before|voor|voordat)[^.?!\n]{0,20}(?:viewing|bezichtiging)/, 'payment before a viewing', 'betalen voor de bezichtiging'],
];

/* ---------- operation ---------- */

export function rulesClassify(input: ClassifyInput, summaryLang: Lang): ClassifyOutput {
  const now = new Date(input.now);
  const raw = stripQuoted(input.message.text);
  const t = normalise(raw);
  const subject = normalise(input.message.subject ?? '');
  const sender = (input.message.from.address ?? '').toLowerCase();

  const slots: ProposedSlot[] = [];
  const docs = new Set<DocumentKind>();
  let docScore = 0;
  for (const [re, kind, w] of DOCUMENTS) {
    if (re.test(t)) {
      docs.add(kind);
      docScore += w;
    }
  }
  if (docs.size > 1) docs.delete('other');

  const viewing = score(t, VIEWING);
  if (viewing > 0) slots.push(...parseSimpleSlots(raw, now));

  const scores: Partial<Record<Intent, number>> = {
    listing_gone: score(t, LISTING_GONE),
    rejection: score(t, REJECTION),
    documents_request: docScore,
    application_form: score(t, APPLICATION_FORM),
    info_request: score(t, INFO_REQUEST),
    offer: score(t, OFFER),
    contract: score(t, CONTRACT),
    payment_request: score(t, PAYMENT_REQUEST),
    scam_suspect: score(t, SCAM),
    alert: score(`${subject} ${t}`, ALERT) + (ALERT_SENDERS.test(sender) ? 1 : 0),
    newsletter: score(`${subject} ${t}`, NEWSLETTER) + (input.message.autoSubmitted ? 1 : 0),
  };
  if (viewing > 0) {
    const choice = SLOT_CHOICE.some((re) => re.test(t)) || slots.length > 1;
    scores[choice ? 'viewing_slots' : 'viewing_invite'] = viewing + (slots.length ? 2 : 0);
  }
  // A viewing without any time and a document request together: the documents come first.
  if (viewing > 0 && slots.length === 0 && docScore > 0) scores.documents_request = Math.max(docScore, viewing + 1);
  // Alerts and newsletters are weak unless nothing personal is going on.
  const personal = Math.max(...PRIORITY.slice(0, 11).map((i) => scores[i] ?? 0));
  if (personal >= 3) {
    scores.alert = 0;
    scores.newsletter = 0;
  }
  // A question mark alone is not an info request when another intent is clear.
  if ((scores.info_request ?? 0) <= 2 && personal > (scores.info_request ?? 0)) scores.info_request = 0;

  let intent: Intent = 'other';
  let best = 0;
  let second = 0;
  for (const i of PRIORITY) {
    const s = scores[i] ?? 0;
    if (s > best) {
      second = best;
      best = s;
      intent = i;
    } else if (s > second) second = s;
  }
  // One weak phrase is not enough: "helaas" alone must never close an application. A lone question stays an info request.
  if (best < 2 && !(intent === 'info_request' && best > 0)) {
    intent = 'other';
    best = 0;
  }

  const questions = sentences(raw).filter((s) => s.endsWith('?')).filter((s) => {
    const n = normalise(s);
    return !score(n, VIEWING) && !SLOT_CHOICE.some((re) => re.test(n)) && !DOCUMENTS.some(([re]) => re.test(n)) && !score(n, PAYMENT_REQUEST) && !score(n, APPLICATION_FORM);
  }).slice(0, 8);

  let confidence = intent === 'other' ? 0.3 : Math.min(0.9, 0.35 + 0.1 * best);
  if (intent !== 'other' && best - second <= 1) confidence = Math.max(0.3, confidence - 0.15);

  const scamWhy = SCAM_WHY.filter(([re]) => re.test(t)).map(([, en, nlText]) => (summaryLang === 'nl' ? nlText : en));
  const base: Omit<ClassifyOutput, 'summary'> = {
    intent,
    confidence: Math.round(confidence * 100) / 100,
    slots: intent === 'viewing_invite' || intent === 'viewing_slots' ? slots : [],
    questions,
    documents: [...docs],
    deadline: findDeadline(raw, now),
    addressMention: findAddress(raw),
  };
  if (!base.deadline) delete base.deadline;
  if (!base.addressMention) delete base.addressMention;
  return { ...base, summary: summarise(intent, base, summaryLang, scamWhy) };
}
