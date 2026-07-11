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
  // CHROMANCER #55 — the tail extension. `taperLevel` is the node's ORIGINAL
  // maxLevel (pre-#55): every level up to it keeps its full per-point effect
  // (and its EXACT original cost — costGrowth is untouched, so a save that
  // already bought these levels is charged/refunded nothing). Levels beyond
  // taperLevel are the new tail: same exponential cost curve (so the last few
  // levels of each node are a real coin sink purely from more compounding), but
  // HALF the per-point effect, so the extended cap is a meaningful chase without
  // doubling a stat that was already tuned against the old ceiling.
  taperLevel: number
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

// CHROMANCER #55 — meta-progression rescale. The board used to be fully maxed
// for ~6,714 coins — with the campaign at 192 levels that emptied the entire
// chase by map ~21 (11% in), so a player who kept playing had nothing left to
// buy for the remaining ~89%. maxLevel is raised on every coin node (taperLevel
// records each node's OLD cap so aggregateRunModifiers/aggregateMetaModifiers
// can taper the extended tail — see WorkshopNode.taperLevel above) and costGrowth
// is left EXACTLY as it was, so every already-purchased level keeps its original
// price (SAVE-SAFE: raising maxLevel only exposes new levels, it never re-prices
// or invalidates a level a player already bought). Extending the SAME exponential
// curve a further 4-6 levels is on its own enough to make the tail a real sink
// (each node's last level now costs ~1,100-4,100 coins). New total-to-max ≈
// 70,964 coins (~10.6× the old 6,714), paced to still be chasing upgrades deep
// into the ladder rather than done at map 21.
export const WORKSHOP_NODES: WorkshopNode[] = [
  // --- COIN · battle power (the free path to strength) ---
  { id: 'power', name: 'Power Core', desc: '+5% tower damage', currency: 'coins', maxLevel: 10, taperLevel: 5, baseCost: 60, costGrowth: 1.6, category: 'battle' },
  { id: 'treasury', name: 'War Chest', desc: '+35 starting gold', currency: 'coins', maxLevel: 10, taperLevel: 5, baseCost: 50, costGrowth: 1.55, category: 'battle' },
  { id: 'arcane_lore', name: 'Arcane Lore', desc: '+15% spell power', currency: 'coins', maxLevel: 9, taperLevel: 4, baseCost: 70, costGrowth: 1.6, category: 'battle' },
  { id: 'fortify', name: 'Fortify', desc: '+2 starting lives', currency: 'coins', maxLevel: 6, taperLevel: 3, baseCost: 80, costGrowth: 1.7, category: 'battle' },
  { id: 'optics', name: 'Optics', desc: '+4% tower range', currency: 'coins', maxLevel: 9, taperLevel: 4, baseCost: 55, costGrowth: 1.55, category: 'battle' },
  { id: 'rapid', name: 'Rapid Loader', desc: '-4% tower cooldown', currency: 'coins', maxLevel: 9, taperLevel: 4, baseCost: 65, costGrowth: 1.6, category: 'battle' },
  { id: 'bounty', name: 'Bounty', desc: '+6% battle-gold from kills', currency: 'coins', maxLevel: 9, taperLevel: 4, baseCost: 55, costGrowth: 1.55, category: 'battle' },
  { id: 'spellhaste', name: 'Quick Cast', desc: '-6% spell cooldown', currency: 'coins', maxLevel: 9, taperLevel: 4, baseCost: 60, costGrowth: 1.6, category: 'battle' },
  { id: 'thrift', name: 'Thrift', desc: '-3% tower cost', currency: 'coins', maxLevel: 9, taperLevel: 4, baseCost: 70, costGrowth: 1.6, category: 'battle' },
  // --- COIN · meta economy (free) ---
  { id: 'windfall', name: 'Windfall', desc: '+10% coins per level clear', currency: 'coins', maxLevel: 10, taperLevel: 5, baseCost: 45, costGrowth: 1.5, category: 'economy' },
  { id: 'dynamo', name: 'Idle Dynamo', desc: '+2 idle coins / min', currency: 'coins', maxLevel: 10, taperLevel: 5, baseCost: 45, costGrowth: 1.5, category: 'economy' },
  // --- DIAMOND · accelerators (NEVER battle power; safe for endless) ---
  { id: 'midas', name: 'Midas Touch', desc: '+25% to ALL coin gains', currency: 'diamonds', maxLevel: 2, taperLevel: 2, baseCost: 40, costGrowth: 2, category: 'accelerator' },
  { id: 'chronos', name: 'Chronos', desc: '+50% idle earnings', currency: 'diamonds', maxLevel: 2, taperLevel: 2, baseCost: 40, costGrowth: 2, category: 'accelerator' },
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

// Tiered per-level value: full `perLevel` for the levels up through the node's
// original cap (`taperLevel`), HALF `perLevel` for every level bought beyond it.
// Keeps the #55 tail extension a meaningful chase without doubling a stat that
// was already balanced against the old ceiling.
function tieredValue(level: number, taperLevel: number, perLevel: number): number {
  const full = Math.min(level, taperLevel)
  const tapered = Math.max(0, level - taperLevel)
  return perLevel * full + perLevel * 0.5 * tapered
}

// Aggregate all COIN battle nodes into RunModifiers. Diamond nodes are ignored
// here by construction — they can never influence battle balance.
export function aggregateRunModifiers(save: SaveData): RunModifiers {
  const m: RunModifiers = { ...NEUTRAL }
  const lv = (id: string) => nodeLevel(save, id)
  const tv = (id: string, perLevel: number) => {
    const node = nodeById(id)
    return tieredValue(lv(id), node?.taperLevel ?? lv(id), perLevel)
  }
  m.towerDamageMult = 1 + tv('power', 0.05)
  m.startGoldBonus = tv('treasury', 35)
  m.spellPowerMult = 1 + tv('arcane_lore', 0.15)
  m.startLivesBonus = tv('fortify', 2)
  m.rangeMult = 1 + tv('optics', 0.04)
  m.cooldownMult = Math.max(0.4, 1 - tv('rapid', 0.04))
  m.goldGainMult = 1 + tv('bounty', 0.06)
  m.spellCooldownMult = Math.max(0.4, 1 - tv('spellhaste', 0.06))
  m.towerCostMult = Math.max(0.5, 1 - tv('thrift', 0.03))
  return m
}

export function aggregateMetaModifiers(save: SaveData): MetaModifiers {
  const lv = (id: string) => nodeLevel(save, id)
  const tv = (id: string, perLevel: number) => {
    const node = nodeById(id)
    return tieredValue(lv(id), node?.taperLevel ?? lv(id), perLevel)
  }
  return {
    coinClearMult: 1 + tv('windfall', 0.1),
    idlePerMin: 4 + tv('dynamo', 2), // 4 base so idle always ticks a little
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
