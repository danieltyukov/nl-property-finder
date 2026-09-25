import type { Listing, Profile, Property, Requirements, SearchConfig } from '@nlpf/core';
import { inRegion } from './regions.js';
import { squash } from './text.js';

export interface FilterResult {
  passed: boolean;
  failedRule?: string;
}

type Filterable = Listing | (Property & { description?: string });

const fail = (failedRule: string): FilterResult => ({ passed: false, failedRule });

/** Monthly amount compared with the search's price range: base rent plus service costs when the search counts them. */
export function effectivePrice(l: Partial<Listing>, includeServiceCosts: boolean): number | undefined {
  if (l.priceEur === undefined) return undefined;
  if (!includeServiceCosts || l.priceBasis === 'incl') return l.priceEur;
  return l.priceEur + (l.serviceCostsEur ?? 0);
}

/**
 * Hard filters, cheapest first. Unknown values pass (a listing without a
 * size is not rejected for size); the AI extract and the person decide on
 * those. Returns the first failing rule in a short readable form.
 */
export function evaluateFilters(listing: Filterable, search: SearchConfig, profile: Profile): FilterResult {
  const l = listing as Partial<Listing> & { title: string; address: Listing['address'] };

  if (search.regions.length && !search.regions.some((r) => inRegion(l.address, r))) return fail('region');

  const price = effectivePrice(l, search.priceIncludesServiceCosts);
  if (price !== undefined) {
    if (search.priceMaxEur !== undefined && price > search.priceMaxEur)
      return fail(`price ${price} > ${search.priceMaxEur}`);
    if (search.priceMinEur !== undefined && price < search.priceMinEur)
      return fail(`price ${price} < ${search.priceMinEur}`);
  }
  if (search.sizeMinM2 !== undefined && l.sizeM2 !== undefined && l.sizeM2 < search.sizeMinM2)
    return fail(`size ${l.sizeM2} < ${search.sizeMinM2}`);
  if (search.roomsMin !== undefined && l.rooms !== undefined && l.rooms < search.roomsMin)
    return fail(`rooms ${l.rooms} < ${search.roomsMin}`);
  if (search.bedroomsMin !== undefined && l.bedrooms !== undefined && l.bedrooms < search.bedroomsMin) {
    return fail(`bedrooms ${l.bedrooms} < ${search.bedroomsMin}`);
  }
  if (l.type && !search.types.includes(l.type)) return fail(`type ${l.type}`);
  const furnishing = l.furnishing ?? 'unknown';
  if (!search.furnishing.includes(furnishing)) return fail(`furnishing ${furnishing}`);

  const latest = search.availableBy ?? profile.moveInLatest;
  if (latest && l.availableFrom && l.availableFrom > latest)
    return fail(`available ${l.availableFrom} after ${latest}`);

  const text = squash(`${l.title} ${l.description ?? ''}`);
  for (const d of search.dealBreakers) {
    const needle = squash(d);
    if (needle && text.includes(needle)) return fail(`deal-breaker ${d}`);
  }
  return { passed: true };
}

const PARTNER_RELATIONS = new Set([
  'partner',
  'spouse',
  'husband',
  'wife',
  'echtgenoot',
  'echtgenote',
  'vriend',
  'vriendin',
  'child',
  'kind',
]);

/** Gross monthly household income: the profile's plus every co-applicant's. Undefined when none is known. */
export function householdIncome(profile: Profile): number | undefined {
  const incomes = [
    profile.incomeMonthlyGrossEur,
    ...profile.coApplicants.map((c) => c.incomeMonthlyGrossEur),
  ].filter((x): x is number => x !== undefined);
  return incomes.length ? incomes.reduce((a, b) => a + b, 0) : undefined;
}

/**
 * Checks the landlord's requirements (from the AI or rules extract) against
 * the profile. Only definite conflicts fail: an unknown income, birthday or
 * stay length is not held against the person.
 */
export function evaluateRequirements(
  req: Requirements,
  profile: Profile,
  search: SearchConfig,
  ctx: { rentEur?: number; now?: Date } = {},
): FilterResult {
  if (search.requireRegistration && req.registrationAllowed === false)
    return fail('registration not allowed');
  // A student with a job applies as a working tenant, so only a student without one is turned away.
  if (req.studentsAllowed === false && profile.occupation === 'student' && !profile.job) return fail('no students');

  const byMultiple =
    req.incomeMultiple !== undefined && ctx.rentEur !== undefined
      ? req.incomeMultiple * ctx.rentEur
      : undefined;
  const required = Math.max(byMultiple ?? 0, req.minIncomeEur ?? 0);
  if (required > 0) {
    const own = householdIncome(profile);
    const guarantor = req.guarantorAccepted === false ? undefined : profile.guarantor?.incomeMonthlyGrossEur;
    const enough =
      (own !== undefined && own >= required) || (guarantor !== undefined && guarantor >= required);
    if (!enough && own !== undefined) {
      const why =
        byMultiple !== undefined && byMultiple >= (req.minIncomeEur ?? 0)
          ? ` (${req.incomeMultiple}x rent)`
          : '';
      return fail(`income ${own} < ${Math.round(required)}${why}`);
    }
  }

  if (req.petsAllowed === false && profile.household.pets) return fail('no pets');
  if (req.smokingAllowed === false && profile.smoker) return fail('no smokers');
  if (req.sharingAllowed === false) {
    const sharers = profile.coApplicants.filter((c) => !PARTNER_RELATIONS.has(c.relation.toLowerCase()));
    if (sharers.length > 0 || profile.household.adults > 2) return fail('no house sharing');
  }

  if (profile.birthYear !== undefined && (req.ageMin !== undefined || req.ageMax !== undefined)) {
    const year = (ctx.now ?? new Date()).getUTCFullYear();
    const oldest = year - profile.birthYear; // birthday already passed this year
    const youngest = oldest - 1; // birthday still to come
    if (req.ageMax !== undefined && youngest > req.ageMax) return fail(`age above ${req.ageMax}`);
    if (req.ageMin !== undefined && oldest < req.ageMin) return fail(`age below ${req.ageMin}`);
  }

  if (profile.stayMonths !== undefined) {
    if (req.minMonths !== undefined && profile.stayMonths < req.minMonths)
      return fail(`minimum stay ${req.minMonths} months`);
    if (req.maxMonths !== undefined && profile.stayMonths > req.maxMonths)
      return fail(`maximum stay ${req.maxMonths} months`);
  }
  return { passed: true };
}
