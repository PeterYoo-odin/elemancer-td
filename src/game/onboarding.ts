// ONBOARDING & FIRST SESSION — the PvZ-style ramp brain. Three jobs:
//   1. FTUE store: which teach-by-doing steps are done, persisted OUTSIDE the
//      main save (its own key) so wiping progress never re-runs the tutorial
//      unexpectedly and vice versa. Never throws in private mode.
//   2. Instrumentation: time-to-first-tower (from page load AND from battle
//      start), first-wow time, defeat/retry counts. Logged + persisted so any
//      session's funnel numbers can be read back from the console.
//   3. Teaching content: one NEW system per level (the ramp), and a defeat
//      diagnoser that turns a loss into a specific, actionable lesson.
//
// Everything here is view-side. It never touches the sim or its RNG.

import type { TowerKind } from './towers'

const FTUE_KEY = 'chromancer_ftue_v1'

export interface FtueData {
  steps: Record<string, boolean> // completed coach steps (e.g. 'l1-place')
  lessonsSeen: Record<string, boolean> // levelId -> level-lesson pill shown
  ttftLoadS?: number // first EVER tower: seconds from page load
  ttftBattleS?: number // first EVER tower: seconds into that battle
  firstWowS?: number // first EVER elemental reaction: seconds into battle
  defeats: number
  retries: number // same-seed retries taken after a defeat
}

function defaults(): FtueData {
  return { steps: {}, lessonsSeen: {}, defeats: 0, retries: 0 }
}

function load(): FtueData {
  try {
    const raw = localStorage.getItem(FTUE_KEY)
    if (!raw) return defaults()
    const o = JSON.parse(raw) as Partial<FtueData>
    const d = defaults()
    if (o.steps && typeof o.steps === 'object') d.steps = o.steps
    if (o.lessonsSeen && typeof o.lessonsSeen === 'object') d.lessonsSeen = o.lessonsSeen
    if (typeof o.ttftLoadS === 'number') d.ttftLoadS = o.ttftLoadS
    if (typeof o.ttftBattleS === 'number') d.ttftBattleS = o.ttftBattleS
    if (typeof o.firstWowS === 'number') d.firstWowS = o.firstWowS
    if (typeof o.defeats === 'number') d.defeats = o.defeats
    if (typeof o.retries === 'number') d.retries = o.retries
    return d
  } catch {
    return defaults()
  }
}

class Ftue {
  data: FtueData = load()

  private save(): void {
    try {
      localStorage.setItem(FTUE_KEY, JSON.stringify(this.data))
    } catch {
      // storage unavailable — the session still teaches, it just won't remember
    }
  }

  isDone(step: string): boolean {
    return this.data.steps[step] === true
  }
  markDone(step: string): void {
    if (this.data.steps[step]) return
    this.data.steps[step] = true
    this.save()
  }

  lessonSeen(levelId: string): boolean {
    return this.data.lessonsSeen[levelId] === true
  }
  markLessonSeen(levelId: string): void {
    if (this.data.lessonsSeen[levelId]) return
    this.data.lessonsSeen[levelId] = true
    this.save()
  }

  /** True until the player has ever placed a tower (drives the L1 live coach). */
  needsCoreTeach(): boolean {
    return this.data.ttftBattleS === undefined
  }

  // ---- instrumentation (each metric records only its FIRST-EVER occurrence) ----
  recordFirstTower(battleS: number): void {
    if (this.data.ttftBattleS !== undefined) return
    const loadS = Math.round(performance.now() / 100) / 10
    this.data.ttftBattleS = Math.round(battleS * 10) / 10
    this.data.ttftLoadS = loadS
    this.save()
    console.info(`[chromancer:ftue] time-to-first-tower: ${loadS}s from load · ${this.data.ttftBattleS}s into battle (KPI <20s)`)
  }
  recordFirstWow(battleS: number): void {
    if (this.data.firstWowS !== undefined) return
    this.data.firstWowS = Math.round(battleS * 10) / 10
    this.save()
    console.info(`[chromancer:ftue] first-wow reaction at ${this.data.firstWowS}s into battle (KPI <90s)`)
  }
  recordDefeat(): void {
    this.data.defeats++
    this.save()
  }
  recordRetry(): void {
    this.data.retries++
    this.save()
    console.info(`[chromancer:ftue] same-seed retry taken (${this.data.retries} total, ${this.data.defeats} defeats)`)
  }
}

