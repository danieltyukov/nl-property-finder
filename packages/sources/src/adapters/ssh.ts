/**
 * SSH (sshxl.nl): student housing in Utrecht, Zwolle and a few other
 * cities. The offer list is one JSON call for the whole country; addresses
 * and sizes come from a second call for the same units.
 *
 * Reacting happens on the SSH portal with a ROOM login (a one-time EUR 35
 * registration). Offers are "Hospiteren" (the housemates choose) or
 * "Bezichtiging" (a viewing, ranked by registration time), so reacting
 * first does not help and the portal flow was not seen live. Listings are
 * therefore marked `contact: 'lottery'`: the router opens a "react
 * manually" task with the portal link and the deadline.
 *
 * Verified live on 2026-09-24: `GET /api/v1/offer` (36 offers),
 * `GET /api/v1/offer/getOffersDetails?wocasIds=...` (addresses, floor
 * area, rent), and the portal's offer URL `/nl/aanbod/{FlowId}-{address}`
 * built the way the portal bundle builds it.
 */
import type { NamedSearch, RawListing, SearchRequest, SourceAdapter } from '@nlpf/core';
import { normalisePostcode } from '../util/address.js';
import {
  reencode,
  canonicalMunicipality,
  clean,
  compact,
  isObj,
  isoInstant,
  num,
  positive,
  searchMunicipalities,
  str,
  titleCase,
  ymd,
} from './json-shared.js';

const BASE = 'https://www.sshxl.nl';

interface Offer {
  WocasId?: string;
  FlowId?: number;
  Kind?: string;
  ContractType?: string;
  UnitType?: string;
  BruttoHuur?: number;
  NettoHuur?: number;
  PublishedOn?: string;
  ExpireBy?: string;
  ApplicantCount?: number;
  ViewingDate?: string | null;
  ContractStartDate?: string | null;
  IsPublished?: boolean;
  Image?: { FilePathNL?: string | null } | null;
}

interface Address {
  Straatnaam?: string;
  Nummer?: string;
  Letter?: string | null;
  Toevoeging?: string | null;
  Locatie?: string | null;
  Postcode?: string;
  Plaats?: string;
}

interface Details {
  EenheidNummer?: number;
  ADRES_H?: Address[];
  ASP_TOTAAL_C?: { TotOpp?: number }[];
}

/** The portal's own slug for an offer URL, including its quirk of replacing only the first space. */
export function sshOfferPath(flowId: number, a: Address): string {
  const slug =
    `${(a.Straatnaam ?? '').toLowerCase()}-${(a.Nummer ?? '').toLowerCase()}${a.Letter ? a.Letter.toLowerCase() : ''}${a.Toevoeging ? `-${a.Toevoeging.toLowerCase()}` : ''}${a.Locatie ? `-${a.Locatie.toLowerCase()}` : ''}`
      .replace('/', '-')
      .replace(' ', '-');
  return `/nl/aanbod/${flowId}-${encodeURI(slug)}`;
}

/** A self-contained unit this small is a studio; larger ones are apartments. */
const STUDIO_MAX_M2 = 30;

