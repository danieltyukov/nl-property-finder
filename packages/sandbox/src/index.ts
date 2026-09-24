// The fake Netherlands: a fake platform (Huisje), a fake estate agent
// (Makelaardij De Gracht) and landlords who answer, for demo mode and tests.
export { startSandbox, type Sandbox } from './server.js';
export { createControl, type Control, type SandboxState } from './control.js';
export { World, CATALOGUE, demoSeed, GRACHT_EMAIL, type CatalogueEntry } from './world.js';
export { huisjeAdapter, type HuisjeAdapterOptions } from './demoSource.js';
export { grachtAgencyYaml } from './agency.js';
export { REPLIES, SANDBOX_IBAN, composeReply, contractPdf } from './landlord.js';
export { viewingConfirmation } from './core.js';
export { makePdf, pdfText } from './pdf.js';
export * from './types.js';
