import { expect, test } from 'vitest';
import { parseEmail } from '../src/parse.js';
import { buildEmail } from '../src/smtp.js';

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
