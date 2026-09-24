/**
 * Presets for the website backends many Dutch agents share. A preset fills in
 * the list URL, selectors and contact form for its backend, so an agency file
 * often needs only `id`, `name`, `homepage` and `preset`. Anything the file
 * sets itself wins over the preset.
 */

export type AgencyPresetName = 'realworks' | 'kolibri' | 'ogonline' | 'none';

export interface AgencyPreset {
  /** Path of the rental list, joined to `homepage` when the file gives no `list.url`. */
  listPath: string;
  /** True when the selectors were checked against a live site of that backend. */
  verified: boolean;
  note: string;
  /** Partial agency definition in the same shape as the YAML. */
  defaults: Record<string, unknown>;
}

/** Status words that mean a listing is no longer available. */
export const UNAVAILABLE_STATUS = ['verhuurd', 'onder optie', 'onder bod', 'verkocht', 'gereserveerd', 'rented', 'under option'];

export const AGENCY_PRESETS: Record<Exclude<AgencyPresetName, 'none'>, AgencyPreset> = {
  realworks: {
    listPath: '/aanbod/woningaanbod/huur/',
    verified: true,
    note:
      'Realworks CMS sites. Card, detail and contact form markup checked on a live agency site on 2026-09-24 ' +
      '(docs/research/platforms.md, section 6.4). The confirmation text after sending was not observed.',
    defaults: {
      list: {
        item: '.aanbodEntry',
        fields: {
          url: { selector: 'a.aanbodEntryLink', attr: 'href' },
          street: '.street-address',
          postcode: '.postal-code',
          city: '.locality',
          price: '.kenmerk.huurprijs .kenmerkValue',
          size: '.kenmerk.woonoppervlakte .kenmerkValue',
          rooms: '.kenmerk.aantalkamers .kenmerkValue',
          type: '.kenmerk.soortobject .kenmerkValue',
          status: { selector: '.objectstatus', exclude: UNAVAILABLE_STATUS },
          image: { selector: '.hoofdfoto img', attr: 'data-src|src' },
        },
        next: { selector: '.next-page a', attr: 'href' },
      },
      detail: {
        description: '#Omschrijving',
        images: { selector: 'img[src*="media.objectmedia"]', attr: 'data-src|src' },
        status: { selector: '.objectstatus', exclude: UNAVAILABLE_STATUS },
      },
      contact: {
        kind: 'form',
        url: '{url}#Reageren',
        form: {
          open: 'a[href$="#Reageren"]',
          firstName: '#wonenReagerenForm input[name="naam-firstname"]',
          lastName: '#wonenReagerenForm input[name="naam-lastname"]',
          email: '#wonenReagerenForm input[name="contact-email"]',
          phone: '#wonenReagerenForm input[name="contact-telephone"]',
          message: '#wonenReagerenForm textarea[name="opmerkingen-notes"]',
          check: ['#wonenReagerenForm input[name="privacy-agreement"]'],
          submit: '#wonenReagerenForm input[type="submit"]',
          success: 'text=/bedankt|verzonden|ontvangen|thank you/i',
        },
      },
    },
  },

  kolibri: {
    listPath: '/aanbod/huur/',
    verified: false,
    note:
      'Kolibri websites. NOT VERIFIED: no Kolibri site was inspected (the research could not resolve one), so these ' +
      'are broad selectors to start from. Record a page with scripts/record.ts and adjust before relying on it.',
    defaults: {
      list: {
        item: '.object, .property, .woning, article.listing',
        fields: {
          url: { selector: 'a', attr: 'href' },
          title: '.address, .adres, .street, .straat, h2, h3',
          price: '.price, .prijs, .huurprijs',
          size: '.woonoppervlakte, .living-area, .oppervlakte, .size',
          rooms: '.kamers, .rooms',
          city: '.city, .plaats, .woonplaats',
          status: { selector: '.status, .label, .badge', exclude: UNAVAILABLE_STATUS },
          image: { selector: 'img', attr: 'data-src|src' },
        },
      },
      detail: {
        description: '.description, .omschrijving, .object-description',
        images: { selector: 'img', attr: 'data-src|src' },
      },
    },
  },

  ogonline: {
    listPath: '/nl/realtime-listings/consumer',
    verified: true,
    note:
      'OGonline agent sites. The JSON field names were checked on five live sites on 2026-09-23 ' +
      '(docs/research/platforms.md, section 6.3). Contact details are on the detail page and are not preset.',
    defaults: {
      list: {
        format: 'json',
        filters: [{ path: 'isRentals', require: ['true'] }],
        fields: {
          url: 'url',
          title: 'address',
          postcode: 'zipcode',
          city: 'city',
          price: 'rentalsPrice',
          size: 'livingSurface',
          rooms: 'rooms',
          bedrooms: 'bedrooms',
          type: 'mainType',
          furnishing: { path: 'isFurnished', map: { true: 'gemeubileerd', false: '' } },
          status: { path: 'status', exclude: UNAVAILABLE_STATUS },
          image: 'photo',
          publishedAt: 'added',
          lat: 'lat',
          lon: 'lng',
        },
      },
      contact: { kind: 'none' },
    },
  },
};
