import { beforeEach, describe, expect, test } from 'vitest';
import { openStore, type InboundMessage, type Store } from '@nlpf/core';
import { matchInbound } from '../src/matchInbound.js';
import { listing } from './helpers.js';

const T = '2026-09-23T10:00:00.000Z';
let store: Store;
const ids: Record<string, string> = {};

function home(
  key: string,
  address: { street: string; houseNumber: string; addition?: string; postcode?: string },
  email?: string,
  outId?: string,
) {
  const p = store.properties.create(
    {
      id: `p_${key}`,
      key: `k_${key}`,
      address: { ...address, city: 'Delft' },
      title: `${address.street} ${address.houseNumber}${address.addition ?? ''}`,
    },
    T,
  );
  const app = store.applications.update(
    store.applications.ensure(p.id, T).id,
    { status: 'contacted', contactedAt: T },
    T,
  );
  ids[`app_${key}`] = app.id;
  if (email) {
    const c = store.conversations.create({
      applicationId: app.id,
      propertyId: p.id,
      counterpart: { email },
      lastMessageAt: T,
      unread: 0,
    });
    ids[`c_${key}`] = c.id;
    if (outId)
      store.messages.add({
        conversationId: c.id,
        direction: 'out',
        author: 'agent',
        channel: 'email',
        body: 'Beste verhuurder',
        at: T,
        externalId: outId,
        status: 'sent',
      });
  }
  return { p, app };
}

const mail = (over: Partial<InboundMessage>): InboundMessage => ({
  id: `<in-${Math.random()}@example.test>`,
  channel: 'email',
  from: { address: 'someone@example.test' },
  subject: 'Re: uw reactie',
  text: 'Hallo',
  at: T,
  attachments: [],
  ...over,
});

beforeEach(() => {
  store = openStore(':memory:');
  home(
    'oude',
    { street: 'Oude Delft', houseNumber: '12', addition: 'A', postcode: '2611 CC' },
    'verhuur@delftrentals.nl',
    '<out-1@nlpf.test>',
  );
  home('west', { street: 'Westvest', houseNumber: '5' }, 'info@makelaar-west.nl', '<out-2@nlpf.test>');
});

test('In-Reply-To wins over the sender address', () => {
  const m = mail({ from: { address: 'info@makelaar-west.nl' }, inReplyTo: '<out-1@nlpf.test>' });
  expect(matchInbound(m, store)).toEqual({
    conversationId: ids.c_oude,
    applicationId: ids.app_oude,
    confidence: 'thread',
  });
});

test('References are searched too', () => {
  const m = mail({ references: ['<unknown@x>', '<out-2@nlpf.test>'] });
  expect(matchInbound(m, store)).toMatchObject({ conversationId: ids.c_west, confidence: 'thread' });
});

test('a platform thread id matches its conversation', () => {
  const { app } = home('kamer', { street: 'Phoenixstraat', houseNumber: '20' });
  const c = store.conversations.create({
    applicationId: app.id,
    propertyId: app.propertyId,
    counterpart: { sourceId: 'kamernet', threadId: 'T9' },
    lastMessageAt: T,
    unread: 0,
  });
  const m = mail({
    channel: 'platform',
    sourceId: 'kamernet',
    threadId: 'T9',
    from: { name: 'Kamernet user' },
  });
  expect(matchInbound(m, store)).toEqual({
    conversationId: c.id,
    applicationId: app.id,
    confidence: 'thread',
  });
});

test('the sender address matches regardless of case', () => {
  expect(matchInbound(mail({ from: { address: 'VERHUUR@DelftRentals.nl' } }), store)).toEqual({
    conversationId: ids.c_oude,
    applicationId: ids.app_oude,
    confidence: 'sender',
  });
});

test('a colleague at the same agency matches by domain', () => {
  expect(matchInbound(mail({ from: { address: 'jan@makelaar-west.nl' } }), store)).toMatchObject({
    applicationId: ids.app_west,
    confidence: 'sender',
  });
});

