import type { InboundMessage, Store } from '@nlpf/core';

const AUTO_SUBJECT =
  /^\s*(auto(matic)?[\s-]?(reply|response|antwoord)|automatisch(e)? (antwoord|bericht)|autoreply|out of (the )?office|afwezig\b|niet aanwezig|abwesenheit|ooo\b|auto:|delivery status notification|undeliver(able|ed)|onbestelbaar|mail delivery (failed|subsystem)|returned mail)/i;
const AUTO_SENDER =
  /^(mailer-daemon|postmaster|no-?reply|do-?not-?reply|donotreply|bounce[s]?)([+.-][^@]*)?@/i;

/**
 * True for messages that must never get an automatic answer: anything the
 * mail layer marked as auto-submitted (Auto-Submitted, X-Autoreply,
 * Precedence: auto_reply or bulk), out-of-office and bounce subjects, and
 * senders that cannot receive replies. Two agents answering each other's
 * auto-replies is the loop this prevents.
 */
export function isAutoSubmitted(m: InboundMessage): boolean {
  if (m.autoSubmitted) return true;
  if (m.subject && AUTO_SUBJECT.test(m.subject)) return true;
  return !!m.from.address && AUTO_SENDER.test(m.from.address.trim());
}

/**
 * How many more automatic replies the agent may send in this conversation
 * over the last 24 hours. Messages the person wrote do not count.
 */
export function replyBudgetLeft(conversationId: string, store: Store, cap: number, now: Date): number {
  const since = new Date(now.getTime() - 86_400_000).toISOString();
  return Math.max(0, cap - store.messages.countOutboundSince(conversationId, since, 'agent'));
}
