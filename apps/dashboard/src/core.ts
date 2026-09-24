/*
 * The browser-safe part of @nlpf/core.
 *
 * The package index also re-exports the SQLite store and the config loader,
 * which need Node. The dashboard is bundled for the browser, so it takes the
 * HTTP contract and the config schema straight from their modules (both need
 * only zod). Everything else comes from '@nlpf/core' as `import type`, which
 * the bundler erases.
 */
import type { z } from 'zod';
import type {
  ContactBody as ContactBodySchema,
  DraftBody as DraftBodySchema,
  ResolveTaskBody as ResolveTaskBodySchema,
  SendMessageBody as SendMessageBodySchema,
  SourcePatchBody as SourcePatchBodySchema,
  WithdrawAllBody as WithdrawAllBodySchema,
} from '../../../packages/core/src/api.js';

export { API_PREFIX, ROUTES } from '../../../packages/core/src/api.js';
export { ConfigSchema, NamedSearchSchema } from '../../../packages/core/src/config/schema.js';

export type ResolveTaskInput = z.input<typeof ResolveTaskBodySchema>;
export type SendMessageInput = z.input<typeof SendMessageBodySchema>;
export type DraftInput = z.input<typeof DraftBodySchema>;
export type ContactInput = z.input<typeof ContactBodySchema>;
export type SourcePatchInput = z.input<typeof SourcePatchBodySchema>;
export type WithdrawAllInput = z.input<typeof WithdrawAllBodySchema>;
