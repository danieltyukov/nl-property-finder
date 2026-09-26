import {
  normaliseListing,
  applyPreferences,
  evaluateFilters,
  evaluateRequirements,
  feeFlags,
  lookupPropertyFacts,
  rentCheck,
  scamSignals,
  scamVerdict,
} from '@nlpf/agent';
import type { Application, Job, Listing, Match, NamedSearch, RentCheck } from '@nlpf/core';
import { euro, openTask, type Runtime } from '../runtime.js';

/** The listing with the most to go on: a description first, then a price, then the newest. */
export function bestListing(listings: Listing[]): Listing | undefined {
  const active = listings.filter((l) => l.state === 'active');
  const pool = active.length ? active : listings;
  return [...pool].sort((a, b) => {
    const score = (l: Listing) => (l.description ? 4 : 0) + (l.priceEur ? 2 : 0) + (l.sizeM2 ? 1 : 0);
    return score(b) - score(a) || b.firstSeenAt.localeCompare(a.firstSeenAt);
  })[0];
}

/** Median rent per m2 for the same municipality and type over the last 60 days, from our own data. */
export function medianPricePerM2(rt: Runtime, listing: Listing): number | undefined {
  if (!listing.address.city) return undefined;
  const since = new Date(rt.now().getTime() - 60 * 86_400_000).toISOString();
  const rows = rt.store.raw
    .prepare(
      `SELECT price_eur / size_m2 AS ppm FROM listings
       WHERE lower(city) = lower(?) AND coalesce(type, '') = coalesce(?, '') AND price_eur > 0 AND size_m2 > 5 AND first_seen_at >= ?`,
    )
    .all(listing.address.city, listing.type ?? null, since) as { ppm: number }[];
  if (rows.length < 8) return undefined;
  const sorted = rows.map((r) => r.ppm).sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** A home drafted or queued earlier that no longer matches is not pursued any more. */
function skipQueued(rt: Runtime, app: Application | undefined, nowIso: string): void {
  if (app?.status === 'queued') rt.store.applications.update(app.id, { status: 'skipped', note: 'No longer matches your searches' }, nowIso);
}

export async function handleEvaluate(rt: Runtime, job: Job): Promise<void> {
  const propertyId = String(job.payload.propertyId);
  const property = rt.store.properties.get(propertyId);
  if (!property) return;
  const app = rt.store.applications.byProperty(propertyId);
  if (app && !['queued', 'skipped'].includes(app.status)) return; // already in progress
  // Listings from a source the person switched off do not count: a home seen only there is left alone.
  const enabled = new Set(rt.adapters().map((a) => a.id));
  const listings = rt.store.listings.list({ propertyId }).filter((l) => enabled.has(l.sourceId));
  const listing = bestListing(listings);
  if (!listing) return;

  const cfg = rt.config();
  const now = rt.now();
  const nowIso = now.toISOString();
  const searches = cfg.searches.filter((s) => s.enabled);

  // 1. Hard filters, per named search. No AI is spent on a listing that fails here.
  let matched: NamedSearch | undefined;
  let failedRule = 'no enabled search';
  for (const s of searches) {
    const r = evaluateFilters(listing, s, cfg.profile);
    if (r.passed) {
      matched = s;
      break;
    }
    failedRule = r.failedRule ?? failedRule;
  }
  if (!matched) {
    const m: Match = {
      propertyId, passed: false, failedRule, score: 0, reasons: [], requirements: {},
      scam: { level: 'none', signals: [] }, by: 'rules', evaluatedAt: nowIso,
    };
    rt.store.matches.put(m);
    rt.bus.emit('property.rejected', `Skipped ${listing.title}: ${failedRule}`, { propertyId, failedRule, listingId: listing.id });
    skipQueued(rt, app, nowIso);
    return;
  }

  // 2. Most list pages carry no description, and the description is where
  // "geen studenten" or "inkomenseis 4x" lives. A listing that passed the hard
  // filters gets its detail page read now: one extra request, only for matches.
  let listingForAi = listing;
  const adapter = rt.adapter(listing.sourceId);
  const needsDetail = !listing.description || (listing.contact === 'email' && !listing.agent?.email);
  if (needsDetail && adapter?.detail && adapter.capabilities.detail) {
    try {
      const detailed = normaliseListing(await adapter.detail(listing, rt.sourceContext(adapter)));
      const saved = rt.store.listings.upsert({ ...detailed, address: { ...listing.address, ...detailed.address } }, listing.via, nowIso).listing;
      listingForAi = { ...saved, propertyId: listing.propertyId };
    } catch (e) {
      rt.log.debug('detail fetch failed', { listingId: listing.id, error: (e as Error).message });
    }
  }

  // 3. Read the listing: requirements, fit, scam wording, a summary in the user's language.
  const ai = rt.ai();
  const extracted = await ai.extract({ listing: listingForAi, profile: cfg.profile, search: matched });
  const req = evaluateRequirements(extracted.requirements, cfg.profile, matched, { rentEur: listing.priceEur, now });
  const scam = scamVerdict([...scamSignals(listingForAi, { medianPricePerM2: medianPricePerM2(rt, listing) }), ...extracted.scamSignals]);
  const flags = feeFlags(`${listingForAi.title}\n${listingForAi.description ?? ''}`, listing.priceEur);
  const pref = applyPreferences({ score: extracted.score, reasons: extracted.reasons }, listingForAi, matched);

  // 4. The legal-rent estimate, from public registers. Never blocks the pipeline.
  let rent: RentCheck | undefined;
  if (cfg.rentCheck.enabled && listing.type !== 'room' && listing.address.postcode && listing.address.houseNumber) {
    try {
      const facts = await lookupPropertyFacts(listing.address, {
        fetchJson: rt.fetchJson,
        epOnlineKey: rt.secrets()[cfg.rentCheck.epOnlineKeyEnv],
        store: rt.store,
        now,
      });
      rent = rentCheck(listing, facts, now);
    } catch (e) {
      rt.log.debug('rent check failed', { propertyId, error: (e as Error).message });
    }
  }

  const reasons = [...pref.reasons];
  if (flags.length) reasons.push(...flags.map((f) => `flag: ${f.replace(/_/g, ' ')}`));
  if (rent?.aboveMaxPct !== undefined && rent.aboveMaxPct > 5) reasons.push(`about ${Math.round(rent.aboveMaxPct)}% above the estimated legal maximum of ${euro(rent.maxRentEur)}`);

  let passed = req.passed;
  let failed = req.failedRule;
  if (passed && matched.skipAboveLegalMaxPct !== undefined && rent?.aboveMaxPct !== undefined && rent.aboveMaxPct > matched.skipAboveLegalMaxPct) {
    passed = false;
    failed = `rent ${Math.round(rent.aboveMaxPct)}% above the estimated legal maximum`;
  }
  const score = Math.max(0, Math.min(100, Math.round(pref.score)));
  if (passed && score < matched.minScore) {
    passed = false;
    failed = `score ${score} below ${matched.minScore}`;
  }

  const match: Match = {
    propertyId, passed, failedRule: failed, score, reasons, requirements: extracted.requirements, scam,
    summary: extracted.summary, searchId: matched.id, rentCheck: rent,
    by: ai.id === 'claude' ? 'ai' : 'rules', evaluatedAt: nowIso,
  };
  rt.store.matches.put(match);

  if (!passed) {
    rt.bus.emit('property.rejected', `Skipped ${listing.title}: ${failed}`, { propertyId, failedRule: failed, listingId: listing.id });
    skipQueued(rt, app, nowIso);
    return;
  }
  if (scam.level === 'likely') {
    rt.bus.emit('property.scam', `Not contacting ${listing.title}: it looks like a scam (${scam.signals.join(', ')})`, { propertyId, signals: scam.signals });
    return;
  }

  const application = rt.store.applications.ensure(propertyId, nowIso);
  rt.bus.emit('property.matched', `Match: ${listing.title}, score ${score}`, { propertyId, score, searchId: matched.id, listingId: listing.id });

  if (scam.level === 'possible') {
    openTask(rt, {
      kind: 'scam_review',
      title: `Check before contacting: ${listing.title}`,
      reason: `Some signs of a scam: ${scam.signals.join(', ')}. Approve to contact anyway.`,
      priority: 2,
      propertyId,
      applicationId: application.id,
      payload: { signals: scam.signals, url: listing.url },
    }, `scam_review:${propertyId}`);
    return;
  }

  // A very strong match with a phone number: a person calling beats any message.
  const phone = listings.map((l) => l.agent?.phone).find(Boolean);
  if (phone && score >= cfg.automation.callNowMinScore) {
    openTask(rt, {
      kind: 'call_now',
      title: `Call about ${listing.title}`,
      reason: `A strong match (score ${score}). The agent's number is ${phone}; a call now is faster than any message.`,
      priority: 2,
      propertyId,
      applicationId: application.id,
      dueAt: new Date(now.getTime() + 2 * 3_600_000).toISOString(),
      payload: { phone, url: listing.url },
    }, `call_now:${propertyId}`);
  }

  const mode = cfg.automation.mode;
  if (mode === 'approve' || (mode === 'threshold' && score < cfg.automation.scoreThreshold)) {
    openTask(rt, {
      kind: 'approve_outreach',
      title: `Contact ${listing.title}?`,
      reason: mode === 'approve' ? 'You asked to approve every first message.' : `Score ${score} is below your threshold of ${cfg.automation.scoreThreshold}.`,
      priority: 3,
      propertyId,
      applicationId: application.id,
      payload: { score, url: listing.url },
    }, `approve_outreach:${propertyId}`);
    return;
  }
  const contactKey = `contact:${propertyId}`;
  // A dry run finishes the contact job with a draft and leaves the application queued. Once
  // live, evaluating the home again runs that job again; rearm never touches a job that is
  // running or was interrupted mid-send, and the contact step sends only while still queued.
  if (!rt.store.jobs.enqueue('contact', contactKey, { propertyId }, nowIso) && !cfg.automation.dryRun) {
    rt.store.jobs.rearm(contactKey, nowIso);
  }
}
