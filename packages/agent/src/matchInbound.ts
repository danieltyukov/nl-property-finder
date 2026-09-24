import type { Application, Conversation, InboundMessage, Store } from '@nlpf/core';
import { normAddition, splitHouseNumber } from './cluster.js';
import { fold } from './text.js';

export interface InboundMatch {
  conversationId?: string;
  applicationId?: string;
  confidence: 'thread' | 'sender' | 'address' | 'none';
}

/** Applications in these states are finished; a letter mentioning their address is not about them. */
const CLOSED = new Set<Application['status']>(['rejected', 'withdrawn', 'gone', 'skipped']);

/** Shared mail providers: two people on gmail.com are not the same agency. */
const FREE_MAIL = new Set([
  'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.nl', 'outlook.com', 'outlook.nl', 'live.nl', 'live.com', 'msn.com',
  'yahoo.com', 'yahoo.nl', 'icloud.com', 'me.com', 'mac.com', 'ziggo.nl', 'kpnmail.nl', 'kpnplanet.nl', 'planet.nl', 'home.nl',
  'hetnet.nl', 'xs4all.nl', 'casema.nl', 'chello.nl', 'upcmail.nl', 'telfort.nl', 'tele2.nl', 'online.nl', 'protonmail.com',
  'proton.me', 'gmx.com', 'gmx.net', 'gmx.de', 'aol.com', 'mail.com',
]);

const domainOf = (address: string | undefined) => address?.toLowerCase().split('@')[1]?.trim();

function fromConversation(c: Conversation, confidence: InboundMatch['confidence']): InboundMatch {
  const out: InboundMatch = { conversationId: c.id, confidence };
  if (c.applicationId) out.applicationId = c.applicationId;
  return out;
}

/** Prefer a conversation tied to an application, then the most recent one. */
function pick(conversations: Conversation[]): Conversation | undefined {
  return [...conversations].sort((a, b) => Number(!!b.applicationId) - Number(!!a.applicationId) || b.lastMessageAt.localeCompare(a.lastMessageAt))[0];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A pattern for "<street> <number><addition>" in folded text. The addition
 * is a single letter ("12A", "12 a", "12-a"), a dash suffix ("12-2",
 * "12-III") or a known word ("12 bis", "12 hs"). Returns the captured
 * addition (possibly empty) for each hit.
 */
function addressMentions(text: string, street: string, number: string): string[] {
  const tokens = fold(street).split(/[^a-z0-9]+/).filter(Boolean);
  if (!tokens.length) return [];
  const re = new RegExp(
    `(?<![a-z0-9])${tokens.map(escape).join("[\\s.'-]*")}\\s*0*${number}(?!\\d)(?:\\s*-\\s*(\\d{1,3}|[a-z]{1,4})(?![a-z\\d])|\\s*([a-z])(?![a-z\\d])|\\s+(bis|hs|huis|zw|rd|bg)(?![a-z]))?`,
    'g',
  );
  return [...fold(text).matchAll(re)].map((m) => normAddition(m[1] ?? m[2] ?? m[3] ?? ''));
}

function matchByAddress(msg: InboundMessage, store: Store): InboundMatch | undefined {
  const text = `${msg.subject ?? ''}\n${msg.text}`;
  const exact: Application[] = [];
  const partial: Application[] = [];
  for (const app of store.applications.list({ limit: 500 })) {
    if (CLOSED.has(app.status)) continue;
    const p = store.properties.get(app.propertyId);
    if (!p?.address.street) continue;
    const { number, addition } = splitHouseNumber(p.address.houseNumber, p.address.addition);
    if (!number) continue;
    const mentions = addressMentions(text, p.address.street, number);
    if (!mentions.length) continue;
    if (mentions.some((a) => a === addition)) exact.push(app);
    else if (mentions.some((a) => !a || !addition)) partial.push(app);
  }
  const app = exact.length === 1 ? exact[0] : exact.length === 0 && partial.length === 1 ? partial[0] : undefined;
  if (!app) return undefined;
  const conversation = pick(store.conversations.byApplication(app.id));
  const out: InboundMatch = { applicationId: app.id, confidence: 'address' };
  if (conversation) out.conversationId = conversation.id;
  return out;
}

/**
 * Finds the conversation and application an inbound message belongs to, in
 * order of confidence: mail threading headers against stored message ids,
 * the platform thread id, the sender address, the sender's domain against
 * known agencies (never a shared mail provider), then a street and number
 * mentioned in the text against open applications. `none` means a person
 * has to look (the policy opens a reply_needed task, Review Focus 3).
 */
export function matchInbound(msg: InboundMessage, store: Store): InboundMatch {
  for (const ref of [msg.inReplyTo, ...[...(msg.references ?? [])].reverse()]) {
    if (!ref) continue;
    const m = store.messages.byExternal(ref);
    const c = m && store.conversations.get(m.conversationId);
    if (c) return fromConversation(c, 'thread');
  }

  if (msg.sourceId && msg.threadId) {
    const c = store.conversations.byThread(msg.sourceId, msg.threadId);
    if (c) return fromConversation(c, 'thread');
  }

  const address = msg.from.address?.toLowerCase().trim();
  if (address) {
    const c = pick(store.conversations.byEmail(address));
    if (c) return fromConversation(c, 'sender');

    const domain = domainOf(address);
    if (domain && !FREE_MAIL.has(domain)) {
      const sameDomain = store.conversations.list({ limit: 500 }).filter((x) => domainOf(x.counterpart.email) === domain);
      const byDomain = pick(sameDomain);
      if (byDomain) return fromConversation(byDomain, 'sender');

      for (const l of store.listings.list({ limit: 500 })) {
        if (!l.propertyId || domainOf(l.agent?.email) !== domain) continue;
        const app = store.applications.byProperty(l.propertyId);
        if (!app || CLOSED.has(app.status)) continue;
        const conversation = pick(store.conversations.byApplication(app.id));
        const out: InboundMatch = { applicationId: app.id, confidence: 'sender' };
        if (conversation) out.conversationId = conversation.id;
        return out;
      }
    }
  }

  return matchByAddress(msg, store) ?? { confidence: 'none' };
}
