import { readFileSync } from 'node:fs';
import type { InboundMessage } from '@nlpf/core';
import { expect, test } from 'vitest';
import { parseAlertEmail } from '../src/alerts/index.js';
import { createMemoryMailbox } from '../src/memory.js';
import { parseEmail } from '../src/parse.js';
import { threadKey } from '../src/threads.js';

// Review Focus 3, input side: a reply that matches no application (a landlord
// writing from a personal address, or a forward) must reach the daemon intact
// so it can open a `reply_needed` task. The mail package must never swallow it
// as an alert or lose the text the address matcher needs.

const load = (name: string): Promise<InboundMessage> =>
  parseEmail(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

test('a landlord writing from a personal address is not taken for an alert', async () => {
  const m = await load('reply-personal.eml');
  // Its subject reads like an alert and it links to a listing with a price.
  expect(m.subject).toMatch(/^Nieuwe kamer/);
  expect(parseAlertEmail(m)).toBeNull();
  expect(threadKey(m)).toEqual(['<CAJvD1962personal@mail.gmail.example>']);
  expect(m.from).toEqual({ name: 'Joop van Dijk', address: 'j.vandijk1962@gmail.example' });
  expect(m.text).toContain('Van der Heimstraat 12');
  expect(m.autoSubmitted).toBe(false);
});

test('a forwarded reply keeps the forwarded text and is not an alert', async () => {
  const m = await load('forwarded.eml');
  expect(parseAlertEmail(m)).toBeNull();
  expect(threadKey(m)).toEqual(['<fwd-2201@vandammakelaardij.example>']);
  expect(m.text).toContain('Voor Oude Delft 12A');
  expect(m.text).toContain('zaterdag 26 september tussen 10:00 en 12:00');
});

test('the mailbox hands an unmatched reply to the handler', async () => {
  const mb = createMemoryMailbox('agent@nlpf.test');
  const got: InboundMessage[] = [];
  await mb.start(async (m) => {
    got.push(m);
  });
  const reply = await load('reply-personal.eml');
  await mb.deliver(reply);
  expect(got).toEqual([reply]);
});