test('an agent email on a listing matches an application without a conversation', () => {
  const { p, app } = home('oost', { street: 'Oostsingel', houseNumber: '8' });
  const { listing: l } = store.listings.upsert(
    listing({ externalId: 'oost', agent: { email: 'info@vastgoed-oost.nl' } }),
    'poll',
    T,
  );
  store.listings.setProperty(l.id, p.id);
  expect(matchInbound(mail({ from: { address: 'piet@vastgoed-oost.nl' } }), store)).toEqual({
    applicationId: app.id,
    confidence: 'sender',
  });
});

test('free-mail domains never match by domain', () => {
  const { app } = home('gm', { street: 'Koornmarkt', houseNumber: '3' });
  store.conversations.create({
    applicationId: app.id,
    propertyId: app.propertyId,
    counterpart: { email: 'landlord@gmail.com' },
    lastMessageAt: T,
    unread: 0,
  });
  expect(matchInbound(mail({ from: { address: 'stranger@gmail.com' } }), store)).toEqual({
    confidence: 'none',
  });
});

test('an unknown sender mentioning "Oude Delft 12A" matches the open application for that address', () => {
  const m = mail({
    from: { address: 'j.jansen@hotmail.com' },
    text: 'Hallo, ik reageer op uw bericht over de woning aan de Oude Delft 12A. Groet, Jan',
  });
  expect(matchInbound(m, store)).toEqual({
    conversationId: ids.c_oude,
    applicationId: ids.app_oude,
    confidence: 'address',
  });
  const spaced = mail({ from: { address: 'j.jansen@hotmail.com' }, subject: 'Woning Oude Delft 12-a' });
  expect(matchInbound(spaced, store)).toMatchObject({ applicationId: ids.app_oude, confidence: 'address' });
});

test('another number or addition on the same street does not match', () => {
  expect(matchInbound(mail({ text: 'Over Oude Delft 120' }), store)).toEqual({ confidence: 'none' });
  expect(matchInbound(mail({ text: 'Over Oude Delft 12B' }), store)).toEqual({ confidence: 'none' });
});

test('a closed application is not matched by address', () => {
  store.applications.update(ids.app_oude!, { status: 'withdrawn' }, T);
  expect(matchInbound(mail({ text: 'Oude Delft 12A is nog beschikbaar' }), store)).toEqual({
    confidence: 'none',
  });
});

test('an unrelated email returns none', () => {
  expect(
    matchInbound(
      mail({ from: { address: 'news@shop.example' }, subject: 'Aanbieding', text: 'Deze week 20% korting.' }),
      store,
    ),
  ).toEqual({ confidence: 'none' });
});

describe('one agency, several open homes', () => {
  const setup = () => {
    const store = openStore(':memory:');
    const now = '2026-09-24T10:00:00.000Z';
    const homes = [
      { id: 'p1', street: 'Tulpgracht', number: '12', addition: 'A' },
      { id: 'p2', street: 'Havenlichtweg', number: '7', addition: '' },
    ];
    for (const h of homes) {
      store.properties.create({ id: h.id, key: h.id, title: `${h.street} ${h.number}${h.addition}`, address: { street: h.street, houseNumber: h.number, addition: h.addition || undefined, city: 'Delft' } }, now);
      const app = store.applications.ensure(h.id, now);
      store.applications.update(app.id, { status: 'contacted', contactedAt: now }, now);
      store.conversations.create({ applicationId: app.id, propertyId: h.id, counterpart: { email: 'verhuur@degracht.example' }, lastMessageAt: now, unread: 0 });
    }
    return store;
  };
  const mail = (text: string): InboundMessage => ({ id: '<x@degracht.example>', channel: 'email', from: { address: 'verhuur@degracht.example' }, text, at: '2026-09-24T11:00:00.000Z', attachments: [] });

  test('the address in the text decides between them', () => {
    const store = setup();
    const m = matchInbound(mail('Beste Sam, bedankt voor uw interesse in Havenlichtweg 7. Kunt u donderdag komen?'), store);
    expect(m.confidence).toBe('address');
    expect(store.applications.get(m.applicationId!)?.propertyId).toBe('p2');
  });

  test('without an address a person decides instead of a guess', () => {
    const store = setup();
    expect(matchInbound(mail('Beste Sam, kunt u donderdag langskomen?'), store).confidence).toBe('none');
  });
});
