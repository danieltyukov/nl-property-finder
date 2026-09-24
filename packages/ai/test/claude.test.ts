import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { AiSchema, memoryLogger, type AiUsage } from '@nlpf/core';
import type { BudgetGuard } from '../src/budget.js';
import { createClaudeProvider } from '../src/claude.js';
import { createRulesProvider } from '../src/rules.js';
import { fakeClient, type FakeResult } from './fake-client.js';
import { NOW, makeListing, makeMessage, makeProfile, makeSearch } from './helpers.js';

const cfg = AiSchema.parse({
  provider: 'claude',
  extract: { model: 'claude-opus-5', effort: 'low' },
  compose: { model: 'claude-sonnet-5', effort: 'high' },
  classify: { model: 'claude-opus-5', effort: 'low' },
  reply: { model: 'claude-opus-5', effort: 'medium' },
});

const cannedExtract = {
  requirements: {
    incomeMultiple: 3, minIncomeEur: null, registrationAllowed: true, studentsAllowed: null, sharingAllowed: null,
    contract: 'indefinite', minMonths: null, maxMonths: null, petsAllowed: false, smokingAllowed: null,
    genderRestriction: null, ageMin: null, ageMax: null, guarantorAccepted: null, notes: ['Energy label A'],
  },
  score: 82,
  reasons: ['Rent is within budget.', 'Registration is possible.'],
  scamSignals: [],
  language: 'nl',
  summary: 'Bright apartment in the centre of Delft.',
};
const cannedCompose = { subject: 'Interesse in Oude Delft 12A', body: 'Beste verhuurder,\n\nGraag kom ik kijken.\n\nMet vriendelijke groet,\nSam de Vries', rationale: 'Short and factual.' };
const cannedClassify = {
  intent: 'viewing_invite', confidence: 0.92,
  slots: [{ start: '2026-09-24T18:30:00+02:00', end: null, text: 'donderdag om 18:30', certain: true }],
  questions: [], documents: [], deadline: null, addressMention: 'Oude Delft 12A', summary: 'Invites you to a viewing on Thursday.',
};
const cannedReply = { subject: 'Re: Oude Delft 12A', body: 'Beste Jan,\n\nIk ben promovendus.\n\nMet vriendelijke groet,\nSam de Vries', unanswerable: [], rationale: 'Answered from the profile.' };

function recordingBudget(canSpend = true): BudgetGuard & { recorded: AiUsage[] } {
  const recorded: AiUsage[] = [];
  return { recorded, canSpend: () => canSpend, record: (u) => void recorded.push(u) };
}

function setup(handler: (op: string) => FakeResult, budget = recordingBudget()) {
  const client = fakeClient((params) => handler(opOf(params.system)));
  const log = memoryLogger();
  const provider = createClaudeProvider({ client: client.asAnthropic(), cfg, log, budget, now: () => new Date(NOW) });
  return { client, log, provider, budget };
}

function opOf(system: unknown): string {
  const text = JSON.stringify(system);
  return /Operation: (\w+)/.exec(text)?.[1] ?? 'unknown';
}

const canned = (op: string): FakeResult =>
  ({ extract: cannedExtract, compose: cannedCompose, classify: cannedClassify, reply: cannedReply })[op] ?? new Error(`no canned output for ${op}`);

const extractInput = () => ({ listing: makeListing(), profile: makeProfile(), search: makeSearch() });
const composeInput = () => ({ listing: makeListing(), profile: makeProfile(), template: '', language: 'nl' as const, channel: 'email' as const });

