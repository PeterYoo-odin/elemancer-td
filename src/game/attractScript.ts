// ATTRACT / DEMO REEL SCRIPT — a hand-authored, DETERMINISTIC playthrough of the
// Ember Vale demo level, expressed as sim commands keyed to the sim clock. The
// runner injects each command on an exact fixed-step boundary (via Sim.advance's
// beforeStep hook), so the same seed + script replays identically at any frame
// rate or ?speed= — that's what makes it usable as trailer footage, the landing
// hero, AND the hands-free demo. Pure: zero DOM/Phaser imports; simcheck runs
// the whole script headless and asserts the money-shot beats actually land.

import { Sim, type SimConfig } from '../sim'
import { NEUTRAL } from './workshop'
import { DEMO_LEVEL } from './levels'
import { codeToSeed } from './seedcode'
import type { TowerKind } from './towers'

// The hand-picked showcase seed (also the default ?demo=1 seed) — the first
// seed code anyone will ever see, so it spells the game's own name-realm.
export const DEMO_SEED_CODE = 'EMBER-FOX-42'
export const DEMO_SEED = codeToSeed(DEMO_SEED_CODE) ?? 42

// Fixed party for the scripted reel: footage must not depend on the viewer's
// save. (A live demo run uses the player's own party instead.)
export const DEMO_PARTY = [
  { heroId: 'ember', level: 2 },
  { heroId: 'glacia', level: 2 },
  { heroId: 'sylvan', level: 2 },
]

// The frost tower a LIVE demo pre-places for the player (the guaranteed-SHATTER
// setup: Frost is waiting — the player adds Storm). The script builds the same
// chokepoint itself.
export const DEMO_FROST_CELL = { col: 5, row: 3 }

export function demoSimConfig(seed: number = DEMO_SEED, party = DEMO_PARTY): SimConfig {
  return {
    level: DEMO_LEVEL,
    mods: { ...NEUTRAL }, // demo runs are provably fair: no meta modifiers, ever
    seed,
    endless: false,
    startGold: DEMO_LEVEL.startGold,
    startLives: DEMO_LEVEL.startLives,
    party,
  }
}

// ---------------------------------------------------------------------------
//  Command timeline
// ---------------------------------------------------------------------------

export type DemoCmd =
  | { at: number; kind: 'place'; tower: TowerKind; col: number; row: number; until?: number }
  | { at: number; kind: 'upgrade'; col: number; row: number; until?: number }
  | { at: number; kind: 'branch'; col: number; row: number; idx: number; until?: number }
  | { at: number; kind: 'deployHero'; heroId: string; col: number; row: number; until?: number }
  | { at: number; kind: 'heroSpell'; heroId: string; x: number; y: number; until?: number }
  | { at: number; kind: 'targeting'; col: number; row: number; mode: 'First' | 'Last' | 'Close' | 'Strong'; until?: number }
  | { at: number; kind: 'startWave'; until?: number }
  | { at: number; kind: 'draftPick'; index: number; until?: number }

// Executes due commands with bounded retries (a command that can't afford its
// gold yet simply tries again next tick until its window closes). Everything is
// a pure function of sim state, so retries are deterministic too.
export class ScriptRunner {
  private done: boolean[]
  constructor(private cmds: DemoCmd[]) {
    this.done = cmds.map(() => false)
  }

  finished(): boolean {
    return this.done.every(Boolean)
  }

  /** Call once before every sim.step(). allowDraftPick lets the view hold the
   *  draft open for a beat (the sim clock is frozen in draft, so the hold never
   *  desyncs the timeline). */
  update(sim: Sim, allowDraftPick = true): void {
    for (let i = 0; i < this.cmds.length; i++) {
      if (this.done[i]) continue
      const c = this.cmds[i]
      if (c.kind === 'draftPick') {
        // fires on state, not clock (the clock freezes during a draft)
        if (sim.state === 'draft' && allowDraftPick) {
          this.done[i] = sim.chooseDraft(Math.min(c.index, sim.draftOffer.length - 1))
        }
        continue
      }
      if (sim.clock < c.at) continue
      const until = c.until ?? c.at + 15
      if (sim.clock > until) { this.done[i] = true; continue } // window closed — skip
      this.done[i] = this.exec(sim, c)
    }
  }

