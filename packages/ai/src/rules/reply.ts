import type { Lang, Profile, ReplyInput, ReplyOutput } from '@nlpf/core';
import {
  addressee, closing, durationPhrase, greeting, householdSentence, incomeSentence, moveInSentence, occupationSentence, safeFacts,
} from '../profile.js';
import { formatSlot, normalise, userLanguage } from '../text.js';
import { streetLine } from './compose.js';

type Topic = [RegExp, (p: Profile, lang: Lang) => string];

const SENSITIVE_QUESTION = /\b(?:bsn|burgerservice\w*|sofi\w*|iban|bank\w*|\w*rekening\w*|paspoort\w*|passport|id-?nummer|id number|identiteit\w*|legitimatie\w*|creditcard|credit card|wachtwoord|password|pincode)\b/;

const TOPICS: Topic[] = [
  [/\b(?:werk|werkt|beroep|baan|functie|studie|studeer|studeert|opleiding|occupation|job|work|profession|study|studying|student|employer|werkgever)\b|doet u|do you do/,
    occupationSentence],
  [/\b(?:inkomen|salaris|verdien|verdient|income|salary|earn|earnings)\b/, incomeSentence],
  [/\b(?:garantsteller|borgsteller|garant|guarantor)\b/, (p, l) => (p.guarantor ? incomeSentence({ ...p, incomeMonthlyGrossEur: undefined, coApplicants: [] }, l) : '')],
  [/\b(?:hoeveel personen|met hoeveel|alleen wonen|samen ?wonen|partner|kinderen|kind|gezin|how many (?:people|persons)|on your own|alone|children|household|who (?:will|would) (?:live|be living)|with whom|met wie)\b/,
    householdSentence],
  [/\b(?:huisdier|huisdieren|kat|katten|hond|honden|pets?|cat|cats|dog|dogs)\b/, (p, l) => {
    const we = p.coApplicants.length > 0 || p.household.adults > 1;
    if (l === 'nl') return p.household.pets ? (we ? 'We hebben een huisdier.' : 'Ik heb een huisdier.') : we ? 'We hebben geen huisdieren.' : 'Ik heb geen huisdieren.';
    return p.household.pets ? (we ? 'We have a pet.' : 'I have a pet.') : we ? 'We have no pets.' : 'I have no pets.';
  }],
  [/\b(?:rookt|rook|roken|roker|smoke|smoking|smoker)\b/, (p, l) => {
    const we = p.coApplicants.length > 0 || p.household.adults > 1;
    if (l === 'nl') return p.smoker ? (we ? 'We roken.' : 'Ik rook.') : we ? 'We roken niet.' : 'Ik rook niet.';
    return p.smoker ? (we ? 'We smoke.' : 'I smoke.') : we ? 'We do not smoke.' : 'I do not smoke.';
  }],
  [/\b(?:per wanneer|vanaf wanneer|ingangsdatum|startdatum|verhuizen|intrekken|move in|move-in|moving in|start date)\b|\bwhen\b.*\b(?:move|start)\b|\bwanneer\b.*\b(?:in|erin|wonen|verhuizen|beginnen|starten|intrekken)\b/,
    (p, l) => (p.moveInFrom ? moveInSentence({ ...p, stayMonths: undefined }, l) : '')],
  [/\b(?:hoe lang|hoelang|huurperiode|periode|duur|how long|duration|period)\b/,
    (p, l) => (p.stayMonths ? (l === 'nl' ? `Ik wil er graag ${durationPhrase(p.stayMonths, l)} wonen.` : `I would like to stay for ${durationPhrase(p.stayMonths, l)}.`) : '')],
  [/\b(?:leeftijd|hoe oud|age|how old)\b/, (p, l) => (p.birthYear ? (l === 'nl' ? `Ik ben geboren in ${p.birthYear}.` : `I was born in ${p.birthYear}.`) : '')],
  [/\b(?:nationaliteit|nationality)\b|waar kom(?:t|en)? (?:u|je) vandaan|where are you from/,
    (p, l) => (p.nationality ? (l === 'nl' ? `Mijn nationaliteit is ${p.nationality}.` : `My nationality is ${p.nationality}.`) : '')],
  [/\bover (?:uzelf|jezelf)\b|\babout (?:yourself|you)\b|\bvoorstellen\b|\bintroduce\b/,
    (p, l) => [p.about.trim(), occupationSentence(p, l), householdSentence(p, l)].filter(Boolean).join(' ')],
  [/\b(?:telefoonnummer|telefoon|phone|mobiel|mobile|bellen)\b|\bcall you\b/,
    (p, l) => (p.phone ? (l === 'nl' ? `Mijn telefoonnummer is ${p.phone}.` : `My phone number is ${p.phone}.`) : '')],
];

/** Answers one question from the profile, or undefined when the profile does not say. */
export function answerQuestion(question: string, profile: Profile, lang: Lang): string | undefined {
  const q = normalise(question);
  if (SENSITIVE_QUESTION.test(q)) return undefined;
  const answers: string[] = [];
  for (const [key, value] of Object.entries(safeFacts(profile))) {
    const tokens = normalise(key).split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
    if (tokens.some((tok) => new RegExp(String.raw`\b${tok}`).test(q))) answers.push(value.trim());
  }
  if (answers.length === 0) {
    for (const [re, answer] of TOPICS) {
      if (!re.test(q)) continue;
      const a = answer(profile, lang).trim();
      if (a && !answers.includes(a)) answers.push(a);
    }
  }
  return answers.length ? answers.join(' ') : undefined;
}

