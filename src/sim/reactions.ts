// ELEMENTAL REACTIONS — the signature depth layer. When two DIFFERENT elements
// strike the same enemy inside a short window, the pair detonates into a named
// reaction (burst / spread / control / mark). Pure data + a pair lookup; all the
// effect math lives in sim.ts so this table stays declarative and testable.
//
// Aura sources: flame→Fire, frost→Water, storm→Storm, arcane→Arcane (its own tag,
// distinct from its wheel element), heroes→their element. Cannon is elementless.

import type { Element } from './combat'

export type AuraElement = Element | 'Arcane'

export type ReactionKey =
  | 'thermal' // Fire + Water — THERMAL SHOCK: armor break + burst
  | 'shatter' // Water + Storm — SHATTER: burst, doubled vs armored
  | 'flashover' // Fire + Storm — FLASHOVER: AoE explosion
  | 'wildfire' // Fire + Nature — WILDFIRE: burn spreads to the pack
  | 'overgrow' // Water + Nature — OVERGROW: heavy area root/slow
  | 'eclipse' // Light + Dark — ECLIPSE: brief area stun
  | 'conduct' // Storm + Light — CONDUCT: arcs a chain to nearby enemies
  | 'blight' // Nature + Dark — BLIGHT: poison DoT area
  | 'amplify' // Arcane + any — AMPLIFY: target takes bonus damage for a while

export interface ReactionDef {
  key: ReactionKey
  name: string // the big juicy callout text
  color: number // primary burst/callout colour
  color2: number // secondary burst colour
}

const R = (key: ReactionKey, name: string, color: number, color2: number): ReactionDef => ({ key, name, color, color2 })

export const REACTIONS: Record<ReactionKey, ReactionDef> = {
  thermal: R('thermal', 'THERMAL SHOCK', 0xffb15c, 0x4ad9ff),
  shatter: R('shatter', 'SHATTER', 0x9fdcff, 0xffe14a),
  flashover: R('flashover', 'FLASHOVER', 0xff6a3c, 0xffe97a),
  wildfire: R('wildfire', 'WILDFIRE', 0xff8a3c, 0x8dff4a),
  overgrow: R('overgrow', 'OVERGROW', 0x8dff4a, 0x4ad9ff),
  eclipse: R('eclipse', 'ECLIPSE', 0xffe14a, 0xc06bff),
  conduct: R('conduct', 'CONDUCT', 0x9ad0ff, 0xfff0a0),
  blight: R('blight', 'BLIGHT', 0xa4ff6a, 0x8a4aff),
  amplify: R('amplify', 'AMPLIFY', 0xd6a6ff, 0xffffff),
}

// Unordered pair → reaction. Arcane is a wildcard: it reacts with ANY element.
const PAIR: Record<string, ReactionKey> = {
  'Fire|Water': 'thermal',
  'Storm|Water': 'shatter',
  'Fire|Storm': 'flashover',
  'Fire|Nature': 'wildfire',
  'Nature|Water': 'overgrow',
  'Dark|Light': 'eclipse',
  'Light|Storm': 'conduct',
  'Dark|Nature': 'blight',
}

export function reactionFor(a: AuraElement, b: AuraElement): ReactionDef | null {
  if (a === b) return null
  if (a === 'Arcane' || b === 'Arcane') return REACTIONS.amplify
  const key = a < b ? `${a}|${b}` : `${b}|${a}`
  const rk = PAIR[key]
  return rk ? REACTIONS[rk] : null
}
