import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { InboundMessage, Logger } from '@nlpf/core';
import nodemailer, { type Transporter } from 'nodemailer';
import type { MailTarget, SandboxAttachment } from './types.js';

export interface LandlordEmail {
  /** From `newMessageId`, so the conversation can record the message before the agent answers it. */
  messageId: string;
  from: { name: string; address: string };
  to: string;
  subject: string;
  text: string;
  inReplyTo?: string;
  references?: string[];
  attachments: SandboxAttachment[];
  at: string;
}

/**
 * Sends landlord email, either straight into an in-process mailbox
 * (`deliver`, used by demo mode and unit tests) or over SMTP (GreenMail in
 * integration tests). Every message gets its own Message-ID; replies carry
 * In-Reply-To and References so the agent can thread them.
 */
export class MailHub {
  private transport?: Transporter;
  private count = 0;

  constructor(
    private readonly target: MailTarget,
    private readonly seed: number,
    private readonly log: Logger,
  ) {}

  /** A Message-ID on the sender's domain, unique within this seed. */
  newMessageId(fromAddress: string): string {
    const domain = fromAddress.split('@')[1] ?? 'sandbox.example';
    this.count += 1;
    return `<sandbox-${this.seed}-${this.count}@${domain}>`;
  }

  /** The address landlord email goes to: the SMTP recipient or the agent's own address, else whatever the applicant gave. */
  recipient(fallback: string): string {
    return 'smtp' in this.target ? this.target.to : (this.target.address ?? fallback);
  }

  async send(mail: LandlordEmail): Promise<{ messageId: string }> {
    const { messageId } = mail;
    if ('deliver' in this.target) {
      const m: InboundMessage = {
        id: messageId,
        channel: 'email',
        from: { name: mail.from.name, address: mail.from.address },
        to: [mail.to],
        subject: mail.subject,
        text: mail.text,
        at: mail.at,
        attachments: mail.attachments.map((a) => ({
          filename: a.filename,
          contentType: a.contentType,
          size: a.size,
          path: a.path,
        })),
      };
      if (mail.inReplyTo) m.inReplyTo = mail.inReplyTo;
      if (mail.references?.length) m.references = [...mail.references];
      await this.target.deliver(m);
      return { messageId };
    }
    const smtp = this.target;
    this.transport ??= nodemailer.createTransport({
      host: smtp.smtp.host,
      port: smtp.smtp.port,
      secure: false,
      ignoreTLS: true,
    });
    await this.transport.sendMail({
      from: { name: mail.from.name, address: mail.from.address },
      to: smtp.to,
      envelope: { from: smtp.from, to: smtp.to },
      subject: mail.subject,
      text: mail.text,
      date: new Date(mail.at),
      messageId,
      ...(mail.inReplyTo ? { inReplyTo: mail.inReplyTo } : {}),
      ...(mail.references?.length ? { references: mail.references } : {}),
      attachments: mail.attachments.map((a) => ({
        filename: a.filename,
        path: a.path,
        contentType: a.contentType,
      })),
    });
    this.log.debug('landlord email sent over SMTP', { messageId, to: smtp.to });
    return { messageId };
  }

  close(): void {
    this.transport?.close();
    this.transport = undefined;
  }
}

/** Keeps attachment files in one folder, one subfolder per attachment id. */
export class AttachmentStore {
  private count = 0;

  constructor(readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  save(filename: string, contentType: string, data: Buffer): SandboxAttachment {
    this.count += 1;
    const id = `a-${this.count}`;
    const safe = filename.replace(/[^\w.-]+/g, '_').slice(0, 120) || 'bijlage';
    const folder = join(this.dir, id);
    mkdirSync(folder, { recursive: true });
    const path = join(folder, safe);
    writeFileSync(path, data);
    return { id, filename: safe, contentType, size: data.length, path };
  }
}