function questionsOf(input: ReplyInput): string[] {
  if (input.classification.questions.length) return input.classification.questions;
  return input.message.text
    .split(/(?<=[?.!])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.endsWith('?'));
}

export function rulesReply(input: ReplyInput): ReplyOutput {
  const { profile, language: lang, purpose } = input;
  const nl = lang === 'nl';
  const who = addressee(input.message.from.name);
  const hello = greeting(who, lang, { firstNameOnly: true });
  const bye = closing(profile, lang);
  const subject = input.message.subject ? (/^\s*(?:re|antw|aw):/i.test(input.message.subject) ? input.message.subject : `Re: ${input.message.subject}`) : undefined;
  const mine = userLanguage(profile.languages) === 'nl';
  const body = (...paragraphs: string[]) => [hello, ...paragraphs.filter(Boolean), bye].join('\n\n');

  switch (purpose) {
    case 'answer': {
      const questions = questionsOf(input);
      const answered: string[] = [];
      const unanswerable: string[] = [];
      for (const q of questions) {
        const a = answerQuestion(q, profile, lang);
        if (a) {
          if (!answered.includes(a)) answered.push(a);
        } else unanswerable.push(q);
      }
      const thanks = nl ? 'Dank voor uw bericht.' : 'Thank you for your message.';
      const rest = unanswerable.length
        ? answered.length
          ? nl ? 'Op uw andere vragen kom ik zo snel mogelijk bij u terug.' : 'I will get back to you on your other questions as soon as possible.'
          : nl ? 'Ik kom zo snel mogelijk bij u terug met een antwoord op uw vragen.' : 'I will get back to you with answers to your questions as soon as possible.'
        : '';
      const rationale = mine
        ? `${answered.length ? `${questions.length - unanswerable.length} van de ${questions.length} vragen beantwoord uit je profiel.` : 'Geen vragen beantwoord uit je profiel.'}${unanswerable.length ? ` ${unanswerable.length} ${unanswerable.length === 1 ? 'vraag moet' : 'vragen moeten'} je zelf beantwoorden.` : ''}`
        : `${answered.length ? `Answered ${questions.length - unanswerable.length} of ${questions.length} questions from your profile.` : 'No questions could be answered from your profile.'}${unanswerable.length ? ` ${unanswerable.length} ${unanswerable.length === 1 ? 'needs' : 'need'} your answer.` : ''}`;
      return { subject, body: body([thanks, ...answered].join(' '), rest), unanswerable, rationale };
    }
    case 'confirm_viewing': {
      const slot = input.chosenSlot;
      const place = input.property ? [streetLine(input.property.address), input.property.address.city].filter(Boolean).join(', ') : '';
      const when = slot ? formatSlot(slot.start, lang) : '';
      const text = nl
        ? `Dank voor de uitnodiging. Graag bevestig ik de bezichtiging${when ? ` op ${when}` : ''}${place ? ` (${place})` : ''}. Ik kijk ernaar uit.`
        : `Thank you for the invitation. I am happy to confirm the viewing${when ? ` on ${when}` : ''}${place ? ` (${place})` : ''}. I look forward to it.`;
      return { subject, body: body(text), unanswerable: [], rationale: mine ? `Bezichtiging bevestigd${when ? ` op ${formatSlot(slot!.start, 'nl')}` : ''}.` : `Confirmed the viewing${when ? ` on ${formatSlot(slot!.start, 'en')}` : ''}.` };
    }
    case 'decline_viewing': {
      const n = input.classification.slots.length;
      const text = nl
        ? `Dank voor de uitnodiging voor een bezichtiging. Helaas kan ik op ${n === 1 ? 'de voorgestelde tijd' : 'de voorgestelde tijden'} niet. Is een ander moment mogelijk?`
        : `Thank you for inviting me to a viewing. Unfortunately I cannot make ${n === 1 ? 'the proposed time' : 'the proposed times'}. Would another time be possible?`;
      return { subject, body: body(text), unanswerable: [], rationale: mine ? 'Geen voorgestelde tijd paste in je beschikbaarheid; om een ander moment gevraagd.' : 'None of the proposed times fit your availability, so asked for another time.' };
    }
    case 'send_documents': {
      const text = nl
        ? 'Dank voor uw bericht. In de bijlage vindt u de gevraagde documenten. Laat het gerust weten als u nog iets nodig heeft.'
        : 'Thank you for your message. Please find the requested documents attached. Let me know if you need anything else.';
      return { subject, body: body(text), unanswerable: [], rationale: mine ? 'Begeleidend bericht bij de gevraagde documenten.' : 'Cover note for the requested documents.' };
    }
    case 'withdraw': {
      const text = nl
        ? 'Inmiddels heb ik een andere woning gevonden. Daarom trek ik mijn reactie in. Dank voor uw tijd en moeite.'
        : 'I have found another home in the meantime, so I am withdrawing my application. Thank you for your time.';
      return { subject, body: body(text), unanswerable: [], rationale: mine ? 'Reactie beleefd ingetrokken.' : 'Withdrew the application politely.' };
    }
  }
}
