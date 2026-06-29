import { describe, expect, it } from 'vitest';
import { assign } from '../../src/domain/assigner';
import { immediateFamilyRule } from '../../src/domain/constraints/immediateFamily';
import { recentRepeatRule } from '../../src/domain/constraints/recentRepeat';
import { selfAssignmentRule } from '../../src/domain/constraints/selfAssignment';
import { NoValidAssignmentError } from '../../src/domain/errors';
import { mulberry32 } from '../../src/domain/rng';
import type { ExchangeEvent } from '../../src/domain/types';
import { expectValidAssignment, makeExtendedFamily, makeFamily } from '../helpers';

const ids = ['alice', 'bob', 'carol', 'dave', 'erin'];

describe('assign — Part One (basic derangement)', () => {
  it('produces a valid assignment where nobody draws themselves', () => {
    const result = assign({
      family: makeFamily(ids),
      year: 2026,
      rng: mulberry32(1),
      rules: [selfAssignmentRule],
    });
    expectValidAssignment(result, ids);
  });

  it('handles the minimal two-person case (the only solution is a swap)', () => {
    const result = assign({
      family: makeFamily(['a', 'b']),
      year: 2026,
      rng: mulberry32(1),
      rules: [selfAssignmentRule],
    });
    expect(result).toEqual([
      { giverId: 'a', receiverId: 'b' },
      { giverId: 'b', receiverId: 'a' },
    ]);
  });

  it('throws for a single person (no derangement possible)', () => {
    expect(() =>
      assign({
        family: makeFamily(['solo']),
        year: 2026,
        rng: mulberry32(1),
        rules: [selfAssignmentRule],
      }),
    ).toThrow(NoValidAssignmentError);
  });

  it('is deterministic for a given seed', () => {
    const run = () =>
      assign({
        family: makeFamily(ids),
        year: 2026,
        rng: mulberry32(99),
        rules: [selfAssignmentRule],
      });
    expect(run()).toEqual(run());
  });
});

describe('assign — Part Three (immediate family)', () => {
  it('never pairs immediate family members', () => {
    // alice+bob spouses, carol is alice's child.
    const family = makeFamily(ids, [
      { from: 'alice', to: 'bob', type: 'spouse' },
      { from: 'alice', to: 'carol', type: 'child' },
    ]);
    const result = assign({
      family,
      year: 2026,
      rng: mulberry32(5),
      rules: [selfAssignmentRule, immediateFamilyRule],
    });
    expectValidAssignment(result, ids);
    const pairs = new Set(result.map((a) => `${a.giverId}->${a.receiverId}`));
    for (const forbidden of ['alice->bob', 'bob->alice', 'alice->carol', 'carol->alice']) {
      expect(pairs.has(forbidden)).toBe(false);
    }
  });

  it('handles a household with two parents and two children, never pairing immediate family', () => {
    const members = ['mom', 'dad', 'kid1', 'kid2', 'aunt', 'uncle'];
    // Mom & Dad are spouses and the parents of Kid1 & Kid2; Aunt & Uncle are another
    // couple, which leaves enough slack for a valid draw.
    const family = makeFamily(members, [
      { from: 'mom', to: 'dad', type: 'spouse' },
      { from: 'mom', to: 'kid1', type: 'child' },
      { from: 'mom', to: 'kid2', type: 'child' },
      { from: 'dad', to: 'kid1', type: 'child' },
      { from: 'dad', to: 'kid2', type: 'child' },
      { from: 'aunt', to: 'uncle', type: 'spouse' },
    ]);
    const result = assign({
      family,
      year: 2026,
      rng: mulberry32(11),
      rules: [selfAssignmentRule, immediateFamilyRule],
    });
    expectValidAssignment(result, members);

    const pairs = new Set(result.map((a) => `${a.giverId}->${a.receiverId}`));
    const immediate = [
      ['mom', 'dad'],
      ['mom', 'kid1'],
      ['mom', 'kid2'],
      ['dad', 'kid1'],
      ['dad', 'kid2'],
      ['aunt', 'uncle'],
    ];
    for (const [x, y] of immediate) {
      expect(pairs.has(`${x}->${y}`)).toBe(false);
      expect(pairs.has(`${y}->${x}`)).toBe(false);
    }
  });

  it('throws when constraints make assignment impossible (two spouses only)', () => {
    const family = makeFamily(['a', 'b'], [{ from: 'a', to: 'b', type: 'spouse' }]);
    expect(() =>
      assign({
        family,
        year: 2026,
        rng: mulberry32(1),
        rules: [selfAssignmentRule, immediateFamilyRule],
      }),
    ).toThrow(NoValidAssignmentError);
  });
});

describe('assign — Part Two (no recent repeat)', () => {
  it('avoids reusing a pairing from within the window', () => {
    const three = ['a', 'b', 'c'];
    // For 3 people only two derangements exist; last year used one of them, so the
    // engine is forced onto the other.
    const lastYear: ExchangeEvent = {
      familyId: 'fam-1',
      year: 2025,
      seed: 1,
      drawnAt: '2025-12-01T00:00:00.000Z',
      assignments: [
        { giverId: 'a', receiverId: 'b' },
        { giverId: 'b', receiverId: 'c' },
        { giverId: 'c', receiverId: 'a' },
      ],
    };
    const result = assign({
      family: makeFamily(three),
      history: [lastYear],
      year: 2026,
      rng: mulberry32(3),
      rules: [selfAssignmentRule, recentRepeatRule],
    });
    expectValidAssignment(result, three);
    const pairs = new Set(result.map((a) => `${a.giverId}->${a.receiverId}`));
    for (const forbidden of ['a->b', 'b->c', 'c->a']) {
      expect(pairs.has(forbidden)).toBe(false);
    }
  });
});

