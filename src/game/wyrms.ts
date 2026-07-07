// ============================================================================
//  THE CHROMATIC WYRMS — dragon companions + the hero↔dragon BOND.
//  Canon: chromancer-dragons-design.md ("The Waking of the Wyrms").
//
//  Before the Greying, six great Wyrms were the living founts of colour in
//  Aetheria — one per realm/element. When Morose spread the grey they went
//  DORMANT. As the heroes restore realms they wake a Wyrm and a hero can BOND
//  with it: it flies with the hero, breathes its element (feeding the reaction
//  system), auras the hero + same-element towers, and amplifies the hero.
//
//  This file is PURE DATA + deterministic resolvers — no Phaser, no sim state,
//  no RNG. The sim (companion breath/aura), the Bond UI, and the codex all read
//  the SAME numbers via resolveBond(), so a bond's power is identical everywhere
//  and every value is shown in tooltips (no mystery stats).
//
//  BOND is TIERED (the "combining certain characters with dragons makes them
//  stronger" hook): every hero can bond ANY Wyrm, at PERFECT > GOOD > REGULAR.
//  Fizz (arcane) uses the special PRISM BOND: GOOD with all six + free swaps.
//
//  FAIRNESS (constitution): bonds/Wyrms are EARNED through play and RANKED
//  NORMALIZES them (rankedWyrmLevel) — no paid power. Only cosmetic skins sell.
// ============================================================================

import type { AuraElement } from '../sim/reactions'
import { clamp, ELEMENT_COLOR, type Element } from '../sim/combat'

export type WyrmId = 'pyrax' | 'glaciaxis' | 'voltaryx' | 'verdwyrm' | 'lumenwyrm' | 'umbrawyrm'
export type BondTier = 'perfect' | 'good' | 'regular'
export type WyrmStage = 'hatchling' | 'juvenile' | 'adult'
// deterministic on-breath status by element (the "fused" bite GOOD/PERFECT add)
export type BreathStatus = '' | 'burn' | 'slow' | 'poison' | 'stun' | 'tear'

export interface WyrmDef {
  id: WyrmId
  name: string
  title: string
  element: Element // combat-wheel element (drives breath aura + reactions)
  emoji: string
  glyph: string
  color: number
  accent: number
  realmId: string // the realm whose restoration wakes it
  file: string // painted billboard sprite (public/concepts/dragons/*)
  breathName: string
  status: BreathStatus // element bite added at GOOD+ tiers
  blurb: string // codex one-liner
  waking: string // the "Waking of the Wyrms" beat for this realm's Wyrm
}

const DARK = (c: number): number => {
  const r = (c >> 16) & 0xff, g = (c >> 8) & 0xff, b = c & 0xff
  return ((r * 0.34) << 16) | ((g * 0.34) << 8) | (b * 0.34)
}

