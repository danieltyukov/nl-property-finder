import type { NamedSearch } from './config/schema.js';

/**
 * Rental sites use the everyday name of a town in their URLs and filters
 * ("den-haag"), while official registers use the formal one ("'s-Gravenhage").
 * Adapters get the everyday name.
 */
const EVERYDAY: Record<string, string> = {
  "'s-gravenhage": 'den haag',
  's-gravenhage': 'den haag',
  'the hague': 'den haag',
  "'s-hertogenbosch": 'den bosch',
  's-hertogenbosch': 'den bosch',
};

export function everydayMunicipality(name: string): string {
  const key = name.trim().toLowerCase();
  return EVERYDAY[key] ?? key;
}

/** The enabled searches, with every municipality in the form rental sites understand, each once. */
export function searchesForAdapters(searches: NamedSearch[]): NamedSearch[] {
  return searches
    .filter((s) => s.enabled)
    .map((s) => ({
      ...s,
      regions: s.regions.map((r) => ({ ...r, municipalities: [...new Set(r.municipalities.map(everydayMunicipality))] })),
    }));
}
