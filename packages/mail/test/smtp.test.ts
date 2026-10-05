import { createServer, type AddressInfo } from 'node:net';
import { Resolver } from 'node:dns';
import { MailSchema } from '@nlpf/core';
import { dnsCache } from 'nodemailer/lib/shared';
import { expect, test, vi } from 'vitest';
import { parseEmail } from '../src/parse.js';
import { buildEmail, createSmtpSender } from '../src/smtp.js';

test('a reply carries a fresh Message-ID, In-Reply-To and References that thread back', async () => {
  const built = await buildEmail(
    'agent@nlpf.test',
    { to: 'jan@example.test', subject: 'Re: Oude Delft 12A', text: 'Donderdag 18:30 past goed.', inReplyTo: 'reply-1@example.test', references: ['<out-1@nlpf.test>'] },
    { fromName: 'Sam de Vries' },
  );
  expect(built.messageId).toMatch(/^<[0-9a-f-]{36}@nlpf\.test>$/);
  const back = await parseEmail(built.raw);
  expect(back.id).toBe(built.messageId);
  expect(back.from).toEqual({ name: 'Sam de Vries', address: 'agent@nlpf.test' });
  expect(back.to).toEqual(['jan@example.test']);
  expect(back.inReplyTo).toBe('<reply-1@example.test>');
  expect(back.references).toEqual(['<out-1@nlpf.test>', '<reply-1@example.test>']);
  expect(back.subject).toBe('Re: Oude Delft 12A');
  expect(back.text).toBe('Donderdag 18:30 past goed.');
  expect(built.raw.toString()).not.toMatch(/X-Mailer/i);
});

test('a first message has no thread headers', async () => {
  const built = await buildEmail('agent@nlpf.test', { to: 'jan@example.test', subject: 'Reactie', text: 'Beste Jan' });
  const back = await parseEmail(built.raw);
  expect(back.inReplyTo).toBeUndefined();
  expect(back.references).toBeUndefined();
});

test('replies are asked for at the sending address, even if the server rewrites From', async () => {
  // Gmail may put the login address on the From line of a +address; Reply-To keeps the +address.
  const built = await buildEmail('sam+huur@example.test', { to: 'jan@example.test', subject: 'Reactie', text: 'Beste Jan' });
  expect(built.raw.toString()).toMatch(/^Reply-To: sam\+huur@example\.test\r$/m);
});

/** A minimal SMTP server on 127.0.0.1 that accepts one login and any message. */
async function fakeSmtp(): Promise<{ port: number; data: string[]; close(): Promise<void> }> {
  const data: string[] = [];
  const server = createServer((socket) => {
    socket.setEncoding('utf8');
    socket.write('220 fake ESMTP\r\n');
    let inData = false;
    let buf = '';
    socket.on('data', (chunk: string) => {
      buf += chunk;
      let i: number;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (inData) {
          if (line === '.') {
            inData = false;
            socket.write('250 queued\r\n');
          } else data.push(line);
          continue;
        }
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === 'EHLO') socket.write('250-fake\r\n250 AUTH PLAIN\r\n');
        else if (cmd === 'AUTH') socket.write('235 ok\r\n');
        else if (cmd === 'DATA') {
          inData = true;
          socket.write('354 go on\r\n');
        } else if (cmd === 'QUIT') socket.end('221 bye\r\n');
        else socket.write('250 ok\r\n');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { port, data, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

test('sending works when the mail library only knows the IPv6 address', async () => {
  // A service started at boot, before Wi-Fi had an IPv4 address: nodemailer read the interface
  // table once, never asked DNS for IPv4 again, and only knew the host's IPv6 address, which
  // this network cannot reach. Here DNS gives it ::1 alone, where nothing listens.
  dnsCache.clear();
  const resolve4 = vi.spyOn(Resolver.prototype, 'resolve4').mockImplementation(((_h: string, cb: (e: Error | null, a: string[]) => void) => cb(null, [])) as never);
  const resolve6 = vi.spyOn(Resolver.prototype, 'resolve6').mockImplementation(((_h: string, cb: (e: Error | null, a: string[]) => void) => cb(null, ['::1'])) as never);
  const server = await fakeSmtp();
  const sender = createSmtpSender(
    MailSchema.parse({ provider: 'imap', address: 'agent@nlpf.test', smtp: { host: 'localhost', port: server.port, secure: false } }),
    'secret',
  );
  try {
    await sender.send({ to: 'jan@example.test', subject: 'Reactie', text: 'Beste Jan' });
    expect(server.data).toContain('Beste Jan');
  } finally {
    sender.close();
    resolve4.mockRestore();
    resolve6.mockRestore();
    dnsCache.clear();
    await server.close();
  }
});
