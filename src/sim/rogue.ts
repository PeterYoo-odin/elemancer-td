// ROGUELIKE ENDLESS — the live-ops longevity spine. A SEPARATE mode layered over
// the infinite run: a big relic/curse draft pool (drafts.ts), escalating ELITE
// AFFIXES, a periodic BOSS RUSH, and a weekly headline MUTATOR. Everything here is
// pure + seeded so a run replays bit-identically.
//
// RANKED PURITY: the Sim only touches any of this when a `rogue` config is passed.
// Ranked/endless leaderboard runs (and campaign) pass NONE, so every code path in
// this file stays dormant there — no mutator, no affix, no expanded pool ever
// changes the provably-fair ladder. simcheck asserts that inertness directly.

import { clamp } from './combat'
import type { RNG } from './rng'
import type { EnemyKind } from '../game/enemies'
import type { Wave, WaveEntry } from '../game/levels'

// ---------------------------------------------------------------------------
//  RUN-WIDE RULE EFFECTS — how a mutator/event bends the whole run. The Sim reads
//  these at a handful of hook sites (damage, spawn, reactions, gold, slow). All
//  fields default to IDENTITY so a run with no mutator is numerically unchanged.
// ---------------------------------------------------------------------------
export interface RogueEffects {
  playerDmg: number // global player damage multiplier
  enemyHp: number // enemy max-HP multiplier at spawn
  enemySpeed: number // enemy base speed multiplier
  reactionDmg: number // elemental-reaction burst multiplier
  reactionRadius: number // elemental-reaction AoE multiplier
  burnEveryHit: number // dps applied by EVERY hit (0 = off — "everything burns")
  slowPower: number // multiplier on slow STRENGTH (1 = normal, <1 = weaker frost)
  goldMult: number // battle-gold multiplier
  eliteChance: number // additive elite-affix chance bonus
  bossHp: number // boss HP multiplier
}

export function neutralRogueEffects(): RogueEffects {
  return {
    playerDmg: 1, enemyHp: 1, enemySpeed: 1, reactionDmg: 1, reactionRadius: 1,
    burnEveryHit: 0, slowPower: 1, goldMult: 1, eliteChance: 0, bossHp: 1,
  }
}

// ---------------------------------------------------------------------------
//  MUTATORS — the weekly headline rule twist. Each is a small, legible bend that
//  rewrites strategy without bricking a build (slows are weakened, never zeroed;
//  HP swings stay recoverable). The weekly board picks ONE; an event can add more.
// ---------------------------------------------------------------------------
export type MutatorId =
  | 'pyroclasm'
  | 'glacial_silence'
  | 'chain_reaction'
  | 'ironclad'
  | 'gold_fever'
  | 'unstable_core'
  | 'blitz'
  | 'feral_swarm'

export interface MutatorDef {
  id: MutatorId
  name: string // headline callout
  blurb: string // one-line rules text
  icon: string // emoji chip for the HUD
  color: number
  fx: Partial<RogueEffects>
}

