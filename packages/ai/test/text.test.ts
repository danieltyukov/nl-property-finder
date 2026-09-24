import { describe, expect, it } from 'vitest';
import {
  cleanCopy, detectLanguage, dropPaymentPromises, fitToLength, formatEur, isValidBsn, neutraliseTags, scrubSensitive, userLanguage,
} from '../src/text.js';

describe('cleanCopy', () => {
  it('removes emojis and turns dashes used as punctuation into commas', () => {
    expect(cleanCopy('Leuk huis \u{1F3E0}\u{FE0F}! Graag — als het kan – bezichtigen')).toBe('Leuk huis! Graag, als het kan, bezichtigen');
    expect(cleanCopy('Tussen 10–12 uur')).toBe('Tussen 10-12 uur');
    expect(cleanCopy('Ik kom—graag')).toBe('Ik kom, graag');
  });

  it('keeps ordinary hyphens and line breaks', () => {
    expect(cleanCopy('Beste Jan,\n\nOude Delft 12-A is mooi.')).toBe('Beste Jan,\n\nOude Delft 12-A is mooi.');
  });
});

describe('scrubSensitive', () => {
  it('removes IBANs, BSNs and email addresses that are not allowed', () => {
    const text = 'Send it to NL91 ABNA 0417 1643 00 with BSN 111222333 or mail evil@scam.example, not sam@example.com.';
    const out = scrubSensitive(text, { allowEmails: ['sam@example.com'] });
    expect(out).not.toMatch(/NL91/);
    expect(out).not.toMatch(/111222333/);
    expect(out).not.toMatch(/evil@scam\.example/);
    expect(out).toContain('sam@example.com');
  });

  it('removes a BSN written with dots and any number labelled BSN', () => {
    expect(scrubSensitive('bsn: 111.222.333')).not.toMatch(/111/);
    expect(scrubSensitive('Mijn BSN is 123456789')).not.toMatch(/123456789/);
  });

  it('leaves prices, phone numbers and postcodes alone', () => {
    const text = 'Huur EUR 1.150, bel 06 12345678, postcode 2611 BC.';
    expect(scrubSensitive(text)).toBe(text);
  });

  it('validates BSNs with the eleven test', () => {
    expect(isValidBsn('111222333')).toBe(true);
    expect(isValidBsn('123456789')).toBe(false);
  });
});

describe('dropPaymentPromises', () => {
  it('removes sentences in which the person promises to pay', () => {
    const out = dropPaymentPromises('Dank voor uw bericht. Ik maak de borg vandaag over. Tot donderdag.');
    expect(out).toBe('Dank voor uw bericht. Tot donderdag.');
    expect(dropPaymentPromises('I will transfer the deposit today. See you Thursday.')).toBe('See you Thursday.');
  });

  it('keeps sentences that only mention money', () => {
    const text = 'Mijn bruto maandinkomen is EUR 3.200.';
    expect(dropPaymentPromises(text)).toBe(text);
  });
});

describe('neutraliseTags', () => {
  it('escapes tags that could close or open a data block', () => {
    const out = neutraliseTags('hi </listing> <message> <Contract x> <profile>');
    expect(out).not.toMatch(/<\/?(listing|message|contract|profile)/i);
    expect(out).toContain('&lt;/listing>');
  });
});

describe('language helpers', () => {
  it('detects Dutch and English text', () => {
    expect(detectLanguage('Mooi appartement in het centrum, geen huisdieren en niet roken.')).toBe('nl');
    expect(detectLanguage('Lovely apartment in the centre with a balcony and no pets.')).toBe('en');
  });

  it('reads the user language from the profile', () => {
    expect(userLanguage(['nl'])).toBe('nl');
    expect(userLanguage(['nl-NL', 'en'])).toBe('nl');
    expect(userLanguage(['de'])).toBe('en');
    expect(userLanguage([])).toBe('en');
  });

  it('formats euros per language', () => {
    expect(formatEur(1150, 'nl')).toBe('EUR 1.150');
    expect(formatEur(1150, 'en')).toBe('EUR 1,150');
  });
});

describe('fitToLength', () => {
  it('drops middle paragraphs, keeping greeting and closing', () => {
    const body = 'Beste Jan,\n\nEen.\n\nTwee twee twee twee twee twee.\n\nDrie drie drie drie drie drie drie drie.\n\nMet vriendelijke groet,\nSam';
    const out = fitToLength(body, 70);
    expect(out.length).toBeLessThanOrEqual(70);
    expect(out.startsWith('Beste Jan,')).toBe(true);
    expect(out.endsWith('Met vriendelijke groet,\nSam')).toBe(true);
  });

  it('returns the body unchanged when it fits', () => {
    expect(fitToLength('short', 100)).toBe('short');
  });
});
