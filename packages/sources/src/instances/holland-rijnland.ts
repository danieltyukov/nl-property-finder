import type { ZigPortalDef } from '../generic/zig.js';

/**
 * Huren in Holland Rijnland, social housing in Leiden and the Bulb Region.
 * Checked on 2026-09-24: 53 objects, Leiden 15, Katwijk 7, Voorschoten 6;
 * "inschrijfduur", lotteries and "maatwerk", plus parking (skipped). None of
 * its models rewards speed, so it polls every five minutes.
 */
export const hollandRijnland: ZigPortalDef = {
  id: 'holland-rijnland',
  name: 'Huren in Holland Rijnland',
  homepage: 'https://www.hureninhollandrijnland.nl',
  detailPath: '/aanbod/nu-te-huur/huurwoningen/details/',
  regions: [
    'leiden',
    'leiderdorp',
    'oegstgeest',
    'voorschoten',
    'zoeterwoude',
    'katwijk',
    'noordwijk',
    'teylingen',
    'lisse',
    'hillegom',
    'alphen aan den rijn',
    'kaag en braassem',
    'nieuwkoop',
  ],
  registration: 'Huren in Holland Rijnland account (the fee is not published on the portal)',
  intervalSec: 300,
};
