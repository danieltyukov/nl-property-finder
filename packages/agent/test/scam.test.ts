import { expect, test } from 'vitest';
import { scamLevel, scamSignals, scamVerdict } from '../src/scam.js';
import { listing } from './helpers.js';

const amsterdam = { street: 'Keizersgracht', houseNumber: '100', postcode: '1015 AA', city: 'Amsterdam', municipality: 'Amsterdam' };

test('a cheap Amsterdam flat from a landlord abroad who posts the keys is likely a scam', () => {
  const l = listing({
    sourceId: 'marktplaats',
    sizeM2: 25,
    priceEur: 450,
    address: amsterdam,
    description: 'I am currently abroad, send the deposit and I will post the keys.',
  });
  const signals = scamSignals(l, { medianPricePerM2: 35 });
  expect(signals).toEqual(expect.arrayContaining(['price_far_below_median', 'landlord_abroad', 'payment_before_viewing', 'keys_by_post']));
  expect(scamLevel(signals)).toBe('likely');
});

test('an ordinary listing has no signals', () => {
  const l = listing({ description: 'Lichte woning met balkon. Bezichtiging op afspraak via ons kantoor.', priceEur: 1250, sizeM2: 40 });
  expect(scamSignals(l, { medianPricePerM2: 28 })).toEqual([]);
  expect(scamLevel([])).toBe('none');
});

test('Dutch phrasings', () => {
  const l = listing({
    description: 'Ik woon momenteel in het buitenland. Maak eerst de borg over, dan stuur ik de sleutels per post. Alleen contact via WhatsApp: +44 7700 900123.',
  });
  expect(scamSignals(l, {})).toEqual(expect.arrayContaining(['landlord_abroad', 'payment_before_viewing', 'keys_by_post', 'whatsapp_only']));
});

test('off-platform contact and a missing address', () => {
  const l = listing({ address: { city: 'Delft' }, description: 'Please email me directly at verhuur.delft1970@gmail.com for details.' });
  const signals = scamSignals(l, {});
  expect(signals).toEqual(expect.arrayContaining(['off_platform_contact', 'no_address']));
  expect(scamLevel(signals)).toBe('possible');
});

test('too good to be true stories', () => {
  const l = listing({ description: 'God bless you. I am an honest man and I only want a trustworthy tenant for my late mother\'s apartment, no questions asked.' });
  expect(scamSignals(l, {})).toContain('too_good_description');
});

test('a price below median only counts with a median and a size', () => {
  expect(scamSignals(listing({ priceEur: 300, sizeM2: undefined }), { medianPricePerM2: 30 })).not.toContain('price_far_below_median');
  expect(scamSignals(listing({ priceEur: 300, sizeM2: 40 }), {})).not.toContain('price_far_below_median');
});

test('an agent office address on the listing is not off-platform contact', () => {
  const l = listing({ agent: { name: 'Makelaardij Delft', email: 'info@makelaardijdelft.nl' }, description: 'Neem contact op met info@makelaardijdelft.nl.' });
  expect(scamSignals(l, {})).not.toContain('off_platform_contact');
});

test('verdict bundles level and signals', () => {
  expect(scamVerdict(['payment_before_viewing'])).toEqual({ level: 'possible', signals: ['payment_before_viewing'] });
  expect(scamVerdict(['payment_before_viewing', 'keys_by_post'])).toMatchObject({ level: 'likely' });
});
