import type { Application, AutomationConfig, Message } from '@nlpf/core';

const DAY = 86_400_000;

/**
 * Whether one polite follow-up is due: the application is still `contacted`
 * (no reply, not closed), nothing came in since the first contact, fewer
 * than `cfg.max` follow-ups went out, and `cfg.afterDays` days passed since
 * the last outbound message (or the contact time). The daemon re-checks
 * that the listing is still online before sending.
 *
 * `followUpsSent` is the number of follow-ups already sent in this
 * conversation, which is the outbound message count minus the first message.
 */
export function followUpDue(
  app: Application,
  lastInbound: Message | undefined,
  lastOutbound: Message | undefined,
  cfg: AutomationConfig['followUp'],
  now: Date,
  followUpsSent = 0,
): boolean {
  if (!cfg.enabled || app.status !== 'contacted' || followUpsSent >= cfg.max) return false;
  const contactedAt = app.contactedAt ?? lastOutbound?.at;
  if (!contactedAt) return false;
  if (lastInbound && Date.parse(lastInbound.at) >= Date.parse(contactedAt)) return false;
  const since = Date.parse(lastOutbound?.at ?? contactedAt);
  return now.getTime() - since >= cfg.afterDays * DAY;
}
