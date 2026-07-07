// DAILY SEED — a habit loop with ZERO backend. Every device derives the same
// WORD-WORD-NN run for a given UTC day (see seedcode.ts `dailySeed`), and the
// player keeps a PURELY LOCAL record of their best wave per day. There is no
// global board here on purpose: the copy promises "a leaderboard money can't
// climb — servers coming", bridging honestly to the real ranked backend later.
//
// Storage is its own localStorage key (never in SaveData), like the codex —
// so the save schema stays untouched. History is keyed by UTC day index.

import { utcDayIndex } from './seedcode'

const DAILY_KEY = 'chromancer_daily_v1'

interface DailyStore {
  best: Record<string, number> // utcDayIndex -> best wave reached that day
}

function read(): DailyStore {
  try {
    const raw = localStorage.getItem(DAILY_KEY)
    const o = raw ? (JSON.parse(raw) as unknown) : null
    const best: Record<string, number> = {}
    if (o && typeof o === 'object' && (o as DailyStore).best && typeof (o as DailyStore).best === 'object') {
      for (const [k, v] of Object.entries((o as DailyStore).best)) {
        if (typeof v === 'number' && isFinite(v) && v > 0) best[k] = Math.floor(v)
      }
    }
    return { best }
  } catch {
    return { best: {} }
  }
}

function write(store: DailyStore): void {
  try {
    localStorage.setItem(DAILY_KEY, JSON.stringify(store))
  } catch {
    // private mode / quota — history won't persist, gameplay unaffected
  }
}

/** Record a finished daily run's wave. Keeps the day's BEST; returns true if PB. */
export function recordDailyResult(day: number, wave: number): boolean {
  if (!isFinite(wave) || wave <= 0) return false
  const store = read()
  const key = String(day)
  const prev = store.best[key] ?? 0
  if (wave <= prev) return false
  store.best[key] = wave
  write(store)
  return true
}

/** Best wave the player has reached on a given UTC day (0 = not played). */
export function bestForDay(day: number): number {
  return read().best[String(day)] ?? 0
}

export interface DailyRow {
  day: number
  wave: number
  label: string // e.g. "Jul 7" (UTC)
  isToday: boolean
}

/** Recent daily results, most-recent first (up to `limit` days that were played). */
export function dailyHistory(limit = 14, nowMs: number = Date.now()): DailyRow[] {
  const store = read()
  const today = utcDayIndex(nowMs)
  const days = Object.keys(store.best)
    .map((k) => parseInt(k, 10))
    .filter((d) => isFinite(d))
    .sort((a, b) => b - a)
    .slice(0, limit)
  return days.map((d) => ({
    day: d,
    wave: store.best[String(d)] ?? 0,
    label: dayLabel(d),
    isToday: d === today,
  }))
}

/** Personal best wave across ALL daily seeds ever played. */
export function dailyPB(): number {
  const store = read()
  let pb = 0
  for (const v of Object.values(store.best)) if (v > pb) pb = v
  return pb
}

/** How many days the player has played at least one daily run. */
export function dailyDaysPlayed(): number {
  return Object.keys(read().best).length
}

/** Current daily streak: consecutive UTC days ending today (or yesterday) played. */
export function dailyStreak(nowMs: number = Date.now()): number {
  const store = read()
  const today = utcDayIndex(nowMs)
  // A streak stays "alive" if today isn't played yet but yesterday was.
  let cursor = store.best[String(today)] ? today : today - 1
  let streak = 0
  while (store.best[String(cursor)]) {
    streak++
    cursor--
  }
  return streak
}

/** Has today's daily been played at all? */
export function playedToday(nowMs: number = Date.now()): boolean {
  return bestForDay(utcDayIndex(nowMs)) > 0
}

/** UTC day index → "Mon D" label (e.g. "Jul 7"). */
export function dayLabel(day: number): string {
  const d = new Date(day * 86_400_000)
  return d.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' })
}

/** Today's full UTC date (e.g. "Jul 7, 2026 UTC"), matching the landing widget. */
export function utcDailyDate(nowMs: number = Date.now()): string {
  return new Date(nowMs).toLocaleDateString('en-US', {
    timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric',
  }) + ' UTC'
}
