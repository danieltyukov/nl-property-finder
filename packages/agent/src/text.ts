/** Lowercase and strip diacritics ("Café" -> "cafe"). */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Letters and digits only, folded. "Anti-kraak" and "antikraak" both become "antikraak". */
export function squash(s: string): string {
  return fold(s).replace(/[^a-z0-9]+/g, '');
}

/** Folded text with every run of non-alphanumerics collapsed to one space, padded for word matching. */
export function words(s: string): string {
  return ` ${fold(s)
    .replace(/[^a-z0-9€]+/g, ' ')
    .trim()} `;
}

/**
 * Parses a euro amount written the Dutch way ("1.250,-", "1.250,50") or the
 * English way ("1,250.50", "1250"). Returns undefined for anything else.
 */
export function parseEuro(raw: string): number | undefined {
  let s = raw
    .replace(/[€\s]|eur(o)?/gi, '')
    .replace(/,-+$/, '')
    .replace(/\.-+$/, '');
  if (!/\d/.test(s)) return undefined;
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(s)) s = s.replace(/,/g, '');
  else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

const NUMBER_WORDS: Record<string, number> = {
  een: 1,
  één: 1,
  twee: 2,
  drie: 3,
  vier: 4,
  vijf: 5,
  zes: 6,
  zeven: 7,
  acht: 8,
  negen: 9,
  tien: 10,
  elf: 11,
  twaalf: 12,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

/** "3", "drie", "three" -> 3. */
export function parseSmallNumber(s: string): number | undefined {
  const t = fold(s.trim());
  if (/^\d+([.,]\d+)?$/.test(t)) return Number(t.replace(',', '.'));
  return NUMBER_WORDS[t];
}

export const SMALL_NUMBER_PATTERN =
  '(?:\\d+(?:[.,]\\d+)?|een|twee|drie|vier|vijf|zes|zeven|acht|negen|tien|elf|twaalf|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)';

/** A very small Dutch/English guess based on common function words. */
export function guessLanguage(text: string): 'nl' | 'en' | undefined {
  const w = words(text);
  const count = (list: string[]) => list.reduce((n, x) => n + (w.split(` ${x} `).length - 1), 0);
  const nl = count([
    'de',
    'het',
    'een',
    'en',
    'van',
    'met',
    'voor',
    'is',
    'zijn',
    'wij',
    'u',
    'je',
    'huur',
    'woning',
    'per',
    'maand',
    'niet',
  ]);
  const en = count([
    'the',
    'a',
    'and',
    'of',
    'with',
    'for',
    'is',
    'are',
    'we',
    'you',
    'rent',
    'month',
    'not',
    'apartment',
    'room',
  ]);
  if (nl === 0 && en === 0) return undefined;
  return nl >= en ? 'nl' : 'en';
}
