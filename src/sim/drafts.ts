// "Pick 1 of 3" power drafts (Archero / Vampire-Survivors style). Every few waves
// the sim PAUSES and offers 3 cards drawn from the run's seeded RNG. Picking one
// applies a run-wide RunUpgrades modifier (or an immediate life change). Pure and
// deterministic — the sim owns the RNG that selects the offer.

import { ELEMENT_COLOR, ELEMENT_ORDER, clamp, type Element } from './combat'
import type { RNG } from './rng'

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
  // --- roguelike relic fields (only ever moved by the ROGUE pool; identity for
  //     the Ranked pool, so the Sim's non-rogue math is numerically unchanged) ---
  reactionDmg: number // elemental-reaction burst multiplier
  reactionRadius: number // elemental-reaction AoE multiplier
  amplifyPower: number // ADDED to the AMPLIFY damage-taken bonus
  amplifyDur: number // ADDED seconds to the AMPLIFY mark
  conductJumps: number // +N CONDUCT chain targets
  goldPerReaction: number // flat battle-gold each reaction detonates
  lifePerBoss: number // lives restored per boss slain
  bossDmg: number // damage multiplier vs bosses
  curseEnemyHp: number // CURSE downside: enemy HP multiplier (>1)
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
    reactionDmg: 1,
    reactionRadius: 1,
    amplifyPower: 0,
    amplifyDur: 0,
    conductJumps: 0,
    goldPerReaction: 0,
    lifePerBoss: 0,
    bossDmg: 1,
    curseEnemyHp: 1,
  }
}

export type DraftRarity = 'common' | 'rare' | 'epic' | 'relic' | 'cursed'

export interface DraftCard {
  id: string
  title: string
  desc: string
  color: number
  rarity: DraftRarity
  livesDelta?: number // applied immediately by the sim on pick
  unique?: boolean // relics/curses: never offered twice once taken (rogue pool)
  tags?: string[] // theme tags (event draft-boosting): 'fire','reaction','gold'…
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
  // BALANCE (harness pass 18): comboRamp trimmed 1.6→1.45. The auto-tuning harness
  // flagged Tempest+Blizzard+Chain-Reactor as degenerate — on scarce early resources
  // it snowballed ~3× deeper than a balanced build by racing the 6× combo cap. A
  // smaller step slows that race without gutting the relic. See BALANCE_REPORT.md.
  { id: 'combo', title: 'Chain Reactor', desc: 'Combos escalate 45% faster', color: 0xc06bff, rarity: 'relic', apply: (u) => { u.comboRamp *= 1.45 } },
  { id: 'glass', title: 'Glass Cannon', desc: '+45% ALL damage, -2 lives', color: 0xff3b6b, rarity: 'relic', livesDelta: -2, apply: (u) => { u.allDmg *= 1.45 } },
]

// ===========================================================================
//  ROGUE DRAFT POOL — the 100+ relic / modifier / curse library for ROGUELIKE
//  endless. Separate from DRAFT_POOL above (which the Ranked ladder + campaign
//  keep using verbatim, so their seeds replay identically). Rarities are tiered;
//  `unique` relics/curses never repeat; `tags` let a seasonal event bias the roll.
//  Reaction-interacting relics are the crown jewels — they make builds go wild
//  while staying readable (every effect maps to ONE hook site in the sim).
// ===========================================================================

const C = {
  fire: 0xff6a3c, water: 0x4ad9ff, nature: 0x8dff4a, light: 0xffe14a, dark: 0xc06bff,
  storm: 0x9ad0ff, gold: 0xffd54a, arcane: 0xd6a6ff, blood: 0xff3b6b, iron: 0xc9b6ff,
}

// Tiered stat-multiplier card factory: "Overpower I / II / III" style. Bigger
// number ⇒ rarer tier, so the weighting naturally makes big jumps precious.
function tiers(
  idBase: string, title: string, descFn: (pct: number) => string, color: number,
  tags: string[], steps: Array<{ pct: number; rarity: DraftRarity }>,
  apply: (u: RunUpgrades, mult: number) => void,
): DraftCard[] {
  const roman = ['I', 'II', 'III', 'IV']
  return steps.map((s, i) => ({
    id: `${idBase}_${i + 1}`,
    title: `${title} ${roman[i] ?? i + 1}`,
    desc: descFn(s.pct),
    color, rarity: s.rarity, tags,
    apply: (u: RunUpgrades) => apply(u, 1 + s.pct / 100),
  }))
}