// The six Wyrms, one per realm/element. Elements map to the combat wheel:
// Ice→Water, Lightning→Storm, Void→Dark (the wheel has no Ice/Lightning/Void tag).
export const WYRMS: Record<WyrmId, WyrmDef> = {
  pyrax: {
    id: 'pyrax', name: 'Pyrax', title: 'the First Ember', element: 'Fire', emoji: '🔥', glyph: '🐲',
    color: ELEMENT_COLOR.Fire, accent: DARK(ELEMENT_COLOR.Fire), realmId: 'emberwaste', file: '1-pyrax-fire.png',
    breathName: 'Emberbreath', status: 'burn',
    blurb: 'The fire-soul of Emberwaste. Curled around Kindlekeep\'s last coal, waiting for someone brave enough to be warm.',
    waking: 'Under the cold forges, a coal remembers how to blaze. Pyrax uncoils — and the sky over Emberwaste catches light again.',
  },
  glaciaxis: {
    id: 'glaciaxis', name: 'Glaciaxis', title: 'the Deep Frost', element: 'Water', emoji: '❄️', glyph: '🐉',
    color: ELEMENT_COLOR.Water, accent: DARK(ELEMENT_COLOR.Water), realmId: 'frostreach', file: '2-glaciaxis-ice.png',
    breathName: 'Rimebreath', status: 'slow',
    blurb: 'The ice-soul of Frostreach. It dreamed the Greying too, and chose to sleep until the aurora could sing again.',
    waking: 'The frozen aurora cracks like a held breath let go. Glaciaxis wakes, and Frostreach glitters instead of apologising.',
  },
  voltaryx: {
    id: 'voltaryx', name: 'Voltaryx', title: 'the Sky\'s Verdict', element: 'Storm', emoji: '⚡', glyph: '🐲',
    color: ELEMENT_COLOR.Storm, accent: DARK(ELEMENT_COLOR.Storm), realmId: 'stormpeaks', file: '3-voltaryx-lightning.png',
    breathName: 'Stormbreath', status: 'stun',
    blurb: 'The storm-soul of Stormpeaks. The dead calm nearly drank it dry; it kept one spark, and one spark is enough.',
    waking: 'Thunder that forgot its own name finds it again. Voltaryx climbs the dead-calm sky and the Stormpeaks roar awake.',
  },
  verdwyrm: {
    id: 'verdwyrm', name: 'Verdwyrm', title: 'the Green Patience', element: 'Nature', emoji: '🌿', glyph: '🐉',
    color: ELEMENT_COLOR.Nature, accent: DARK(ELEMENT_COLOR.Nature), realmId: 'verdant', file: '4-verdwyrm-nature.png',
    breathName: 'Bloombreath', status: 'poison',
    blurb: 'The green-soul of the Verdant Wilds. It held one seed of colour for a hundred grey years. It is very good at waiting.',
    waking: 'A single seed keeps its promise. Verdwyrm unfurls from the oldest root and the Wilds exhale a hundred years of held green.',
  },
  lumenwyrm: {
    id: 'lumenwyrm', name: 'Lumenwyrm', title: 'the Kept Dawn', element: 'Light', emoji: '✨', glyph: '🐲',
    color: ELEMENT_COLOR.Light, accent: DARK(ELEMENT_COLOR.Light), realmId: 'lumen', file: '5-lumenwyrm-light.png',
    breathName: 'Dawnbreath', status: 'tear',
    blurb: 'The light-soul of Lumen Sanctum. It guttered but never went out — light that refused, gently, to give up.',
    waking: 'The last lantern of Aetheria flares white. Lumenwyrm rises over Lumen Sanctum: dawn is not the absence of night, it is what night is for.',
  },
  umbrawyrm: {
    id: 'umbrawyrm', name: 'Umbrawyrm', title: 'the Rested Colour', element: 'Dark', emoji: '🕳️', glyph: '🐉',
    color: ELEMENT_COLOR.Dark, accent: DARK(ELEMENT_COLOR.Dark), realmId: 'hollow', file: '6-umbrawyrm-void.png',
    breathName: 'Umbrabreath', status: 'slow',
    blurb: 'The shadow-soul of the Hollow — nearest of all to the grey, and proof shadow is not its absence. Shadow is where colour rests.',
    waking: 'In the Hollow, the dark opens one patient eye. Umbrawyrm wakes — not the Greying\'s kin, but every colour, resting, ready to fly.',
  },
}

export const WYRM_ORDER: WyrmId[] = ['pyrax', 'glaciaxis', 'voltaryx', 'verdwyrm', 'lumenwyrm', 'umbrawyrm']

export function wyrmById(id: string): WyrmDef | null {
  return (WYRMS as Record<string, WyrmDef>)[id] ?? null
}

// realm → its Wyrm (the realm's restoration wakes this Wyrm).
export const REALM_WYRM: Record<string, WyrmId> = {
  emberwaste: 'pyrax', frostreach: 'glaciaxis', stormpeaks: 'voltaryx',
  verdant: 'verdwyrm', lumen: 'lumenwyrm', hollow: 'umbrawyrm',
}
// realm → the level id whose clear counts the realm "restored" (its Keeper finale).
export const REALM_FINALE: Record<string, string> = {
  emberwaste: 'w0_finale', frostreach: 'l2', stormpeaks: 'l3', verdant: 'l4', lumen: 'l5', hollow: 'l6',
}
// The late-act gate: the Wyrms wake once this many realms are restored.
export const WYRM_ACT_REALMS = 4

