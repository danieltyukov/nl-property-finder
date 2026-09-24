import { memoryLogger, NotifySchema, type Mailbox } from '@nlpf/core';
import { expect, test } from 'vitest';
import { createNotifyDispatcher, createNotifySetup, signAction, verifyAction } from '../src/index.js';

const mailbox: Mailbox = {
  address: 'agent@nlpf.test',
  async start() {},
  async stop() {},
  async send() {
    return { messageId: '<x@nlpf.test>' };
  },
  status: () => ({ connected: true }),
};

test('the entry exports the helpers the daemon needs', () => {
  expect(typeof createNotifyDispatcher).toBe('function');
  expect(verifyAction('s3cret-value', 't_1', 'approve', signAction('s3cret-value', 't_1', 'approve'))).toBe(true);
});

test('createNotifySetup builds the configured notifiers and action channels', () => {
  const cfg = NotifySchema.parse({
    ntfy: { server: 'https://ntfy.example.test', topic: 'nlpf-k3x9q2m7ab' },
    telegram: { chatId: '987654321' },
    email: { to: 'sam@example.test', digest: 'daily' },
    desktop: true,
  });
  const setup = createNotifySetup(cfg, {
    secrets: { NLPF_TELEGRAM_TOKEN: '123456789:AAtesttokenvalueforunittests0000000' },
    actionSecret: 'per-install-secret',
    mailbox,
    log: memoryLogger(),
  });
  expect(setup.notifiers.map((n) => n.id)).toEqual(['ntfy', 'telegram', 'email', 'desktop']);
  expect(setup.channels.map((c) => c.id)).toEqual(['ntfy', 'telegram']);
  expect(setup.problems).toEqual([]);
});

test('missing secrets and switched-off actions are reported, not thrown', () => {
  const cfg = NotifySchema.parse({
    ntfy: { topic: 'nlpf-k3x9q2m7ab', actions: false },
    telegram: { chatId: '987654321' },
    email: { to: 'sam@example.test' },
    desktop: false,
  });
  const setup = createNotifySetup(cfg, { secrets: {}, log: memoryLogger() });
  expect(setup.notifiers.map((n) => n.id)).toEqual(['ntfy']);
  expect(setup.channels).toEqual([]);
  expect(setup.problems).toEqual([
    'NLPF_TELEGRAM_TOKEN is not set, so Telegram is off',
    'notify.email needs the agent mailbox, which is off',
  ]);
});
