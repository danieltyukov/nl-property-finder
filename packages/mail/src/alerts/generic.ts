import type { InboundMessage, RawListing } from '@nlpf/core';
import { extractAlertListings, registrableDomain, stripTracking, titleCaseSlug, type UrlMatch, type UrlMatcher } from './extract.js';
import type { AlertPlatform } from './types.js';

/**
 * Listing sites without a dedicated alert parser, mapped to the adapter ids
 * of Tasks 5 and 6 so alert listings land on the same source. Anything else
 * becomes `alert:<domain>`.
 */
export const KNOWN_LISTING_DOMAINS: Record<string, string> = {
  'huurwoningen.nl': 'huurwoningen',
  'kamer.nl': 'kamernl',
  '123wonen.nl': 'wonen123',
  'directwonen.nl': 'directwonen',
  'huurstunt.nl': 'huurstunt',
  'rentola.nl': 'rentola',
  'huurzone.nl': 'huurzone',
  'ikwilhuren.nu': 'mvgm',
  'vesteda.com': 'vesteda',
  'holland2stay.com': 'holland2stay',
  'xior.nl': 'xior',
  'rotsvast.nl': 'rotsvast',
  'nederwoon.nl': 'nederwoon',
  'interhouse.nl': 'interhouse',
  'vanderlinden.nl': 'vanderlinden',
  'stadswonen.nl': 'stadswonen',
};

// The link shapes the plan names for listing pages, and a digit somewhere in the path (an id).
const LISTING_PATH = /\/(huren|huur|for-rent|room|rooms|apartment|apartments)\//i;
const NOT_LISTING = /(afmelden|uitschrijven|unsubscribe|zoekprofiel|zoekopdracht|instellingen|settings|account|inloggen|login|privacy|voorwaarden|terms|alerts?\b|woningmail)/i;
const TYPE_SLUG = /^(appartement|appartementen|studio|studios|kamer|kamers|huis|huizen|woning|woningen|room|rooms|apartment|apartments|house|houses)$/i;

/** Accepts any listing-like link, preferring a dedicated platform matcher when the link is on a known platform. */
export function genericMatcher(platforms: AlertPlatform[]): UrlMatcher {
  return (url: URL): UrlMatch | null => {
    for (const p of platforms) {
      const m = p.match(url);
      if (m) return m;
    }
    const clean = stripTracking(url);
    const path = clean.pathname;
    if (!LISTING_PATH.test(`${path}/`) || !/\d/.test(path) || NOT_LISTING.test(path)) return null;
    const domain = registrableDomain(clean.hostname);
    const segments = path.split('/').filter(Boolean);
    const at = segments.findIndex((s) => /^(huren|huur|for-rent)$/i.test(s));
    const citySlug = at >= 0 ? segments[at + 1] : undefined;
    const match: UrlMatch = {
      sourceId: KNOWN_LISTING_DOMAINS[domain] ?? `alert:${domain}`,
      externalId: `${segments.join('/')}${clean.search}`,
      url: `${clean.protocol}//${clean.host.toLowerCase()}${path}${clean.search}`,
      contact: 'none',
    };
    if (citySlug && /^[a-z]+(?:-[a-z]+)*$/i.test(citySlug) && !TYPE_SLUG.test(citySlug)) match.city = titleCaseSlug(citySlug);
    return match;
  };
}

const ALERT_SUBJECT =
  /\b(nieuwe?|new)\b.*\b(woning|woningen|huurwoning|huurwoningen|kamer|kamers|appartement|appartementen|studio|studio's|aanbod|advertentie|advertenties|listing|listings|places?|propert\w*|rooms?|apartments?|homes?|matches)\b|woningmail|zoekopdracht|zoekprofiel|search alert|zoekservice|\balert\b/i;
// A person arranging a viewing or asking something is a conversation, whatever the subject says.
const CONVERSATION = /\b(bezichtiging|bezichtigen|komen kijken|langskomen|kun je|kunt u|wil je|wilt u|ben je|bent u|viewing|come (?:and|to) see|are you (?:still )?available|afspraak|appointment)\b/i;
const FREEMAIL = new Set([
  'gmail', 'googlemail', 'hotmail', 'outlook', 'live', 'msn', 'yahoo', 'icloud', 'me', 'mac', 'ziggo', 'kpnmail',
  'planet', 'home', 'xs4all', 'hetnet', 'quicknet', 'casema', 'chello', 'online', 'tele2', 'zeelandnet', 'proton',
  'protonmail', 'gmx', 'aol', 'mail',
]);

/**
 * The fallback for alert mail from sites without a dedicated parser. It has
 * to be careful: a landlord who writes "Nieuwe kamer, ben je nog op zoek?"
 * from a personal address with a link and a price must reach triage as a
 * reply, not disappear into ingestion (Review Focus 3). So besides an
 * alert-like subject and a priced listing link, the sender must be a known
 * listing site, the site the links point to, or a bulk mailer, never a
 * personal mailbox, and the text must not read like a conversation.
 */
export function parseGenericAlert(mail: InboundMessage, platforms: AlertPlatform[]): RawListing[] {
  if (!ALERT_SUBJECT.test((mail.subject ?? '').slice(0, 300))) return [];
  if (CONVERSATION.test(mail.text)) return [];
  const sender = registrableDomain(mail.from.address?.split('@')[1] ?? '');
  if (!sender || FREEMAIL.has(sender.split('.')[0] ?? '')) return [];
  const listings = extractAlertListings(mail, genericMatcher(platforms), { requirePrice: true });
  if (!listings.length) return [];
  const linkDomains = new Set(
    listings.map((l) => {
      try {
        return registrableDomain(new URL(l.url).hostname);
      } catch {
        return '';
      }
    }),
  );
  const trusted = mail.autoSubmitted === true || sender in KNOWN_LISTING_DOMAINS || linkDomains.has(sender);
  return trusted ? listings : [];
}
