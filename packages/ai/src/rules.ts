import type { AiUsage, Logger, Profile } from '@nlpf/core';
import { minimalClassify, minimalCompose, minimalContract, minimalExtract, minimalReply } from './fallbacks.js';
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
  /** Where an unexpected failure is reported before the minimal answer is used. */
  log?: Logger;
}

const ZERO: AiUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, calls: 0 };

/**
 * The provider every user has without an API key: keyword extraction and
 * scoring, template composition, phrase-list classification, profile-based
 * replies and a contract checklist. Deterministic and offline. It spends no
 * tokens, so `usage()` stays at zero. It never throws: an input the rules
 * cannot handle gets a minimal, cautious answer.
 */
export function createRulesProvider(opts: RulesProviderOptions = {}): NlpfAiProvider {
  const now = () => {
    const d = opts.now?.() ?? new Date();
    return Number.isNaN(d.getTime()) ? new Date() : d;
  };
  const safe = <T>(op: string, fn: () => T, minimal: () => T): Promise<T> => {
    try {
      return Promise.resolve(fn());
    } catch (err) {
      opts.log?.error('Rules provider failed, using a minimal answer', { op, error: err instanceof Error ? err.message : String(err) });
      return Promise.resolve(minimal());
    }
  };
  return {
    id: 'rules',
    extract: (input) => safe('extract', () => finaliseExtract(rulesExtract(input, now())), () => minimalExtract(input)),
    compose: (input) => safe('compose', () => finaliseMessage(rulesCompose(input), input), () => minimalCompose(input)),
    classify: (input) => safe('classify', () => finaliseClassify(rulesClassify(input, userLanguage(opts.profile?.languages))), minimalClassify),
    reply: (input) => safe('reply', () => finaliseMessage(rulesReply(input), input), () => minimalReply(input)),
    reviewContract: (input) => safe('reviewContract', () => finaliseContract(reviewContractRules(input)), () => minimalContract(input?.language)),
    usage: () => ({ ...ZERO }),
  };
}
