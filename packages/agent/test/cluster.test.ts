import { describe, expect, test } from 'vitest';
import { openStore, type Address } from '@nlpf/core';
import { assignProperty, clusterKey, splitHouseNumber } from '../src/cluster.js';
import { listing } from './helpers.js';

const NOW = '2026-09-23T10:00:00.000Z';

describe('clusterKey (Review Focus 1)', () => {
  test('three spellings of one address give one postcode key', () => {
    const fb = { title: 'x' };
    const a: Address = { street: 'Oude Delft', houseNumber: '12-A', postcode: '2611 CC', city: 'Delft' };
    const b: Address = { street: 'Oude Delft', houseNumber: '12A', postcode: '2611CC', city: 'DELFT' };
    const c: Address = {
      street: 'Oude Delft',
      houseNumber: '12',
      addition: ' a',
      postcode: '2611 cc',
      city: 'Delft',
    };
    expect(clusterKey(a, fb)).toBe('pc:2611CC:12:a');
    expect(clusterKey(b, fb)).toBe('pc:2611CC:12:a');
    expect(clusterKey(c, fb)).toBe('pc:2611CC:12:a');
  });

  test('street keys survive spelling differences when the postcode is unknown', () => {
    const fb = { title: 'x' };
    const keys = [
      clusterKey({ street: 'Oude Delft', houseNumber: '12-A', city: 'Delft' }, fb),
      clusterKey({ street: 'oude  delft', houseNumber: '12A', city: 'delft' }, fb),
      clusterKey({ street: 'Oude Delft', houseNumber: '12', addition: 'a', city: 'Delft' }, fb),
      clusterKey({ street: 'Oude Delft', houseNumber: '12 a', city: 'Delft' }, fb),
    ];
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe('addr:delft:oudedelft:12a');
  });

  test('abbreviations and diacritics normalise', () => {
    const fb = { title: 'x' };
    expect(clusterKey({ street: 'Burg. Jamessingel', houseNumber: '3', city: "'s-Gravenhage" }, fb)).toBe(
      clusterKey({ street: 'Burgemeester Jamessingel', houseNumber: '3', city: 'Den Haag' }, fb),
    );
    expect(clusterKey({ street: 'Café Straat', houseNumber: '1', city: 'Delft' }, fb)).toBe(
      clusterKey({ street: 'Cafe Straat', houseNumber: '1', city: 'Delft' }, fb),
    );
  });

  test('fingerprint when the house number is unknown', () => {
    expect(
      clusterKey({ city: 'Delft' }, { title: 'Ruim appartement in centrum', priceEur: 1260, sizeM2: 42 }),
    ).toBe('fp:delft:ruim-appartement-centrum:1250:40');
    expect(clusterKey({ street: 'Oude Delft', city: 'Delft' }, { title: 'x', priceEur: 1299 })).toBe(
      'fp:delft:oudedelft:1250:x',
    );
  });

  test('house number splitting', () => {
    expect(splitHouseNumber('12-A')).toEqual({ number: '12', addition: 'a' });
    expect(splitHouseNumber('12 bis')).toEqual({ number: '12', addition: 'bis' });
    expect(splitHouseNumber('123-III')).toEqual({ number: '123', addition: '3' });
    expect(splitHouseNumber('7', 'huis')).toEqual({ number: '7', addition: 'h' });
    expect(splitHouseNumber(undefined)).toEqual({ number: undefined, addition: '' });
  });
});

