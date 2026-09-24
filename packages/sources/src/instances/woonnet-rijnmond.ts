import type { EmbracePortalDef } from '../generic/embrace.js';

/**
 * Woonnet Rijnmond, social housing in Rotterdam and the region, on the
 * Embrace Cloud portal. Tenant and portal id come from
 * https://www.woonnetrijnmond.nl/base/config.json (read on 2026-09-24).
 * That day it listed 88 publications: mostly "Inschrijfduur", some
 * "WoningLoting", external offers that take reactions on another site, and
 * "Wens&Wacht" complexes (skipped). DirectKans ads take reactions between
 * 20:00 and 20:15 and then draw lots, so speed does not matter here.
 */
export const woonnetRijnmond: EmbracePortalDef = {
  id: 'woonnet-rijnmond',
  name: 'Woonnet Rijnmond',
  homepage: 'https://www.woonnetrijnmond.nl',
  locale: 'nl-NL',
  tenantId: 'woonnetrijnmond',
  portalId: 'UG9ydGFsUHJvdmlkZXJQb3J0YWw6NDg0MDExNWQtZTk4NC00MzQwLTgxYTktZjNjODZiYjM0MDk2',
  detailPath: '/nl-NL/aanbod/advertentie/',
  regions: [
    'rotterdam',
    'schiedam',
    'vlaardingen',
    'maassluis',
    'capelle aan den ijssel',
    'krimpen aan den ijssel',
    'barendrecht',
    'ridderkerk',
    'albrandswaard',
    'nissewaard',
    'voorne aan zee',
    'lansingerland',
  ],
  places: {
    hoogvliet: 'rotterdam',
    pernis: 'rotterdam',
    rozenburg: 'rotterdam',
    'hoek van holland': 'rotterdam',
    spijkenisse: 'nissewaard',
    zuidland: 'nissewaard',
    rhoon: 'albrandswaard',
    poortugaal: 'albrandswaard',
    hellevoetsluis: 'voorne aan zee',
    brielle: 'voorne aan zee',
    oostvoorne: 'voorne aan zee',
    rockanje: 'voorne aan zee',
    bergschenhoek: 'lansingerland',
    'berkel en rodenrijs': 'lansingerland',
    bleiswijk: 'lansingerland',
  },
  registration: 'Woonnet Rijnmond account, EUR 15 to register and EUR 10 per year to renew (2024 figures)',
  authRealmUrl: 'https://auth.embracecloud.nl/auth/realms/woonnetrijnmond/',
  intervalSec: 300,
};