// ---------------------------------------------------------------------------
//  GROWTH — hatchling → juvenile → adult, earned through play. Level drives a
//  stronger breath + wider aura (the "level up and work together" idea). Pure.
// ---------------------------------------------------------------------------
export const WYRM_MAX_LEVEL = 12
// RANKED normalizes every bonded Wyrm to THIS level (no grind/purchase power).
export const RANKED_WYRM_LEVEL = 6

export function clampWyrmLevel(level: number): number {
  return Math.max(1, Math.min(WYRM_MAX_LEVEL, Math.floor(Number.isFinite(level) ? level : 1)))
}
export function wyrmStage(level: number): WyrmStage {
  const l = clampWyrmLevel(level)
  return l >= 8 ? 'adult' : l >= 4 ? 'juvenile' : 'hatchling'
}
export const STAGE_LABEL: Record<WyrmStage, string> = { hatchling: 'Hatchling', juvenile: 'Juvenile', adult: 'Adult' }
const STAGE_MULT: Record<WyrmStage, number> = { hatchling: 1, juvenile: 1.5, adult: 2.2 }
const STAGE_RADIUS: Record<WyrmStage, number> = { hatchling: 0, juvenile: 0.3, adult: 0.6 }

// XP to advance FROM level to level+1 (earned by fielding the bonded hero).
export function wyrmXpForLevel(level: number): number {
  const l = clampWyrmLevel(level)
  if (l >= WYRM_MAX_LEVEL) return Infinity
  return Math.round(80 + l * 55 + l * l * 7)
}

// ---------------------------------------------------------------------------
//  THE BOND MATRIX (handpicked, owner call 2026-07-07). Not rigid 1:1: each
//  hero has ONE perfect + one/two good; everything unlisted is REGULAR. Keys are
//  the ACTUAL hero ids in code (ember=Ashka, glacia=Lumi, zephyra=Galea,
//  sylvan=Thornwick, aurelia=Seraphine, vex=Nyx, volt=Fizz, pyra=Bramble&Bloom).
// ---------------------------------------------------------------------------
interface BondMatrixEntry {
  perfect?: WyrmId
  good?: WyrmId[]
  prism?: boolean // Fizz: GOOD with ALL six + free mid-run swap (no single Perfect)
}
export const BOND_MATRIX: Record<string, BondMatrixEntry> = {
  ember: { perfect: 'pyrax', good: ['voltaryx'] }, // Ashka 🔥
  glacia: { perfect: 'glaciaxis', good: ['lumenwyrm'] }, // Lumi ❄️
  zephyra: { perfect: 'voltaryx', good: ['glaciaxis'] }, // Galea ⚡
  sylvan: { perfect: 'verdwyrm', good: ['pyrax'] }, // Thornwick 🌿 (Pyrax = risk/reward wildfire)
  aurelia: { perfect: 'lumenwyrm', good: ['umbrawyrm'] }, // Seraphine ✨ (Umbrawyrm = eclipse foils ★)
  vex: { perfect: 'umbrawyrm', good: ['voltaryx'] }, // Nyx 🌑 (Umbrawyrm = redemption ★★)
  pyra: { perfect: 'pyrax', good: ['verdwyrm'] }, // Bramble & Bloom (Fire by data)
  volt: { prism: true }, // Fizz ⚗ — PRISM BOND
}

// The bond tier for a (hero, wyrm) pair. EVERY pair is legal — off-matrix = regular.
export function bondTier(heroId: string, wyrmId: string): BondTier {
  const m = BOND_MATRIX[heroId]
  if (!m) return 'regular'
  if (m.prism) return 'good' // Fizz is GOOD with all six
  if (m.perfect === wyrmId) return 'perfect'
  if (m.good && m.good.includes(wyrmId as WyrmId)) return 'good'
  return 'regular'
}
export function isPrismHero(heroId: string): boolean {
  return BOND_MATRIX[heroId]?.prism === true
}

