export type CommuteMode = 'bike' | 'walk' | 'transit' | 'car';

interface Point { lat: number; lon: number }

/** Detour over the straight line, average speed, fixed overhead (waiting, walking to the stop). */
const MODES: Record<CommuteMode, { detour: number; kmh: number; fixedMin: number }> = {
  bike: { detour: 1.3, kmh: 15, fixedMin: 0 },
  walk: { detour: 1.25, kmh: 5, fixedMin: 0 },
  car: { detour: 1.4, kmh: 35, fixedMin: 0 },
  transit: { detour: 1.5, kmh: 25, fixedMin: 8 },
};

/** Great-circle distance in km (haversine). */
export function distanceKm(a: Point, b: Point): number {
  const R = 6371.0088;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * A rough door-to-door estimate without a routing service: straight-line
 * distance times a detour factor at a typical speed, plus fixed overhead for
 * transit. Good enough to rank homes; not a journey planner.
 */
export function commuteMinutes(from: Point, to: Point, mode: CommuteMode): number {
  const m = MODES[mode];
  return Math.round(((distanceKm(from, to) * m.detour) / m.kmh) * 60 + m.fixedMin);
}
