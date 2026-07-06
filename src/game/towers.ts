// Tower data tables. Each tower has 3 linear stat tiers (levels[0..2] = Lv1/2/3).
// At its FINAL tier the player picks ONE of two mutually-exclusive BRANCHES
// (branches[0]/branches[1] = "Lv4"), giving multiple ways to build each tower.
// Read current stats via BattleScene.currentStats(t) — never index levels/branches
// directly, so the level-3 (branch) case is always routed correctly.
//
// Range is in tiles; the scene multiplies by TILE. Cooldown is in seconds.

import type { DamageType, Element, StatusKind, TargetMode } from '../sim/combat'

export type TowerKind = 'cannon' | 'frost' | 'flame' | 'storm' | 'arcane'

export interface TowerLevel {
  damage: number
  range: number // tiles
  cooldown: number // seconds between shots
  upgradeCost: number // gold to REACH this level (0 for base)
  // --- slice-3 combat model (all optional; fall back to the TowerDef defaults) ---
  damageType?: DamageType // branch can change the counter type (Sniper→Pierce, Mortar→Siege)
  armorPen?: number // flat armor ignored
  armorTear?: number // Siege/branch: flat armor stripped from the target (status)
  // Frost:
  slowFactor?: number // enemy speed multiplier while slowed (e.g. 0.5)
  slowDuration?: number // seconds the slow lingers
  stunDuration?: number // Glacier branch: hard stun (speed 0) seconds
  // Flame:
  burnDps?: number // burn damage per second
  burnDuration?: number // seconds burn lasts
  splash?: number // splash radius in tiles (also Mortar/Meteor branches)
  // Storm:
  chainCount?: number // number of extra enemies a bolt jumps to
  chainRange?: number // tiles a bolt can jump between enemies
  chainFalloff?: number // damage multiplier applied per jump (e.g. 0.85)
  // Arcane (support):
  buffDamage?: number // +fraction damage granted to adjacent towers (e.g. 0.3 = +30%)
  buffRange?: number // +fraction range granted to adjacent towers
  dealsDamage?: boolean // Prism branch: the support beam also hurts enemies
}

// A branch is a final-tier form: a full stat block plus a name/blurb the panel shows.
export interface TowerBranch extends TowerLevel {
  name: string
  blurb: string
  key: string // stable id, e.g. 'sniper'
}

export interface TowerDef {
  kind: TowerKind
  name: string
  blurb: string
  cost: number // placement cost (level 0)
  color: number
  accent: number
  projectile: boolean // fires a travelling projectile (cannon) vs instant
  synergyDamage: boolean // deals BONUS damage to afflicted (slow/burn/stun) enemies → combos
  antiAir: boolean // can target Flyers (canHitAir)
  support: boolean // Arcane: buffs adjacent towers instead of only attacking
  // --- slice-3 combat model ---
  damageType: DamageType // default counter type vs enemy armor
  element?: Element // optional elemental affinity → engages the element wheel
  armorPen?: number // default flat armor ignored
  status?: StatusKind // signature status this tower applies (for the UI/combos)
  defaultTargeting: TargetMode // starting targeting priority (player-switchable)
  levels: [TowerLevel, TowerLevel, TowerLevel]
  branches: [TowerBranch, TowerBranch]
}

export const SYNERGY_MULT = 1.5 // slowed enemies take +50% from synergy towers

