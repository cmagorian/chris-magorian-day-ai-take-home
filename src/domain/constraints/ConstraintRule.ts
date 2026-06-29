import type { ExchangeEvent, Family } from '../types';

/**
 * Read-only context handed to every constraint rule when deciding whether a single
 * `giver -> receiver` edge is permitted.
 */
export interface AssignmentContext {
  family: Family;
  /** The family's full exchange history (the append-only log). */
  history: readonly ExchangeEvent[];
  /** The year currently being drawn. */
  year: number;
  /** Per-person immediate-family lookup (see `buildImmediateFamily`). */
  immediateFamily: Map<string, Set<string>>;
  /**
   * Giver→receiver pairings used within the recent-repeat window, precomputed once per draw
   * (see `buildRecentPairs`). Lets the no-recent-repeat rule be an O(1) membership test.
   */
  recentPairs: ReadonlySet<string>;
}

/**
 * A single, independently-testable constraint. The engine treats the assignment problem
 * as a graph of allowed edges; each rule simply forbids some edges. New requirements are
 * added as new rules without touching the search engine.
 */
export interface ConstraintRule {
  /** stable id, handy in logs */
  readonly name: string;
  /** true if this rule permits giver → receiver, false to forbid the edge */
  isAllowed(giverId: string, receiverId: string, ctx: AssignmentContext): boolean;
}
