import { expect } from 'vitest';
import { buildImmediateFamily } from '../src/domain/family';
import { buildRecentPairs } from '../src/domain/constraints/recentRepeat';
import type { AssignmentContext } from '../src/domain/constraints/ConstraintRule';
import type { Assignment, ExchangeEvent, Family, Person, Relationship } from '../src/domain/types';

/** Build a `Family` directly (members get ids equal to their name for readable tests). */
export function makeFamily(
  memberIds: string[],
  relationships: Relationship[] = [],
  id = 'fam-1',
  name = 'Test Family',
): Family {
  const members: Person[] = memberIds.map((m) => ({ id: m, name: m }));
  return { id, name, members, relationships };
}

export function makeContext(
  family: Family,
  history: ExchangeEvent[] = [],
  year = 2026,
  repeatWindow = 3,
): AssignmentContext {
  return {
    family,
    history,
    year,
    immediateFamily: buildImmediateFamily(family),
    recentPairs: buildRecentPairs(history, year, repeatWindow),
  };
}

export interface ExtendedFamilyFixture {
  family: Family;
  /** Pairs that ARE immediate family (spouse/parent/child) — must never be paired. */
  immediatePairs: [string, string][];
  /** Pairs that are extended family (grandparent, aunt/uncle, cousin, sibling, in-law) —
   *  the immediate-family rule must ALLOW these. */
  extendedPairs: [string, string][];
}

/**
 * A three-generation extended family used to exercise wide relationships:
 *
 *   Grandpa = Grandma                 (generation 1)
 *      |          |
 *   Alice=Andy   Bob=Beth             (generation 2: their children + spouses)
 *      |            |
 *    Carol         Dan                (generation 3: grandchildren / cousins)
 *
 * Only direct spouse/parent/child links are stored — grandparent, aunt/uncle, cousin and
 * in-law relationships are emergent and (correctly) NOT treated as immediate family.
 */
export function makeExtendedFamily(): ExtendedFamilyFixture {
  const ids = ['grandpa', 'grandma', 'alice', 'andy', 'bob', 'beth', 'carol', 'dan'];
  const relationships: Relationship[] = [
    { from: 'grandpa', to: 'grandma', type: 'spouse' },
    { from: 'grandpa', to: 'alice', type: 'child' },
    { from: 'grandma', to: 'alice', type: 'child' },
    { from: 'grandpa', to: 'bob', type: 'child' },
    { from: 'grandma', to: 'bob', type: 'child' },
    { from: 'alice', to: 'andy', type: 'spouse' },
    { from: 'bob', to: 'beth', type: 'spouse' },
    { from: 'alice', to: 'carol', type: 'child' },
    { from: 'andy', to: 'carol', type: 'child' },
    { from: 'bob', to: 'dan', type: 'child' },
    { from: 'beth', to: 'dan', type: 'child' },
  ];

  const immediatePairs: [string, string][] = [
    ['grandpa', 'grandma'],
    ['grandpa', 'alice'],
    ['grandma', 'alice'],
    ['grandpa', 'bob'],
    ['grandma', 'bob'],
    ['alice', 'andy'],
    ['bob', 'beth'],
    ['alice', 'carol'],
    ['andy', 'carol'],
    ['bob', 'dan'],
    ['beth', 'dan'],
  ];

  const extendedPairs: [string, string][] = [
    ['grandpa', 'carol'], // grandparent ↔ grandchild
    ['grandma', 'dan'],
    ['alice', 'dan'], // aunt ↔ nephew
    ['bob', 'carol'], // uncle ↔ niece
    ['carol', 'dan'], // cousins
    ['alice', 'bob'], // siblings
    ['andy', 'beth'], // spouses of siblings (in-laws)
    ['grandpa', 'andy'], // child's spouse (parent-in-law)
  ];

  return {
    family: makeFamily(ids, relationships, 'fam-extended', 'Extended Family'),
    immediatePairs,
    extendedPairs,
  };
}

/** Assert that a set of assignments is a valid derangement over `ids`. */
export function expectValidAssignment(assignments: Assignment[], ids: string[]): void {
  const sorted = [...ids].sort();
  expect(assignments.map((a) => a.giverId).sort()).toEqual(sorted); // each gives once
  expect(assignments.map((a) => a.receiverId).sort()).toEqual(sorted); // each receives once
  for (const a of assignments) {
    expect(a.giverId).not.toEqual(a.receiverId); // nobody is their own Santa
  }
}