describe('assignProperty', () => {
  test('one home listed on three sites with different spellings becomes one property', () => {
    const store = openStore(':memory:');
    const funda = listing({
      sourceId: 'funda',
      address: { street: 'Oude Delft', houseNumber: '12-A', city: 'Delft' },
      priceEur: 1250,
    });
    const pararius = listing({
      sourceId: 'pararius',
      address: { street: 'Oude Delft', houseNumber: '12A', city: 'Delft' },
      priceEur: 1250,
    });
    const kamernet = listing({
      sourceId: 'kamernet',
      address: { street: 'Oude Delft', houseNumber: '12', addition: 'a', postcode: '2611 BC', city: 'Delft' },
      priceEur: 1275,
    });
    const first = assignProperty(store, funda, NOW);
    const second = assignProperty(store, pararius, NOW);
    const third = assignProperty(store, kamernet, NOW);
    expect(first.created).toBe(true);
    expect(second).toMatchObject({ created: false, property: { id: first.property.id } });
    expect(third).toMatchObject({ created: false, property: { id: first.property.id } });
    // The postcode learned from the third listing upgrades the key for later exact matches.
    expect(store.properties.get(first.property.id)?.key).toBe('pc:2611BC:12:a');
  });

  test('stores the property id on the listing', () => {
    const store = openStore(':memory:');
    const { listing: stored } = store.listings.upsert(listing({ externalId: 'l1' }), 'poll', NOW);
    const { property } = assignProperty(store, stored, NOW);
    expect(store.listings.get(stored.id)?.propertyId).toBe(property.id);
  });

  test('a listing with only a title and price near a property in the same postcode joins it', () => {
    const store = openStore(':memory:');
    const known = assignProperty(
      store,
      listing({
        address: {
          street: 'Oude Delft',
          houseNumber: '12',
          addition: 'A',
          postcode: '2611 CC',
          city: 'Delft',
        },
        priceEur: 1250,
        sizeM2: 40,
      }),
      NOW,
    );
    const vague = listing({
      sourceId: 'marktplaats',
      title: 'Mooi appartement aan de gracht',
      address: { postcode: '2611 CC', city: 'Delft' },
      priceEur: 1290,
      sizeM2: undefined,
    });
    expect(assignProperty(store, vague, NOW)).toMatchObject({
      created: false,
      property: { id: known.property.id },
    });
  });

  test('a different house number never joins, even at the same price and size', () => {
    const store = openStore(':memory:');
    const a = assignProperty(
      store,
      listing({ address: { street: 'Oude Delft', houseNumber: '12', postcode: '2611 CC', city: 'Delft' } }),
      NOW,
    );
    const b = assignProperty(
      store,
      listing({ address: { street: 'Oude Delft', houseNumber: '14', postcode: '2611 CC', city: 'Delft' } }),
      NOW,
    );
    const c = assignProperty(
      store,
      listing({ address: { street: 'Oude Delft', houseNumber: '14', city: 'Delft' } }),
      NOW,
    );
    expect(b.created).toBe(true);
    expect(b.property.id).not.toBe(a.property.id);
    expect(c.property.id).toBe(b.property.id);
  });

  test('a different addition never joins', () => {
    const store = openStore(':memory:');
    const a = assignProperty(
      store,
      listing({ address: { street: 'Oude Delft', houseNumber: '12A', postcode: '2611 CC', city: 'Delft' } }),
      NOW,
    );
    const b = assignProperty(
      store,
      listing({ address: { street: 'Oude Delft', houseNumber: '12B', postcode: '2611 CC', city: 'Delft' } }),
      NOW,
    );
    expect(b.created).toBe(true);
    expect(b.property.id).not.toBe(a.property.id);
  });

  test('a missing addition joins only with a close price, never on no data', () => {
    const withTwelveA = () => {
      const store = openStore(':memory:');
      const home = listing({
        address: { street: 'Kerkstraat', houseNumber: '12A', city: 'Delft' },
        priceEur: 950,
        sizeM2: 45,
      });
      return { store, a: assignProperty(store, home, NOW) };
    };
    const twelve = (over: Partial<Parameters<typeof listing>[0]>) =>
      listing({
        sourceId: 'pararius',
        address: { street: 'Kerkstraat', houseNumber: '12', city: 'Delft' },
        ...over,
      });

    const first = withTwelveA();
    const noData = assignProperty(first.store, twelve({ priceEur: undefined, sizeM2: undefined }), NOW);
    expect(noData.created).toBe(true);

    const second = withTwelveA();
    const close = assignProperty(second.store, twelve({ priceEur: 960, sizeM2: undefined }), NOW);
    expect(close.property.id).toBe(second.a.property.id);

    const third = withTwelveA();
    expect(assignProperty(third.store, twelve({ priceEur: 960, sizeM2: 60 }), NOW).created).toBe(true);
  });

  test('a price far off in the same postcode does not join', () => {
    const store = openStore(':memory:');
    assignProperty(
      store,
      listing({
        address: { street: 'Oude Delft', houseNumber: '12', postcode: '2611 CC', city: 'Delft' },
        priceEur: 1250,
      }),
      NOW,
    );
    const other = assignProperty(
      store,
      listing({ title: 'Kamer', address: { postcode: '2611 CC', city: 'Delft' }, priceEur: 600 }),
      NOW,
    );
    expect(other.created).toBe(true);
  });
});
