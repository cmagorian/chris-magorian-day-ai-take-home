import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  drawExchange,
  drawForMember,
  getMemberDraw,
  listMemberDraws,
} from '../../src/exchangeService';
import {
  DrawNotFoundError,
  FamilyNotFoundError,
  MemberNotFoundError,
  NoValidAssignmentError,
} from '../../src/domain/errors';
import type { RelationshipType } from '../../src/domain/types';
import { SqliteFamilyStore } from '../../src/store/SqliteFamilyStore';
import { expectValidAssignment, makeExtendedFamily } from '../helpers';

type Rel = { fromIndex: number; toIndex: number; type: RelationshipType };

describe('drawForMember — incremental per-person drawing', () => {
  let store: SqliteFamilyStore;

  beforeEach(() => {
    store = new SqliteFamilyStore(':memory:');
  });
  afterEach(() => store.close());

  const newFamily = (names: string[], relationships: Rel[] = []) =>
    store.createFamily({ name: 'F', members: names.map((n) => ({ name: n })), relationships });

  it('lets each person draw individually, building one valid complete derangement', () => {
    const fam = newFamily(['A', 'B', 'C', 'D']);
    const ids = fam.members.map((m) => m.id);

    const results = ids.map((id, i) => drawForMember(store, fam.id, id, 2026, { seed: i + 1 }));

    expect(results.at(-1)!.complete).toBe(true);
    expectValidAssignment(
      results.map((r) => r.assignment),
      ids,
    );
  });

  it('handles three generations: each member draws their own Secret Santa', () => {
    // Reuse the 3-generation fixture (grandparents → 2 married children → grandchildren).
    // Its relationships are name-based, so map them to member indices for createFamily.
    const fixture = makeExtendedFamily();
    const names = fixture.family.members.map((m) => m.name);
    const relationships = fixture.family.relationships.map((r) => ({
      fromIndex: names.indexOf(r.from),
      toIndex: names.indexOf(r.to),
      type: r.type,
    }));

    const fam = newFamily(names, relationships);
    const ids = fam.members.map((m) => m.id);
    const idByName = new Map(fam.members.map((m) => [m.name, m.id]));

    // Everyone draws their own name individually (per-person), in turn.
    const draws = ids.map((id, i) => drawForMember(store, fam.id, id, 2026, { seed: i + 1 }));

    expect(draws.at(-1)!.complete).toBe(true);
    expectValidAssignment(
      draws.map((d) => d.assignment),
      ids,
    );

    // No one is Santa for a spouse, parent, or child (either direction); extended
    // relatives — grandparents, aunts/uncles, cousins — are fair game.
    const pairs = new Set(draws.map((d) => `${d.assignment.giverId}->${d.assignment.receiverId}`));
    for (const [x, y] of fixture.immediatePairs) {
      const gx = idByName.get(x)!;
      const gy = idByName.get(y)!;
      expect(pairs.has(`${gx}->${gy}`)).toBe(false);
      expect(pairs.has(`${gy}->${gx}`)).toBe(false);
    }
  });

  it('is idempotent per member (same recipient, created=false)', () => {
    const fam = newFamily(['A', 'B', 'C']);
    const a = fam.members[0].id;

    const first = drawForMember(store, fam.id, a, 2026, { seed: 1 });
    const again = drawForMember(store, fam.id, a, 2026, { seed: 999 });

    expect(first.created).toBe(true);
    expect(again.created).toBe(false);
    expect(again.assignment).toEqual(first.assignment);
  });

  it('never dead-ends and honors constraints, even drawing in reverse order', () => {
    // A & B are spouses; C, D unrelated. Plenty of slack, but A↔B is forbidden.
    const fam = newFamily(['A', 'B', 'C', 'D'], [{ fromIndex: 0, toIndex: 1, type: 'spouse' }]);
    const ids = fam.members.map((m) => m.id);

    const byGiver = new Map<string, { giverId: string; receiverId: string }>();
    [...ids].reverse().forEach((id, i) => {
      byGiver.set(id, drawForMember(store, fam.id, id, 2026, { seed: i + 1 }).assignment);
    });

    const assignments = ids.map((id) => byGiver.get(id)!);
    expectValidAssignment(assignments, ids);

    const pairs = new Set(assignments.map((a) => `${a.giverId}->${a.receiverId}`));
    const [a, b] = ids;
    expect(pairs.has(`${a}->${b}`)).toBe(false);
    expect(pairs.has(`${b}->${a}`)).toBe(false);
  });

  it('throws when the member has no completable recipient (two spouses)', () => {
    const fam = newFamily(['X', 'Y'], [{ fromIndex: 0, toIndex: 1, type: 'spouse' }]);
    expect(() => drawForMember(store, fam.id, fam.members[0].id, 2026, { seed: 1 })).toThrow(
      NoValidAssignmentError,
    );
  });

  it('surfaces 422 when earlier draws leave a member impossible to place (late-join edge)', () => {
    // The documented limitation: a member can become unplaceable if everyone else's
    // receiver slots fill first (e.g. they joined after the others paired off). The
    // feasibility guard prevents this via the API, so we reproduce the dead-ended state by
    // recording the draws directly — A and B pair off with each other...
    const fam = newFamily(['A', 'B', 'C']);
    const [a, b, c] = fam.members.map((m) => m.id);
    store.recordDraws(
      fam.id,
      2026,
      [
        { giverId: a, receiverId: b },
        { giverId: b, receiverId: a },
      ],
      { seed: 1, drawnAt: '2026-12-01T00:00:00.000Z' },
    );

    // ...leaving C unable to give (A & B already received) or be received (A & B already
    // gave). The next draw refuses rather than producing an invalid exchange.
    expect(() => drawForMember(store, fam.id, c, 2026, { seed: 1 })).toThrow(
      NoValidAssignmentError,
    );
  });

  it('rejects an unknown member', () => {
    const fam = newFamily(['A', 'B']);
    expect(() => drawForMember(store, fam.id, 'ghost', 2026)).toThrow(MemberNotFoundError);
  });
});

