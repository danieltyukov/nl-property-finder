import type { Config, SourceAdapter } from '@nlpf/core';

export interface Registry {
  all(): SourceAdapter[];
  get(id: string): SourceAdapter | undefined;
  /** The adapters the scheduler should poll for this config, in registration order. */
  enabled(config: Config): SourceAdapter[];
}

/**
 * Municipalities the enabled searches cover, lowercased, or null when some
 * search covers the whole country or is drawn with postcodes or a polygon
 * only (so no source can be ruled out by name).
 */
function coveredMunicipalities(config: Config): Set<string> | null {
  const names = new Set<string>();
  for (const search of config.searches) {
    if (!search.enabled) continue;
    if (search.regions.length === 0) return null;
    for (const region of search.regions) {
      if (region.municipalities.length === 0) return null;
      for (const m of region.municipalities) names.add(m.trim().toLowerCase());
    }
  }
  return names;
}

/**
 * Whether the scheduler should poll a source. An entry under `sources.<id>`
 * decides when present (`enabled` defaults to true there, so listing a
 * source turns it on). Otherwise nationwide sources are on, and a regional
 * source is on when an enabled search covers one of its municipalities.
 */
export function isSourceEnabled(adapter: SourceAdapter, config: Config, covered = coveredMunicipalities(config)): boolean {
  const own = config.sources[adapter.id];
  if (own) return own.enabled;
  if (adapter.regions === 'nl' || covered === null) return true;
  return adapter.regions.some((r) => covered.has(r.toLowerCase()));
}

export function createRegistry(adapters: SourceAdapter[]): Registry {
  const byId = new Map<string, SourceAdapter>();
  for (const a of adapters) {
    if (byId.has(a.id)) throw new Error(`duplicate source id "${a.id}"`);
    byId.set(a.id, a);
  }
  const list = [...byId.values()];
  return {
    all: () => [...list],
    get: (id) => byId.get(id),
    enabled: (config) => {
      const covered = coveredMunicipalities(config);
      return list.filter((a) => isSourceEnabled(a, config, covered));
    },
  };
}
