import type { Mailbox, Notification, OutboundEmail } from '@nlpf/core';
import { expect, test } from 'vitest';
import { createEmailNotifier } from '../src/email.js';

function fakeMailbox(address = 'agent@nlpf.test'): Mailbox & { sent: OutboundEmail[] } {
  const sent: OutboundEmail[] = [];
  return {
    address,
    sent,
    async start() {},
    async stop() {},
    async send(m) {
      sent.push(m);
      return { messageId: `<n${sent.length}@nlpf.test>` };
    },
    status: () => ({ connected: true, address }),
  };
}

const n = (title: string, over: Partial<Notification> = {}): Notification => ({ title, body: `${title} body`, priority: 4, ...over });

test('instant mode mails each notification from the agent mailbox', async () => {
  const mb = fakeMailbox();
  const email = createEmailNotifier(mb, { to: 'sam@example.test', digest: 'instant' });
  expect(email.id).toBe('email');
  expect(email.digest).toBe('instant');
  await email.send(n('Viewing booked', { url: 'http://127.0.0.1:7431/inbox/t_1', call: '+31 6 1234 5678' }));
  expect(mb.sent).toHaveLength(1);
  expect(mb.sent[0]).toMatchObject({ to: 'sam@example.test', subject: 'Viewing booked' });
  expect(mb.sent[0]!.text).toContain('Viewing booked body');
  expect(mb.sent[0]!.text).toContain('http://127.0.0.1:7431/inbox/t_1');
  expect(mb.sent[0]!.text).toContain('Call +31 6 1234 5678');
});

test('a daily digest is one mail listing every item', async () => {
  const mb = fakeMailbox();
  const email = createEmailNotifier(mb, { to: 'sam@example.test', digest: 'daily' });
  expect(email.digest).toBe('daily');
  await email.sendDigest([n('Reply needed'), n('Viewing booked'), n('Source broken')]);
  expect(mb.sent).toHaveLength(1);
  expect(mb.sent[0]!.subject).toBe('NL Property Finder: 3 updates');
  const text = mb.sent[0]!.text;
  expect(text.indexOf('1. Reply needed')).toBeLessThan(text.indexOf('2. Viewing booked'));
  expect(text).toContain('3. Source broken');
  await email.sendDigest([]);
  expect(mb.sent).toHaveLength(1);
});

test('refuses to mail the agent mailbox itself, which would loop back into triage', async () => {
  const mb = fakeMailbox('Agent@nlpf.test');
  const email = createEmailNotifier(mb, { to: 'agent@NLPF.test', digest: 'instant' });
  await expect(email.send(n('x'))).rejects.toThrow(/agent mailbox/);
  expect(mb.sent).toEqual([]);
});
