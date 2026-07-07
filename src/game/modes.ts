// DIFFICULTY & CHALLENGE MODES — all layered over the SAME deterministic sim, as
// config + a pure wave transform. No sim rewrite, no new randomness.
//
// • Heroic  — harder WAVES: +35% enemy HP and ~+18% counts (bosses/keepers keep
//             their count). A pure, deterministic transform of the level's waves.
// • Iron    — one life. `startLives = 1`.
// • No-Hero — towers only. Empty party.
// • Spare   — at most TOWER_CAP towers (SimConfig.towerCap).
// Each earns its own badge (stored separately from campaign stars).

import type { LevelDef } from './levels'

export type Difficulty = 'normal' | 'heroic'
export type Challenge = '' | 'iron' | 'nohero' | 'towers'

export interface RunMode { difficulty: Difficulty; challenge: Challenge }
export const NORMAL_MODE: RunMode = { difficulty: 'normal', challenge: '' }

export const TOWER_CAP = 6 // "Spare" challenge cap

export function isNormalMode(m: RunMode): boolean {
  return m.difficulty === 'normal' && m.challenge === ''
}

// Heroic: scale wave HP + counts deterministically (harder waves via content).
export function applyHeroic(level: LevelDef): LevelDef {
  return {
    ...level,
    waves: level.waves.map((wv) => ({
      clearBonus: wv.clearBonus,
      entries: wv.entries.map((en) => ({
        ...en,
        hpMul: +(en.hpMul * 1.35).toFixed(3),
        count: en.kind === 'keeper' || en.kind === 'boss' ? en.count : Math.max(1, Math.round(en.count * 1.18)),
      })),
    })),
  }
}

export function levelForMode(level: LevelDef, mode: RunMode): LevelDef {
  return mode.difficulty === 'heroic' ? applyHeroic(level) : level
}

export function startLivesForMode(base: number, mode: RunMode): number {
  return mode.challenge === 'iron' ? 1 : base
}

export function towerCapForMode(mode: RunMode): number | undefined {
  return mode.challenge === 'towers' ? TOWER_CAP : undefined
}

export function partyAllowedForMode(mode: RunMode): boolean {
  return mode.challenge !== 'nohero'
}

// A deterministic seed salt so a mode run replays identically but differs from the
// normal-mode run of the same level.
export function modeSeedSalt(mode: RunMode): number {
  let s = 0
  if (mode.difficulty === 'heroic') s ^= 0x11ee7
  if (mode.challenge === 'iron') s ^= 0x22011
  if (mode.challenge === 'nohero') s ^= 0x33022
  if (mode.challenge === 'towers') s ^= 0x44033
  return s >>> 0
}

// Badge ids recorded on a mode clear (separate from campaign stars).
export function badgesForClear(mode: RunMode): string[] {
  const out: string[] = []
  if (mode.difficulty === 'heroic') out.push('heroic')
  if (mode.challenge) out.push(mode.challenge)
  return out
}

export interface BadgeMeta { label: string; abbr: string; blurb: string }
export const BADGE_META: Record<string, BadgeMeta> = {
  heroic: { label: 'Heroic', abbr: 'H', blurb: 'Harder waves — +35% HP, more enemies.' },
  iron: { label: 'Iron', abbr: 'I', blurb: 'One life. No mistakes.' },
  nohero: { label: 'No Hero', abbr: 'N', blurb: 'Towers only — leave the champions home.' },
  towers: { label: 'Spare', abbr: 'S', blurb: `At most ${TOWER_CAP} towers on the field.` },
}
export const BADGE_ORDER = ['heroic', 'iron', 'nohero', 'towers']