export function createSshAdapter(): SourceAdapter {
  const adapter: SourceAdapter = {
    id: 'ssh',
    name: 'SSH',
    homepage: BASE,
    regions: 'nl',
    defaultIntervalSec: 60,
    capabilities: { search: 'json', detail: false, contact: 'lottery', login: 'required', terms: 'unknown' },
    loginUrl: `${BASE}/nl/inloggen`,

    buildSearches(searches: NamedSearch[]): SearchRequest[] {
      // The offer API has no filters: one request lists every offer, and the
      // municipalities of all searches are applied to the result.
      const all = new Set<string>();
      let everywhere = searches.length === 0;
      for (const s of searches) {
        const ms = searchMunicipalities(s);
        if (!ms.length) everywhere = true;
        ms.forEach((m) => all.add(m));
      }
      const municipalities = everywhere ? '' : [...all].sort().join(',');
      return [
        {
          key: municipalities ? `offers?${municipalities}` : 'offers',
          label: 'SSH offers',
          url: `${BASE}/api/v1/offer`,
          params: { municipalities },
        },
      ];
    },

    async search(req, ctx) {
      const res = await ctx.fetch(req.url ?? `${BASE}/api/v1/offer`, {
        headers: { accept: 'application/json' },
      });
      const offers = res.json<unknown>();
      const now = ctx.now().getTime();
      const open = (Array.isArray(offers) ? offers : [])
        .filter(isObj)
        .map((o) => o as Offer)
        .filter(
          (o) =>
            o.WocasId &&
            o.FlowId &&
            o.IsPublished !== false &&
            (!o.ExpireBy || Date.parse(isoInstant(o.ExpireBy) ?? '') > now),
        );
      if (!open.length) return [];

      const ids = open.map((o) => o.WocasId).join(',');
      const detailRes = await ctx.fetch(`${BASE}/api/v1/offer/getOffersDetails?wocasIds=${ids}`, {
        headers: { accept: 'application/json' },
      });
      const details = new Map<string, Details>();
      for (const d of detailRes.json<unknown>() as Details[]) {
        if (isObj(d) && d.EenheidNummer) details.set(String(d.EenheidNummer), d);
      }

      const wanted = new Set(
        String(req.params?.municipalities ?? '')
          .split(',')
          .filter(Boolean)
          .map(canonicalMunicipality),
      );
      const out: RawListing[] = [];
      for (const o of open) {
        const d = details.get(String(o.WocasId));
        const a = d?.ADRES_H?.[0];
        const city = a?.Plaats ? titleCase(a.Plaats) : undefined;
        if (wanted.size && (!city || !wanted.has(canonicalMunicipality(city)))) continue;
        const flowId = o.FlowId as number;
        const url = a ? `${BASE}${sshOfferPath(flowId, a)}` : `${BASE}/nl/aanbod/${flowId}`;
        const size = positive(d?.ASP_TOTAAL_C?.[0]?.TotOpp);
        const room = /kamer/i.test(o.UnitType ?? '');
        const brutto = positive(o.BruttoHuur);
        const netto = positive(o.NettoHuur);
        const addition = clean(`${a?.Letter ?? ''}${a?.Toevoeging ? ` ${a.Toevoeging}` : ''}`);
        const image = str(o.Image?.FilePathNL ?? undefined);
        out.push(
          compact<RawListing>({
            sourceId: 'ssh',
            externalId: String(flowId),
            url,
            title: a
              ? clean(
                  `${a.Straatnaam ?? ''} ${a.Nummer ?? ''}${a.Letter ?? ''}${a.Toevoeging ? ` ${a.Toevoeging}` : ''}${a.Locatie ? ` (${a.Locatie})` : ''}`,
                )
              : `SSH ${o.UnitType ?? 'woonruimte'}`,
            priceEur: brutto,
            priceBasis: brutto === undefined ? undefined : 'incl',
            serviceCostsEur:
              brutto !== undefined && netto !== undefined && brutto > netto
                ? Math.round((brutto - netto) * 100) / 100
                : undefined,
            sizeM2: size,
            type: room ? 'room' : size !== undefined && size <= STUDIO_MAX_M2 ? 'studio' : 'apartment',
            address: compact({
              street: str(a?.Straatnaam),
              houseNumber: str(a?.Nummer),
              addition: addition || undefined,
              postcode: normalisePostcode(a?.Postcode ?? ''),
              city,
            }),
            availableFrom: ymd(o.ContractStartDate ?? undefined),
            images: image ? [reencode(image)] : undefined,
            agent: { name: 'SSH', url: BASE },
            contact: 'lottery',
            contactUrl: url,
            publishedAt: isoInstant(o.PublishedOn),
            language: 'nl',
            extra: compact({
              reactions: num(o.ApplicantCount),
              kind: str(o.Kind),
              contractType: str(o.ContractType),
              deadline: isoInstant(o.ExpireBy),
              viewingAt: isoInstant(o.ViewingDate ?? undefined),
              room: str(a?.Locatie ?? undefined),
              wocasId: str(o.WocasId),
            }),
          }),
        );
      }
      ctx.log.debug('ssh offers read', { count: out.length, offers: open.length });
      return out;
    },

    async isAvailable(listing, ctx) {
      const res = await ctx.fetch(`${BASE}/api/v1/offer`, { headers: { accept: 'application/json' } });
      const offers = res.json<unknown>();
      if (!Array.isArray(offers)) throw new Error('SSH offer list is not a list; the API may have changed');
      return offers.some(
        (o) => isObj(o) && String(o.FlowId) === listing.externalId && o.IsPublished !== false,
      );
    },
  };
  return adapter;
}

export const ssh = createSshAdapter();
