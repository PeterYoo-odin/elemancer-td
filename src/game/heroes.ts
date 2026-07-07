// Hero roster — the collectible CHARACTER layer that sits on top of the tower TD
// (the Rush Royale / Realm Defense system). Heroes are deterministic sim entities:
// they deploy on build tiles like towers, auto-attack through the SAME element
// wheel + damage grid as towers, form element team SYNERGIES, and each casts one
// signature SPELL on cooldown. This file is PURE DATA + level-scaling helpers — no
// Phaser, no sim state — so the sim and the collection UI both read from it.
//
// Stats here are LEVEL 1 baselines; heroStat()/heroSpell() scale them by level.
// Art is a placeholder (element-tinted gradient + glyph + rarity frame); the
// painted portraits swap in later without touching a number.

import type { DamageType, Element } from '../sim/combat'
import { ELEMENT_COLOR } from '../sim/combat'

export type HeroRole = 'DPS' | 'Support' | 'Control'
export type HeroRarity = 'common' | 'rare' | 'epic'

// A hero's active ability. `effect` selects the sim behaviour; the numeric fields
// are level-1 baselines scaled by spell power. Targeted spells aim at a tapped
// point; untargeted spells fire centred on the caster hero.
export type SpellEffect = 'aoeBurn' | 'freeze' | 'chain' | 'heal' | 'novaBuff' | 'execute'

export interface HeroSpellDef {
  id: string
  name: string
  blurb: string
  glyph: string
  effect: SpellEffect
  targeted: boolean
  cooldown: number // seconds
  // scaled params (level-1 baselines)
  damage?: number
  radius?: number // tiles
  burnDps?: number
  burnDuration?: number
  stunDuration?: number
  slowFactor?: number
  slowDuration?: number
  chainCount?: number
  chainRange?: number // tiles
  chainFalloff?: number
  heal?: number // lives restored to the base
  buffMult?: number // novaBuff: temporary hero-damage multiplier
  buffDuration?: number
  executeThreshold?: number // fraction of maxHp below which the bonus applies
  executeMult?: number
}

export interface HeroDef {
  id: string
  name: string
  title: string
  element: Element
  role: HeroRole
  rarity: HeroRarity
  damageType: DamageType
  glyph: string
  color: number
  accent: number
  blurb: string
  // combat baseline (level 1)
  baseDamage: number
  range: number // tiles
  cooldown: number // seconds between auto-attacks
  buffDamage?: number // Support: +fraction damage granted to adjacent towers/heroes
  slowFactor?: number // Control: enemy speed multiplier applied on hit (e.g. 0.6)
  slowDuration?: number // Control: seconds the slow lingers
  deployCost: number // battle-gold to field this hero
  unlockShards: number // 0 = owned from the start; else shard cost to unlock
  spell: HeroSpellDef
}

const DARK = (c: number): number => {
  // a deterministic darker accent from an element colour (view-only)
  const r = (c >> 16) & 0xff, g = (c >> 8) & 0xff, b = c & 0xff
  return ((r * 0.32) << 16) | ((g * 0.32) << 8) | (b * 0.32)
}

