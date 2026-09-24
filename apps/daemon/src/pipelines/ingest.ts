import { NeedsLoginError, SourceBlockedError, SourceHttpError } from '@nlpf/sources';
import { assignProperty, normaliseListing } from '@nlpf/agent';
import { SourceConfigSchema, type Job, type Listing, type RawListing, type SourceState } from '@nlpf/core';
import { createHealth } from '../health.js';
import { initialState } from '../scheduler.js';
import { RetryLater } from '../runner.js';
import { euro, type Runtime } from '../runtime.js';

/**
 * Stores one raw listing: normalise, geocode new ones, upsert, cluster into a
 * property, and queue its evaluation. Returns what changed so the poll
 * pipeline can report it. Shared by polling, alert emails and manual imports.
 */
export async function ingestRaw(rt: Runtime, raw: RawListing, via: Listing['via']): Promise<{ listing: Listing; isNew: boolean; changed: boolean }> {
  const normalised = normaliseListing(raw);
  const id = `${normalised.sourceId}:${normalised.externalId}`;
  const known = rt.store.listings.get(id);
  if (known) {
    // A list page usually carries less than the detail page read earlier.
    // Keep what we already know, or every poll would look like a change.
    normalised.description ??= known.description;
    normalised.images ??= known.images;
    normalised.agent = { ...known.agent, ...normalised.agent };
    normalised.energyLabel ??= known.energyLabel;
    normalised.availableFrom ??= known.availableFrom;
    normalised.serviceCostsEur ??= known.serviceCostsEur;
    normalised.depositEur ??= known.depositEur;
    normalised.rooms ??= known.rooms;
    normalised.bedrooms ??= known.bedrooms;
    normalised.furnishing = normalised.furnishing && normalised.furnishing !== 'unknown' ? normalised.furnishing : known.furnishing;
    normalised.extra = { ...known.extra, ...normalised.extra };
  }
  if (!known) {
    try {
      normalised.address = await rt.geocode(normalised.address);
    } catch (e) {
      rt.log.debug('geocode failed', { id, error: (e as Error).message });
    }
  } else if (!normalised.address.lat && known.address.lat) {
    // Keep what the geocoder found last time instead of asking again.
    normalised.address = { ...known.address, ...normalised.address, lat: known.address.lat, lon: known.address.lon, postcode: normalised.address.postcode ?? known.address.postcode };
  }
  const nowIso = rt.now().toISOString();
  const result = rt.store.listings.upsert(normalised, via, nowIso);
  let listing = result.listing;

  if (result.isNew || !listing.propertyId) {
    const { property } = assignProperty(rt.store, listing, nowIso);
    rt.store.listings.setProperty(listing.id, property.id);
    listing = { ...listing, propertyId: property.id };
    const source = rt.adapter(listing.sourceId)?.name ?? listing.sourceId;
    const price = listing.priceEur ? `, ${euro(listing.priceEur)}` : '';
    const size = listing.sizeM2 ? `, ${listing.sizeM2} m2` : '';
    rt.bus.emit('listing.new', `${listing.title}${listing.address.city ? `, ${listing.address.city}` : ''}${price}${size} on ${source}`, {
      listingId: listing.id,
      propertyId: property.id,
      sourceId: listing.sourceId,
      via,
      priceEur: listing.priceEur,
      city: listing.address.city,
    });
    queueEvaluate(rt, property.id);
  } else if (result.changed && listing.propertyId) {
    rt.bus.emit('listing.changed', `${listing.title} changed`, { listingId: listing.id, propertyId: listing.propertyId });
    const app = rt.store.applications.byProperty(listing.propertyId);
    if (!app || app.status === 'queued' || app.status === 'skipped') queueEvaluate(rt, listing.propertyId, true);
  }
  return { listing, isNew: result.isNew, changed: result.changed };
}

export function queueEvaluate(rt: Runtime, propertyId: string, again = false): void {
  const key = again ? `evaluate:${propertyId}:${rt.now().getTime()}` : `evaluate:${propertyId}`;
  rt.store.jobs.enqueue('evaluate', key, { propertyId }, rt.now().toISOString());
}

/** One scheduled check of one source: every search it has, then health and backoff. */
export async function handlePoll(rt: Runtime, job: Job): Promise<void> {
  const sourceId = String(job.payload.sourceId);
  const adapter = rt.adapter(sourceId);
  if (!adapter) return;
  const health = createHealth({ store: rt.store, bus: rt.bus, now: rt.now });
  const state: SourceState = rt.store.sources.get(sourceId) ?? initialState(adapter, rt.config());
  const started = Date.now();
  const cfg = rt.config();
  const ctx = rt.sourceContext(adapter);

  let count = 0;
  let fresh = 0;
  try {
    // An unconfigured source still gets a full config with defaults (searchUrls, options).
    const requests = adapter.buildSearches(cfg.searches.filter((s) => s.enabled), SourceConfigSchema.parse(cfg.sources[sourceId] ?? {}));
    for (const req of requests) {
      const raws = await adapter.search(req, ctx);
      count += raws.length;
      for (const raw of raws) {
        const r = await ingestRaw(rt, raw, 'poll');
        if (r.isNew) fresh += 1;
      }
    }
    const recovering = state.consecutiveFailures > 0 || !!state.lastError;
    health.record(state, { ok: true, count, latencyMs: Date.now() - started });
    // A check that works again ends any backoff left over from a block.
    if (recovering) rt.scheduler.pollNow(sourceId);
    if (fresh > 0) rt.bus.emit('source.polled', `${adapter.name}: ${fresh} new of ${count}`, { sourceId, count, fresh, ms: Date.now() - started });
  } catch (err) {
    const latencyMs = Date.now() - started;
    if (err instanceof NeedsLoginError) {
      health.record(state, { ok: false, count, latencyMs, needsLogin: true, error: err.message });
      return;
    }
    if (err instanceof SourceBlockedError) {
      const n = Math.min(6, state.consecutiveFailures + 1);
      const wait = err.retryAfterSec ?? 2 ** n * 60;
      health.record(state, { ok: false, count, latencyMs, blocked: { retryAfterSec: wait }, error: `Blocked (${err.status}), waiting ${Math.round(wait / 60)} min` });
      rt.scheduler.backoff(sourceId, wait);
      return;
    }
    const message = err instanceof SourceHttpError ? `HTTP ${err.status}: ${err.message}` : (err as Error).message;
    health.record(state, { ok: false, count, latencyMs, error: message });
    rt.log.warn('poll failed', { sourceId, error: message });
  }
}

/** Reads platform messaging (Kamernet, HousingAnywhere, the sandbox) for sources that have an inbox. */
export async function handleSyncInbox(rt: Runtime, job: Job, onMessage: (m: import('@nlpf/core').InboundMessage) => Promise<void>): Promise<void> {
  const sourceId = String(job.payload.sourceId);
  const adapter = rt.adapter(sourceId);
  if (!adapter?.inbox) return;
  const key = `inbox-since:${sourceId}`;
  const since = new Date(rt.store.kv.get(key) ?? new Date(rt.now().getTime() - 7 * 86_400_000).toISOString());
  try {
    const messages = await adapter.inbox(rt.sourceContext(adapter), since);
    for (const m of messages) await onMessage(m);
    rt.store.kv.set(key, rt.now().toISOString());
  } catch (err) {
    if (err instanceof NeedsLoginError) return;
    throw new RetryLater(new Date(rt.now().getTime() + 5 * 60_000), (err as Error).message);
  }
}
