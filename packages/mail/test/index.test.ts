import { MailSchema, memoryLogger } from '@nlpf/core';
import { expect, test } from 'vitest';
import { createMailboxFromConfig, parseAlertEmail, threadKey, toInbound } from '../src/index.js';

test('the package entry exports the public API', () => {
  expect(typeof parseAlertEmail).toBe('function');
  expect(typeof threadKey).toBe('function');
  expect(typeof toInbound).toBe('function');
});

test('createMailboxFromConfig picks the mailbox the config asks for', () => {
  const log = memoryLogger();
  expect(createMailboxFromConfig(MailSchema.parse({ provider: 'none' }), {}, log)).toBeNull();
  const memory = createMailboxFromConfig(MailSchema.parse({ provider: 'memory', address: 'demo@nlpf.test' }), {}, log);
  expect(memory?.address).toBe('demo@nlpf.test');
  const imapCfg = MailSchema.parse({ provider: 'imap', address: 'me@gmail.com' });
  expect(() => createMailboxFromConfig(imapCfg, {}, log)).toThrow('NLPF_MAIL_PASSWORD is not set');
  const imap = createMailboxFromConfig(imapCfg, { NLPF_MAIL_PASSWORD: 'app-password' }, log);
  expect(imap?.address).toBe('me@gmail.com');
  expect(imap?.status().connected).toBe(false);
});
