// ADMIN RNG — a tiny seeded PRNG (mulberry32) used ONLY to synthesise stable
// demo data for the dashboard when no backend is configured. Seeding matters:
// charts must not jitter on every tab-switch or re-render, so every demo series
// is derived from a fixed seed + a stable key rather than Math.random().
//
// This is dashboard-side scaffolding — it is NOT the game's sim RNG and never
// touches gameplay determinism. (The sim has its own RNG in src/sim/rng.ts.)

export interface Rand {
  next(): number // [0,1)
  int(loInclusive: number, hiInclusive: number): number
  range(lo: number, hi: number): number
  pick<T>(arr: readonly T[]): T
  bool(pTrue: number): boolean
  /** Gaussian-ish jitter around 1.0 (mean 1, given spread) — for organic curves. */
  jitter(spread: number): number
}

function hashSeed(key: string, base = 0x9e3779b9): number {
  let h = base >>> 0
  for (let i = 0; i < key.length; i++) {
    h = Math.imul(h ^ key.charCodeAt(i), 0x01000193)
  }
  return h >>> 0
}

/** mulberry32 — small, fast, good-enough distribution for demo curves. */
export function makeRand(seedKey: string): Rand {
  let a = hashSeed(seedKey)
  const next = (): number => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const r: Rand = {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    range: (lo, hi) => lo + next() * (hi - lo),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    bool: (p) => next() < p,
    jitter: (spread) => {
      // sum of two uniforms → triangular, centred at 1.0
      const u = (next() + next()) / 2
      return 1 + (u - 0.5) * 2 * spread
    },
  }
  return r
}
