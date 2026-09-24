import type { SourceAdapter } from '@nlpf/core';
import { browserAdapters } from './builtin/browser.js';
import { htmlAdapters } from './builtin/html.js';
import { jsonAdapters } from './builtin/json.js';
import { portalAdapters } from './builtin/portals.js';

/**
 * Every source that ships with nl-property-finder, in priority order: the
 * fastest free channels first. Estate agents from YAML files are added by the
 * daemon on top of these.
 */
export function builtinAdapters(): SourceAdapter[] {
  return [...jsonAdapters(), ...portalAdapters(), ...browserAdapters(), ...htmlAdapters()];
}
