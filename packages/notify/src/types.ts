import type { Notification, Notifier } from '@nlpf/core';

/** A channel that can batch: with `digest: 'daily'` the dispatcher queues for it and calls `sendDigest` each morning. */
export interface DigestNotifier extends Notifier {
  readonly digest: 'instant' | 'daily';
  sendDigest(items: Notification[]): Promise<void>;
}
