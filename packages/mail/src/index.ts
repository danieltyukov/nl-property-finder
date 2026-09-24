import type { Config, Logger, Mailbox } from '@nlpf/core';
import { createImapMailbox, type ImapMailboxOptions } from './imap.js';
import { createMemoryMailbox } from './memory.js';

export { createImapMailbox, safeFileName, type ImapClient, type ImapMailbox, type ImapMailboxOptions } from './imap.js';
export { createMemoryMailbox, type MemoryMailbox, type SentEmail } from './memory.js';
export { buildEmail, createSmtpSender, type BuiltEmail, type MailSender, type SmtpOptions } from './smtp.js';
export { isAutoSubmittedHeaders, parseEmail, toInbound, type ToInboundOptions } from './parse.js';
export { newMessageId, normalizeMessageId, threadKey } from './threads.js';
export { decodeEntities, htmlToText, readHtml, readText, type Doc, type DocLine, type DocLink } from './html.js';
export * from './alerts/index.js';

/**
 * The mailbox the config asks for: IMAP with the password from `secrets`
 * (`mail.passwordEnv`), the in-memory mailbox for demo mode, or null when
 * mail is off. Throws when IMAP is chosen but the password is missing, so the
 * daemon can raise a task instead of retrying a login that cannot work.
 */
export function createMailboxFromConfig(
  cfg: Config['mail'],
  secrets: Record<string, string | undefined>,
  log: Logger,
  opts: ImapMailboxOptions = {},
): Mailbox | null {
  if (cfg.provider === 'none') return null;
  if (cfg.provider === 'memory') return createMemoryMailbox(cfg.address || 'agent@nlpf.localhost');
  const password = secrets[cfg.passwordEnv];
  if (!password) throw new Error(`${cfg.passwordEnv} is not set in secrets.env`);
  if (!cfg.address) throw new Error('mail.address is empty');
  return createImapMailbox(cfg, password, log.child({ scope: 'mail' }), opts);
}
