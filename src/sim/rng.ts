// Seeded deterministic PRNG (mulberry32). ONE instance drives ALL sim randomness
// (wave gen, draft offers, deterministic jitter). Expose the seed so a run can be
// reproduced/shared. View-only cosmetics (spark angles, coin arcs) may use
// Math.random — but nothing that touches sim state ever may.

export class RNG {
  private s: number
  readonly seed: number

  constructor(seed: number) {
    // normalise to a non-zero uint32
    const norm = (seed >>> 0) || 0x9e3779b9
    this.seed = norm
    this.s = norm
  }

  // uniform in [0, 1)
  next(): number {
    this.s = (this.s + 0x6d2b79f5) | 0
    let t = this.s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  // uniform float in [min, max)
  range(min: number, max: number): number {
    return min + (max - min) * this.next()
  }

  // integer in [min, max] inclusive
  int(min: number, max: number): number {
    if (max < min) return min
    return min + Math.floor(this.next() * (max - min + 1))
  }

  chance(p: number): boolean {
    return this.next() < p
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.min(arr.length - 1, Math.floor(this.next() * arr.length))]
  }

  // Fisher-Yates shuffle (returns a new array; deterministic).
  shuffle<T>(arr: readonly T[]): T[] {
    const out = arr.slice()
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1))
      const tmp = out[i]
      out[i] = out[j]
      out[j] = tmp
    }
    return out
  }

  // Draw k distinct items from a pool (deterministic; k clamped to pool size).
  sample<T>(arr: readonly T[], k: number): T[] {
    return this.shuffle(arr).slice(0, Math.max(0, Math.min(k, arr.length)))
  }
}
