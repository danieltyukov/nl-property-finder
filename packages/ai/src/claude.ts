import { readFile } from 'node:fs/promises';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { z } from 'zod';
import { AiSchema, type AiUsage, type Config, type Lang, type Logger, type Profile } from '@nlpf/core';
import type { BudgetGuard } from './budget.js';
import { minimalClassify, minimalCompose, minimalContract, minimalExtract, minimalReply } from './fallbacks.js';
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
  const log = opts.log.child({ scope: 'ai' });
  const fallback = opts.fallback ?? createRulesProvider({ profile: opts.profile, now, log });
  const total: AiUsage = { ...ZERO };

  const settings = (op: Operation) => (op === 'contract' ? cfg.reply : cfg[op]);

  interface Call<S extends z.ZodType, T> {
    schema: S;
    /** Builds the request; runs inside the error handling, so a bad input falls back instead of throwing. */
    build: () => Promise<{ system: Anthropic.TextBlockParam[]; content: string | Anthropic.ContentBlockParam[] }>;
    convert: (parsed: z.infer<S>) => T;
    fallback: (reason: FallbackReason) => Promise<T>;
    /** The answer when even the fallback fails. */
    minimal: () => T;
  }

  async function run<S extends z.ZodType, T>(op: Operation, call: Call<S, T>): Promise<T> {
    const fallBack = async (reason: FallbackReason): Promise<T> => {
      try {
        return await call.fallback(reason);
      } catch (err) {
        log.error('Rules fallback failed, using a minimal answer', { op, error: err instanceof Error ? err.message : String(err) });
        return call.minimal();
      }
    };
    let allowed: boolean;
    try {
      allowed = opts.budget.canSpend();
    } catch (err) {
      log.error('Could not read the AI budget, answering from rules', { op, error: err instanceof Error ? err.message : String(err) });
      return fallBack('error');
    }
    if (!allowed) {
      log.info('AI budget for this month is used up, answering from rules', { op });
      return fallBack('budget');
    }
    const { model, effort } = settings(op);
    try {
      const { system, content } = await call.build();
      const response = await opts.client.messages.parse({
        model,
        max_tokens: MAX_TOKENS[op],
        system,
        messages: [{ role: 'user', content }],
        output_config: { effort, format: zodOutputFormat(call.schema) },
      });
      record(response.usage);
      if (response.stop_reason === 'refusal') {
        log.warn('Claude declined the request, answering from rules', { op, model, category: response.stop_details?.category ?? null });
        return fallBack('refusal');
      }
      if (response.parsed_output === null || response.parsed_output === undefined) {
        log.warn('Claude returned no structured output, answering from rules', { op, model, stopReason: response.stop_reason });
        return fallBack('invalid');
      }
      return call.convert(response.parsed_output as z.infer<S>);
    } catch (err) {
      logError(op, model, err);
      return fallBack(err instanceof Anthropic.APIError || !(err instanceof Anthropic.AnthropicError) ? 'error' : 'invalid');
    }
  }

  function record(u: Anthropic.Usage | undefined) {
    if (!u) return;
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
      log.warn('Claude output was cut off or did not match the schema, answering from rules', data);
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
      const lang = userLanguage(input?.profile?.languages);
      return run('extract', {
        schema: ExtractSchema,
        build: async () => ({ system: buildSystem(EXTRACT_INSTRUCTIONS, input.profile), content: extractRequest(input, now(), lang) }),
        convert: (p) => finaliseExtract(toExtractOutput(p)),
        fallback: async (reason) => {
          const out = await fallback.extract(input);
          return { ...out, reasons: [...out.reasons.slice(0, 7), note(reason, lang)] };
        },
        minimal: () => minimalExtract(input),
      });
    },

    async compose(input) {
      const lang = userLanguage(input?.profile?.languages);
      return run('compose', {
        schema: ComposeSchema,
        build: async () => ({ system: buildSystem(COMPOSE_INSTRUCTIONS, input.profile), content: composeRequest(input, now()) }),
        convert: (p) => finaliseMessage(toComposeOutput(p), input),
        fallback: async (reason) => {
          const out = await fallback.compose(input);
          return { ...out, rationale: `${out.rationale} ${messageNote(reason, lang)}` };
        },
        minimal: () => minimalCompose(input),
      });
    },

    async classify(input) {
      const lang = userLanguage(opts.profile?.languages);
      return run('classify', {
        schema: ClassifySchema,
        build: async () => ({ system: buildSystem(CLASSIFY_INSTRUCTIONS, opts.profile), content: classifyRequest(input, lang) }),
        convert: (p) => finaliseClassify(toClassifyOutput(p)),
        fallback: () => fallback.classify(input),
        minimal: minimalClassify,
      });
    },

    async reply(input) {
      const lang = userLanguage(input?.profile?.languages);
      return run('reply', {
        schema: ReplySchema,
        build: async () => ({ system: buildSystem(REPLY_INSTRUCTIONS, input.profile), content: replyRequest(input, now()) }),
        convert: (p) => finaliseMessage(toReplyOutput(p), input),
        fallback: async (reason) => {
          const out = await fallback.reply(input);
          return { ...out, rationale: `${out.rationale} ${messageNote(reason, lang)}` };
        },
        minimal: () => minimalReply(input),
      });
    },

    async reviewContract(input) {
      return run('contract', {
        schema: ContractSchema,
        build: async () => {
          // A PDF that cannot be read makes the call fall back to the rules on the text, like any other failure.
          const pdf = input.pdfPath ? (await readFile(input.pdfPath)).toString('base64') : undefined;
          const text = contractRequest(input, Boolean(pdf));
          const content: string | Anthropic.ContentBlockParam[] = pdf
            ? [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf } }, { type: 'text', text }]
            : text;
          return { system: buildSystem(CONTRACT_INSTRUCTIONS, opts.profile), content };
        },
        convert: (p) => finaliseContract(toContractReview(p)),
        fallback: () => fallback.reviewContract(input),
        minimal: () => minimalContract(input?.language),
      });
    },

    usage: () => ({ ...total }),
  };
}
