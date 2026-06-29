import { buildRecentPairs } from './constraints/recentRepeat';
import { NoValidAssignmentError } from './errors';
import { buildImmediateFamily } from './family';
import { shuffle, type Rng } from './rng';
import type { AssignmentContext, ConstraintRule } from './constraints/ConstraintRule';
import type { Assignment, ExchangeEvent, Family } from './types';

export interface AssignParams {
  family: Family;
  /** Prior exchanges, used by history-aware rules (e.g. no-recent-repeat). */
  history?: readonly ExchangeEvent[];
  year: number;
  /** Active constraints. Order doesn't matter; an edge must satisfy all of them. */
  rules: ConstraintRule[];
  rng: Rng;
  repeatWindow?: number;
  /**
   * Already-committed pairings to build around (for incremental drawing). These givers and
   * receivers are treated as locked; the engine only assigns the remaining members and
   * returns the locked pairs plus the new ones. Assumed already valid — they aren't
   * re-checked against the rules.
   */
  fixed?: readonly Assignment[];
}

/**
 * Choose a Secret Santa for everyone — a perfect matching on the bipartite graph of givers
 * and receivers, where an edge exists only if every rule allows it.
 *
 * We shuffle each giver's allowed receivers (seeded RNG → random but reproducible), order
 * givers most-constrained-first to prune hard, and backtrack. Backtracking rather than
 * shuffle-and-retry because it's *complete*: it finds an assignment if one exists and proves
 * none does otherwise, instead of spinning forever on a tightly-constrained family.
 *
 * Returns one pairing per member in member order; throws NoValidAssignmentError if there are
 * fewer than two members or the constraints admit no assignment.
 */
export function assign(params: AssignParams): Assignment[] {
  const { family, year, rules, rng } = params;
  const history = params.history ?? [];
  const repeatWindow = params.repeatWindow ?? 3;
  const fixed = params.fixed ?? [];

  const memberIds = family.members.map((m) => m.id);
  // can't derange fewer than two people
  if (memberIds.length < 2) {
    throw new NoValidAssignmentError('need at least two people to draw');
  }

  const ctx: AssignmentContext = {
    family,
    history,
    year,
    immediateFamily: buildImmediateFamily(family),
    recentPairs: buildRecentPairs(history, year, repeatWindow),
  };

  // Locked pairings (incremental drawing): their givers are already done and their
  // receivers are already taken; we only assign the rest and check the rules for them.
  const lockedGivers = new Set(fixed.map((a) => a.giverId));
  const remaining = memberIds.filter((id) => !lockedGivers.has(id));

  // Allowed receivers per remaining giver, shuffled for randomness.
  const candidates = new Map<string, string[]>();
  for (const giver of remaining) {
    const allowed = memberIds.filter((receiver) =>
      rules.every((rule) => rule.isAllowed(giver, receiver, ctx)),
    );
    candidates.set(giver, shuffle(allowed, rng));
  }

  // Most-constrained-variable ordering: assign givers with the fewest options first.
  const order = remaining.sort((a, b) => candidates.get(a)!.length - candidates.get(b)!.length);

  const taken = new Set(fixed.map((a) => a.receiverId));
  const result: Assignment[] = [...fixed];

  // Places givers one at a time (index = depth). candidates already encode the rules, so the
  // only thing to enforce here is "each receiver used once" via `taken`.
  const backtrack = (index: number): boolean => {
    if (index === order.length) return true; // every giver placed

    const giver = order[index]!;
    for (const receiver of candidates.get(giver)!) {
      if (taken.has(receiver)) continue;

      taken.add(receiver);
      result.push({ giverId: giver, receiverId: receiver });

      if (backtrack(index + 1)) return true;

      // dead end downstream — undo and try the next receiver
      taken.delete(receiver);
      result.pop();
    }

    return false; // no receiver works for this giver; make the caller revise its choice
  };

  if (!backtrack(0)) {
    throw new NoValidAssignmentError();
  }

  // Return assignments in the family's member order for stable, readable output.
  const byGiver = new Map(result.map((a) => [a.giverId, a]));
  return memberIds.map((id) => byGiver.get(id)!);
}
