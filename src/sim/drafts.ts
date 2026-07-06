// "Pick 1 of 3" power drafts (Archero / Vampire-Survivors style). Every few waves
// the sim PAUSES and offers 3 cards drawn from the run's seeded RNG. Picking one
// applies a run-wide RunUpgrades modifier (or an immediate life change). Pure and
// deterministic — the sim owns the RNG that selects the offer.

import { ELEMENT_COLOR, ELEMENT_ORDER, type Element } from './combat'

export interface RunUpgrades {
  allDmg: number // global tower damage multiplier
  elementDmg: Record<Element, number> // per-element damage multiplier
  stormChainBonus: number // +N storm chain jumps
  frostSlowBonus: number // stronger slow (subtracts from slowFactor, floored)
  burnDmgMult: number // burn/DoT damage multiplier
  armorPenBonus: number // flat armor pen added to every tower
  fireRateMult: number // <1 = faster firing
  splashBonus: number // additive fraction to every splash radius
  goldGainMult: number // battle-gold from kills
  towerCostMult: number // multiplies placement/upgrade cost (<1 cheaper)
  comboRamp: number // multiplies the per-hit combo step (faster escalation)
}

export function neutralUpgrades(): RunUpgrades {
  const elementDmg = {} as Record<Element, number>
  for (const e of ELEMENT_ORDER) elementDmg[e] = 1
  return {
    allDmg: 1,
    elementDmg,
    stormChainBonus: 0,
    frostSlowBonus: 0,
    burnDmgMult: 1,
    armorPenBonus: 0,
    fireRateMult: 1,
    splashBonus: 0,
    goldGainMult: 1,
    towerCostMult: 1,
    comboRamp: 1,
  }
}

export type DraftRarity = 'common' | 'rare' | 'relic'

export interface DraftCard {
  id: string
  title: string
  desc: string
  color: number
  rarity: DraftRarity
  livesDelta?: number // applied immediately by the sim on pick
  apply(u: RunUpgrades): void
}

function elementCard(e: Element): DraftCard {
  return {
    id: `elem_${e}`,
    title: `${e} Focus`,
    desc: `+30% ${e} tower damage`,
    color: ELEMENT_COLOR[e],
    rarity: 'common',
    apply: (u) => {
      u.elementDmg[e] *= 1.3
    },
  }
}

export const DRAFT_POOL: DraftCard[] = [
  elementCard('Fire'),
  elementCard('Water'),
  elementCard('Storm'),
  elementCard('Light'),
  { id: 'alldmg', title: 'Overpower', desc: '+18% ALL tower damage', color: 0xffd54a, rarity: 'common', apply: (u) => { u.allDmg *= 1.18 } },
  { id: 'stormchain', title: 'Forked Lightning', desc: '+1 Storm chain jump', color: 0xffe14a, rarity: 'rare', apply: (u) => { u.stormChainBonus += 1 } },
  { id: 'burn', title: 'Wildfire', desc: '+45% burn / DoT damage', color: 0xff6a3c, rarity: 'common', apply: (u) => { u.burnDmgMult *= 1.45 } },
  { id: 'frost', title: 'Deep Chill', desc: 'Frost slows 15% harder', color: 0x4ad9ff, rarity: 'common', apply: (u) => { u.frostSlowBonus += 0.15 } },
  { id: 'cost', title: 'Efficiency', desc: '-15% tower cost', color: 0x8dff4a, rarity: 'common', apply: (u) => { u.towerCostMult *= 0.85 } },
  { id: 'gold', title: 'Prospector', desc: '+25% battle-gold', color: 0xffd54a, rarity: 'common', apply: (u) => { u.goldGainMult *= 1.25 } },
  { id: 'pen', title: 'Armor Breaker', desc: '+4 armor penetration (all)', color: 0xff9b2f, rarity: 'rare', apply: (u) => { u.armorPenBonus += 4 } },
  { id: 'firerate', title: 'Overclock', desc: '+14% fire rate', color: 0x9ad0ff, rarity: 'rare', apply: (u) => { u.fireRateMult *= 0.86 } },
  { id: 'splash', title: 'Bigger Booms', desc: '+30% splash radius', color: 0xff6a3c, rarity: 'rare', apply: (u) => { u.splashBonus += 0.3 } },
  { id: 'heal', title: 'Reinforce', desc: 'Restore 4 lives now', color: 0xff5b7a, rarity: 'common', livesDelta: 4, apply: () => {} },
  { id: 'combo', title: 'Chain Reactor', desc: 'Combos escalate 60% faster', color: 0xc06bff, rarity: 'relic', apply: (u) => { u.comboRamp *= 1.6 } },
  { id: 'glass', title: 'Glass Cannon', desc: '+45% ALL damage, -2 lives', color: 0xff3b6b, rarity: 'relic', livesDelta: -2, apply: (u) => { u.allDmg *= 1.45 } },
]
