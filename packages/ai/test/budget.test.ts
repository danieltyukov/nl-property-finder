import { describe, expect, it } from 'vitest';
import { AiSchema, memoryLogger, openStore } from '@nlpf/core';
import { budgetTokens, createBudgetGuard, usageMonth } from '../src/budget.js';
import { createAiProvider } from '../src/factory.js';
import { createRulesProvider } from '../src/rules.js';
import { fakeClient } from './fake-client.js';
import { NOW, makeListing, makeProfile, makeSearch } from './helpers.js';

const now = () => new Date(NOW);

describe('budget guard', () => {
  it('stops spending once this month reaches the budget', () => {
    const store = openStore(':memory:');
    const guard = createBudgetGuard(store, 1000, now);
    expect(guard.canSpend()).toBe(true);
    guard.record({ inputTokens: 500, outputTokens: 300, cacheReadTokens: 1000, calls: 1 });
    expect(guard.canSpend()).toBe(true);
    guard.record({ inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, calls: 1 });
    expect(guard.canSpend()).toBe(false);
    expect(store.usage.get('2026-09')).toEqual({ inputTokens: 600, outputTokens: 350, cacheReadTokens: 1000, calls: 2 });
  });

  it('counts cache reads at a tenth and starts again the next month', () => {
    expect(budgetTokens({ inputTokens: 10, outputTokens: 5, cacheReadTokens: 1000, calls: 1 })).toBe(115);
    const store = openStore(':memory:');
    let at = new Date('2026-09-30T20:00:00.000Z');
    const guard = createBudgetGuard(store, 100, () => at);
    guard.record({ inputTokens: 200, outputTokens: 0, cacheReadTokens: 0, calls: 1 });
    expect(guard.canSpend()).toBe(false);
    // 22:30 UTC on 30 September is already 1 October in Amsterdam.
    at = new Date('2026-09-30T22:30:00.000Z');
    expect(usageMonth(at)).toBe('2026-10');
    expect(guard.canSpend()).toBe(true);
  });

  it('always allows spending without a budget', () => {
    const guard = createBudgetGuard(openStore(':memory:'), undefined, now);
    guard.record({ inputTokens: 10_000_000, outputTokens: 0, cacheReadTokens: 0, calls: 1 });
    expect(guard.canSpend()).toBe(true);
  });

  it('makes the factory provider answer from rules after the budget is used up', async () => {
    const store = openStore(':memory:');
    const budget = createBudgetGuard(store, 500, now);
    const client = fakeClient(() => ({
      requirements: {
        incomeMultiple: null, minIncomeEur: null, registrationAllowed: null, studentsAllowed: null, sharingAllowed: null, contract: 'unknown',
        minMonths: null, maxMonths: null, petsAllowed: null, smokingAllowed: null, genderRestriction: null, ageMin: null, ageMax: null, guarantorAccepted: null, notes: [],
      },
      score: 99, reasons: ['From Claude.'], scamSignals: [], language: 'nl', summary: 'From Claude.',
    }));
    const provider = createAiProvider(AiSchema.parse({ provider: 'claude', monthlyTokenBudget: 500 }), { ANTHROPIC_API_KEY: 'sk-test' }, {
      log: memoryLogger(), budget, client: client.asAnthropic(), now,
    });
    const input = { listing: makeListing(), profile: makeProfile(), search: makeSearch() };

    const first = await provider.extract(input);
    expect(first.score).toBe(99);
    expect(client.calls).toHaveLength(1);
    expect(budget.canSpend()).toBe(true);           // 120 + 80 + 900 / 10 = 290 of 500

    budget.record({ inputTokens: 300, outputTokens: 0, cacheReadTokens: 0, calls: 0 });
    expect(budget.canSpend()).toBe(false);
    const second = await provider.extract(input);
    expect(client.calls).toHaveLength(1);
    const rules = await createRulesProvider({ now }).extract(input);
    expect(second.score).toBe(rules.score);
    expect(second.requirements).toEqual(rules.requirements);
  });
});
