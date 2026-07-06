// Tower data tables. Each tower has 3 stat tiers (index 0 = base placement, 1 & 2 =
// upgrades). Add a tower by extending TowerKind + TOWERS. Range is in tiles; the
// scene multiplies by TILE. Cooldown is in seconds.

export type TowerKind = 'cannon' | 'frost' | 'flame'

export interface TowerLevel {
  damage: number
  range: number // tiles
  cooldown: number // seconds between shots
  upgradeCost: number // gold to REACH this level (0 for base)
  // Frost only:
  slowFactor?: number // enemy speed multiplier while slowed (e.g. 0.5)
  slowDuration?: number // seconds the slow lingers
  // Flame only:
  burnDps?: number // burn damage per second
  burnDuration?: number // seconds burn lasts
  splash?: number // splash radius in tiles
}

export interface TowerDef {
  kind: TowerKind
  name: string
  blurb: string
  cost: number // placement cost (level 0)
  color: number
  accent: number
  projectile: boolean // fires a travelling projectile (cannon) vs instant (frost/flame)
  synergyDamage: boolean // deals BONUS damage to frost-slowed enemies
  levels: [TowerLevel, TowerLevel, TowerLevel]
}

export const SYNERGY_MULT = 1.5 // slowed enemies take +50% from cannon/flame

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
    levels: [
      { damage: 24, range: 2.7, cooldown: 0.85, upgradeCost: 0 },
      { damage: 42, range: 3.1, cooldown: 0.72, upgradeCost: 85 },
      { damage: 70, range: 3.5, cooldown: 0.6, upgradeCost: 150 },
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
    levels: [
      { damage: 5, range: 2.2, cooldown: 0.6, upgradeCost: 0, slowFactor: 0.55, slowDuration: 1.3 },
      { damage: 8, range: 2.6, cooldown: 0.55, upgradeCost: 70, slowFactor: 0.45, slowDuration: 1.5 },
      { damage: 12, range: 3.0, cooldown: 0.5, upgradeCost: 125, slowFactor: 0.35, slowDuration: 1.7 },
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
    levels: [
      { damage: 9, range: 1.85, cooldown: 1.0, upgradeCost: 0, burnDps: 11, burnDuration: 2.2, splash: 1.0 },
      { damage: 15, range: 2.15, cooldown: 0.9, upgradeCost: 75, burnDps: 18, burnDuration: 2.4, splash: 1.15 },
      { damage: 24, range: 2.45, cooldown: 0.8, upgradeCost: 135, burnDps: 28, burnDuration: 2.6, splash: 1.35 },
    ],
  },
}

export const TOWER_ORDER: TowerKind[] = ['cannon', 'frost', 'flame']
