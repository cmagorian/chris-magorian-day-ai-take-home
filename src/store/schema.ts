/**
 * SQL schema for the SQLite adapter. Kept as a single idempotent script so `migrate()`
 * can run it on every boot. The same DDL ports almost verbatim to Postgres/Aurora.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS families (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS members (
  id        TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id),
  name      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_members_family ON members(family_id);

CREATE TABLE IF NOT EXISTS relationships (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id TEXT NOT NULL REFERENCES families(id),
  from_id   TEXT NOT NULL,
  to_id     TEXT NOT NULL,
  type      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_relationships_family ON relationships(family_id);

-- Append-only event log. The UNIQUE constraint is the idempotency guarantee for draws.
CREATE TABLE IF NOT EXISTS exchange_events (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id TEXT NOT NULL REFERENCES families(id),
  year      INTEGER NOT NULL,
  seed      INTEGER NOT NULL,
  drawn_at  TEXT NOT NULL,
  UNIQUE (family_id, year)
);

-- Assignments accumulate one row per giver, supporting both bulk and incremental draws.
-- UNIQUE (exchange_id, giver_id) guarantees a person can draw at most once per exchange.
CREATE TABLE IF NOT EXISTS assignments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  exchange_id INTEGER NOT NULL REFERENCES exchange_events(id),
  giver_id    TEXT NOT NULL,
  receiver_id TEXT NOT NULL,
  UNIQUE (exchange_id, giver_id)
);
CREATE INDEX IF NOT EXISTS idx_assignments_exchange ON assignments(exchange_id);
`;
