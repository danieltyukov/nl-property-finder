/*
 * Words about sources that the Sources page and the onboarding wizard share.
 */
import type { SourceView } from '../api/views';

const PLAN_NAMES: Record<string, string> = {
  'kamernet-premium': 'Kamernet Premium',
  'housinganywhere-plus': 'HousingAnywhere Plus',
  'huurwoningen-plus': 'Huurwoningen Premium',
};

export function planName(plan: string): string {
  return PLAN_NAMES[plan] ?? plan.replace(/-/g, ' ');
}

export function termsRisk(source: Pick<SourceView, 'name' | 'termsNote'>): string {
  return `${source.termsNote ?? `${source.name}'s terms forbid automated use.`} Messages the agent sends come from your own account, and ${source.name} can suspend that account. Reading public listings continues either way.`;
}
