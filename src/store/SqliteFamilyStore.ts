import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { MemberAlreadyDrewError, ValidationError } from '../domain/errors';
import type { Assignment, ExchangeEvent, Family, Person, Relationship } from '../domain/types';
import { SCHEMA_SQL } from './schema';
import type { CreateFamilyInput, ExchangeMeta, FamilyStore } from './FamilyStore';

interface ExchangeRow {
  id: number;
  family_id: string;
  year: number;
  seed: number;
  drawn_at: string;
}

/** better-sqlite3 tags constraint failures with a SQLITE_* code; check that, not the message. */
function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Error &&
    'code' in err &&
    (err as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE'
  );
}

/**
 * Real SQL (schema, transactions, constraints, indexed reads), so this exercises the same
 * path production would; moving to Postgres/Aurora is a new adapter, not a rewrite. Pass
 * ':memory:' for an isolated DB in tests. better-sqlite3 is synchronous, hence no Promises.
 */
export class SqliteFamilyStore implements FamilyStore {
  private readonly db: Database.Database;

  // Prepared once, reused for the life of the store — better-sqlite3 recompiles on every
  // prepare(), and the hydration loops below would otherwise re-prepare per row.
  private readonly stmt: {
    selectFamily: Database.Statement;
    selectFamilies: Database.Statement;
    selectMembers: Database.Statement;
    selectRelationships: Database.Statement;
    selectExchange: Database.Statement;
    selectExchanges: Database.Statement;
    selectAssignments: Database.Statement;
    insertExchange: Database.Statement;
    selectExchangeId: Database.Statement;
    insertAssignment: Database.Statement;
  };

  constructor(filename = 'data/secret-santa.db') {
    this.db = new Database(filename);
    this.db.pragma('journal_mode = WAL'); // better read/write concurrency
    this.db.pragma('foreign_keys = ON');
    this.db.exec(SCHEMA_SQL);

    this.stmt = {
      selectFamily: this.db.prepare('SELECT id, name FROM families WHERE id = ?'),
      selectFamilies: this.db.prepare('SELECT id, name FROM families ORDER BY name'),
      selectMembers: this.db.prepare('SELECT id, name FROM members WHERE family_id = ?'),
      selectRelationships: this.db.prepare(
        'SELECT from_id, to_id, type FROM relationships WHERE family_id = ?',
      ),
      selectExchange: this.db.prepare(
        'SELECT id, family_id, year, seed, drawn_at FROM exchange_events WHERE family_id = ? AND year = ?',
      ),
      selectExchanges: this.db.prepare(
        'SELECT id, family_id, year, seed, drawn_at FROM exchange_events WHERE family_id = ? ORDER BY year ASC',
      ),
      selectAssignments: this.db.prepare(
        'SELECT giver_id, receiver_id FROM assignments WHERE exchange_id = ?',
      ),
      insertExchange: this.db.prepare(
        `INSERT INTO exchange_events (family_id, year, seed, drawn_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (family_id, year) DO NOTHING`,
      ),
      selectExchangeId: this.db.prepare(
        'SELECT id FROM exchange_events WHERE family_id = ? AND year = ?',
      ),
      insertAssignment: this.db.prepare(
        'INSERT INTO assignments (exchange_id, giver_id, receiver_id) VALUES (?, ?, ?)',
      ),
    };
  }