  private exec(sim: Sim, c: DemoCmd): boolean {
    switch (c.kind) {
      case 'place':
        return sim.placeTower(c.tower, c.col, c.row) !== null
      case 'upgrade': {
        const t = sim.towerAt(c.col, c.row)
        return t ? sim.upgradeTower(t.id) : false
      }
      case 'branch': {
        const t = sim.towerAt(c.col, c.row)
        return t ? sim.chooseBranch(t.id, c.idx) : false
      }
      case 'deployHero':
        return sim.deployHero(c.heroId, c.col, c.row) !== null
      case 'heroSpell': {
        for (const h of sim.deployedHeroes()) {
          if (h.heroId === c.heroId) return h.spellCd <= 0 ? sim.castHeroSpell(h.id, c.x, c.y) : false
        }
        return false
      }
      case 'targeting': {
        const t = sim.towerAt(c.col, c.row)
        if (!t) return false
        sim.setTargeting(t.id, c.mode)
        return true
      }
      case 'startWave': {
        if (sim.state !== 'prep') return false
        sim.startWave()
        return true
      }
      default:
        return true // draftPick is handled in update(); nothing else reaches here
    }
  }
}

// Cell → sim px helper for spell targets (mirrors sim/layout cellCenter).
const px = (col: number, row: number) => ({ x: col * 80 + 40, y: 200 + row * 80 + 40 })

// THE SHOWCASE RUN. Beats (verified headless by simcheck):
//   W1  first tower up in <2s, runners melt (power fantasy)
//   W2  pressure builds, cannon takes the second lane
//   W3  Frost + Storm chokepoint → GUARANTEED SHATTER cascade (<90s money shot)
//   W4  draft pick (the roguelite hook), Ashka joins, board flexes
//   W5  mini-Keeper + swarm tide → fireball + frost nova → near-loss win
// NOTE ON PACING: only W1 gets a scripted start — every later wave launches on
// the sim's own 7s prep auto-timer (exactly what a live player gets), so the
// scripted timeline below is keyed to the natural wave rhythm.
export const DEMO_SCRIPT: DemoCmd[] = [
  // -- opening build (first tower placeable <15s: it's up before the wave).
  //    Cannon + frost only: NO elemental pair yet, so the run's very first
  //    reactions are the W3 SHATTERs — the wow lands unpolluted.
  { at: 0.6, kind: 'place', tower: 'cannon', col: 4, row: 1 },
  { at: 2.4, kind: 'place', tower: 'frost', col: DEMO_FROST_CELL.col, row: DEMO_FROST_CELL.row },
  { at: 4.0, kind: 'startWave' },
  // -- W2 prep (~t21): a second cannon takes the middle lanes
  { at: 22, kind: 'place', tower: 'cannon', col: 4, row: 3, until: 45 },
  // -- W3 prep (~t40): add STORM beside the frost — Water tag + Storm hit = SHATTER
  { at: 40, kind: 'place', tower: 'storm', col: 7, row: 4, until: 62 },
  // -- draft after W3 clears (index tuned to the seeded offer: Fire Focus) --
  { at: 0, kind: 'draftPick', index: 2 },
  // -- W4 prep (~t75): fire enters the palette, Ashka joins the line --
  { at: 70, kind: 'place', tower: 'flame', col: 2, row: 1, until: 100 },
  { at: 74, kind: 'deployHero', heroId: 'ember', col: 3, row: 1, until: 105 },
  // -- W5 (~t110+): the tide hits, and the BOTTOM THIRD of the path is naked.
  //    Leaks trickle for twenty seconds — that's the near-loss the demo is for.
  // -- W5 (~t115+): the tide HITS an under-built board — the leaks are the drama.
  // -- W5 clutch turn (~t133, lives bleeding): everything lands at once --
  { at: 130, kind: 'place', tower: 'cannon', col: 4, row: 6, until: 175 }, // the back line, at last
  { at: 132, kind: 'upgrade', col: 4, row: 6, until: 178 }, // → lv2
  { at: 131, kind: 'deployHero', heroId: 'glacia', col: 5, row: 6, until: 180 },
  { at: 135, kind: 'upgrade', col: 4, row: 6, until: 182 }, // back cannon → lv3
  { at: 136, kind: 'targeting', col: 4, row: 6, mode: 'Strong', until: 182 }, // …it LOCKS ONTO the Keeper
  { at: 135, kind: 'deployHero', heroId: 'sylvan', col: 6, row: 3, until: 185 },
  { at: 136, kind: 'heroSpell', heroId: 'ember', ...px(2, 5), until: 190 }, // fireball the Keeper at the turn
  { at: 138, kind: 'branch', col: 4, row: 6, idx: 0, until: 200 }, // → SNIPER: the Keeper-killer
  { at: 141, kind: 'upgrade', col: 7, row: 4, until: 205 }, // storm → lv3
  { at: 147, kind: 'branch', col: 7, row: 4, idx: 0, until: 225 }, // storm → TEMPEST (the save)
  { at: 150, kind: 'heroSpell', heroId: 'glacia', ...px(2, 8), until: 215 }, // freeze the tide at the gate
]

