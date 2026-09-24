import { existsSync, readFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { ConfigSchema } from '@nlpf/core';
import { NeedsLoginError, SourceBlockedError } from '@nlpf/sources';
import { huisjeAdapter, pdfText, type SourceName } from '../src/index.js';
import { asListing, config, context, message, sandbox, type TestSandbox } from './helpers.js';

let box: TestSandbox;
let dir: string;

beforeAll(async () => {
  box = await sandbox();
  dir = mkdtempSync(join(tmpdir(), 'nlpf-huisje-test-'));
});
afterAll(async () => {
  await box.stop();
  rmSync(dir, { recursive: true, force: true });
});
afterEach(() => {
  box.control.reset();
});

const adapter = () => huisjeAdapter(box.url, { attachmentsDir: dir });

async function searchAll(a = adapter(), ctx = context('huisje')) {
  const out = [];
  for (const req of a.buildSearches(ctx.searches, ctx.source)) out.push(...(await a.search(req, ctx)));
  return out;
}

describe('huisjeAdapter', () => {
  test('describes a platform that allows automated contact', () => {
    const a = adapter();
    expect(a.id).toBe('huisje');
    expect(a.capabilities).toEqual({ search: 'json', detail: true, contact: 'form', login: 'optional', terms: 'allows' });
    expect(a.loginUrl).toBe(`${box.url}/huisje/login`);
    for (const fn of ['search', 'detail', 'contact', 'inbox', 'reply', 'checkSession', 'isAvailable'] as const) {
      expect(typeof a[fn]).toBe('function');
    }
  });

  test('buildSearches puts the regions and budget in the platform parameters', () => {
    const ctx = context('huisje');
    const reqs = adapter().buildSearches(ctx.searches, ctx.source);
    expect(reqs.map((r) => r.params)).toEqual([
      { city: 'delft', priceMax: 1400 },
      { city: 'rotterdam', priceMax: 1400 },
      { city: 'den haag', priceMax: 1400 },
    ]);
    expect(new Set(reqs.map((r) => r.key)).size).toBe(3);
  });

  test('search returns the seeded Huisje listings that fit, filtered by the platform', async () => {
    const listings = await searchAll();
    const seeded = box.control.listings().filter((l) => l.source === 'huisje' && l.priceEur <= 1400);
    expect(listings.map((l) => l.externalId).sort()).toEqual(seeded.map((l) => l.id).sort());
    expect(listings.every((l) => (l.priceEur ?? 0) <= 1400)).toBe(true);
    const tulp = listings.find((l) => l.externalId === 'hj-1001');
    expect(tulp).toMatchObject({
      sourceId: 'huisje',
      url: `${box.url}/huisje/listing/hj-1001`,
      title: 'Appartement Tulpgracht 12-A',
      priceEur: 1175,
      priceBasis: 'excl',
      serviceCostsEur: 65,
      sizeM2: 48,
      type: 'apartment',
      furnishing: 'upholstered',
      address: { street: 'Tulpgracht', houseNumber: '12', addition: 'A', postcode: '2611 AB', city: 'Delft' },
      contact: 'form',
      language: 'nl',
      agent: { name: 'Joost van Dam', email: 'joost@vandam-verhuur.example' },
    });
    expect(tulp?.description).toContain('Gestoffeerd appartement');
  });

  test('detail returns the full listing', async () => {
    const [raw] = (await searchAll()).filter((l) => l.externalId === 'hj-1002');
    const detailed = await adapter().detail!(raw!, context('huisje'));
    expect(detailed.description).toContain('TU Delft');
    expect(detailed.images?.[0]).toBe(`${box.url}/media/hj-1002/1.svg`);
  });

  test('contacting a listing records a submission; a dry run records nothing', async () => {
    const [raw] = (await searchAll()).filter((l) => l.externalId === 'hj-1001');
    const listing = asListing(raw!);
    const dry = await adapter().contact!(listing, message('Goedemiddag, ik kom graag kijken.', true), context('huisje'));
    expect(dry).toMatchObject({ ok: true, channel: 'form' });
    expect(box.control.submissions()).toHaveLength(0);

    const result = await adapter().contact!(listing, message('Goedemiddag, ik kom graag kijken.'), context('huisje'));
    expect(result.ok).toBe(true);
    const [sub] = box.control.submissions();
    expect(result.externalId).toBe(sub!.threadId);
    expect(sub).toMatchObject({ source: 'huisje', listingId: 'hj-1001', name: 'Sam de Vries', email: 'sam@nlpf.test', replyChannel: 'platform' });
    expect(sub!.messages[0]).toMatchObject({ from: 'agent', text: 'Goedemiddag, ik kom graag kijken.' });
  });

  test('removeListing makes isAvailable false and contact report the listing as gone', async () => {
    const listing = asListing((await searchAll()).find((l) => l.externalId === 'hj-1007')!);
    expect(await adapter().isAvailable!(listing, context('huisje'))).toBe(true);
    box.control.removeListing('hj-1007');
    expect(await adapter().isAvailable!(listing, context('huisje'))).toBe(false);
    const result = await adapter().contact!(listing, message('Hallo'), context('huisje'));
    expect(result).toMatchObject({ ok: false, channel: 'form' });
    expect(box.control.submissions()).toHaveLength(0);
    expect((await searchAll()).some((l) => l.externalId === 'hj-1007')).toBe(false);
  });

  test('a rented listing is not available either', async () => {
    const listing = asListing((await searchAll()).find((l) => l.externalId === 'hj-1008')!);
    box.control.removeListing('hj-1008', 'rented');
    expect(await adapter().isAvailable!(listing, context('huisje'))).toBe(false);
  });

  test('setLoginRequired makes contact throw NeedsLoginError; credentials in the config get past it', async () => {
    const listing = asListing((await searchAll()).find((l) => l.externalId === 'hj-1001')!);
    box.control.setLoginRequired(true);
    const err = await adapter()
      .contact!(listing, message('Hallo'), context('huisje'))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NeedsLoginError);
    expect((err as NeedsLoginError).loginUrl).toBe(`${box.url}/huisje/login`);
    expect(await adapter().checkSession!(context('huisje'))).toBe('none');

    const withLogin = ConfigSchema.parse({
      ...config,
      sources: { huisje: { options: { email: 'sam@nlpf.test', password: 'geheim' } } },
    });
    const a = adapter();
    expect(await a.checkSession!(context('huisje', withLogin))).toBe('ok');
    const result = await a.contact!(listing, message('Hallo'), context('huisje', withLogin));
    expect(result.ok).toBe(true);
    expect(box.control.submissions()).toHaveLength(1);
  });

  test('setBlocked makes search throw SourceBlockedError with status 429', async () => {
    box.control.setBlocked('huisje' satisfies SourceName, true, { retryAfterSec: 1 });
    const a = adapter();
    const ctx = context('huisje');
    const [req] = a.buildSearches(ctx.searches, ctx.source);
    const err = await a.search(req!, ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SourceBlockedError);
    expect((err as SourceBlockedError).status).toBe(429);
    expect((err as SourceBlockedError).retryAfterSec).toBe(1);
    box.control.setBlocked('huisje', false);
    expect((await a.search(req!, context('huisje'))).length).toBeGreaterThan(0);
  });

  test('inbox returns landlord replies in the thread and reply answers in it', async () => {
    const listing = asListing((await searchAll()).find((l) => l.externalId === 'hj-1002')!);
    const since = new Date(Date.now() - 1000);
    const contact = await adapter().contact!(listing, message('Hello, I would like to see the studio.'), context('huisje'));
    const [sub] = box.control.submissions();
    await box.control.landlordReply(sub!.id, 'viewing_slots');

    const inbox = await adapter().inbox!(context('huisje'), since);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({ channel: 'platform', sourceId: 'huisje', threadId: contact.externalId, from: { name: 'Marieke de Boer' } });
    expect(inbox[0]!.id).toMatch(/^huisje:m-\d+$/);
    expect(inbox[0]!.text).toMatch(/viewing/i);
    expect(box.inbox).toHaveLength(0);

    const later = await adapter().inbox!(context('huisje'), new Date(Date.now() + 60_000));
    expect(later).toHaveLength(0);

    const r = await adapter().reply!(contact.externalId!, message('Thursday suits me, see you then.'), context('huisje'));
    expect(r).toMatchObject({ ok: true, channel: 'message' });
    const after = box.control.submission(sub!.id)!;
    expect(after.messages.at(-1)).toMatchObject({ from: 'agent', channel: 'platform', text: 'Thursday suits me, see you then.' });
    expect(after.agentTurns).toBe(2);
    expect(after.viewingConfirmed).toBeDefined();
  });

  test('an offer in the thread arrives with the contract PDF saved on disk', async () => {
    const listing = asListing((await searchAll()).find((l) => l.externalId === 'hj-1005')!);
    await adapter().contact!(listing, message('Hello'), context('huisje'));
    const [sub] = box.control.submissions();
    await box.control.landlordReply(sub!.id, 'offer');
    const [offer] = await adapter().inbox!(context('huisje'), new Date(0));
    expect(offer!.attachments).toHaveLength(1);
    const pdf = offer!.attachments[0]!;
    expect(pdf).toMatchObject({ filename: 'concept-huurovereenkomst.pdf', contentType: 'application/pdf' });
    expect(pdf.path && existsSync(pdf.path)).toBe(true);
    expect(pdfText(readFileSync(pdf.path!))).toContain('waarborgsom van 3 maanden kale huur');
  });

  test('inbox and reply need a login when the platform asks for one', async () => {
    box.control.setLoginRequired(true);
    await expect(adapter().inbox!(context('huisje'), new Date(0))).rejects.toBeInstanceOf(NeedsLoginError);
    await expect(adapter().reply!('th-1', message('Hallo'), context('huisje'))).rejects.toBeInstanceOf(NeedsLoginError);
  });

  test('reply uploads attachments to the thread', async () => {
    const listing = asListing((await searchAll()).find((l) => l.externalId === 'hj-1009')!);
    const contact = await adapter().contact!(listing, message('Hallo'), context('huisje'));
    const file = join(dir, 'loonstrook.pdf');
    await import('node:fs').then((fs) => fs.writeFileSync(file, '%PDF-1.4 loonstrook'));
    await adapter().reply!(
      contact.externalId!,
      { ...message('Hierbij mijn loonstrook.'), attachments: [{ filename: 'loonstrook.pdf', contentType: 'application/pdf', path: file }] },
      context('huisje'),
    );
    const sub = box.control.submissions()[0]!;
    const att = sub.messages.at(-1)!.attachments[0]!;
    expect(att.filename).toBe('loonstrook.pdf');
    expect(readFileSync(att.path, 'utf8')).toBe('%PDF-1.4 loonstrook');
  });
});
