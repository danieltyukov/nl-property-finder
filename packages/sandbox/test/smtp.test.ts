import { createServer, type Server } from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { simpleParser } from 'mailparser';
import { GRACHT_EMAIL, pdfText, startSandbox, type Sandbox } from '../src/index.js';
import { waitFor } from './helpers.js';

/** A minimal SMTP server on 127.0.0.1 that keeps every message, standing in for GreenMail. */
function smtpSink(): Promise<{
  server: Server;
  port: number;
  messages: { from: string; to: string[]; raw: string }[];
}> {
  const messages: { from: string; to: string[]; raw: string }[] = [];
  const server = createServer((socket) => {
    let from = '';
    let to: string[] = [];
    let data: string | undefined;
    let buffer = '';
    socket.write('220 sink ESMTP\r\n');
    socket.on('data', (chunk) => {
      buffer += chunk.toString('latin1');
      for (;;) {
        if (data !== undefined) {
          const end = buffer.indexOf('\r\n.\r\n');
          if (end === -1) return;
          data += buffer.slice(0, end);
          buffer = buffer.slice(end + 5);
          messages.push({ from, to, raw: data.replace(/\r\n\.\./g, '\r\n.') });
          data = undefined;
          socket.write('250 OK\r\n');
          continue;
        }
        const nl = buffer.indexOf('\r\n');
        if (nl === -1) return;
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 2);
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === 'EHLO' || cmd === 'HELO') socket.write('250 sink\r\n');
        else if (cmd === 'MAIL') {
          from = /<([^>]*)>/.exec(line)?.[1] ?? '';
          to = [];
          socket.write('250 OK\r\n');
        } else if (cmd === 'RCPT') {
          to.push(/<([^>]*)>/.exec(line)?.[1] ?? '');
          socket.write('250 OK\r\n');
        } else if (cmd === 'DATA') {
          data = '';
          socket.write('354 go ahead\r\n');
        } else if (cmd === 'QUIT') socket.end('221 bye\r\n');
        else socket.write('250 OK\r\n');
      }
    });
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, port: (server.address() as AddressInfo).port, messages }),
    ),
  );
}

let sink: Awaited<ReturnType<typeof smtpSink>>;
let box: Sandbox;

beforeAll(async () => {
  sink = await smtpSink();
  box = await startSandbox({
    seed: 5,
    autoReply: false,
    mail: { smtp: { host: '127.0.0.1', port: sink.port }, from: 'sandbox@nlpf.test', to: 'agent@nlpf.test' },
  });
});
afterAll(async () => {
  await box.stop();
  await new Promise((r) => sink.server.close(r));
});

test('landlord email goes out over SMTP with threading headers and the contract attached', async () => {
  await fetch(`${box.url}/gracht/contact`, {
    method: 'POST',
    body: new URLSearchParams({
      object: 'dg-2011',
      naam: 'Sam de Vries',
      email: 'sam@nlpf.test',
      bericht: 'Graag kom ik kijken.',
    }),
  });
  const sub = box.control.submissions()[0]!;
  const first = await box.control.landlordReply(sub.id, 'viewing_slots');
  await waitFor(() => (sink.messages.length >= 1 ? true : undefined));
  const one = await simpleParser(sink.messages[0]!.raw);
  expect(sink.messages[0]).toMatchObject({ from: 'sandbox@nlpf.test', to: ['agent@nlpf.test'] });
  expect(one.messageId).toBe(first.messageId);
  expect(one.from?.value[0]?.address).toBe(GRACHT_EMAIL);
  expect(one.subject).toBe('Re: Kustlichtkade 140');
  expect(one.text).toContain('Kustlichtkade 140');

  box.control.receiveMail({
    to: GRACHT_EMAIL,
    subject: one.subject!,
    text: 'Ik kom graag.',
    messageId: '<reply@nlpf.test>',
    inReplyTo: one.messageId,
  });
  await box.control.landlordReply(sub.id, 'offer');
  await waitFor(() => (sink.messages.length >= 2 ? true : undefined));
  const two = await simpleParser(sink.messages[1]!.raw);
  expect(two.inReplyTo).toBe('<reply@nlpf.test>');
  expect(two.references).toEqual([one.messageId, '<reply@nlpf.test>']);
  expect(two.attachments).toHaveLength(1);
  expect(two.attachments[0]).toMatchObject({
    filename: 'concept-huurovereenkomst.pdf',
    contentType: 'application/pdf',
  });
  expect(pdfText(two.attachments[0]!.content)).toContain('waarborgsom van 3 maanden kale huur');
});
