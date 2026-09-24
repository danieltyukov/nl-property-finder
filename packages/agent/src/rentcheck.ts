import type { Listing, PropertyType, RentCheck } from '@nlpf/core';

/*
 * A simplified estimate of the maximum base rent of an independent home
 * (zelfstandige woonruimte) under the Dutch point system (woningwaarderings-
 * stelsel, WWS). It exists to flag listings that ask far more than the law
 * allows, and every result says it is an estimate. Only the Huurcommissie
 * can set the real maximum.
 *
 * Sources, all checked on 2026-09-24:
 * - Huurcommissie, Beleidsboek Waarderingsstelsel zelfstandige woonruimte,
 *   version 1 January 2026, chapter 2 (the rubrieken below):
 *   https://www.huurcommissie.nl/support/beleidsboeken/waarderingsstelsel-zelfstandige-woonruimte/algemene-toelichting
 * - Volkshuisvesting Nederland, Maximale huurprijsgrenzen zelfstandige
 *   woningen per 1 januari 2026 (the table below, published 2025-11-25):
 *   https://www.volkshuisvestingnederland.nl/documenten/2025/11/25/maximale-huurprijsgrenzen-zelfstandige-woningen-per-1-januari-2026
 * - Sector boundaries: up to 143 points social, 144 to 186 regulated middle
 *   rent (Wet betaalbare huur, 1 July 2024), 187 and more free sector.
 *   https://www.volkshuisvestingnederland.nl/onderwerpen/huren-en-wonen/inkomensgrenzen-huurprijsgrenzen-en-huurtoeslagparameters/maximale-huurprijsgrenzen
 *
 * What is measured and what is assumed:
 * - Floor area (rubriek 1 and 2): all of the BAG usable area counts at the
 *   rate for rooms, 1 point per m2 (other spaces would get 0.75). This leans
 *   high on purpose, so a flag means the rent is likely too high.
 * - Energy (rubriek 4): the registered label, or, when EP-Online confirmed
 *   there is no valid label, the build year table. When the label is simply
 *   unknown, label A is assumed (again leaning high).
 * - WOZ (rubriek 11): the official value with the divisors for its
 *   peildatum, the 33% cap from 187 points with the floor of 186, and the
 *   legal minimum WOZ when no value is known.
 * - Heating, kitchen, sanitary (rubriek 3, 5, 6): typical fittings by size,
 *   listed in TYPICAL below. Outdoor space (rubriek 8) counts 0, between the
 *   real range of -5 (none at all) and +15.
 * - Not modelled: surcharges for monuments and new builds (2.13), special
 *   rules for new builds of 2015 to 2022 (2.11.5, 2.11.6), care homes.
 */