// NOTE (Chromancer canon): display names/titles/blurbs follow the narrative
// bible cast (Ashka, Lumi, Galea, …). The ids are UNCHANGED — saves, party
// loadouts and the sim key on ids, so renaming display fields is free.
export const HEROES: Record<string, HeroDef> = {
  ember: {
    id: 'ember', name: 'Ashka', title: 'the Cinderblade', element: 'Fire', role: 'DPS', rarity: 'rare',
    damageType: 'Magic', glyph: '🔥', color: ELEMENT_COLOR.Fire, accent: DARK(ELEMENT_COLOR.Fire),
    blurb: 'Foundling of the first greyed town. Fire has a second job, and it is warmth. Stay lit.',
    baseDamage: 26, range: 3.0, cooldown: 0.7, deployCost: 110, unlockShards: 0,
    spell: {
      id: 'fireball', name: 'Fireball', blurb: 'Tap an area · fiery burst + burn', glyph: '☄',
      effect: 'aoeBurn', targeted: true, cooldown: 12, damage: 130, radius: 2.2, burnDps: 30, burnDuration: 3,
    },
  },
  glacia: {
    id: 'glacia', name: 'Lumi', title: 'the Glacier Oracle', element: 'Water', role: 'Control', rarity: 'rare',
    damageType: 'Magic', glyph: '❄', color: ELEMENT_COLOR.Water, accent: DARK(ELEMENT_COLOR.Water),
    blurb: 'Youngest ever to read the Deep Ice. She has seen this battle. It goes well.',
    baseDamage: 15, range: 2.8, cooldown: 0.85, slowFactor: 0.55, slowDuration: 1.4, deployCost: 100, unlockShards: 0,
    spell: {
      id: 'frostnova', name: 'Frost Nova', blurb: 'Tap an area · freeze everything', glyph: '❆',
      effect: 'freeze', targeted: true, cooldown: 15, radius: 2.6, stunDuration: 2.0, slowFactor: 0.4, slowDuration: 2.5,
    },
  },
  sylvan: {
    id: 'sylvan', name: 'Thornwick', title: 'the Grovewarden', element: 'Nature', role: 'Support', rarity: 'common',
    damageType: 'Physical', glyph: '🌿', color: ELEMENT_COLOR.Nature, accent: DARK(ELEMENT_COLOR.Nature),
    blurb: 'Ancient warden of the Wilds. Everything grey was green once — give it a minute.',
    baseDamage: 9, range: 2.2, cooldown: 1.1, buffDamage: 0.24, deployCost: 90, unlockShards: 0,
    spell: {
      id: 'healcircle', name: 'Healing Circle', blurb: 'Restore lives · ensnare foes', glyph: '✚',
      effect: 'heal', targeted: false, cooldown: 20, radius: 2.6, heal: 3, slowFactor: 0.5, slowDuration: 3,
    },
  },
  pyra: {
    id: 'pyra', name: 'Bramble', title: 'Bramble & Bloom', element: 'Fire', role: 'Support', rarity: 'common',
    damageType: 'Magic', glyph: '🌱', color: 0xff9a4a, accent: DARK(0xff9a4a),
    blurb: 'Twin sprouts who finish each other\'s sentences — and each other\'s sparks. Two of them. Too bad for you.',
    baseDamage: 12, range: 2.4, cooldown: 1.0, buffDamage: 0.2, deployCost: 95, unlockShards: 40,
    spell: {
      id: 'cinderstorm', name: 'Sparkseed Storm', blurb: 'Tap an area · lingering embers', glyph: '🔥',
      effect: 'aoeBurn', targeted: true, cooldown: 13, damage: 80, radius: 2.8, burnDps: 46, burnDuration: 3.5,
    },
  },
  zephyra: {
    id: 'zephyra', name: 'Galea', title: 'Capt. Stormwright', element: 'Storm', role: 'DPS', rarity: 'epic',
    damageType: 'Magic', glyph: '⚡', color: ELEMENT_COLOR.Storm, accent: DARK(ELEMENT_COLOR.Storm),
    blurb: 'Sky-clipper captain who lost her crew to the dead calm. Wind\'s up, sails full — wager\'s on.',
    baseDamage: 30, range: 3.4, cooldown: 0.8, deployCost: 130, unlockShards: 120,
    spell: {
      id: 'chainlightning', name: 'Chain Squall', blurb: 'Tap a foe · arcs through the pack', glyph: '🌩',
      effect: 'chain', targeted: true, cooldown: 11, damage: 90, chainCount: 6, chainRange: 3.0, chainFalloff: 0.88,
    },
  },
  volt: {
    id: 'volt', name: 'Fizz', title: 'Arcwhistle', element: 'Storm', role: 'Control', rarity: 'rare',
    damageType: 'Magic', glyph: '⚗', color: 0x8fbfff, accent: DARK(0x8fbfff),
    blurb: 'Prism maintenance-corps gnome. Ninety-nine percent sure the stasis coils are calibrated.',
    baseDamage: 18, range: 3.0, cooldown: 0.9, slowFactor: 0.6, slowDuration: 1.2, deployCost: 115, unlockShards: 80,
    spell: {
      id: 'staticfield', name: 'Static Field', blurb: 'Tap an area · stun + slow', glyph: '⚡',
      effect: 'freeze', targeted: true, cooldown: 14, radius: 2.4, stunDuration: 1.3, slowFactor: 0.5, slowDuration: 3,
    },
  },
  aurelia: {
    id: 'aurelia', name: 'Seraphine', title: 'Dawnhalo', element: 'Light', role: 'Support', rarity: 'epic',
    damageType: 'Magic', glyph: '☀', color: ELEMENT_COLOR.Light, accent: DARK(ELEMENT_COLOR.Light),
    blurb: 'Youngest Lightwarden, never failed — yet. Hold the line; the dawn is already coming.',
    baseDamage: 20, range: 2.8, cooldown: 0.95, buffDamage: 0.3, deployCost: 125, unlockShards: 120,
    spell: {
      id: 'holynova', name: 'Aegis of Dawn', blurb: 'Burst of light · empowers heroes', glyph: '✦',
      effect: 'novaBuff', targeted: false, cooldown: 16, damage: 110, radius: 3.0, buffMult: 1.6, buffDuration: 6,
    },
  },
  vex: {
    id: 'vex', name: 'Nyx', title: 'the Umbral Trickster', element: 'Dark', role: 'DPS', rarity: 'epic',
    damageType: 'Pierce', glyph: '🗡', color: ELEMENT_COLOR.Dark, accent: DARK(ELEMENT_COLOR.Dark),
    blurb: 'From the Twilight Margins. You won\'t see her coming — nobody ever does. Their loss.',
    baseDamage: 34, range: 3.0, cooldown: 0.75, deployCost: 135, unlockShards: 150,
    spell: {
      id: 'shadowstrike', name: 'Umbral Pounce', blurb: 'Tap a foe · executes the weak', glyph: '☠',
      effect: 'execute', targeted: true, cooldown: 10, damage: 200, executeThreshold: 0.35, executeMult: 3,
    },
  },
}

// Stable display/collection order.
export const HERO_ORDER: string[] = ['ember', 'glacia', 'sylvan', 'pyra', 'zephyra', 'volt', 'aurelia', 'vex']

// Heroes owned from a fresh save (no shard cost).
export const STARTER_HEROES: string[] = ['ember', 'glacia', 'sylvan']

export const MAX_PARTY = 3

export function heroById(id: string): HeroDef | null {
  return HEROES[id] ?? null
}

export const RARITY_COLOR: Record<HeroRarity, number> = {
  common: 0x9fb3c8,
  rare: 0x4fb4ff,
  epic: 0xc06bff,
}

export const RARITY_RANK: Record<HeroRarity, number> = { common: 0, rare: 1, epic: 2 }
