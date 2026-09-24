import type { SourceAdapter } from '@nlpf/core';
import { createEmbraceAdapter } from '../generic/embrace.js';
import { createOgonlineAdapter } from '../generic/ogonline.js';
import { createZigAdapter } from '../generic/zig.js';
import { hollandRijnland } from '../instances/holland-rijnland.js';
import { OGONLINE_AGENCIES } from '../instances/ogonline-agencies.js';
import { plaza } from '../instances/plaza.js';
import { roommatch } from '../instances/roommatch.js';
import { woonnetHaaglanden } from '../instances/woonnet-haaglanden.js';
import { woonnetRijnmond } from '../instances/woonnet-rijnmond.js';

/**
 * Task 5b: the Zig portals (RoomMatch for DUWO, Woonnet Haaglanden, Plaza,
 * Huren in Holland Rijnland), Woonnet Rijnmond on Embrace, and the OGonline
 * estate agents. First come, first served portals come first.
 */
export function portalAdapters(): SourceAdapter[] {
  return [
    createZigAdapter(plaza),
    createZigAdapter(roommatch),
    createZigAdapter(woonnetHaaglanden),
    createZigAdapter(hollandRijnland),
    createEmbraceAdapter(woonnetRijnmond),
    ...OGONLINE_AGENCIES.map((def) => createOgonlineAdapter(def)),
  ];
}
