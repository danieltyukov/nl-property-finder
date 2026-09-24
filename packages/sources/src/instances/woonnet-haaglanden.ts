import type { ZigPortalDef } from '../generic/zig.js';

/**
 * Woonnet Haaglanden, social housing in Den Haag, Delft, Zoetermeer and the
 * region around them. Checked on 2026-09-24: 246 objects, of which 190 home
 * swaps (skipped), 53 "inschrijfduur" and 3 lotteries; Delft 34, Den Haag 78.
 * Ads may also use "Eerste reageerder" (first come, first served), so it
 * polls every minute.
 */
export const woonnetHaaglanden: ZigPortalDef = {
  id: 'woonnet-haaglanden',
  name: 'Woonnet Haaglanden',
  homepage: 'https://www.woonnet-haaglanden.nl',
  detailPath: '/aanbod/nu-te-huur/te-huur/details/',
  regions: [
    'den haag',
    'delft',
    'zoetermeer',
    'rijswijk',
    'leidschendam-voorburg',
    'pijnacker-nootdorp',
    'westland',
    'wassenaar',
    'midden-delfland',
  ],
  registration: 'Woonnet Haaglanden account, EUR 14.00 per year (iDEAL) or EUR 12.50 (direct debit)',
  maxActiveReactions: 2,
  intervalSec: 60,
};
