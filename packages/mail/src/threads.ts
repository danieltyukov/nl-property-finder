import { randomUUID } from 'node:crypto';
import type { InboundMessage } from '@nlpf/core';

/**
 * Message-IDs are compared as `<local@domain>`. Parsers and servers disagree
 * on the brackets and on surrounding whitespace, so every id that is stored or
 * compared goes through here. Platform ids such as `huisje:4411` have no `@`
 * and are returned unchanged.
 */
export function normalizeMessageId(id: string | undefined): string {
  const trimmed = (id ?? '').trim();
  if (!trimmed) return '';
  const bare = trimmed.replace(/^<+/, '').replace(/>+$/, '').trim();
  if (!bare.includes('@')) return trimmed;
  return `<${bare}>`;
}

/** Splits a References-style value into ids, tolerating several ids in one string. */
function splitIds(value: string): string[] {
  const bracketed = value.match(/<[^<>\s]+>/g);
  if (bracketed) return bracketed;
  return value.split(/\s+/).filter(Boolean);
}

/**
 * Every id that can tie this message to a conversation: its own id first,
 * then In-Reply-To, then References from newest to oldest. The daemon looks
 * these up against stored message ids (Review Focus 3); a message whose keys
 * match nothing still goes on to the address and sender checks and is never
 * dropped.
 */
export function threadKey(m: InboundMessage): string[] {
  const out: string[] = [];
  const add = (raw: string | undefined) => {
    const id = normalizeMessageId(raw);
    if (id && !out.includes(id)) out.push(id);
  };
  add(m.id);
  if (m.inReplyTo) for (const id of splitIds(m.inReplyTo)) add(id);
  const refs = (m.references ?? []).flatMap(splitIds);
  for (let i = refs.length - 1; i >= 0; i--) add(refs[i]);
  return out;
}

/** A new Message-ID on the sender's domain, so replies thread back to it. */
export function newMessageId(fromAddress: string): string {
  const domain = fromAddress.split('@')[1]?.trim().toLowerCase() || 'nlpf.localhost';
  return `<${randomUUID()}@${domain}>`;
}
