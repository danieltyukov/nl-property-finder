import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { parseSlots } from '@nlpf/agent';
import { GRACHT_EMAIL, pdfText, viewingConfirmation } from '../src/index.js';
import { sandbox, waitFor, type TestSandbox } from './helpers.js';

const boxes: TestSandbox[] = [];
async function start(opts: Parameters<typeof sandbox>[0] = {}) {
  const box = await sandbox(opts);
  boxes.push(box);
  return box;
}
afterEach(async () => {
  await Promise.all(boxes.splice(0).map((b) => b.stop()));
});

const contactGracht = (box: TestSandbox, object: string, bericht = 'Graag kom ik kijken.') =>
  fetch(`${box.url}/gracht/contact`, {
    method: 'POST',
    body: new URLSearchParams({ object, naam: 'Sam de Vries', email: 'sam@nlpf.test', bericht }),
  });

describe('landlord replies by email', () => {
  test('viewing_slots delivers an email with weekdays and times the agent can parse', async () => {
    const box = await start();
    await contactGracht(box, 'dg-2001');
    const sub = box.control.submissions()[0]!;
    await box.control.landlordReply(sub.id, 'viewing_slots');
    const [mail] = box.inbox;
    expect(mail).toMatchObject({
      channel: 'email',
      from: { address: GRACHT_EMAIL },
      to: ['sam@nlpf.test'],
      subject: 'Re: Tulpgracht 12 a',
    });
    expect(mail!.id).toMatch(/^<sandbox-7-\d+@degracht\.example>$/);
    expect(mail!.inReplyTo).toBeUndefined();
    expect(mail!.text).toMatch(/(maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag)/);
    expect(mail!.text).toMatch(/\d{1,2}:\d{2}/);
    expect(mail!.text).toContain('Tulpgracht 12 a');
    expect(parseSlots(mail!.text, new Date()).filter((s) => s.certain).length).toBeGreaterThanOrEqual(2);
  });

  test('replies thread: In-Reply-To and References follow the conversation', async () => {
    const box = await start();
    await contactGracht(box, 'dg-2005');
    const sub = box.control.submissions()[0]!;
    await box.control.landlordReply(sub.id, 'info_request');
    const first = box.inbox[0]!;
    await box.send({
      to: GRACHT_EMAIL,
      from: 'sam@nlpf.test',
      subject: first.subject!,
      text: 'Beste Eva,\n\nIk werk als promovendus aan de TU Delft.\n\nMet vriendelijke groet,\nSam de Vries',
      messageId: '<agent-1@nlpf.test>',
      inReplyTo: first.id,
      references: [first.id],
    });
    await box.control.landlordReply(sub.id, 'viewing_slots');
    const second = box.inbox[1]!;
    expect(second.inReplyTo).toBe('<agent-1@nlpf.test>');
    expect(second.references).toEqual([first.id, '<agent-1@nlpf.test>']);
    expect(second.subject).toBe(`Re: ${first.subject!.replace(/^Re: /, '')}`);
    expect(box.control.emails()).toMatchObject([{ submissionId: sub.id, viewingConfirmation: false }]);
    expect(box.control.submission(sub.id)!.agentTurns).toBe(2);
  });

  test('landlords answer on their own after a delay scaled by speed, following the listing script', async () => {
    const box = await start({ autoReply: true, speed: 1000 });
    await contactGracht(box, 'dg-2005'); // script: info_request, then viewing_slots
    const [info] = await box.waitForMail(1);
    expect(info!.text).toContain('?');
    expect(info!.text).not.toMatch(/bezichtiging/i);
    await box.send({
      to: GRACHT_EMAIL,
      subject: info!.subject!,
      text: 'Ik ben promovendus.',
      messageId: '<a1@nlpf.test>',
      inReplyTo: info!.id,
    });
    const [, slots] = await box.waitForMail(2);
    expect(slots!.text).toMatch(/bezichtiging/i);
    expect(slots!.inReplyTo).toBe('<a1@nlpf.test>');
    await box.send({
      to: GRACHT_EMAIL,
      subject: slots!.subject!,
      text: 'Graag bevestig ik de bezichtiging.',
      messageId: '<a2@nlpf.test>',
      inReplyTo: slots!.id,
    });
    await new Promise((r) => setTimeout(r, 300));
    expect(box.inbox).toHaveLength(2); // the script is done
    expect(box.control.state().pendingReplies).toBe(0);
  });

  test('without autoReply nobody answers until told to', async () => {
    const box = await start({ autoReply: false, speed: 1000 });
    await contactGracht(box, 'dg-2001');
    await new Promise((r) => setTimeout(r, 300));
    expect(box.inbox).toHaveLength(0);
  });

  test('the offer carries a PDF contract with a three month deposit', async () => {
    const box = await start();
    await contactGracht(box, 'dg-2011');
    const sub = box.control.submissions()[0]!;
    await box.control.landlordReply(sub.id, 'offer');
    const [offer] = box.inbox;
    expect(offer!.text).toContain('Wij willen u de woning graag aanbieden');
    expect(offer!.attachments).toHaveLength(1);
    const att = offer!.attachments[0]!;
    expect(att).toMatchObject({ filename: 'concept-huurovereenkomst.pdf', contentType: 'application/pdf' });
    const bytes = readFileSync(att.path!);
    expect(att.size).toBe(bytes.length);
    expect(bytes.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4');
    expect(pdfText(bytes)).toContain('waarborgsom van 3 maanden kale huur');
    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    const served = await fetch(
      `${box.url}/_control/attachments/${box.control.submission(sub.id)!.messages.at(-1)!.attachments[0]!.id}`,
    );
    expect(served.headers.get('content-type')).toBe('application/pdf');
  });

  test('a payment request asks for the deposit before any viewing', async () => {
    const box = await start();
    await contactGracht(box, 'dg-2012');
    await box.control.landlordReply(box.control.submissions()[0]!.id, 'payment_request');
    expect(box.inbox[0]!.text).toContain('borg vooraf');
    expect(box.inbox[0]!.text).toContain('NL00 SBOX');
  });
});

describe('what the agent sends back', () => {
  test('a documents email is recorded with a copy of the attachment', async () => {
    const box = await start();
    await contactGracht(box, 'dg-2002');
    const sub = box.control.submissions()[0]!;
    await box.control.landlordReply(sub.id, 'documents_request');
    const request = box.inbox[0]!;
    const file = join(tmpdir(), `nlpf-sandbox-test-${process.pid}-loonstrook.pdf`);
    writeFileSync(file, '%PDF-1.4 loonstrook');
    await box.send({
      to: GRACHT_EMAIL,
      subject: request.subject!,
      text: 'Hierbij mijn loonstroken.',
      messageId: '<docs@nlpf.test>',
      inReplyTo: request.id,
      attachments: [{ filename: 'loonstrook-augustus.pdf', path: file }],
    });
    const [email] = box.control.emails();
    expect(email).toMatchObject({
      submissionId: sub.id,
      attachments: [{ filename: 'loonstrook-augustus.pdf' }],
    });
    const last = box.control.submission(sub.id)!.messages.at(-1)!;
    expect(last.attachments[0]!.filename).toBe('loonstrook-augustus.pdf');
    expect(readFileSync(last.attachments[0]!.path, 'utf8')).toBe('%PDF-1.4 loonstrook');
  });

  test('a confirmation of an offered time marks the viewing confirmed', async () => {
    const box = await start();
    await contactGracht(box, 'dg-2001');
    const sub = box.control.submissions()[0]!;
    const offered = await box.control.landlordReply(sub.id, 'viewing_slots');
    const slot = offered.slots![1]!;
    const words = slot.text; // "vrijdag 2 oktober om 17:15"
    await box.send({
      to: GRACHT_EMAIL,
      subject: box.inbox[0]!.subject!,
      text: `Dank voor de uitnodiging. Graag bevestig ik de bezichtiging op ${words} (Tulpgracht 12 a, Delft). Ik kijk ernaar uit.`,
      messageId: '<confirm@nlpf.test>',
      inReplyTo: box.inbox[0]!.id,
    });
    expect(box.control.submission(sub.id)!.viewingConfirmed?.slot).toEqual(slot);
    expect(box.control.emails()[0]!.viewingConfirmation).toBe(true);
  });

  test('an email to the agency about one of its homes starts a submission; the landlord answers in its thread', async () => {
    const box = await start({ autoReply: true, speed: 1000 });
    await box.send({
      to: GRACHT_EMAIL,
      from: 'sam@nlpf.test',
      subject: 'Reactie op Lakenweversgracht 31',
      text: 'Beste heer, mevrouw,\n\nIk heb interesse in Lakenweversgracht 31.\n\nMet vriendelijke groet,\nSam de Vries',
      messageId: '<first@nlpf.test>',
    });
    const [sub] = box.control.submissions();
    expect(sub).toMatchObject({
      listingId: 'dg-2002',
      channel: 'email',
      name: 'Sam de Vries',
      email: 'sam@nlpf.test',
    });
    const [reply] = await box.waitForMail(1);
    expect(reply!.inReplyTo).toBe('<first@nlpf.test>');
    expect(reply!.subject).toBe('Re: Reactie op Lakenweversgracht 31');
    expect(reply!.text).toMatch(/loonstroken/);
  });

  test('an email about a home that is gone gets "already rented"', async () => {
    const box = await start({ autoReply: true, speed: 1000 });
    box.control.removeListing('dg-2012', 'rented');
    await box.send({
      to: GRACHT_EMAIL,
      subject: 'Zoutkeetsingel 9',
      text: 'Is Zoutkeetsingel 9 nog beschikbaar?',
      messageId: '<q@nlpf.test>',
    });
    const [reply] = await box.waitForMail(1);
    expect(reply!.text).toContain('al verhuurd');
  });

  test('an email nobody expects is kept without a submission', async () => {
    const box = await start();
    await box.send({ to: 'someone@else.example', subject: 'Hallo', text: 'Hallo' });
    expect(box.control.submissions()).toHaveLength(0);
    expect(box.control.emails()).toMatchObject([{ to: 'someone@else.example', submissionId: null }]);
  });
});

describe('viewingConfirmation', () => {
  const slots = [
    { start: '2026-10-01T16:30:00.000Z', text: 'donderdag 1 oktober om 18:30' },
    {
      start: '2026-10-03T08:00:00.000Z',
      end: '2026-10-03T10:00:00.000Z',
      text: 'zaterdag 3 oktober tussen 10:00 en 12:00',
    },
  ];
  test('finds the slot by day and time, including a time inside a window', () => {
    expect(viewingConfirmation('Graag op donderdag 1 oktober om 18:30.', slots)).toEqual({ slot: slots[0] });
    expect(viewingConfirmation('Ik kom zaterdag 3 oktober om 10:30.', slots)).toEqual({ slot: slots[1] });
    expect(
      viewingConfirmation('I am happy to confirm the viewing on Thursday 1 October at 18:30.', slots),
    ).toEqual({ slot: slots[0] });
  });
  test('a plain confirmation counts, a refusal does not', () => {
    expect(viewingConfirmation('Graag bevestig ik de bezichtiging.', slots)).toEqual({});
    expect(
      viewingConfirmation(
        'Helaas kan ik op de voorgestelde tijden niet. Is een ander moment mogelijk?',
        slots,
      ),
    ).toBeUndefined();
    expect(viewingConfirmation('Wat is het energielabel?', slots)).toBeUndefined();
  });
});

describe('determinism', () => {
  test('the same seed gives the same listings and replies; another seed differs', async () => {
    const run = async (seed: number) => {
      const box = await start({ seed, listings: 'none', now: () => new Date('2026-09-24T10:00:00Z') });
      const added = [box.control.addListing(), box.control.addListing({ city: 'Rotterdam', type: 'studio' })];
      await contactGracht(box, box.control.addListing({ source: 'gracht' }).id);
      const sub = box.control.submissions()[0]!;
      const texts = [];
      for (const kind of ['viewing_slots', 'info_request', 'rejection'] as const) {
        texts.push((await box.control.landlordReply(sub.id, kind)).text.replaceAll(box.url, '<sandbox>'));
      }
      return {
        added: added.map(({ publishedAt: _p, ...rest }) => rest),
        texts,
        ids: box.inbox.map((m) => m.id),
      };
    };
    const a = await run(11);
    const b = await run(11);
    const c = await run(12);
    expect(b).toEqual(a);
    expect(c.added).not.toEqual(a.added);
  });

  test('waitFor gives up with a clear error', async () => {
    await expect(waitFor(() => undefined, 30)).rejects.toThrow(/timed out/);
  });
});
