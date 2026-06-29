import type { ExchangeEvent } from '../types';
import type { ConstraintRule } from './ConstraintRule';

/** Stable key for a directed giver→receiver pairing. NUL-delimited so no id value can collide. */
function pairKey(giverId: string, receiverId: string): string {
  return `${giverId}\0${receiverId}`;
}

/**
 * Precompute the set of giver→receiver pairings used within the recent-repeat window — the
 * exchanges in years `[year - (window - 1), year - 1]`. Looking back by year (not by record
 * count) means skipped years are handled correctly.
 *
 * Building this once is `O(window · n)`; it turns the no-recent-repeat check into an O(1)
 * set lookup instead of re-scanning history for every candidate edge.
 *
 * @param history The family's exchange log.
 * @param year The year being drawn.
 * @param window How many consecutive years a pairing must stay unique for (e.g. 3).
 * @returns The set of recently-used pairings, keyed by `pairKey`.
 */
export function buildRecentPairs(
  history: readonly ExchangeEvent[],
  year: number,
  window: number,
): ReadonlySet<string> {
  const pairs = new Set<string>();
  const oldestBlockedYear = year - (window - 1);
  for (const exchange of history) {
    if (exchange.year < oldestBlockedYear || exchange.year >= year) continue;
    for (const a of exchange.assignments) pairs.add(pairKey(a.giverId, a.receiverId));
  }
  return pairs;
}

/**
 * Part Two: a giver→receiver pairing may repeat at most once every few years (default 3).
 *
 * "Your Secret Santa" is the person gifting *to* you, so the constraint is on the directed
 * `(giver, receiver)` pair — `Alice → Bob` recurring is blocked, but `Bob → Alice` is a
 * different edge. The window logic lives in `buildRecentPairs`, which the assignment context
 * precomputes once per draw, so this rule is a constant-time membership test.
 */
export const recentRepeatRule: ConstraintRule = {
  name: 'no-recent-repeat',
  isAllowed(giverId, receiverId, ctx) {
    return !ctx.recentPairs.has(pairKey(giverId, receiverId));
  },
};
