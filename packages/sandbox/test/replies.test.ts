import { describe, expect, test } from 'vitest';
import { amsterdam, type InboundMessage, type Intent, type Lang } from '@nlpf/core';
// The sandbox does not depend on these packages; its tests check that they read its texts.
import { createDemoProvider, createRulesProvider, reviewContractRules } from '@nlpf/ai';
import { parseSlots } from '@nlpf/agent';
import catalogueFile from '../data/listings.json' with { type: 'json' };
import repliesFile from '../data/replies.json' with { type: 'json' };
import {
  CATALOGUE,
  REPLIES,
  REPLY_KINDS,
  composeReply,
  contractPdf,
  pdfText,
  type ReplyKind,
} from '../src/index.js';
import { createRng } from '../src/rng.js';
import { World } from '../src/world.js';

const NOW = new Date('2026-09-24T10:00:00Z'); // a Thursday
const EXPECTED: Record<ReplyKind, Intent[]> = {
  viewing_slots: ['viewing_slots'],
  info_request: ['info_request'],
  documents_request: ['documents_request'],
  rejection: ['rejection'],
  payment_request: ['payment_request'],
  offer: ['offer'],
  listing_gone: ['listing_gone'],
};

function allTexts(now: Date) {
  const world = new World({ seed: 1, now: () => now });
  const listing = world.add({ key: 'delft-tulpgracht-12a' });
  const out: { kind: ReplyKind; lang: Lang; variant: number; subject: string; text: string }[] = [];
  for (const kind of REPLY_KINDS) {
    for (const lang of ['nl', 'en'] as const) {
      REPLIES.texts[kind][lang].forEach((_, variant) => {
        // Pick the variant by walking seeds until the stream lands on it.
        for (let seed = 0; seed < 500; seed++) {
          const r = composeReply({
            kind,
            lang,
            listing,
            applicantName: 'Sam de Vries',
            landlordName: 'Joost van Dam',
            agency: false,
            now,
            rng: createRng(seed),
          });
          if (r.variant === variant) {
            out.push({ kind, lang, variant, subject: r.subject, text: r.text });
            return;
          }
        }
        throw new Error(`variant ${variant} of ${kind}/${lang} never chosen`);
      });
    }
  }
  return out;
}

const inbound = (text: string): InboundMessage => ({
  id: '<x@sandbox.example>',
  channel: 'email',
  from: { name: 'Joost van Dam', address: 'joost@vandam-verhuur.example' },
  text,
  at: NOW.toISOString(),
  attachments: [],
});

describe('landlord reply texts', () => {
  test('every kind has Dutch and English texts and subjects', () => {
    for (const kind of REPLY_KINDS) {
      expect(REPLIES.texts[kind].nl.length).toBeGreaterThan(0);
      expect(REPLIES.texts[kind].en.length).toBeGreaterThan(0);
      expect(REPLIES.subjects[kind].nl).toBeTruthy();
      expect(REPLIES.subjects[kind].en).toBeTruthy();
    }
  });

  test('the demo provider classifies every text as the kind it was written for', async () => {
    const demo = createDemoProvider();
    for (const t of allTexts(NOW)) {
      const out = await demo.classify({ message: inbound(t.text), now: NOW.toISOString() });
      expect(EXPECTED[t.kind], `${t.kind}/${t.lang}#${t.variant}: ${t.text}`).toContain(out.intent);
    }
  });

  test('the rules provider reads them the same way', async () => {
    const rules = createRulesProvider();
    for (const t of allTexts(NOW)) {
      const out = await rules.classify({ message: inbound(t.text), now: NOW.toISOString() });
      const expected = t.kind === 'offer' ? ['offer', 'contract'] : EXPECTED[t.kind];
      expect(expected, `${t.kind}/${t.lang}#${t.variant}: ${t.text}`).toContain(out.intent);
    }
  });

  test('every text names the listing street and number', () => {
    for (const t of allTexts(NOW))
      expect(t.text, `${t.kind}/${t.lang}#${t.variant}`).toContain('Tulpgracht 12-A');
  });

  test('viewing times parse as certain slots inside the default availability, whatever the weekday', () => {
    for (let day = 0; day < 7; day++) {
      const now = new Date(NOW.getTime() + day * 86_400_000);
      for (const t of allTexts(now).filter((x) => x.kind === 'viewing_slots')) {
        const slots = parseSlots(t.text, now);
        expect(slots.length, `${now.toISOString()} ${t.lang}#${t.variant}: ${t.text}`).toBeGreaterThanOrEqual(
          2,
        );
        for (const s of slots) {
          expect(s.certain).toBe(true);
          const p = amsterdam(new Date(s.start));
          const weekend = p.weekday === 'sat' || p.weekday === 'sun';
          const minutes = p.hh * 60 + p.mm;
          expect(minutes).toBeGreaterThanOrEqual(weekend ? 600 : 540);
          expect(minutes + 30).toBeLessThanOrEqual(weekend ? 1080 : 1200);
          expect(new Date(s.start).getTime()).toBeGreaterThan(now.getTime() + 86_400_000);
        }
      }
    }
  });

  test('the viewing text reads like a Dutch landlord wrote it', () => {
    const nl = allTexts(NOW).filter((t) => t.kind === 'viewing_slots' && t.lang === 'nl');
    expect(nl.map((t) => t.text).join('\n')).toMatch(
      /(maandag|dinsdag|woensdag|donderdag|vrijdag) \d{1,2} (september|oktober) om \d{2}:\d{2}/,
    );
    expect(nl.map((t) => t.text).join('\n')).toMatch(
      /zaterdag (\d{1,2} (september|oktober) )?tussen \d{2}:\d{2} en \d{2}:\d{2}/,
    );
  });

  test('the contract flags the three month deposit with the rules check', () => {
    const world = new World({ seed: 1, now: () => NOW });
    const listing = world.add({ key: 'den-haag-kustlichtkade-140' });
    const text = pdfText(contractPdf(listing, 'Eva Brouwer', 'Sam de Vries', true));
    expect(text).toContain('waarborgsom van 3 maanden kale huur');
    const review = reviewContractRules({ text, language: 'nl', priceEur: listing.priceEur });
    expect(review.findings.some((f) => f.severity === 'illegal' && f.topic === 'deposit')).toBe(true);
  });
});

