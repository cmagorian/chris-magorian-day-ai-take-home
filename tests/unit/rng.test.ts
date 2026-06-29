import { describe, expect, it } from 'vitest';
import { mulberry32, shuffle } from '../../src/domain/rng';

describe('mulberry32', () => {
  it('is deterministic for a given seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
  });

  it('produces values in [0, 1)', () => {
    const rng = mulberry32(123);
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('diverges for different seeds', () => {
    expect(mulberry32(1).next()).not.toEqual(mulberry32(2).next());
  });
});

describe('shuffle', () => {
  it('returns a permutation without mutating the input', () => {
    const input = [1, 2, 3, 4, 5];
    const copy = [...input];
    const out = shuffle(input, mulberry32(7));
    expect(input).toEqual(copy); // not mutated
    expect([...out].sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5]); // same elements
  });

  it('is deterministic for a given seed', () => {
    expect(shuffle([1, 2, 3, 4, 5], mulberry32(7))).toEqual(
      shuffle([1, 2, 3, 4, 5], mulberry32(7)),
    );
  });
});
