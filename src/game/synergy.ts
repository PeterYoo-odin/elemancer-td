// Element team SYNERGY — the "heroes work together based on elements" system. Pure
// and deterministic: given the elements of the currently-FIELDED heroes, it returns
// the active synergy bonuses (named, coloured, described) and their numeric effects.
// The sim folds the effects into per-hero multipliers; the HUD renders the panel.
//
// Three families, all reachable with a 3-hero party:
//   • SAME-ELEMENT  — 2+ heroes sharing an element → +25% that element's hero damage.
//   • ELEMENT PAIR  — a named complementary duo (e.g. Fire+Storm) → a team buff.
//   • PRISM BOND    — 3 distinct elements fielded → a small all-stats aura.

import { ELEMENT_COLOR, type Element } from '../sim/combat'

export interface SynergyEffects {
  // per-element hero-damage multiplier (default 1 for absent elements)
  elementDmg: Record<Element, number>
  allDmgMult: number // multiplies every fielded hero's damage
  atkSpeedMult: number // <1 = faster hero attacks (multiplies cooldown)
  allStatMult: number // small buff to damage AND range/speed (prism)
}

export interface SynergyBonus {
  id: string
  name: string
  desc: string
  color: number
  icon: string
  members: Element[] // elements that trigger it (for on-field glow links)
}

interface PairDef {
  a: Element
  b: Element
  id: string
  name: string
  desc: string
  color: number
  icon: string
  allDmgMult?: number
  atkSpeedMult?: number
}

// Named complementary duos. Colours drawn from the two elements' hues.
const PAIRS: PairDef[] = [
  { a: 'Fire', b: 'Storm', id: 'firestorm', name: 'Firestorm', desc: '+18% hero damage', color: 0xff8a3c, icon: '🔥', allDmgMult: 1.18 },
  { a: 'Water', b: 'Storm', id: 'conduction', name: 'Conduction', desc: '+16% hero attack speed', color: 0x6fd6ff, icon: '⚡', atkSpeedMult: 0.84 },
  { a: 'Fire', b: 'Nature', id: 'wildfire', name: 'Wildfire', desc: '+16% hero damage', color: 0xbfff4a, icon: '🌋', allDmgMult: 1.16 },
  { a: 'Water', b: 'Nature', id: 'bloom', name: 'Bloom', desc: '+12% hero attack speed', color: 0x6effa0, icon: '🌊', atkSpeedMult: 0.88 },
  { a: 'Light', b: 'Dark', id: 'eclipse', name: 'Eclipse', desc: '+22% hero damage', color: 0xd6a6ff, icon: '🌓', allDmgMult: 1.22 },
  { a: 'Light', b: 'Storm', id: 'radiance', name: 'Radiance', desc: '+14% hero damage', color: 0xfff0a0, icon: '✦', allDmgMult: 1.14 },
  { a: 'Fire', b: 'Dark', id: 'brimstone', name: 'Brimstone', desc: '+20% hero damage', color: 0xff6a8a, icon: '☄', allDmgMult: 1.20 },
]

const SAME_ELEMENT_DMG = 1.25 // +25% that element's hero damage
const PRISM_STAT = 1.10 // +10% all stats for a 3-distinct-element party

export function neutralSynergy(): SynergyEffects {
  const elementDmg = {} as Record<Element, number>
  for (const e of Object.keys(ELEMENT_COLOR) as Element[]) elementDmg[e] = 1
  return { elementDmg, allDmgMult: 1, atkSpeedMult: 1, allStatMult: 1 }
}

// Compute active synergies + folded effects from the FIELDED heroes' elements.
export function computeSynergies(elements: Element[]): { bonuses: SynergyBonus[]; effects: SynergyEffects } {
  const effects = neutralSynergy()
  const bonuses: SynergyBonus[] = []
  if (elements.length === 0) return { bonuses, effects }

  // count per element
  const counts = new Map<Element, number>()
  for (const e of elements) counts.set(e, (counts.get(e) ?? 0) + 1)

  // SAME-ELEMENT (deterministic order via ELEMENT_COLOR key order)
  for (const e of Object.keys(ELEMENT_COLOR) as Element[]) {
    const n = counts.get(e) ?? 0
    if (n >= 2) {
      effects.elementDmg[e] *= SAME_ELEMENT_DMG
      bonuses.push({
        id: `same_${e}`, name: `${e} Bond`, desc: `+25% ${e} hero damage`,
        color: ELEMENT_COLOR[e], icon: '◆', members: [e],
      })
    }
  }

  // ELEMENT PAIRS
  for (const p of PAIRS) {
    if (counts.has(p.a) && counts.has(p.b)) {
      if (p.allDmgMult) effects.allDmgMult *= p.allDmgMult
      if (p.atkSpeedMult) effects.atkSpeedMult *= p.atkSpeedMult
      bonuses.push({ id: p.id, name: p.name, desc: p.desc, color: p.color, icon: p.icon, members: [p.a, p.b] })
    }
  }

  // PRISM BOND — 3+ distinct elements fielded
  if (counts.size >= 3) {
    effects.allStatMult *= PRISM_STAT
    bonuses.push({
      id: 'prism', name: 'Prism Bond', desc: '+10% all hero stats',
      color: 0xffffff, icon: '✨', members: [...counts.keys()],
    })
  }

  return { bonuses, effects }
}
