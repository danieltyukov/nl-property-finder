import { readFile } from 'node:fs/promises';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { z } from 'zod';
import { AiSchema, type AiUsage, type Config, type Lang, type Logger, type Profile } from '@nlpf/core';
import type { BudgetGuard } from './budget.js';
import { finaliseClassify, finaliseContract, finaliseExtract, finaliseMessage } from './guard.js';
import { CLASSIFY_INSTRUCTIONS, classifyRequest } from './prompts/classify.js';
import { COMPOSE_INSTRUCTIONS, composeRequest } from './prompts/compose.js';
import { CONTRACT_INSTRUCTIONS, contractRequest } from './prompts/contract.js';
import { EXTRACT_INSTRUCTIONS, extractRequest } from './prompts/extract.js';
import { REPLY_INSTRUCTIONS, replyRequest } from './prompts/reply.js';
import { buildSystem } from './prompts/system.js';
import { createRulesProvider } from './rules.js';
import {
  ClassifySchema, ComposeSchema, ContractSchema, ExtractSchema, ReplySchema,
  toClassifyOutput, toComposeOutput, toContractReview, toExtractOutput, toReplyOutput,
} from './schemas.js';
import { userLanguage } from './text.js';
import type { NlpfAiProvider } from './types.js';

type Operation = 'extract' | 'compose' | 'classify' | 'reply' | 'contract';
type FallbackReason = 'budget' | 'error' | 'refusal' | 'invalid';

const MAX_TOKENS: Record<Operation, number> = { extract: 1024, classify: 1024, compose: 2048, reply: 2048, contract: 4096 };

export interface ClaudeProviderOptions {
  client: Anthropic;
  cfg?: Config['ai'];
  log: Logger;
  budget: BudgetGuard;
  /** Answers when Claude cannot. Defaults to the rules provider. */
  fallback?: NlpfAiProvider;
  /** The person's profile for operations whose input has none (classify, reviewContract). */
  profile?: Profile;
  now?: () => Date;
}

const ZERO: AiUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, calls: 0 };

/**
 * Claude through the official SDK with structured outputs. Every call is
 * wrapped: when the budget is used up, the API fails, the model refuses or
 * the output does not match the schema, the call is logged and answered by
 * the fallback (rules), so callers never see an AI exception.
 */
