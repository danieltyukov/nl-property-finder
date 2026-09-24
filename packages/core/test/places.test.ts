import { expect, test } from 'vitest';
import { NamedSearchSchema, everydayMunicipality, searchesForAdapters } from '../src/index.js';

test("adapters get Den Haag, not 's-Gravenhage, each once", () => {
  expect(everydayMunicipality("'s-Gravenhage")).toBe('den haag');
  expect(everydayMunicipality('Delft')).toBe('delft');
  const s = NamedSearchSchema.parse({ id: 'main', name: 'm', regions: [{ name: 'Den Haag', municipalities: ["'s-Gravenhage", 'Den Haag'] }] });
  expect(searchesForAdapters([s])[0]!.regions[0]!.municipalities).toEqual(['den haag']);
  expect(searchesForAdapters([{ ...s, enabled: false }])).toEqual([]);
});
