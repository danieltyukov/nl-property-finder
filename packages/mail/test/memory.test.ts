import type { InboundMessage } from '@nlpf/core';
import { expect, test } from 'vitest';
import { createMemoryMailbox } from '../src/memory.js';

const inbound = (id: string): InboundMessage => ({
  id,
  channel: 'email',
  from: { address: 'landlord@example.test' },
  subject: 'Re: Oude Delft 12A',
  text: 'Kun je donderdag om 18:30?',
  at: '2026-09-23T08:00:00.000Z',
  attachments: [],
});

test('messages delivered before start are handed over on start, later ones right away', async () => {
  const mb = createMemoryMailbox('agent@nlpf.test');
  const seen: string[] = [];
  await mb.deliver(inbound('<a@x>'));
  expect(mb.status().connected).toBe(false);
  await mb.start(async (m) => {
    seen.push(m.id);
  });
  expect(mb.status()).toMatchObject({ connected: true, address: 'agent@nlpf.test' });
  await mb.deliver(inbound('<b@x>'));
  expect(seen).toEqual(['<a@x>', '<b@x>']);
});

test('send records the mail with a Message-ID on the mailbox domain and tells listeners', async () => {
  const mb = createMemoryMailbox('agent@nlpf.test');
  const heard: string[] = [];
  const off = mb.onSend((m) => {
    heard.push(m.messageId);
  });
  const { messageId } = await mb.send({ to: 'jan@example.test', subject: 'Reactie', text: 'Beste Jan', inReplyTo: '<a@x>' });
  expect(messageId).toMatch(/^<[^@]+@nlpf\.test>$/);
  expect(mb.sent).toHaveLength(1);
  expect(mb.sent[0]).toMatchObject({ to: 'jan@example.test', subject: 'Reactie', inReplyTo: '<a@x>', messageId, from: 'agent@nlpf.test' });
  expect(heard).toEqual([messageId]);
  off();
  await mb.send({ to: 'jan@example.test', subject: 'Nog een', text: 'x' });
  expect(heard).toHaveLength(1);
});

test('a failing handler makes deliver reject so nothing is lost silently', async () => {
  const mb = createMemoryMailbox('agent@nlpf.test');
  await mb.start(async () => {
    throw new Error('store is locked');
  });
  await expect(mb.deliver(inbound('<a@x>'))).rejects.toThrow('store is locked');
  expect(mb.status().error).toContain('store is locked');
});

test('after stop, messages wait for the next start', async () => {
  const mb = createMemoryMailbox('agent@nlpf.test');
  const seen: string[] = [];
  await mb.start(async (m) => {
    seen.push(m.id);
  });
  await mb.stop();
  await mb.deliver(inbound('<late@x>'));
  expect(seen).toEqual([]);
  await mb.start(async (m) => {
    seen.push(`again:${m.id}`);
  });
  expect(seen).toEqual(['again:<late@x>']);
});
