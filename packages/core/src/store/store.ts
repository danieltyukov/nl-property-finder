import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import type { AiUsage } from '../contracts.js';
import { newId } from '../ids.js';
import type {
  Application,
  ApplicationStatus,
  Conversation,
  EventType,
  Listing,
  Match,
  Message,
  NlpfEvent,
  Property,
  RawListing,
  SourceState,
  Task,
  TaskKind,
  Viewing,
} from '../types.js';
import { MIGRATIONS } from './migrations.js';

export interface ListingFilter { propertyId?: string; sourceId?: string; since?: string; state?: 'active' | 'gone'; limit?: number }
export interface PropertyFilter { status?: ApplicationStatus | 'unmatched' | 'matched'; q?: string; limit?: number; before?: string }
export interface TaskFilter { state?: Task['state'] | 'active'; kind?: TaskKind; limit?: number }
export type JobKind = 'poll' | 'detail' | 'evaluate' | 'contact' | 'triage' | 'reply' | 'notify' | 'sync_inbox' | 'followup' | 'daily';
export interface Job {
  id: number;
  kind: JobKind;
  key: string;
  state: 'pending' | 'running' | 'done' | 'failed' | 'interrupted';
  attempts: number;
  runAt: string;
  startedAt?: string;
  lastError?: string;
  payload: Record<string, unknown>;
}

export interface Store {
  /** The underlying connection, for read-only aggregate queries (stats). */
  readonly raw: Database.Database;
  close(): void;
  tx<T>(fn: () => T): T;

  listings: {
    upsert(raw: RawListing, via: Listing['via'], now: string): { listing: Listing; isNew: boolean; changed: boolean };
    get(id: string): Listing | undefined;
    list(f?: ListingFilter): Listing[];
    setProperty(id: string, propertyId: string): void;
    markGone(sourceId: string, seenIds: string[], now: string): string[];
    setState(id: string, state: Listing['state'], now: string): void;
  };
  properties: {
    create(p: Omit<Property, 'createdAt' | 'updatedAt'>, now: string): Property;
    get(id: string): Property | undefined;
    byKey(key: string): Property | undefined;
    candidates(near: { postcode?: string; city?: string; priceEur?: number; sizeM2?: number }): Property[];
    update(id: string, patch: Partial<Property>, now: string): Property;
    list(f?: PropertyFilter): Property[];
  };
  matches: { put(m: Match): void; get(propertyId: string): Match | undefined };
  applications: {
    ensure(propertyId: string, now: string): Application;
    get(id: string): Application | undefined;
    byProperty(propertyId: string): Application | undefined;
    update(id: string, patch: Partial<Application>, now: string): Application;
    countContactedSince(since: string): number;
    list(f?: { status?: ApplicationStatus; limit?: number }): Application[];
  };
  conversations: {
    create(c: Omit<Conversation, 'id'>): Conversation;
    get(id: string): Conversation | undefined;
    byThread(sourceId: string, threadId: string): Conversation | undefined;
    byEmail(address: string): Conversation[];
    byApplication(applicationId: string): Conversation[];
    update(id: string, patch: Partial<Conversation>): Conversation;
    list(f?: { unreadOnly?: boolean; limit?: number }): Conversation[];
  };
  messages: {
    add(m: Omit<Message, 'id'>): Message;
    hasExternal(externalId: string): boolean;
    byExternal(externalId: string): Message | undefined;
    update(id: string, patch: Partial<Message>): Message;
    list(conversationId: string): Message[];
    get(id: string): Message | undefined;
    countOutboundSince(conversationId: string, since: string, author?: Message['author']): number;
  };
  tasks: {
    open(t: Omit<Task, 'id' | 'state' | 'createdAt' | 'updatedAt'>, now: string, dedupeKey?: string): { task: Task; created: boolean };
    get(id: string): Task | undefined;
    update(id: string, patch: Partial<Task>, now: string): Task;
    list(f?: TaskFilter): Task[];
    wakeSnoozed(now: string): Task[];
  };
  viewings: {
    add(v: Omit<Viewing, 'id'>): Viewing;
    get(id: string): Viewing | undefined;
    update(id: string, patch: Partial<Viewing>): Viewing;
    list(f?: { from?: string; state?: Viewing['state'] }): Viewing[];
    overlapping(start: string, end: string): Viewing[];
  };
  sources: { get(id: string): SourceState | undefined; put(s: SourceState): void; list(): SourceState[] };
  events: {
    append(type: EventType, summary: string, data: Record<string, unknown>, at: string): NlpfEvent;
    since(id: number, limit?: number): NlpfEvent[];
    latest(limit: number, types?: EventType[]): NlpfEvent[];
  };
  jobs: {
    enqueue(kind: JobKind, key: string, payload: Record<string, unknown>, runAt: string): Job | null;
    claim(now: string, limit: number, kinds?: JobKind[]): Job[];
    complete(id: number, now: string): void;
    fail(id: number, error: string, now: string, retryAt?: string): void;
    recover(now: string): Job[];
    get(key: string): Job | undefined;
    nextRunAt(kinds?: JobKind[]): string | undefined;
  };
  usage: { add(month: string, u: AiUsage): void; get(month: string): AiUsage };
  geocode: { get(q: string): unknown | undefined; put(q: string, data: unknown, at: string): void };
  kv: { get(key: string): string | undefined; set(key: string, value: string): void };
}