export const ftue = new Ftue()

// QA/funnel access from the console: window.__chromancerFtue.data
declare global {
  interface Window {
    __chromancerFtue?: Ftue
  }
}
if (typeof window !== 'undefined') window.__chromancerFtue = ftue

// ---------------------------------------------------------------------------
//  THE RAMP — one new system per level, said in one breath at battle start.
//  l1 teaches live (the coach walks the hands); these pills cover l2+.
// ---------------------------------------------------------------------------
export interface LevelLesson {
  title: string
  body: string
}

export const LEVEL_LESSONS: Record<string, LevelLesson> = {
  l2: {
    title: 'NEW: BRUTES',
    body: 'Heavy armor shrugs off magic — slow them with Frost and let Cannon crack the shell.',
  },
  l3: {
    title: 'NEW: FLYERS',
    body: 'Only Storm and Arcane can hit the sky. Ground towers will watch them sail past.',
  },
  l4: {
    title: 'NEW: BULWARKS',
    body: 'Shields soak most damage until broken. Burst the shield fast — then they melt.',
  },
  l5: {
    title: 'NEW: MENDERS & SWARMS',
    body: 'Menders heal the pack — kill them first (targeting: Strong). Splash shreds swarms.',
  },
  l6: {
    title: 'THE HOLLOW THRONE',
    body: 'Everything he has, all at once. Reactions and fusions win this — pair your elements.',
  },
}

// ---------------------------------------------------------------------------
//  DEATH TEACHES — turn a loss into one specific, actionable lesson.
//  Priority: the most fixable cause first. Every lesson names a concrete move.
// ---------------------------------------------------------------------------
export interface DefeatDiagnosis {
  leakKinds: Record<string, number> // enemy kind -> how many reached the crystal
  towerKinds: TowerKind[] // kinds of towers standing at the end
  towersBuilt: number // total towers placed this run
  goldLeft: number // unspent gold at the moment of defeat
  hadAntiAir: boolean
  waveHadHealers: boolean // the wave that killed us contained menders
}

export function deathLesson(d: DefeatDiagnosis): string {
  const leaks = (k: string) => d.leakKinds[k] ?? 0
  const totalLeaks = Object.values(d.leakKinds).reduce((a, b) => a + b, 0)
  const dominant = Object.entries(d.leakKinds).sort((a, b) => b[1] - a[1])[0]?.[0]

  if (leaks('flyer') > 0 && !d.hadAntiAir) {
    return 'Flyers slipped past untouched — only STORM and ARCANE towers can hit the sky.'
  }
  if (d.waveHadHealers && totalLeaks > 0) {
    return 'Menders kept healing the pack. Select a tower and set targeting to STRONG to cut the healers down first.'
  }
  if (dominant === 'shielded') {
    return 'Bulwark shields soaked your damage. Focus fire to BREAK the shield first — slows buy the time.'
  }
  if (dominant === 'swarm') {
    return 'The swarm out-numbered your single-target damage. Flame splash (or a Mortar branch) shreds packs.'
  }
  if (dominant === 'boss') {
    return 'The Keeper out-lasted you. Pair two elements on one stretch — reactions like THERMAL SHOCK bite through anything.'
  }
  if (d.goldLeft >= 150) {
    return `You fell with $${Math.floor(d.goldLeft)} unspent. Gold in the bank protects nothing — spend it the moment you have it.`
  }
  if (d.towersBuilt < 4) {
    return 'Too few brushes on the canvas. More towers along every bend beats saving up — corners see the road twice.'
  }
  if (dominant === 'brute') {
    return 'Brutes are slow but tough. Stack Frost slows on them and UPGRADE your best tower — power spikes beat new cheap ones.'
  }
  return 'Same seed, same waves — you know their whole plan now. Place earlier, and upgrade the tower that kills the most.'
}
