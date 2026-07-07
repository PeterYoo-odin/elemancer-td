// ELEMENT RESONANCE — the hero↔tower team bonus. A fielded, AWAKENED hero
// (level ≥ SIGNATURE_UNLOCK_LEVEL) whose resonant tower kind has 2+ towers on
// the board makes them RESONATE: those towers hit harder AND the hero does too.
// Two tiers reward committing to an element. Pure + deterministic: given the
// fielded heroes and the live tower counts, the same bonuses come out every
// time. The sim folds the multipliers in; the HUD renders the chips.

import { TOWERS, type TowerKind } from './towers'
import { heroById } from './heroes'

// tier thresholds → multipliers (towers of the kind / the resonating hero)
const TIER1_COUNT = 2
const TIER2_COUNT = 4
const TIER1_TOWER = 1.12
const TIER1_HERO = 1.15
const TIER2_TOWER = 1.18
const TIER2_HERO = 1.25

export interface ResonanceBonus {
  id: string // stable per (towerKind, tier) — the HUD keys chips on it
  towerKind: TowerKind
  towerName: string
  heroIds: string[] // awakened fielded heroes conducting this resonance
  heroNames: string[]
  color: number
  icon: string
  count: number // towers of the kind on the board
  tier: 1 | 2
  towerMult: number
  heroMult: number
  name: string
  desc: string
}

// What a hero WOULD get — for cards/tooltips before anything is fielded.
export function resonanceInfo(towerKind: TowerKind): { towerName: string; t1Tower: number; t1Hero: number; t2Tower: number; t2Hero: number; t2Count: number } {
  return {
    towerName: TOWERS[towerKind].name,
    t1Tower: TIER1_TOWER, t1Hero: TIER1_HERO,
    t2Tower: TIER2_TOWER, t2Hero: TIER2_HERO,
    t2Count: TIER2_COUNT,
  }
}

const pct = (m: number): string => `+${Math.round((m - 1) * 100)}%`

// Compute the active resonances from fielded AWAKENED heroes + live tower counts.
// Grouped by tower kind: two Fire heroes conduct ONE Flame resonance together
// (both heroes get the hero bonus; the towers are buffed once, never twice).
export function computeResonances(
  fielded: Array<{ heroId: string; awake: boolean }>,
  towerCounts: Partial<Record<TowerKind, number>>,
): ResonanceBonus[] {
  const byKind = new Map<TowerKind, string[]>()
  for (const f of fielded) {
    if (!f.awake) continue
    const def = heroById(f.heroId)
    if (!def) continue
    const list = byKind.get(def.resonantTower) ?? []
    if (!list.includes(f.heroId)) list.push(f.heroId)
    byKind.set(def.resonantTower, list)
  }
  const out: ResonanceBonus[] = []
  for (const [kind, heroIds] of byKind) {
    const count = towerCounts[kind] ?? 0
    if (count < TIER1_COUNT) continue
    const tier: 1 | 2 = count >= TIER2_COUNT ? 2 : 1
    const towerMult = tier === 2 ? TIER2_TOWER : TIER1_TOWER
    const heroMult = tier === 2 ? TIER2_HERO : TIER1_HERO
    const tdef = TOWERS[kind]
    const heroNames = heroIds.map((id) => heroById(id)?.name ?? id)
    out.push({
      id: `res_${kind}_t${tier}`,
      towerKind: kind,
      towerName: tdef.name,
      heroIds, heroNames,
      color: tdef.color,
      icon: '🔗',
      count, tier, towerMult, heroMult,
      name: `${tdef.name} Resonance${tier === 2 ? ' II' : ''}`,
      desc: `${pct(towerMult)} ${tdef.name} tower dmg · ${pct(heroMult)} hero dmg`,
    })
  }
  // deterministic order for stable HUD keys + sim iteration
  out.sort((a, b) => (a.towerKind < b.towerKind ? -1 : a.towerKind > b.towerKind ? 1 : 0))
  return out
}
