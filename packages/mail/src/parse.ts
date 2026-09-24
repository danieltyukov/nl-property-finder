import { createHash } from 'node:crypto';
import type { Attachment, InboundMessage } from '@nlpf/core';
import { simpleParser, type AddressObject, type EmailAddress, type ParsedMail } from 'mailparser';
import { htmlToText } from './html.js';
import { normalizeMessageId } from './threads.js';

export interface ToInboundOptions {
  /** Used for `at` when the message has no usable Date header (IMAP INTERNALDATE, or now). */
  receivedAt?: Date;
}

type Headers = ParsedMail['headers'];

function headerText(headers: Headers, name: string): string | undefined {
  const v = headers.get(name);
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'string') return v;
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? x : x.value)).join(', ');
  if ('value' in v && typeof v.value === 'string') return v.value;
  if ('text' in v && typeof v.text === 'string') return v.text;
  return undefined;
}

const firstToken = (s: string): string => (s.trim().split(/[\s;(,]/)[0] ?? '').toLowerCase();

/**
 * True for messages a machine sent on its own: out-of-office replies,
 * auto-responders, mailing lists and bulk mail. The agent stores these and
 * never answers them, which is what stops two auto-responders from talking to
 * each other forever.
 */
export function isAutoSubmittedHeaders(headers: Headers): boolean {
  const auto = headerText(headers, 'auto-submitted');
  if (auto !== undefined && firstToken(auto) !== '' && firstToken(auto) !== 'no') return true;
  for (const name of ['x-autoreply', 'x-autorespond']) {
    const v = headerText(headers, name);
    if (v !== undefined && !['no', 'false', '0'].includes(firstToken(v))) return true;
  }
  const precedence = headerText(headers, 'precedence');
  if (precedence !== undefined && ['auto_reply', 'bulk', 'list', 'junk'].includes(firstToken(precedence))) return true;
  return false;
}

function flattenAddresses(value: AddressObject | AddressObject[] | undefined): EmailAddress[] {
  const out: EmailAddress[] = [];
  const walk = (list: EmailAddress[]) => {
    for (const a of list) {
      if (a.group) walk(a.group);
      else out.push(a);
    }
  };
  for (const obj of value === undefined ? [] : Array.isArray(value) ? value : [value]) walk(obj.value);
  return out;
}

const cleanAddress = (a: string | undefined): string | undefined => {
  const t = a?.trim().toLowerCase();
  return t ? t : undefined;
};

function normaliseText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/ /g, ' ')
    .replace(/[ \t]+$/gm, '')
    .trim();
}

function syntheticId(parsed: ParsedMail, text: string): string {
  const h = createHash('sha256');
  h.update(parsed.from?.text ?? '');
  h.update('\u0000');
  h.update(parsed.date ? parsed.date.toISOString() : '');
  h.update('\u0000');
  h.update(parsed.subject ?? '');
  h.update('\u0000');
  h.update(text);
  return `<nlpf-${h.digest('hex').slice(0, 32)}@message-id.invalid>`;
}

/**
 * Converts a mailparser result into the InboundMessage the daemon works with.
 * The text part is preferred; HTML is converted to text only when there is no
 * text part, one block per line and without wrapping, so a phrase such as
 * "om 18:30" never ends up split over two lines. The full text is kept, quoted history included, because the
 * classifier and the address matcher read all of it.
 */
export function toInbound(parsed: ParsedMail, opts: ToInboundOptions = {}): InboundMessage {
  const html = typeof parsed.html === 'string' && parsed.html.trim() ? parsed.html : undefined;
  const rawText = parsed.text && parsed.text.trim() ? parsed.text : html ? htmlToText(html) : '';
  const text = normaliseText(rawText);

  const sender = flattenAddresses(parsed.from)[0];
  const from: InboundMessage['from'] = {};
  const name = sender?.name?.trim();
  if (name) from.name = name;
  const address = cleanAddress(sender?.address);
  if (address) from.address = address;

  const to = [...new Set(
    [...flattenAddresses(parsed.to), ...flattenAddresses(parsed.cc)]
      .map((a) => cleanAddress(a.address))
      .filter((a): a is string => !!a),
  )];

  const refsRaw = parsed.references === undefined ? [] : Array.isArray(parsed.references) ? parsed.references : [parsed.references];
  const references = refsRaw
    .flatMap((r) => r.match(/<[^<>\s]+>/g) ?? r.split(/\s+/))
    .map(normalizeMessageId)
    .filter(Boolean);

  const date = parsed.date && !Number.isNaN(parsed.date.getTime()) ? parsed.date : (opts.receivedAt ?? new Date());

  const attachments: Attachment[] = parsed.attachments
    .filter((a) => !a.related)
    .map((a) => ({ filename: a.filename ?? 'attachment', contentType: a.contentType, size: a.size }));

  const msg: InboundMessage = {
    id: normalizeMessageId(parsed.messageId) || syntheticId(parsed, text),
    channel: 'email',
    from,
    text,
    at: date.toISOString(),
    autoSubmitted: isAutoSubmittedHeaders(parsed.headers),
    attachments,
  };
  if (to.length) msg.to = to;
  if (parsed.subject !== undefined) msg.subject = parsed.subject;
  if (html) msg.html = html;
  const inReplyTo = normalizeMessageId(parsed.inReplyTo);
  if (inReplyTo) msg.inReplyTo = inReplyTo;
  if (references.length) msg.references = references;
  return msg;
}

/** Parses a raw RFC 822 message (a Buffer from IMAP, or a string) into an InboundMessage. */
export async function parseEmail(source: Buffer | string, opts: ToInboundOptions = {}): Promise<InboundMessage> {
  const parsed = await simpleParser(source, { skipHtmlToText: true, skipTextToHtml: true, skipImageLinks: true });
  return toInbound(parsed, opts);
}
