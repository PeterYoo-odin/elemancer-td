// window.__chromancer — the public QA DRIVE surface.
//
// GATING GUARANTEE: installChromancer() is called from main.ts ONLY when the QA
// flag is present (?qa=1 / VITE_QA_HOOKS / dev). In a normal production load with
// no flag, this function is never called, so `window.__chromancer` is ABSENT and
// none of the drive/telemetry machinery ever activates. There is no other path
// that attaches it.
//
// Every method is async-friendly and deterministic: state changes are seed-driven
// and the render+view loop is advanced by a fixed dt via stepFrames, so hitstop
// and other view-only juice remain measurable (unlike a headless tab whose rAF
// frame gaps swing 100–950ms).

import type Phaser from 'phaser'
import { qa, type QaState } from './qa'
import { launchBattle } from '../ui/battleLoader'

export interface StartLevelOpts {
  levelId?: string // campaign level id, e.g. 'l1' (default), 'l2', … or 'demo'
  seed?: number // exact seed for a reproducible run
  heroId?: string // QA-only single-hero loadout override
  endless?: boolean // launch the endless/ranked scaffold instead of a campaign level
}

const TILE = 1000 / 60 // default fixed step (≈16.67ms) — one 60fps frame

export function installChromancer(game: Phaser.Game): void {
  if (!qa.enabled) return

  const api = {
    version: 1,

    // ---- live telemetry (read-only views onto the event bus) ----
    get events(): ReadonlyArray<unknown> { return qa.events },
    get frame(): number { return qa.frame },
    get driven(): boolean { return qa.driven },
    clearEvents: (): void => qa.clearEvents(),

    // ---- lifecycle ----
    async startLevel(opts: StartLevelOpts = {}): Promise<QaState> {
      const from = game.scene.getScenes(true)[0] ?? game.scene.getScenes(false)[0]
      if (!from) throw new Error('__chromancer: no scene available to launch a battle from')
      launchBattle(from, { levelId: opts.levelId, seedOverride: opts.seed, endless: opts.endless, qaHeroId: opts.heroId })
      const c = await qa.awaitScene()
      qa.driven = true // take deterministic control the moment the battle exists
      qa.stepOnce(TILE) // paint the first frame under the fixed clock
      return c.state()
    },

    // ---- board edits (by TILE coordinate {q,r}, never pixels) ----
    placeTower: (towerId: string, at: { q: number; r: number }): boolean => qa.requireScene().placeTower(towerId, at.q, at.r),
    placeHero: (heroId: string, at: { q: number; r: number }): boolean => qa.requireScene().placeHero(heroId, at.q, at.r),
    upgradeTower: (at: { q: number; r: number }): boolean => qa.requireScene().upgradeTower(at.q, at.r),
    sellTower: (at: { q: number; r: number }): boolean => qa.requireScene().sellTower(at.q, at.r),

    // ---- waves ----
    startWave: (): void => qa.requireScene().startWave(),
    async awaitWave(n: number): Promise<QaState> {
      await qa.awaitFrames(() => {
        const c = qa.scene()
        return !!c && c.sim().waveIndex + 1 >= n
      })
      return qa.requireScene().state()
    },
    setWave: (n: number): QaState => { const c = qa.requireScene(); c.skipToWave(n); return c.state() },
    skipToWave: (n: number): QaState => { const c = qa.requireScene(); c.skipToWave(n); return c.state() },
    // Draft waves (state === 'draft') pause the sim; driven stepping auto-picks card
    // 0 by default. Call this to choose a specific card, or set autoDraft(false) first.
    chooseDraft: (index = 0): boolean => qa.requireScene().sim().chooseDraft(index),
    autoDraft: (on: boolean): void => { qa.autoDraft = on },

    // ---- end screens ----
    forceWin: (): QaState => { const c = qa.requireScene(); c.forceWin(); qa.stepFrames(2); return c.state() },
    forceDefeat: (): QaState => { const c = qa.requireScene(); c.forceDefeat(); qa.stepFrames(2); return c.state() },

    // ---- juice ----
    triggerReaction: (name: string): boolean => qa.requireScene().triggerReaction(name),
    showPlacement: (on = true): void => qa.requireScene().showPlacement(on),

    // ---- state + deterministic stepping ----
    getState: (): QaState => qa.requireScene().state(),
    stepFrames: (n = 1, dtMs = TILE): QaState => qa.stepFrames(n, dtMs),
    resume: (): void => qa.resume(), // hand the loop back to real-time rAF
  }

  ;(window as unknown as { __chromancer?: typeof api }).__chromancer = api
}
