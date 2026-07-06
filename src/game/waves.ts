// Wave data table. 8 escalating waves. Add or retune a wave by editing WAVES.
// Each entry spawns `count` enemies of `kind`, `spacing` seconds apart, with hp
// scaled by `hpMul`. Entries within a wave run in order.

import type { EnemyKind } from './enemies'

export interface WaveEntry {
  kind: EnemyKind
  count: number
  spacing: number // seconds between spawns in this entry
  hpMul: number
}

export interface Wave {
  entries: WaveEntry[]
  clearBonus: number // gold awarded when the wave is cleared
}

export const WAVES: Wave[] = [
  // 1 — gentle intro
  { entries: [{ kind: 'runner', count: 6, spacing: 0.65, hpMul: 1 }], clearBonus: 20 },
  // 2 — runners + first grunts
  {
    entries: [
      { kind: 'runner', count: 6, spacing: 0.5, hpMul: 1 },
      { kind: 'grunt', count: 4, spacing: 0.8, hpMul: 1 },
    ],
    clearBonus: 22,
  },
  // 3 — grunt-heavy
  {
    entries: [
      { kind: 'grunt', count: 8, spacing: 0.7, hpMul: 1.05 },
      { kind: 'runner', count: 5, spacing: 0.4, hpMul: 1.05 },
    ],
    clearBonus: 25,
  },
  // 4 — first brute
  {
    entries: [
      { kind: 'runner', count: 10, spacing: 0.4, hpMul: 1.1 },
      { kind: 'brute', count: 1, spacing: 1, hpMul: 1 },
    ],
    clearBonus: 28,
  },
  // 5 — mixed pressure
  {
    entries: [
      { kind: 'grunt', count: 10, spacing: 0.6, hpMul: 1.2 },
      { kind: 'runner', count: 8, spacing: 0.35, hpMul: 1.2 },
    ],
    clearBonus: 32,
  },
  // 6 — brute pack
  {
    entries: [
      { kind: 'brute', count: 3, spacing: 1.3, hpMul: 1.1 },
      { kind: 'grunt', count: 8, spacing: 0.55, hpMul: 1.3 },
    ],
    clearBonus: 38,
  },
  // 7 — swarm
  {
    entries: [
      { kind: 'runner', count: 18, spacing: 0.3, hpMul: 1.35 },
      { kind: 'grunt', count: 8, spacing: 0.5, hpMul: 1.4 },
    ],
    clearBonus: 45,
  },
  // 8 — boss wave
  {
    entries: [
      { kind: 'brute', count: 5, spacing: 1.1, hpMul: 1.4 },
      { kind: 'grunt', count: 12, spacing: 0.45, hpMul: 1.6 },
      { kind: 'runner', count: 12, spacing: 0.3, hpMul: 1.6 },
    ],
    clearBonus: 100,
  },
]
