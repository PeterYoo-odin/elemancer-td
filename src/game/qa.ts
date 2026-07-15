// ============================================================================
// QA DRIVE + JUICE TELEMETRY  —  window.__chromancer
// ============================================================================
// A programmatic control + measurement surface for automated (blind-canvas)
// testing. It exists so "battle feel" is MEASURABLE — a tester can reach a dense
// wave, both end screens, and a specific reaction deterministically, and read a
// frame-indexed event log of every juice beat (hitstop / shake / callout / sound
// / kill / combo / reaction).
//
// GATING GUARANTEE (hard): this module is import-side-effect-free — importing it
// runs NO code beyond constructing an inert object (empty arrays, all flags
// false). Nothing here activates and `window.__chromancer` is NEVER attached
// unless the QA flag is set at boot (?qa=1, VITE_QA_HOOKS, or dev). Every
// instrumentation hook in the game is behind `if (qa.enabled)`, so a normal
// production load pays a single already-false boolean per potential hook and
// behaves byte-identically to a build without this file.
//
// ZERO SIM / BALANCE / ANTI-CHEAT IMPACT: the drive only READS sim state or calls
// QA-namespaced sim helpers (`qa*`) that are never wired into normal play. It
// never touches api/verify-run or the ranked replay recorder. QA runs are never
// ranked/recorded, so determinism and the provably-fair moat are untouched.
// ============================================================================

import type { Sim } from '../sim'

export interface QaEvent {
  type: 'reaction' | 'hitstop' | 'shake' | 'callout' | 'sound' | 'kill' | 'combo'
  name?: string
  frame: number // frame index (increments once per rendered update, incl. frozen frames)
  tMs: number // accumulated real frame time in ms (advances during a freeze too)
  [k: string]: unknown
}

export interface QaTowerState {
  id: number
  kind: string
  col: number
  row: number
  level: number
}

// Runtime read of what's actually bound to the ground/path terrain materials'
// `.map` right now — NOT an optimistically-set flag. 'realm-png'/'path-png' only
// when the painted texture load genuinely resolved; 'fallback-atlas' whenever the
// board is (still, or permanently) rendering the old Kenney kit atlas instead.
export interface QaBoardTexture {
  realm: string
  ground: 'realm-png' | 'fallback-atlas'
  path: 'path-png' | 'fallback-atlas'
}

export interface QaState {
  wave: number // 1-based, as the HUD shows it
  waveTotal: number // Infinity for endless
  state: string // 'prep' | 'active' | 'draft' | 'won' | 'lost'
  baseHp: number
  baseIntegrity: number // 0..1
  gold: number
  mana: number | null // sim is a gold-only economy — mana does not exist, reported null
  aliveEnemies: number
  towers: QaTowerState[]
  comboMult: number
  comboCount: number
  draftOffer: string[] // card titles offered while state === 'draft' (else empty)
  currentReaction: string | null // most-recent reaction name this run (view-side)
  frame: number
  driven: boolean
  boardTexture: QaBoardTexture
}

// The controlled surface a BattleScene hands to the drive. Keeps the scene's
// private fields private while giving QA exactly the verbs it needs.
export interface QaSceneControl {
  sim(): Sim
  stepOnce(dtMs: number): void // drives the REAL render+view loop one frame at a fixed dt
  placeTower(kind: string, col: number, row: number): boolean
  placeHero(heroId: string, col: number, row: number): boolean
  upgradeTower(col: number, row: number): boolean
  sellTower(col: number, row: number): boolean
  startWave(): void
  skipToWave(n: number): void
  forceWin(): void
  forceDefeat(): void
  triggerReaction(name: string): boolean
  showPlacement(on: boolean): void // toggle buildable-cell highlights (visual QA)
  state(): QaState
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

class Qa {
  enabled = false
  // When driven, Phaser's own rAF frames are IGNORED for the battle loop; only
  // stepOnce() advances the loop, at a fixed dt — so a 40–70ms hitstop is timed
  // against a known clock instead of the 100–950ms frame gaps of a headless tab.
  driven = false
  stepping = false // true only while inside a driven stepOnce()
  // Draft waves put the sim in 'draft', where step() early-returns — so a driven
  // loop would stall forever. Auto-resolve with card 0 (deterministic) so stepping
  // always makes progress. Testers wanting a specific card set this false and call
  // chooseDraft() themselves.
  autoDraft = true

  events: QaEvent[] = []
  frame = 0
  tMs = 0
  lastReaction: string | null = null

  private control: QaSceneControl | null = null
  private sceneWaiters: Array<(c: QaSceneControl) => void> = []
  private frameWaiters: Array<{ pred: () => boolean; resolve: () => void; deadline: number }> = []

  // realized hitstop-freeze span tracking (measured, not requested — overlapping
  // reactions EXTEND the freeze via Math.max, so we time the actual frozen span)
  private hsOpen = false
  private hsStartFrame = 0
  private hsStartMs = 0
  private hsAccMs = 0
  private hsFrames = 0

  enable(): void {
    this.enabled = true
  }

  // ---- telemetry ----------------------------------------------------------
  emit(type: QaEvent['type'], data: Record<string, unknown>): void {
    if (!this.enabled) return
    const ev: QaEvent = { type, frame: this.frame, tMs: Math.round(this.tMs * 100) / 100, ...data }
    this.events.push(ev)
    if (this.events.length > 8000) this.events.splice(0, this.events.length - 8000)
    try {
      // performance.mark makes each beat visible in a browser/Playwright trace too.
      performance.mark(`chromancer:${type}`, { detail: ev })
    } catch {
      /* performance.mark unsupported / detail rejected — telemetry array still holds it */
    }
  }