  // Members get UUIDs here; input relationships point at members by array index (they have
  // no ids yet). All inserts share one transaction so a bad relationship rolls the lot back.
  createFamily(input: CreateFamilyInput): Family {
    const familyId = randomUUID();
    const members: Person[] = input.members.map((m) => ({ id: randomUUID(), name: m.name }));

    const relationships: Relationship[] = (input.relationships ?? []).map((rel) => {
      const from = members[rel.fromIndex];
      const to = members[rel.toIndex];
      if (!from || !to) {
        throw new ValidationError(`relationship index out of range (0..${members.length - 1})`);
      }
      if (rel.fromIndex === rel.toIndex) {
        throw new ValidationError('relationship links a member to itself');
      }
      return { from: from.id, to: to.id, type: rel.type };
    });

    const insert = this.db.transaction(() => {
      this.db.prepare('INSERT INTO families (id, name) VALUES (?, ?)').run(familyId, input.name);
      const memberStmt = this.db.prepare(
        'INSERT INTO members (id, family_id, name) VALUES (?, ?, ?)',
      );
      for (const m of members) memberStmt.run(m.id, familyId, m.name);

      const relStmt = this.db.prepare(
        'INSERT INTO relationships (family_id, from_id, to_id, type) VALUES (?, ?, ?, ?)',
      );
      for (const r of relationships) relStmt.run(familyId, r.from, r.to, r.type);
    });
    insert();

    return { id: familyId, name: input.name, members, relationships };
  }

  getFamily(id: string): Family | null {
    const row = this.stmt.selectFamily.get(id) as { id: string; name: string } | undefined;
    if (!row) return null;
    return this.hydrateFamily(row.id, row.name);
  }

  listFamilies(): Family[] {
    const rows = this.stmt.selectFamilies.all() as { id: string; name: string }[];
    return rows.map((r) => this.hydrateFamily(r.id, r.name));
  }

  // Returns the year's exchange with whatever draws exist so far (partial or complete).
  getExchange(familyId: string, year: number): ExchangeEvent | null {
    const event = this.stmt.selectExchange.get(familyId, year) as ExchangeRow | undefined;
    if (!event) return null;
    return this.hydrateExchange(event);
  }

  // Appends draws for a (family, year), creating the exchange row on first write. The
  // meta (seed/timestamp) only sticks on that first write — ON CONFLICT keeps it stable if
  // an incremental draw and a bulk draw race to create the same year.
  recordDraws(familyId: string, year: number, assignments: Assignment[], meta: ExchangeMeta): void {
    const tx = this.db.transaction(() => {
      this.stmt.insertExchange.run(familyId, year, meta.seed, meta.drawnAt);
      const { id: exchangeId } = this.stmt.selectExchangeId.get(familyId, year) as { id: number };

      for (const a of assignments) {
        this.stmt.insertAssignment.run(exchangeId, a.giverId, a.receiverId);
      }
    });

    try {
      tx();
    } catch (err) {
      // A duplicate (exchange_id, giver_id) means someone already drew. Match on the driver's
      // error code, not its English message. For a single-row incremental draw assignments[0]
      // is the culprit; for a bulk insert it's the closest we can name without reparsing.
      if (isUniqueViolation(err)) {
        throw new MemberAlreadyDrewError(assignments[0]?.giverId ?? 'unknown', year);
      }
      throw err;
    }
  }

  // The append-only log for a family, oldest year first.
  listExchanges(familyId: string): ExchangeEvent[] {
    const events = this.stmt.selectExchanges.all(familyId) as ExchangeRow[];
    return events.map((e) => this.hydrateExchange(e));
  }

  /** Close the underlying database handle. Called once during graceful shutdown. */
  close(): void {
    this.db.close();
  }

  /** Load an exchange row's assignments and shape it into an `ExchangeEvent`. */
  private hydrateExchange(e: ExchangeRow): ExchangeEvent {
    const assignments = (
      this.stmt.selectAssignments.all(e.id) as { giver_id: string; receiver_id: string }[]
    ).map<Assignment>((a) => ({ giverId: a.giver_id, receiverId: a.receiver_id }));
    return {
      familyId: e.family_id,
      year: e.year,
      seed: e.seed,
      drawnAt: e.drawn_at,
      assignments,
    };
  }

  private hydrateFamily(id: string, name: string): Family {
    const members = (this.stmt.selectMembers.all(id) as { id: string; name: string }[]).map<Person>(
      (m) => ({ id: m.id, name: m.name }),
    );

    const relationships = (
      this.stmt.selectRelationships.all(id) as {
        from_id: string;
        to_id: string;
        type: Relationship['type'];
      }[]
    ).map<Relationship>((r) => ({ from: r.from_id, to: r.to_id, type: r.type }));

    return { id, name, members, relationships };
  }
}
