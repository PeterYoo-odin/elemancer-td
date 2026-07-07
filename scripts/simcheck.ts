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

import { Sim, TILE, MAP_X, MAP_Y, MAP_W, MAP_H, TARGET_MODES } from '../src/sim/index'
import { NEUTRAL } from '../src/game/workshop'
import { LEVELS, pathCellsFor, type LevelDef } from '../src/game/levels'
import { buildCampaign, GENERATOR_MAX_PER_WORLD } from '../src/game/campaign'
import { GRID_COLS, GRID_ROWS } from '../src/game/paths'
import { TOWER_ORDER } from '../src/game/towers'
import { runScriptedDemo } from '../src/game/attractScript'
import { codeToSeed, seedToCode, SEED_SPACE } from '../src/game/seedcode'

// Stress runs are DECOUPLED from the campaign ladder: we build a bespoke max-size
// level (6-lane serpentine) so regenerating LEVELS can never starve the ≥200
// concurrent-entity assertion. Endless mode ignores `waves`, so only the path
// (and its build cells) matter here.
const STRESS_LEVEL: LevelDef = {
  id: 'stress', index: 3, name: 'Stress Arena', blurb: '', lanes: [0, 2, 4, 6, 8, 10],
  startGold: 5_000_000, startLives: 10_000_000, baseCoins: 0, palette: LEVELS[0].palette, waves: [],
}

const COMBO_MAX = 6
const TARGET_WAVES = 60
const STEP_BUDGET = 60 * 60 * 200 // generous cap (~200 min of sim time)

let failures = 0
let reactionEvents = 0 // elemental reactions must actually fire during the stress runs
let fusionsForged = 0 // fusion towers must be forged (and survive) the stress runs
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

// Three rotating parties so EVERY hero's signature mechanic + resonance pairing is
// exercised by the gate (all levels ≥ 3 → signatures awake): A = cindernova /
// twinspark / tithe + Fire resonance; B = foreseen / intercession / wager;
// C = deeproots / overload (+ a repeat Control for the slow-stack interplay).
const PARTIES: Array<Array<{ heroId: string; level: number }>> = [
  [{ heroId: 'ember', level: 20 }, { heroId: 'pyra', level: 12 }, { heroId: 'vex', level: 8 }],
  [{ heroId: 'glacia', level: 12 }, { heroId: 'aurelia', level: 14 }, { heroId: 'zephyra', level: 10 }],
  [{ heroId: 'sylvan', level: 10 }, { heroId: 'volt', level: 10 }, { heroId: 'glacia', level: 6 }],
]

