import type { Listing, Property, SearchConfig } from '@nlpf/core';
import { commuteMinutes } from './commute.js';
import { squash } from './text.js';

/** Points added or taken per preference, on top of the extract's 0-100 score. */
export const PREFERENCE_POINTS = { mustHaveFound: 4, mustHaveMissing: -8, commuteWithin: 5, commuteOver: -15 };

const modeLabel = (mode: string) => (mode === 'walk' ? 'foot' : mode);

/**
 * Adjusts the extract's fit score with the search's own preferences, each
 * with a reason the dashboard shows: must-haves mentioned or not in the
 * title and description, and commute minutes to the places that matter
 * (when the listing has coordinates). The score stays within 0 to 100.
 */
export function applyPreferences(
  base: { score: number; reasons: string[] },
  listing: Listing | (Property & { description?: string }),
  search: SearchConfig,
): { score: number; reasons: string[] } {
  let score = base.score;
  const reasons = [...base.reasons];
  const text = squash(`${listing.title} ${listing.description ?? ''}`);

  for (const want of search.mustHaves) {
    const needle = squash(want);
    if (!needle) continue;
    if (text.includes(needle)) {
      score += PREFERENCE_POINTS.mustHaveFound;
      reasons.push(`mentions ${want}`);
    } else {
      score += PREFERENCE_POINTS.mustHaveMissing;
      reasons.push(`no mention of ${want}`);
    }
  }

  const { lat, lon } = listing.address;
  if (lat !== undefined && lon !== undefined) {
    for (const place of search.commute) {
      const min = commuteMinutes({ lat, lon }, place, place.mode);
      const line = `${min} min by ${modeLabel(place.mode)} to ${place.name}`;
      if (place.maxMinutes === undefined) reasons.push(line);
      else if (min <= place.maxMinutes) {
        score += PREFERENCE_POINTS.commuteWithin;
        reasons.push(line);
      } else {
        score += PREFERENCE_POINTS.commuteOver;
        reasons.push(`${line}, over ${place.maxMinutes}`);
      }
    }
  }
  return { score: Math.max(0, Math.min(100, Math.round(score))), reasons };
}