export const TIER_LABEL: Record<BondTier, string> = { perfect: 'Attunement', good: 'Harmony', regular: 'Bonded' }
const TIER_BREATH: Record<BondTier, number> = { perfect: 1.7, good: 1.3, regular: 1 }
const TIER_HEROAMP: Record<BondTier, number> = { perfect: 1.2, good: 1.12, regular: 1.06 }
const TIER_TOWER: Record<BondTier, number> = { perfect: 0.14, good: 0.09, regular: 0.05 }
const TIER_CD: Record<BondTier, number> = { perfect: 3.4, good: 3.7, regular: 4.2 }
const TIER_RADIUS: Record<BondTier, number> = { perfect: 0.3, good: 0.15, regular: 0 }

// NARRATIVE-CHARGED pairs — named fused ultimates (PERFECT) or named foils (GOOD)
// + a small story beat, per the design's destined pairs.
interface NamedBond {
  name: string // the fused-ultimate / foil callout
  blurb: string // what it does, plainly
  story: string // the small beat
}
export const NAMED_BONDS: Record<string, NamedBond> = {
  'ember:pyrax': { name: 'Emberbond', blurb: 'Ashka and the First Ember burn as one — a searing nova of living fire.', story: 'Two foundlings of the fire. Neither was ever really cold; they just needed something warm to stand next to.' },
  'glacia:glaciaxis': { name: 'Deepfrost', blurb: 'Lumi reads the Deep Ice and Glaciaxis makes it true — the whole field stills.', story: 'The oracle and the dragon dreamed the same grey future. Together they choose a different one.' },
  'zephyra:voltaryx': { name: 'Tempest', blurb: 'Galea calls the wager and Voltaryx pays it — a sky-splitting storm answers.', story: '"Wind\'s up, sails full — and now the sky bets WITH me." The captain finally has a crew that cannot vanish.' },
  'sylvan:verdwyrm': { name: 'Wildheart', blurb: 'Thornwick and Verdwyrm let the Wilds run wild — roots and rot erupt at once.', story: 'Two of the oldest patient things in Aetheria. They lost the same tree once. They plant this one together.' },
  'aurelia:lumenwyrm': { name: 'Dawnbond', blurb: 'Seraphine and Lumenwyrm break the dark — a dawn nobody can halo into inaction.', story: 'The youngest Lightwarden and the kept dawn. Neither has ever failed. Neither intends to start.' },
  'vex:umbrawyrm': { name: 'Starless', blurb: 'Nyx and the shadow-Wyrm turn out the lights — colour rests, then strikes from nowhere.', story: 'Everyone treated both of them as basically grey already. The redemption pair: shadow is where colour RESTS, and it has been resting a long, patient while.' },
  'pyra:pyrax': { name: 'Twin Ember', blurb: 'Bramble, Bloom and Pyrax — three sparks, one echo, twice the fire.', story: 'The twins adopt a dragon the size of a house and treat it exactly like a very large squirrel. It adores them.' },
  // GOOD, narrative foils (no full ultimate — a named minor fused effect + a beat)
  'aurelia:umbrawyrm': { name: 'Eclipse', blurb: 'Light and shadow foils — Seraphine\'s breath briefly blinds the whole pack.', story: 'The bicker-ship, made cosmic. She holds the dawn; the Wyrm holds the dusk. Somebody has to.' },
  'glacia:lumenwyrm': { name: 'Prism-Ice', blurb: 'Lumi bends Lumenwyrm\'s light through the Deep Ice — refracted, armor-stripping frost.', story: 'The oracle likes that this one is honest: light through ice tells you exactly what it will do.' },
}

