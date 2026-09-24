import { readFileSync } from 'node:fs';
import type { ParsedMail } from 'mailparser';
import { describe, expect, test } from 'vitest';
import { parseEmail, toInbound } from '../src/parse.js';

const fixture = (name: string): Buffer => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));

/** A minimal ParsedMail for header-level tests. */
const parsed = (over: Partial<Omit<ParsedMail, 'headers'>> & { headers?: Record<string, string> } = {}): ParsedMail => {
  const { headers, ...rest } = over;
  return {
    attachments: [],
    headers: new Map(Object.entries(headers ?? {})),
    headerLines: [],
    html: false,
    text: 'Hallo',
    messageId: '<m-1@example.test>',
    date: new Date('2026-09-23T08:00:00Z'),
    from: { value: [{ address: 'landlord@example.test', name: '' }], html: '', text: '' },
    ...rest,
  } as ParsedMail;
};

describe('parseEmail', () => {
  test('a plain text reply keeps sender, recipients, thread headers and the full text', async () => {
    const m = await parseEmail(fixture('plain-reply.eml'));
    expect(m.id).toBe('<CAF7x9q1-reply-0001@mail.devriesverhuur.nl>');
    expect(m.channel).toBe('email');
    expect(m.from).toEqual({ name: 'Jan de Vries', address: 'jan@devriesverhuur.nl' });
    expect(m.to).toEqual(['agent@nlpf.test', 'kantoor@devriesverhuur.nl']);
    expect(m.subject).toBe('Re: Reactie op Oude Delft 12A');
    expect(m.inReplyTo).toBe('<out-0002@nlpf.test>');
    expect(m.references).toEqual(['<out-0001@nlpf.test>', '<out-0002@nlpf.test>']);
    expect(m.at).toBe('2026-09-23T07:14:00.000Z');
    expect(m.text).toContain('De huur is € 1.495 per maand');
    expect(m.text).toContain('donderdag 24 september om 18:30');
    expect(m.text).toContain('Eén persoon');
    expect(m.text).toContain('schreef Sam de Vries'); // quoted history is kept
    expect(m.html).toBeUndefined();
    expect(m.autoSubmitted).toBe(false);
    expect(m.attachments).toEqual([]);
  });

  test('an HTML-only message gets a text version without markup, styles or comments', async () => {
    const m = await parseEmail(fixture('html-only.eml'));
    expect(m.from).toEqual({ name: 'Lettings Team', address: 'lettings@canalhomes.example' });
    expect(m.to).toEqual(['agent@nlpf.test']);
    expect(m.html).toContain('<b>Thursday 1 October at 17:15</b>');
    expect(m.text).toContain('Thursday 1 October at 17:15');
    expect(m.text).toContain('€ 1.850 per month'); // one block per line, never wrapped mid-phrase
    expect(m.text).toContain('Westvest 95 [https://canalhomes.example/rent/westvest-95]');
    expect(m.text).not.toContain('<p>');
    expect(m.text).not.toContain('color: #333');
    expect(m.text).not.toContain('Synthetic fixture');
    expect(m.inReplyTo).toBeUndefined();
    expect(m.references).toBeUndefined();
  });

  test('a Dutch message with an attachment lists the attachment and skips inline images', async () => {
    const m = await parseEmail(fixture('dutch-attachment.eml'));
    expect(m.from).toEqual({ name: 'Makelaardij Hoogland & Zn.', address: 'verhuur@hoogland-makelaardij.nl' });
    expect(m.subject).toBe('Huurovereenkomst Oude Delft 12A, borg € 2.990');
    expect(m.inReplyTo).toBe('<out-0007@nlpf.test>');
    expect(m.text).toContain('De borg bedraagt € 2.990');
    expect(m.text).toContain('vóór maandag');
    expect(m.attachments).toEqual([
      { filename: 'Huurovereenkomst Oude Delft 12A.pdf', contentType: 'application/pdf', size: 77 },
    ]);
  });

  test('an out-of-office reply is marked auto-submitted', async () => {
    const m = await parseEmail(fixture('out-of-office.eml'));
    expect(m.autoSubmitted).toBe(true);
    expect(m.subject).toBe('Automatisch antwoord: Reactie op Westvest 95');
  });
});

describe('toInbound', () => {
  test.each([
    [{ 'auto-submitted': 'auto-generated' }, true],
    [{ 'auto-submitted': 'auto-replied; owner-email="x@example.test"' }, true],
    [{ 'auto-submitted': 'no' }, false],
    [{ 'auto-submitted': 'No (a person wrote this)' }, false],
    [{ 'x-autoreply': 'yes' }, true],
    [{ 'x-autorespond': 'Vacation' }, true],
    [{ precedence: 'bulk' }, true],
    [{ precedence: 'list' }, true],
    [{ precedence: 'Auto_Reply' }, true],
    [{ precedence: 'first-class' }, false],
    [{}, false],
  ])('headers %j give autoSubmitted %s', (headers, expected) => {
    expect(toInbound(parsed({ headers })).autoSubmitted).toBe(expected);
  });

  test('HTML is converted to text when the parsed mail has no text part', () => {
    const m = toInbound(
      parsed({
        text: undefined,
        html: '<div>Hallo&nbsp;Sam,</div><p>Bezichtiging <b>za 10:00</b> &amp; koffie</p><script>track()</script>',
      }),
    );
    expect(m.text).toContain('Hallo Sam,');
    expect(m.text).toContain('Bezichtiging za 10:00 & koffie');
    expect(m.text).not.toContain('track()');
    expect(m.html).toContain('<b>za 10:00</b>');
  });

  test('a message without a Message-ID gets a stable id derived from its content', () => {
    const a = toInbound(parsed({ messageId: undefined }));
    const b = toInbound(parsed({ messageId: undefined }));
    const c = toInbound(parsed({ messageId: undefined, text: 'Iets anders' }));
    expect(a.id).toMatch(/^<[^@<>]+@[^@<>]+>$/);
    expect(a.id).toBe(b.id);
    expect(a.id).not.toBe(c.id);
  });

  test('the received time is used when the Date header is missing', () => {
    const m = toInbound(parsed({ date: undefined }), { receivedAt: new Date('2026-09-23T10:11:12Z') });
    expect(m.at).toBe('2026-09-23T10:11:12.000Z');
  });

  test('long runs of spaces are trimmed in linear time', () => {
    const t0 = performance.now();
    const m = toInbound(parsed({ text: `Hallo${' '.repeat(200_000)}x   \nregel twee   ` }));
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(m.text.endsWith('x\nregel twee')).toBe(true);
  });

  test('a sender without a display name has no name field', () => {
    expect(toInbound(parsed()).from).toEqual({ address: 'landlord@example.test' });
  });
});