describe('the data files', () => {
  const strings = (v: unknown): string[] =>
    typeof v === 'string'
      ? [v]
      : Array.isArray(v)
        ? v.flatMap(strings)
        : v && typeof v === 'object'
          ? Object.values(v).flatMap(strings)
          : [];

  test('no em dashes, en dashes or emojis anywhere', () => {
    for (const s of [...strings(catalogueFile), ...strings(repliesFile)]) {
      expect(s).not.toMatch(/[\u2013\u2014]/);
      expect(s).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  test('30 listings in Delft, Rotterdam and Den Haag, in Dutch and English', () => {
    expect(CATALOGUE).toHaveLength(30);
    const cities = new Map<string, number>();
    for (const e of CATALOGUE) cities.set(e.city, (cities.get(e.city) ?? 0) + 1);
    expect([...cities.keys()].sort()).toEqual(['Delft', 'Den Haag', 'Rotterdam']);
    expect(CATALOGUE.some((e) => e.language === 'en')).toBe(true);
    expect(CATALOGUE.some((e) => e.language === 'nl')).toBe(true);
    expect(new Set(CATALOGUE.map((e) => e.id)).size).toBe(30);
    expect(new Set(CATALOGUE.map((e) => e.key)).size).toBe(30);
    expect(CATALOGUE.filter((e) => e.source === 'huisje').length).toBeGreaterThan(10);
    expect(CATALOGUE.filter((e) => e.source === 'gracht').length).toBeGreaterThan(10);
  });

  test('one scam, one "geen studenten", one "inschrijven niet mogelijk" and one home on both sources', () => {
    const tagged = (s: string) => CATALOGUE.filter((e) => e.scenarios?.includes(s as never));
    expect(tagged('scam')).toHaveLength(1);
    expect(tagged('scam')[0]!.description).toMatch(/abroad/);
    expect(tagged('no_students')[0]!.description).toContain('Geen studenten');
    expect(tagged('no_registration')[0]!.description).toContain('Inschrijven op dit adres is niet mogelijk');
    const copy = CATALOGUE.find((e) => e.duplicateOf)!;
    const original = CATALOGUE.find((e) => e.key === copy.duplicateOf)!;
    expect(copy.source).not.toBe(original.source);
    expect(copy.addressText).not.toBe(original.addressText);
    expect([copy.street, copy.houseNumber, copy.addition, copy.postcode]).toEqual([
      original.street,
      original.houseNumber,
      original.addition,
      original.postcode,
    ]);
  });

  test('every script uses known reply kinds', () => {
    for (const e of CATALOGUE) for (const k of e.script) expect(REPLY_KINDS).toContain(k);
  });
});
