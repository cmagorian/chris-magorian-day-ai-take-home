import type { Assignment, ExchangeEvent, Family, RelationshipType } from '../domain/types';

/** A new member, before the store assigns it an id. */
export interface NewMember {
  name: string;
}

/**
 * A relationship in create-input form: members don't have ids yet, so relationships
 * reference them by their index in the `members` array (unambiguous and order-stable).
 */
export interface NewRelationship {
  fromIndex: number;
  toIndex: number;
  type: RelationshipType;
}

export interface CreateFamilyInput {
  name: string;
  members: NewMember[];
  relationships?: NewRelationship[];
}

/** Stamped on an exchange when it's first created. */
export interface ExchangeMeta {
  seed: number;
  drawnAt: string;
}

/**
 * Persistence port — domain and API depend on this, never on a concrete database. SQLite
 * adapter ships here; Postgres/Aurora would be another implementation of the same contract.
 * Methods are sync because better-sqlite3 is; a networked adapter would return Promises.
 */
export interface FamilyStore {
  /** Persist a new family (with members and relationships) and return it with ids. */
  createFamily(input: CreateFamilyInput): Family;
  /** Fetch a family by id, or `null` if it doesn't exist. */
  getFamily(id: string): Family | null;
  /** Every family, used by the annual cron. */
  listFamilies(): Family[];
  /** A single year's exchange (with whatever draws exist so far), or `null` if none. */
  getExchange(familyId: string, year: number): ExchangeEvent | null;
  /**
   * Record one or more draws for a (family, year), creating the exchange on first write.
   * Supports both bulk (all pairs at once) and incremental (one pair) drawing. Throws
   * `MemberAlreadyDrewError` if any giver already has a draw for the year.
   */
  recordDraws(familyId: string, year: number, assignments: Assignment[], meta: ExchangeMeta): void;
  /** The family's exchange log, ordered by year ascending (empty if none). */
  listExchanges(familyId: string): ExchangeEvent[];
  /** Release the underlying connection/handle. */
  close(): void;
}
