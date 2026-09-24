import type { AiUsage, Profile } from '@nlpf/core';
import { finaliseClassify, finaliseContract, finaliseExtract, finaliseMessage } from './guard.js';
import { rulesClassify } from './rules/classify.js';
import { rulesCompose } from './rules/compose.js';
import { reviewContractRules } from './rules/contract.js';
import { rulesExtract } from './rules/extract.js';
import { rulesReply } from './rules/reply.js';
import { userLanguage } from './text.js';
import type { NlpfAiProvider } from './types.js';

export interface RulesProviderOptions {
  /** Used for the language of classification summaries, which have no profile in their input. */
  profile?: Profile;
  now?: () => Date;
}

const ZERO: AiUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, calls: 0 };

/**
 * The provider every user has without an API key: keyword extraction and
 * scoring, template composition, phrase-list classification, profile-based
 * replies and a contract checklist. Deterministic and offline. It spends no
 * tokens, so `usage()` stays at zero.
 */
export function createRulesProvider(opts: RulesProviderOptions = {}): NlpfAiProvider {
  const now = opts.now ?? (() => new Date());
  return {
    id: 'rules',
    async extract(input) {
      return finaliseExtract(rulesExtract(input, now()));
    },
    async compose(input) {
      return finaliseMessage(rulesCompose(input), input);
    },
    async classify(input) {
      return finaliseClassify(rulesClassify(input, userLanguage(opts.profile?.languages)));
    },
    async reply(input) {
      return finaliseMessage(rulesReply(input), input);
    },
    async reviewContract(input) {
      return finaliseContract(reviewContractRules(input));
    },
    usage: () => ({ ...ZERO }),
  };
}
