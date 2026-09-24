// Runtime: fetch, browsers, contexts, registry, connecting a source.
export * from './runtime/errors.js';
export * from './runtime/fetch.js';
export * from './runtime/chromium.js';
export * from './runtime/xvfb.js';
export * from './runtime/browser.js';
export * from './runtime/context.js';
export * from './runtime/registry.js';
export * from './runtime/connect.js';

// Parsers shared by adapters.
export * from './util/parse.js';
export * from './util/address.js';
export * from './util/credentials.js';

// The generic agency adapter and its presets.
export * from './generic/agency-def.js';
export * from './generic/agency.js';
export * from './generic/presets.js';

// Test helpers live in ./testing.ts and are imported from there directly.

// Generic adapters for portal systems and agency sites, to configure more instances.
export { createZigAdapter, type ZigPortalDef } from './generic/zig.js';
export { createEmbraceAdapter, type EmbracePortalDef } from './generic/embrace.js';
export { createOgonlineAdapter, type OgonlineAgencyDef } from './generic/ogonline.js';

// Every built-in source.
export * from './builtin.js';
