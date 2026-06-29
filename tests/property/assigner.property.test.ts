import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { assign } from '../../src/domain/assigner';
import { selfAssignmentRule } from '../../src/domain/constraints/selfAssignment';
import { mulberry32 } from '../../src/domain/rng';
import { expectValidAssignment, makeFamily } from '../helpers';

/**
 * Property-based tests assert invariants over *many* randomly generated inputs, which
 * catches edge cases example-based tests miss. A family with no relationships and no
 * history is always solvable for n >= 2, so the engine must always return a valid
 * derangement.
 */
describe('assign — properties', () => {
  it('always returns a valid derangement for any family of 2+ people', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 25 }), fc.integer(), (n, seed) => {
        const ids = Array.from({ length: n }, (_, i) => `p${i}`);
        const result = assign({
          family: makeFamily(ids),
          year: 2026,
          rng: mulberry32(seed),
          rules: [selfAssignmentRule],
        });
        expectValidAssignment(result, ids);
      }),
    );
  });

  it('is reproducible: same family and seed always yield the same assignment', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 25 }), fc.integer(), (n, seed) => {
        const ids = Array.from({ length: n }, (_, i) => `p${i}`);
        const run = () =>
          assign({
            family: makeFamily(ids),
            year: 2026,
            rng: mulberry32(seed),
            rules: [selfAssignmentRule],
          });
        expect(run()).toEqual(run());
      }),
    );
  });
});
