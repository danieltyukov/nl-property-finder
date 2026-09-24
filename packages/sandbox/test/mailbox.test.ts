import { afterEach, expect, test } from 'vitest';
import type { InboundMessage } from '@nlpf/core';
// Demo mode wires the sandbox to this mailbox; the test checks the exact shape the daemon uses.
import { createMemoryMailbox } from '@nlpf/mail';
import { GRACHT_EMAIL, startSandbox, type Sandbox } from '../src/index.js';
import { waitFor } from './helpers.js';

let box: Sandbox | undefined;
afterEach(async () => {
  await box?.stop();
  box = undefined;
});

test('with the memory mailbox, landlord email reaches the agent and the agent answer reaches the landlord', async () => {
  const mailbox = createMemoryMailbox('sam@nlpf.test');
  box = await startSandbox({
    seed: 3,
    speed: 1000,
    listings: 'catalogue',
    mail: {
      deliver: (m) => mailbox.deliver(m),
      onSend: (fn) => mailbox.onSend(fn),
      address: mailbox.address,
    },
  });
  const received: InboundMessage[] = [];
  // The agent answers inside its handler, before deliver returns, the way the daemon's inbound pipeline does.
  await mailbox.start(async (m) => {
    received.push(m);
    if (/bezichtiging/i.test(m.text)) {
      const when = /(maandag|dinsdag|woensdag|donderdag|vrijdag) \d{1,2} \w+ om \d{2}:\d{2}/.exec(m.text)![0];
      await mailbox.send({
        to: m.from.address!,
        subject: `Re: ${m.subject}`,
        text: `Dank voor de uitnodiging. Graag bevestig ik de bezichtiging op ${when}. Ik kijk ernaar uit.`,
        inReplyTo: m.id,
        references: [m.id],
      });
    }
  });

  await fetch(`${box.url}/gracht/contact`, {
    method: 'POST',
    body: new URLSearchParams({
      object: 'dg-2001',
      naam: 'Sam de Vries',
      email: 'sam@nlpf.test',
      bericht: 'Graag kom ik kijken.',
    }),
  });
  await waitFor(() => (box!.control.submissions()[0]?.viewingConfirmed ? true : undefined));

  const [sub] = box.control.submissions();
  expect(box.control.submissions()).toHaveLength(1);
  expect(received[0]).toMatchObject({
    from: { address: GRACHT_EMAIL },
    to: ['sam@nlpf.test'],
    subject: 'Re: Tulpgracht 12 a',
  });
  expect(sub!.messages.map((m) => m.from)).toEqual(['agent', 'landlord', 'agent']);
  expect(sub!.messages[2]!.inReplyTo).toBe(received[0]!.id);
  expect(sub!.viewingConfirmed?.slot?.start).toBe(sub!.messages[1]!.slots![0]!.start);
  expect(box.control.emails()).toMatchObject([
    { to: GRACHT_EMAIL, submissionId: sub!.id, viewingConfirmation: true },
  ]);
  await mailbox.stop();
});
