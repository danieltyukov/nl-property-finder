import type { Listing, ScamVerdict } from '@nlpf/core';
import { fold } from './text.js';

/*
 * Rule-based scam signals. Sources for the checklist: docs/research/competitors.md
 * section 7.5 (Fraudehelpdesk, Kamernet, !WOON, DutchReview, Opgelicht?!).
 * The AI extract may add its own signal names; unknown names weigh 1.
 */

export type ScamSignal =
  | 'price_far_below_median'
  | 'payment_before_viewing'
  | 'landlord_abroad'
  | 'keys_by_post'
  | 'off_platform_contact'
  | 'whatsapp_only'
  | 'too_good_description'
  | 'no_address'
  | 'risky_source';

const S = '[^.!?\\n]'; // stay inside one sentence

const PATTERNS: [ScamSignal, RegExp[]][] = [
  [
    'payment_before_viewing',
    [
      new RegExp(`\\b(send|transfer|wire)\\b${S}{0,30}\\b(deposit|first month|money|payment|rent)\\b`),
      new RegExp(
        `\\b(pay|deposit)\\b${S}{0,40}\\bbefore\\b${S}{0,30}\\b(viewing|visit|seeing|inspection|keys)\\b`,
      ),
      /western union|moneygram|gift ?cards?|paysafe/,
      new RegExp(
        `\\b(maak|maakt|maken)\\b${S}{0,20}\\b(eerst|vooraf)\\b${S}{0,30}\\b(borg|aanbetaling|huur|geld|waarborgsom)\\b${S}{0,15}\\bover\\b`,
      ),
      new RegExp(
        `\\b(eerst|vooraf)\\b${S}{0,30}\\b(borg|aanbetaling|eerste maand|huur|waarborgsom)\\b${S}{0,20}\\b(overmaken|betalen|over te maken|storten|voldoen)\\b`,
      ),
      new RegExp(
        `\\b(overmaken|betalen|storten)\\b${S}{0,40}\\bvoor(dat|afgaand aan)?\\b${S}{0,20}\\b(de )?(bezichtiging|bezichtigen|kijken)\\b`,
      ),
      /\baanbetaling\b/,
    ],
  ],
  [
    'landlord_abroad',
    [
      new RegExp(
        `\\b(i am|i'm|im|we are|currently|now|moved|living|live|working|work|staying|relocated)\\b${S}{0,30}\\b(abroad|overseas|out of the country)\\b`,
      ),
      new RegExp(
        `\\b(woon|wonen|verblijf|verblijven|zit|zitten|werk|werken|ben|zijn|verhuisd)\\b${S}{0,30}\\bbuitenland\\b`,
      ),
      /\b(moved|relocated|transferred) to (the uk|england|london|spain|france|germany|italy|nigeria|ghana|the usa|america|canada|dubai)\b/,
    ],
  ],
  [
    'keys_by_post',
    [
      new RegExp(`\\b(post|mail|send|ship|courier|dhl|ups|fedex)\\b${S}{0,20}\\bkeys?\\b`),
      new RegExp(`\\bkeys?\\b${S}{0,30}\\b(by|via|through) (post|mail|dhl|courier|ups|fedex)\\b`),
      new RegExp(
        `\\bsleutels?\\b${S}{0,30}(per post|via de post|opsturen|toesturen|toegestuurd|opgestuurd|dhl|koerier|postnl)`,
      ),
      new RegExp(`\\b(stuur|sturen|verstuur|versturen|opsturen)\\b${S}{0,20}\\bsleutels?\\b`),
    ],
  ],
  [
    'whatsapp_only',
    [
      new RegExp(`\\b(only|alleen|uitsluitend|just)\\b${S}{0,30}whats ?app`),
      new RegExp(`whats ?app${S}{0,15}\\b(only|alleen)\\b`),
      new RegExp(
        `\\b(contact|app|message|bericht|text|reach)\\b${S}{0,20}\\b(via|through|on|op|per|by)\\b whats ?app`,
      ),
    ],
  ],
  [
    'too_good_description',
    [
      /god bless|honest (man|woman|person|landlord|lady)|my late (mother|father|husband|wife|son|daughter)|no questions asked|missionary|oil rig|on a mission|gods? fearing/,
      /\bgezegend\b|eerlijke (man|vrouw|verhuurder)|mijn overleden (moeder|vader|man|vrouw)/,
    ],
  ],
  [
    'off_platform_contact',
    [
      /\b(contact|email|e-mail|mail|text|reach|call) me (directly|privately|personally|outside)\b/,
      /\bmail (mij|me) (direct|prive|persoonlijk)\b/,
      /buiten (het|de) (platform|site|website) om/,
    ],
  ],
];

const FREE_MAIL =
  /[a-z0-9._%+-]+@(gmail|googlemail|hotmail|outlook|live|yahoo|icloud|me|protonmail|proton|gmx|aol|mail|yandex|msn)\.[a-z.]+/g;

/** Platforms with a high share of fake listings (research section 7.5). */
const RISKY_SOURCES = new Set(['marktplaats', 'facebook']);

export function scamSignals(listing: Listing, context: { medianPricePerM2?: number }): ScamSignal[] {
  const text = fold(`${listing.title}\n${listing.description ?? ''}`);
  const out = new Set<ScamSignal>();

  const { medianPricePerM2 } = context;
  if (medianPricePerM2 && listing.priceEur && listing.sizeM2 && listing.sizeM2 > 0) {
    if (listing.priceEur / listing.sizeM2 < 0.55 * medianPricePerM2) out.add('price_far_below_median');
  }
  for (const [signal, patterns] of PATTERNS) if (patterns.some((re) => re.test(text))) out.add(signal);

  const agentMail = listing.agent?.email?.toLowerCase();
  const mails = text.match(FREE_MAIL) ?? [];
  if (mails.some((m) => m !== agentMail)) out.add('off_platform_contact');

  if (!listing.address.street && !listing.address.postcode) out.add('no_address');
  if (RISKY_SOURCES.has(listing.sourceId)) out.add('risky_source');
  return [...out];
}

/*
 * Strong signals are what real rental scams do (Fraudehelpdesk, !WOON): money
 * before a viewing, keys by post, a landlord abroad. Weak signals are common
 * on honest listings too: Huurzone and Kamernet hide the street, Marktplaats is
 * full of private landlords, rooms are cheap. Tuned on the first live day
 * (2026-09-24): weak signals alone flagged 31 honest listings, so they now only
 * count when several stack up.
 */
const WEIGHTS: Record<string, number> = {
  payment_before_viewing: 3,
  keys_by_post: 3,
  landlord_abroad: 2,
  whatsapp_only: 1,
  price_far_below_median: 1,
  off_platform_contact: 1,
  too_good_description: 1,
  no_address: 0.5,
  risky_source: 0.5,
};

/** Weighted: 4 or more is likely (never contacted), 3 is possible (a task), less is none (kept as reasons). */
export function scamLevel(signals: string[]): ScamVerdict['level'] {
  const score = [...new Set(signals)].reduce((n, s) => n + (WEIGHTS[s] ?? 1), 0);
  if (score >= 4) return 'likely';
  if (score >= 3) return 'possible';
  return 'none';
}

export function scamVerdict(signals: string[]): ScamVerdict {
  const unique = [...new Set(signals)];
  return { level: scamLevel(unique), signals: unique };
}
