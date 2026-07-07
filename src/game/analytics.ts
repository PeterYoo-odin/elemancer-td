// OPT-IN ANALYTICS — a privacy-respecting funnel layer built ON TOP of the existing
// onboarding/attribution instrumentation. It answers the questions that drive real
// balancing later: retention (are they coming back?), level drop-off (where do they
// quit?), first-wow time (did the hook land?), and deaths-by-level (which curve is
// too steep?).
//
// PRIVACY FIRST:
//   · DEFAULT OFF. Nothing is recorded, persisted or sent until the player opts in.
//     Consent lives in its OWN key so clearing it never disturbs game progress.
//   · NO PII. Only aggregate counts, timings (seconds), level ids and UTC day
//     INDICES (never wall-clock timestamps, never the device/referral code). The
//     backend payload is the same aggregate — it can identify a cohort, never a
//     person.
//   · The backend send reuses the existing fire-and-forget seam
//     (window.__CHROMANCER_BACKEND__) and only fires when consent AND a backend URL
//     are both present.
//
// View-side only — never touches the sim or its RNG.

import { ftue } from './onboarding'
import { utcDayIndex } from './seedcode'

const STORE_KEY = 'chromancer_analytics_v1'
const CONSENT_KEY = 'chromancer_analytics_consent_v1'

export type Consent = 'granted' | 'denied' | 'unset'

// Per-level funnel counters. Everything is a COUNT — no identifiers, no free text.
interface LevelStat {
  starts: number
  clears: number
  deaths: number
  bestWave: number
}

interface AnalyticsStore {
  v: 1
  sessions: number
  firstDay: number // UTC day index of first opted-in session
  lastDay: number // UTC day index of most recent session
  activeDays: number[] // sorted unique UTC day indices seen (retention funnel)
  battlesStarted: number
  battlesWon: number
  levels: Record<string, LevelStat> // levelId -> funnel counts (deaths-by-level etc.)
  waveReachedTotal: number // Σ wave reached across all battles (for avg)
  waveReachedN: number
}

function emptyStore(): AnalyticsStore {
  return {
    v: 1, sessions: 0, firstDay: 0, lastDay: 0, activeDays: [],
    battlesStarted: 0, battlesWon: 0, levels: {}, waveReachedTotal: 0, waveReachedN: 0,
  }
}

function today(): number {
  try { return utcDayIndex(Date.now()) } catch { return 0 }
}

function readConsent(): Consent {
  try {
    const v = localStorage.getItem(CONSENT_KEY)
    return v === 'granted' || v === 'denied' ? v : 'unset'
  } catch {
    return 'unset'
  }
}

function num(v: unknown): number { return typeof v === 'number' && Number.isFinite(v) ? v : 0 }

function loadStore(): AnalyticsStore {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return emptyStore()
    const o = JSON.parse(raw) as Partial<AnalyticsStore>
    const d = emptyStore()
    if (typeof o.sessions === 'number') d.sessions = o.sessions
    if (typeof o.firstDay === 'number') d.firstDay = o.firstDay
    if (typeof o.lastDay === 'number') d.lastDay = o.lastDay
    if (Array.isArray(o.activeDays)) d.activeDays = o.activeDays.filter((n) => typeof n === 'number')
    if (typeof o.battlesStarted === 'number') d.battlesStarted = o.battlesStarted
    if (typeof o.battlesWon === 'number') d.battlesWon = o.battlesWon
    if (typeof o.waveReachedTotal === 'number') d.waveReachedTotal = o.waveReachedTotal
    if (typeof o.waveReachedN === 'number') d.waveReachedN = o.waveReachedN
    if (o.levels && typeof o.levels === 'object') {
      for (const [id, s] of Object.entries(o.levels)) {
        const st = s as Partial<LevelStat>
        d.levels[id] = {
          starts: num(st.starts), clears: num(st.clears), deaths: num(st.deaths), bestWave: num(st.bestWave),
        }
      }
    }
    return d
  } catch {
    return emptyStore()
  }
}

class Analytics {
  private store: AnalyticsStore = loadStore()
  private consentState: Consent = readConsent()

  consent(): Consent { return this.consentState }
  enabled(): boolean { return this.consentState === 'granted' }
  /** True until the player has answered the consent prompt (drives the opt-in card). */
  needsPrompt(): boolean { return this.consentState === 'unset' }

  setConsent(granted: boolean): void {
    this.consentState = granted ? 'granted' : 'denied'
    try { localStorage.setItem(CONSENT_KEY, this.consentState) } catch { /* private mode */ }
    if (!granted) {
      // Opt-OUT is a hard delete: wipe any locally-collected analytics immediately.
      this.store = emptyStore()
      try { localStorage.removeItem(STORE_KEY) } catch { /* ignore */ }
    } else {
      this.recordSession()
    }
  }

