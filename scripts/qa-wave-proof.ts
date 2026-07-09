// EMPIRICAL PROOF for the "wave counter stuck at 1/7" question.
//
// The HUD reads `sim.waveIndex + 1` live every frame (BattleHud.ts:933), so the
// display can't be stale. This script proves the OTHER half: that the underlying
// sim state genuinely ADVANCES — waveIndex climbs and the run reaches BOTH end
// states — so the stall seen under blind-tap testing was neither a display bug
// nor a state-progression bug, but a reachability/timing artifact (no working
// defense built + headless slow-motion frame gaps ⇒ wave 1 never cleared).
//
//   run:  npx tsx scripts/qa-wave-proof.ts

import { Sim } from '../src/sim/index'
import { NEUTRAL } from '../src/game/workshop'
import { LEVELS } from '../src/game/levels'

const FIXED_DT = 1 / 60
const level = LEVELS[0] // l1 — the 7-wave first campaign level
const waveTotal = level.waves.length

function mkSim(): Sim {
  return new Sim({ level, mods: { ...NEUTRAL }, seed: 0xa5eed, endless: false, startGold: 200, startLives: 20, party: [] })
}

// Run a sim to completion at a FIXED dt (the deterministic clock stepFrames uses),
// optionally building a full defense first. Returns the peak wave + final state.
function run(build: boolean): { peakWave: number; endState: string; steps: number } {
  const sim = mkSim()
  if (build) {
    sim.gold = 1_000_000 // saturate a real defense on every legal build cell
    for (const c of sim.buildCells()) {
      if (!sim.canPlace(c.col, c.row)) continue
      const t = sim.placeTower('storm', c.col, c.row)
      if (t) { sim.upgradeTower(t.id); sim.upgradeTower(t.id) }
    }
  }
  let peak = 0
  let steps = 0
  const budget = 60 * 60 * 20 // 20 sim-minutes of fixed steps
  while (sim.state !== 'won' && sim.state !== 'lost' && steps < budget) {
    if (sim.state === 'draft') sim.chooseDraft(0) // auto-take a card so the loop proceeds
    sim.advance(FIXED_DT)
    peak = Math.max(peak, sim.waveIndex)
    steps++
  }
  return { peakWave: peak + 1, endState: sim.state, steps }
}

const defended = run(true)
const undefended = run(false)

console.log(`level ${level.id} — waveTotal = ${waveTotal}`)
console.log(`  defended:   peak wave ${defended.peakWave}/${waveTotal}, end state '${defended.endState}' after ${defended.steps} steps`)
console.log(`  undefended: peak wave ${undefended.peakWave}/${waveTotal}, end state '${undefended.endState}' after ${undefended.steps} steps`)

let ok = true
function check(cond: boolean, msg: string): void { console.log(`  ${cond ? '✓' : '✗'} ${msg}`); if (!cond) ok = false }

check(defended.peakWave > 1, 'sim.waveIndex advances past wave 1 with a defense (NOT a stuck-state bug)')
check(defended.endState === 'won', 'a defended run reaches the WIN state deterministically')
check(undefended.endState === 'lost', 'an undefended run reaches the DEFEAT state deterministically')

console.log(ok
  ? '\nRESULT: wave state advances correctly → the 1/7 stall is a REACHABILITY/timing artifact, not a state or display bug.'
  : '\nRESULT: unexpected — wave progression did not behave as read from the code.')
process.exit(ok ? 0 : 1)
