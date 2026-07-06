// Workshop meta-upgrade tree. Persistent nodes that boost ALL campaign runs.
//
// FAIRNESS INVARIANT (the anti-pay-to-win wedge):
//   • COIN nodes (the free path) are the ONLY source of battle power (RunModifiers).
//   • DIAMOND nodes are ACCELERATORS of the meta economy (coin / idle multipliers)
//     — they NEVER write a RunModifiers field, so they cannot buy battle strength.
//   • Endless ("Ranked") passes NEUTRAL RunModifiers, so no workshop node — coin
//     OR diamond — changes endless balance.
// ~85% of nodes cost coins; ~15% cost diamonds (2 of 13).

import type { SaveData } from './save'

export type Currency = 'coins' | 'diamonds'

export interface WorkshopNode {
  id: string
  name: string
  desc: string
  currency: Currency
  maxLevel: number
  baseCost: number
  costGrowth: number // cost = round(baseCost * costGrowth^level)
  category: 'battle' | 'economy' | 'accelerator'
}

// --- Run modifiers: everything the BattleScene reads for balance. ---
export interface RunModifiers {
  towerDamageMult: number
  startGoldBonus: number
  spellPowerMult: number
  startLivesBonus: number
  rangeMult: number
  cooldownMult: number // < 1 = faster firing
  goldGainMult: number // more battle-gold from kills
  spellCooldownMult: number // < 1 = spells recharge faster
  towerCostMult: number // < 1 = cheaper placement/upgrades
}

export const NEUTRAL: RunModifiers = {
  towerDamageMult: 1,
  startGoldBonus: 0,
  spellPowerMult: 1,
  startLivesBonus: 0,
  rangeMult: 1,
  cooldownMult: 1,
  goldGainMult: 1,
  spellCooldownMult: 1,
  towerCostMult: 1,
}

// --- Meta economy modifiers (apply to EARNING, never to battle balance). ---
export interface MetaModifiers {
  coinClearMult: number // more coins per level clear
  idlePerMin: number // base idle coins per minute
  coinBoost: number // diamond accelerator: multiplies ALL coin gains
  idleBoost: number // diamond accelerator: multiplies idle earnings
}

export const WORKSHOP_NODES: WorkshopNode[] = [
  // --- COIN · battle power (the free path to strength) ---
  { id: 'power', name: 'Power Core', desc: '+5% tower damage', currency: 'coins', maxLevel: 5, baseCost: 60, costGrowth: 1.6, category: 'battle' },
  { id: 'treasury', name: 'War Chest', desc: '+35 starting gold', currency: 'coins', maxLevel: 5, baseCost: 50, costGrowth: 1.55, category: 'battle' },
  { id: 'arcane_lore', name: 'Arcane Lore', desc: '+15% spell power', currency: 'coins', maxLevel: 4, baseCost: 70, costGrowth: 1.6, category: 'battle' },
  { id: 'fortify', name: 'Fortify', desc: '+2 starting lives', currency: 'coins', maxLevel: 3, baseCost: 80, costGrowth: 1.7, category: 'battle' },
  { id: 'optics', name: 'Optics', desc: '+4% tower range', currency: 'coins', maxLevel: 4, baseCost: 55, costGrowth: 1.55, category: 'battle' },
  { id: 'rapid', name: 'Rapid Loader', desc: '-4% tower cooldown', currency: 'coins', maxLevel: 4, baseCost: 65, costGrowth: 1.6, category: 'battle' },
  { id: 'bounty', name: 'Bounty', desc: '+6% battle-gold from kills', currency: 'coins', maxLevel: 4, baseCost: 55, costGrowth: 1.55, category: 'battle' },
  { id: 'spellhaste', name: 'Quick Cast', desc: '-6% spell cooldown', currency: 'coins', maxLevel: 4, baseCost: 60, costGrowth: 1.6, category: 'battle' },
  { id: 'thrift', name: 'Thrift', desc: '-3% tower cost', currency: 'coins', maxLevel: 4, baseCost: 70, costGrowth: 1.6, category: 'battle' },
  // --- COIN · meta economy (free) ---
  { id: 'windfall', name: 'Windfall', desc: '+10% coins per level clear', currency: 'coins', maxLevel: 5, baseCost: 45, costGrowth: 1.5, category: 'economy' },
  { id: 'dynamo', name: 'Idle Dynamo', desc: '+2 idle coins / min', currency: 'coins', maxLevel: 5, baseCost: 45, costGrowth: 1.5, category: 'economy' },
  // --- DIAMOND · accelerators (NEVER battle power; safe for endless) ---
  { id: 'midas', name: 'Midas Touch', desc: '+25% to ALL coin gains', currency: 'diamonds', maxLevel: 2, baseCost: 40, costGrowth: 2, category: 'accelerator' },
  { id: 'chronos', name: 'Chronos', desc: '+50% idle earnings', currency: 'diamonds', maxLevel: 2, baseCost: 40, costGrowth: 2, category: 'accelerator' },
]

export function nodeById(id: string): WorkshopNode | undefined {
  return WORKSHOP_NODES.find((n) => n.id === id)
}

export function nodeLevel(save: SaveData, id: string): number {
  return save.workshop[id] ?? 0
}

// Cost to buy the NEXT level of a node; null if maxed.
export function nextCost(save: SaveData, node: WorkshopNode): number | null {
  const lvl = nodeLevel(save, node.id)
  if (lvl >= node.maxLevel) return null
  return Math.round(node.baseCost * Math.pow(node.costGrowth, lvl))
}

// Aggregate all COIN battle nodes into RunModifiers. Diamond nodes are ignored
// here by construction — they can never influence battle balance.
export function aggregateRunModifiers(save: SaveData): RunModifiers {
  const m: RunModifiers = { ...NEUTRAL }
  const lv = (id: string) => nodeLevel(save, id)
  m.towerDamageMult = 1 + 0.05 * lv('power')
  m.startGoldBonus = 35 * lv('treasury')
  m.spellPowerMult = 1 + 0.15 * lv('arcane_lore')
  m.startLivesBonus = 2 * lv('fortify')
  m.rangeMult = 1 + 0.04 * lv('optics')
  m.cooldownMult = Math.max(0.4, 1 - 0.04 * lv('rapid'))
  m.goldGainMult = 1 + 0.06 * lv('bounty')
  m.spellCooldownMult = Math.max(0.4, 1 - 0.06 * lv('spellhaste'))
  m.towerCostMult = Math.max(0.5, 1 - 0.03 * lv('thrift'))
  return m
}

export function aggregateMetaModifiers(save: SaveData): MetaModifiers {
  const lv = (id: string) => nodeLevel(save, id)
  return {
    coinClearMult: 1 + 0.1 * lv('windfall'),
    idlePerMin: 4 + 2 * lv('dynamo'), // 4 base so idle always ticks a little
    coinBoost: 1 + 0.25 * lv('midas'),
    idleBoost: 1 + 0.5 * lv('chronos'),
  }
}

// For the ~85/15 split callout in the Workshop UI.
export function coinDiamondSplit(): { coin: number; diamond: number; total: number } {
  const diamond = WORKSHOP_NODES.filter((n) => n.currency === 'diamonds').length
  const total = WORKSHOP_NODES.length
  return { coin: total - diamond, diamond, total }
}
