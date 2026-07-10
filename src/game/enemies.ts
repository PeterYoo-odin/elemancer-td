// Enemy data tables. Add a new enemy by extending EnemyKind + ENEMIES; levels.ts
// references them by kind. Speed is in tiles/second; the scene multiplies by TILE.
//
// Slice-2 roster: the slice-1 trio (runner/grunt/brute) plus four archetypes with
// special behaviours the BattleScene reads off these flags, plus a boss.
//   flyer    — only anti-air towers (Arcane / Storm) can hit it.
//   shielded — incoming damage reduced until its shield pool is broken.
//   healer   — periodically heals nearby enemies.
//   swarm    — tiny, fast, low-HP; arrives in dense clusters (wave spacing does the clustering).
//   boss     — huge HP, shielded, the finale of the campaign.
//   armored  — Fortified plate; resists Pierce/Physical hard, folds to Siege/Magic.
//              Punishes a Sniper/Cannon-mono board. Campaign-gated mid Emberwaste on.
//   elite    — Warded veteran; resists Magic hard (0.5×), folds to Physical/cannon
//              fire. Punishes an all-Magic board (frost/flame/storm/arcane). Gated
//              in after armored, once the realm roster has room to answer it.

export type EnemyKind =
  | 'runner'
  | 'grunt'
  | 'brute'
  | 'flyer'
  | 'shielded'
  | 'healer'
  | 'swarm'
  | 'armored'
  | 'elite'
  | 'boss'
  | 'keeper'

import type { ArmorType, Element } from '../sim/combat'

export type EnemyShape = 'triangle' | 'square' | 'hex' | 'circle' | 'diamond'

export interface EnemyDef {
  kind: EnemyKind
  name: string
  hp: number
  speed: number // tiles per second
  radius: number // px
  color: number
  accent: number // outline / detail colour
  shape: EnemyShape
  reward: number // battle-gold on kill

  // --- slice-3 combat model (NO immunity flags, ever) ---
  armor: ArmorType // routes through the damage-type × armor grid
  flatArmor: number // flat damage soaked per hit (default 0, mostly small)
  affinity?: Element // elemental-only; engages the wheel vs elemental towers
  isAir?: boolean // only canHitAir towers may target it (targeting, not immunity)

  // --- special archetype flags (all optional) ---
  flying?: boolean // only anti-air towers can target it
  shield?: number // flat shield pool; while > 0 damage is reduced by shieldBlock
  shieldBlock?: number // fraction of damage absorbed while shielded (0..1), default 0.6
  healRadius?: number // tiles — heals allies within this radius
  healAmount?: number // hp restored per pulse (scaled to target maxHp fraction if <=1)
  healInterval?: number // seconds between heal pulses
  boss?: boolean // triggers extra screen juice on death / spawn
}

// LEAK DAMAGE — what the Prism Wellspring loses when THIS enemy reaches the base.
// Deterministic and scaled by the enemy's ARCHETYPE STRENGTH (intrinsic tier via
// def.hp + boss/elite), NOT its live wave-buffed maxHp — so it stays readable, is a
// stable tooltip fact, and a gimmick "tanky runner" wave still only chips one pip.
// Chip (swarm/runner/flyer/grunt = 1) → hurt (healer/bulwark = 2) → heavy (brute = 3)
// → gut (bosses 8-9). An elite affix adds +1. Clamped to a sane [1,40] backstop.
export function leakDamageFor(def: EnemyDef, elite = false): number {
  let dmg: number
  if (def.boss) dmg = 6 + Math.floor(def.hp / 450) // Keeper(900)→8, Titan(1400)→9 — near-lethal on a finale
  else if (def.hp >= 200) dmg = 3 // Brute-class heavies
  else if (def.hp >= 100) dmg = 2 // Bulwarks / Menders
  else dmg = 1 // runners, sprites, flyers, grunts — the chip tier
  if (elite) dmg += 1
  return Math.max(1, Math.min(40, Math.round(dmg)))
}