  private persist(): void {
    if (!this.enabled()) return
    try { localStorage.setItem(STORE_KEY, JSON.stringify(this.store)) } catch { /* private mode */ }
  }

  private level(id: string): LevelStat {
    let s = this.store.levels[id]
    if (!s) { s = { starts: 0, clears: 0, deaths: 0, bestWave: 0 }; this.store.levels[id] = s }
    return s
  }

  // ---- funnel events (all no-op unless opted in) --------------------------
  recordSession(): void {
    if (!this.enabled()) return
    const day = today()
    this.store.sessions++
    if (this.store.firstDay === 0) this.store.firstDay = day
    this.store.lastDay = day
    if (!this.store.activeDays.includes(day)) {
      this.store.activeDays.push(day)
      this.store.activeDays.sort((a, b) => a - b)
    }
    this.persist()
  }

  recordBattleStart(levelId: string): void {
    if (!this.enabled()) return
    this.store.battlesStarted++
    this.level(levelId).starts++
    this.persist()
  }

  recordBattleEnd(levelId: string, opts: { win: boolean; wave: number }): void {
    if (!this.enabled()) return
    const s = this.level(levelId)
    if (opts.win) { this.store.battlesWon++; s.clears++ }
    else s.deaths++
    if (opts.wave > s.bestWave) s.bestWave = opts.wave
    this.store.waveReachedTotal += Math.max(0, opts.wave)
    this.store.waveReachedN++
    this.persist()
    this.flush() // opportunistic aggregate send (no-op without consent+backend)
  }

  // ---- retention helpers ---------------------------------------------------
  /** Days active within `window` of first session (crude D1/D7-style retention). */
  private retainedWithin(windowDays: number): boolean {
    if (this.store.activeDays.length < 2) return false
    return this.store.activeDays.some((d) => d > this.store.firstDay && d <= this.store.firstDay + windowDays)
  }

  // A read-only, no-PII funnel snapshot for the in-game analytics view + backend.
  snapshot(): Record<string, number | string> {
    const s = this.store
    const avgWave = s.waveReachedN > 0 ? s.waveReachedTotal / s.waveReachedN : 0
    // biggest drop-off level = most starts with the worst clear rate
    let dropLevel = '—'
    let dropRate = 1
    for (const [id, st] of Object.entries(s.levels)) {
      if (st.starts < 2) continue
      const rate = st.clears / st.starts
      if (rate < dropRate) { dropRate = rate; dropLevel = id }
    }
    let deadliest = '—'
    let deaths = 0
    for (const [id, st] of Object.entries(s.levels)) if (st.deaths > deaths) { deaths = st.deaths; deadliest = id }
    return {
      consent: this.consentState,
      sessions: s.sessions,
      daysActive: s.activeDays.length,
      d1Retained: this.retainedWithin(1) ? 1 : 0,
      d7Retained: this.retainedWithin(7) ? 1 : 0,
      battlesStarted: s.battlesStarted,
      battlesWon: s.battlesWon,
      winRate: s.battlesStarted > 0 ? Math.round((s.battlesWon / s.battlesStarted) * 100) / 100 : 0,
      avgWaveReached: Math.round(avgWave * 10) / 10,
      firstWowS: ftue.data.firstWowS ?? -1, // first-wow time (from onboarding instrumentation)
      timeToFirstTowerS: ftue.data.ttftBattleS ?? -1,
      biggestDropOffLevel: dropLevel,
      biggestDropOffClearRate: Math.round(dropRate * 100) / 100,
      deadliestLevel: deadliest,
      deadliestLevelDeaths: deaths,
    }
  }

  // ---- backend (optional, aggregate only) ---------------------------------
  flush(): void {
    if (!this.enabled()) return
    const backend = (window as unknown as { __CHROMANCER_BACKEND__?: string }).__CHROMANCER_BACKEND__
    if (!backend) return
    try {
      void fetch(`${backend.replace(/\/$/, '')}/analytics`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // aggregate snapshot ONLY — no ids, no timestamps, no attribution/device data
        body: JSON.stringify(this.snapshot()),
        keepalive: true,
      }).catch(() => { /* fire-and-forget */ })
    } catch {
      /* fetch unavailable */
    }
  }
}

export const analytics = new Analytics()

// QA/funnel access from the console (read-only snapshot): window.__chromancerAnalytics
declare global {
  interface Window {
    __chromancerAnalytics?: Analytics
  }
}
if (typeof window !== 'undefined') window.__chromancerAnalytics = analytics