// ---------------------------------------------------------------------------
//  Headless verification (used by scripts/simcheck.ts)
// ---------------------------------------------------------------------------

export interface DemoRunReport {
  won: boolean
  lives: number
  clock: number
  score: number
  shatterAt: number // sim clock of the FIRST Shatter reaction (-1 = never)
  reactions: number
  maxCombo: number
  waveStarts: number[] // clock at each wave's activation
  draftTitles: string[] // the seeded draft offer (for tuning the pick index)
  fingerprint: string
}

export function runScriptedDemo(seed: number = DEMO_SEED): DemoRunReport {
  const sim = new Sim(demoSimConfig(seed))
  const runner = new ScriptRunner(DEMO_SCRIPT)
  const report: DemoRunReport = {
    won: false, lives: 0, clock: 0, score: 0, shatterAt: -1, reactions: 0,
    maxCombo: 0, waveStarts: [], draftTitles: [], fingerprint: '',
  }
  let lastState = ''
  let steps = 0
  const cap = 60 * 60 * 20 // 20 sim-minutes hard cap
  while (sim.state !== 'won' && sim.state !== 'lost' && steps < cap) {
    runner.update(sim)
    if (sim.state === 'draft') {
      // runner should have picked; if the script has no pick left, take card 0
      if (sim.state === 'draft') sim.chooseDraft(0)
      continue
    }
    if (sim.state === 'active' && lastState !== 'active') report.waveStarts.push(sim.clock)
    lastState = sim.state
    sim.step()
    steps++
    for (const ev of sim.drainEvents()) {
      if (ev.t === 'reaction' && ev.key === 'shatter' && report.shatterAt < 0) report.shatterAt = sim.clock
      if (ev.t === 'banner' && ev.msg === 'CHOOSE A POWER') {
        report.draftTitles = sim.draftOffer.map((c) => c.title)
      }
    }
  }
  report.won = sim.state === 'won'
  report.lives = sim.lives
  report.clock = sim.clock
  report.score = sim.score()
  report.reactions = sim.runStats.reactions
  report.maxCombo = sim.runStats.maxCombo
  report.fingerprint = `${sim.state}|${sim.waveIndex}|${sim.gold}|${sim.lives}|${sim.clock.toFixed(3)}|${sim.runStats.kills}|${sim.runStats.reactions}`
  return report
}
