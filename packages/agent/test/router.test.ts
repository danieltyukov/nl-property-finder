import { describe, expect, test } from 'vitest';
import { SourceConfigSchema, type SourceConfig } from '@nlpf/core';
import { effectiveContactMode, planContact } from '../src/router.js';
import { adapter, config, listing, registryOf } from './helpers.js';

const kamernet = adapter({
  id: 'kamernet',
  name: 'Kamernet',
  capabilities: {
    search: 'json',
    detail: true,
    contact: 'message',
    login: 'required',
    paid: { feature: 'contact', plan: 'kamernet-premium' },
    terms: 'forbids',
  },
});
const pararius = adapter({
  id: 'pararius',
  name: 'Pararius',
  capabilities: { search: 'browser', detail: true, contact: 'form', login: 'required', terms: 'forbids' },
});
const funda = adapter({
  id: 'funda',
  name: 'Funda',
  capabilities: { search: 'html', detail: true, contact: 'form', login: 'none', terms: 'forbids' },
});
const agency = adapter({
  id: 'agency:example',
  name: 'Example Makelaardij',
  capabilities: { search: 'html', detail: true, contact: 'email', login: 'none', terms: 'unknown' },
});
const h2s = adapter({
  id: 'holland2stay',
  name: 'Holland2Stay',
  capabilities: { search: 'json', detail: false, contact: 'booking', login: 'required', terms: 'forbids' },
});
const registry = registryOf([kamernet, pararius, funda, agency, h2s]);

const src = (over: Partial<SourceConfig> = {}): SourceConfig => ({
  ...SourceConfigSchema.parse({}),
  ...over,
});
const optedIn = config({
  sources: {
    kamernet: src({ contact: 'auto' }),
    pararius: src({ contact: 'auto' }),
    funda: src({ contact: 'auto' }),
  },
});

describe('effectiveContactMode', () => {
  test('forbidding terms default to watch-only, unknown terms to auto, and the user choice wins', () => {
    expect(effectiveContactMode(pararius, undefined)).toBe('watch_only');
    expect(effectiveContactMode(agency, undefined)).toBe('auto');
    expect(effectiveContactMode(pararius, src({ contact: 'auto' }))).toBe('auto');
    expect(effectiveContactMode(agency, src({ contact: 'watch_only' }))).toBe('watch_only');
  });
});

describe('planContact', () => {
  const k = listing({ sourceId: 'kamernet', contact: 'message' });

  test('a paywalled Kamernet listing routes through a free Pararius copy of the same home', () => {
    const p = listing({
      sourceId: 'pararius',
      contact: 'form',
      contactUrl: 'https://www.pararius.nl/contact/abc',
    });
    const plan = planContact(k, [k, p], registry, optedIn);
    expect(plan).toEqual({
      plan: 'send',
      channel: {
        kind: 'form',
        sourceId: 'pararius',
        listingId: p.id,
        url: 'https://www.pararius.nl/contact/abc',
      },
      via: p,
    });
  });

  test('with no other listing, an agent email on the listing is used', () => {
    const withMail = { ...k, agent: { name: 'Delft Rentals', email: 'Verhuur@DelftRentals.nl' } };
    const plan = planContact(withMail, [withMail], registry, optedIn);
    expect(plan).toMatchObject({
      plan: 'send',
      channel: { kind: 'email', address: 'verhuur@delftrentals.nl', listingId: withMail.id },
      via: withMail,
    });
  });

  test('with neither, a manual task explains the paywall', () => {
    expect(planContact(k, [k], registry, optedIn)).toEqual({
      plan: 'manual',
      reason: 'Kamernet Premium needed and no free copy of this home was found',
    });
  });

  test('a configured paid plan or a free-to-react listing opens the platform channel', () => {
    const paid = config({ sources: { kamernet: src({ contact: 'auto', paidPlan: 'kamernet-premium' }) } });
    expect(planContact(k, [k], registry, paid)).toMatchObject({
      plan: 'send',
      channel: { kind: 'message', sourceId: 'kamernet' },
    });
    const free = { ...k, extra: { isReactForFree: true } };
    expect(planContact(free, [free], registry, optedIn)).toMatchObject({
      plan: 'send',
      channel: { kind: 'message', sourceId: 'kamernet' },
    });
  });

  test('a guest form beats a logged-in form, which beats a message', () => {
    const p = listing({ sourceId: 'pararius', contact: 'form' });
    const f = listing({ sourceId: 'funda', contact: 'form' });
    const free = { ...k, extra: { isReactForFree: true } };
    expect(planContact(free, [free, p, f], registry, optedIn)).toMatchObject({
      plan: 'send',
      via: { id: f.id },
    });
    expect(planContact(free, [free, p], registry, optedIn)).toMatchObject({
      plan: 'send',
      via: { id: p.id },
    });
  });

  test("the landlord's own portal beats a guest form for the same home on a listing platform", () => {
    // MVGM answers a Funda message with "apply on our website"; its portal is where the application counts.
    const mvgm = adapter({
      id: 'mvgm',
      name: 'MVGM',
      capabilities: { search: 'html', detail: true, contact: 'form', login: 'required', terms: 'unknown', landlordPortal: true },
    });
    const reg = registryOf([funda, mvgm]);
    const onFunda = listing({ sourceId: 'funda', contact: 'form' });
    const onPortal = listing({ sourceId: 'mvgm', contact: 'form' });
    expect(planContact(onFunda, [onFunda, onPortal], reg, optedIn)).toMatchObject({ plan: 'send', via: { id: onPortal.id } });
  });

  test('an agent email beats nothing but loses to a platform form', () => {
    const a = listing({
      sourceId: 'agency:example',
      contact: 'email',
      agent: { email: 'info@example-makelaar.nl' },
    });
    const f = listing({ sourceId: 'funda', contact: 'form' });
    expect(planContact(a, [a, f], registry, optedIn)).toMatchObject({ plan: 'send', via: { id: f.id } });
    expect(planContact(a, [a], registry, optedIn)).toMatchObject({
      plan: 'send',
      channel: { kind: 'email', address: 'info@example-makelaar.nl', sourceId: 'agency:example' },
    });
  });

  test('a watch-only source leads to watch, with the reason', () => {
    const p = listing({ sourceId: 'pararius', contact: 'form' });
    expect(planContact(p, [p], registry, config())).toEqual({
      plan: 'watch',
      reason: 'Pararius is watch-only: its terms forbid automated messages and you have not opted in',
    });
  });

  test('gone listings and disabled sources are skipped', () => {
    const f = listing({ sourceId: 'funda', contact: 'form', state: 'gone' });
    const p = listing({ sourceId: 'pararius', contact: 'form' });
    expect(planContact(p, [p, f], registry, optedIn)).toMatchObject({ plan: 'send', via: { id: p.id } });
    const disabled = config({
      sources: { ...optedIn.sources, pararius: src({ contact: 'auto', enabled: false }) },
    });
    expect(planContact(p, [p], registry, disabled).plan).not.toBe('send');
  });

  test('booking platforms need a person', () => {
    const b = listing({ sourceId: 'holland2stay', contact: 'booking' });
    expect(
      planContact(b, [b], registry, config({ sources: { holland2stay: src({ contact: 'auto' }) } })),
    ).toEqual({
      plan: 'manual',
      reason: 'Holland2Stay needs a booking made by you',
    });
  });

  test('an unknown source or no contact method gives a manual reason', () => {
    const x = listing({ sourceId: 'mystery', contact: 'none' });
    expect(planContact(x, [x], registry, config())).toEqual({
      plan: 'manual',
      reason: 'No way to contact this home automatically',
    });
  });
});