function addTiers(
  idBase: string, title: string, descFn: (v: number) => string, color: number,
  tags: string[], steps: Array<{ v: number; rarity: DraftRarity }>,
  apply: (u: RunUpgrades, v: number) => void,
): DraftCard[] {
  const roman = ['I', 'II', 'III', 'IV']
  return steps.map((s, i) => ({
    id: `${idBase}_${i + 1}`,
    title: `${title} ${roman[i] ?? i + 1}`,
    desc: descFn(s.v),
    color, rarity: s.rarity, tags,
    apply: (u: RunUpgrades) => apply(u, s.v),
  }))
}

const ELEM_TAG: Record<Element, string> = { Fire: 'fire', Water: 'water', Nature: 'nature', Light: 'light', Dark: 'dark', Storm: 'storm' }

// per-element focus (common) + mastery (epic)
const elementRelics: DraftCard[] = ELEMENT_ORDER.flatMap((e) => [
  { id: `rf_focus_${e}`, title: `${e} Focus`, desc: `+30% ${e} tower damage`, color: ELEMENT_COLOR[e], rarity: 'common' as DraftRarity, tags: [ELEM_TAG[e]], apply: (u: RunUpgrades) => { u.elementDmg[e] *= 1.3 } },
  { id: `rf_mastery_${e}`, title: `${e} Mastery`, desc: `+65% ${e} tower damage`, color: ELEMENT_COLOR[e], rarity: 'epic' as DraftRarity, tags: [ELEM_TAG[e]], apply: (u: RunUpgrades) => { u.elementDmg[e] *= 1.65 } },
])