describe('Claude provider', () => {
  it('passes the configured model, effort and token limit for each operation', async () => {
    const { client, provider } = setup(canned);
    await provider.extract(extractInput());
    await provider.compose(composeInput());
    const [extract, compose] = client.calls;
    expect(extract).toMatchObject({ model: 'claude-opus-5', max_tokens: 1024, output_config: { effort: 'low' } });
    expect(compose).toMatchObject({ model: 'claude-sonnet-5', max_tokens: 2048, output_config: { effort: 'high' } });
    expect(extract?.output_config?.format).toBeDefined();
  });

  it('sends no thinking budget and no assistant prefill', async () => {
    const { client, provider } = setup(canned);
    await provider.extract(extractInput());
    const params = client.calls[0] as unknown as Record<string, unknown> & { messages: { role: string }[] };
    expect(params.thinking).toBeUndefined();
    expect(params.messages.at(-1)?.role).toBe('user');
  });

  it('caches a stable system prompt that holds the profile, with the date in the user turn', async () => {
    const { client, provider } = setup(canned);
    await provider.extract(extractInput());
    await provider.extract({ ...extractInput(), listing: makeListing({ id: 'huisje:2', title: 'Another home' }) });
    const [a, b] = client.calls;
    const system = a?.system as Anthropic.TextBlockParam[];
    expect(Array.isArray(system)).toBe(true);
    expect(system.at(-1)?.cache_control).toEqual({ type: 'ephemeral' });
    const systemText = system.map((s) => s.text).join('\n');
    expect(systemText).toContain('"firstName": "Sam"');
    expect(systemText).not.toContain('23 September 2026');
    expect(systemText).not.toContain(NOW);
    expect(JSON.stringify(b?.system)).toBe(JSON.stringify(a?.system));
    expect(JSON.stringify(a?.messages)).toContain('23 September 2026');
  });

  it('records usage, including cache reads, with the budget and in usage()', async () => {
    const { provider, budget } = setup(canned);
    await provider.extract(extractInput());
    await provider.classify({ message: makeMessage('Kunt u donderdag om 18:30?'), now: NOW });
    expect(budget.recorded[0]).toEqual({ inputTokens: 120, outputTokens: 80, cacheReadTokens: 900, calls: 1 });
    expect(provider.usage()).toEqual({ inputTokens: 240, outputTokens: 160, cacheReadTokens: 1800, calls: 2 });
  });

  it('maps structured output to the contract types', async () => {
    const { provider } = setup(canned);
    const out = await provider.extract(extractInput());
    expect(out.score).toBe(82);
    expect(out.requirements).toEqual({ incomeMultiple: 3, registrationAllowed: true, contract: 'indefinite', petsAllowed: false, notes: ['Energy label A'] });
    const cls = await provider.classify({ message: makeMessage('Kunt u donderdag om 18:30?'), now: NOW });
    expect(cls.slots).toEqual([{ start: '2026-09-24T16:30:00.000Z', text: 'donderdag om 18:30', certain: true }]);
    expect(cls.deadline).toBeUndefined();
    const reply = await provider.reply({
      message: makeMessage('Wat voor werk doet u?'), classification: cls, profile: makeProfile(), language: 'nl', purpose: 'answer',
    });
    expect(reply.body).toContain('promovendus');
  });

  it('keeps model output to the copy rules and the length limit', async () => {
    const long = { ...cannedCompose, body: `Beste verhuurder,\n\nIk kom graag kijken \u2014 echt waar \u{1F60A}.\n\n${'Extra zin. '.repeat(80)}\n\nMet vriendelijke groet,\nSam de Vries` };
    const { provider } = setup((op) => (op === 'compose' ? long : canned(op)));
    const out = await provider.compose({ ...composeInput(), maxChars: 300 });
    expect(out.body.length).toBeLessThanOrEqual(300);
    expect(out.body).not.toMatch(/[\u2014\u{1F60A}]/u);
    expect(out.body).toContain('kijken, echt waar');
  });

  it('answers from rules when the API rate-limits', async () => {
    const err = new Anthropic.RateLimitError(429, { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } }, 'slow down', new Headers());
    const { provider, log, budget } = setup(() => err);
    const rules = createRulesProvider({ now: () => new Date(NOW) });
    const input = extractInput();
    const out = await provider.extract(input);
    const expected = await rules.extract(input);
    expect(out.requirements).toEqual(expected.requirements);
    expect(out.score).toBe(expected.score);
    expect(out.reasons.at(-1)).toMatch(/rules/i);
    expect(log.entries.some((e) => e.lvl === 'warn' && /rules/.test(e.msg))).toBe(true);
    expect(budget.recorded).toEqual([]);
    const composed = await provider.compose(composeInput());
    expect(composed.body).toEqual((await rules.compose(composeInput())).body);
  });

  it('answers from rules on server, connection and authentication errors', async () => {
    const errors = [
      new Anthropic.InternalServerError(529, { type: 'error', error: { type: 'overloaded_error', message: 'overloaded' } }, 'overloaded', new Headers()),
      new Anthropic.APIConnectionError({ message: 'socket hang up' }),
      new Anthropic.AuthenticationError(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 'invalid x-api-key', new Headers()),
      new TypeError('something unexpected'),
    ];
    for (const err of errors) {
      const { provider, log } = setup(() => err);
      const out = await provider.classify({ message: makeMessage('Helaas is de woning al verhuurd.'), now: NOW });
      expect(out.intent).toBe('listing_gone');
      expect(log.entries.length).toBeGreaterThan(0);
    }
  });

  it('answers from rules when the model refuses', async () => {
    const { provider, budget } = setup(() => ({ parsed_output: null, stop_reason: 'refusal' }));
    const out = await provider.classify({ message: makeMessage('Graag eerst de borg overmaken.'), now: NOW });
    expect(out.intent).toBe('payment_request');
    expect(budget.recorded).toHaveLength(1);
  });

  it('answers from rules when the output does not match the schema', async () => {
    const { provider } = setup(() => ({ intent: 'something_else' }));
    const out = await provider.classify({ message: makeMessage('Kunt u uw loonstroken sturen?'), now: NOW });
    expect(out.intent).toBe('documents_request');
  });

  it('does not call the API when the budget is used up', async () => {
    const { client, provider } = setup(canned, recordingBudget(false));
    const out = await provider.extract(extractInput());
    expect(client.calls).toHaveLength(0);
    expect(out.reasons.at(-1)).toMatch(/budget/i);
  });

  it('puts the known profile in the classify system prompt when one is given', async () => {
    const client = fakeClient(() => cannedClassify);
    const provider = createClaudeProvider({
      client: client.asAnthropic(), cfg, log: memoryLogger(), budget: recordingBudget(), profile: makeProfile({ languages: ['nl'] }),
    });
    await provider.classify({ message: makeMessage('Kunt u donderdag?'), now: NOW });
    expect(JSON.stringify(client.calls[0]?.system)).toContain('Sam');
    expect(JSON.stringify(client.calls[0]?.messages)).toContain('Summary language: Dutch');
  });
});
