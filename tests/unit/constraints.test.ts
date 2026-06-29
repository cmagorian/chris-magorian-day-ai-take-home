import { describe, expect, it } from 'vitest';
import { immediateFamilyRule } from '../../src/domain/constraints/immediateFamily';
import { recentRepeatRule } from '../../src/domain/constraints/recentRepeat';
import { selfAssignmentRule } from '../../src/domain/constraints/selfAssignment';
import type { ExchangeEvent } from '../../src/domain/types';
import { makeContext, makeExtendedFamily, makeFamily } from '../helpers';

describe('selfAssignmentRule', () => {
  const ctx = makeContext(makeFamily(['a', 'b']));

  it('forbids gifting yourself', () => {
    expect(selfAssignmentRule.isAllowed('a', 'a', ctx)).toBe(false);
  });

  it('allows gifting someone else', () => {
    expect(selfAssignmentRule.isAllowed('a', 'b', ctx)).toBe(true);
  });
});

describe('immediateFamilyRule', () => {
  // a & b are spouses; c is unrelated.
  const family = makeFamily(['a', 'b', 'c'], [{ from: 'a', to: 'b', type: 'spouse' }]);
  const ctx = makeContext(family);

  it('forbids gifting immediate family in both directions', () => {
    expect(immediateFamilyRule.isAllowed('a', 'b', ctx)).toBe(false);
    expect(immediateFamilyRule.isAllowed('b', 'a', ctx)).toBe(false);
  });

  it('allows gifting non-relatives', () => {
    expect(immediateFamilyRule.isAllowed('a', 'c', ctx)).toBe(true);
    expect(immediateFamilyRule.isAllowed('c', 'a', ctx)).toBe(true);
  });
});

describe('immediateFamilyRule — parents and children', () => {
  // mom is the parent of kid1 and kid2; pal is unrelated.
  const family = makeFamily(
    ['mom', 'kid1', 'kid2', 'pal'],
    [
      { from: 'mom', to: 'kid1', type: 'child' },
      { from: 'mom', to: 'kid2', type: 'child' },
    ],
  );
  const ctx = makeContext(family);

  it('forbids a parent gifting a child and a child gifting a parent', () => {
    expect(immediateFamilyRule.isAllowed('mom', 'kid1', ctx)).toBe(false);
    expect(immediateFamilyRule.isAllowed('kid1', 'mom', ctx)).toBe(false);
    expect(immediateFamilyRule.isAllowed('mom', 'kid2', ctx)).toBe(false);
    expect(immediateFamilyRule.isAllowed('kid2', 'mom', ctx)).toBe(false);
  });

  it('allows siblings to gift each other (siblings are not spouse/parent/child)', () => {
    expect(immediateFamilyRule.isAllowed('kid1', 'kid2', ctx)).toBe(true);
    expect(immediateFamilyRule.isAllowed('kid2', 'kid1', ctx)).toBe(true);
  });

  it('allows gifting unrelated members', () => {
    expect(immediateFamilyRule.isAllowed('mom', 'pal', ctx)).toBe(true);
    expect(immediateFamilyRule.isAllowed('kid1', 'pal', ctx)).toBe(true);
  });
});

describe('immediateFamilyRule — extended family (grandparents, aunts/uncles, cousins)', () => {
  const { family, immediatePairs, extendedPairs } = makeExtendedFamily();
  const ctx = makeContext(family);

  it('forbids only spouses, parents, and children (both directions)', () => {
    for (const [x, y] of immediatePairs) {
      expect(immediateFamilyRule.isAllowed(x, y, ctx)).toBe(false);
      expect(immediateFamilyRule.isAllowed(y, x, ctx)).toBe(false);
    }
  });

  it('allows extended relatives — grandparents, aunts/uncles, cousins, siblings, in-laws', () => {
    for (const [x, y] of extendedPairs) {
      expect(immediateFamilyRule.isAllowed(x, y, ctx)).toBe(true);
      expect(immediateFamilyRule.isAllowed(y, x, ctx)).toBe(true);
    }
  });
});

describe('recentRepeatRule', () => {
  const family = makeFamily(['a', 'b', 'c']);
  const historyIn = (year: number): ExchangeEvent => ({
    familyId: family.id,
    year,
    seed: 1,
    drawnAt: '2025-01-01T00:00:00.000Z',
    assignments: [{ giverId: 'a', receiverId: 'b' }],
  });

  it('forbids repeating a pairing within the window', () => {
    const ctx = makeContext(family, [historyIn(2025)], 2026);
    expect(recentRepeatRule.isAllowed('a', 'b', ctx)).toBe(false);
  });

  it('still forbids it two years later (edge of the window)', () => {
    const ctx = makeContext(family, [historyIn(2025)], 2027);
    expect(recentRepeatRule.isAllowed('a', 'b', ctx)).toBe(false);
  });

  it('allows the pairing again once the window has passed', () => {
    const ctx = makeContext(family, [historyIn(2025)], 2028);
    expect(recentRepeatRule.isAllowed('a', 'b', ctx)).toBe(true);
  });

  it('never constrains a different pairing', () => {
    const ctx = makeContext(family, [historyIn(2025)], 2026);
    expect(recentRepeatRule.isAllowed('a', 'c', ctx)).toBe(true);
  });
});
