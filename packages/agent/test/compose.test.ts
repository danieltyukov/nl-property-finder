import { describe, expect, test } from 'vitest';
import { AutomationSchema, type AutomationConfig } from '@nlpf/core';
import { cleanCopy, composeInput, finaliseMessage, followUpText, messageLanguage, withdrawalText } from '../src/compose.js';
import { listing, profile } from './helpers.js';

const automation = (over: Partial<AutomationConfig> = {}): AutomationConfig => ({ ...AutomationSchema.parse({}), ...over });
const dutch = listing({ description: 'Mooi appartement in het centrum van Delft, per direct beschikbaar voor een net persoon.' });
const english = listing({ description: 'Lovely apartment in the centre of Delft, available now for a tidy tenant.', language: 'en' });

describe('messageLanguage', () => {
  test('auto follows the listing, an explicit choice wins', () => {
    expect(messageLanguage(profile(), dutch)).toBe('nl');
    expect(messageLanguage(profile(), english)).toBe('en');
    expect(messageLanguage(profile({ messageLanguage: 'en' }), dutch)).toBe('en');
    expect(messageLanguage(profile({ messageLanguage: 'nl' }), english)).toBe('nl');
    expect(messageLanguage(profile(), listing({ description: undefined, title: 'Oude Delft 12A' }))).toBe('nl');
  });
});

test('composeInput picks the template for the language and the channel limit', () => {
  const a = automation({ templates: { first: { nl: 'Beste {firstName}', en: 'Dear landlord' } } });
  expect(composeInput(dutch, profile(), a, 'form', 'short')).toMatchObject({ template: 'Beste {firstName}', language: 'nl', channel: 'form', maxChars: 2000, variant: 'short' });
  expect(composeInput(english, profile(), a, 'message')).toMatchObject({ template: 'Dear landlord', language: 'en', maxChars: 1500 });
  expect(composeInput(english, profile(), a, 'message').variant).toBeUndefined();
});

describe('finaliseMessage', () => {
  test('removes dashes used as punctuation and emojis', () => {
    expect(cleanCopy('Hallo — ik ben Sam 😊 en ik zoek een woning – graag!')).toBe('Hallo, ik ben Sam en ik zoek een woning, graag!');
    expect(cleanCopy('Een twee-onder-een-kapwoning, 2026-11-01')).toBe('Een twee-onder-een-kapwoning, 2026-11-01');
  });

  test('adds the disclosure line once, in the message language', () => {
    const a = automation({ disclosure: { enabled: true, nl: 'Dit bericht is opgesteld met hulp van mijn assistent.', en: 'This message was drafted with help from my assistant.' } });
    const nl = finaliseMessage({ body: 'Beste verhuurder,\n\nGroet, Sam', rationale: 'r' }, a, 'nl');
    expect(nl.body.endsWith('Dit bericht is opgesteld met hulp van mijn assistent.')).toBe(true);
    expect(finaliseMessage(nl, a, 'nl').body).toBe(nl.body);
    expect(finaliseMessage({ body: 'Hi', rationale: 'r' }, automation(), 'en').body).toBe('Hi');
  });

  test('keeps the message within the channel limit at a sentence end', () => {
    const body = 'Eerste zin is kort. Tweede zin is ook kort. Derde zin maakt het te lang voor dit kanaal.';
    const out = finaliseMessage({ body, rationale: 'r' }, automation(), 'nl', 45);
    expect(out.body).toBe('Eerste zin is kort. Tweede zin is ook kort.');
  });
});

test('built-in withdrawal and follow-up texts', () => {
  const p = profile();
  expect(withdrawalText(automation(), p, 'nl')).toMatch(/woning gevonden/);
  expect(withdrawalText(automation(), p, 'en')).toMatch(/found a place/);
  expect(withdrawalText(automation({ withdraw: { nl: 'Eigen tekst, {firstName}', en: '' } }), p, 'nl')).toBe('Eigen tekst, Sam');
  expect(followUpText(p, dutch, 'nl')).toMatch(/Oude Delft 12A/);
  expect(followUpText(p, english, 'en')).toMatch(/still interested/);
  for (const t of [withdrawalText(automation(), p, 'nl'), followUpText(p, dutch, 'en')]) expect(t).not.toMatch(/[—–]/);
});
