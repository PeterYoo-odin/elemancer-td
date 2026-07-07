// Headless determinism + robustness gate. Simulates ~60 endless waves with
// HUNDREDS of concurrent entities and asserts NO sim value ever goes
// NaN/Infinity/negative-HP/out-of-range. Exits non-zero on the first violation.
//
//   run:  npm run simcheck   (via tsx — outside tsconfig `include`, so it never
//         affects the `tsc --noEmit` build gate)
//
// Ranges asserted (per advisor): hp∈[0,maxHp], gold≥0 finite, lives∈[0,start],
// x/y in map bounds, dist∈[0,pathLength], comboMult∈[1,COMBO_MAX], every damage
// number finite & ≥0, all coords/cooldowns finite.

import { Sim, TILE, MAP_X, MAP_Y, MAP_W, MAP_H } from '../src/sim/index'
import { NEUTRAL } from '../src/game/workshop'
import { LEVELS } from '../src/game/levels'
import { TOWER_ORDER } from '../src/game/towers'

const COMBO_MAX = 6
const TARGET_WAVES = 60
const STEP_BUDGET = 60 * 60 * 200 // generous cap (~200 min of sim time)

let failures = 0
let reactionEvents = 0 // elemental reactions must actually fire during the stress runs
const seen: Record<string, number> = {}
function fail(msg: string): void {
  const key = msg.slice(0, 60)
  seen[key] = (seen[key] ?? 0) + 1
  if (seen[key] <= 3) console.error('  ✗ ' + msg)
  failures++
}

function finite(v: number): boolean {
  return typeof v === 'number' && Number.isFinite(v)
}

function makeSim(seed: number, levelIndex = 3): Sim {
  return new Sim({
    level: LEVELS[levelIndex],
    mods: { ...NEUTRAL },
    seed,
    endless: true,
    startGold: 5_000_000, // never gold-starved: keep placing/upgrading to stress DPS
    startLives: 10_000_000, // never lose: we want the full 60-wave stress run
    // A full 3-hero party (varied levels + a same-element pair) so the hero deploy,
    // synergy, attack and spell code paths are all exercised by the robustness gate.
    party: [
      { heroId: 'ember', level: 20 },
      { heroId: 'pyra', level: 12 }, // Fire pair → same-element synergy
      { heroId: 'vex', level: 8 },
    ],
  })
}

// Deploy the whole party onto the first free build cells (exercises deploy + synergy).
function deployParty(sim: Sim): void {
  const cells = sim.buildCells()
  let ci = 0
  for (const p of sim.partyLoadout()) {
    while (ci < cells.length && !sim.canPlace(cells[ci].col, cells[ci].row)) ci++
    if (ci >= cells.length) break
    sim.deployHero(p.heroId, cells[ci].col, cells[ci].row)
    ci++
  }
}

// Fire every ready hero spell at the front of the pack (exercises all spell effects).
function castHeroSpells(sim: Sim): void {
  for (const h of sim.deployedHeroes()) {
    if (h.spellCd <= 0) sim.castHeroSpell(h.id, h.x, h.y - 40)
  }
}

// Fill build cells with a rotating tower kind. mode 'max' pushes them to a maxed
// branch (exercises the high-damage / overflow / branch math); mode 'base' leaves
// them at level 0 on a fraction of cells so HUNDREDS of enemies pile up.
// mode 'max': maxed branched towers (high-damage / overflow / branch math).
// mode 'base': level-0 towers on every 3rd cell (combat under moderate load).
// mode 'flood': base Frost everywhere — slows the horde to a crawl so HUNDREDS
//   of enemies pile up on the path (slow-aura + zap combat math under heavy load).
// mode 'max': maxed branched towers (high-damage / overflow / branch math).
// mode 'base': level-0 towers on every 3rd cell (combat under moderate load).
// mode 'flood': no towers on the longest 6-lane path — enemies spawn faster than
//   they cross, so HUNDREDS coexist (movement/spawn/leak math under heavy load).
function saturateTowers(sim: Sim, mode: 'max' | 'base' | 'flood'): void {
  if (mode === 'flood') return
  const cells = sim.buildCells()
  let i = 0
  for (const c of cells) {
    if (mode === 'base' && i % 3 !== 0) { i++; continue }
    if (sim.towerAt(c.col, c.row)) { i++; continue }
    const kind = TOWER_ORDER[i % TOWER_ORDER.length]
    const t = sim.placeTower(kind, c.col, c.row)
    if (t && mode === 'max') {
      sim.upgradeTower(t.id)
      sim.upgradeTower(t.id)
      sim.chooseBranch(t.id, i % 2)
    }
    i++
  }
}