/** Maximum base rent per point from 40 to 250 points, per 1 January 2026. Below 40 points the 40-point amount applies. */
const MAX_RENT_2026 = [
  250.26, 256.53, 262.75, 269.02, 275.27, 281.5, 287.78, 294.03, 300.29, 306.54, 312.8, 319.02, 325.3, 331.54,
  337.8, 344.05, 350.35, 356.53, 362.79, 369.09, 375.32, 381.55, 387.83, 394.06, 400.32, 406.58, 412.85,
  419.1, 425.33, 431.56, 437.81, 444.09, 450.36, 456.57, 462.86, 469.09, 475.36, 481.6, 487.89, 494.1, 500.38,
  507.22, 514.08, 520.96, 527.81, 534.7, 541.56, 548.41, 555.29, 562.13, 569.03, 575.87, 582.71, 589.61,
  596.45, 603.32, 610.19, 617.08, 623.94, 630.82, 637.67, 644.53, 651.36, 658.24, 665.12, 671.95, 678.85,
  685.7, 692.56, 699.44, 706.32, 713.2, 720.05, 726.9, 733.79, 740.66, 747.51, 754.37, 761.21, 768.08, 774.94,
  781.85, 788.71, 795.56, 802.44, 809.3, 816.14, 823.02, 829.94, 836.74, 843.62, 850.49, 857.33, 864.24,
  871.06, 877.97, 884.79, 891.67, 898.56, 905.39, 912.26, 919.14, 925.98, 932.93, 939.73, 946.61, 953.45,
  960.33, 967.18, 974.05, 980.91, 987.78, 994.63, 1001.5, 1008.35, 1015.22, 1022.07, 1029, 1035.81, 1042.73,
  1049.57, 1056.42, 1063.32, 1070.14, 1077, 1083.88, 1090.76, 1097.61, 1104.46, 1111.39, 1118.23, 1125.08,
  1131.94, 1138.85, 1145.69, 1152.55, 1159.4, 1166.27, 1173.15, 1180.01, 1186.84, 1193.76, 1200.61, 1207.46,
  1214.31, 1221.21, 1228.07, 1234.92, 1241.81, 1248.65, 1255.53, 1262.4, 1269.25, 1276.12, 1283, 1289.86,
  1296.7, 1303.57, 1310.46, 1317.28, 1324.18, 1331.03, 1337.89, 1344.75, 1351.63, 1358.5, 1365.34, 1372.24,
  1379.09, 1385.95, 1392.84, 1399.69, 1406.56, 1413.43, 1420.28, 1427.15, 1433.99, 1440.86, 1447.71, 1454.6,
  1461.49, 1468.31, 1475.19, 1482.05, 1488.95, 1495.77, 1502.67, 1509.53, 1516.4, 1523.28, 1530.12, 1536.98,
  1543.85, 1550.71, 1557.56, 1564.46, 1571.31, 1578.17, 1585.01, 1591.91, 1598.76, 1605.64, 1612.52, 1619.36,
  1626.24, 1633.1, 1639.96, 1646.78, 1653.7, 1660.54, 1667.4,
];

/** The year of the rent table and WOZ divisors in this file. */
export const TABLE_YEAR = 2026;
export const SOCIAL_MAX_POINTS = 143;
export const MIDDLE_MAX_POINTS = 186;

/**
 * Maximum base rent for a point total. Above 250 points each extra point
 * adds the difference between the 249 and 250 point amounts (Beleidsboek
 * 2.1.4 note).
 */
export function maxRentForPoints(points: number): number {
  const p = Math.round(points);
  if (p <= 40) return MAX_RENT_2026[0]!;
  if (p <= 250) return MAX_RENT_2026[p - 40]!;
  const step = MAX_RENT_2026[210]! - MAX_RENT_2026[209]!;
  return Math.round((MAX_RENT_2026[210]! + (p - 250) * step) * 100) / 100;
}

/**
 * WOZ divisors (onderdeel I per euro, onderdeel II per euro per m2) by the
 * WOZ peildatum (Beleidsboek 2.11.2). The value on a 2026 WOZ decision has
 * peildatum 1 January 2025.
 */
const WOZ_DIVISORS: Record<string, [number, number]> = {
  '2025-01-01': [16_954, 268],
  '2024-01-01': [15_329, 242],
  '2023-01-01': [14_543, 229],
  '2022-01-01': [14_146, 222],
};
const LATEST_PEILDATUM = '2025-01-01';
/** Used when no WOZ value is known (Beleidsboek 2.11.1, per 1 January 2026). */
export const MINIMUM_WOZ_2026 = 85_806;

/** Rounds to a quarter point; from an eighth upwards (Beleidsboek 2.1.4). */
const quarter = (x: number) => Math.round(x * 4) / 4;

export function wozPoints(wozEur: number, sizeM2: number, peildatum: string = LATEST_PEILDATUM): number {
  const [perEuro, perM2] = WOZ_DIVISORS[peildatum] ?? WOZ_DIVISORS[LATEST_PEILDATUM]!;
  return quarter(wozEur / perEuro + wozEur / Math.max(1, Math.round(sizeM2)) / perM2);
}

/** Energy label points, single-family / multi-family (Beleidsboek 2.4.4). E is -4 by law (Uhw art. 10d). */
const LABEL_POINTS: Record<string, [number, number]> = {
  'A++++': [62, 58],
  'A+++': [57, 53],
  'A++': [52, 48],
  'A+': [47, 43],
  A: [41, 37],
  B: [34, 30],
  C: [22, 15],
  D: [14, 11],
  E: [-4, -4],
  F: [-9, -9],
  G: [-15, -15],
};

