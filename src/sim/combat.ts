// The combat MODEL — pure, data-driven, deterministic, defensively clamped.
// This is the finalized slice-3 schema: a damage-type × armor-type GRID plus a
// PROGRESSIVE element WHEEL, folded through a single damage formula with a global
// 0.5× floor so there is NO immunity, ever.

export type DamageType = 'Pierce' | 'Siege' | 'Magic' | 'Physical'
export type ArmorType = 'Unarmored' | 'Light' | 'Heavy' | 'Fortified' | 'Warded'
export type Element = 'Fire' | 'Water' | 'Nature' | 'Light' | 'Dark' | 'Storm'
export type StatusKind = 'slow' | 'burn' | 'poison' | 'stun' | 'armorTear'

// Per-tower targeting priority (player-switchable at runtime).
export type TargetMode = 'First' | 'Last' | 'Close' | 'Strong'
export const TARGET_MODES: TargetMode[] = ['First', 'Last', 'Close', 'Strong']

export const DAMAGE_TYPES: DamageType[] = ['Pierce', 'Siege', 'Magic', 'Physical']
export const ARMOR_TYPES: ArmorType[] = ['Unarmored', 'Light', 'Heavy', 'Fortified', 'Warded']

// CORE counter grid: GRID[dmgType][armorType] (shipped exactly as specified).
export const GRID: Record<DamageType, Record<ArmorType, number>> = {
  Pierce: { Unarmored: 1.5, Light: 1.5, Heavy: 0.75, Fortified: 0.5, Warded: 1.0 },
  Siege: { Unarmored: 0.75, Light: 0.5, Heavy: 1.25, Fortified: 1.5, Warded: 1.0 },
  Magic: { Unarmored: 1.0, Light: 1.0, Heavy: 1.5, Fortified: 1.25, Warded: 0.5 },
  Physical: { Unarmored: 1.25, Light: 1.0, Heavy: 0.75, Fortified: 0.75, Warded: 1.5 },
}

// PROGRESSIVE element wheel (only applies when BOTH attacker element and
// defender affinity are present). Strong 1.5 / Weak 0.75 / Neutral 1.0.
export const WHEEL: Record<Element, { strong: Element[]; weak: Element[] }> = {
  Fire: { strong: ['Nature', 'Dark'], weak: ['Water', 'Light'] },
  Nature: { strong: ['Water', 'Storm'], weak: ['Fire', 'Dark'] },
  Water: { strong: ['Fire', 'Light'], weak: ['Nature', 'Storm'] },
  Light: { strong: ['Dark', 'Fire'], weak: ['Storm', 'Water'] },
  Dark: { strong: ['Storm', 'Nature'], weak: ['Light', 'Fire'] },
  Storm: { strong: ['Light', 'Water'], weak: ['Dark', 'Nature'] },
}

export const ELEMENT_COLOR: Record<Element, number> = {
  Fire: 0xff6a3c,
  Water: 0x4ad9ff,
  Nature: 0x8dff4a,
  Light: 0xffe14a,
  Dark: 0xc06bff,
  Storm: 0x9ad0ff,
}

export const ELEMENT_ORDER: Element[] = ['Fire', 'Water', 'Nature', 'Light', 'Dark', 'Storm']

// ---- defensive math (sim must never import Phaser) -----------------------
export function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo
  if (v < lo) return lo
  if (v > hi) return hi
  return v
}

export function safe(v: number, fallback = 0): number {
  return Number.isFinite(v) ? v : fallback
}

export function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx
  const dy = ay - by
  return dx * dx + dy * dy
}

export function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.sqrt(dist2(ax, ay, bx, by))
}

export function angleBetween(ax: number, ay: number, bx: number, by: number): number {
  return Math.atan2(by - ay, bx - ax)
}

// Wheel multiplier for an attacker element vs a defender affinity.
export function wheelMult(element: Element | undefined, affinity: Element | undefined): number {
  if (!element || !affinity) return 1
  const w = WHEEL[element]
  if (w.strong.includes(affinity)) return 1.5
  if (w.weak.includes(affinity)) return 0.75
  return 1
}

// The GLOBAL damage formula. A 0.5× floor on typeMult guarantees no immunity;
// max(0.05*damage, …) guarantees every hit does *something* through flat armor.
export interface DefenderStats {
  armor: ArmorType
  flatArmor: number
  affinity?: Element
}
export interface AttackStats {
  damage: number
  dmgType: DamageType
  element?: Element
  armorPen: number
}

// Combined type multiplier (grid × wheel) clamped to [0.5, 2.5].
export function typeMultiplier(atk: AttackStats, def: DefenderStats): number {
  const grid = GRID[atk.dmgType][def.armor] ?? 1
  const wheel = atk.element && def.affinity ? wheelMult(atk.element, def.affinity) : 1
  return clamp(grid * wheel, 0.5, 2.5)
}

// Final damage for a single hit. Always finite, always >= a small floor.
export function computeHit(atk: AttackStats, def: DefenderStats): number {
  const damage = Math.max(0, safe(atk.damage))
  if (damage <= 0) return 0
  const mult = typeMultiplier(atk, def)
  const flat = Math.max(0, safe(def.flatArmor) - Math.max(0, safe(atk.armorPen)))
  const raw = damage * mult - flat
  const perHit = Math.max(0.05 * damage, raw)
  return safe(perHit, 0.05 * damage)
}

// Classify a hit for the approachability UI (green when strong, grey when weak).
export type Effectiveness = 'strong' | 'neutral' | 'weak'
export function classify(mult: number): Effectiveness {
  if (mult >= 1.25) return 'strong'
  if (mult <= 0.75) return 'weak'
  return 'neutral'
}
