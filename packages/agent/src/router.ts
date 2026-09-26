import type { Channel, Config, Listing, SourceAdapter, SourceConfig } from '@nlpf/core';

/** The part of the sources registry the router needs (Task 4's registry satisfies it). */
export interface AdapterRegistry {
  get(id: string): SourceAdapter | undefined;
}

export type ContactPlan =
  | { plan: 'send'; channel: Channel; via: Listing }
  | { plan: 'manual'; reason: string }
  | { plan: 'watch'; reason: string };

/**
 * The user's explicit per-source choice wins. Otherwise a platform whose
 * terms forbid automated access is watch-only and every other one is auto.
 */
export function effectiveContactMode(
  adapter: SourceAdapter,
  source: SourceConfig | undefined,
): 'auto' | 'watch_only' {
  if (source?.contact) return source.contact;
  return adapter.capabilities.terms === 'forbids' ? 'watch_only' : 'auto';
}

type Blocked =
  | { why: 'paid'; adapter: SourceAdapter; plan: string }
  | { why: 'watch'; adapter: SourceAdapter; explicit: boolean }
  | { why: 'booking' | 'lottery'; adapter: SourceAdapter }
  | { why: 'none' };

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$/i;

function agentEmail(l: Listing): string | undefined {
  const raw = l.agent?.email ?? (typeof l.extra?.email === 'string' ? l.extra.email : undefined);
  const e = raw?.trim().toLowerCase();
  return e && EMAIL.test(e) ? e : undefined;
}

/**
 * Whether reacting on this listing needs a paid plan the user has not set.
 * Adapters mark exceptions per listing: `extra.isReactForFree` (Kamernet) or
 * `extra.paid: false` lifts the source's paywall; `extra.paid: true` or
 * `extra.paidPlan` puts one listing behind a paywall on an otherwise free source.
 */
function paywall(l: Listing, adapter: SourceAdapter, source: SourceConfig | undefined): string | undefined {
  if (source?.paidPlan) return undefined;
  const extra = l.extra ?? {};
  if (extra.isReactForFree === true || extra.paid === false) return undefined;
  if (typeof extra.paidPlan === 'string') return extra.paidPlan;
  if (extra.paid === true) return adapter.capabilities.paid?.plan ?? 'a paid plan';
  const paid = adapter.capabilities.paid;
  return paid?.feature === 'contact' ? paid.plan : undefined;
}

/** "kamernet-premium" on Kamernet reads "Kamernet Premium". */
function planLabel(adapter: SourceAdapter, plan: string): string {
  const rest = plan.startsWith(`${adapter.id}-`) ? plan.slice(adapter.id.length + 1) : plan;
  const words = rest
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  return `${adapter.name} ${words.join(' ')}`.trim();
}

/**
 * The landlord's own portal first (its applications are the ones it
 * processes), then fastest first: a guest form, a form after login, a
 * platform message, then email.
 */
function rank(method: string, adapter: SourceAdapter): number {
  if (adapter.capabilities.landlordPortal && (method === 'form' || method === 'message')) return -1;
  if (method === 'form') return adapter.capabilities.login === 'required' ? 1 : 0;
  if (method === 'message') return 2;
  return 3;
}

/**
 * The channel router and paywall router. Looks at every active listing of
 * the property (the cluster) and picks the fastest channel on a source that
 * is automated, enabled and not behind a paywall the user has not paid for.
 * Without one, an agent email from any listing in the cluster is used. If
 * nothing is left, the plan says why: `watch` when a watch-only source is the
 * only way in, otherwise `manual` with a reason for the React manually task.
 */
export function planContact(
  listing: Listing,
  all: Listing[],
  registry: AdapterRegistry,
  config: Config,
): ContactPlan {
  const seen = new Set<string>();
  const cluster = [listing, ...all].filter(
    (l) => l.state !== 'gone' && !seen.has(l.id) && (seen.add(l.id), true),
  );

  let best: { rank: number; channel: Channel; via: Listing } | undefined;
  const blocked: Blocked[] = [];

  for (const l of cluster) {
    const adapter = registry.get(l.sourceId);
    const source = config.sources[l.sourceId];
    if (!adapter || source?.enabled === false) {
      blocked.push({ why: 'none' });
      continue;
    }
    const method = l.contact;
    if (method === 'booking' || method === 'lottery') {
      blocked.push({ why: method, adapter });
      continue;
    }
    const address = method === 'email' ? agentEmail(l) : undefined;
    const reachable =
      method === 'form' || method === 'message' ? typeof adapter.contact === 'function' : !!address;
    if (!reachable) {
      blocked.push({ why: 'none' });
      continue;
    }
    const plan = paywall(l, adapter, source);
    if (plan) {
      blocked.push({ why: 'paid', adapter, plan });
      continue;
    }
    if (effectiveContactMode(adapter, source) !== 'auto') {
      blocked.push({ why: 'watch', adapter, explicit: source?.contact === 'watch_only' });
      continue;
    }
    const r = rank(method, adapter);
    if (!best || r < best.rank) {
      const channel: Channel = address
        ? { kind: 'email', sourceId: l.sourceId, listingId: l.id, address }
        : {
            kind: method as 'form' | 'message',
            sourceId: l.sourceId,
            listingId: l.id,
            url: l.contactUrl ?? l.url,
          };
      best = { rank: r, channel, via: l };
    }
  }
  if (best) return { plan: 'send', channel: best.channel, via: best.via };

  // Emailing the agent directly does not go through the platform, so a
  // platform's terms do not block it. A source the user set to watch-only does.
  for (const l of cluster) {
    const address = agentEmail(l);
    const source = config.sources[l.sourceId];
    if (address && source?.enabled !== false && source?.contact !== 'watch_only') {
      return {
        plan: 'send',
        channel: { kind: 'email', sourceId: l.sourceId, listingId: l.id, address },
        via: l,
      };
    }
  }

  const watch = blocked.find((b): b is Extract<Blocked, { why: 'watch' }> => b.why === 'watch');
  if (watch) {
    return {
      plan: 'watch',
      reason: watch.explicit
        ? `${watch.adapter.name} is set to watch-only`
        : `${watch.adapter.name} is watch-only: its terms forbid automated messages and you have not opted in`,
    };
  }
  const paid = blocked.find((b): b is Extract<Blocked, { why: 'paid' }> => b.why === 'paid');
  if (paid)
    return {
      plan: 'manual',
      reason: `${planLabel(paid.adapter, paid.plan)} needed and no free copy of this home was found`,
    };
  const booking = blocked.find(
    (b): b is Extract<Blocked, { why: 'booking' | 'lottery' }> => b.why === 'booking' || b.why === 'lottery',
  );
  if (booking) {
    return {
      plan: 'manual',
      reason:
        booking.why === 'booking'
          ? `${booking.adapter.name} needs a booking made by you`
          : `${booking.adapter.name} allocates by lottery or waiting time; react on the portal yourself`,
    };
  }
  return { plan: 'manual', reason: 'No way to contact this home automatically' };
}
