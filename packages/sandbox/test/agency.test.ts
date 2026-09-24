import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import type { RawListing } from '@nlpf/core';
import { createAgencyAdapter, parseAgencyYaml } from '@nlpf/sources';
import { GRACHT_EMAIL, grachtAgencyYaml } from '../src/index.js';
import { asListing, context, sandbox, type TestSandbox } from './helpers.js';

let box: TestSandbox;

beforeAll(async () => {
  box = await sandbox();
});
afterAll(async () => {
  await box.stop();
});
afterEach(() => {
  box.control.reset();
});

const adapter = () =>
  createAgencyAdapter(parseAgencyYaml(grachtAgencyYaml(box.url)), { confirmTimeoutMs: 3000 });

async function searchGracht(): Promise<RawListing[]> {
  const a = adapter();
  const ctx = context(a.id);
  const [req] = a.buildSearches(ctx.searches, ctx.source);
  return a.search(req!, ctx);
}

describe('De Gracht through the generic agency adapter', () => {
  test('the YAML is the template with the sandbox URLs', () => {
    const template = readFileSync(
      fileURLToPath(new URL('../../../examples/agencies/_template.yaml', import.meta.url)),
      'utf8',
    );
    const def = parseAgencyYaml(grachtAgencyYaml(`${box.url}/`));
    const tpl = parseAgencyYaml(template);
    expect(def.id).toBe('de-gracht');
    expect(def.homepage).toBe(`${box.url}/gracht/`);
    expect(def.list.url).toBe(`${box.url}/gracht/aanbod/woningaanbod/huur/`);
    expect(def.list.item).toBe(tpl.list.item);
    expect(def.list.fields).toEqual(tpl.list.fields);
    expect(def.detail?.description).toEqual(tpl.detail?.description);
    expect(def.detail?.images).toEqual(tpl.detail?.images);
    expect(def.contact?.form).toEqual(tpl.contact?.form);
    expect(def.contact?.email).toBe(GRACHT_EMAIL);
    expect(def.terms).toBe('allows');
    const email = parseAgencyYaml(grachtAgencyYaml(box.url, { contact: 'email' }));
    expect(email.contact).toEqual({ kind: 'email', email: GRACHT_EMAIL });
  });

  test('search reads the agency page and skips rented and optioned homes', async () => {
    const listings = await searchGracht();
    const online = box.control.listings().filter((l) => l.source === 'gracht');
    const available = online.filter((l) => l.status === 'available');
    expect(listings).toHaveLength(available.length);
    expect(online.length).toBeGreaterThan(available.length);
    const tulp = listings.find((l) => l.title === 'Tulpgracht 12 a');
    expect(tulp).toMatchObject({
      sourceId: 'agency:de-gracht',
      priceEur: 1175,
      priceBasis: 'excl',
      sizeM2: 48,
      type: 'apartment',
      furnishing: 'upholstered',
      address: { street: 'Tulpgracht', houseNumber: '12', addition: 'A', postcode: '2611 AB', city: 'Delft' },
      contact: 'form',
      agent: { name: 'Makelaardij De Gracht', email: GRACHT_EMAIL },
    });
    expect(tulp!.url).toMatch(
      new RegExp(`^${box.url}/gracht/aanbod/woningaanbod/delft/huur/appartement-2001-tulpgracht-12-a/$`),
    );
    expect(tulp!.contactUrl).toBe(`${tulp!.url}#contact`);
    const types = new Map(listings.map((l) => [l.externalId, l.type]));
    expect([...types.values()]).toEqual(expect.arrayContaining(['apartment', 'house']));
  });

  test('the same home on Huisje and De Gracht is written differently but splits into the same address', async () => {
    const huisje = box.control.listings().find((l) => l.id === 'hj-1001')!;
    const gracht = (await searchGracht()).find((l) => l.title === 'Tulpgracht 12 a')!;
    expect(huisje.addressText).toBe('Tulpgracht 12-A');
    expect(gracht.title).not.toBe(huisje.addressText);
    expect(gracht.address).toMatchObject({
      street: huisje.street,
      houseNumber: huisje.houseNumber,
      addition: huisje.addition,
      postcode: huisje.postcode,
    });
  });

  test('detail reads the description, the photos and the availability date', async () => {
    const [first] = (await searchGracht()).filter((l) => l.title === 'Lakenweversgracht 31');
    const detailed = await adapter().detail!(first!, context('agency:de-gracht'));
    expect(detailed.description).toContain('Inkomenseis 3,5x de kale huur');
    expect(detailed.images).toEqual([`${box.url}/media/dg-2002/1.svg`, `${box.url}/media/dg-2002/2.svg`]);
    expect(detailed.availableFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('isAvailable turns false when the listing is removed or rented', async () => {
    const all = await searchGracht();
    const a = asListing(all.find((l) => l.title === 'Havenlichtweg 3')!);
    const b = asListing(all.find((l) => l.title === 'Zoutkeetsingel 9')!);
    const ctx = context('agency:de-gracht');
    expect(await adapter().isAvailable!(a, ctx)).toBe(true);
    box.control.removeListing('dg-2005');
    box.control.removeListing('dg-2012', 'rented');
    expect(await adapter().isAvailable!(a, ctx)).toBe(false);
    expect(await adapter().isAvailable!(b, ctx)).toBe(false);
  });

  test('the contact form records a submission and thanks the sender', async () => {
    const res = await fetch(`${box.url}/gracht/contact`, {
      method: 'POST',
      body: new URLSearchParams({
        object: 'dg-2002',
        naam: 'Sam de Vries',
        email: 'sam@nlpf.test',
        telefoon: '0600000000',
        bericht: 'Graag kom ik kijken.',
      }),
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toMatch(/Bedankt voor uw reactie op Lakenweversgracht 31/);
    expect(box.control.submissions()[0]).toMatchObject({
      source: 'gracht',
      listingId: 'dg-2002',
      channel: 'form',
      replyChannel: 'email',
      name: 'Sam de Vries',
      phone: '0600000000',
      landlord: { email: GRACHT_EMAIL, kind: 'makelaar' },
    });
  });

  test('the contact form refuses a rented home without saying thank you', async () => {
    box.control.removeListing('dg-2003', 'rented');
    const res = await fetch(`${box.url}/gracht/contact`, {
      method: 'POST',
      body: new URLSearchParams({ object: 'dg-2003', naam: 'Sam', email: 'sam@nlpf.test', bericht: 'Hallo' }),
    });
    expect(res.status).toBe(409);
    expect(await res.text()).not.toMatch(/bedankt|verzonden|thank you/i);
    expect(box.control.submissions()).toHaveLength(0);
  });

  test('pages before sending never show the confirmation words', async () => {
    const [l] = await searchGracht();
    const html = await (await fetch(l!.url)).text();
    expect(html).toContain('id="contact"');
    expect(html.replace(/<[^>]+>/g, ' ')).not.toMatch(/bedankt|verzonden|thank you/i);
  });

  test('the booking page offers the times from the viewing email and books one', async () => {
    await fetch(`${box.url}/gracht/contact`, {
      method: 'POST',
      body: new URLSearchParams({
        object: 'dg-2011',
        naam: 'Sam de Vries',
        email: 'sam@nlpf.test',
        bericht: 'Graag een bezichtiging.',
      }),
    });
    const sub = box.control.submissions()[0]!;
    const reply = await box.control.landlordReply(sub.id, 'viewing_slots');
    expect(reply.text).toContain(`/gracht/bezichtiging/${sub.id}`);
    const page = await (await fetch(`${box.url}/gracht/bezichtiging/${sub.id}`)).text();
    expect(page).toContain(reply.slots![0]!.text);
    const booked = await fetch(`${box.url}/gracht/bezichtiging/${sub.id}`, {
      method: 'POST',
      body: new URLSearchParams({ slot: '1' }),
    });
    expect(await booked.text()).toContain('Bezichtiging gepland');
    expect(box.control.submission(sub.id)!.booking?.slot).toEqual(reply.slots![1]);
  });
});