describe('drawExchange (bulk) interplay with incremental draws', () => {
  let store: SqliteFamilyStore;

  beforeEach(() => {
    store = new SqliteFamilyStore(':memory:');
  });
  afterEach(() => store.close());

  it('completes a partially-drawn year', () => {
    const fam = store.createFamily({
      name: 'F',
      members: ['A', 'B', 'C', 'D'].map((n) => ({ name: n })),
    });
    const ids = fam.members.map((m) => m.id);

    drawForMember(store, fam.id, ids[0], 2026, { seed: 1 });
    const { event, newAssignments } = drawExchange(store, fam.id, 2026, { seed: 2 });

    expect(event.assignments).toHaveLength(4);
    expect(newAssignments).toHaveLength(3); // the three who hadn't drawn yet
    expectValidAssignment(event.assignments, ids);
  });

  it('is a no-op once the year is complete', () => {
    const fam = store.createFamily({
      name: 'F',
      members: ['A', 'B', 'C'].map((n) => ({ name: n })),
    });
    drawExchange(store, fam.id, 2026, { seed: 1 });
    const { newAssignments } = drawExchange(store, fam.id, 2026, { seed: 2 });
    expect(newAssignments).toHaveLength(0);
  });
});

describe('reading a member’s own draw', () => {
  let store: SqliteFamilyStore;

  beforeEach(() => {
    store = new SqliteFamilyStore(':memory:');
  });
  afterEach(() => store.close());

  const newFamily = (names: string[]) =>
    store.createFamily({ name: 'F', members: names.map((n) => ({ name: n })) });

  it('getMemberDraw returns only that member’s receiver after they draw', () => {
    const fam = newFamily(['A', 'B', 'C']);
    const a = fam.members[0].id;
    const drawn = drawForMember(store, fam.id, a, 2026, { seed: 1 });

    const read = getMemberDraw(store, fam.id, a, 2026);
    expect(read).toEqual({
      familyId: fam.id,
      year: 2026,
      giverId: a,
      receiverId: drawn.assignment.receiverId,
    });
  });

  it('getMemberDraw throws DrawNotFoundError when the member has not drawn that year', () => {
    const fam = newFamily(['A', 'B', 'C']);
    drawForMember(store, fam.id, fam.members[0].id, 2026, { seed: 1 });

    // member exists and drew in 2026, but not in 2027
    expect(() => getMemberDraw(store, fam.id, fam.members[0].id, 2027)).toThrow(DrawNotFoundError);
  });

  it('getMemberDraw distinguishes unknown family and unknown member from a missing draw', () => {
    const fam = newFamily(['A', 'B']);
    expect(() => getMemberDraw(store, 'ghost', fam.members[0].id, 2026)).toThrow(
      FamilyNotFoundError,
    );
    expect(() => getMemberDraw(store, fam.id, 'nobody', 2026)).toThrow(MemberNotFoundError);
  });

  it('listMemberDraws returns one entry per year drawn, oldest first', () => {
    const fam = newFamily(['A', 'B', 'C']);
    const a = fam.members[0].id;
    const d2025 = drawForMember(store, fam.id, a, 2025, { seed: 1 });
    const d2026 = drawForMember(store, fam.id, a, 2026, { seed: 2 });

    const draws = listMemberDraws(store, fam.id, a);
    expect(draws.map((d) => d.year)).toEqual([2025, 2026]);
    expect(draws.map((d) => d.receiverId)).toEqual([
      d2025.assignment.receiverId,
      d2026.assignment.receiverId,
    ]);
    expect(draws.every((d) => d.giverId === a)).toBe(true);
  });

  it('listMemberDraws is an empty list (not an error) for a member who never drew', () => {
    const fam = newFamily(['A', 'B', 'C']);
    // B never draws, but a draw exists for the family so the year's exchange is present.
    drawForMember(store, fam.id, fam.members[0].id, 2026, { seed: 1 });

    expect(listMemberDraws(store, fam.id, fam.members[1].id)).toEqual([]);
  });

  it('listMemberDraws rejects an unknown member', () => {
    const fam = newFamily(['A', 'B']);
    expect(() => listMemberDraws(store, fam.id, 'nobody')).toThrow(MemberNotFoundError);
  });
});
