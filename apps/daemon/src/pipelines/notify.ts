import type { NlpfEvent, Notification, Task } from '@nlpf/core';
import type { Runtime } from '../runtime.js';

/** Buttons per task kind. The daemon verifies every press, so these are only offered where the action is safe from a phone. */
const ACTIONS: Partial<Record<Task['kind'], { id: string; label: string }[]>> = {
  viewing_booked: [{ id: 'approve', label: 'Keep it' }, { id: 'reject', label: 'Cancel' }],
  approve_outreach: [{ id: 'approve', label: 'Send' }, { id: 'reject', label: 'Skip' }],
  documents_approval: [{ id: 'approve', label: 'Send documents' }, { id: 'dismiss', label: 'Not now' }],
  reply_needed: [{ id: 'send_draft', label: 'Send draft' }, { id: 'snooze', label: 'Later' }],
  react_manually: [{ id: 'done', label: 'Done' }, { id: 'snooze', label: 'Later' }],
  scam_review: [{ id: 'approve', label: 'Contact anyway' }, { id: 'dismiss', label: 'Ignore' }],
  viewing_choice: [{ id: 'approve', label: 'Earliest time' }, { id: 'snooze', label: 'Later' }],
  call_now: [{ id: 'done', label: 'Called' }, { id: 'dismiss', label: 'Skip' }],
};

const PRIORITY: Record<1 | 2 | 3, Notification['priority']> = { 1: 5, 2: 4, 3: 3 };

/**
 * Only what needs a person, and wins, reach the phone: new tasks at priority 1
 * or 2, booked viewings, offers, and a source breaking. Everything else stays
 * in the dashboard's feed.
 */
export function notificationFor(rt: Runtime, e: NlpfEvent): Notification | undefined {
  if (e.type === 'task.created') {
    const task = rt.store.tasks.get(String(e.data.taskId));
    if (!task || task.priority > 2) return undefined;
    const phone = typeof task.payload?.phone === 'string' ? task.payload.phone : undefined;
    return {
      title: task.title,
      body: task.reason,
      priority: task.kind === 'payment_warning' || task.kind === 'offer_or_contract' ? 5 : PRIORITY[task.priority],
      tags: [task.kind],
      key: `task:${task.id}`,
      taskId: task.id,
      actions: ACTIONS[task.kind],
      call: task.kind === 'call_now' ? phone : undefined,
    };
  }
  if (e.type === 'viewing.booked') return undefined; // the viewing_booked task carries it, with buttons
  if (e.type === 'source.health' && e.data.health === 'degraded') {
    return { title: e.summary, body: 'Open Sources in the dashboard for details.', priority: 3, key: `health:${String(e.data.sourceId)}` };
  }
  return undefined;
}

export function startNotifications(rt: Runtime): () => void {
  return rt.bus.subscribe((e) => {
    const n = notificationFor(rt, e);
    if (n) void rt.notify(n).catch((err) => rt.log.warn('notification failed', { error: (err as Error).message }));
  });
}