type Row = Record<string, unknown> & { data?: string };
const parse = <T>(row: Row | undefined): T | undefined => (row?.data ? (JSON.parse(row.data) as T) : undefined);
const parseAll = <T>(rows: Row[]): T[] => rows.map((r) => JSON.parse(r.data as string) as T);

/** Fields whose change counts as a real update to a listing (not just "seen again"). */
function listingHash(raw: RawListing): string {
  const relevant = {
    title: raw.title,
    priceEur: raw.priceEur,
    priceBasis: raw.priceBasis,
    sizeM2: raw.sizeM2,
    rooms: raw.rooms,
    availableFrom: raw.availableFrom,
    description: raw.description,
    contact: raw.contact,
    address: raw.address,
  };
  return createHash('sha1').update(JSON.stringify(relevant)).digest('hex');
}

function migrate(db: Database.Database): void {
  db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string } | undefined;
  const current = row ? Number(row.value) : 0;
  for (const m of MIGRATIONS) {
    if (m.id <= current) continue;
    const sql = m.sql.replace(/CREATE TABLE meta \([^)]*\);/, '');
    db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(m.id));
    })();
  }
}

export function openStore(file: string): Store {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);

  const q = <T = Row>(sql: string) => db.prepare<unknown[], T>(sql);

  /* ---------- listings ---------- */
  const listings: Store['listings'] = {
    upsert(raw, via, now) {
      const id = `${raw.sourceId}:${raw.externalId}`;
      const hash = listingHash(raw);
      const existing = q('SELECT * FROM listings WHERE id = ?').get(id);
      if (!existing) {
        const listing: Listing = { ...raw, id, propertyId: null, firstSeenAt: now, lastSeenAt: now, state: 'active', via };
        q(`INSERT INTO listings (id, source_id, external_id, property_id, url, title, price_eur, size_m2, type, city, postcode, state, via, first_seen_at, last_seen_at, hash, data)
           VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`).run(
          id, raw.sourceId, raw.externalId, raw.url, raw.title, raw.priceEur ?? null, raw.sizeM2 ?? null, raw.type ?? null,
          raw.address.city ?? null, raw.address.postcode ?? null, via, now, now, hash, JSON.stringify(listing),
        );
        return { listing, isNew: true, changed: false };
      }
      const prev = JSON.parse(existing.data as string) as Listing;
      const changed = existing.hash !== hash;
      const listing: Listing = changed
        ? { ...raw, id, propertyId: prev.propertyId, firstSeenAt: prev.firstSeenAt, lastSeenAt: now, state: 'active', via: prev.via }
        : { ...prev, lastSeenAt: now, state: 'active' };
      q(`UPDATE listings SET url = ?, title = ?, price_eur = ?, size_m2 = ?, type = ?, city = ?, postcode = ?, state = 'active', last_seen_at = ?, hash = ?, data = ? WHERE id = ?`).run(
        listing.url, listing.title, listing.priceEur ?? null, listing.sizeM2 ?? null, listing.type ?? null,
        listing.address.city ?? null, listing.address.postcode ?? null, now, hash, JSON.stringify(listing), id,
      );
      return { listing, isNew: false, changed };
    },
    get: (id) => parse<Listing>(q('SELECT data FROM listings WHERE id = ?').get(id)),
    list(f = {}) {
      const where: string[] = [];
      const args: unknown[] = [];
      if (f.propertyId) { where.push('property_id = ?'); args.push(f.propertyId); }
      if (f.sourceId) { where.push('source_id = ?'); args.push(f.sourceId); }
      if (f.since) { where.push('first_seen_at >= ?'); args.push(f.since); }
      if (f.state) { where.push('state = ?'); args.push(f.state); }
      const sql = `SELECT data FROM listings ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY first_seen_at DESC LIMIT ?`;
      return parseAll<Listing>(q(sql).all(...args, f.limit ?? 500));
    },
    setProperty(id, propertyId) {
      const l = listings.get(id);
      if (!l) return;
      l.propertyId = propertyId;
      q('UPDATE listings SET property_id = ?, data = ? WHERE id = ?').run(propertyId, JSON.stringify(l), id);
    },
    markGone(sourceId, seenIds, now) {
      const seen = new Set(seenIds);
      const active = q<{ id: string }>("SELECT id FROM listings WHERE source_id = ? AND state = 'active'").all(sourceId);
      const gone = active.map((r) => r.id).filter((id) => !seen.has(id));
      for (const id of gone) listings.setState(id, 'gone', now);
      return gone;
    },
    setState(id, state, now) {
      const l = listings.get(id);
      if (!l) return;
      l.state = state;
      l.lastSeenAt = state === 'active' ? now : l.lastSeenAt;
      q('UPDATE listings SET state = ?, data = ? WHERE id = ?').run(state, JSON.stringify(l), id);
    },
  };

  /* ---------- properties ---------- */
  const writeProperty = (p: Property) =>
    q(`INSERT INTO properties (id, key, title, city, postcode, price_eur, size_m2, type, lat, lon, created_at, updated_at, data)
       VALUES (@id, @key, @title, @city, @postcode, @price, @size, @type, @lat, @lon, @createdAt, @updatedAt, @data)
       ON CONFLICT(id) DO UPDATE SET key = excluded.key, title = excluded.title, city = excluded.city, postcode = excluded.postcode,
         price_eur = excluded.price_eur, size_m2 = excluded.size_m2, type = excluded.type, lat = excluded.lat, lon = excluded.lon,
         updated_at = excluded.updated_at, data = excluded.data`).run({
      id: p.id, key: p.key, title: p.title, city: p.address.city ?? null, postcode: p.address.postcode ?? null,
      price: p.priceEur ?? null, size: p.sizeM2 ?? null, type: p.type ?? null, lat: p.address.lat ?? null, lon: p.address.lon ?? null,
      createdAt: p.createdAt, updatedAt: p.updatedAt, data: JSON.stringify(p),
    });
  const properties: Store['properties'] = {
    create(p, now) {
      const prop: Property = { ...p, createdAt: now, updatedAt: now };
      writeProperty(prop);
      return prop;
    },
    get: (id) => parse<Property>(q('SELECT data FROM properties WHERE id = ?').get(id)),
    byKey: (key) => parse<Property>(q('SELECT data FROM properties WHERE key = ?').get(key)),
    candidates(near) {
      const rows: Row[] = [];
      if (near.postcode) rows.push(...q('SELECT data FROM properties WHERE postcode = ? LIMIT 50').all(near.postcode));
      if (near.city && near.priceEur) {
        rows.push(
          ...q('SELECT data FROM properties WHERE lower(city) = lower(?) AND price_eur BETWEEN ? AND ? LIMIT 50').all(
            near.city, near.priceEur * 0.95, near.priceEur * 1.05,
          ),
        );
      }
      const seen = new Set<string>();
      return parseAll<Property>(rows).filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
    },
    update(id, patch, now) {
      const cur = properties.get(id);
      if (!cur) throw new Error(`property ${id} not found`);
      const next: Property = { ...cur, ...patch, id, updatedAt: now };
      writeProperty(next);
      return next;
    },
    list(f = {}) {
      const where: string[] = [];
      const args: unknown[] = [];
      let join = '';
      if (f.status === 'matched') {
        join = 'JOIN matches m ON m.property_id = p.id';
        where.push('m.passed = 1');
      } else if (f.status === 'unmatched') {
        join = 'LEFT JOIN matches m ON m.property_id = p.id';
        where.push('(m.passed IS NULL OR m.passed = 0)');
      } else if (f.status) {
        join = 'JOIN applications a ON a.property_id = p.id';
        where.push('a.status = ?');
        args.push(f.status);
      }
      if (f.q) { where.push('(p.title LIKE ? OR p.city LIKE ? OR p.postcode LIKE ?)'); args.push(`%${f.q}%`, `%${f.q}%`, `%${f.q}%`); }
      if (f.before) { where.push('p.created_at < ?'); args.push(f.before); }
      const sql = `SELECT p.data FROM properties p ${join} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.created_at DESC LIMIT ?`;
      return parseAll<Property>(q(sql).all(...args, f.limit ?? 100));
    },
  };

  /* ---------- matches ---------- */
  const matches: Store['matches'] = {
    put(m) {
      q(`INSERT INTO matches (property_id, passed, score, scam, evaluated_at, data) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(property_id) DO UPDATE SET passed = excluded.passed, score = excluded.score, scam = excluded.scam,
         evaluated_at = excluded.evaluated_at, data = excluded.data`).run(
        m.propertyId, m.passed ? 1 : 0, m.score, m.scam.level, m.evaluatedAt, JSON.stringify(m),
      );
    },
    get: (propertyId) => parse<Match>(q('SELECT data FROM matches WHERE property_id = ?').get(propertyId)),
  };

  /* ---------- applications ---------- */
  const writeApplication = (a: Application) =>
    q(`INSERT INTO applications (id, property_id, status, first_seen_at, contacted_at, reaction_ms, updated_at, data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET status = excluded.status, contacted_at = excluded.contacted_at,
       reaction_ms = excluded.reaction_ms, updated_at = excluded.updated_at, data = excluded.data`).run(
      a.id, a.propertyId, a.status, a.firstSeenAt, a.contactedAt ?? null, a.reactionMs ?? null, a.updatedAt, JSON.stringify(a),
    );
  const applications: Store['applications'] = {
    ensure(propertyId, now) {
      const cur = applications.byProperty(propertyId);
      if (cur) return cur;
      const a: Application = { id: newId('app'), propertyId, status: 'queued', firstSeenAt: now, updatedAt: now };
      writeApplication(a);
      return a;
    },
    get: (id) => parse<Application>(q('SELECT data FROM applications WHERE id = ?').get(id)),
    byProperty: (propertyId) => parse<Application>(q('SELECT data FROM applications WHERE property_id = ?').get(propertyId)),
    update(id, patch, now) {
      const cur = applications.get(id);
      if (!cur) throw new Error(`application ${id} not found`);
      const next: Application = { ...cur, ...patch, id, updatedAt: now };
      writeApplication(next);
      return next;
    },
    countContactedSince: (since) =>
      (q<{ n: number }>('SELECT count(*) AS n FROM applications WHERE contacted_at >= ?').get(since)?.n ?? 0),
    list(f = {}) {
      const rows = f.status
        ? q('SELECT data FROM applications WHERE status = ? ORDER BY updated_at DESC LIMIT ?').all(f.status, f.limit ?? 500)
        : q('SELECT data FROM applications ORDER BY updated_at DESC LIMIT ?').all(f.limit ?? 500);
      return parseAll<Application>(rows);
    },
  };

  /* ---------- conversations ---------- */
  const writeConversation = (c: Conversation) =>
    q(`INSERT INTO conversations (id, application_id, property_id, counterpart_email, source_id, thread_id, last_message_at, unread, data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET application_id = excluded.application_id, property_id = excluded.property_id,
       counterpart_email = excluded.counterpart_email, source_id = excluded.source_id, thread_id = excluded.thread_id,
       last_message_at = excluded.last_message_at, unread = excluded.unread, data = excluded.data`).run(
      c.id, c.applicationId, c.propertyId, c.counterpart.email?.toLowerCase() ?? null, c.counterpart.sourceId ?? null,
      c.counterpart.threadId ?? null, c.lastMessageAt, c.unread, JSON.stringify(c),
    );
  const conversations: Store['conversations'] = {
    create(c) {
      const conv: Conversation = { ...c, id: newId('c') };
      writeConversation(conv);
      return conv;
    },
    get: (id) => parse<Conversation>(q('SELECT data FROM conversations WHERE id = ?').get(id)),
    byThread: (sourceId, threadId) =>
      parse<Conversation>(q('SELECT data FROM conversations WHERE source_id = ? AND thread_id = ?').get(sourceId, threadId)),
    byEmail: (address) =>
      parseAll<Conversation>(q('SELECT data FROM conversations WHERE counterpart_email = ? ORDER BY last_message_at DESC').all(address.toLowerCase())),
    byApplication: (applicationId) =>
      parseAll<Conversation>(q('SELECT data FROM conversations WHERE application_id = ? ORDER BY last_message_at DESC').all(applicationId)),
    update(id, patch) {
      const cur = conversations.get(id);
      if (!cur) throw new Error(`conversation ${id} not found`);
      const next: Conversation = { ...cur, ...patch, id };
      writeConversation(next);
      return next;
    },
    list(f = {}) {
      const sql = `SELECT data FROM conversations ${f.unreadOnly ? 'WHERE unread > 0' : ''} ORDER BY last_message_at DESC LIMIT ?`;
      return parseAll<Conversation>(q(sql).all(f.limit ?? 200));
    },
  };

  /* ---------- messages ---------- */
  const writeMessage = (m: Message, insert: boolean) =>
    insert
      ? q(`INSERT INTO messages (id, conversation_id, direction, author, status, external_id, at, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
          m.id, m.conversationId, m.direction, m.author, m.status, m.externalId ?? null, m.at, JSON.stringify(m),
        )
      : q(`UPDATE messages SET status = ?, external_id = ?, at = ?, data = ? WHERE id = ?`).run(
          m.status, m.externalId ?? null, m.at, JSON.stringify(m), m.id,
        );
  const messages: Store['messages'] = {
    add(m) {
      const msg: Message = { ...m, id: newId('m') };
      writeMessage(msg, true);
      return msg;
    },
    hasExternal: (externalId) => !!q('SELECT 1 AS x FROM messages WHERE external_id = ?').get(externalId),
    byExternal: (externalId) => parse<Message>(q('SELECT data FROM messages WHERE external_id = ?').get(externalId)),
    update(id, patch) {
      const cur = messages.get(id);
      if (!cur) throw new Error(`message ${id} not found`);
      const next: Message = { ...cur, ...patch, id };
      writeMessage(next, false);
      return next;
    },
    list: (conversationId) => parseAll<Message>(q('SELECT data FROM messages WHERE conversation_id = ? ORDER BY at ASC').all(conversationId)),
    get: (id) => parse<Message>(q('SELECT data FROM messages WHERE id = ?').get(id)),
    countOutboundSince(conversationId, since, author) {
      const sql = `SELECT count(*) AS n FROM messages WHERE conversation_id = ? AND direction = 'out' AND at >= ? AND status IN ('sent', 'queued')${author ? ' AND author = ?' : ''}`;
      const args: unknown[] = [conversationId, since];
      if (author) args.push(author);
      return q<{ n: number }>(sql).get(...args)?.n ?? 0;
    },
  };

  /* ---------- tasks ---------- */
  const writeTask = (t: Task, dedupeKey: string | null, insert: boolean) =>
    insert
      ? q(`INSERT INTO tasks (id, kind, state, priority, property_id, dedupe_key, due_at, created_at, updated_at, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          t.id, t.kind, t.state, t.priority, t.propertyId ?? null, dedupeKey, t.dueAt ?? null, t.createdAt, t.updatedAt, JSON.stringify(t),
        )
      : q(`UPDATE tasks SET state = ?, priority = ?, due_at = ?, updated_at = ?, data = ? WHERE id = ?`).run(
          t.state, t.priority, t.dueAt ?? null, t.updatedAt, JSON.stringify(t), t.id,
        );
  const tasks: Store['tasks'] = {
    open(t, now, dedupeKey) {
      if (dedupeKey) {
        const existing = parse<Task>(q('SELECT data FROM tasks WHERE dedupe_key = ?').get(dedupeKey));
        if (existing) return { task: existing, created: false };
      }
      const task: Task = { ...t, id: newId('t'), state: 'open', createdAt: now, updatedAt: now };
      writeTask(task, dedupeKey ?? null, true);
      return { task, created: true };
    },
    get: (id) => parse<Task>(q('SELECT data FROM tasks WHERE id = ?').get(id)),
    update(id, patch, now) {
      const cur = tasks.get(id);
      if (!cur) throw new Error(`task ${id} not found`);
      const next: Task = { ...cur, ...patch, id, updatedAt: now };
      writeTask(next, null, false);
      return next;
    },
    list(f = {}) {
      const where: string[] = [];
      const args: unknown[] = [];
      if (f.state === 'active') where.push("state IN ('open', 'snoozed')");
      else if (f.state) { where.push('state = ?'); args.push(f.state); }
      if (f.kind) { where.push('kind = ?'); args.push(f.kind); }
      const sql = `SELECT data FROM tasks ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY CASE state WHEN 'open' THEN 0 WHEN 'snoozed' THEN 1 ELSE 2 END, priority ASC, coalesce(due_at, '9999') ASC, created_at DESC LIMIT ?`;
      return parseAll<Task>(q(sql).all(...args, f.limit ?? 200));
    },
    wakeSnoozed(now) {
      const due = parseAll<Task>(q("SELECT data FROM tasks WHERE state = 'snoozed'").all()).filter(
        (t) => !t.snoozedUntil || t.snoozedUntil <= now,
      );
      return due.map((t) => tasks.update(t.id, { state: 'open', snoozedUntil: undefined }, now));
    },
  };

  /* ---------- viewings ---------- */
  const writeViewing = (v: Viewing) =>
    q(`INSERT INTO viewings (id, application_id, starts_at, state, data) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET starts_at = excluded.starts_at, state = excluded.state, data = excluded.data`).run(
      v.id, v.applicationId, v.startsAt, v.state, JSON.stringify(v),
    );
  const viewings: Store['viewings'] = {
    add(v) {
      const viewing: Viewing = { ...v, id: newId('v') };
      writeViewing(viewing);
      return viewing;
    },
    get: (id) => parse<Viewing>(q('SELECT data FROM viewings WHERE id = ?').get(id)),
    update(id, patch) {
      const cur = viewings.get(id);
      if (!cur) throw new Error(`viewing ${id} not found`);
      const next: Viewing = { ...cur, ...patch, id };
      writeViewing(next);
      return next;
    },
    list(f = {}) {
      const where: string[] = [];
      const args: unknown[] = [];
      if (f.from) { where.push('starts_at >= ?'); args.push(f.from); }
      if (f.state) { where.push('state = ?'); args.push(f.state); }
      return parseAll<Viewing>(q(`SELECT data FROM viewings ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY starts_at ASC`).all(...args));
    },
    overlapping(start, end) {
      return parseAll<Viewing>(q("SELECT data FROM viewings WHERE state IN ('booked', 'proposed') AND starts_at < ?").all(end)).filter(
        (v) => v.endsAt > start,
      );
    },
  };

  /* ---------- sources ---------- */
  const sources: Store['sources'] = {
    get: (id) => parse<SourceState>(q('SELECT data FROM sources WHERE source_id = ?').get(id)),
    put: (s) =>
      void q('INSERT INTO sources (source_id, data) VALUES (?, ?) ON CONFLICT(source_id) DO UPDATE SET data = excluded.data').run(
        s.sourceId, JSON.stringify(s),
      ),
    list: () => parseAll<SourceState>(q('SELECT data FROM sources ORDER BY source_id').all()),
  };

  /* ---------- events ---------- */
  const toEvent = (r: Row): NlpfEvent => ({
    id: r.id as number,
    type: r.type as EventType,
    at: r.at as string,
    summary: r.summary as string,
    data: JSON.parse(r.data as string) as Record<string, unknown>,
  });
  const events: Store['events'] = {
    append(type, summary, data, at) {
      const info = q('INSERT INTO events (type, at, summary, data) VALUES (?, ?, ?, ?)').run(type, at, summary, JSON.stringify(data));
      return { id: Number(info.lastInsertRowid), type, at, summary, data };
    },
    since: (id, limit = 500) => q('SELECT * FROM events WHERE id > ? ORDER BY id ASC LIMIT ?').all(id, limit).map(toEvent),
    latest(limit, types) {
      const rows = types?.length
        ? q(`SELECT * FROM events WHERE type IN (${types.map(() => '?').join(',')}) ORDER BY id DESC LIMIT ?`).all(...types, limit)
        : q('SELECT * FROM events ORDER BY id DESC LIMIT ?').all(limit);
      return rows.map(toEvent);
    },
  };

  /* ---------- jobs ---------- */
  const toJob = (r: Row): Job => ({
    id: r.id as number,
    kind: r.kind as JobKind,
    key: r.key as string,
    state: r.state as Job['state'],
    attempts: r.attempts as number,
    runAt: r.run_at as string,
    startedAt: (r.started_at as string | null) ?? undefined,
    lastError: (r.last_error as string | null) ?? undefined,
    payload: JSON.parse(r.payload as string) as Record<string, unknown>,
  });
  const jobs: Store['jobs'] = {
    enqueue(kind, key, payload, runAt) {
      const existing = q('SELECT * FROM jobs WHERE key = ?').get(key);
      const now = new Date().toISOString();
      if (existing) {
        if (existing.state !== 'failed') return null;
        q("UPDATE jobs SET state = 'pending', run_at = ?, payload = ?, last_error = NULL, updated_at = ? WHERE id = ?").run(
          runAt, JSON.stringify(payload), now, existing.id,
        );
        return toJob(q('SELECT * FROM jobs WHERE id = ?').get(existing.id)!);
      }
      const info = q(`INSERT INTO jobs (kind, key, state, attempts, run_at, payload, created_at, updated_at) VALUES (?, ?, 'pending', 0, ?, ?, ?, ?)`).run(
        kind, key, runAt, JSON.stringify(payload), now, now,
      );
      return toJob(q('SELECT * FROM jobs WHERE id = ?').get(info.lastInsertRowid)!);
    },
    claim(now, limit, kinds) {
      return db.transaction(() => {
        const rows = kinds?.length
          ? q(`SELECT * FROM jobs WHERE state = 'pending' AND run_at <= ? AND kind IN (${kinds.map(() => '?').join(',')}) ORDER BY run_at ASC LIMIT ?`).all(now, ...kinds, limit)
          : q("SELECT * FROM jobs WHERE state = 'pending' AND run_at <= ? ORDER BY run_at ASC LIMIT ?").all(now, limit);
        const upd = q("UPDATE jobs SET state = 'running', started_at = ?, attempts = attempts + 1, updated_at = ? WHERE id = ?");
        for (const r of rows) upd.run(now, now, r.id);
        return rows.map((r) => ({ ...toJob(r), state: 'running' as const, startedAt: now, attempts: (r.attempts as number) + 1 }));
      })();
    },
    complete(id, now) {
      q("UPDATE jobs SET state = 'done', updated_at = ? WHERE id = ?").run(now, id);
    },
    fail(id, error, now, retryAt) {
      if (retryAt) q("UPDATE jobs SET state = 'pending', run_at = ?, last_error = ?, updated_at = ? WHERE id = ?").run(retryAt, error, now, id);
      else q("UPDATE jobs SET state = 'failed', last_error = ?, updated_at = ? WHERE id = ?").run(error, now, id);
    },
    recover(now) {
      return db.transaction(() => {
        const running = q("SELECT * FROM jobs WHERE state = 'running'").all().map(toJob);
        const interrupted: Job[] = [];
        for (const j of running) {
          // A contact job may have submitted a form before the crash. Retrying
          // it could message a landlord twice, so it is parked and a person checks.
          if (j.kind === 'contact') {
            q("UPDATE jobs SET state = 'interrupted', updated_at = ? WHERE id = ?").run(now, j.id);
            interrupted.push({ ...j, state: 'interrupted' });
          } else {
            q("UPDATE jobs SET state = 'pending', run_at = ?, updated_at = ? WHERE id = ?").run(now, now, j.id);
          }
        }
        return interrupted;
      })();
    },
    get: (key) => {
      const r = q('SELECT * FROM jobs WHERE key = ?').get(key);
      return r ? toJob(r) : undefined;
    },
    nextRunAt(kinds) {
      const r = kinds?.length
        ? q<{ t: string | null }>(`SELECT min(run_at) AS t FROM jobs WHERE state = 'pending' AND kind IN (${kinds.map(() => '?').join(',')})`).get(...kinds)
        : q<{ t: string | null }>("SELECT min(run_at) AS t FROM jobs WHERE state = 'pending'").get();
      return r?.t ?? undefined;
    },
  };

  /* ---------- usage, geocode, kv ---------- */
  const usage: Store['usage'] = {
    add(month, u) {
      q(`INSERT INTO usage (month, input_tokens, output_tokens, cache_read_tokens, calls) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(month) DO UPDATE SET input_tokens = input_tokens + excluded.input_tokens, output_tokens = output_tokens + excluded.output_tokens,
         cache_read_tokens = cache_read_tokens + excluded.cache_read_tokens, calls = calls + excluded.calls`).run(
        month, u.inputTokens, u.outputTokens, u.cacheReadTokens, u.calls,
      );
    },
    get(month) {
      const r = q<{ i: number; o: number; c: number; n: number }>(
        'SELECT input_tokens AS i, output_tokens AS o, cache_read_tokens AS c, calls AS n FROM usage WHERE month = ?',
      ).get(month);
      return { inputTokens: r?.i ?? 0, outputTokens: r?.o ?? 0, cacheReadTokens: r?.c ?? 0, calls: r?.n ?? 0 };
    },
  };
  const geocode: Store['geocode'] = {
    get: (query) => parse<unknown>(q('SELECT data FROM geocode_cache WHERE query = ?').get(query)),
    put: (query, data, at) =>
      void q('INSERT INTO geocode_cache (query, data, at) VALUES (?, ?, ?) ON CONFLICT(query) DO UPDATE SET data = excluded.data, at = excluded.at').run(
        query, JSON.stringify(data), at,
      ),
  };
  const kv: Store['kv'] = {
    get: (key) => q<{ value: string }>('SELECT value FROM kv WHERE key = ?').get(key)?.value,
    set: (key, value) => void q('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value),
  };

  return {
    raw: db,
    close: () => db.close(),
    tx: <T>(fn: () => T) => db.transaction(fn)(),
    listings,
    properties,
    matches,
    applications,
    conversations,
    messages,
    tasks,
    viewings,
    sources,
    events,
    jobs,
    usage,
    geocode,
    kv,
  };
}