// ---------------------------------------------------------------------------
//  RESOLVE — the single source of truth. Deterministic: the sim, the Bond UI and
//  the codex all read these numbers, so a bond's power is identical everywhere.
// ---------------------------------------------------------------------------
export interface BondResolution {
  heroId: string
  wyrm: WyrmDef
  tier: BondTier
  tierLabel: string
  level: number
  stage: WyrmStage
  stageLabel: string
  // sim numbers (radius/cd in TILES/SECONDS; the sim converts tiles→px)
  breathDamage: number
  breathRadiusTiles: number
  breathCd: number
  heroAmp: number // multiplies the bonded hero's damage ("amplifies the hero")
  towerBuff: number // additive fraction to nearby same-element towers
  status: BreathStatus // on-breath bite (GOOD+ only; '' for regular)
  // PERFECT-only fused ULTIMATE (once per wave). null for good/regular.
  ult: { name: string; blurb: string; damageMult: number; radiusTiles: number } | null
  // narrative flavour (present for named pairs; else generic)
  named: NamedBond | null
}

function levelGrowth(level: number): number {
  return 1 + 0.08 * (clampWyrmLevel(level) - 1)
}

export function resolveBond(heroId: string, wyrmId: string, level: number): BondResolution | null {
  const wyrm = wyrmById(wyrmId)
  if (!wyrm) return null
  const tier = bondTier(heroId, wyrmId)
  const stage = wyrmStage(level)
  const named = NAMED_BONDS[`${heroId}:${wyrmId}`] ?? null
  const breathDamage = clamp(24 * STAGE_MULT[stage] * TIER_BREATH[tier] * levelGrowth(level), 0, 1e6)
  const breathRadiusTiles = clamp(1.8 + STAGE_RADIUS[stage] + TIER_RADIUS[tier], 1, 5)
  const heroAmp = TIER_HEROAMP[tier]
  const towerBuff = TIER_TOWER[tier]
  const status: BreathStatus = tier === 'regular' ? '' : wyrm.status
  const ult = tier === 'perfect'
    ? {
        name: named?.name ?? `${wyrm.name} Ascendant`,
        blurb: named?.blurb ?? `${wyrm.name} and its bondmate unleash a fused ${wyrm.breathName} once per wave.`,
        damageMult: 3,
        radiusTiles: clamp(breathRadiusTiles + 1, 1, 6),
      }
    : null
  return {
    heroId, wyrm, tier, tierLabel: TIER_LABEL[tier], level: clampWyrmLevel(level),
    stage, stageLabel: STAGE_LABEL[stage],
    breathDamage, breathRadiusTiles, breathCd: TIER_CD[tier], heroAmp, towerBuff, status, ult, named,
  }
}

// The element a Wyrm's breath paints (for reactions) — always a wheel Element,
// so it is a valid AuraElement.
export function wyrmAura(wyrm: WyrmDef): AuraElement {
  return wyrm.element
}

const pct = (m: number): string => `${m >= 1 ? '+' : ''}${Math.round((m - 1) * 100)}%`
const pctf = (f: number): string => `+${Math.round(f * 100)}%`

// Human-readable tooltip lines for a bond (no mystery stats).
export function bondTooltip(b: BondResolution): string[] {
  const lines: string[] = []
  lines.push(`${b.wyrm.emoji} ${b.wyrm.name} · ${b.tierLabel} (${b.tier.toUpperCase()})`)
  lines.push(`${b.stageLabel} · Lv ${b.level} — ${b.wyrm.breathName}`)
  lines.push(`Breath: ${Math.round(b.breathDamage)} ${b.wyrm.element} dmg, ${b.breathRadiusTiles.toFixed(1)}-tile burst every ${b.breathCd.toFixed(1)}s (feeds reactions)`)
  lines.push(`Aura: ${pct(b.heroAmp)} bonded-hero damage · ${pctf(b.towerBuff)} nearby ${b.wyrm.element} towers`)
  if (b.status) lines.push(`Breath also inflicts ${b.status.toUpperCase()}`)
  if (b.ult) lines.push(`★ ${b.ult.name} (fused ultimate): ${b.ult.blurb}`)
  else if (b.named) lines.push(`✦ ${b.named.name}: ${b.named.blurb}`)
  return lines
}
