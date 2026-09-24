import { fold, parseEuro, parseSmallNumber, SMALL_NUMBER_PATTERN } from './text.js';

/*
 * Fee and deposit flags for listings and messages. The rules:
 * - Mediation, administration or contract fees may not be charged to a
 *   tenant when the agent works for the landlord ("dubbele petten" ban,
 *   Burgerlijk Wetboek 7:264 and 7:417; see !WOON, docs/research/competitors.md
 *   section 6 and 7.4). Tenants can reclaim them.
 * - The deposit is at most two months of base rent for contracts from
 *   1 July 2023 (Wet goed verhuurderschap, art. 7:261a BW).
 * - Key money (sleutelgeld) or a takeover sum not tied to movable items is
 *   not allowed (art. 7:264 BW).
 * These are flags for a person to read, not legal advice.
 */

export type FeeFlag = 'mediation_fee' | 'deposit_above_2x' | 'key_money';

const MEDIATION = /bemiddelingskosten|bemiddelingsfee|bemiddelingsvergoeding|makelaarskosten|makelaarscourtage|\bcourtage\b|agency fees?|agent'?s? fees?|mediation (?:fees?|costs?)|brokerage fees?|administratiekosten|administration (?:fees?|costs?)|admin fees?|contractkosten|contract (?:fees?|costs)|dossierkosten/g;
const KEY_MONEY = /sleutelgeld|key money|key fees?|overnamekosten|overnamesom|take-?over (?:fees?|sum)/g;
const DEPOSIT = /\b(?:waarborgsom|borgsom|borg|huurwaarborg|security deposit|deposit)\b/g;

const NEGATED_BEFORE = /\b(geen|no|zonder|without|free of|niet|not|nul|zero)\b[\w\s,'-]{0,20}$/;
const NEGATED_AFTER = /^[\s:=-]*(n\.?v\.?t\.?|nvt|geen|none|n\/a|nil|nihil|free|gratis|(€|eur|euro)?\s*0(?:[,.]0+|,-)?(?!\d))/;

const MONTHS = new RegExp(`(${SMALL_NUMBER_PATTERN})\\s*(?:x\\b|keer\\b|times\\b|maanden|maandhuren|maand\\b|months?'?s?\\b|month's)`);
const EURO = /(?:€|eur|euro)\s*(\d[\d.,]*(?:,-)?)|(\d[\d.,]*)\s*(?:€|euro|eur)\b/;

/** Clauses split on sentence ends, but not on the dot inside "1.250" or "n.v.t.". */
const clauses = (text: string) =>
  fold(text)
    .replace(/\bn\.\s?v\.\s?t\.?/g, 'nvt')
    .split(/[\n;!?]|\.(?!\d)/);

function mentioned(clause: string, re: RegExp): boolean {
  for (const m of clause.matchAll(re)) {
    const before = clause.slice(Math.max(0, m.index - 30), m.index);
    const after = clause.slice(m.index + m[0].length, m.index + m[0].length + 20);
    if (!NEGATED_BEFORE.test(before) && !NEGATED_AFTER.test(after)) return true;
  }
  return false;
}

function depositTooHigh(clause: string, priceEur: number | undefined): boolean {
  for (const m of clause.matchAll(DEPOSIT)) {
    const after = clause.slice(m.index + m[0].length, m.index + m[0].length + 60);
    const before = clause.slice(Math.max(0, m.index - 30), m.index);
    const months = MONTHS.exec(after) ?? MONTHS.exec(before);
    const n = months ? parseSmallNumber(months[1]!) : undefined;
    if (n !== undefined && n > 2) return true;
    if (priceEur) {
      const amount = EURO.exec(after);
      const eur = amount ? parseEuro(amount[1] ?? amount[2] ?? '') : undefined;
      if (eur !== undefined && eur > 2 * priceEur + 1) return true;
    }
  }
  return false;
}

/** Flags illegal fees and deposits in a listing or message, in Dutch and English. */
export function feeFlags(text: string, priceEur?: number): FeeFlag[] {
  const flags = new Set<FeeFlag>();
  for (const clause of clauses(text)) {
    if (mentioned(clause, MEDIATION)) flags.add('mediation_fee');
    if (depositTooHigh(clause, priceEur)) flags.add('deposit_above_2x');
    if (mentioned(clause, KEY_MONEY)) flags.add('key_money');
  }
  return (['mediation_fee', 'deposit_above_2x', 'key_money'] as FeeFlag[]).filter((f) => flags.has(f));
}
