import type { MailStatus } from '@nlpf/core';

/**
 * What the dashboard shows about the mailbox. The live connection wins: an
 * error from startup (no network yet at boot) or from an earlier failed
 * connect is history once the mailbox is connected again.
 */
export function mailStatusView(live: MailStatus | undefined, address: string | undefined, setupError?: string): MailStatus {
  const out: MailStatus = { connected: live?.connected ?? false };
  if (address) out.address = address;
  if (live?.lastIdleAt) out.lastIdleAt = live.lastIdleAt;
  const error = live?.connected ? undefined : (live?.error ?? setupError);
  if (error) out.error = error;
  return out;
}

/**
 * Whether a status report from the mailbox is news for the activity feed.
 * The mailbox reports after every sync, every five minutes; only a change of
 * connection or of error is worth a line.
 */
export function mailStatusChanged(prev: Pick<MailStatus, 'connected' | 'error'> | undefined, next: MailStatus): boolean {
  return !prev || prev.connected !== next.connected || (prev.error ?? '') !== (next.error ?? '');
}
