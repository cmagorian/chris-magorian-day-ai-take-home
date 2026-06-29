// We inject an Rng into the engine instead of calling Math.random() so a draw is
// reproducible: same seed + same inputs → same result. Handy for tests and for auditing
// after the fact ("why did Alice draw Bob in 2024?").

export interface Rng {
  /** float in [0, 1) */
  next(): number;
}

// mulberry32: a tiny, fast, deterministic 32-bit PRNG. Non-cryptographic, which is fine —
// we want reproducibility, not unpredictability.
export function mulberry32(seed: number): Rng {
  let state = seed >>> 0;
  return {
    next() {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

// A fresh seed for draws that don't ask for a specific one — we still record it, so even a
// "random" draw stays reproducible after the fact.
export function randomSeed(): number {
  return Math.floor(Math.random() * 0x100000000);
}

// Fisher–Yates, non-mutating, driven by the injected Rng so the shuffle is reproducible too.
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    const tmp = result[i]!;
    result[i] = result[j]!;
    result[j] = tmp;
  }
  return result;
}
