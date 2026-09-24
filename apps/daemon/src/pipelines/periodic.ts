import { followUpDue, followUpText, messageLanguage } from '@nlpf/agent';
import type { Job } from '@nlpf/core';
import { sendInConversation } from './inbound.js';
import { openTask, type Runtime } from '../runtime.js';

/** Hourly: one polite follow-up where a landlord has not answered and the listing is still online. */
export async function handleFollowups(rt: Runtime): Promise<void> {
  const cfg = rt.config();
  if (!cfg.automation.followUp.enabled || cfg.automation.paused) return;
  const now = rt.now();
  for (const app of rt.store.applications.list({ status: 'contacted' })) {
    const conv = rt.store.conversations.byApplication(app.id)[0];
    if (!conv) continue;
    const msgs = rt.store.messages.list(conv.id);
    const lastIn = [...msgs].reverse().find((m) => m.direction === 'in');
    const lastOut = [...msgs].reverse().find((m) => m.direction === 'out' && m.status === 'sent');
    const sent = msgs.filter((m) => m.direction === 'out' && m.rationale?.includes('follow-up')).length;
    if (!followUpDue(app, lastIn, lastOut, cfg.automation.followUp, now, sent)) continue;
    const listing = rt.store.listings.list({ propertyId: app.propertyId })[0];
    if (!listing) continue;
    const adapter = rt.adapter(listing.sourceId);
    if (adapter?.isAvailable && !(await adapter.isAvailable(listing, rt.sourceContext(adapter)).catch(() => true))) {
      rt.store.applications.update(app.id, { status: 'gone' }, now.toISOString());
      continue;
    }
    try {
      await sendInConversation(rt, conv, { body: followUpText(cfg.profile, listing, messageLanguage(cfg.profile, listing)), rationale: 'follow-up after no answer' });
      rt.bus.emit('followup.sent', `Followed up on ${listing.title}`, { applicationId: app.id });
    } catch (e) {
      rt.log.debug('follow-up not sent', { applicationId: app.id, error: (e as Error).message });
    }
  }
}

/** Daily: registration renewals and anything else that runs once a day. */
export async function handleDaily(rt: Runtime): Promise<void> {
  const now = rt.now();
  for (const reg of rt.config().registrations) {
    if (!reg.renewBy) continue;
    const due = Date.parse(reg.renewBy);
    const days = Math.round((due - now.getTime()) / 86_400_000);
    if (days <= 30) {
      openTask(rt, {
        kind: 'registration_renewal',
        title: `Renew your ${reg.portal} registration`,
        reason: days >= 0 ? `It expires in ${days} days. Letting it lapse resets your waiting time.` : 'It may have expired. Check it now to keep your waiting time.',
        priority: days < 7 ? 1 : 2,
        dueAt: new Date(due).toISOString(),
        payload: { url: reg.url, since: reg.since },
      }, `registration_renewal:${reg.portal}:${reg.renewBy}`);
    }
  }
}

/**
 * The daemon's clock: every minute it wakes snoozed tasks, and it enqueues
 * the hourly follow-up check, the daily job, and platform inbox syncs, keyed
 * by their time slot so a restart never doubles them.
 */
export function tickPeriodic(rt: Runtime): void {
  const now = rt.now();
  const nowIso = now.toISOString();
  for (const t of rt.store.tasks.wakeSnoozed(nowIso)) rt.bus.emit('task.updated', `${t.title} is back`, { taskId: t.id, state: 'open' });
  const hour = nowIso.slice(0, 13);
  rt.store.jobs.enqueue('followup', `followup:${hour}`, {}, nowIso);
  rt.store.jobs.enqueue('daily', `daily:${nowIso.slice(0, 10)}`, {}, nowIso);
}

/** Enqueues one inbox read per source with platform messaging, keyed by time slot. */
export function syncInboxes(rt: Runtime, everyMs = 120_000): void {
  const now = rt.now();
  const slot = Math.floor(now.getTime() / everyMs);
  for (const a of rt.adapters()) {
    if (!a.inbox) continue;
    const state = rt.store.sources.get(a.id);
    if (state?.health === 'needs_login' || state?.enabled === false) continue;
    rt.store.jobs.enqueue('sync_inbox', `sync_inbox:${a.id}:${slot}`, { sourceId: a.id }, now.toISOString());
  }
}

export type PeriodicJob = Job;
