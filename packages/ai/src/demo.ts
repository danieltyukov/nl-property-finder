import type { ClassifyOutput, Intent, Profile } from '@nlpf/core';
import { finaliseClassify } from './guard.js';
import { createRulesProvider } from './rules.js';
import { parseSimpleSlots } from './slots.js';
import { normalise, userLanguage } from './text.js';
import type { NlpfAiProvider } from './types.js';

/**
 * Phrases the sandbox landlord script uses, checked in this order. The
 * sandbox's `data/replies.json` must keep at least one phrase of the intended
 * kind in each reply (and none of an earlier kind), so demo mode and the e2e
 * tests classify every scripted reply the same way on every run.
 */
export const DEMO_PHRASES: [Intent, RegExp][] = [
  ['payment_request', /deposit before|pay the deposit first|borg vooraf|eerst de borg|borg eerst/],
  ['offer', /aanbieden|offer you|toewijzen|toegewezen|congratulations|gefeliciteerd/],
  ['listing_gone', /al verhuurd|already rented|niet meer beschikbaar|no longer available/],
  ['documents_request', /loonstro|payslip|werkgeversverklaring|employer'?s? statement/],
  ['viewing_slots', /bezichtiging|viewing/],
  ['rejection', /helaas|unfortunately/],
  ['info_request', /\?/],
];

const SUMMARY: Record<string, [string, string]> = {
  payment_request: ['Asks for a payment before anything else. Pay nothing yet.', 'Vraagt eerst om een betaling. Betaal nog niets.'],
  offer: ['Offers you the home.', 'Biedt je de woning aan.'],
  listing_gone: ['The home is no longer available.', 'De woning is niet meer beschikbaar.'],
  documents_request: ['Asks for documents.', 'Vraagt om documenten.'],
  viewing_slots: ['Offers viewing times.', 'Biedt tijden voor een bezichtiging aan.'],
  viewing_invite: ['Invites you to a viewing.', 'Nodigt je uit voor een bezichtiging.'],
  rejection: ['You were not selected for this home.', 'Je bent niet gekozen voor deze woning.'],
  info_request: ['Asks questions about you.', 'Stelt vragen over jou.'],
};

export interface DemoProviderOptions {
  profile?: Profile;
  now?: () => Date;
}

/**
 * The deterministic provider for demo mode and end-to-end tests. It never
 * calls an API: extraction, composition, replies and contract checks come
 * from the rules, and classification first tries the sandbox's fixed phrases,
 * then the rules. Its usage counts calls but never tokens.
 */
export function createDemoProvider(opts: DemoProviderOptions = {}): NlpfAiProvider {
  const rules = createRulesProvider(opts);
  let calls = 0;
  const count = <T>(p: Promise<T>) => {
    calls += 1;
    return p;
  };

  return {
    id: 'demo',
    extract: (input) => count(rules.extract(input)),
    compose: (input) => count(rules.compose(input)),
    reply: (input) => count(rules.reply(input)),
    reviewContract: (input) => count(rules.reviewContract(input)),
    async classify(input) {
      calls += 1;
      const base = await rules.classify(input);
      if (base.intent === 'scam_suspect') return base;
      const t = normalise(input.message.text);
      const hit = DEMO_PHRASES.find(([, re]) => re.test(t));
      if (!hit) return base;
      let intent = hit[0];
      const slots = intent === 'viewing_slots' ? parseSimpleSlots(input.message.text, new Date(input.now)) : [];
      if (intent === 'viewing_slots' && slots.length === 1) intent = 'viewing_invite';
      const lang = userLanguage(opts.profile?.languages);
      const out: ClassifyOutput = {
        ...base,
        intent,
        confidence: 0.95,
        slots: intent === 'viewing_slots' || intent === 'viewing_invite' ? slots : [],
        summary: SUMMARY[intent]?.[lang === 'nl' ? 1 : 0] ?? base.summary,
      };
      return finaliseClassify(out);
    },
    usage: () => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, calls }),
  };
}