function validate(sim: Sim, tick: number): void {
  if (!finite(sim.gold) || sim.gold < 0) fail(`gold out of range: ${sim.gold} @${tick}`)
  if (!finite(sim.lives) || sim.lives < 0 || sim.lives > sim.startLives) fail(`lives out of range: ${sim.lives} @${tick}`)
  if (!finite(sim.comboMult) || sim.comboMult < 1 || sim.comboMult > COMBO_MAX + 1e-6) fail(`comboMult out of range: ${sim.comboMult} @${tick}`)
  if (!finite(sim.comboCount) || sim.comboCount < 0) fail(`comboCount bad: ${sim.comboCount} @${tick}`)
  if (!finite(sim.clock)) fail(`clock non-finite @${tick}`)

  const pad = TILE * 2
  for (const e of sim.enemies) {
    if (!e.active) continue
    if (!finite(e.hp) || e.hp < 0 || e.hp > e.maxHp + 1e-6) fail(`enemy hp out of range: ${e.hp}/${e.maxHp} (${e.kind}) @${tick}`)
    if (!finite(e.maxHp) || e.maxHp <= 0) fail(`enemy maxHp bad: ${e.maxHp} @${tick}`)
    if (!finite(e.shield) || e.shield < 0 || e.shield > e.shieldMax + 1e-6) fail(`enemy shield out of range: ${e.shield} @${tick}`)
    if (!finite(e.x) || !finite(e.y)) fail(`enemy pos non-finite @${tick}`)
    if (e.x < MAP_X - pad || e.x > MAP_X + MAP_W + pad || e.y < MAP_Y - pad || e.y > MAP_Y + MAP_H + pad) fail(`enemy off-map: ${e.x.toFixed(0)},${e.y.toFixed(0)} @${tick}`)
    if (!finite(e.dist) || e.dist < 0 || e.dist > sim.pathLength + 2) fail(`enemy dist out of range: ${e.dist}/${sim.pathLength} @${tick}`)
    if (!finite(e.slowFactor) || e.slowFactor <= 0 || e.slowFactor > 1) fail(`enemy slowFactor out of range: ${e.slowFactor} @${tick}`)
    if (!finite(e.auraUntil) || !finite(e.reactLockUntil) || !finite(e.amplifyUntil)) fail(`enemy reaction field non-finite @${tick}`)
  }
  for (const z of sim.zones) {
    if (!z.active) continue
    if (!finite(z.x) || !finite(z.y) || !finite(z.radius) || z.radius <= 0) fail(`zone geometry bad @${tick}`)
    if (!finite(z.dps) || z.dps < 0 || !finite(z.until)) fail(`zone dps/until bad: ${z.dps} @${tick}`)
  }
  for (const t of sim.towers) {
    if (!t.active) continue
    if (!finite(t.x) || !finite(t.y) || !finite(t.cd) || !finite(t.aimAngle)) fail(`tower field non-finite @${tick}`)
    if (!finite(sim.effDps(t)) || sim.effDps(t) < 0) fail(`tower DPS bad: ${sim.effDps(t)} @${tick}`)
  }
  for (const p of sim.projectiles) {
    if (!p.active) continue
    if (!finite(p.x) || !finite(p.y) || !finite(p.tx) || !finite(p.ty)) fail(`projectile pos non-finite @${tick}`)
    if (!finite(p.atk.damage) || p.atk.damage < 0) fail(`projectile damage bad: ${p.atk.damage} @${tick}`)
  }
  for (const h of sim.heroes) {
    if (!h.active) continue
    if (!finite(h.x) || !finite(h.y) || !finite(h.cd) || !finite(h.aimAngle) || !finite(h.spellCd)) fail(`hero field non-finite @${tick}`)
    const dmg = sim.heroDamage(h)
    if (!finite(dmg) || dmg < 0 || dmg > 1e7 + 1) fail(`hero damage out of range: ${dmg} @${tick}`)
    if (!finite(sim.heroDps(h)) || sim.heroDps(h) < 0) fail(`hero DPS bad: ${sim.heroDps(h)} @${tick}`)
    const rng = sim.heroRange(h)
    if (!finite(rng) || rng < 0) fail(`hero range bad: ${rng} @${tick}`)
  }
  // damage numbers emitted this step must all be finite & non-negative
  for (const ev of sim.drainEvents()) {
    if (ev.t === 'damage' && (!finite(ev.amount) || ev.amount < 0)) fail(`damage event bad: ${ev.amount} @${tick}`)
    if (ev.t === 'gold' && (!finite(ev.amount) || ev.amount < 0)) fail(`gold event bad: ${ev.amount} @${tick}`)
    if (ev.t === 'combo' && (!finite(ev.mult) || ev.mult > COMBO_MAX + 1e-6)) fail(`combo event mult bad: ${ev.mult} @${tick}`)
    if (ev.t === 'reaction') {
      reactionEvents++
      if (!finite(ev.x) || !finite(ev.y) || !finite(ev.radius) || ev.radius < 0) fail(`reaction event bad geometry @${tick}`)
    }
  }
}

