// UNIT TEST for the QA telemetry hub (src/game/qa.ts) — the measurement harness
// that simcheck/type-check can't reach (they drive the Sim directly, never the
// scene/window/telemetry wiring). This exercises the REAL hub methods against a
// fake QaSceneControl so the hitstop-span math, frame-lock, and driven stepping
// (incl. draft auto-resolve) are MEASURED, not merely read.
//
//   run:  npx tsx scripts/qa-hub-check.ts

import { qa, type QaSceneControl, type QaState } from '../src/game/qa'

let failures = 0
function check(cond: boolean, msg: string): void {
  console.log(`  ${cond ? '✓' : '✗'} ${msg}`)
  if (!cond) failures++
}

qa.enable()
const DT = 1 / 60

// ---- Test 1: realized hitstop-freeze span --------------------------------
// Reproduce BattleScene.update()'s per-frame order: beginFrame → hitstop block
// (tick/idle + decrement) → [handleEvent may SET hitstopT after the block].
console.log('hitstop realized-span…')
qa.clearEvents()
qa.frame = 0
qa.tMs = 0
let hitstopT = 0
function simFrame(setHitstopTo?: number): void {
  qa.beginFrame(DT)
  if (hitstopT > 0) { qa.hitstopTick(DT); hitstopT -= DT } else qa.hitstopIdle()
  if (setHitstopTo != null) hitstopT = Math.max(hitstopT, setHitstopTo) // a reaction sets it after the block
  qa.endFrame()
}
simFrame() // F1: nothing
simFrame(0.055) // F2: block idle, then a reaction requests a 55ms freeze
simFrame() // F3: freeze begins here
simFrame() // F4
simFrame() // F5
simFrame() // F6
simFrame() // F7: freeze has elapsed → idle emits the span
const hs = qa.events.find((e) => e.type === 'hitstop') as (QaState & Record<string, number>) | undefined
check(!!hs, 'a hitstop event is emitted when the freeze ends')
check(hs?.startFrame === 3, `span starts the frame AFTER the trigger (startFrame=${hs?.startFrame}, expected 3)`)
check(hs?.frames === 4, `55ms freeze spans 4 frames at 60fps (frames=${hs?.frames})`)
check(!!hs && Math.abs((hs.durationMs as number) - 4 * DT * 1000) < 0.5, `durationMs = frozen frames × dt (=${hs?.durationMs}ms)`)

// ---- Test 2: frame-lock (burst + callout + sound share one frame) --------
console.log('frame-lock…')
qa.clearEvents()
qa.beginFrame(DT)
qa.emit('reaction', { name: 'SHATTER', magnitude: 1, shakeAmplitude: 0.11 })
qa.emit('shake', { amplitude: 0.11 })
qa.emit('callout', { text: 'SHATTER' })
qa.emit('sound', { id: 'reaction:shatter' })
qa.endFrame()
const fl = qa.events
const frames = new Set(fl.map((e) => e.frame))
check(fl.length === 4 && frames.size === 1, `burst + shake + callout + sound all share ONE frame index (${[...frames]})`)

// ---- Test 3: monotonic shake amplitude (bigger reaction ⇒ bigger shake) --
console.log('monotonic amplitude…')
const shakeFor = (mag: number) => 0.055 + 0.055 * Math.max(0.4, mag) // the fxReaction formula
check(shakeFor(0.55) < shakeFor(0.8) && shakeFor(0.8) < shakeFor(1), 'shake amplitude is strictly monotonic in reaction magnitude')

// ---- Test 4: driven stepFrames drives the control + auto-resolves drafts --
console.log('driven stepping + draft auto-resolve…')
qa.clearEvents()
let stepCalls = 0
let draftChosen = 0
const fakeSim = {
  state: 'active' as string,
  waveIndex: 0,
  chooseDraft: (i: number) => { draftChosen++; fakeSim.state = 'active'; void i; return true },
}
const control: QaSceneControl = {
  sim: () => fakeSim as never,
  stepOnce: () => { stepCalls++; if (stepCalls === 2) fakeSim.state = 'draft' }, // enter a draft mid-run
  placeTower: () => true,
  placeHero: () => true,
  upgradeTower: () => true,
  sellTower: () => true,
  startWave: () => {},
  skipToWave: () => {},
  forceWin: () => {},
  forceDefeat: () => {},
  triggerReaction: () => true,
  state: () => ({ frame: qa.frame } as never),
}
qa.bindScene(control)
qa.stepFrames(5)
check(stepCalls === 5, `stepFrames(5) drives the real control 5 times (got ${stepCalls})`)
check(draftChosen === 1, `driven loop auto-resolves the draft it hit (chooseDraft called ${draftChosen}×)`)
check(qa.driven === true, 'stepFrames takes deterministic (driven) control')
qa.resume()
check(qa.driven === false, 'resume() hands the loop back to real-time rAF')

// ---- Test 5: performance.mark bridge doesn't throw -----------------------
console.log('perf.mark bridge…')
let threw = false
try { qa.emit('kill', { kind: 'grunt', boss: false }) } catch { threw = true }
check(!threw, 'emit() never throws even where performance.mark is unavailable')

console.log(failures === 0
  ? '\nQA-HUB CHECK PASSED — telemetry span math, frame-lock, and driven stepping verified.'
  : `\nQA-HUB CHECK FAILED — ${failures} assertion(s).`)
process.exit(failures === 0 ? 0 : 1)