function makeSim(seed: number, _levelIndex = 3, party = 0): Sim {
  return new Sim({
    level: STRESS_LEVEL,
    mods: { ...NEUTRAL },
    seed,
    endless: true,
    startGold: 5_000_000, // never gold-starved: keep placing/upgrading to stress DPS
    startLives: 10_000_000, // never lose: we want the full 60-wave stress run
    party: PARTIES[party % PARTIES.length],
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

// ---------------------------------------------------------------------------
// BEATABILITY AUTO-PLAYER — proves every LIVE campaign level is winnable with
// the level's REAL resources (not the god-mode stress harness). A strong-but-fair
// bot: deploy party, greedily place/upgrade a rotating tower spread (guarantees
// anti-air via storm/arcane), cast ready hero spells. A bot WIN is a valid lower
// bound (a competent human ⇒ win). A bot LOSS ⇒ the level's curve is unfair and
// the build fails, naming the level so the generator can be retuned.
// ---------------------------------------------------------------------------
// Starter heroes only (ember/glacia/sylvan are the fresh-save roster) — the proof
// must not lean on champions a new player hasn't unlocked.
const BOT_PARTY = [{ heroId: 'ember', level: 16 }, { heroId: 'glacia', level: 16 }, { heroId: 'sylvan', level: 16 }]

function botSpend(sim: Sim, placeRef: { i: number }, allowed: string[]): void {
  for (const t of sim.towers) {
    if (!t.active) continue
    const uc = sim.upgradeCostFor(t)
    if (uc !== null && sim.gold >= uc) sim.upgradeTower(t.id)
  }
  for (const c of sim.buildCells()) {
    if (sim.gold < 40) break
    if (!sim.canPlace(c.col, c.row)) continue
    for (let a = 0; a < allowed.length; a++) {
      const kind = allowed[(placeRef.i + a) % allowed.length] as (typeof TOWER_ORDER)[number]
      if (sim.gold >= sim.placeCost(kind) && sim.placeTower(kind, c.col, c.row)) { placeRef.i++; break }
    }
  }
}

// `allowed` = only the towers the player would actually OWN by this point in the
// ladder (base cannon/frost/flame + whatever earlier levels unlocked). This makes
// the beatability proof a MIN-RESOURCE lower bound, not "beatable with endgame kit".
function autoPlay(level: LevelDef, allowed: string[]): { won: boolean; lives: number; wave: number } {
  const seed = (0xA5EED ^ (level.index * 40503) ^ 0x1234) >>> 0
  const sim = new Sim({
    level, mods: { ...NEUTRAL }, seed, endless: false,
    startGold: level.startGold, startLives: level.startLives, party: BOT_PARTY,
  })
  deployParty(sim)
  const placeRef = { i: 0 }
  let tick = 0
  const budget = 60 * 60 * 20 // ~20 min sim time — generous headroom for a fair level
  while (tick < budget) {
    if (sim.state === 'won' || sim.state === 'lost') break
    if (sim.state === 'draft') { sim.chooseDraft(0); continue }
    if (sim.state === 'prep') { botSpend(sim, placeRef, allowed); sim.startWave() }
    if (sim.state === 'active') {
      if (tick % 150 === 0) botSpend(sim, placeRef, allowed)
      if (tick % 150 === 0) castHeroSpells(sim)
    }
    sim.step(); tick++
  }
  return { won: sim.state === 'won', lives: sim.lives, wave: sim.waveIndex }
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
      // exercise EVERY targeting mode (incl. Weak + Primed reaction-hunting)
      sim.setTargeting(t.id, TARGET_MODES[i % TARGET_MODES.length])
    }
    i++
  }
}

// Forge a few FUSION towers from adjacent eligible max pairs (exercises the
// fusion path: absorb partner, freed tile, alternating dual auras, +damage).
function fuseSome(sim: Sim, cap = 6): number {
  let fused = 0
  for (const t of sim.towers) {
    if (fused >= cap) break
    if (!t.active || t.fusedElem !== '') continue
    const opts = sim.fusionOptions(t)
    if (opts.length === 0) continue
    if (sim.fuseTowers(t.id, opts[0].partner.id)) fused++
  }
  return fused
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
    if (t.fusedElem !== '' && (!finite(t.fusedColor) || t.fusionName === '' || t.fusionKey === '')) fail(`fused tower state incoherent @${tick}`)
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

function runOne(seed: number, mode: 'max' | 'base' | 'flood', party = 0): { maxEntities: number; wavesReached: number } {
  const sim = makeSim(seed, 3, party)
  if (mode !== 'flood') deployParty(sim) // heroes before towers claim the build cells
  saturateTowers(sim, mode)
  if (mode === 'max') fusionsForged += fuseSome(sim) // dual-aura fusion towers under stress
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
const runs: Array<[number, 'max' | 'base' | 'flood', number]> = [
  [1, 'max', 0], [1337, 'base', 0], [424242, 'flood', 0], [999999, 'max', 0],
  // parties B/C in 'base' (leaky, level-0 towers) so foreseen/intercession/wager/
  // deeproots/overload signatures all fire — incl. Seraphine's gate smite on leaks
  [7777, 'base', 1], [31337, 'base', 2],
]
for (const [seed, mode, party] of runs) {
  const r = runOne(seed, mode, party)
  peak = Math.max(peak, r.maxEntities)
  waves = Math.max(waves, r.wavesReached)
  console.log(`  seed ${seed} [${mode}·p${party}]: reached wave ${r.wavesReached}, peak entities ${r.maxEntities}`)
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
// and the fusion path must actually forge dual-aura towers under stress
if (fusionsForged === 0) fail('no fusion towers were forged across the max-mode stress runs')
else console.log(`  fusion towers forged: ${fusionsForged}`)

// ---------------------------------------------------------------------------
//  SEED CODEC — the shareable WORD-WORD-NN space must round-trip exactly.
// ---------------------------------------------------------------------------
console.log('\nseed codec — round-trip + demo seed…')
for (const s of [0, 1, 42, 6400, 123456, SEED_SPACE - 1]) {
  const rt = codeToSeed(seedToCode(s))
  if (rt !== s) fail(`seed codec round-trip broke: ${s} → ${seedToCode(s)} → ${rt}`)
}
if (codeToSeed('EMBER-FOX-42') !== 42) fail(`EMBER-FOX-42 must decode to 42 (got ${codeToSeed('EMBER-FOX-42')})`)
if (codeToSeed('ember fox 42') !== 42) fail('codec must be case/space tolerant')
if (codeToSeed('NOT-AWORD-99') !== null) fail('codec must reject unknown words')
console.log('  codec ok — space of ' + SEED_SPACE.toLocaleString('en-US') + ' codes')

// ---------------------------------------------------------------------------
//  DEMO / ATTRACT SHOWCASE — the scripted Ember Vale run IS the trailer, the
//  landing hero and the demo. Its money-shot beats are load-bearing marketing
//  infrastructure, so the gate asserts every one of them:
//    · hands-free VICTORY on the pinned seed (EMBER-FOX-42)
//    · the guaranteed SHATTER cascade lands inside 90s
//    · the near-loss finish (1-5 crystal HP) actually happens
//    · the whole reel fits a capture window and replays bit-identically
// ---------------------------------------------------------------------------
console.log('\ndemo showcase — scripted Ember Vale run (attract/trailer source)…')
const demo = runScriptedDemo()
if (!demo.won) fail(`demo script LOST (lives=${demo.lives}, t=${demo.clock.toFixed(1)}) — the reel must always win`)
if (demo.shatterAt < 0 || demo.shatterAt > 90) fail(`SHATTER money shot missing/late: ${demo.shatterAt.toFixed(1)}s (needs <90s)`)
if (demo.lives < 1 || demo.lives > 5) fail(`near-loss finish off-tune: ${demo.lives} lives left (want 1-5)`)
if (demo.clock > 360) fail(`demo run too long for capture: ${demo.clock.toFixed(0)}s`)
if (demo.waveStarts.length !== 5) fail(`demo must run all 5 waves (got ${demo.waveStarts.length})`)
if (demo.waveStarts[0] > 15) fail(`first wave too late: ${demo.waveStarts[0].toFixed(1)}s (first tower <15s promise)`)
const demo2 = runScriptedDemo()
if (demo.fingerprint !== demo2.fingerprint) fail(`demo replay diverged: ${demo.fingerprint} vs ${demo2.fingerprint}`)
console.log(`  demo ok — won t=${demo.clock.toFixed(1)}s, lives=${demo.lives}, first SHATTER @${demo.shatterAt.toFixed(1)}s, ` +
  `reactions=${demo.reactions}, maxCombo=${demo.maxCombo}, score=${demo.score}`)

// ---------------------------------------------------------------------------
//  CAMPAIGN LADDER — the generated ladder must be DETERMINISTIC, well-formed
//  (contiguous in-bounds paths, in-bounds terrain, contiguous indices) and every
//  LIVE level must be provably BEATABLE by the fair auto-player.
// ---------------------------------------------------------------------------
console.log(`\ncampaign ladder — ${LEVELS.length} live levels across ${new Set(LEVELS.map((l) => l.palette.path)).size}+ realms…`)

// determinism: rebuilding the campaign yields an identical ladder (ids + waves).
function campaignFingerprint(): string {
  const c = buildCampaign()
  return c.levels.map((l) => `${l.id}:${l.waves.length}:${(l.path ?? []).length}:${(l.terrain ?? []).length}`).join('|')
}
if (campaignFingerprint() !== campaignFingerprint()) fail('campaign generator is non-deterministic')
if (GENERATOR_MAX_PER_WORLD < 80) fail('generator ceiling too low to scale to hundreds/world')

// well-formedness: contiguous indices + contiguous in-bounds paths + in-bounds terrain.
LEVELS.forEach((lvl, i) => {
  if (lvl.index !== i) fail(`level ${lvl.id} index ${lvl.index} != position ${i} (isLevelUnlocked would break)`)
  const cells = pathCellsFor(lvl)
  if (cells.length < 2) fail(`level ${lvl.id} path too short (${cells.length})`)
  for (let ci = 0; ci < cells.length; ci++) {
    const [c, r] = cells[ci]
    if (c < 0 || c >= GRID_COLS || r < 0 || r >= GRID_ROWS) fail(`level ${lvl.id} path cell off-grid @${ci}: ${c},${r}`)
    if (ci > 0) {
      const [pc, pr] = cells[ci - 1]
      if (Math.abs(c - pc) + Math.abs(r - pr) > 1) fail(`level ${lvl.id} path not contiguous @${ci}: ${pc},${pr}→${c},${r}`)
    }
  }
  for (const t of lvl.terrain ?? []) {
    if (t.col < 0 || t.col >= GRID_COLS || t.row < 0 || t.row >= GRID_ROWS) fail(`level ${lvl.id} terrain off-grid: ${t.col},${t.row}`)
  }
})

// beatability: the fair, MIN-RESOURCE bot must WIN every live level using only the
// towers actually unlocked by that point in the ladder + starter heroes.
let beatFails = 0
let hardest = { id: '', lives: 1e9 }
const owned = new Set<string>(['cannon', 'frost', 'flame']) // fresh-save base towers
for (const lvl of LEVELS) {
  const allowed = TOWER_ORDER.filter((k) => owned.has(k))
  const r = autoPlay(lvl, allowed)
  if (!r.won) { fail(`level ${lvl.id} (${lvl.name}) UNBEATABLE by min-resource auto-player — reached wave ${r.wave}, ${r.lives} lives`); beatFails++ }
  else if (r.lives < hardest.lives) hardest = { id: lvl.id, lives: r.lives }
  if (lvl.unlockTower) owned.add(lvl.unlockTower) // its reward is available on the NEXT level
}
if (beatFails === 0) console.log(`  all ${LEVELS.length} live levels beatable (base towers + unlocks only) — tightest: ${hardest.id} @ ${hardest.lives} lives`)

if (failures > 0) {
  console.error(`\nSIMCHECK FAILED — ${failures} violation(s).`)
  process.exit(1)
} else {
  console.log(`\nSIMCHECK PASSED — max ${peak} concurrent entities, ${waves} waves, no NaN/Infinity/out-of-range.`)
  process.exit(0)
}
