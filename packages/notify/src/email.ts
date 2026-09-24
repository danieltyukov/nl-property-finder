import type { Config, Mailbox, Notification } from '@nlpf/core';
import type { DigestNotifier } from './types.js';

export type EmailNotifierConfig = NonNullable<Config['notify']['email']>;

const FOOTER = 'Sent by NL Property Finder from your agent mailbox.';

function item(n: Notification): string {
  const lines = [n.body || n.title];
  if (n.url) lines.push(`Open: ${n.url}`);
  if (n.call) lines.push(`Call ${n.call}`);
  return lines.join('\n');
}

/**
 * The optional email channel. It sends from the dedicated mailbox to the
 * address the person chose, either one mail per notification or, with
 * `digest: 'daily'`, one summary a day that the dispatcher batches.
 */
export function createEmailNotifier(mailbox: Mailbox, cfg: EmailNotifierConfig): DigestNotifier {
  const guard = () => {
    // Mail to the agent's own inbox would come back in as an inbound message and loop.
    if (cfg.to.trim().toLowerCase() === mailbox.address.trim().toLowerCase()) {
      throw new Error('notify.email.to is the agent mailbox itself; choose another address');
    }
  };
  return {
    id: 'email',
    digest: cfg.digest,
    async send(n) {
      guard();
      await mailbox.send({ to: cfg.to, subject: n.title, text: `${item(n)}\n\n${FOOTER}` });
    },
    async sendDigest(items) {
      if (!items.length) return;
      guard();
      const count = `${items.length} update${items.length === 1 ? '' : 's'}`;
      const body = items.map((n, i) => `${i + 1}. ${n.title}\n${item(n)}`).join('\n\n');
      await mailbox.send({
        to: cfg.to,
        subject: `NL Property Finder: ${count}`,
        text: `${count} since the last summary.\n\n${body}\n\n${FOOTER}`,
      });
    },
  };
}
