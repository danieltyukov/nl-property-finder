import type {
  AutomationConfig,
  ChannelKind,
  ComposeInput,
  ComposeOutput,
  Lang,
  Listing,
  Profile,
} from '@nlpf/core';
import { guessLanguage } from './text.js';

/** Length limits per channel; platform forms and messages cut long texts. */
export const CHANNEL_MAX_CHARS: Record<ChannelKind, number> = {
  form: 2000,
  message: 1500,
  email: 5000,
  booking: 1000,
};

/**
 * The language to write in: the person's explicit choice, otherwise the
 * listing's language, otherwise a guess from its text, and Dutch when there
 * is nothing to go on (the listing is on a Dutch site).
 */
export function messageLanguage(profile: Profile, listing: Listing): Lang {
  if (profile.messageLanguage !== 'auto') return profile.messageLanguage;
  if (listing.language) return listing.language;
  return guessLanguage(`${listing.title} ${listing.description ?? ''}`) ?? 'nl';
}

/** The input for `AiProvider.compose`: template for the language, the channel's length limit, the variant id. */
export function composeInput(
  listing: Listing,
  profile: Profile,
  automation: AutomationConfig,
  channel: ChannelKind,
  variant?: string,
): ComposeInput {
  const language = messageLanguage(profile, listing);
  const input: ComposeInput = {
    listing,
    profile,
    template: automation.templates.first[language],
    language,
    channel,
    maxChars: CHANNEL_MAX_CHARS[channel],
  };
  if (variant) input.variant = variant;
  return input;
}

/**
 * Applies the copy rules to text going to a landlord: no em or en dashes as
 * punctuation (numeric ranges keep a hyphen) and no emojis.
 */
export function cleanCopy(text: string): string {
  return text
    .replace(/(\d)\s*[\u2013\u2014]\s*(\d)/g, '$1-$2')
    .replace(/\s*[\u2014\u2013]\s*/g, ', ')
    .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}][\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}]*/gu, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +([,.!?])/g, '$1')
    .replace(/,\s*,/g, ',')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

/** Cuts at the last sentence end (or word) that fits. */
function fit(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  if (/[.!?]$/.test(cut) && /\s/.test(text.charAt(max))) return cut;
  const sentence = Math.max(...['. ', '! ', '? ', '.\n', '!\n', '?\n'].map((e) => cut.lastIndexOf(e)));
  if (sentence > max * 0.5) return cut.slice(0, sentence + 1).trimEnd();
  const space = cut.lastIndexOf(' ');
  return (space > 0 ? cut.slice(0, space) : cut).trimEnd();
}

/**
 * Last step before sending a composed or drafted message: copy rules, the
 * optional disclosure line (once, in the message language), and the
 * channel's length limit.
 */
export function finaliseMessage(
  out: ComposeOutput,
  automation: AutomationConfig,
  language: Lang,
  maxChars?: number,
): ComposeOutput {
  let body = cleanCopy(out.body);
  const disclosure = automation.disclosure.enabled ? automation.disclosure[language].trim() : '';
  const room =
    maxChars === undefined
      ? Infinity
      : maxChars - (disclosure && !body.includes(disclosure) ? disclosure.length + 2 : 0);
  if (Number.isFinite(room)) body = fit(body, Math.max(0, room));
  if (disclosure && !body.includes(disclosure)) body = `${body}\n\n${disclosure}`;
  const result: ComposeOutput = { ...out, body };
  if (out.subject !== undefined) result.subject = cleanCopy(out.subject);
  return result;
}

const fill = (template: string, profile: Profile) =>
  template
    .replace(/\{firstName\}/g, profile.firstName)
    .replace(/\{lastName\}/g, profile.lastName)
    .replace(/\{name\}/g, `${profile.firstName} ${profile.lastName}`.trim());

const signature = (profile: Profile) =>
  profile.signature?.trim() || `${profile.firstName} ${profile.lastName}`.trim();

/** The "I found a place" message: the configured text, or a short built-in one. */
export function withdrawalText(automation: AutomationConfig, profile: Profile, language: Lang): string {
  const custom = automation.withdraw[language].trim();
  if (custom) return cleanCopy(fill(custom, profile));
  return language === 'nl'
    ? `Beste verhuurder,\n\nIk heb inmiddels een woning gevonden en trek mijn reactie daarom in. Dank voor uw tijd.\n\nMet vriendelijke groet,\n${signature(profile)}`
    : `Dear landlord,\n\nI have found a place in the meantime, so I am withdrawing my application. Thank you for your time.\n\nKind regards,\n${signature(profile)}`;
}

function homeName(listing: Listing): string {
  const a = listing.address;
  if (a.street && a.houseNumber)
    return `${a.street} ${a.houseNumber}${a.addition && /^[a-z]$/i.test(a.addition) ? a.addition.toUpperCase() : a.addition ? ` ${a.addition}` : ''}`;
  return listing.title;
}

/** The one short follow-up after a few days without an answer. */
export function followUpText(profile: Profile, listing: Listing, language: Lang): string {
  const home = homeName(listing);
  return language === 'nl'
    ? `Beste verhuurder,\n\nOnlangs reageerde ik op de woning aan ${home}. Ik ben nog steeds erg geïnteresseerd en kom graag langs voor een bezichtiging. Laat u weten of dat mogelijk is?\n\nMet vriendelijke groet,\n${signature(profile)}`
    : `Dear landlord,\n\nI recently responded to your listing for ${home}. I am still interested and would be glad to come for a viewing. Could you let me know if that is possible?\n\nKind regards,\n${signature(profile)}`;
}