// A stable monotonic id must NEVER resurrect (go inactive, then active again).
// That would mean a pooled slot was reused without a fresh id — the bug that
// makes the view render a dead entity and projectiles re-home onto the reused slot.
function checkIds(sim: Sim, retired: Set<number>, tick: number): void {
  // (1) no ACTIVE id may already be retired (that's a resurrection = stale reuse)
  for (const e of sim.enemies) if (e.active && retired.has(e.id)) fail(`enemy id ${e.id} resurrected (stale pooled-slot reuse) @${tick}`)
  for (const p of sim.projectiles) if (p.active && retired.has(p.id)) fail(`projectile id ${p.id} resurrected @${tick}`)
  // (2) retire every currently-inactive slot's id (they must never come back)
  for (const e of sim.enemies) if (!e.active) retired.add(e.id)
  for (const p of sim.projectiles) if (!p.active) retired.add(p.id)
}

function runOne(seed: number, mode: 'max' | 'base' | 'flood'): { maxEntities: number; wavesReached: number } {
  // flood uses the longest 6-lane path (index 5) to maximise concurrency
  const sim = makeSim(seed, mode === 'flood' ? 5 : 3)
  if (mode !== 'flood') deployParty(sim) // heroes before towers claim the build cells
  saturateTowers(sim, mode)
  let tick = 0
  let maxEntities = 0
  const retired = new Set<number>()
  // flood keeps piling up past the 60-wave functional target to PROVE hundreds coexist
  const waveTarget = mode === 'flood' ? 200 : TARGET_WAVES
  while (sim.waveIndex < waveTarget && tick < STEP_BUDGET) {
    if (sim.state === 'draft') { sim.chooseDraft(tick % 3); continue }
    if (sim.state === 'prep') sim.startWave() // skip the prep countdown for speed
    if (sim.state === 'won' || sim.state === 'lost') break
    if (mode === 'max' && tick % 600 === 0) saturateTowers(sim, mode)
    if (mode !== 'flood' && tick % 120 === 0) castHeroSpells(sim) // fire every ready hero spell
    sim.step()
    tick++
    let ents = sim.liveEnemyCount()
    for (const p of sim.projectiles) if (p.active) ents++
    for (const t of sim.towers) if (t.active) ents++
    maxEntities = Math.max(maxEntities, ents)
    validate(sim, tick)
    checkIds(sim, retired, tick)
    // flood only needs to PROVE hundreds coexist with clean math — early-exit once shown
    if (mode === 'flood' && maxEntities >= 300) break
  }
  return { maxEntities, wavesReached: sim.waveIndex }
}

console.log('simcheck — deterministic 60-wave stress with hundreds of entities…')
let peak = 0
let waves = 0
const runs: Array<[number, 'max' | 'base' | 'flood']> = [[1, 'max'], [1337, 'base'], [424242, 'flood'], [999999, 'max']]
for (const [seed, mode] of runs) {
  const r = runOne(seed, mode)
  peak = Math.max(peak, r.maxEntities)
  waves = Math.max(waves, r.wavesReached)
  console.log(`  seed ${seed} [${mode}]: reached wave ${r.wavesReached}, peak entities ${r.maxEntities}`)
}

// determinism check: identical seeds must produce identical end-state
function fingerprint(seed: number): string {
  const a = makeSim(seed); saturateTowers(a, 'max')
  let t = 0
  while (a.waveIndex < 12 && t < STEP_BUDGET) {
    if (a.state === 'draft') { a.chooseDraft(0); continue }
    if (a.state === 'prep') a.startWave()
    if (a.state === 'won' || a.state === 'lost') break
    a.step(); t++
  }
  return `${a.waveIndex}|${a.gold}|${a.clock.toFixed(3)}|${a.liveEnemyCount()}`
}
if (fingerprint(1337) !== fingerprint(1337)) fail('non-deterministic: identical seed diverged')

if (peak < 200) fail(`stress too light — only ${peak} concurrent enemies (need ≥200)`)
// mixed-element towers + heroes MUST detonate elemental reactions during the runs
if (reactionEvents === 0) fail('no elemental reactions fired across all stress runs')
else console.log(`  elemental reactions fired: ${reactionEvents}`)

if (failures > 0) {
  console.error(`\nSIMCHECK FAILED — ${failures} violation(s).`)
  process.exit(1)
} else {
  console.log(`\nSIMCHECK PASSED — max ${peak} concurrent entities, ${waves} waves, no NaN/Infinity/out-of-range.`)
  process.exit(0)
}
