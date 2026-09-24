import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ConfigSchema, NamedSearchSchema, ProfileSchema,
  type Config, type Listing, type NamedSearch, type Profile, type SourceAdapter,
} from '@nlpf/core';

export type FetchJson = (url: string, init?: { headers?: Record<string, string> }) => Promise<unknown>;

const here = dirname(fileURLToPath(import.meta.url));
export const fixturesDir = join(here, 'fixtures');

interface FixtureIndex { responses: Record<string, string> }

/**
 * A fetchJson that answers only from recorded fixtures and records every
 * request. Unknown URLs throw, so a test can never reach the network.
 */
export function fixtureFetch(overrides: Record<string, unknown> = {}): FetchJson & { calls: { url: string; headers?: Record<string, string> }[] } {
  const index = JSON.parse(readFileSync(join(fixturesDir, 'index.json'), 'utf8')) as FixtureIndex;
  const calls: { url: string; headers?: Record<string, string> }[] = [];
  const fn = async (url: string, init?: { headers?: Record<string, string> }): Promise<unknown> => {
    calls.push({ url, headers: init?.headers });
    if (url in overrides) {
      const v = overrides[url];
      if (v instanceof Error) throw v;
      return v;
    }
    const file = index.responses[url];
    if (!file) throw new Error(`no fixture for ${url}`);
    return JSON.parse(readFileSync(join(fixturesDir, file), 'utf8')) as unknown;
  };
  return Object.assign(fn, { calls });
}

let seq = 0;
export function listing(over: Partial<Listing> = {}): Listing {
  seq += 1;
  const sourceId = over.sourceId ?? 'funda';
  const externalId = over.externalId ?? String(seq);
  return {
    sourceId,
    externalId,
    id: `${sourceId}:${externalId}`,
    url: `https://example.test/${sourceId}/${externalId}`,
    title: 'Oude Delft 12A',
    priceEur: 1250,
    sizeM2: 40,
    type: 'apartment',
    address: { street: 'Oude Delft', houseNumber: '12', addition: 'A', city: 'Delft' },
    contact: 'form',
    propertyId: null,
    firstSeenAt: '2026-09-23T10:00:00.000Z',
    lastSeenAt: '2026-09-23T10:00:00.000Z',
    state: 'active',
    via: 'poll',
    ...over,
  };
}

export function profile(over: Partial<Profile> = {}): Profile {
  return { ...ProfileSchema.parse({ firstName: 'Sam', lastName: 'de Vries', email: 'sam@example.test' }), ...over };
}

export function search(over: Partial<NamedSearch> = {}): NamedSearch {
  return { ...NamedSearchSchema.parse({ id: 'main', name: 'Main search' }), ...over };
}

export function config(over: Partial<Config> = {}): Config {
  return { ...ConfigSchema.parse({}), ...over };
}

export function adapter(over: Partial<SourceAdapter> & { id: string }): SourceAdapter {
  return {
    name: over.id,
    homepage: `https://${over.id}.example.test`,
    regions: 'nl',
    defaultIntervalSec: 60,
    capabilities: { search: 'json', detail: false, contact: 'form', login: 'none', terms: 'unknown' },
    buildSearches: () => [],
    search: async () => [],
    contact: async () => ({ ok: true, channel: 'form' }),
    ...over,
  };
}

/**
 * The text drawn on each page of a PDF: hex and literal strings of the
 * content streams, decoded as single-byte text. Enough for the standard
 * fonts pdf-lib and pdfkit write; not a general extractor.
 */
export async function pdfText(bytes: Uint8Array): Promise<string[]> {
  const { PDFDocument, PDFArray, PDFRawStream, decodePDFRawStream } = await import('pdf-lib');
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => {
    const contents = page.node.Contents();
    const streams = contents instanceof PDFArray ? contents.asArray().map((r) => doc.context.lookup(r)) : [contents];
    let ops = '';
    for (const s of streams) {
      if (s instanceof PDFRawStream) ops += Buffer.from(decodePDFRawStream(s).decode()).toString('latin1');
      else if (s && 'getContents' in s) ops += Buffer.from((s as { getContents(): Uint8Array }).getContents()).toString('latin1');
    }
    const parts: string[] = [];
    for (const m of ops.matchAll(/<([0-9A-Fa-f\s]+)>|\(((?:\\.|[^\\)])*)\)/g)) {
      if (m[1] !== undefined) parts.push(Buffer.from(m[1].replace(/\s+/g, ''), 'hex').toString('latin1'));
      else parts.push(m[2]!.replace(/\\(.)/g, '$1'));
    }
    return parts.join('');
  });
}

export const registryOf = (adapters: SourceAdapter[]) => ({
  get: (id: string) => adapters.find((a) => a.id === id),
});
