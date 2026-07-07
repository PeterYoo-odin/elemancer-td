// Hero LEVEL + XP progression — pure, deterministic, defensively clamped. Both the
// sim (for deployed-hero stats) and the collection UI read these, so a level-N
// hero has identical numbers everywhere. Levelling is FREE: play earns XP + shards,
// and either path (fill the XP bar, or spend earned shards) buys the next level.
// There is NO real-money input — provably fair by construction.

import type { HeroDef, HeroSpellDef } from './heroes'
import { clamp } from '../sim/combat'

export const MAX_HERO_LEVEL = 20

// A hero's SIGNATURE mechanic (and Element Resonance participation) awakens at
// this level. Below it the kit is dormant — levelling is how the cast grows into
// itself. The scripted demo/attract heroes are Lv 2 BY DESIGN: signatures must
// never touch the pinned, bit-identical trailer run.
export const SIGNATURE_UNLOCK_LEVEL = 3

export function signatureAwake(level: number): boolean {
  return clampLevel(level) >= SIGNATURE_UNLOCK_LEVEL
}

// Per-level multiplicative growth for combat stats (+11% damage/level, etc.).
const DMG_GROWTH = 0.11
const SPELL_GROWTH = 0.10

export interface HeroState {
  level: number
  xp: number
  unlocked: boolean
}

export function defaultHeroState(unlocked: boolean): HeroState {
  return { level: 1, xp: 0, unlocked }
}

// Clamp a persisted level into the legal band.
export function clampLevel(level: number): number {
  return Math.max(1, Math.min(MAX_HERO_LEVEL, Math.floor(Number.isFinite(level) ? level : 1)))
}

// XP required to advance FROM `level` to level+1 (rises smoothly with level).
export function xpForLevel(level: number): number {
  const l = clampLevel(level)
  if (l >= MAX_HERO_LEVEL) return Infinity
  return Math.round(60 + l * 45 + l * l * 6)
}

// Shard cost to buy the next level outright (the accelerator path).
export function shardCostForLevel(level: number): number {
  const l = clampLevel(level)
  if (l >= MAX_HERO_LEVEL) return Infinity
  return 12 + l * 8
}

// Scaled combat stats for a hero at a given level.
export interface HeroStats {
  damage: number
  range: number // tiles
  cooldown: number // seconds
  buffDamage: number // support adjacency buff fraction (0 if not support)
  slowFactor: number // control on-hit slow (1 = none)
  slowDuration: number
  dps: number // single-target baseline (for the card)
}

function dmgMult(level: number): number {
  return 1 + DMG_GROWTH * (clampLevel(level) - 1)
}

export function heroStats(def: HeroDef, level: number): HeroStats {
  const m = dmgMult(level)
  const damage = clamp(def.baseDamage * m, 0, 1e7)
  const cooldown = clamp(def.cooldown, 0.05, 10)
  const buffDamage = def.buffDamage ? clamp(def.buffDamage * m, 0, 4) : 0
  const range = clamp(def.range, 0.5, 12)
  const slowFactor = def.slowFactor ?? 1
  const slowDuration = def.slowDuration ?? 0
  return {
    damage,
    range,
    cooldown,
    buffDamage,
    slowFactor: clamp(slowFactor, 0.1, 1),
    slowDuration: clamp(slowDuration, 0, 8),
    dps: clamp(damage / cooldown, 0, 1e7),
  }
}

// Level-scaled spell numbers (a shallow copy with damage/heal/burn scaled by level).
export function heroSpellScaled(spell: HeroSpellDef, level: number): HeroSpellDef {
  const m = 1 + SPELL_GROWTH * (clampLevel(level) - 1)
  const scale = (v: number | undefined): number | undefined => (v === undefined ? undefined : clamp(v * m, 0, 1e7))
  return {
    ...spell,
    damage: scale(spell.damage),
    burnDps: scale(spell.burnDps),
    heal: spell.heal, // lives are integral & shouldn't inflate with level
    chainCount: spell.chainCount,
  }
}

// The player-facing "power" of a hero at a level (for star pips / sorting).
export function heroPower(def: HeroDef, level: number): number {
  const s = heroStats(def, level)
  return Math.round(s.dps * 2 + level * 4)
}
