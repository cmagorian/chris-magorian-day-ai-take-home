import type { Family } from './types';

// Each member → the set of people they must not gift. Relationships are stored directed
// (parent→child) but immediate family is mutual, so we add both directions. Collapsing
// spouse/parent/child into one set is all the immediate-family rule needs.
export function buildImmediateFamily(family: Family): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const member of family.members) {
    map.set(member.id, new Set());
  }

  const link = (a: string, b: string) => {
    const set = map.get(a);
    if (set) set.add(b);
  };

  for (const rel of family.relationships) {
    link(rel.from, rel.to);
    link(rel.to, rel.from);
  }

  return map;
}
