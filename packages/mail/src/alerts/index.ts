import type { InboundMessage, RawListing } from '@nlpf/core';
import { extractAlertListings, hostIs } from './extract.js';
import { funda } from './funda.js';
import { parseGenericAlert } from './generic.js';
import { housinganywhere } from './housinganywhere.js';
import { kamernet } from './kamernet.js';
import { marktplaats } from './marktplaats.js';
import { pararius } from './pararius.js';
import type { AlertPlatform } from './types.js';

export type { AlertPlatform } from './types.js';
export type { UrlMatch, UrlMatcher } from './extract.js';
export { extractAlertListings, unwrapUrl } from './extract.js';
export { parseParariusAlert } from './pararius.js';
export { parseFundaAlert } from './funda.js';
export { parseKamernetAlert } from './kamernet.js';
export { parseHousingAnywhereAlert } from './housinganywhere.js';
export { parseMarktplaatsAlert } from './marktplaats.js';
export { genericMatcher, parseGenericAlert, KNOWN_LISTING_DOMAINS } from './generic.js';
export { pararius, funda, kamernet, housinganywhere, marktplaats };

export const ALERT_PLATFORMS: AlertPlatform[] = [pararius, funda, kamernet, housinganywhere, marktplaats];

/** Sender domains per source id, for `SourceAdapter.alertSenders` and the dashboard's setup hints. */
export const ALERT_SENDER_DOMAINS: Record<string, string[]> = Object.fromEntries(
  ALERT_PLATFORMS.map((p) => [p.id, [...p.senderDomains]]),
);

// Platforms also mail about messages, reactions, viewings and accounts. Those go to triage.
const NOT_ALERT_SUBJECT =
  /\b(bericht|berichten|message|messages|reactie|reacties|reply|replied|beantwoord|antwoord|gereageerd|uitnodiging|invitation|bezichtiging|viewing|account|wachtwoord|password|inloggen|login|verifi\w*|bevestig\w*|confirm\w*|factuur|invoice|betaling|payment|abonnement|subscription|premium)\b/i;
const REPLY_OR_FORWARD = /^\s*(re|antw|aw|sv|fw|fwd|doorst|wg|tr)\s*(\[\d+\])?\s*:/i;

/**
 * Turns an alert email into listings, or returns null when the mail is not
 * an alert. Dispatches on the sender domain to a platform parser, with a
 * generic fallback for other sites. Replies, forwards and platform message
 * notifications always return null so they reach triage.
 */
export function parseAlertEmail(mail: InboundMessage): { sourceId: string; listings: RawListing[] } | null {
  if (mail.channel !== 'email') return null;
  const subject = mail.subject ?? '';
  if (REPLY_OR_FORWARD.test(subject) || mail.inReplyTo || mail.references?.length) return null;
  const senderHost = mail.from.address?.split('@')[1] ?? '';

  const platform = ALERT_PLATFORMS.find((p) => hostIs(senderHost, p.senderDomains));
  if (platform) {
    if (NOT_ALERT_SUBJECT.test(subject)) return null;
    const listings = extractAlertListings(mail, (u) => platform.match(u));
    return listings.length ? { sourceId: platform.id, listings } : null;
  }

  const listings = parseGenericAlert(mail, ALERT_PLATFORMS);
  if (!listings.length) return null;
  const ids = new Set(listings.map((l) => l.sourceId));
  return { sourceId: ids.size === 1 ? (listings[0]?.sourceId ?? 'alert') : 'alert', listings };
}