export const ROGUE_DRAFT_POOL: DraftCard[] = [
  ...elementRelics,

  // --- generic power, tiered -------------------------------------------------
  ...tiers('rg_all', 'Overpower', (p) => `+${p}% ALL tower damage`, C.gold, ['damage'],
    [{ pct: 15, rarity: 'common' }, { pct: 24, rarity: 'rare' }, { pct: 36, rarity: 'epic' }, { pct: 55, rarity: 'relic' }],
    (u, m) => { u.allDmg *= m }),
  ...tiers('rg_burn', 'Wildfire', (p) => `+${p}% burn / DoT damage`, C.fire, ['fire', 'burn'],
    [{ pct: 40, rarity: 'common' }, { pct: 70, rarity: 'rare' }, { pct: 120, rarity: 'epic' }],
    (u, m) => { u.burnDmgMult *= m }),
  ...tiers('rg_splash', 'Bigger Booms', (p) => `+${p}% splash radius`, C.fire, ['splash'],
    [{ pct: 25, rarity: 'common' }, { pct: 45, rarity: 'rare' }, { pct: 75, rarity: 'epic' }],
    (u, m) => { u.splashBonus += (m - 1) }),
  ...tiers('rg_gold', 'Prospector', (p) => `+${p}% battle-gold`, C.gold, ['gold'],
    [{ pct: 25, rarity: 'common' }, { pct: 45, rarity: 'rare' }, { pct: 80, rarity: 'epic' }],
    (u, m) => { u.goldGainMult *= m }),

  // fire rate (multiplier < 1 = faster), tiered
  ...addTiers('rg_rate', 'Overclock', (v) => `+${Math.round((1 / v - 1) * 100)}% fire rate`, 0x9ad0ff, ['rate'],
    [{ v: 0.88, rarity: 'common' }, { v: 0.8, rarity: 'rare' }, { v: 0.7, rarity: 'epic' }],
    (u, v) => { u.fireRateMult *= v }),
  // cheaper towers, tiered
  ...addTiers('rg_cost', 'Efficiency', (v) => `-${Math.round((1 - v) * 100)}% tower cost`, C.nature, ['economy'],
    [{ v: 0.88, rarity: 'common' }, { v: 0.78, rarity: 'rare' }, { v: 0.66, rarity: 'epic' }],
    (u, v) => { u.towerCostMult *= v }),
  // armor pen, tiered (flat add)
  ...addTiers('rg_pen', 'Armor Breaker', (v) => `+${v} armor penetration (all)`, 0xff9b2f, ['pierce'],
    [{ v: 3, rarity: 'common' }, { v: 6, rarity: 'rare' }, { v: 10, rarity: 'epic' }],
    (u, v) => { u.armorPenBonus += v }),
  // storm chains, tiered
  ...addTiers('rg_chain', 'Forked Lightning', (v) => `+${v} Storm chain jump${v > 1 ? 's' : ''}`, C.storm, ['storm', 'chain'],
    [{ v: 1, rarity: 'rare' }, { v: 2, rarity: 'epic' }, { v: 3, rarity: 'relic' }],
    (u, v) => { u.stormChainBonus += v }),
  // frost bite, tiered
  ...addTiers('rg_frost', 'Deep Chill', (v) => `Frost slows ${Math.round(v * 100)}% harder`, C.water, ['water', 'slow'],
    [{ v: 0.15, rarity: 'common' }, { v: 0.28, rarity: 'rare' }, { v: 0.4, rarity: 'epic' }],
    (u, v) => { u.frostSlowBonus += v }),

  // --- REACTION relics (the crown jewels) -----------------------------------
  ...tiers('rr_react', 'Catalyst', (p) => `Reactions detonate +${p}% harder`, C.arcane, ['reaction'],
    [{ pct: 30, rarity: 'rare' }, { pct: 55, rarity: 'epic' }, { pct: 90, rarity: 'relic' }],
    (u, m) => { u.reactionDmg *= m }),
  ...tiers('rr_radius', 'Wide Detonation', (p) => `+${p}% reaction blast radius`, C.arcane, ['reaction'],
    [{ pct: 30, rarity: 'rare' }, { pct: 60, rarity: 'epic' }],
    (u, m) => { u.reactionRadius *= m }),
  { id: 'rr_conduct1', title: 'Live Wire', desc: 'CONDUCT arcs to +2 extra targets', color: C.storm, rarity: 'epic', tags: ['reaction', 'storm', 'chain'], apply: (u) => { u.conductJumps += 2 } },
  { id: 'rr_conduct2', title: 'Tesla Coil', desc: 'CONDUCT arcs to +4 extra targets', color: C.storm, rarity: 'relic', unique: true, tags: ['reaction', 'storm', 'chain'], apply: (u) => { u.conductJumps += 4 } },
  { id: 'rr_amp1', title: 'Prism Lens', desc: 'AMPLIFY-marked foes take +25% more', color: C.arcane, rarity: 'epic', tags: ['reaction', 'arcane'], apply: (u) => { u.amplifyPower += 0.25 } },
  { id: 'rr_amp2', title: 'Refraction Core', desc: 'AMPLIFY: +45% damage & +2s duration', color: C.arcane, rarity: 'relic', unique: true, tags: ['reaction', 'arcane'], apply: (u) => { u.amplifyPower += 0.45; u.amplifyDur += 2 } },
  { id: 'rr_ampdur', title: 'Lingering Mark', desc: 'AMPLIFY marks linger +3s', color: C.arcane, rarity: 'rare', tags: ['reaction', 'arcane'], apply: (u) => { u.amplifyDur += 3 } },
  { id: 'rr_goldreact1', title: 'Alchemist', desc: 'Each reaction mints +3 gold', color: C.gold, rarity: 'rare', tags: ['reaction', 'gold'], apply: (u) => { u.goldPerReaction += 3 } },
  { id: 'rr_goldreact2', title: 'Transmuter', desc: 'Each reaction mints +7 gold', color: C.gold, rarity: 'epic', tags: ['reaction', 'gold'], apply: (u) => { u.goldPerReaction += 7 } },
  { id: 'rr_combo1', title: 'Chain Reactor', desc: 'Combos escalate 45% faster', color: C.dark, rarity: 'relic', unique: true, tags: ['reaction', 'combo'], apply: (u) => { u.comboRamp *= 1.45 } },
  { id: 'rr_combo2', title: 'Resonance Cascade', desc: 'Combos escalate 30% faster', color: C.dark, rarity: 'epic', tags: ['reaction', 'combo'], apply: (u) => { u.comboRamp *= 1.3 } },

  // --- boss / anti-elite relics ---------------------------------------------
  { id: 'rb_boss1', title: 'Giant Slayer', desc: '+40% damage to bosses', color: C.blood, rarity: 'rare', tags: ['boss'], apply: (u) => { u.bossDmg *= 1.4 } },
  { id: 'rb_boss2', title: 'Titan Ender', desc: '+80% damage to bosses', color: C.blood, rarity: 'epic', tags: ['boss'], apply: (u) => { u.bossDmg *= 1.8 } },
  { id: 'rb_life1', title: 'Reliquary', desc: 'Restore 1 life per boss slain', color: 0xff5b7a, rarity: 'epic', unique: true, tags: ['boss', 'sustain'], apply: (u) => { u.lifePerBoss += 1 } },
  { id: 'rb_life2', title: 'Phoenix Heart', desc: 'Restore 2 lives per boss slain', color: 0xff5b7a, rarity: 'relic', unique: true, tags: ['boss', 'sustain'], apply: (u) => { u.lifePerBoss += 2 } },

  // --- immediate life / utility ---------------------------------------------
  { id: 'ru_heal1', title: 'Reinforce', desc: 'Restore 4 lives now', color: 0xff5b7a, rarity: 'common', tags: ['sustain'], livesDelta: 4, apply: () => {} },
  { id: 'ru_heal2', title: 'Bulwark Repair', desc: 'Restore 8 lives now', color: 0xff5b7a, rarity: 'rare', tags: ['sustain'], livesDelta: 8, apply: () => {} },
  { id: 'ru_windfall', title: 'Windfall', desc: '+40% gold & +25% burn', color: C.gold, rarity: 'rare', tags: ['gold', 'fire'], apply: (u) => { u.goldGainMult *= 1.4; u.burnDmgMult *= 1.25 } },
  { id: 'ru_artillery', title: 'Artillery Doctrine', desc: '+35% splash & +4 pen', color: 0xff9b2f, rarity: 'epic', tags: ['splash', 'pierce'], apply: (u) => { u.splashBonus += 0.35; u.armorPenBonus += 4 } },
  { id: 'ru_tempest', title: 'Tempest', desc: '+2 chains, +20% Storm', color: C.storm, rarity: 'epic', tags: ['storm', 'chain'], apply: (u) => { u.stormChainBonus += 2; u.elementDmg.Storm *= 1.2 } },

  // --- CURSES-WITH-UPSIDE (a real cost, a bigger payoff; deterministic) ------
  { id: 'cz_glass1', title: 'Glass Cannon', desc: '+45% ALL damage · −2 lives', color: C.blood, rarity: 'relic', unique: true, tags: ['damage', 'curse'], livesDelta: -2, apply: (u) => { u.allDmg *= 1.45 } },
  { id: 'cz_glass2', title: 'Diamond Edge', desc: '+80% ALL damage · −4 lives', color: C.blood, rarity: 'relic', unique: true, tags: ['damage', 'curse'], livesDelta: -4, apply: (u) => { u.allDmg *= 1.8 } },
  { id: 'cz_bloodpact', title: 'Blood Pact', desc: '+60% damage · foes +25% HP', color: C.blood, rarity: 'epic', unique: true, tags: ['damage', 'curse'], apply: (u) => { u.allDmg *= 1.6; u.curseEnemyHp *= 1.25 } },
  { id: 'cz_pyromania', title: 'Pyromania', desc: '×2.2 burn · foes +20% HP', color: C.fire, rarity: 'epic', unique: true, tags: ['fire', 'burn', 'curse'], apply: (u) => { u.burnDmgMult *= 2.2; u.curseEnemyHp *= 1.2 } },
  { id: 'cz_overload', title: 'Overload', desc: '×2 reactions · foes +30% HP', color: C.arcane, rarity: 'relic', unique: true, tags: ['reaction', 'curse'], apply: (u) => { u.reactionDmg *= 2; u.curseEnemyHp *= 1.3 } },
  { id: 'cz_greed', title: 'Cursed Hoard', desc: '×2 gold · −3 lives', color: C.gold, rarity: 'epic', unique: true, tags: ['gold', 'curse'], livesDelta: -3, apply: (u) => { u.goldGainMult *= 2 } },
  { id: 'cz_frenzy', title: 'Berserker Frenzy', desc: '+30% fire rate · foes +18% HP', color: 0xff9b2f, rarity: 'epic', unique: true, tags: ['rate', 'curse'], apply: (u) => { u.fireRateMult *= 0.7; u.curseEnemyHp *= 1.18 } },
  { id: 'cz_sacrifice', title: 'Sacrificial Rite', desc: '×1.6 combo ramp · −3 lives', color: C.dark, rarity: 'relic', unique: true, tags: ['combo', 'curse'], livesDelta: -3, apply: (u) => { u.comboRamp *= 1.6 } },
  { id: 'cz_hexblade', title: 'Hexblade Pact', desc: '×1.5 reactions · −2 lives', color: C.arcane, rarity: 'epic', unique: true, tags: ['reaction', 'curse'], livesDelta: -2, apply: (u) => { u.reactionDmg *= 1.5 } },
  { id: 'cz_famine', title: 'Feast of Ash', desc: '+55% ALL damage · −30% gold', color: C.blood, rarity: 'epic', unique: true, tags: ['damage', 'curse'], apply: (u) => { u.allDmg *= 1.55; u.goldGainMult *= 0.7 } },
  { id: 'cz_brittle', title: 'Brittle Bones', desc: '+10 pen, +30% all · foes +40% HP', color: 0xff9b2f, rarity: 'epic', unique: true, tags: ['pierce', 'curse'], apply: (u) => { u.armorPenBonus += 10; u.allDmg *= 1.3; u.curseEnemyHp *= 1.4 } },
  { id: 'cz_timedebt', title: 'Time Debt', desc: '+30% fire rate, +2 chains · −2 lives', color: C.storm, rarity: 'relic', unique: true, tags: ['rate', 'storm', 'curse'], livesDelta: -2, apply: (u) => { u.fireRateMult *= 0.7; u.stormChainBonus += 2 } },
  { id: 'cz_martyr', title: "Martyr's Boon", desc: '+2 lives per boss · foes +25% HP', color: 0xff5b7a, rarity: 'relic', unique: true, tags: ['boss', 'sustain', 'curse'], apply: (u) => { u.lifePerBoss += 2; u.curseEnemyHp *= 1.25 } },

  // --- REACTION-PAIR ADEPTS: buff the TWO elements that fuel a named reaction ---
  { id: 'rp_thermal', title: 'Thermal Adept', desc: '+35% Fire & Water (THERMAL SHOCK)', color: 0xffb15c, rarity: 'rare', tags: ['reaction', 'fire', 'water'], apply: (u) => { u.elementDmg.Fire *= 1.35; u.elementDmg.Water *= 1.35 } },
  { id: 'rp_shatter', title: 'Shatter Adept', desc: '+35% Water & Storm (SHATTER)', color: 0x9fdcff, rarity: 'rare', tags: ['reaction', 'water', 'storm'], apply: (u) => { u.elementDmg.Water *= 1.35; u.elementDmg.Storm *= 1.35 } },
  { id: 'rp_flashover', title: 'Flashover Adept', desc: '+35% Fire & Storm (FLASHOVER)', color: 0xff6a3c, rarity: 'rare', tags: ['reaction', 'fire', 'storm'], apply: (u) => { u.elementDmg.Fire *= 1.35; u.elementDmg.Storm *= 1.35 } },
  { id: 'rp_wildfire', title: 'Wildfire Adept', desc: '+35% Fire & Nature (WILDFIRE)', color: 0xff8a3c, rarity: 'rare', tags: ['reaction', 'fire', 'nature'], apply: (u) => { u.elementDmg.Fire *= 1.35; u.elementDmg.Nature *= 1.35 } },
  { id: 'rp_overgrow', title: 'Overgrow Adept', desc: '+35% Water & Nature (OVERGROW)', color: 0x8dff4a, rarity: 'rare', tags: ['reaction', 'water', 'nature'], apply: (u) => { u.elementDmg.Water *= 1.35; u.elementDmg.Nature *= 1.35 } },
  { id: 'rp_eclipse', title: 'Eclipse Adept', desc: '+35% Light & Dark (ECLIPSE)', color: 0xffe14a, rarity: 'rare', tags: ['reaction', 'light', 'dark'], apply: (u) => { u.elementDmg.Light *= 1.35; u.elementDmg.Dark *= 1.35 } },
  { id: 'rp_conduct', title: 'Conduct Adept', desc: '+35% Light & Storm (CONDUCT)', color: 0x9ad0ff, rarity: 'rare', tags: ['reaction', 'light', 'storm'], apply: (u) => { u.elementDmg.Light *= 1.35; u.elementDmg.Storm *= 1.35 } },
  { id: 'rp_blight', title: 'Blight Adept', desc: '+35% Nature & Dark (BLIGHT)', color: 0xa4ff6a, rarity: 'rare', tags: ['reaction', 'nature', 'dark'], apply: (u) => { u.elementDmg.Nature *= 1.35; u.elementDmg.Dark *= 1.35 } },

  // --- ELEMENT APEX (relic): a single element ascends -------------------------
  { id: 'ea_fire', title: 'Fire Apex', desc: '+110% Fire tower damage', color: 0xff6a3c, rarity: 'relic', unique: true, tags: ['fire'], apply: (u) => { u.elementDmg.Fire *= 2.1 } },
  { id: 'ea_water', title: 'Water Apex', desc: '+110% Water tower damage', color: 0x4ad9ff, rarity: 'relic', unique: true, tags: ['water'], apply: (u) => { u.elementDmg.Water *= 2.1 } },
  { id: 'ea_nature', title: 'Nature Apex', desc: '+110% Nature tower damage', color: 0x8dff4a, rarity: 'relic', unique: true, tags: ['nature'], apply: (u) => { u.elementDmg.Nature *= 2.1 } },
  { id: 'ea_light', title: 'Light Apex', desc: '+110% Light tower damage', color: 0xffe14a, rarity: 'relic', unique: true, tags: ['light'], apply: (u) => { u.elementDmg.Light *= 2.1 } },
  { id: 'ea_dark', title: 'Dark Apex', desc: '+110% Dark tower damage', color: 0xc06bff, rarity: 'relic', unique: true, tags: ['dark'], apply: (u) => { u.elementDmg.Dark *= 2.1 } },
  { id: 'ea_storm', title: 'Storm Apex', desc: '+110% Storm tower damage', color: 0x9ad0ff, rarity: 'relic', unique: true, tags: ['storm'], apply: (u) => { u.elementDmg.Storm *= 2.1 } },

  // --- more utility bundles ---------------------------------------------------
  { id: 'ru_cryo', title: 'Cryomancer', desc: 'Frost +25% harder, +30% Water', color: 0x4ad9ff, rarity: 'rare', tags: ['water', 'slow'], apply: (u) => { u.frostSlowBonus += 0.25; u.elementDmg.Water *= 1.3 } },
  { id: 'ru_pyre', title: 'Pyre Keeper', desc: '+60% burn, +25% Fire', color: 0xff6a3c, rarity: 'rare', tags: ['fire', 'burn'], apply: (u) => { u.burnDmgMult *= 1.6; u.elementDmg.Fire *= 1.25 } },
  { id: 'ru_invest', title: 'Investment', desc: '−20% cost, +30% gold', color: 0x8dff4a, rarity: 'rare', tags: ['economy', 'gold'], apply: (u) => { u.towerCostMult *= 0.8; u.goldGainMult *= 1.3 } },
  { id: 'ru_sniper', title: 'Marksman', desc: '+8 pen, +25% ALL damage', color: 0xff9b2f, rarity: 'epic', tags: ['pierce', 'damage'], apply: (u) => { u.armorPenBonus += 8; u.allDmg *= 1.25 } },
  { id: 'ru_stormcaller', title: 'Stormcaller', desc: '+2 chains, +30% Storm', color: 0x9ad0ff, rarity: 'epic', tags: ['storm', 'chain'], apply: (u) => { u.stormChainBonus += 2; u.elementDmg.Storm *= 1.3 } },
  { id: 'ru_warlord', title: 'Warlord', desc: '+22% damage, +18% fire rate', color: 0xffd54a, rarity: 'epic', tags: ['damage', 'rate'], apply: (u) => { u.allDmg *= 1.22; u.fireRateMult *= 0.82 } },
  { id: 'ru_detonator', title: 'Detonator', desc: '+50% reactions, +20% splash', color: 0xd6a6ff, rarity: 'epic', tags: ['reaction', 'splash'], apply: (u) => { u.reactionDmg *= 1.5; u.splashBonus += 0.2 } },
  { id: 'ru_bulwark', title: 'Aegis Fund', desc: 'Restore 6 lives, +15% gold', color: 0xff5b7a, rarity: 'rare', tags: ['sustain', 'gold'], livesDelta: 6, apply: (u) => { u.goldGainMult *= 1.15 } },
  { id: 'rr_react4', title: 'Grand Catalyst', desc: 'Reactions detonate +130% harder', color: 0xd6a6ff, rarity: 'relic', unique: true, tags: ['reaction'], apply: (u) => { u.reactionDmg *= 2.3 } },
  { id: 'rr_radius3', title: 'Cataclysm', desc: '+95% reaction blast radius', color: 0xd6a6ff, rarity: 'relic', unique: true, tags: ['reaction'], apply: (u) => { u.reactionRadius *= 1.95 } },

  // --- CURSED rarity: the wildest all-in gambles (steep cost, run-defining) ---
  { id: 'cx_lichking', title: 'Lich Crown', desc: '×2.4 reactions, +2 lives/boss · foes +45% HP', color: 0x8a4aff, rarity: 'cursed', unique: true, tags: ['reaction', 'boss', 'curse'], apply: (u) => { u.reactionDmg *= 2.4; u.lifePerBoss += 2; u.curseEnemyHp *= 1.45 } },
  { id: 'cx_apocalypse', title: 'Apocalypse Engine', desc: '×2 ALL damage · −5 lives', color: 0xff3b6b, rarity: 'cursed', unique: true, tags: ['damage', 'curse'], livesDelta: -5, apply: (u) => { u.allDmg *= 2 } },
  { id: 'cx_inferno', title: 'Living Inferno', desc: '×3 burn, +40% Fire · foes +30% HP', color: 0xff6a3c, rarity: 'cursed', unique: true, tags: ['fire', 'burn', 'curse'], apply: (u) => { u.burnDmgMult *= 3; u.elementDmg.Fire *= 1.4; u.curseEnemyHp *= 1.3 } },
  { id: 'cx_midas', title: 'Midas Curse', desc: '×2.5 gold · −4 lives', color: 0xffd54a, rarity: 'cursed', unique: true, tags: ['gold', 'curse'], livesDelta: -4, apply: (u) => { u.goldGainMult *= 2.5 } },
  { id: 'cx_singularity', title: 'Singularity', desc: '×1.8 combo ramp, ×1.5 reactions · −4 lives', color: 0xc06bff, rarity: 'cursed', unique: true, tags: ['combo', 'reaction', 'curse'], livesDelta: -4, apply: (u) => { u.comboRamp *= 1.8; u.reactionDmg *= 1.5 } },
  { id: 'cx_juggernaut', title: 'Juggernaut Doctrine', desc: '+120% boss damage, +12 pen · foes +25% HP', color: 0xc9b6ff, rarity: 'cursed', unique: true, tags: ['boss', 'pierce', 'curse'], apply: (u) => { u.bossDmg *= 2.2; u.armorPenBonus += 12; u.curseEnemyHp *= 1.25 } },
]

