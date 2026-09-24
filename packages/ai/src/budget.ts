import { amsterdamDate, type AiUsage, type Store } from '@nlpf/core';

export interface BudgetGuard {
  /** False once this month's spend has reached the budget. Always true without a budget. */
  canSpend(): boolean;
  /** Adds one call's usage to this month's row in `store.usage`. */
  record(u: AiUsage): void;
}

/**
 * Tokens counted against `monthlyTokenBudget`: input (including cache
 * writes) plus output, with cache reads at one tenth, which is what they cost.
 */
export function budgetTokens(u: AiUsage): number {
  return u.inputTokens + u.outputTokens + Math.ceil(u.cacheReadTokens / 10);
}

/** The usage month in Amsterdam, `YYYY-MM`. */
export function usageMonth(now: Date): string {
  return amsterdamDate(now).slice(0, 7);
}

export function createBudgetGuard(
  store: Pick<Store, 'usage'>,
  monthlyTokenBudget?: number,
  now: () => Date = () => new Date(),
): BudgetGuard {
  return {
    canSpend() {
      if (monthlyTokenBudget === undefined) return true;
      return budgetTokens(store.usage.get(usageMonth(now()))) < monthlyTokenBudget;
    },
    record(u) {
      store.usage.add(usageMonth(now()), u);
    },
  };
}

/** A guard with no budget that records nothing, for tests and one-off tools. */
export function unlimitedBudget(): BudgetGuard {
  return { canSpend: () => true, record: () => {} };
}
