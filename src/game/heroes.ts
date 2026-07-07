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
import type { TowerKind } from './towers'

export type HeroRole = 'DPS' | 'Support' | 'Control'
export type HeroRarity = 'common' | 'rare' | 'epic'

// A hero's SIGNATURE — the one mechanic nobody else has. Pure counters and
// thresholds (never RNG) so replays stay bit-identical. Dormant until the hero
// reaches SIGNATURE_UNLOCK_LEVEL (see heroProgress) — levelling awakens the kit.
export type SignatureKind =
  | 'cindernova' // Ashka: every Nth strike erupts in a fiery nova + burn
  | 'foreseen' // Lumi: every Nth strike is foreseen — double damage + brief freeze
  | 'deeproots' // Thornwick: his aura GROWS each wave he holds the ground
  | 'twinspark' // Bramble & Bloom: every attack echoes — the twin strikes again
  | 'wager' // Galea: every Nth strike pays out a free chain squall
  | 'overload' // Fizz: bonus damage to slowed/stunned enemies, extends the slow
  | 'intercession' // Seraphine: once per wave, smites an enemy at the gate
  | 'tithe' // Nyx: enemies she finishes are pickpocketed for bonus gold

export interface HeroSignatureDef {
  kind: SignatureKind
  name: string
  glyph: string
  blurb: string // one-line card copy
  detail: string // full tooltip copy — exact behaviour, no mystery stats
  // numeric params (interpretation depends on kind; all deterministic)
  every?: number // rhythm kinds: every Nth attack
  mult?: number // damage multiplier / bonus fraction
  radius?: number // tiles (cindernova)
  stun?: number // seconds (foreseen)
  slowExtend?: number // seconds (overload)
  ramp?: number // aura growth per wave (deeproots)
  rampMax?: number // aura growth cap (deeproots)
  echo?: number // echo-hit fraction (twinspark)
  chainCount?: number // squall arcs (wager)
  chainFalloff?: number
  nukeMult?: number // intercession: baseDamage × this
  goldFrac?: number // tithe: bonus gold fraction of the kill's bounty
}

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
  story: string // the hero-detail screen's tale (canon: narrative bible)
  catchphrase: string
  resonantTower: TowerKind // field 2+ of these towers to awaken Element Resonance
  signature: HeroSignatureDef
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
    story: 'They found her in the ashes of Kindlekeep, the first town the Greying took — the only warm thing in a cold grey street. She counts her victories out loud because the alternative is counting what she lost. Somewhere between body counts she is learning fire\'s second job: not to destroy the grey, but to keep the people behind her warm.',
    catchphrase: 'Stay lit.',
    resonantTower: 'flame',
    signature: {
      kind: 'cindernova', name: 'Stay Lit', glyph: '💥',
      blurb: 'Every 4th strike erupts in a Cindernova',
      detail: 'Every 4th attack detonates around its target: 160% damage in a small area, and everything caught alight burns.',
      every: 4, mult: 1.6, radius: 1.4,
    },
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
    story: 'The youngest Oracle ever to read the Deep Ice, she saw the Greying coming and nobody believed her. She is not bitter about it; bitterness is a future she chose not to read. She arrives before you call, answers the question you were about to ask, and is quietly delighted every time you improvise something the ice never showed her.',
    catchphrase: 'I have seen this. It goes well.',
    resonantTower: 'frost',
    signature: {
      kind: 'foreseen', name: 'Foreseen', glyph: '👁',
      blurb: 'Every 3rd strike lands exactly as she saw it',
      detail: 'Every 3rd attack is Foreseen: it deals 220% damage and freezes the target for 0.7s — it was always going to land.',
      every: 3, mult: 2.2, stun: 0.7,
    },
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
    story: 'When the Greying reached the oldest tree in the Deeproot Wilds, Thornwick held the color in it with his bare hands for three days. He lost. He tells you this the way he tells you everything — slowly, warmly, relaying the moss\'s opinion on the matter. He knows regrowth is not restoration: what comes back comes back different. He plants anyway.',
    catchphrase: 'Everything grey was green once. Give it a minute.',
    resonantTower: 'cannon',
    signature: {
      kind: 'deeproots', name: 'Give It a Minute', glyph: '🌳',
      blurb: 'His aura grows every wave he holds the ground',
      detail: 'Deep roots: each wave cleared while he is fielded grows his support aura by +3% damage, up to +18%. Patience is a weapon.',
      ramp: 0.03, rampMax: 0.18,
    },
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
    story: 'Orphaned when the Wilds greyed, they were found coordinating squirrel ambushes against Morose\'s wisps — grim little Bramble laying the trap, bright little Bloom springing it. They finish each other\'s sentences, each other\'s sparks, and each other\'s fights. One slot on the roster. Two problems for the enemy.',
    catchphrase: 'Two of us— / —too bad for you!',
    resonantTower: 'flame',
    signature: {
      kind: 'twinspark', name: 'Two of Us', glyph: '✌',
      blurb: 'Every attack echoes — the twin strikes again',
      detail: 'There are two of them: every attack is followed by the twin\'s echo strike for 55% damage. Both hits paint the element.',
      echo: 0.55,
    },
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
    story: 'Her sky-clipper hung in the dead calm for nineteen days while the Greying drank the wind, and when it lifted she was the only one still aboard. She is loud because the quiet is where the calm lives. She bets on everything — first kill, last leak, your next brilliant mistake — because a wager means there is a future to collect in. The roster is her crew now. She checks the knots twice.',
    catchphrase: 'Wind\'s up, sails full — WAGER\'S ON!',
    resonantTower: 'storm',
    signature: {
      kind: 'wager', name: 'Wager\'s On', glyph: '🎲',
      blurb: 'Every 6th strike pays out a free chain squall',
      detail: 'She keeps count: every 6th attack pays out — a squall arcs from her target through up to 4 enemies at 70% damage.',
      every: 6, mult: 0.7, chainCount: 4, chainFalloff: 0.85,
    },
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
    story: 'Prism maintenance-corps, third class, decorated twice (once on purpose). Fizz once "solved" the Greying mathematically and force-recolored a whole village — technically perfect, completely soulless, and he has never fully forgiven the math. Now he builds the coils, calibrates the stasis fields, and leaves the feelings to the people who are better at them. He is ninety-nine percent sure this will work.',
    catchphrase: 'Ninety-nine percent sure! The one percent is where the FUN lives!',
    resonantTower: 'storm',
    signature: {
      kind: 'overload', name: 'The One Percent', glyph: '⚙',
      blurb: 'Overloads slowed or stunned enemies for +60%',
      detail: 'Calibrated coils: his attacks on slowed or stunned enemies OVERLOAD for +60% damage and extend the slow by 0.6s. Pair him with chill.',
      mult: 1.6, slowExtend: 0.6,
    },
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
    story: 'The youngest Lightwarden ever commissioned, with a laminated certificate to prove it (currently missing; Nyx knows nothing). She has never failed. Not once. She keeps the record not out of pride but out of terror of what failing might cost someone else. She is learning — slowly, radiantly — that dawn is not the absence of night. It is what night is for.',
    catchphrase: 'Hold the line — the dawn is already coming.',
    resonantTower: 'arcane',
    signature: {
      kind: 'intercession', name: 'Hold the Line', glyph: '🛡',
      blurb: 'Once per wave, smites an enemy at the gate',
      detail: 'She has never failed: once per wave, the first enemy about to breach the gate is struck by dawn for 900% of her damage. If it survives that, it earned the leak.',
      nukeMult: 9,
    },
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
    story: 'She grew up in the Twilight Margins, the realm everyone treated as basically grey already — so she knows better than anyone that they were wrong. She steals things and returns them improved. She lies in exactly one bark out of every few (good luck). When Morose told her she was always his, she laughed: shadow isn\'t the absence of color, you sad old man. Shadow is where color RESTS.',
    catchphrase: 'You won\'t see me coming. Nobody ever does… their loss.',
    resonantTower: 'arcane',
    signature: {
      kind: 'tithe', name: 'Their Loss', glyph: '💰',
      blurb: 'Pickpockets +45% bonus gold from her kills',
      detail: 'Everything she finishes gets its pockets turned out: enemies killed by her attacks drop +45% bonus gold. She was going to return it. Probably.',
      goldFrac: 0.45,
    },
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