  clearEvents(): void {
    this.events.length = 0
  }

  // ---- frame lifecycle (called from BattleScene.update) -------------------
  // Returns true when Phaser's auto-driven frame should be skipped (driven mode,
  // outside a stepOnce). Keeps the deterministic clock the ONLY thing advancing.
  skipAutoFrame(): boolean {
    return this.driven && !this.stepping
  }

  beginFrame(dtSec: number): void {
    this.frame++
    this.tMs += dtSec * 1000
  }

  endFrame(): void {
    if (!this.frameWaiters.length) return
    const t = now()
    const still: typeof this.frameWaiters = []
    for (const w of this.frameWaiters) {
      if (w.pred()) w.resolve()
      else if (t >= w.deadline) w.resolve() // resolve on timeout too — caller re-checks state()
      else still.push(w)
    }
    this.frameWaiters = still
  }

  // hitstop realized-span probe — called every frame with the pre-decrement timer.
  hitstopTick(dtSec: number): void {
    if (!this.hsOpen) {
      this.hsOpen = true
      this.hsStartFrame = this.frame
      this.hsStartMs = this.tMs
      this.hsAccMs = 0
      this.hsFrames = 0
    }
    this.hsAccMs += dtSec * 1000
    this.hsFrames++
  }

  hitstopIdle(): void {
    if (!this.hsOpen) return
    this.hsOpen = false
    this.emit('hitstop', {
      startFrame: this.hsStartFrame,
      startMs: Math.round(this.hsStartMs * 100) / 100,
      durationMs: Math.round(this.hsAccMs * 100) / 100,
      frames: this.hsFrames,
    })
  }

  // ---- scene registration -------------------------------------------------
  bindScene(c: QaSceneControl): void {
    this.control = c
    const waiters = this.sceneWaiters
    this.sceneWaiters = []
    for (const r of waiters) r(c)
  }

  unbindScene(c: QaSceneControl): void {
    if (this.control === c) this.control = null
  }

  scene(): QaSceneControl | null {
    return this.control
  }

  awaitScene(timeoutMs = 10000): Promise<QaSceneControl> {
    if (this.control) return Promise.resolve(this.control)
    return new Promise((resolve, reject) => {
      let done = false
      this.sceneWaiters.push((c) => {
        done = true
        resolve(c)
      })
      setTimeout(() => {
        if (!done) reject(new Error('qa: battle scene did not become ready'))
      }, timeoutMs)
    })
  }

  requireScene(): QaSceneControl {
    if (!this.control) throw new Error('qa: no active battle — call startLevel() first')
    return this.control
  }

  // ---- deterministic stepping --------------------------------------------
  stepOnce(dtMs: number): void {
    const c = this.control
    if (!c) return
    // Clear a draft gate before the frame so the driven loop never stalls on it.
    if (this.autoDraft) {
      const s = c.sim()
      if (s.state === 'draft') s.chooseDraft(0)
    }
    this.stepping = true
    try {
      c.stepOnce(dtMs)
    } finally {
      this.stepping = false
    }
  }

  // Advance the REAL render+view loop n frames at a fixed dt. Takes deterministic
  // control (driven) on first call so wall-clock frame gaps stop mattering.
  stepFrames(n = 1, dtMs = 1000 / 60): QaState {
    const c = this.requireScene()
    this.driven = true
    for (let i = 0; i < n; i++) this.stepOnce(dtMs)
    return c.state()
  }

  // Hand the loop back to Phaser's real-time rAF (resume live play).
  resume(): void {
    this.driven = false
  }

  // Step until a predicate holds (or a frame budget is spent). Deterministic when
  // driven; when live it services on real frames via endFrame().
  async awaitFrames(pred: () => boolean, opts: { dtMs?: number; maxFrames?: number; timeoutMs?: number } = {}): Promise<boolean> {
    const dtMs = opts.dtMs ?? 1000 / 60
    const maxFrames = opts.maxFrames ?? 60 * 60 * 10 // 10 sim-minutes of frames, hard cap
    if (this.driven || !this.control) {
      // deterministic: drive frames ourselves
      let i = 0
      while (!pred() && i < maxFrames) {
        this.stepOnce(dtMs)
        i++
      }
      return pred()
    }
    // live: resolve when a real frame satisfies pred (or timeout)
    const timeoutMs = opts.timeoutMs ?? 30000
    await new Promise<void>((resolve) => {
      this.frameWaiters.push({ pred, resolve, deadline: now() + timeoutMs })
    })
    return pred()
  }
}

// Constructing this object is the ONLY thing that happens at import time — no DOM,
// no window, no timers, no listeners. Fully inert until qa.enable() is called.
export const qa = new Qa()

// True when the QA hooks should activate. Read once at boot by installChromancer.
export function qaFlagPresent(): boolean {
  try {
    const q = new URLSearchParams(location.search)
    const v = q.get('qa')
    if (v !== null && v !== '0' && v !== 'false') return true
  } catch {
    /* no location (SSR/worker) */
  }
  try {
    // Vite build-time flag + dev mode.
    const env = (import.meta as unknown as { env?: Record<string, unknown> }).env
    if (env?.VITE_QA_HOOKS) return true
    if (env?.DEV) return true
  } catch {
    /* no import.meta.env */
  }
  return false
}
