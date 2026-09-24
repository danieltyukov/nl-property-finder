import {
  ConfigSchema,
  memoryLogger,
  type Config,
  type InboundMessage,
  type Listing,
  type OutboundMessage,
  type RawListing,
  type SourceContext,
} from '@nlpf/core';
import { createPoliteFetch, createSourceContext } from '@nlpf/sources';
import { startSandbox, type AgentEmail, type Sandbox, type SandboxOptions } from '../src/index.js';

export interface TestSandbox extends Sandbox {
  /** Landlord email delivered to the in-process mailbox, oldest first. */
  inbox: InboundMessage[];
  /** Hands an agent email to the sandbox, the way the memory mailbox's `onSend` does. */
  send(mail: AgentEmail): Promise<void>;
  /** Resolves when `count` landlord emails have arrived. */
  waitForMail(count: number, timeoutMs?: number): Promise<InboundMessage[]>;
}

/** A sandbox with an in-process mailbox, no automatic replies and a fixed seed, unless told otherwise. */
export async function sandbox(opts: Partial<SandboxOptions> = {}): Promise<TestSandbox> {
  const inbox: InboundMessage[] = [];
  const listeners = new Set<(m: AgentEmail) => void | Promise<void>>();
  const box = await startSandbox({
    seed: 7,
    autoReply: false,
    ...opts,
    mail: opts.mail ?? {
      deliver: async (m) => {
        inbox.push(m);
      },
      onSend: (fn) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      address: 'sam@nlpf.test',
    },
  });
  return Object.assign(box, {
    inbox,
    send: async (mail: AgentEmail) => {
      for (const fn of listeners) await fn(mail);
    },
    waitForMail: (count: number, timeoutMs = 3000) =>
      waitFor(() => (inbox.length >= count ? inbox : undefined), timeoutMs),
  });
}

/** Polls `check` every 10 ms until it returns something, or fails after `timeoutMs`. */
export async function waitFor<T>(check: () => T | undefined, timeoutMs = 3000): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = check();
    if (v !== undefined) return v;
    if (Date.now() > until) throw new Error(`timed out after ${timeoutMs} ms`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

export const config: Config = ConfigSchema.parse({
  profile: { firstName: 'Sam', lastName: 'de Vries', email: 'sam@nlpf.test', phone: '0600000000' },
  searches: [
    {
      id: 'main',
      name: 'Main',
      priceMaxEur: 1400,
      regions: [
        { name: 'Delft', municipalities: ['Delft'] },
        { name: 'Rotterdam', municipalities: ['Rotterdam'] },
        { name: 'Den Haag', municipalities: ['Den Haag'] },
      ],
    },
  ],
});

/** A real source context (polite fetch without the per-host gap) for adapters against the running sandbox. */
export function context(sourceId: string, cfg: Config = config): SourceContext {
  return createSourceContext({
    fetch: createPoliteFetch({ minGapMs: 0, log: memoryLogger() }),
    pool: {
      session: () => Promise.reject(new Error('no browser in unit tests')),
    },
    log: memoryLogger(),
    config: cfg,
    sourceId,
    signal: new AbortController().signal,
  });
}

export function asListing(raw: RawListing): Listing {
  const now = new Date().toISOString();
  return {
    ...raw,
    id: `${raw.sourceId}:${raw.externalId}`,
    propertyId: null,
    firstSeenAt: now,
    lastSeenAt: now,
    state: 'active',
    via: 'poll',
  };
}

export function message(body: string, dryRun = false): OutboundMessage {
  return { body, language: 'nl', profile: config.profile, dryRun };
}
