import { expect, test } from 'vitest';
import type { InboundMessage } from '@nlpf/core';
import { emailConfirmation } from '../src/confirmEmail.js';

const mail = (over: Partial<InboundMessage>): InboundMessage => ({
  id: '<in@leadflow.example>',
  channel: 'email',
  from: { address: 'contact@leadflow.rent' },
  subject: '[Actie vereist] Welkom bij leadflow Sam de Vries! Bevestig jouw e-mailadres.',
  text: '',
  at: '2026-10-01T18:57:06.000Z',
  attachments: [],
  ...over,
});

// The shape of the real message: a logo link, a link on the service name, then the button.
const LEADFLOW = [
  '( https://u1.ct.sendgrid.net/ls/click?upn=logo-AAA )',
  '',
  'Bevestig jouw e-mailadres',
  '',
  'Beste Sam de Vries,',
  '',
  'Je hebt gereageerd op de woning aan de Rietdijk, 3082DS, Rotterdam, aangeboden door Randstad Vastgoed. Deze makelaar gebruikt onze applicatie, *leadflow* ( https://u1.ct.sendgrid.net/ls/click?upn=about-BBB ) , om de aanvragen te verwerken.',
  '',
  'Bevestig e-mailadres ( https://u1.ct.sendgrid.net/ls/click?upn=confirm-CCC-3D-3D )',
  '',
  'Wij werken samen met Pararius ( https://u1.ct.sendgrid.net/ls/click?upn=pararius-DDD ).',
].join('\n');

test('a lead platform asking to confirm the address gives the confirmation link, not the logo or a footer link', () => {
  expect(emailConfirmation(mail({ text: LEADFLOW }))).toEqual({
    service: 'leadflow',
    url: 'https://u1.ct.sendgrid.net/ls/click?upn=confirm-CCC-3D-3D',
  });
});

test('a plain-text link on the line under its label is found', () => {
  const text = 'Hello,\n\nPlease verify your email address by opening this link:\nhttps://portal.example/verify?t=abc.\n\nThanks';
  expect(emailConfirmation(mail({ from: { name: 'Rental Portal', address: 'no-reply@portal.example' }, subject: 'Welcome', text }))).toEqual({
    service: 'Rental Portal',
    url: 'https://portal.example/verify?t=abc',
  });
});

test('without a labelled link it is still a confirmation request, with no link to offer', () => {
  const text = 'Bevestig je e-mailadres in de app.\n\nOns kantoor:\nhttps://leadflow.example/contact';
  expect(emailConfirmation(mail({ text }))).toEqual({ service: 'leadflow' });
});

test('a confirmation that a reaction arrived is not a request to confirm the email address', () => {
  const funda = mail({
    from: { name: 'Funda', address: 'noreply@funda.nl' },
    subject: 'Bevestiging van je reactie op Rietdijk 2-B Rotterdam',
    text: 'Je reactie is verstuurd naar de makelaar. Bekijk de woning: https://www.funda.nl/detail/123',
  });
  expect(emailConfirmation(funda)).toBeUndefined();
  expect(emailConfirmation(mail({ subject: 'Re: uw reactie', text: 'Kunt u donderdag om 14:00 komen kijken?' }))).toBeUndefined();
});

test('a link ending in a long run of punctuation is trimmed without slowing down', () => {
  const tail = `${'!'.repeat(100_000)}x`;
  const text = `Please verify your email address:\nhttps://portal.example/verify?t=${tail}!!.\n`;
  const t0 = performance.now();
  expect(emailConfirmation(mail({ subject: 'Welcome', text }))?.url).toBe(`https://portal.example/verify?t=${tail}`);
  expect(performance.now() - t0).toBeLessThan(200);
});