export function createClaudeProvider(opts: ClaudeProviderOptions): NlpfAiProvider {
  const cfg = opts.cfg ?? AiSchema.parse({});
  const now = opts.now ?? (() => new Date());
  const fallback = opts.fallback ?? createRulesProvider({ profile: opts.profile, now });
  const log = opts.log.child({ scope: 'ai' });
  const total: AiUsage = { ...ZERO };

  const settings = (op: Operation) => (op === 'contract' ? cfg.reply : cfg[op]);

  async function run<S extends z.ZodType, T>(
    op: Operation,
    schema: S,
    system: Anthropic.TextBlockParam[],
    content: string | Anthropic.ContentBlockParam[],
    convert: (parsed: z.infer<S>) => T,
    onFallback: (reason: FallbackReason) => Promise<T>,
  ): Promise<T> {
    if (!opts.budget.canSpend()) {
      log.info('AI budget for this month is used up, answering from rules', { op });
      return onFallback('budget');
    }
    const { model, effort } = settings(op);
    try {
      const response = await opts.client.messages.parse({
        model,
        max_tokens: MAX_TOKENS[op],
        system,
        messages: [{ role: 'user', content }],
        output_config: { effort, format: zodOutputFormat(schema) },
      });
      record(response.usage);
      if (response.stop_reason === 'refusal') {
        log.warn('Claude declined the request, answering from rules', { op, model, category: response.stop_details?.category ?? null });
        return onFallback('refusal');
      }
      if (response.parsed_output === null || response.parsed_output === undefined) {
        log.warn('Claude returned no structured output, answering from rules', { op, model, stopReason: response.stop_reason });
        return onFallback('invalid');
      }
      return convert(response.parsed_output as z.infer<S>);
    } catch (err) {
      logError(op, model, err);
      return onFallback(err instanceof Anthropic.APIError || !(err instanceof Anthropic.AnthropicError) ? 'error' : 'invalid');
    }
  }

  function record(u: Anthropic.Usage) {
    const usage: AiUsage = {
      inputTokens: u.input_tokens + (u.cache_creation_input_tokens ?? 0),
      outputTokens: u.output_tokens,
      cacheReadTokens: u.cache_read_input_tokens ?? 0,
      calls: 1,
    };
    total.inputTokens += usage.inputTokens;
    total.outputTokens += usage.outputTokens;
    total.cacheReadTokens += usage.cacheReadTokens;
    total.calls += 1;
    try {
      opts.budget.record(usage);
    } catch (err) {
      log.error('Could not record AI usage', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  function logError(op: Operation, model: string, err: unknown) {
    const data = {
      op,
      model,
      status: err instanceof Anthropic.APIError ? err.status ?? null : null,
      requestId: err instanceof Anthropic.APIError ? err.requestID ?? null : null,
      error: err instanceof Error ? err.message.slice(0, 300) : String(err),
    };
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
      log.error('Claude rejected the API key, answering from rules', data);
    } else if (err instanceof Anthropic.RateLimitError) {
      log.warn('Claude is rate limiting, answering from rules', data);
    } else if (err instanceof Anthropic.BadRequestError || err instanceof Anthropic.NotFoundError || err instanceof Anthropic.UnprocessableEntityError) {
      log.error('Claude rejected the request, answering from rules', data);
    } else if (err instanceof Anthropic.APIConnectionError || err instanceof Anthropic.InternalServerError) {
      log.warn('Claude is unreachable or overloaded, answering from rules', data);
    } else if (err instanceof Anthropic.APIError) {
      log.warn('Claude API error, answering from rules', data);
    } else if (err instanceof Anthropic.AnthropicError) {
      log.warn('Claude output did not match the schema, answering from rules', data);
    } else {
      log.error('Unexpected error in the Claude provider, answering from rules', data);
    }
  }

  const note = (reason: FallbackReason, lang: Lang) => {
    const why = {
      budget: ['the monthly AI budget is used up', 'het maandbudget voor AI is op'],
      error: ['the AI call failed', 'de AI-aanroep mislukte'],
      refusal: ['the AI declined this request', 'de AI weigerde dit verzoek'],
      invalid: ['the AI answer was unusable', 'het AI-antwoord was onbruikbaar'],
    }[reason];
    return lang === 'nl' ? `Beoordeeld met regels: ${why[1]}.` : `Scored by rules: ${why[0]}.`;
  };
  const messageNote = (reason: FallbackReason, lang: Lang) =>
    lang === 'nl' ? note(reason, lang).replace('Beoordeeld met regels', 'Geschreven met regels') : note(reason, lang).replace('Scored by rules', 'Written by rules');

  return {
    id: 'claude',

    async extract(input) {
      const lang = userLanguage(input.profile.languages);
      return run('extract', ExtractSchema, buildSystem(EXTRACT_INSTRUCTIONS, input.profile), extractRequest(input, now(), lang),
        (p) => finaliseExtract(toExtractOutput(p)),
        async (reason) => {
          const out = await fallback.extract(input);
          return { ...out, reasons: [...out.reasons.slice(0, 7), note(reason, lang)] };
        });
    },

    async compose(input) {
      const lang = userLanguage(input.profile.languages);
      return run('compose', ComposeSchema, buildSystem(COMPOSE_INSTRUCTIONS, input.profile), composeRequest(input, now()),
        (p) => finaliseMessage(toComposeOutput(p), input),
        async (reason) => {
          const out = await fallback.compose(input);
          return { ...out, rationale: `${out.rationale} ${messageNote(reason, lang)}` };
        });
    },

    async classify(input) {
      const lang = userLanguage(opts.profile?.languages);
      return run('classify', ClassifySchema, buildSystem(CLASSIFY_INSTRUCTIONS, opts.profile), classifyRequest(input, lang),
        (p) => finaliseClassify(toClassifyOutput(p)),
        () => fallback.classify(input));
    },

    async reply(input) {
      const lang = userLanguage(input.profile.languages);
      return run('reply', ReplySchema, buildSystem(REPLY_INSTRUCTIONS, input.profile), replyRequest(input, now()),
        (p) => finaliseMessage(toReplyOutput(p), input),
        async (reason) => {
          const out = await fallback.reply(input);
          return { ...out, rationale: `${out.rationale} ${messageNote(reason, lang)}` };
        });
    },

    async reviewContract(input) {
      let content: string | Anthropic.ContentBlockParam[];
      try {
        const pdf = input.pdfPath ? (await readFile(input.pdfPath)).toString('base64') : undefined;
        const text = contractRequest(input, Boolean(pdf));
        content = pdf
          ? [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf } }, { type: 'text', text }]
          : text;
      } catch (err) {
        log.warn('Could not read the contract PDF, answering from rules', { error: err instanceof Error ? err.message : String(err) });
        return fallback.reviewContract(input);
      }
      return run('contract', ContractSchema, buildSystem(CONTRACT_INSTRUCTIONS, opts.profile), content,
        (p) => finaliseContract(toContractReview(p)),
        () => fallback.reviewContract(input));
    },

    usage: () => ({ ...total }),
  };
}
