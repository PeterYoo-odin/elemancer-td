// SEASONAL EVENTS + WEEKLY MUTATOR — the live-ops content spine for ROGUELIKE
// endless. Everything here is DATA: a new seasonal event ships as one entry in
// EVENTS (a themed mutator set + a cosmetic reward hook + a date window), no engine
// change. The weekly headline mutator + shared weekly seed drive the "reason to
// return every week" leaderboard hook (client-best + share link first; the ranked
// backend's weekly board slots in behind the same seed later).
//
// LAYERING: this is the GAME layer. It resolves the CLOCK → week/event and hands
// the pure sim an explicit RogueConfig (mutator ids + relic-boost tags). The sim
// never reads the clock, so a shared weekly seed replays bit-identically for all.

import { MUTATORS, MUTATOR_IDS, type MutatorId, type RogueConfig } from '../sim'

export interface SeasonalEvent {
  id: string
  name: string
  blurb: string
  color: number
  icon: string
  startMs: number // inclusive UTC window start
  endMs: number // exclusive UTC window end
  mutators: MutatorId[] // folded into the run's rule set (on top of the weekly one)
  boostTags: string[] // relic-draft themes the event surfaces more often
  cosmetic: { id: string; name: string } // reward hook — unlocked by playing the event
}

const DAY = 86_400_000
const WEEK_MS = 7 * DAY

// ---------------------------------------------------------------------------
//  EVENT LIBRARY — add a seasonal event by appending one entry. Windows are UTC.
// ---------------------------------------------------------------------------
export const EVENTS: SeasonalEvent[] = [
  {
    id: 'emberwaste',
    name: 'The Emberwaste Restoration',
    blurb: 'The ash-choked Emberwaste kindles anew — everything burns, and Fire relics surface far more often. Push deep to paint its colour back.',
    color: 0xff6a3c,
    icon: '🔥',
    startMs: Date.UTC(2026, 5, 1), // 2026-06-01
    endMs: Date.UTC(2026, 8, 1), // 2026-09-01 (covers the current live window)
    mutators: ['pyroclasm'],
    boostTags: ['fire', 'burn'],
    cosmetic: { id: 'banner_emberwaste', name: 'Emberwaste Ember Banner' },
  },
]

/** The seasonal event live at `nowMs`, or null. First match wins (windows shouldn't overlap). */
export function activeEvent(nowMs: number): SeasonalEvent | null {
  for (const e of EVENTS) if (nowMs >= e.startMs && nowMs < e.endMs) return e
  return null
}

export function eventById(id: string | null | undefined): SeasonalEvent | null {
  if (!id) return null
  return EVENTS.find((e) => e.id === id) ?? null
}

// ---------------------------------------------------------------------------
//  WEEKLY SEED + MUTATOR — one shared, deterministic weekly challenge. Every
//  player on the same week sees the SAME seed + headline mutator → a fair board.
// ---------------------------------------------------------------------------
const WEEK_EPOCH = Date.UTC(2026, 0, 5) // a Monday — week 0 anchor

export function weekIndex(nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - WEEK_EPOCH) / WEEK_MS))
}

/** The shared seed for a given week (lands in the run-seed space; drives the board). */
export function weeklySeed(week: number): number {
  return (Math.imul(week + 1, 2654435761) ^ 0x5eed533) >>> 0
}

/** The headline mutator for a week — deterministic hash so the rotation feels varied. */
export function weeklyMutator(week: number): MutatorId {
  const idx = (Math.imul(week ^ 0x9e3779b9, 2654435761) >>> 0) % MUTATOR_IDS.length
  return MUTATOR_IDS[idx]
}

export interface WeeklyPlan {
  week: number
  seed: number
  headline: MutatorId
  event: SeasonalEvent | null
  rogue: RogueConfig
}

// Resolve the FULL weekly roguelike plan at `nowMs`: the shared seed, the headline
// mutator, any live event (its extra mutators + relic boosts + cosmetic), folded
// into the RogueConfig the sim consumes verbatim. Pure given nowMs.
export function weeklyPlan(nowMs: number): WeeklyPlan {
  const week = weekIndex(nowMs)
  const headline = weeklyMutator(week)
  const event = activeEvent(nowMs)
  const mutators: MutatorId[] = [headline]
  for (const m of event?.mutators ?? []) if (!mutators.includes(m)) mutators.push(m)
  return {
    week,
    seed: weeklySeed(week),
    headline,
    event,
    rogue: { mutators, boostTags: event?.boostTags ?? [], eventId: event?.id },
  }
}

/** Human-readable headline chip(s) for the HUD/summary (mutator names + event). */
export function planHeadline(plan: WeeklyPlan): string {
  const parts = plan.rogue.mutators.map((m) => MUTATORS[m]?.name ?? m)
  return plan.event ? `${plan.event.name} · ${parts.join(' + ')}` : parts.join(' + ')
}

// ---------------------------------------------------------------------------
//  LOCAL WEEKLY LEADERBOARD (client-best + share, per the spec) — a per-week
//  personal best kept in localStorage until the ranked backend's weekly board
//  goes live behind the SAME shared seed. Headless-safe (no-op without storage).
// ---------------------------------------------------------------------------
const WEEKLY_KEY = 'chromancer.weekly.best'

function loadWeeklyStore(): Record<string, number> {
  try {
    if (typeof localStorage === 'undefined') return {}
    return JSON.parse(localStorage.getItem(WEEKLY_KEY) || '{}') || {}
  } catch { return {} }
}

/** Best wave reached this week (0 = none logged). */
export function weeklyBest(week: number): number {
  const v = loadWeeklyStore()[String(week)]
  return typeof v === 'number' && isFinite(v) ? v : 0
}

/** Record a wave for the week; returns true if it's a new personal best. */
export function recordWeeklyBest(week: number, wave: number): boolean {
  const store = loadWeeklyStore()
  const key = String(week)
  const prev = store[key] ?? 0
  if (wave <= prev) return false
  store[key] = wave
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(WEEKLY_KEY, JSON.stringify(store)) } catch { /* ignore */ }
  return true
}
