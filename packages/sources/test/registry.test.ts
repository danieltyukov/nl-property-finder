import { expect, test } from 'vitest';
import { ConfigSchema, type SourceAdapter } from '@nlpf/core';
import { createRegistry, isSourceEnabled } from '../src/index.js';

function fakeAdapter(id: string, regions: SourceAdapter['regions'] = 'nl'): SourceAdapter {
  return {
    id,
    name: id,
    homepage: `https://${id}.example`,
    regions,
    defaultIntervalSec: 120,
    capabilities: { search: 'json', detail: false, contact: 'none', login: 'none', terms: 'unknown' },
    buildSearches: () => [],
    search: async () => [],
  };
}

const funda = fakeAdapter('funda');
const kamernet = fakeAdapter('kamernet');
const roommatch = fakeAdapter('roommatch', ['delft']);
const rijnmond = fakeAdapter('woonnet-rijnmond', ['rotterdam', 'schiedam']);

test('enabled() omits a source switched off in config and keeps sources config does not mention', () => {
  const registry = createRegistry([funda, kamernet]);
  const config = ConfigSchema.parse({ sources: { kamernet: { enabled: false } } });
  expect(registry.enabled(config).map((a) => a.id)).toEqual(['funda']);
  expect(registry.enabled(ConfigSchema.parse({})).map((a) => a.id)).toEqual(['funda', 'kamernet']);
});

test('all() and get()', () => {
  const registry = createRegistry([funda, kamernet]);
  expect(registry.all().map((a) => a.id)).toEqual(['funda', 'kamernet']);
  expect(registry.get('kamernet')).toBe(kamernet);
  expect(registry.get('nope')).toBeUndefined();
});

test('duplicate ids are a programming error', () => {
  expect(() => createRegistry([funda, fakeAdapter('funda')])).toThrow(/duplicate source id "funda"/);
});

test('a regional source is on by default only when a search covers one of its municipalities', () => {
  const registry = createRegistry([funda, roommatch, rijnmond]);
  const delft = ConfigSchema.parse({
    searches: [{ id: 'main', name: 'Main', regions: [{ name: 'Delft', municipalities: ['Delft'] }] }],
  });
  expect(registry.enabled(delft).map((a) => a.id)).toEqual(['funda', 'roommatch']);

  // Listing the source in config turns it on regardless of region.
  const withRijnmond = ConfigSchema.parse({ ...delft, sources: { 'woonnet-rijnmond': {} } });
  expect(registry.enabled(withRijnmond).map((a) => a.id)).toEqual(['funda', 'roommatch', 'woonnet-rijnmond']);
});

test('searches without municipalities (whole country, postcodes or a polygon) keep every regional source on', () => {
  const registry = createRegistry([roommatch, rijnmond]);
  expect(registry.enabled(ConfigSchema.parse({})).length).toBe(2);
  const byPostcode = ConfigSchema.parse({
    searches: [{ id: 'main', name: 'Main', regions: [{ name: 'Centre', postcodes: ['2611-2629'] }] }],
  });
  expect(registry.enabled(byPostcode).length).toBe(2);
});

test('disabled searches do not count for regions', () => {
  const config = ConfigSchema.parse({
    searches: [
      { id: 'main', name: 'Main', regions: [{ name: 'Delft', municipalities: ['delft'] }] },
      { id: 'old', name: 'Old', enabled: false, regions: [{ name: 'Rotterdam', municipalities: ['rotterdam'] }] },
    ],
  });
  expect(isSourceEnabled(rijnmond, config)).toBe(false);
  expect(isSourceEnabled(roommatch, config)).toBe(true);
});