export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  runner: {
    kind: 'runner',
    name: 'Runner',
    hp: 32,
    speed: 2.35,
    radius: 15,
    color: 0x8dff4a,
    accent: 0x2f7a10,
    shape: 'triangle',
    reward: 6,
    armor: 'Unarmored',
    flatArmor: 0,
  },
  grunt: {
    kind: 'grunt',
    name: 'Grunt',
    hp: 78,
    speed: 1.35,
    radius: 18,
    color: 0xff9b2f,
    accent: 0x8a4400,
    shape: 'square',
    reward: 10,
    armor: 'Light',
    flatArmor: 1,
  },
  brute: {
    kind: 'brute',
    name: 'Brute',
    hp: 240,
    speed: 0.82,
    radius: 27,
    color: 0xff3b6b,
    accent: 0x7a0a28,
    shape: 'hex',
    reward: 22,
    armor: 'Heavy',
    flatArmor: 3,
  },
  flyer: {
    kind: 'flyer',
    name: 'Flyer',
    hp: 60,
    speed: 1.9,
    radius: 16,
    color: 0x9ad0ff,
    accent: 0x2b6fd6,
    shape: 'diamond',
    reward: 12,
    flying: true,
    armor: 'Light',
    flatArmor: 0,
    affinity: 'Light', // Storm (strong vs Light) shreds it; Fire (weak) fizzles
    isAir: true,
  },
  shielded: {
    kind: 'shielded',
    name: 'Bulwark',
    hp: 140,
    speed: 1.05,
    radius: 20,
    color: 0xc9b6ff,
    accent: 0x5b3fb0,
    shape: 'square',
    reward: 16,
    shield: 90,
    shieldBlock: 0.6,
    armor: 'Fortified', // Siege (Mortar) & Magic love it; Pierce (Sniper) struggles
    flatArmor: 2,
  },
  healer: {
    kind: 'healer',
    name: 'Mender',
    hp: 110,
    speed: 1.15,
    radius: 19,
    color: 0x6bffb0,
    accent: 0x159c63,
    shape: 'circle',
    reward: 18,
    healRadius: 2.2,
    healAmount: 14,
    healInterval: 1.4,
    armor: 'Unarmored',
    flatArmor: 0,
    affinity: 'Nature', // Fire (strong vs Nature) melts it; Storm (weak) barely dents
  },
  swarm: {
    kind: 'swarm',
    name: 'Sprite',
    hp: 14,
    speed: 2.75,
    radius: 10,
    color: 0xffe14a,
    accent: 0xb07d00,
    shape: 'triangle',
    reward: 3,
    armor: 'Unarmored',
    flatArmor: 0,
  },
  armored: {
    kind: 'armored',
    name: 'Ironclad',
    hp: 150,
    speed: 1.05,
    radius: 20,
    color: 0x7fa8d6,
    accent: 0x2f4a66,
    shape: 'square',
    reward: 16,
    armor: 'Fortified', // Siege & Magic bite; Pierce/Physical fold — the anti-Sniper-mono unit
    flatArmor: 3,
  },
  elite: {
    kind: 'elite',
    name: 'Champion',
    hp: 300,
    speed: 0.95,
    radius: 24,
    color: 0xe0507d,
    accent: 0x7a1030,
    shape: 'hex',
    reward: 32,
    armor: 'Warded', // resists Magic (0.5×) hard — the anti-all-Magic-board unit; bring Physical/cannon
    flatArmor: 7,
  },
  // Fallback stat block for the 'keeper' kind — real Keeper fights override this
  // with per-Keeper defs from keepers.ts at spawn (sim looks them up by wave
  // entry). Exists so ENEMIES stays total over EnemyKind and any stray keeper
  // spawn degrades gracefully instead of crashing.
  keeper: {
    kind: 'keeper',
    name: 'Corrupted Keeper',
    hp: 900,
    speed: 0.5,
    radius: 34,
    color: 0x9a94b8,
    accent: 0xc9b6ff,
    shape: 'hex',
    reward: 90,
    boss: true,
    armor: 'Light',
    flatArmor: 2,
  },
  boss: {
    kind: 'boss',
    name: 'Titan',
    hp: 1400,
    speed: 0.6,
    radius: 38,
    color: 0xff4db8,
    accent: 0x7a0a52,
    shape: 'hex',
    reward: 120,
    shield: 400,
    shieldBlock: 0.5,
    boss: true,
    armor: 'Warded', // resists ALL Magic (0.5×) — bring Physical/Siege cannons
    flatArmor: 5,
  },
}
