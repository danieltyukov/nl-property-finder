import type { SourceAdapter } from '@nlpf/core';
import { createHolland2StayAdapter } from '../adapters/holland2stay.js';
import { createHuurwoningenAdapter } from '../adapters/huurwoningen.js';
import { createKamerNlAdapter } from '../adapters/kamernl.js';
import { createParariusAdapter } from '../adapters/pararius.js';
import { createXiorAdapter } from '../adapters/xior.js';

/**
 * Task 6a: the sites read in a real browser because of Cloudflare, in
 * priority order. Pararius (free to react after login), Holland2Stay (first
 * come first served bookings, assisted), Huurwoningen and Kamer.nl (paid to
 * react, for discovery and the paywall router), Xior (notify only).
 */
export function browserAdapters(): SourceAdapter[] {
  return [createParariusAdapter(), createHolland2StayAdapter(), createHuurwoningenAdapter(), createKamerNlAdapter(), createXiorAdapter()];
}
