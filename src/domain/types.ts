/**
 * Core domain types shared across the engine, storage, and API layers.
 *
 * These are intentionally plain data shapes with no behaviour — the rules and the
 * assignment engine operate over them, which keeps the domain easy to test and to
 * serialize to/from any storage backend.
 */

/** How two family members are related. All three imply "immediate family". */
export type RelationshipType = 'spouse' | 'parent' | 'child';

export interface Person {
  id: string;
  name: string;
}

/**
 * A directed relationship as authored by the user (e.g. `from` is the parent of `to`).
 * For the "no gifting immediate family" rule we treat every relationship as symmetric:
 * a parent should not gift their child and vice-versa.
 */
export interface Relationship {
  from: string; // person id
  to: string; // person id
  type: RelationshipType;
}

export interface Family {
  id: string;
  name: string;
  members: Person[];
  relationships: Relationship[];
}

/** A single Secret Santa pairing: `giverId` buys a gift for `receiverId`. */
export interface Assignment {
  giverId: string;
  receiverId: string;
}

/**
 * The immutable record of one year's draw. Exchanges form a per-family append-only
 * log; history is the replay of that log and is what the "no recent repeat" rule reads.
 */
export interface ExchangeEvent {
  familyId: string;
  year: number;
  assignments: Assignment[];
  seed: number; // the PRNG seed used — makes every draw reproducible
  drawnAt: string; // ISO-8601 timestamp
}