describe('assign — extended family (three generations)', () => {
  // Helper: every immediate pair, expanded to both directions, as "g->r" strings.
  const forbiddenStrings = (immediatePairs: [string, string][]) =>
    new Set(immediatePairs.flatMap(([x, y]) => [`${x}->${y}`, `${y}->${x}`]));

  it('finds a valid draw that pairs only non-immediate relatives', () => {
    const { family, immediatePairs } = makeExtendedFamily();
    const ids = family.members.map((m) => m.id);
    const result = assign({
      family,
      year: 2026,
      rng: mulberry32(7),
      rules: [selfAssignmentRule, immediateFamilyRule],
    });

    expectValidAssignment(result, ids);
    const pairs = new Set(result.map((a) => `${a.giverId}->${a.receiverId}`));
    for (const forbidden of forbiddenStrings(immediatePairs)) {
      expect(pairs.has(forbidden)).toBe(false);
    }
  });

  it('runs several consecutive years with no immediate-family pairs and no recent repeats', () => {
    const { family, immediatePairs } = makeExtendedFamily();
    const ids = family.members.map((m) => m.id);
    const window = 3;
    const forbidden = forbiddenStrings(immediatePairs);

    const history: ExchangeEvent[] = [];
    const pairsByYear = new Map<number, Set<string>>();

    for (const year of [2025, 2026, 2027]) {
      const result = assign({
        family,
        history,
        year,
        rng: mulberry32(year), // deterministic per year
        rules: [selfAssignmentRule, recentRepeatRule, immediateFamilyRule],
        repeatWindow: window,
      });

      expectValidAssignment(result, ids);
      const pairs = new Set(result.map((a) => `${a.giverId}->${a.receiverId}`));

      // Never pairs immediate family.
      for (const f of forbidden) expect(pairs.has(f)).toBe(false);

      // Never repeats a pairing used within the window.
      for (let prev = year - (window - 1); prev < year; prev++) {
        const prevPairs = pairsByYear.get(prev);
        if (prevPairs) for (const p of pairs) expect(prevPairs.has(p)).toBe(false);
      }

      pairsByYear.set(year, pairs);
      history.push({
        familyId: family.id,
        year,
        seed: year,
        drawnAt: `${year}-12-01T00:00:00.000Z`,
        assignments: result,
      });
    }
  });
});

describe('assign — Part Two: a pairing recurs at most once every 3 years (end-to-end)', () => {
  // A 3-person family has exactly TWO derangements, and they share no edges. That makes the
  // engine's choice deterministic (no seed dependence) and lets us prove the 3-year window
  // precisely through the real assignment engine, not just the rule in isolation.
  const ids = ['a', 'b', 'c'];
  const cyc1 = [
    { giverId: 'a', receiverId: 'b' },
    { giverId: 'b', receiverId: 'c' },
    { giverId: 'c', receiverId: 'a' },
  ];
  const cyc2 = [
    { giverId: 'a', receiverId: 'c' },
    { giverId: 'c', receiverId: 'b' },
    { giverId: 'b', receiverId: 'a' },
  ];

  const exchange = (year: number, assignments: typeof cyc1): ExchangeEvent => ({
    familyId: 'fam-1',
    year,
    seed: 1,
    drawnAt: `${year}-12-01T00:00:00.000Z`,
    assignments,
  });
  const draw = (history: ExchangeEvent[], year: number) =>
    assign({
      family: makeFamily(ids),
      history,
      year,
      rng: mulberry32(year),
      rules: [selfAssignmentRule, recentRepeatRule],
      repeatWindow: 3,
    });
  const byGiver = (a: { giverId: string; receiverId: string }[]) =>
    [...a].sort((x, y) => x.giverId.localeCompare(y.giverId));

  it('the year after a pairing is used, the engine must pick the other derangement', () => {
    // cyc1 used in 2024 → 2025 cannot reuse any cyc1 edge → only cyc2 remains.
    expect(byGiver(draw([exchange(2024, cyc1)], 2025))).toEqual(byGiver(cyc2));
  });

  it('two years out, a pairing is still blocked — it cannot recur within the window', () => {
    // cyc1 used 2024, cyc2 used 2025 → in 2026 BOTH are still inside the 3-year window, so
    // no assignment is possible: the rule refuses to repeat rather than bend.
    expect(() => draw([exchange(2024, cyc1), exchange(2025, cyc2)], 2026)).toThrow(
      NoValidAssignmentError,
    );
  });

  it('three years out, the original pairing is allowed to recur', () => {
    // By 2027, cyc1 (from 2024) has aged out of the window and is reused — exactly the
    // prompt's "at most once every 3 years".
    expect(byGiver(draw([exchange(2024, cyc1), exchange(2025, cyc2)], 2027))).toEqual(
      byGiver(cyc1),
    );
  });
});
