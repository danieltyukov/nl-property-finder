import type { Address, RegionConfig } from '@nlpf/core';
import { normCity } from './cluster.js';

/** True when the postcode's four digits fall in any of "2611-2629" or "2611". */
export function pc4InRanges(postcode: string | undefined, ranges: string[]): boolean {
  const m = /^\s*(\d{4})/.exec(postcode ?? '');
  if (!m) return false;
  const pc4 = Number(m[1]);
  return ranges.some((r) => {
    const [lo, hi] = r.split('-').map(Number);
    if (lo === undefined || Number.isNaN(lo)) return false;
    return pc4 >= lo && pc4 <= (hi === undefined || Number.isNaN(hi) ? lo : hi);
  });
}

/**
 * Point in polygon (ray casting). Vertices are [lat, lon] as Leaflet draws
 * them; a polygon stored in GeoJSON order ([lon, lat]) is detected and
 * swapped. The two cannot be confused in the Netherlands, where latitudes
 * are 50.7 to 53.6 and longitudes 3.3 to 7.3.
 */
export function inPolygon(point: { lat: number; lon: number }, polygon: [number, number][]): boolean {
  if (polygon.length < 3) return false;
  const lonFirst = polygon.every(([a, b]) => a < b);
  const pts = polygon.map(([a, b]) => (lonFirst ? { lat: b, lon: a } : { lat: a, lon: b }));
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const pi = pts[i]!;
    const pj = pts[j]!;
    const crosses = pi.lat > point.lat !== pj.lat > point.lat;
    if (crosses && point.lon < ((pj.lon - pi.lon) * (point.lat - pi.lat)) / (pj.lat - pi.lat) + pi.lon)
      inside = !inside;
  }
  return inside;
}

/**
 * A region matches when any of its criteria matches: a municipality (the
 * geocoded municipality or the city), a PC4 range, or the drawn polygon. A
 * region with no criteria matches its name against the city.
 */
export function inRegion(
  addr: Address,
  region: Pick<RegionConfig, 'name' | 'municipalities' | 'postcodes' | 'polygon'>,
): boolean {
  const places = [addr.municipality, addr.city].filter((x): x is string => !!x).map(normCity);
  const munis = region.municipalities.map(normCity);
  if (munis.length && places.some((p) => munis.includes(p))) return true;
  if (region.postcodes.length && pc4InRanges(addr.postcode, region.postcodes)) return true;
  if (region.polygon && region.polygon.length >= 3 && addr.lat !== undefined && addr.lon !== undefined) {
    if (inPolygon({ lat: addr.lat, lon: addr.lon }, region.polygon)) return true;
  }
  const hasCriteria = munis.length > 0 || region.postcodes.length > 0 || (region.polygon?.length ?? 0) >= 3;
  return !hasCriteria && places.includes(normCity(region.name));
}
