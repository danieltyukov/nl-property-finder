import type { SourceAdapter } from '@nlpf/core';
import { createDirectwonenAdapter } from '../adapters/directwonen.js';
import { createHuurstuntAdapter } from '../adapters/huurstunt.js';
import { createHuurzoneAdapter } from '../adapters/huurzone.js';
import { createInterhouseAdapter } from '../adapters/interhouse.js';
import { createMvgmAdapter } from '../adapters/mvgm.js';
import { createNederwoonAdapter } from '../adapters/nederwoon.js';
import { createRentolaAdapter } from '../adapters/rentola.js';
import { createRotsvastAdapter } from '../adapters/rotsvast.js';
import { createStadswonenAdapter } from '../adapters/stadswonen.js';
import { createVanderlindenAdapter } from '../adapters/vanderlinden.js';
import { createWonen123Adapter } from '../adapters/wonen123.js';
import { createWoningnetDakAdapter } from '../adapters/woningnet-dak.js';

/**
 * Task 6b: MVGM, Stadswonen, WoningNet DAK, the paid aggregators and the
 * small agents, in priority order: agents with a free channel first, then
 * the portals that notify, then the paid aggregators that are only ingested.
 */
export function htmlAdapters(): SourceAdapter[] {
  return [
    // Small agents with a form or an email address.
    createInterhouseAdapter(),
    createWonen123Adapter(),
    createRotsvastAdapter(),
    // Portals and agents where a person reacts.
    createMvgmAdapter(),
    createStadswonenAdapter(),
    createWoningnetDakAdapter(),
    createVanderlindenAdapter(),
    createNederwoonAdapter(),
    // Paid aggregators: discovery, dedupe and the paywall router.
    createHuurzoneAdapter(),
    createRentolaAdapter(),
    createHuurstuntAdapter(),
    createDirectwonenAdapter(),
  ];
}
