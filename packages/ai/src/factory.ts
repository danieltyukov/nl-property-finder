import Anthropic from '@anthropic-ai/sdk';
import type { Config, Logger, Profile } from '@nlpf/core';
import type { BudgetGuard } from './budget.js';
import { createClaudeProvider } from './claude.js';
import { createDemoProvider } from './demo.js';
import { createRulesProvider } from './rules.js';
import type { NlpfAiProvider } from './types.js';

export interface AiFactoryOptions {
  log: Logger;
  budget: BudgetGuard;
  /** An Anthropic client to use instead of creating one (tests). */
  client?: Anthropic;
  /** The person's profile, for operations whose input carries none (classify, reviewContract). */
  profile?: Profile;
  now?: () => Date;
}

/**
 * Per-request limits for the SDK client. The agent tries to contact a new
 * listing within a minute, so a slow call gives up early and the rules answer.
 */
const CLIENT_TIMEOUT_MS = 45_000;
const CLIENT_MAX_RETRIES = 1;

/**
 * Claude when `provider` is `claude` and `secrets[cfg.keyEnv]` holds a key,
 * the demo provider for `demo`, the rules provider otherwise. Claude calls
 * fall back to rules on any error, on a refusal and once the monthly budget
 * is used up.
 */
export function createAiProvider(cfg: Config['ai'], secrets: Record<string, string>, opts: AiFactoryOptions): NlpfAiProvider {
  const common = { profile: opts.profile, now: opts.now };
  switch (cfg.provider) {
    case 'demo':
      return createDemoProvider(common);
    case 'claude': {
      const key = secrets[cfg.keyEnv]?.trim();
      if (!key) {
        opts.log.warn('AI provider is claude but no API key is set, using rules', { keyEnv: cfg.keyEnv });
        return createRulesProvider(common);
      }
      const client = opts.client ?? new Anthropic({ apiKey: key, timeout: CLIENT_TIMEOUT_MS, maxRetries: CLIENT_MAX_RETRIES });
      return createClaudeProvider({ client, cfg, log: opts.log, budget: opts.budget, ...common });
    }
    default:
      return createRulesProvider(common);
  }
}
