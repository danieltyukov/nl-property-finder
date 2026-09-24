import type { Config, OutboundEmail } from '@nlpf/core';
import { createTransport } from 'nodemailer';
import { newMessageId, normalizeMessageId } from './threads.js';

export interface BuiltEmail {
  messageId: string;
  raw: Buffer;
  from: string;
  to: string[];
}

export interface MailSender {
  send(mail: OutboundEmail): Promise<BuiltEmail>;
  close(): void;
}

export interface SmtpOptions {
  /** Display name on the From line, usually the profile's name. */
  fromName?: string;
}

/**
 * Builds the RFC 822 message for an outbound email. The Message-ID is chosen
 * here, so the caller knows it before sending and can store it for threading.
 * A reply without References gets its In-Reply-To as the only reference.
 */
export async function buildEmail(from: string, mail: OutboundEmail, opts: SmtpOptions = {}): Promise<BuiltEmail> {
  const messageId = newMessageId(from);
  const inReplyTo = normalizeMessageId(mail.inReplyTo) || undefined;
  const references = (mail.references ?? []).map(normalizeMessageId).filter(Boolean);
  if (inReplyTo && !references.includes(inReplyTo)) references.push(inReplyTo);
  const composer = createTransport({ streamTransport: true, buffer: true, newline: 'windows' });
  const info = await composer.sendMail({
    from: opts.fromName ? { name: opts.fromName, address: from } : from,
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    messageId,
    inReplyTo,
    references: references.length ? references : undefined,
    attachments: mail.attachments?.map((a) => ({ filename: a.filename, path: a.path })),
    disableUrlAccess: true,
    xMailer: false,
  });
  const raw = Buffer.isBuffer(info.message) ? info.message : Buffer.from(String(info.message));
  return { messageId, raw, from, to: [mail.to] };
}

/** Sends through the configured SMTP server with the mailbox credentials. */
export function createSmtpSender(cfg: Config['mail'], password: string, opts: SmtpOptions = {}): MailSender {
  const transport = createTransport({
    host: cfg.smtp.host,
    port: cfg.smtp.port,
    secure: cfg.smtp.secure,
    auth: { user: cfg.user || cfg.address, pass: password },
    connectionTimeout: 30_000,
    greetingTimeout: 20_000,
    socketTimeout: 60_000,
  });
  return {
    async send(mail) {
      const built = await buildEmail(cfg.address, mail, opts);
      await transport.sendMail({ envelope: { from: built.from, to: built.to }, raw: built.raw });
      return built;
    },
    close() {
      transport.close();
    },
  };
}
