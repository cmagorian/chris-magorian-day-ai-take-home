import { assign } from './domain/assigner';
import { selfAssignmentRule } from './domain/constraints/selfAssignment';
import { recentRepeatRule } from './domain/constraints/recentRepeat';
import { immediateFamilyRule } from './domain/constraints/immediateFamily';
import type { ConstraintRule } from './domain/constraints/ConstraintRule';
import { DrawNotFoundError, FamilyNotFoundError, MemberNotFoundError } from './domain/errors';
import { mulberry32, randomSeed } from './domain/rng';
import type { Assignment, ExchangeEvent, Family } from './domain/types';
import type { FamilyStore } from './store/FamilyStore';

/** Years a giver→receiver pairing must stay unique for (Part Two). */
export const REPEAT_WINDOW = 3;

/** The active constraint rules for a normal draw (Parts One → Three). */
const DEFAULT_RULES: ConstraintRule[] = [selfAssignmentRule, recentRepeatRule, immediateFamilyRule];

export interface DrawOptions {
  /** Optional seed for a reproducible draw; a random one is used if omitted. */
  seed?: number;
  /** Defaults to the real clock; injectable for deterministic tests. */
  now?: () => Date;
}

/** Apply the defaults both draw paths share: a random seed and the real clock. */
function resolveDrawOptions(options: DrawOptions): { seed: number; now: () => Date } {
  return {
    seed: options.seed ?? randomSeed(),
    now: options.now ?? (() => new Date()),
  };
}

/**
 * Load everything both draw paths need in one pass: the family (404 if unknown), the prior
 * years' history for the recent-repeat rule, and the current year's exchange with whatever
 * has been drawn so far. A single `listExchanges` read covers all of it.
 */
function loadDrawState(store: FamilyStore, familyId: string, year: number) {
  const family = store.getFamily(familyId);
  if (!family) throw new FamilyNotFoundError(familyId);

  const all = store.listExchanges(familyId);
  const exchange = all.find((e) => e.year === year) ?? null;
  const history = all.filter((e) => e.year !== year);
  return { family, history, exchange, current: exchange?.assignments ?? [] };
}

export interface DrawForMemberResult {
  assignment: Assignment;
  /** True if this call recorded a new draw; false if the member had already drawn. */
  created: boolean;
  /** True once every family member has now drawn. */
  complete: boolean;
}

export interface DrawExchangeResult {
  event: ExchangeEvent;
  /** The pairings recorded by this call (empty if the year was already complete). */
  newAssignments: Assignment[];
}

// One person draws their own Santa. The trick: solve the *whole* remaining family once
// around what's already drawn, then keep only this member's pairing. That guarantees the
// pick never paints a later drawer into a corner, and lets people join between draws —
// without re-solving per candidate. Idempotent: drawing twice returns the same pairing.
export function drawForMember(
  store: FamilyStore,
  familyId: string,
  memberId: string,
  year: number,
  options: DrawOptions = {},
): DrawForMemberResult {
  const { family, history, current } = loadDrawState(store, familyId, year);
  if (!family.members.some((m) => m.id === memberId)) {
    throw new MemberNotFoundError(memberId, familyId);
  }

  // Idempotent: this member already drew.
  const existing = current.find((a) => a.giverId === memberId);
  if (existing) {
    return {
      assignment: existing,
      created: false,
      complete: current.length === family.members.length,
    };
  }

  const { seed, now } = resolveDrawOptions(options);

  const full = assign({
    family,
    history,
    year,
    rng: mulberry32(seed),
    rules: DEFAULT_RULES,
    repeatWindow: REPEAT_WINDOW,
    fixed: current,
  });
  const assignment = full.find((a) => a.giverId === memberId)!;

  store.recordDraws(familyId, year, [assignment], { seed, drawnAt: now().toISOString() });
  return {
    assignment,
    created: true,
    complete: current.length + 1 === family.members.length,
  };
}

// Bulk draw: fill in everyone who hasn't drawn yet (also completes a partial year). Returns
// only the newly-added pairings, so re-running a finished year is a no-op the caller can see.
export function drawExchange(
  store: FamilyStore,
  familyId: string,
  year: number,
  options: DrawOptions = {},
): DrawExchangeResult {
  const { family, history, exchange, current } = loadDrawState(store, familyId, year);

  // Already complete → idempotent no-op.
  if (current.length === family.members.length) {
    return { event: exchange!, newAssignments: [] };
  }

  const { seed, now } = resolveDrawOptions(options);

  // Complete the assignment around whatever has already been drawn.
  const full = assign({
    family,
    history,
    year,
    rng: mulberry32(seed),
    rules: DEFAULT_RULES,
    repeatWindow: REPEAT_WINDOW,
    fixed: current,
  });

  const drawn = new Set(current.map((a) => a.giverId));
  const newAssignments = full.filter((a) => !drawn.has(a.giverId));
  store.recordDraws(familyId, year, newAssignments, { seed, drawnAt: now().toISOString() });

  return { event: store.getExchange(familyId, year)!, newAssignments };
}

/** A single member's draw: who they're the Secret Santa for in a given year. */
export interface MemberDraw {
  familyId: string;
  year: number;
  giverId: string;
  receiverId: string;
}

// Family must exist and the member must belong to it — otherwise the reads below can't tell
// "unknown member" apart from "member who simply hasn't drawn".
function requireMember(store: FamilyStore, familyId: string, memberId: string): Family {
  const family = store.getFamily(familyId);
  if (!family) throw new FamilyNotFoundError(familyId);
  if (!family.members.some((m) => m.id === memberId)) {
    throw new MemberNotFoundError(memberId, familyId);
  }
  return family;
}

// What did this member draw in `year`? Returns only their own receiver, so reading it doesn't
// leak the rest of the family's pairings. Throws DrawNotFoundError if they haven't drawn yet.
export function getMemberDraw(
  store: FamilyStore,
  familyId: string,
  memberId: string,
  year: number,
): MemberDraw {
  requireMember(store, familyId, memberId);
  const assignment = store
    .getExchange(familyId, year)
    ?.assignments.find((a) => a.giverId === memberId);
  if (!assignment) throw new DrawNotFoundError(memberId, year);
  return { familyId, year, giverId: memberId, receiverId: assignment.receiverId };
}

// Every year this member has drawn, oldest first. Empty (not an error) if they've never drawn.
export function listMemberDraws(
  store: FamilyStore,
  familyId: string,
  memberId: string,
): MemberDraw[] {
  requireMember(store, familyId, memberId);
  return store.listExchanges(familyId).flatMap((exchange) => {
    const assignment = exchange.assignments.find((a) => a.giverId === memberId);
    return assignment
      ? [{ familyId, year: exchange.year, giverId: memberId, receiverId: assignment.receiverId }]
      : [];
  });
}