export const MUTATORS: Record<MutatorId, MutatorDef> = {
  pyroclasm: {
    id: 'pyroclasm', name: 'EVERYTHING BURNS', icon: '🔥', color: 0xff6a3c,
    blurb: 'Every hit sets the target alight. Enemies are a touch hardier.',
    fx: { burnEveryHit: 7, enemyHp: 1.1 },
  },
  glacial_silence: {
    id: 'glacial_silence', name: 'GLACIAL SILENCE', icon: '🚫', color: 0x9ad0ff,
    blurb: 'Slows are muffled — frost barely bites. Your towers hit harder to compensate.',
    fx: { slowPower: 0.35, playerDmg: 1.15 },
  },
  chain_reaction: {
    id: 'chain_reaction', name: 'DOUBLE REACTIONS', icon: '⚛️', color: 0xc06bff,
    blurb: 'Elemental reactions detonate twice as hard, over a wider blast.',
    fx: { reactionDmg: 2, reactionRadius: 1.2 },
  },
  ironclad: {
    id: 'ironclad', name: 'IRONCLAD TIDE', icon: '🛡️', color: 0xc9b6ff,
    blurb: 'Foes wear heavier hide (+35% HP). Bounties swell to match.',
    fx: { enemyHp: 1.35, goldMult: 1.3, playerDmg: 1.08 },
  },
  gold_fever: {
    id: 'gold_fever', name: 'GOLD FEVER', icon: '💰', color: 0xffd54a,
    blurb: 'Double bounties — but the horde is hungrier and tougher.',
    fx: { goldMult: 2, enemyHp: 1.15, enemySpeed: 1.05 },
  },
  unstable_core: {
    id: 'unstable_core', name: 'UNSTABLE CORE', icon: '☢️', color: 0xa4ff6a,
    blurb: 'Reactions run hot and wide, but so do the enemies.',
    fx: { reactionDmg: 1.6, reactionRadius: 1.35, enemyHp: 1.2 },
  },
  blitz: {
    id: 'blitz', name: 'BLITZ', icon: '⚡', color: 0xffe14a,
    blurb: 'The horde sprints (+30% speed) — softer, but they reach the crystal fast.',
    fx: { enemySpeed: 1.3, enemyHp: 0.85, playerDmg: 1.12 },
  },
  feral_swarm: {
    id: 'feral_swarm', name: 'FERAL SWARM', icon: '🐝', color: 0x8dff4a,
    blurb: 'Elites everywhere — far more affixed foes, richer rewards.',
    fx: { eliteChance: 0.28, goldMult: 1.2 },
  },
}

export const MUTATOR_IDS: MutatorId[] = [
  'pyroclasm', 'glacial_silence', 'chain_reaction', 'ironclad',
  'gold_fever', 'unstable_core', 'blitz', 'feral_swarm',
]

// Fold a set of mutator ids into one RogueEffects, then clamp to sane ranges so no
// stack of event + weekly mutator can produce an unrecoverable (or runaway) run.
export function resolveRogueEffects(ids: MutatorId[]): RogueEffects {
  const e = neutralRogueEffects()
  for (const id of ids) {
    const m = MUTATORS[id]
    if (!m) continue
    const f = m.fx
    if (f.playerDmg) e.playerDmg *= f.playerDmg
    if (f.enemyHp) e.enemyHp *= f.enemyHp
    if (f.enemySpeed) e.enemySpeed *= f.enemySpeed
    if (f.reactionDmg) e.reactionDmg *= f.reactionDmg
    if (f.reactionRadius) e.reactionRadius *= f.reactionRadius
    if (f.burnEveryHit) e.burnEveryHit = Math.max(e.burnEveryHit, f.burnEveryHit)
    if (f.slowPower) e.slowPower *= f.slowPower
    if (f.goldMult) e.goldMult *= f.goldMult
    if (f.eliteChance) e.eliteChance += f.eliteChance
    if (f.bossHp) e.bossHp *= f.bossHp
  }
  e.playerDmg = clamp(e.playerDmg, 0.5, 4)
  e.enemyHp = clamp(e.enemyHp, 0.5, 3)
  e.enemySpeed = clamp(e.enemySpeed, 0.6, 1.8)
  e.reactionDmg = clamp(e.reactionDmg, 0.5, 4)
  e.reactionRadius = clamp(e.reactionRadius, 0.5, 2.5)
  e.burnEveryHit = clamp(e.burnEveryHit, 0, 60)
  e.slowPower = clamp(e.slowPower, 0.2, 1.5)
  e.goldMult = clamp(e.goldMult, 0.5, 4)
  e.eliteChance = clamp(e.eliteChance, 0, 0.6)
  e.bossHp = clamp(e.bossHp, 0.5, 3)
  return e
}