// ---------------------------------------------------------------------------
//  DETERMINISTIC WEIGHTED ROLL — pick-1-of-N from the rogue pool. Rarity weights
//  shift toward epic/relic deeper into a run; `unique` cards already taken are
//  excluded; event `boostTags` multiply matching cards' odds. Draws only from the
//  caller's rogue RNG stream so the run replays bit-identically.
// ---------------------------------------------------------------------------
const RARITY_BASE: Record<DraftRarity, number> = { common: 100, rare: 46, epic: 20, relic: 8, cursed: 16 }

function rarityWeight(r: DraftRarity, waveIdx: number): number {
  const depth = clamp(waveIdx / 40, 0, 1)
  const skew: Record<DraftRarity, number> = {
    common: 1 - 0.45 * depth,
    rare: 1,
    epic: 1 + 1.3 * depth,
    relic: 1 + 2.6 * depth,
    cursed: 1 + 0.5 * depth,
  }
  return Math.max(0.01, RARITY_BASE[r] * skew[r])
}

export function rollRogueDraft(
  rng: RNG, takenIds: ReadonlySet<string>, waveIdx: number, boostTags: readonly string[], count: number,
): DraftCard[] {
  const pool = ROGUE_DRAFT_POOL.filter((c) => !(c.unique && takenIds.has(c.id)))
  const picks: DraftCard[] = []
  const n = Math.max(1, Math.min(count, pool.length))
  for (let k = 0; k < n && pool.length > 0; k++) {
    let total = 0
    const w = new Array<number>(pool.length)
    for (let i = 0; i < pool.length; i++) {
      let ww = rarityWeight(pool[i].rarity, waveIdx)
      if (boostTags.length && pool[i].tags && pool[i].tags!.some((t) => boostTags.includes(t))) ww *= 2.5
      w[i] = ww
      total += ww
    }
    let r = rng.next() * total
    let idx = 0
    for (; idx < pool.length; idx++) {
      r -= w[idx]
      if (r <= 0) break
    }
    idx = Math.min(idx, pool.length - 1)
    picks.push(pool[idx])
    pool.splice(idx, 1)
  }
  return picks
}