/** Points by build year for homes without a valid label (Beleidsboek 2.4.5). */
function buildYearPoints(year: number): [number, number] {
  if (year >= 2002) return [41, 37];
  if (year >= 2000) return [34, 30];
  if (year >= 1992) return [22, 15];
  if (year >= 1984) return [14, 11];
  if (year >= 1979) return [-4, -4];
  if (year >= 1977) return [-9, -9];
  return [-15, -15];
}

/** "a+", "Label A++", "C" -> the canonical label, or undefined. */
export function normaliseLabel(label: string | undefined): string | undefined {
  const m = /\b([a-g])(\+{0,4})(?![a-z])/i.exec(label?.replace(/^\s*(energie)?label\s*/i, '') ?? '');
  if (!m) return undefined;
  const l = `${m[1]!.toUpperCase()}${m[2]}`;
  return l in LABEL_POINTS ? l : undefined;
}

const singleFamily = (type: PropertyType | undefined) => type === 'house';

/**
 * Energy points: the label when known; without a label, the build year when
 * given (the legal rule for homes without a valid label); with neither, the
 * label A value as an upper estimate.
 */
export function energyPoints(
  label: string | undefined,
  type: PropertyType | undefined,
  buildYear?: number,
): number {
  const idx = singleFamily(type) ? 0 : 1;
  const l = normaliseLabel(label);
  if (l) return LABEL_POINTS[l]![idx];
  if (buildYear) return buildYearPoints(buildYear)[idx];
  return LABEL_POINTS.A![idx];
}

/** Typical fittings by floor area, used for the rubrieken that listings never describe. */
const TYPICAL = {
  heatedOtherSpaces: 2, // rubriek 3: bathroom and hall at 1 point each (maximum 4)
  kitchen: (m2: number) => (m2 < 50 ? 7 : 11), // rubriek 5: worktop 1 to 2 m (4) or over 2 m (7), plus built-in appliances
  sanitary: (m2: number) => (m2 < 50 ? 8 : m2 < 90 ? 10 : 13), // rubriek 6: toilet 2 or 3, shower 4 (bath and shower 7), washbasin 1, fittings
  outdoor: 0, // rubriek 8: unknown, real range -5 to +15
};

export interface MaxRentInput {
  sizeM2: number;
  energyLabel?: string;
  type?: PropertyType;
  wozEur?: number;
  wozPeildatum?: string; // YYYY-MM-DD of the WOZ value; defaults to 2025-01-01
  buildYear?: number;
  labelChecked?: boolean; // EP-Online was asked and has no valid label, so the build year table applies
  rooms?: number;
}

export interface MaxRentEstimate {
  points: number;
  maxRentEur: number;
  sector: RentCheck['sector'];
  note: string;
}

const eur = (n: number) => `EUR ${Math.round(n).toLocaleString('en-GB')}`;

/**
 * Estimated WWS points and maximum base rent. See the header of this file
 * for every number's source and every assumption. The note always says it
 * is an estimate.
 */
