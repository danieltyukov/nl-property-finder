/*
 * Words about sources that the Sources page and the onboarding wizard share.
 */
import type { SourceConfig } from '@nlpf/core';
import type { SourceView } from '../api/views';

/*
 * Platforms whose terms forbid automated access (spec, "Platform terms"). The
 * daemon's /sources should say this through each adapter's capabilities; this
 * list is the fallback so the opt-in never silently disappears.
 */
const KNOWN_FORBIDS: Record<string, string> = {
  funda: "Funda's terms forbid automated use of the site.",
  kamernet: "Kamernet's terms forbid automated access and messaging.",
  pararius: "Pararius's terms forbid scraping and automated messages.",
  huurwoningen: "Huurwoningen's terms forbid automated access.",
  housinganywhere: "HousingAnywhere's terms forbid automated messaging.",
  marktplaats: "Marktplaats's terms forbid automated access and messages.",
  vesteda: "Vesteda's terms forbid automated use of Mijn Vesteda.",
  holland2stay: "Holland2Stay's terms forbid automated bookings.",
};

export function termsOf(source: Pick<SourceView, 'sourceId' | 'capabilities'>): 'allows' | 'forbids' | 'unknown' {
  return source.capabilities?.terms ?? (KNOWN_FORBIDS[source.sourceId] ? 'forbids' : 'unknown');
}

export function termsNoteOf(source: Pick<SourceView, 'sourceId' | 'termsNote'>): string | undefined {
  return source.termsNote ?? KNOWN_FORBIDS[source.sourceId];
}

/**
 * The contact mode in effect: what the daemon reports, else the user's
 * choice in config, else the rule from the plan (automatic unless the
 * platform's terms forbid it).
 */
export function contactModeOf(source: SourceView, config?: Partial<SourceConfig>): 'auto' | 'watch_only' {
  if (source.contactMode) return source.contactMode;
  if (config?.contact) return config.contact;
  if (source.health === 'watch_only') return 'watch_only';
  return termsOf(source) === 'forbids' ? 'watch_only' : 'auto';
}

const PLAN_NAMES: Record<string, string> = {
  'kamernet-premium': 'Kamernet Premium',
  'housinganywhere-plus': 'HousingAnywhere Plus',
  'huurwoningen-plus': 'Huurwoningen Premium',
};

export function planName(plan: string): string {
  return PLAN_NAMES[plan] ?? plan.replace(/-/g, ' ');
}

export function termsRisk(source: Pick<SourceView, 'sourceId' | 'name' | 'termsNote'>): string {
  return `${termsNoteOf(source) ?? `${source.name}'s terms forbid automated use.`} Messages the agent sends come from your own account, and ${source.name} can suspend that account. Reading public listings continues either way.`;
}
