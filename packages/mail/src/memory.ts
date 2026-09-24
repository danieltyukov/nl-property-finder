import type { InboundMessage, Mailbox, MailStatus, OutboundEmail } from '@nlpf/core';
import { newMessageId } from './threads.js';

/** What the memory mailbox keeps for every message it "sent". */
export interface SentEmail extends OutboundEmail {
  messageId: string;
  from: string;
  at: string;
}

export interface MemoryMailbox extends Mailbox {
  /** Hands a message to the running handler, or keeps it until `start`. Rejects when the handler throws. */
  deliver(m: InboundMessage): Promise<void>;
  /** Everything passed to `send`, oldest first. */
  sent: SentEmail[];
  /** Called for every sent message, so the sandbox's landlords can read what the agent wrote. Returns an unsubscribe function. */
  onSend(listener: (m: SentEmail) => void | Promise<void>): () => void;
}

/**
 * An in-process mailbox for demo mode and tests. Nothing leaves the process:
 * `send` records the message, and the sandbox calls `deliver` for replies.
 */
export function createMemoryMailbox(address: string): MemoryMailbox {
  let handler: ((m: InboundMessage) => Promise<void>) | null = null;
  let error: string | undefined;
  let lastAt: string | undefined;
  const waiting: InboundMessage[] = [];
  const listeners = new Set<(m: SentEmail) => void | Promise<void>>();
  const sent: SentEmail[] = [];

  const hand = async (m: InboundMessage, to: (m: InboundMessage) => Promise<void>) => {
    try {
      await to(m);
      lastAt = new Date().toISOString();
      error = undefined;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      throw err;
    }
  };

  return {
    address,
    sent,
    async start(onMessage) {
      handler = onMessage;
      while (waiting.length && handler === onMessage) {
        const next = waiting.shift();
        if (next) await hand(next, onMessage);
      }
    },
    async stop() {
      handler = null;
    },
    async deliver(m) {
      if (!handler) {
        waiting.push(m);
        return;
      }
      await hand(m, handler);
    },
    async send(mail) {
      const record: SentEmail = { ...mail, messageId: newMessageId(address), from: address, at: new Date().toISOString() };
      sent.push(record);
      for (const listener of [...listeners]) await listener(record);
      return { messageId: record.messageId };
    },
    onSend(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    status(): MailStatus {
      const s: MailStatus = { connected: handler !== null, address };
      if (lastAt) s.lastIdleAt = lastAt;
      if (error) s.error = error;
      return s;
    },
  };
}
