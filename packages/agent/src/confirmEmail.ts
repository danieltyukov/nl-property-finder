import type { InboundMessage } from '@nlpf/core';

export interface EmailConfirmation {
  /** Who asks: the sender's display name, or the name in its domain ("leadflow" for contact@leadflow.rent). */
  service: string;
  /** The link labelled as the confirmation, when the message has one. */
  url?: string;
}

/** Phrases that ask the reader to confirm or verify their email address. "Bevestiging van je reactie" is not one. */
const ASKS = [
  /\bbevestig\s+(?:je|jouw|uw)\s+e-?mail(?:adres)?\b/,
  /\be-?mail(?:adres)?\s+(?:te\s+)?(?:bevestigen|verifi[eë]ren)\b/,
  /\bverifieer\s+(?:je|jouw|uw)\s+e-?mail(?:adres)?\b/,
  /\b(?:confirm|verify)\s+(?:your\s+)?e-?mail(?:\s+address)?\b/,
];

const LINK_LABEL = /\b(?:bevestig|bevestigen|verifieer|verifi[eë]ren|activeer|activeren|confirm|verify|activate)\b/;
const URL = /https?:\/\/[^\s<>()"']+/g;

function serviceName(from: InboundMessage['from']): string {
  if (from.name?.trim()) return from.name.trim();
  const domain = from.address?.toLowerCase().split('@')[1] ?? '';
  const labels = domain.split('.').filter(Boolean);
  return labels.length >= 2 ? labels[labels.length - 2]! : domain || 'the sender';
}

/**
 * The confirmation link: the first URL whose label (the text before it on its
 * line, or the line above when the URL starts its own line) says confirm,
 * verify or activate. A logo or footer link is never picked.
 */
function confirmationLink(text: string): string | undefined {
  let prevEnd = 0;
  for (const m of text.matchAll(URL)) {
    const at = m.index;
    const lineStart = text.lastIndexOf('\n', at - 1) + 1;
    let label = text.slice(Math.max(lineStart, prevEnd), at);
    if (!/[a-z]/i.test(label) && lineStart > prevEnd) {
      const above = text.slice(prevEnd, lineStart).trimEnd();
      label = above.slice(above.lastIndexOf('\n') + 1);
    }
    prevEnd = at + m[0].length;
    if (LINK_LABEL.test(label.toLowerCase())) return m[0].replace(/[.,;:!?]+$/, '');
  }
  return undefined;
}

/**
 * A message that asks the person to confirm their email address, as lead
 * platforms (leadflow and the like) do before an agency sees a reaction. The
 * agent never follows links from mail, so this becomes a task with the link.
 * Detected by fixed phrases, never by a model.
 */
export function emailConfirmation(msg: InboundMessage): EmailConfirmation | undefined {
  const text = `${msg.subject ?? ''}\n${msg.text}`.toLowerCase();
  if (!ASKS.some((re) => re.test(text))) return undefined;
  const url = confirmationLink(msg.text);
  return url ? { service: serviceName(msg.from), url } : { service: serviceName(msg.from) };
}