export const TOWERS: Record<TowerKind, TowerDef> = {
  cannon: {
    kind: 'cannon',
    name: 'Cannon',
    blurb: 'Single target · heavy hit',
    cost: 90,
    color: 0x4a7bff,
    accent: 0x18306e,
    projectile: true,
    synergyDamage: true,
    antiAir: false,
    support: false,
    damageType: 'Physical',
    armorPen: 0,
    defaultTargeting: 'First',
    levels: [
      { damage: 24, range: 2.7, cooldown: 0.85, upgradeCost: 0 },
      { damage: 42, range: 3.1, cooldown: 0.72, upgradeCost: 85 },
      { damage: 70, range: 3.5, cooldown: 0.6, upgradeCost: 150 },
    ],
    branches: [
      // Sniper reforges the shot into armour-piercing rounds; Mortar into siege shells.
      { key: 'sniper', name: 'Sniper', blurb: 'Colossal single hit · huge range', damage: 190, range: 5.2, cooldown: 1.15, upgradeCost: 320, damageType: 'Pierce', armorPen: 8 },
      { key: 'mortar', name: 'Mortar', blurb: 'Lobbed shell · splash blast', damage: 95, range: 3.9, cooldown: 0.85, upgradeCost: 320, splash: 1.5, damageType: 'Siege' },
    ],
  },
  frost: {
    kind: 'frost',
    name: 'Frost',
    blurb: 'Slows a whole area',
    cost: 70,
    color: 0x4ad9ff,
    accent: 0x0d5f80,
    projectile: false,
    synergyDamage: false,
    antiAir: false,
    support: false,
    damageType: 'Magic',
    element: 'Water',
    status: 'slow',
    defaultTargeting: 'Close',
    levels: [
      { damage: 5, range: 2.2, cooldown: 0.6, upgradeCost: 0, slowFactor: 0.55, slowDuration: 1.3 },
      { damage: 8, range: 2.6, cooldown: 0.55, upgradeCost: 70, slowFactor: 0.45, slowDuration: 1.5 },
      { damage: 12, range: 3.0, cooldown: 0.5, upgradeCost: 125, slowFactor: 0.35, slowDuration: 1.7 },
    ],
    branches: [
      { key: 'blizzard', name: 'Blizzard', blurb: 'Wide chilling storm', damage: 18, range: 4.0, cooldown: 0.45, upgradeCost: 280, slowFactor: 0.32, slowDuration: 2.0 },
      { key: 'glacier', name: 'Glacier', blurb: 'Deep freeze · hard stun', damage: 26, range: 2.8, cooldown: 0.75, upgradeCost: 280, slowFactor: 0.25, slowDuration: 2.2, stunDuration: 0.5 },
    ],
  },
  flame: {
    kind: 'flame',
    name: 'Flame',
    blurb: 'Burn + splash · short range',
    cost: 80,
    color: 0xff6a3c,
    accent: 0x8a2408,
    projectile: false,
    synergyDamage: true,
    antiAir: false,
    support: false,
    damageType: 'Magic',
    element: 'Fire',
    status: 'burn',
    defaultTargeting: 'Close',
    levels: [
      { damage: 9, range: 1.85, cooldown: 1.0, upgradeCost: 0, burnDps: 11, burnDuration: 2.2, splash: 1.0 },
      { damage: 15, range: 2.15, cooldown: 0.9, upgradeCost: 75, burnDps: 18, burnDuration: 2.4, splash: 1.15 },
      { damage: 24, range: 2.45, cooldown: 0.8, upgradeCost: 135, burnDps: 28, burnDuration: 2.6, splash: 1.35 },
    ],
    branches: [
      { key: 'meteor', name: 'Meteor', blurb: 'Massive splash impact', damage: 60, range: 2.9, cooldown: 1.0, upgradeCost: 300, burnDps: 34, burnDuration: 2.4, splash: 2.1 },
      { key: 'inferno', name: 'Inferno', blurb: 'Relentless scorching burn', damage: 32, range: 2.6, cooldown: 0.7, upgradeCost: 300, burnDps: 80, burnDuration: 3.4, splash: 1.4 },
    ],
  },
  storm: {
    kind: 'storm',
    name: 'Storm',
    blurb: 'Lightning that chains',
    cost: 120,
    color: 0xffe14a,
    accent: 0x9a7400,
    projectile: false,
    synergyDamage: true,
    antiAir: true,
    support: false,
    damageType: 'Magic',
    element: 'Storm',
    defaultTargeting: 'First',
    levels: [
      { damage: 20, range: 3.0, cooldown: 0.95, upgradeCost: 0, chainCount: 2, chainRange: 2.2, chainFalloff: 0.8 },
      { damage: 30, range: 3.3, cooldown: 0.85, upgradeCost: 110, chainCount: 3, chainRange: 2.4, chainFalloff: 0.82 },
      { damage: 44, range: 3.6, cooldown: 0.75, upgradeCost: 180, chainCount: 4, chainRange: 2.6, chainFalloff: 0.85 },
    ],
    branches: [
      { key: 'tempest', name: 'Tempest', blurb: 'Arcs through the whole pack', damage: 58, range: 4.0, cooldown: 0.7, upgradeCost: 340, chainCount: 8, chainRange: 3.0, chainFalloff: 0.9 },
      { key: 'overload', name: 'Overload', blurb: 'One devastating bolt', damage: 210, range: 4.2, cooldown: 1.0, upgradeCost: 340, chainCount: 0, chainRange: 2.4, chainFalloff: 0.8 },
    ],
  },
  arcane: {
    kind: 'arcane',
    name: 'Arcane',
    blurb: 'Support · buffs neighbours',
    cost: 110,
    color: 0xc06bff,
    accent: 0x5a1f9a,
    projectile: false,
    synergyDamage: false,
    antiAir: true,
    support: true,
    damageType: 'Magic',
    element: 'Light',
    defaultTargeting: 'Strong',
    levels: [
      { damage: 6, range: 1.6, cooldown: 1.2, upgradeCost: 0, buffDamage: 0.2, buffRange: 0.1 },
      { damage: 9, range: 1.6, cooldown: 1.1, upgradeCost: 90, buffDamage: 0.3, buffRange: 0.12 },
      { damage: 12, range: 1.6, cooldown: 1.0, upgradeCost: 160, buffDamage: 0.42, buffRange: 0.15 },
    ],
    branches: [
      { key: 'amplify', name: 'Amplify', blurb: 'Overwhelming ally buff', damage: 14, range: 1.6, cooldown: 1.0, upgradeCost: 300, buffDamage: 0.75, buffRange: 0.25 },
      { key: 'prism', name: 'Prism', blurb: 'Buffs AND blasts foes', damage: 46, range: 2.8, cooldown: 0.6, upgradeCost: 300, buffDamage: 0.4, buffRange: 0.12, dealsDamage: true },
    ],
  },
}

export const TOWER_ORDER: TowerKind[] = ['cannon', 'frost', 'flame', 'storm', 'arcane']

// Towers gated behind unlocks (persisted). Cannon/Frost/Flame are free from the start.
export const STARTER_TOWERS: TowerKind[] = ['cannon', 'frost', 'flame']