export function estimateMaxRent(input: MaxRentInput): MaxRentEstimate {
  const m2 = Math.round(input.sizeM2);
  const label = normaliseLabel(input.energyLabel);
  const rooms =
    input.type === 'studio' || input.type === 'room' ? 1 : (input.rooms ?? Math.max(1, Math.round(m2 / 25)));

  const area = m2;
  const heating = 2 * rooms + TYPICAL.heatedOtherSpaces;
  const energy = energyPoints(
    label,
    input.type,
    label ? undefined : input.labelChecked ? input.buildYear : undefined,
  );
  const other = area + heating + energy + TYPICAL.kitchen(m2) + TYPICAL.sanitary(m2) + TYPICAL.outdoor;

  const woz = wozPoints(input.wozEur ?? MINIMUM_WOZ_2026, m2, input.wozPeildatum);
  let points = Math.round(other + woz);
  let capped = false;
  if (points >= 187 && input.wozEur !== undefined) {
    const maxWoz = Math.floor((other * 0.33) / 0.67);
    if (woz > maxWoz) {
      capped = true;
      points = Math.max(186, Math.round(other + maxWoz));
    }
  }

  const sector: RentCheck['sector'] =
    points <= SOCIAL_MAX_POINTS ? 'social' : points <= MIDDLE_MAX_POINTS ? 'middle' : 'free';
  const maxRentEur = maxRentForPoints(points);
  const parts = [
    `Estimate under the 2026 point system (WWS): about ${points} points, so a maximum base rent of about ${eur(maxRentEur)}` +
      (sector === 'free'
        ? ', which puts it in the free sector where no legal maximum applies.'
        : ` (${sector === 'social' ? 'social' : 'regulated middle'} rent).`),
  ];
  if (!label)
    parts.push(
      input.labelChecked && input.buildYear
        ? `No valid energy label, so the build year ${input.buildYear} sets the energy points.`
        : 'Energy label unknown, label A assumed.',
    );
  if (input.wozEur === undefined)
    parts.push(
      `WOZ value unknown, the legal minimum of ${eur(MINIMUM_WOZ_2026)} was used, so the real maximum is probably higher.`,
    );
  if (capped) parts.push('The WOZ share was capped at 33%.');
  parts.push(
    'Kitchen, bathroom, heating and outdoor space are typical assumptions. Only the Huurcommissie can set the real maximum.',
  );
  return { points, maxRentEur, sector, note: parts.join(' ') };
}

/** What `lookupPropertyFacts` found in the official registers. */
export interface PropertyFacts {
  sizeM2?: number;
  buildYear?: number;
  energyLabel?: string;
  labelChecked?: boolean;
  wozEur?: number;
  wozPeildatum?: string;
  residential?: boolean;
  sources: RentCheck['sources'];
}

/**
 * Compares a listing's base rent with the estimated legal maximum. Official
 * facts win over listing data; listing data fills gaps and is then named as
 * a source. `aboveMaxPct` (negative when below) is set only when an official
 * WOZ value is known and the home is not in the free sector, because only
 * then does the comparison mean something. Rooms (onzelfstandige
 * woonruimte) use a different point system and are not checked.
 */
export function rentCheck(
  listing: Listing,
  facts: Omit<PropertyFacts, 'sources'> & { sources: RentCheck['sources'] },
  now: Date,
): RentCheck | undefined {
  if (listing.type === 'room') return undefined;
  const sources = [...facts.sources];
  const fromListing = (official: unknown, own: unknown) => official === undefined && own !== undefined;
  if (fromListing(facts.sizeM2, listing.sizeM2) || fromListing(facts.energyLabel, listing.energyLabel))
    sources.push('listing');
  const sizeM2 = facts.sizeM2 ?? listing.sizeM2;
  if (!sizeM2) return undefined;
  const energyLabel = facts.energyLabel ?? listing.energyLabel;

  const est = estimateMaxRent({
    sizeM2,
    energyLabel,
    type: listing.type,
    wozEur: facts.wozEur,
    wozPeildatum: facts.wozPeildatum,
    buildYear: facts.buildYear,
    labelChecked: facts.labelChecked,
    rooms: listing.rooms,
  });
  const inputs: RentCheck['inputs'] = { sizeM2 };
  if (energyLabel !== undefined) inputs.energyLabel = energyLabel;
  if (facts.wozEur !== undefined) inputs.wozEur = facts.wozEur;
  if (facts.buildYear !== undefined) inputs.buildYear = facts.buildYear;

  // The tables are indexed every 1 January; say so once they are out of date.
  const note =
    now.getUTCFullYear() > TABLE_YEAR
      ? `${est.note} The ${TABLE_YEAR} tables were used; newer ones may apply.`
      : est.note;
  const out: RentCheck = {
    points: est.points,
    maxRentEur: est.maxRentEur,
    sector: est.sector,
    inputs,
    sources,
    note,
  };
  const base =
    listing.priceEur === undefined
      ? undefined
      : listing.priceBasis === 'incl'
        ? listing.priceEur - (listing.serviceCostsEur ?? 0)
        : listing.priceEur;
  if (base !== undefined && facts.wozEur !== undefined && est.sector !== 'free') {
    out.aboveMaxPct = Math.round(((base - est.maxRentEur) / est.maxRentEur) * 1000) / 10;
  }
  return out;
}