// ---------------------------------------------------------------------------
//  ELITE AFFIXES — deterministic per-enemy modifiers that stack deeper into a run.
//  Every affix is a FAIR threat: tankier, faster, shielded, self-healing, or a
//  gold piñata. None damage the player directly (there is no tower HP), so a run
//  fails cleanly by leaks — never by an unavoidable one-shot.
// ---------------------------------------------------------------------------
export interface EliteAffix {
  id: string
  name: string // banner adjective ("Swift Grunt")
  color: number
  hp?: number // max-HP multiplier
  speed?: number // speed multiplier
  dr?: number // damage-taken multiplier (<1 = tanky)
  bounty?: number // gold multiplier on kill
  shieldFrac?: number // shield pool added = maxHp * frac
  regen?: number // self-heal fraction of maxHp per second (a DPS check)
}

export const AFFIXES: EliteAffix[] = [
  { id: 'swift', name: 'Swift', color: 0x9ad0ff, speed: 1.35, bounty: 1.5 },
  { id: 'ironhide', name: 'Ironhide', color: 0xc9b6ff, hp: 1.55, dr: 0.8, bounty: 1.7 },
  { id: 'warded', name: 'Warded', color: 0x8a4aff, shieldFrac: 0.55, dr: 0.9, bounty: 1.8 },
  { id: 'vital', name: 'Vital', color: 0xff5b7a, hp: 2.1, bounty: 2.1 },
  { id: 'revenant', name: 'Revenant', color: 0xa4ff6a, regen: 0.08, hp: 1.3, bounty: 1.9 },
  { id: 'gilded', name: 'Gilded', color: 0xffd54a, bounty: 3.2, hp: 1.15 },
]
const AFFIX_BY_ID: Record<string, EliteAffix> = Object.fromEntries(AFFIXES.map((a) => [a.id, a]))

// Combined, clamped modifiers an enemy carries from 0-2 affixes.
export interface AffixResult {
  ids: string[]
  name: string // primary adjective for the view ('' = not elite)
  color: number
  hp: number
  speed: number
  dr: number
  bounty: number
  shieldFrac: number
  regen: number
}

const NEUTRAL_AFFIX: AffixResult = { ids: [], name: '', color: 0, hp: 1, speed: 1, dr: 1, bounty: 1, shieldFrac: 0, regen: 0 }

// Roll elite affixes for one spawn. Deterministic (draws from the caller's rogue
// RNG stream). Chance ramps with depth; a SECOND affix only appears deep in a run.
// Cheap trash (swarm) is rarely elite; bosses/keepers are handled elsewhere.
export function rollEliteAffixes(rng: RNG, kind: EnemyKind, waveNum: number, chanceBonus: number): AffixResult {
  if (kind === 'boss' || kind === 'keeper') return NEUTRAL_AFFIX
  const swarmy = kind === 'swarm' || kind === 'runner'
  const base = swarmy ? 0.04 : 0.1
  const chance = clamp(base + waveNum * 0.012 + chanceBonus, 0, swarmy ? 0.3 : 0.62)
  if (!rng.chance(chance)) return NEUTRAL_AFFIX

  const first = rng.pick(AFFIXES)
  const chosen: EliteAffix[] = [first]
  // a second, distinct affix — only past wave 12, and rarer
  if (waveNum >= 12 && rng.chance(clamp((waveNum - 12) * 0.02 + chanceBonus, 0, 0.4))) {
    let guard = 0
    let second = rng.pick(AFFIXES)
    while (second.id === first.id && guard++ < 4) second = rng.pick(AFFIXES)
    if (second.id !== first.id) chosen.push(second)
  }

  const out: AffixResult = { ids: [], name: first.name, color: first.color, hp: 1, speed: 1, dr: 1, bounty: 1, shieldFrac: 0, regen: 0 }
  for (const a of chosen) {
    out.ids.push(a.id)
    if (a.hp) out.hp *= a.hp
    if (a.speed) out.speed *= a.speed
    if (a.dr) out.dr *= a.dr
    if (a.bounty) out.bounty *= a.bounty
    if (a.shieldFrac) out.shieldFrac += a.shieldFrac
    if (a.regen) out.regen += a.regen
  }
  // hard caps so no affix stack becomes unkillable or an instant leak
  out.hp = clamp(out.hp, 1, 3.2)
  out.speed = clamp(out.speed, 1, 1.6)
  out.dr = clamp(out.dr, 0.6, 1)
  out.bounty = clamp(out.bounty, 1, 5)
  out.shieldFrac = clamp(out.shieldFrac, 0, 0.9)
  out.regen = clamp(out.regen, 0, 0.14)
  return out
}

