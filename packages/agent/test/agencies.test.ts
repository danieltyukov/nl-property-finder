import { describe, expect, test } from 'vitest';
import type { RawListing } from '@nlpf/core';
import { agencyByPhotoHost } from '../src/agencies.js';
import { normaliseListing } from '../src/normalise.js';
import { planContact } from '../src/router.js';
import { adapter, config, listing, registryOf } from './helpers.js';

// Huurwoningen shows the agent only to paying members, but its photos keep the
// address they were copied from: https://citybird-rentals.com/media/... names CityBird Rentals.
const paywalled = (over: Partial<RawListing> = {}): RawListing => ({
  sourceId: 'huurwoningen',
  externalId: '77c0bd3b',
  url: 'https://www.huurwoningen.nl/huren/rotterdam/77c0bd3b/vlietlaan/',
  title: 'Appartement Vlietlaan',
  address: { street: 'Vlietlaan', postcode: '3061 DW', city: 'Rotterdam' },
  contact: 'form',
  extra: { imageOrigin: 'citybird-rentals.com' },
  ...over,
});

describe('agencyByPhotoHost', () => {
  test('knows an agent by the website its photos come from, with or without www or a subdomain', () => {
    expect(agencyByPhotoHost('citybird-rentals.com')).toMatchObject({ name: 'CityBird Rentals', email: 'info@citybird-rentals.com' });
    expect(agencyByPhotoHost('WWW.Citybird-Rentals.com')?.email).toBe('info@citybird-rentals.com');
    expect(agencyByPhotoHost('media.citybird-rentals.com')?.email).toBe('info@citybird-rentals.com');
  });

  test('an agent that takes reactions on its own website only is not emailed', () => {
    expect(agencyByPhotoHost('athomevastgoed.nl')).toBeUndefined();
    expect(agencyByPhotoHost('admin.nrw-wonen.nl')).toBeUndefined();
  });

  test('does not match a software vendor, a lookalike domain or nothing at all', () => {
    expect(agencyByPhotoHost('images.realworks.nl')).toBeUndefined();
    expect(agencyByPhotoHost('notcitybird-rentals.com')).toBeUndefined();
    expect(agencyByPhotoHost('com')).toBeUndefined();
    expect(agencyByPhotoHost(undefined)).toBeUndefined();
  });
});

describe('normaliseListing', () => {
  test('names the agent of a listing whose photos come from a known agent website', () => {
    expect(normaliseListing(paywalled()).agent).toEqual({
      name: 'CityBird Rentals',
      url: 'https://citybird-rentals.com',
      email: 'info@citybird-rentals.com',
    });
  });

  test('keeps an agent email the source already gave', () => {
    const n = normaliseListing(paywalled({ agent: { name: 'Someone Else', email: 'verhuur@someone.test' } }));
    expect(n.agent).toEqual({ name: 'Someone Else', email: 'verhuur@someone.test' });
  });

  test('leaves a listing with photos from elsewhere alone', () => {
    expect(normaliseListing(paywalled({ extra: { imageOrigin: 'images.realworks.nl' } })).agent).toBeUndefined();
  });
});

test('a home only on a paid platform is emailed to the agent its photos name', () => {
  const huurwoningen = adapter({
    id: 'huurwoningen',
    name: 'Huurwoningen',
    capabilities: { search: 'html', detail: true, contact: 'form', login: 'required', paid: { feature: 'contact', plan: 'huurwoningen-premium' }, terms: 'forbids' },
  });
  const n = normaliseListing(paywalled());
  const l = listing({ ...n, id: 'huurwoningen:77c0bd3b', propertyId: 'p1' });
  const plan = planContact(l, [], registryOf([huurwoningen]), config());
  expect(plan).toMatchObject({ plan: 'send', channel: { kind: 'email', address: 'info@citybird-rentals.com' } });
});
