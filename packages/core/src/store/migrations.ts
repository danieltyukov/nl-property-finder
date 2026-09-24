/**
 * Schema migrations, applied in order and recorded in `meta.schema_version`.
 * Kept as TypeScript strings rather than .sql files so the CLI bundle carries
 * them without any file lookups at runtime.
 */
export const MIGRATIONS: { id: number; sql: string }[] = [
  {
    id: 1,
    sql: `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE listings (
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL, external_id TEXT NOT NULL, property_id TEXT,
  url TEXT NOT NULL, title TEXT NOT NULL, price_eur REAL, size_m2 REAL, type TEXT,
  city TEXT, postcode TEXT, state TEXT NOT NULL DEFAULT 'active', via TEXT NOT NULL,
  first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, hash TEXT NOT NULL, data TEXT NOT NULL
);
CREATE INDEX listings_property ON listings(property_id);
CREATE INDEX listings_first_seen ON listings(first_seen_at);

CREATE TABLE properties (
  id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, title TEXT NOT NULL, city TEXT, postcode TEXT,
  price_eur REAL, size_m2 REAL, type TEXT, lat REAL, lon REAL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, data TEXT NOT NULL
);

CREATE TABLE matches (property_id TEXT PRIMARY KEY REFERENCES properties(id), passed INTEGER NOT NULL, score REAL NOT NULL, scam TEXT NOT NULL, evaluated_at TEXT NOT NULL, data TEXT NOT NULL);

CREATE TABLE applications (
  id TEXT PRIMARY KEY, property_id TEXT NOT NULL UNIQUE REFERENCES properties(id), status TEXT NOT NULL,
  first_seen_at TEXT NOT NULL, contacted_at TEXT, reaction_ms INTEGER, updated_at TEXT NOT NULL, data TEXT NOT NULL
);

CREATE TABLE conversations (
  id TEXT PRIMARY KEY, application_id TEXT REFERENCES applications(id), property_id TEXT,
  counterpart_email TEXT, source_id TEXT, thread_id TEXT, last_message_at TEXT NOT NULL, unread INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL
);
CREATE INDEX conversations_email ON conversations(counterpart_email);
CREATE INDEX conversations_thread ON conversations(source_id, thread_id);

CREATE TABLE messages (
  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id), direction TEXT NOT NULL,
  author TEXT NOT NULL, status TEXT NOT NULL, external_id TEXT UNIQUE, at TEXT NOT NULL, data TEXT NOT NULL
);
CREATE INDEX messages_conversation ON messages(conversation_id, at);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, state TEXT NOT NULL, priority INTEGER NOT NULL,
  property_id TEXT, dedupe_key TEXT UNIQUE, due_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, data TEXT NOT NULL
);
CREATE INDEX tasks_open ON tasks(state, priority, due_at);

CREATE TABLE viewings (id TEXT PRIMARY KEY, application_id TEXT NOT NULL, starts_at TEXT NOT NULL, state TEXT NOT NULL, data TEXT NOT NULL);

CREATE TABLE sources (source_id TEXT PRIMARY KEY, data TEXT NOT NULL);

CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, at TEXT NOT NULL, summary TEXT NOT NULL, data TEXT NOT NULL);

CREATE TABLE jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, key TEXT NOT NULL UNIQUE, state TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0, run_at TEXT NOT NULL, started_at TEXT, last_error TEXT,
  payload TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX jobs_due ON jobs(state, run_at);

CREATE TABLE usage (month TEXT PRIMARY KEY, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, cache_read_tokens INTEGER NOT NULL, calls INTEGER NOT NULL);
CREATE TABLE geocode_cache (query TEXT PRIMARY KEY, data TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`,
  },
];