export function affixById(id: string): EliteAffix | undefined {
  return AFFIX_BY_ID[id]
}

// ---------------------------------------------------------------------------
//  ESCALATING WAVE COMPOSER — the roguelike run's ARC. Composition evolves (new
//  archetypes phase in), a single boss lands every 5th wave, and every 10th wave
//  is a BOSS RUSH of multiple bosses. Soft HP scaling (0.16/wave) keeps the ramp
//  survivable; the mutator/affix layer supplies the spikes.
// ---------------------------------------------------------------------------
export function rogueWave(n: number): Wave {
  const hp = 1 + n * 0.16
  const e: WaveEntry[] = []
  const bossRush = n % 10 === 0
  const boss = n % 5 === 0

  e.push({ kind: 'runner', count: 5 + Math.floor(n * 0.7), spacing: 0.3, hpMul: hp })
  e.push({ kind: 'grunt', count: 3 + Math.floor(n * 0.55), spacing: 0.45, hpMul: hp })
  if (n >= 2) e.push({ kind: 'flyer', count: 2 + Math.floor(n * 0.4), spacing: 0.55, hpMul: hp })
  if (n >= 3) e.push({ kind: 'shielded', count: 1 + Math.floor(n * 0.3), spacing: 0.7, hpMul: hp })
  if (n >= 4 && n % 2 === 0) e.push({ kind: 'healer', count: 1 + Math.floor(n * 0.12), spacing: 1.1, hpMul: hp })
  if (n >= 3) e.push({ kind: 'swarm', count: 8 + n * 2, spacing: 0.12, hpMul: hp })
  if (n >= 5) e.push({ kind: 'brute', count: 1 + Math.floor(n * 0.22), spacing: 1.0, hpMul: hp })
  if (n >= 6) e.push({ kind: 'armored', count: 1 + Math.floor(n * 0.18), spacing: 0.78, hpMul: hp })
  if (n >= 9) e.push({ kind: 'elite', count: 1 + Math.floor(n * 0.1), spacing: 1.15, hpMul: hp })

  if (bossRush) {
    e.push({ kind: 'boss', count: 2 + Math.floor(n / 10), spacing: 2.2, hpMul: 1 + n * 0.1 })
  } else if (boss) {
    e.push({ kind: 'boss', count: Math.max(1, Math.floor(n / 5)), spacing: 2.4, hpMul: 1 + n * 0.1 })
  }

  const clearBonus = 30 + n * 7 + (bossRush ? 120 : boss ? 40 : 0)
  return { entries: e, clearBonus }
}

// Is this wave a boss rush? (view telegraph / banner hook)
export function isBossRush(n: number): boolean {
  return n % 10 === 0
}

// ---------------------------------------------------------------------------
//  CONFIG — what the Sim needs to run a roguelike endless session. `mutators` are
//  the weekly headline + any active-event twists; `boostTags` bias the relic draft
//  toward a theme (an event's flavour). All resolved OUTSIDE the sim (view/game
//  layer decides the week + event from the clock) and passed in explicitly.
// ---------------------------------------------------------------------------
export interface RogueConfig {
  mutators: MutatorId[]
  boostTags?: string[]
  eventId?: string // display only
}
