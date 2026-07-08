// RANKED — LOCAL PB HISTORY. A device-local record of your best ranked run per
// board period (daily day / weekly week / endless all-time), kept in its OWN
// localStorage key (never in SaveData). This is what makes "your rank + your PB
// history" work OFFLINE and instantly, before/without any backend — the cloud
// board is a superset the client reconciles to when it's wired.

import type { RankedMode } from './ranked'

const KEY = 'chromancer_ranked_local_v1'
const MAX_HISTORY = 60 // keep the last N period-bests per mode (plenty for the UI)

export interface RankedLocalBest {
  mode: RankedMode
  period: number
  score: number
  wave: number
  seed: number
  at: number // epoch ms of the record (for display ordering)
}

interface Store {
  best: Record<string, RankedLocalBest> // `${mode}:${period}` -> best
}

function read(): Store {
  try {
    const raw = localStorage.getItem(KEY)
    const o = raw ? (JSON.parse(raw) as Store) : null
    if (o && o.best && typeof o.best === 'object') return { best: o.best }
  } catch {
    /* corrupt / private mode */
  }
  return { best: {} }
}

function write(store: Store): void {
  try {
    // prune to the newest MAX_HISTORY per mode so the key never grows unbounded
    const rows = Object.values(store.best)
    if (rows.length > MAX_HISTORY * 3) {
      const byMode: Record<string, RankedLocalBest[]> = {}
      for (const r of rows) (byMode[r.mode] ||= []).push(r)
      const kept: Record<string, RankedLocalBest> = {}
      for (const list of Object.values(byMode)) {
        list.sort((a, b) => b.period - a.period)
        for (const r of list.slice(0, MAX_HISTORY)) kept[`${r.mode}:${r.period}`] = r
      }
      store = { best: kept }
    }
    localStorage.setItem(KEY, JSON.stringify(store))
  } catch {
    /* quota / private mode — non-fatal */
  }
}

/** Record a finished ranked run; keeps the period's BEST by score. Returns true
 *  if this run is a new personal best for that board period. */
export function recordRankedLocal(mode: RankedMode, period: number, score: number, wave: number, seed: number): boolean {
  if (!Number.isFinite(score) || score < 0) return false
  const store = read()
  const k = `${mode}:${period}`
  const prev = store.best[k]
  if (prev && score <= prev.score) return false
  store.best[k] = { mode, period, score, wave, seed: seed >>> 0, at: Date.now() }
  write(store)
  return true
}

/** Your local best for a specific board period (null if never played). */
export function localBest(mode: RankedMode, period: number): RankedLocalBest | null {
  return read().best[`${mode}:${period}`] ?? null
}

/** Your recent local PBs for a mode, newest period first (for the PB history list). */
export function localHistory(mode: RankedMode, limit = 20): RankedLocalBest[] {
  return Object.values(read().best)
    .filter((r) => r.mode === mode)
    .sort((a, b) => b.period - a.period || b.at - a.at)
    .slice(0, limit)
}
