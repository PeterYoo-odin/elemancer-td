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

import {
  Sim, TILE, MAP_X, MAP_Y, MAP_W, MAP_H, TARGET_MODES, FIXED_DT, MAX_STEPS_PER_FRAME,
  DRAFT_POOL, ROGUE_DRAFT_POOL, MUTATOR_IDS, MUTATORS, rollRogueDraft, RNG, type MutatorId,
  reactionFor, type AuraElement, type ReactionKey,
} from '../src/sim/index'
import { weeklyPlan, activeEvent, weekIndex, weeklyMutator, EVENTS } from '../src/game/events'
import { NEUTRAL, WORKSHOP_NODES, aggregateRunModifiers, aggregateMetaModifiers, type RunModifiers } from '../src/game/workshop'
import type { SaveData } from '../src/game/save'
import { LEVELS, pathCellsFor, pathPlanFor, type LevelDef } from '../src/game/levels'
import { LEVEL_STORY } from '../src/game/story'
import { buildCampaign, GENERATOR_MAX_PER_WORLD, PAL } from '../src/game/campaign'
import { GRID_COLS, GRID_ROWS } from '../src/game/paths'
import { TOWER_ORDER } from '../src/game/towers'
import { runScriptedDemo, demoSimConfig, ScriptRunner, DEMO_SCRIPT } from '../src/game/attractScript'
import { codeToSeed, seedToCode, SEED_SPACE } from '../src/game/seedcode'
import { resolveBond, RANKED_WYRM_LEVEL, WYRM_MAX_LEVEL } from '../src/game/wyrms'
import {
  rankedConfig, RunRecorder, replayRun, verifyRun, SIM_VERSION, logHash, REPLAY_TICK_CAP,
  type DeclaredHero, type RankedRunRecord,
} from '../src/game/ranked'
import type { TowerKind } from '../src/game/towers'
import type { SpellKey } from '../src/game/spells'
import {
  PF_COLS, PF_ROWS, pfKey, pathforgeLayout, validateMaze, pathforgeLevel, type PFCell,
} from '../src/game/pathforge'

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
let wyrmBreaths = 0 // bonded Wyrms must actually breathe during the stress runs
const seen: Record<string, number> = {}
function fail(msg: string): void {
  const key = msg.slice(0, 60)
  seen[key] = (seen[key] ?? 0) + 1
  if (seen[key] <= 3) console.error('  ✗ ' + msg)
  failures++
}

// PALETTE READABILITY GATE (CHROMANCER #63b). The realm ground palette (PAL) must stay
// identifiable by HUE while keeping the ground luma in the ~80-98 band that protects
// unit/enemy silhouette contrast — grey is the enemy colour, so the ground must never
// drift toward it. This asserts BOTH halves of the READABILITY RULE so a future edit
// can't silently (a) brighten/darken the ground out of the contrast band, OR (b) re-
// flatten the chroma back to mud (the bug this fix reversed). Luma = Rec601 on 0-255;
// chroma = HSV saturation. Cheap, deterministic, runs in the gate.
function assertPaletteContrast(): void {
  const LUMA_MIN = 80, LUMA_MAX = 98, CHROMA_MIN = 0.30
  for (const [realm, p] of Object.entries(PAL)) {
    const r = (p.grassA >> 16) & 0xff, g = (p.grassA >> 8) & 0xff, b = p.grassA & 0xff
    const luma = 0.299 * r + 0.587 * g + 0.114 * b
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
    const chroma = mx === 0 ? 0 : (mx - mn) / mx
    if (luma < LUMA_MIN || luma > LUMA_MAX) {
      fail(`palette: realm '${realm}' grassA luma ${luma.toFixed(1)} is outside the [${LUMA_MIN},${LUMA_MAX}] contrast band — it will swallow enemies or wash them out`)
    }
    if (chroma < CHROMA_MIN) {
      fail(`palette: realm '${realm}' grassA chroma ${chroma.toFixed(2)} < ${CHROMA_MIN} — the ground has been re-flattened to mud (hue must carry realm identity)`)
    }
  }
  if (failures === 0) console.log(`  palette ✓ — all ${Object.keys(PAL).length} realms: grassA luma∈[${LUMA_MIN},${LUMA_MAX}], chroma≥${CHROMA_MIN} (hue-identifiable, enemy-legible)`)
}
assertPaletteContrast()

function finite(v: number): boolean {
  return typeof v === 'number' && Number.isFinite(v)
}

// Three rotating parties so EVERY hero's signature mechanic + resonance pairing is
// exercised by the gate (all levels ≥ 3 → signatures awake): A = cindernova /
// twinspark / tithe + Fire resonance; B = foreseen / intercession / wager;
// C = deeproots / overload (+ a repeat Control for the slow-stack interplay).
// Bonded CHROMATIC WYRMS ride along in every party so the companion breath +
// aura + fused-ultimate code paths are exercised under stress, and all six
// Wyrm elements paint auras that detonate reactions alongside the towers.
type SimParty = Array<{ heroId: string; level: number; wyrm?: { wyrmId: string; level: number } }>
const PARTIES: SimParty[] = [
  [{ heroId: 'ember', level: 20, wyrm: { wyrmId: 'pyrax', level: 10 } }, { heroId: 'pyra', level: 12 }, { heroId: 'vex', level: 8, wyrm: { wyrmId: 'umbrawyrm', level: 6 } }],
  [{ heroId: 'glacia', level: 12, wyrm: { wyrmId: 'glaciaxis', level: 7 } }, { heroId: 'aurelia', level: 14, wyrm: { wyrmId: 'lumenwyrm', level: 5 } }, { heroId: 'zephyra', level: 10, wyrm: { wyrmId: 'voltaryx', level: 9 } }],
  [{ heroId: 'sylvan', level: 10, wyrm: { wyrmId: 'verdwyrm', level: 8 } }, { heroId: 'volt', level: 10, wyrm: { wyrmId: 'voltaryx', level: 4 } }, { heroId: 'glacia', level: 6 }],
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
function autoPlay(level: LevelDef, allowed: string[], mods: RunModifiers = NEUTRAL): { won: boolean; lives: number; wave: number } {
  const seed = (0xA5EED ^ (level.index * 40503) ^ 0x1234) >>> 0
  const sim = new Sim({
    level, mods: { ...mods }, seed, endless: false,
    startGold: level.startGold + mods.startGoldBonus, startLives: level.startLives + mods.startLivesBonus, party: BOT_PARTY,
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
    // bonded-Wyrm companion state must stay finite + non-negative
    if (!finite(h.wyrmBreathCd) || h.wyrmBreathCd < 0) fail(`wyrm breath cd out of range: ${h.wyrmBreathCd} @${tick}`)
    if (h.wyrm && (!finite(h.wyrm.breathDamage) || h.wyrm.breathDamage < 0)) fail(`wyrm breath damage bad: ${h.wyrm.breathDamage} @${tick}`)
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
    if (ev.t === 'wyrmBreath') {
      wyrmBreaths++
      if (!finite(ev.x) || !finite(ev.y) || !finite(ev.radius) || ev.radius < 0) fail(`wyrm breath event bad geometry @${tick}`)
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

// Every enemy KIND observed active across the stress runs — used below to prove
// armored/elite (the newest archetypes) actually spawn under Endless, not just
// exist in the data tables.
const seenEnemyKinds = new Set<string>()

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
    for (const en of sim.enemies) if (en.active) seenEnemyKinds.add(en.kind)
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
// armored/elite must actually spawn during the 60-wave Endless stress run, not
// just be reachable in theory — proves the wiring, not just the data tables.
if (!seenEnemyKinds.has('armored')) fail('armored never spawned across the 60-wave Endless stress runs')
if (!seenEnemyKinds.has('elite')) fail('elite never spawned across the 60-wave Endless stress runs')

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
//  REACTION MATRIX — CHROMANCER #51: every one of the 9 elemental reactions
//  must be triggerable from TOWER-vs-TOWER element pairings alone (no heroes/
//  Wyrms involved). Pairs are DERIVED from reactionFor() itself (never hand-
//  duplicated from the private PAIR table in reactions.ts), so this stays
//  correct even if the pairing table changes shape.
// ---------------------------------------------------------------------------
console.log('\nreaction matrix — every one of the 9 elemental reactions must be tower-triggerable…')
const AURA_ELEMENTS: AuraElement[] = ['Fire', 'Water', 'Nature', 'Light', 'Dark', 'Storm', 'Arcane']
// The tower that paints each aura (mirrors sim.ts's private TOWER_AURA map).
const TOWER_FOR_AURA: Record<AuraElement, TowerKind> = {
  Fire: 'flame', Water: 'frost', Storm: 'storm', Nature: 'bloom', Light: 'radiant', Dark: 'shade', Arcane: 'arcane',
}
function reactionPairs(): Array<{ key: ReactionKey; a: AuraElement; b: AuraElement }> {
  const out: Array<{ key: ReactionKey; a: AuraElement; b: AuraElement }> = []
  const seen = new Set<ReactionKey>()
  for (let i = 0; i < AURA_ELEMENTS.length; i++) {
    for (let j = i + 1; j < AURA_ELEMENTS.length; j++) {
      const a = AURA_ELEMENTS[i], b = AURA_ELEMENTS[j]
      const def = reactionFor(a, b)
      if (def && !seen.has(def.key)) { seen.add(def.key); out.push({ key: def.key, a, b }) }
    }
  }
  return out
}
// Alternate the two towers across the WHOLE stress arena (the same placement
// shape that already reliably detonates reactions elsewhere in this file) —
// no hero, no Wyrm, no relic: proves the pairing is reachable from towers alone.
function provesReaction(seed: number, key: ReactionKey, a: AuraElement, b: AuraElement): boolean {
  const sim = new Sim({
    level: STRESS_LEVEL, mods: { ...NEUTRAL }, seed, endless: true,
    startGold: 5_000_000, startLives: 5_000_000,
  })
  const kindA = TOWER_FOR_AURA[a]
  const kindB = TOWER_FOR_AURA[b]
  let i = 0
  for (const c of sim.buildCells()) {
    const t = sim.placeTower(i % 2 === 0 ? kindA : kindB, c.col, c.row)
    if (t) { sim.upgradeTower(t.id); sim.upgradeTower(t.id) }
    i++
  }
  let saw = false
  let tick = 0
  while (!saw && tick < 60 * 60 * 2) {
    if (sim.state === 'draft') { sim.chooseDraft(0); continue }
    if (sim.state === 'prep') sim.startWave()
    if (sim.state === 'won' || sim.state === 'lost') break
    sim.step(); tick++
    for (const ev of sim.drainEvents()) if (ev.t === 'reaction' && ev.key === key) saw = true
  }
  return saw
}
const REACTION_PAIRS = reactionPairs()
if (REACTION_PAIRS.length !== 9) fail(`expected 9 distinct reactions derivable from reactionFor(), got ${REACTION_PAIRS.length}`)
const failuresBeforeMatrix = failures
let seedBump = 0
for (const { key, a, b } of REACTION_PAIRS) {
  const ok = provesReaction(0xBEEF00 ^ (seedBump++ * 7919), key, a, b)
  if (!ok) fail(`reaction ${key} (${a} + ${b}) never fired from ${TOWER_FOR_AURA[a]}+${TOWER_FOR_AURA[b]} tower placement alone`)
}
if (failures === failuresBeforeMatrix) {
  console.log(`  all 9 reactions proven tower-triggerable: ${REACTION_PAIRS.map((p) => `${p.key} (${TOWER_FOR_AURA[p.a]}+${TOWER_FOR_AURA[p.b]})`).join(', ')}`)
}

// ---------------------------------------------------------------------------
//  CHROMATIC WYRMS — the bonded-companion breath must fire under stress AND it
//  must FEED the reaction system (fire breath detonates a frost-primed enemy).
//  RANKED must NORMALIZE Wyrm power (no grind/purchase power); casual growth
//  must be REAL (an adult out-breathes a hatchling). All deterministic.
// ---------------------------------------------------------------------------
console.log('\nchromatic wyrms — companion breath + reaction integration + ranked-neutrality…')
if (wyrmBreaths === 0) fail('no bonded Wyrm ever breathed across the stress runs')
else console.log(`  wyrm breaths fired: ${wyrmBreaths}`)

// req 1a — a FIRE breath on a WATER-primed enemy must detonate a reaction. We
// bond Pyrax (Fire) to Lumi (a WATER hero): only the Wyrm paints Fire, so any
// reaction we see PROVES the breath — not the hero's attack — fed the system.
function wyrmReactionProof(): boolean {
  const sim = new Sim({
    level: STRESS_LEVEL, mods: { ...NEUTRAL }, seed: 5, endless: true,
    startGold: 5_000_000, startLives: 5_000_000,
    party: [{ heroId: 'glacia', level: 20, wyrm: { wyrmId: 'pyrax', level: 12 } }],
  })
  let hero: ReturnType<Sim['deployHero']> = null
  for (const c of sim.buildCells()) {
    if (sim.canPlace(c.col, c.row)) { hero = sim.deployHero('glacia', c.col, c.row); if (hero) break }
  }
  if (!hero) return false
  let saw = false
  for (let i = 0; i < 60 * 40 && !saw; i++) {
    if (sim.state === 'draft') { sim.chooseDraft(0); continue }
    if (sim.state === 'prep') sim.startWave()
    if (sim.state === 'won' || sim.state === 'lost') break
    // keep every live enemy WATER-primed; Lumi's own hits are Water too (no
    // reaction), so a detonation can only come from the Pyrax FIRE breath.
    for (const e of sim.enemies) {
      if (!e.active || e.hp <= 0) continue
      e.auraElem = 'Water'
      e.auraUntil = sim.clock + 3
      e.reactLockUntil = 0
    }
    sim.step()
    for (const ev of sim.drainEvents()) if (ev.t === 'reaction') saw = true
  }
  return saw
}
if (!wyrmReactionProof()) fail('Wyrm breath does NOT feed the reaction system (fire breath failed to detonate a frost-primed enemy)')
else console.log('  wyrm breath ⇒ reactions confirmed (fire breath detonates frost-primed enemies)')

// RANKED NEUTRALITY (constitution): ranked pins every bonded Wyrm to a fixed
// level, so no grind/purchase changes ranked companion power.
const rk1 = resolveBond('ember', 'pyrax', RANKED_WYRM_LEVEL)
const rk2 = resolveBond('ember', 'pyrax', RANKED_WYRM_LEVEL)
if (!rk1 || !rk2 || rk1.breathDamage !== rk2.breathDamage) fail('ranked Wyrm resolve is non-deterministic')
const hatch = resolveBond('ember', 'pyrax', 1)
const adult = resolveBond('ember', 'pyrax', WYRM_MAX_LEVEL)
if (!hatch || !adult || !(adult.breathDamage > hatch.breathDamage)) fail('Wyrm growth is inert — an adult must out-breathe a hatchling')
// tiered affinity must actually tier: a PERFECT bond out-breathes a REGULAR one.
const perfect = resolveBond('ember', 'pyrax', WYRM_MAX_LEVEL)
const regular = resolveBond('ember', 'glaciaxis', WYRM_MAX_LEVEL)
if (!perfect || !regular || !(perfect.breathDamage > regular.breathDamage) || perfect.ult === null || regular.ult !== null) {
  fail('tiered affinity broken — PERFECT must out-breathe REGULAR and own a fused ultimate')
}
console.log(`  ranked-neutral (Lv ${RANKED_WYRM_LEVEL} pinned) · growth real (${Math.round(hatch.breathDamage)}→${Math.round(adult.breathDamage)}) · tiers ordered`)

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
//  CHROMANCER #53 — GAME SPEED (1×/2×/4×) is cosmetic wall-clock scaling on the
//  SAME fixed-timestep sim: BattleScene.update() feeds Sim.advance(dt * gameSpeed,
//  beforeStep) every real frame (sim/sim.ts's accumulator does the rest), and
//  ranked commands are tick-stamped (tick = round(clock / FIXED_DT)), not
//  wall-clock-stamped (game/ranked.ts) — so a faster game speed can only pack
//  more identical fixed steps into fewer real frames. Drive the scripted demo
//  through that exact advance()-loop shape at three speeds and assert: (a) the
//  tick count + final state are byte-identical regardless of speed, and (b) the
//  MAX_STEPS_PER_FRAME headroom (layout.ts) actually keeps 2×/4× paced with
//  wall clock — if the cap were too low the sim would fall behind and silently
//  play back like slow motion instead of the real 2×/4× speedup.
// ---------------------------------------------------------------------------
console.log('\ngame speed — 1×/2×/4× drive identical tick sequences (real advance()-loop shape)…')
function runScriptAtSpeed(speedMult: number): { fingerprint: string; realFrames: number; ticks: number } {
  const sim = new Sim(demoSimConfig())
  const runner = new ScriptRunner(DEMO_SCRIPT)
  const REAL_DT = 1 / 60
  let realFrames = 0
  const capFrames = 60 * 60 * 20 // 20 real-minutes hard cap — generous headroom
  while (sim.state !== 'won' && sim.state !== 'lost' && realFrames < capFrames) {
    // an occasional hitch (mirrors BattleScene.update()'s Math.min(0.05, delta/1000)
    // clamp on a dropped real frame) — proves the cap survives a hitch AT SPEED too.
    const hitch = realFrames > 0 && realFrames % 97 === 0
    const dt = Math.min(0.05, hitch ? 0.2 : REAL_DT)
    sim.advance(dt * speedMult, () => runner.update(sim, true))
    if (sim.state === 'draft') sim.chooseDraft(0) // script's own draftPick may already cover this
    realFrames++
  }
  return {
    fingerprint: `${sim.state}|${sim.waveIndex}|${sim.gold}|${sim.lives}|${sim.clock.toFixed(3)}|${sim.runStats.kills}|${sim.runStats.reactions}`,
    realFrames,
    ticks: Math.round(sim.clock / FIXED_DT),
  }
}
const speed1 = runScriptAtSpeed(1)
const speed2 = runScriptAtSpeed(2)
const speed4 = runScriptAtSpeed(4)
if (speed1.fingerprint !== speed2.fingerprint) fail(`game speed 2× diverged from 1×: ${speed2.fingerprint} vs ${speed1.fingerprint}`)
if (speed1.fingerprint !== speed4.fingerprint) fail(`game speed 4× diverged from 1×: ${speed4.fingerprint} vs ${speed1.fingerprint}`)
if (speed1.ticks !== speed2.ticks || speed1.ticks !== speed4.ticks) {
  fail(`game speed tick counts differ: 1×=${speed1.ticks} 2×=${speed2.ticks} 4×=${speed4.ticks}`)
}
// pacing: MAX_STEPS_PER_FRAME must have enough headroom that 2×/4× actually finish
// in proportionally fewer real frames — a starved cap would silently drop backlog
// and 4× would look like slow motion instead of playing back 4× faster.
if (speed2.realFrames > speed1.realFrames * 0.6) {
  fail(`2× did not pace down real frames (1×=${speed1.realFrames} 2×=${speed2.realFrames}) — MAX_STEPS_PER_FRAME (${MAX_STEPS_PER_FRAME}) may be starving it`)
}
if (speed4.realFrames > speed1.realFrames * 0.35) {
  fail(`4× did not pace down real frames (1×=${speed1.realFrames} 4×=${speed4.realFrames}) — MAX_STEPS_PER_FRAME (${MAX_STEPS_PER_FRAME}) may be starving it`)
}
console.log(`  speed-cosmetic ✓ — identical fingerprint + ${speed1.ticks} ticks at 1×/2×/4× ` +
  `(real frames: ${speed1.realFrames}/${speed2.realFrames}/${speed4.realFrames}, MAX_STEPS_PER_FRAME=${MAX_STEPS_PER_FRAME})`)

// ---------------------------------------------------------------------------
//  CAMPAIGN LADDER — the generated ladder must be DETERMINISTIC, well-formed
//  (contiguous in-bounds paths, in-bounds terrain, contiguous indices) and every
//  LIVE level must be provably BEATABLE by the fair auto-player.
// ---------------------------------------------------------------------------
console.log(`\ncampaign ladder — ${LEVELS.length} live levels across ${new Set(LEVELS.map((l) => l.palette.path)).size}+ realms…`)

// determinism: rebuilding the campaign yields an identical ladder (ids + waves).
function campaignFingerprint(): string {
  const c = buildCampaign()
  return c.levels.map((l) => `${l.id}:${l.waves.length}:${(l.path ?? []).length}:${(l.paths ?? []).length}:${(l.terrain ?? []).length}`).join('|')
}
if (campaignFingerprint() !== campaignFingerprint()) fail('campaign generator is non-deterministic')
if (GENERATOR_MAX_PER_WORLD < 80) fail('generator ceiling too low to scale to hundreds/world')

// well-formedness: contiguous indices + EVERY route contiguous & in-bounds + all
// routes of a multi-lane level converge on the IDENTICAL base cell + in-bounds terrain.
let multiSpawnLevels = 0
const topologyTally = { single: 0, multi: 0 }
LEVELS.forEach((lvl, i) => {
  if (lvl.index !== i) fail(`level ${lvl.id} index ${lvl.index} != position ${i} (isLevelUnlocked would break)`)
  const plan = pathPlanFor(lvl)
  if (plan.length < 1) fail(`level ${lvl.id} has no route`)
  if (plan.length > 1) { multiSpawnLevels++; topologyTally.multi++ } else topologyTally.single++
  let sharedBase: [number, number] | null = null
  plan.forEach((cells, ri) => {
    if (cells.length < 2) fail(`level ${lvl.id} route ${ri} too short (${cells.length})`)
    // HARD INVARIANT (chromancer-57): no route may revisit a cell, and therefore
    // no route may reverse direction back onto the tile it just came from — that
    // revisit-then-double-back is exactly the "monsters walk in, then back out,
    // then continue" spur (merge-trunk collisions + spiral/coil self-crossings).
    // Enforced across every realm/archetype/lane-count in the live ladder so a
    // future generator change can never reintroduce it unnoticed.
    const seenCells = new Set<string>()
    for (let ci = 0; ci < cells.length; ci++) {
      const [c, r] = cells[ci]
      const key = `${c},${r}`
      if (seenCells.has(key)) fail(`level ${lvl.id} route ${ri} revisits cell @${ci}: ${c},${r} — back-and-forth spur`)
      seenCells.add(key)
      if (c < 0 || c >= GRID_COLS || r < 0 || r >= GRID_ROWS) fail(`level ${lvl.id} route ${ri} cell off-grid @${ci}: ${c},${r}`)
      if (ci > 0) {
        const [pc, pr] = cells[ci - 1]
        if (Math.abs(c - pc) + Math.abs(r - pr) > 1) fail(`level ${lvl.id} route ${ri} not contiguous @${ci}: ${pc},${pr}→${c},${r}`)
      }
    }
    const last = cells[cells.length - 1]
    if (sharedBase === null) sharedBase = last
    else if (last[0] !== sharedBase[0] || last[1] !== sharedBase[1]) {
      fail(`level ${lvl.id} route ${ri} ends at ${last[0]},${last[1]} — not the shared base ${sharedBase[0]},${sharedBase[1]}`)
    }
  })
  // route 0 must equal pathCellsFor (the primary the view/orientation consume)
  const primary = pathCellsFor(lvl)
  if (primary.length !== plan[0].length) fail(`level ${lvl.id} pathCellsFor != route 0`)
  for (const t of lvl.terrain ?? []) {
    if (t.col < 0 || t.col >= GRID_COLS || t.row < 0 || t.row >= GRID_ROWS) fail(`level ${lvl.id} terrain off-grid: ${t.col},${t.row}`)
  }
})
// The topology variety must actually REACH the live ladder — not merely be supported.
if (multiSpawnLevels < 3) fail(`too few multi-spawn levels in the live ladder (${multiSpawnLevels}) — topology variety not reaching players`)
console.log(`  topology mix: ${topologyTally.single} single-lane, ${topologyTally.multi} multi-spawn (${multiSpawnLevels} across ${LEVELS.length})`)

// armored/elite must actually REACH the live ladder (not just be supported by the
// generator) — and never in l1, the hand-authored tutorial.
const armoredLevels = new Set<string>()
const eliteLevels = new Set<string>()
for (const lvl of LEVELS) {
  for (const wv of lvl.waves) {
    for (const en of wv.entries) {
      if (en.kind === 'armored') armoredLevels.add(lvl.id)
      if (en.kind === 'elite') eliteLevels.add(lvl.id)
    }
  }
}
if (armoredLevels.size === 0) fail('armored never spawns anywhere in the live campaign ladder')
if (eliteLevels.size === 0) fail('elite never spawns anywhere in the live campaign ladder')
if (armoredLevels.has('l1')) fail('armored spawns in l1 (the tutorial) — must gate in later')
if (eliteLevels.has('l1')) fail('elite spawns in l1 (the tutorial) — must gate in later')
console.log(`  armored/elite reach the ladder: armored in ${armoredLevels.size} levels, elite in ${eliteLevels.size} levels (neither in l1)`)

// ---------------------------------------------------------------------------
//  CHROMANCER #52 — WAYPOINTS: 18 hand-authored set-piece levels (3/realm),
//  taking authored content from 6 → 24 (l1-l6 + 18 waypoints). They REPLACE
//  specific generated slots — the 192-level total and index contiguity (already
//  asserted above) must hold — and every one must carry an authored flavor
//  bark (routed through the same story.ts system as l1-l6), not a generated
//  fallback line.
// ---------------------------------------------------------------------------
console.log('\nwaypoints — 18 hand-authored set-pieces (3/realm) …')
const WAYPOINT_IDS: string[] = []
for (let realmOrder = 0; realmOrder < 6; realmOrder++) {
  for (const j of [8, 16, 24]) WAYPOINT_IDS.push(`w${realmOrder}_${j}`)
}
const levelById = new Map(LEVELS.map((l) => [l.id, l]))
let waypointsFound = 0
for (const id of WAYPOINT_IDS) {
  const lvl = levelById.get(id)
  if (!lvl) { fail(`waypoint ${id} missing from the live campaign ladder`); continue }
  waypointsFound++
  if (lvl.landmark !== 'landmark') fail(`waypoint ${id} (${lvl.name}) is not flagged as a landmark stop`)
  if (!LEVEL_STORY[id]) fail(`waypoint ${id} (${lvl.name}) has no authored LEVEL_STORY entry`)
}
const AUTHORED_IDS = ['l1', 'l2', 'l3', 'l4', 'l5', 'l6', ...WAYPOINT_IDS]
if (AUTHORED_IDS.length !== 24) fail(`expected 24 hand-authored ids (l1-l6 + 18 waypoints), counted ${AUTHORED_IDS.length}`)
if (waypointsFound === 18) console.log(`  all 18 waypoints present, landmark-flagged, and authored-story-backed (24/${LEVELS.length} hand-authored, up from 6)`)

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

// ---------------------------------------------------------------------------
//  CHROMANCER #55 — WORKSHOP RESCALE: maxLevel raised (+taperLevel tail taper)
//  on every coin node so the ~6,714-coin board isn't fully spent by map 21.
//  Prove: (1) a save with every coin node at its NEW maxLevel produces finite,
//  sanely-bounded RunModifiers/MetaModifiers (no NaN/blowup at the extended
//  cap); (2) a campaign run under those maxed modifiers still plays cleanly —
//  no NaN/out-of-range entity state — on a spread of levels; (3) total coins
//  to max the whole board is in the intended "whole campaign" ballpark, not
//  trivially small (map-21-exhausted) or absurdly unreachable.
// ---------------------------------------------------------------------------
console.log('\nworkshop rescale — maxed-node modifiers stay finite + a maxed run stays clean…')
{
  const maxedSave = { workshop: {} as Record<string, number> } as SaveData
  for (const n of WORKSHOP_NODES) maxedSave.workshop[n.id] = n.maxLevel
  const mods = aggregateRunModifiers(maxedSave)
  const meta = aggregateMetaModifiers(maxedSave)
  for (const [k, v] of Object.entries(mods)) if (!finite(v as number)) fail(`workshop: maxed RunModifiers.${k} non-finite: ${v}`)
  for (const [k, v] of Object.entries(meta)) if (!finite(v as number)) fail(`workshop: maxed MetaModifiers.${k} non-finite: ${v}`)
  if (mods.cooldownMult < 0.4 - 1e-9) fail(`workshop: maxed cooldownMult broke the 0.4 floor: ${mods.cooldownMult}`)
  if (mods.spellCooldownMult < 0.4 - 1e-9) fail(`workshop: maxed spellCooldownMult broke the 0.4 floor: ${mods.spellCooldownMult}`)
  if (mods.towerCostMult < 0.5 - 1e-9) fail(`workshop: maxed towerCostMult broke the 0.5 floor: ${mods.towerCostMult}`)
  if (mods.towerDamageMult <= 1 || mods.towerDamageMult > 3) fail(`workshop: maxed towerDamageMult out of sane range: ${mods.towerDamageMult}`)

  // A maxed-workshop run is a STRICT power-up over NEUTRAL, so replay the same
  // fair auto-player under maxed mods on a spread of levels (opener, the
  // tightest live level, and the realm finale) and prove it stays clean.
  const spreadIds = ['l1', 'w0_20', 'w0_finale']
  for (const id of spreadIds) {
    const lvl = LEVELS.find((l) => l.id === id)
    if (!lvl) { fail(`workshop spread-check: level ${id} missing`); continue }
    const ownedHere = new Set<string>(['cannon', 'frost', 'flame'])
    for (const p of LEVELS.slice(0, lvl.index)) if (p.unlockTower) ownedHere.add(p.unlockTower)
    const allowed = TOWER_ORDER.filter((k) => ownedHere.has(k))
    const r = autoPlay(lvl, allowed, mods)
    if (!r.won) fail(`workshop: maxed-modifier run failed to win ${id} (a strict power-up over the already-beatable NEUTRAL run) — wave ${r.wave}, ${r.lives} lives`)
  }

  // total-to-max sanity: "tens of thousands", paced for most of a 192-level
  // campaign — not the old ~6.7k (map-21-exhausted) and not an unreachable wall.
  let totalToMax = 0
  for (const n of WORKSHOP_NODES) {
    if (n.currency !== 'coins') continue
    for (let lvl = 0; lvl < n.maxLevel; lvl++) totalToMax += Math.round(n.baseCost * Math.pow(n.costGrowth, lvl))
  }
  if (totalToMax < 30000) fail(`workshop: total-to-max (${totalToMax}) is still too close to the old exhausted-by-map-21 total`)
  if (totalToMax > 200000) fail(`workshop: total-to-max (${totalToMax}) risks being unreachable across the campaign`)
  console.log(`  maxed modifiers finite + in-range, spread-check clean, total-to-max-all-coin-nodes = ${totalToMax} coins (was 6,714)`)
}

// ---------------------------------------------------------------------------
//  ROGUELIKE ENDLESS — the live-ops spine. Prove: (1) RANKED PURITY — with NO
//  rogue config the endless path is byte-inert (draft only from the base pool, ZERO
//  affixes, no rogue bookkeeping); (2) the 100+ relic pool + weighted roll are
//  deterministic and never repeat a unique; (3) every mutator + the live event run
//  clean (in-range, deterministic) with affixes spawning and reactions firing;
//  (4) a REALISTIC-lives run fails cleanly (terminates — no one-mistake snowball).
// ---------------------------------------------------------------------------
console.log('\nroguelike endless — relics, affixes, mutators, weekly seed, events…')

// (1) RANKED PURITY: a no-rogue endless run must stay exactly as it always was.
{
  const sim = makeSim(4242, 3, 0) // makeSim passes NO rogue config
  if (sim.rogue) fail('ranked-purity: makeSim (no rogue config) unexpectedly entered rogue mode')
  deployParty(sim); saturateTowers(sim, 'max')
  const baseIds = new Set(DRAFT_POOL.map((c) => c.id))
  let sawElite = false
  let badDraft = ''
  let tick = 0
  while (sim.waveIndex < 24 && tick < STEP_BUDGET) {
    if (sim.state === 'draft') {
      for (const c of sim.draftOffer) if (!baseIds.has(c.id)) badDraft = c.id
      sim.chooseDraft(tick % 3); continue
    }
    if (sim.state === 'prep') sim.startWave()
    if (sim.state === 'won' || sim.state === 'lost') break
    sim.step(); tick++
    for (const e of sim.enemies) if (e.active && e.elite) sawElite = true
  }
  if (sawElite) fail('ranked-purity: an ELITE affix spawned in a non-rogue endless run')
  if (badDraft) fail(`ranked-purity: non-rogue draft offered a ROGUE card (${badDraft})`)
  if (sim.runStats.relicsTaken.length !== 0) fail('ranked-purity: relicsTaken populated in a non-rogue run')
  if (sim.runStats.elitesSlain !== 0) fail('ranked-purity: elitesSlain nonzero in a non-rogue run')
  console.log('  ranked purity ✓ — no rogue card / affix / bookkeeping leaks into endless')
}

// (2) POOL + DETERMINISTIC ROLL
if (ROGUE_DRAFT_POOL.length < 100) fail(`rogue pool too small: ${ROGUE_DRAFT_POOL.length} (need 100+)`)
{
  const dupe = ROGUE_DRAFT_POOL.map((c) => c.id).filter((x, i, a) => a.indexOf(x) !== i)
  if (dupe.length) fail(`rogue pool has duplicate ids: ${dupe.slice(0, 3).join(',')}`)
  // deterministic weighted roll + no-repeat of taken uniques
  const a = rollRogueDraft(new RNG(7), new Set(), 10, [], 3)
  const b = rollRogueDraft(new RNG(7), new Set(), 10, [], 3)
  if (a.map((c) => c.id).join() !== b.map((c) => c.id).join()) fail('rollRogueDraft is non-deterministic for a fixed rng/seed')
  const taken = new Set(ROGUE_DRAFT_POOL.filter((c) => c.unique).map((c) => c.id))
  const excl = rollRogueDraft(new RNG(9), taken, 30, [], 4)
  if (excl.some((c) => c.unique && taken.has(c.id))) fail('rollRogueDraft offered an already-taken unique relic')
  // event boost tags must skew the distribution toward matching relics
  let fireHits = 0
  for (let s = 0; s < 400; s++) {
    for (const c of rollRogueDraft(new RNG(s * 131 + 1), new Set(), 20, ['fire'], 3)) {
      if (c.tags?.includes('fire')) fireHits++
    }
  }
  if (fireHits < 60) fail(`event boost tags barely skewed the roll (${fireHits} fire hits in 400 draws)`)
  console.log(`  pool ✓ — ${ROGUE_DRAFT_POOL.length} cards, deterministic weighted roll, uniques never repeat, boost skews (${fireHits} fire hits/400)`)
}

// (3) a rogue run with the given mutators — god-mode so it reaches deep waves and
// stacks affixes; validated every tick, elites must spawn, reactions must fire.
function runRogue(seed: number, mutators: MutatorId[], boostTags: string[], waves: number): { wave: number; elites: number; reactions: number; relics: number; fp: string } {
  const sim = new Sim({
    level: STRESS_LEVEL, mods: { ...NEUTRAL }, seed, endless: true,
    rogue: { mutators, boostTags },
    startGold: 5_000_000, startLives: 5_000_000, party: PARTIES[0],
  })
  if (!sim.rogue) fail(`rogue config [${mutators.join(',')}] did not enter rogue mode`)
  deployParty(sim); saturateTowers(sim, 'max'); fuseSome(sim)
  const retired = new Set<number>()
  let tick = 0
  let elites = 0
  while (sim.waveIndex < waves && tick < STEP_BUDGET) {
    if (sim.state === 'draft') { sim.chooseDraft(tick % 3); continue }
    if (sim.state === 'prep') sim.startWave()
    if (sim.state === 'won' || sim.state === 'lost') break
    if (tick % 600 === 0) saturateTowers(sim, 'max')
    if (tick % 120 === 0) castHeroSpells(sim)
    sim.step(); tick++
    for (const e of sim.enemies) if (e.active && e.elite) elites++
    validate(sim, tick)
    checkIds(sim, retired, tick)
  }
  return { wave: sim.waveIndex, elites, reactions: sim.runStats.reactions, relics: sim.runStats.relicsTaken.length, fp: `${sim.waveIndex}|${sim.gold}|${sim.clock.toFixed(3)}|${sim.liveEnemyCount()}` }
}

let rogueElites = 0
let rogueReactions = 0
let mi = 0
for (const m of MUTATOR_IDS) {
  const seed = (0x1234567 ^ Math.imul(mi + 1, 2654435761)) >>> 0
  const r = runRogue(seed, [m], [], 26)
  rogueElites += r.elites
  rogueReactions += r.reactions
  if (r.relics < 3) fail(`rogue run [${m}] drafted too few relics (${r.relics})`)
  mi++
}
// the live event (weekly headline + emberwaste twist) must also run clean
{
  const plan = weeklyPlan(EVENTS[0].startMs + 3_600_000)
  const r = runRogue(plan.seed, plan.rogue.mutators, plan.rogue.boostTags, 24)
  rogueElites += r.elites; rogueReactions += r.reactions
}
if (rogueElites === 0) fail('no ELITE affixes ever spawned across the rogue stress runs')
if (rogueReactions === 0) fail('no reactions fired across the rogue stress runs')
console.log(`  ${MUTATOR_IDS.length} mutators + event ran clean — elites ${rogueElites}, reactions ${rogueReactions}`)

// determinism: identical rogue seed + mutators ⇒ identical end-state
{
  const f1 = runRogue(31337, ['chain_reaction'], ['fire'], 14).fp
  const f2 = runRogue(31337, ['chain_reaction'], ['fire'], 14).fp
  if (f1 !== f2) fail(`rogue run non-deterministic: ${f1} vs ${f2}`)
}

// (4) CLEAN FAILURE — a realistic-lives run must TERMINATE (die or reach target),
// never snowball forever. No god-mode: 20 lives, base towers only.
{
  const sim = new Sim({
    level: STRESS_LEVEL, mods: { ...NEUTRAL }, seed: 55, endless: true,
    rogue: { mutators: ['ironclad', 'blitz'], boostTags: [] },
    startGold: 300, startLives: 20, party: PARTIES[0],
  })
  deployParty(sim); saturateTowers(sim, 'base')
  let tick = 0
  const retired = new Set<number>()
  while (tick < 60 * 60 * 30) {
    if (sim.state === 'draft') { sim.chooseDraft(tick % 3); continue }
    if (sim.state === 'prep') sim.startWave()
    if (sim.state === 'won' || sim.state === 'lost') break
    sim.step(); tick++
    validate(sim, tick)
    checkIds(sim, retired, tick)
  }
  if (sim.state !== 'lost' && sim.waveIndex < 5) fail(`clean-failure run neither died nor progressed (wave ${sim.waveIndex}, ${sim.lives} lives)`)
  console.log(`  clean failure ✓ — realistic run ended state '${sim.state}' at wave ${sim.waveIndex + 1}, ${sim.lives} lives`)
}

// (5) EVENTS + WEEKLY SEED — deterministic resolution + window correctness.
{
  const emberwaste = EVENTS.find((e) => e.id === 'emberwaste')!
  if (!emberwaste) fail('Emberwaste event missing from EVENTS')
  const inWindow = emberwaste.startMs + 86_400_000
  if (activeEvent(inWindow)?.id !== 'emberwaste') fail('Emberwaste not active inside its own window')
  if (activeEvent(emberwaste.endMs + 86_400_000) !== null) fail('an event is active AFTER its window closes')
  if (activeEvent(emberwaste.startMs - 86_400_000) !== null) fail('an event is active BEFORE its window opens')
  // weekly plan is deterministic + folds the event mutators/boosts
  const p1 = weeklyPlan(inWindow); const p2 = weeklyPlan(inWindow)
  if (JSON.stringify(p1.rogue) !== JSON.stringify(p2.rogue)) fail('weeklyPlan is non-deterministic')
  if (!p1.rogue.mutators.includes('pyroclasm')) fail('Emberwaste window plan is missing the event mutator (pyroclasm)')
  if (!p1.rogue.mutators.includes(weeklyMutator(weekIndex(inWindow)))) fail('weeklyPlan dropped the weekly headline mutator')
  if (!MUTATORS[p1.headline]) fail('weekly headline mutator id is not a real mutator')
  console.log(`  events ✓ — Emberwaste live in-window, weekly seed deterministic, headline+event mutators folded`)
}

// SALVAGE — sell-tower is a real recorded sim input. Prove the refund math
// (75% of everything invested), that the tile frees for a re-build, and that
// the op is deterministic (same seed + same ops ⇒ identical fingerprint).
console.log('\nsalvage — 75% refund · tile freed · deterministic…')
{
  const run = (report: boolean): { goldAfter: number; refund: number; replaced: boolean } => {
    const sim = makeSim(0xa11ce)
    const cells = sim.buildCells()
    const cell = cells[0]
    const g0 = sim.gold
    const t = sim.placeTower('storm', cell.col, cell.row)
    if (!t) { fail('salvage: could not place the probe tower'); return { goldAfter: 0, refund: 0, replaced: false } }
    sim.upgradeTower(t.id)
    sim.upgradeTower(t.id)
    const spent = g0 - sim.gold
    if (t.invested !== spent) fail(`salvage: invested tracking drifted — invested ${t.invested} vs actually spent ${spent}`)
    const expect = Math.floor(t.invested * 0.75)
    if (sim.salvageRefundFor(t) !== expect) fail(`salvage: refund preview ${sim.salvageRefundFor(t)} != floor(75% of ${t.invested}) = ${expect}`)
    const refund = sim.salvageTower(t.id)
    if (refund !== expect) fail(`salvage: granted refund ${refund} != expected ${expect}`)
    if (sim.gold !== g0 - spent + expect) fail(`salvage: gold after sell ${sim.gold} != ${g0 - spent + expect}`)
    if (sim.towerAt(cell.col, cell.row)) fail('salvage: tile still occupied after selling')
    if (sim.salvageTower(t.id) !== null) fail('salvage: selling the same tower twice must fail')
    const re = sim.placeTower('flame', cell.col, cell.row) // the freed tile must take a new tower
    if (!re) fail('salvage: freed tile refused a re-build')
    if (re && re.invested !== sim.placeCost('flame')) fail('salvage: re-built tower inherited stale invested value')
    if (report) console.log(`  refund ok — invested ${t.invested} → +${expect} back, tile re-built`)
    return { goldAfter: sim.gold, refund: expect, replaced: !!re }
  }
  const a = run(true)
  const b = run(false)
  if (a.goldAfter !== b.goldAfter || a.refund !== b.refund) fail('salvage: non-deterministic across identical runs')
}

// (6) RANKED REPLAY VERIFICATION — THE MOAT. Drive a canonical ranked run while
// recording its input log, then RE-RUN that log through the SAME pure sim the
// server uses and assert the replay reproduces the claimed score+wave exactly.
// Then prove the gate rejects a tampered score and a version mismatch. This is
// "the tower defense that literally cannot cheat", asserted headlessly.
{
  const KINDS: TowerKind[] = ['cannon', 'frost', 'flame', 'storm', 'arcane']
  const HERO_IDS = ['ember', 'glacia', 'sylvan']
  // Build only through wave BUILD_UNTIL, then FREEZE the board — the endless
  // curve (HP + count) keeps scaling past a static defence, so the run always
  // reaches a NATURAL death well before any tick cap. That's what makes the
  // positive test prove replay-to-DEATH (not replay-to-cap): a shared cap would
  // false-green over the exact reject bug that matters most.
  const BUILD_UNTIL = 10

  function driveRanked(seed: number): { rec: RankedRunRecord; score: number; wave: number; state: string; ops: Record<string, number> } {
    const party: DeclaredHero[] = [{ heroId: 'ember' }, { heroId: 'glacia' }, { heroId: 'sylvan' }]
    const sim = new Sim(rankedConfig('endless', seed, party))
    const rec = new RunRecorder()
    const ops: Record<string, number> = {}
    const bump = (k: string) => { ops[k] = (ops[k] ?? 0) + 1 }
    const cells = sim.buildCells()
    const towerIds: number[] = []
    let deployed = 0
    const TOWER_CAP = 3
    const HERO_CAP = 1 // a thin, frozen board: guaranteed to be overrun by the curve
    let tick = 0
    while (sim.state !== 'won' && sim.state !== 'lost' && tick <= REPLAY_TICK_CAP) {
      if (sim.state === 'draft') {
        const idx = sim.draftsTaken % Math.max(1, sim.draftOffer.length)
        if (sim.chooseDraft(idx)) { rec.draft(idx); bump('draft') }
        else sim.chooseDraft(0)
        continue
      }
      const clock = sim.clock
      const building = sim.waveIndex < BUILD_UNTIL // freeze the board afterwards
      // deploy the 3-hero party onto the back build cells, one per prep window
      if (building && sim.state === 'prep' && deployed < HERO_CAP && tick > 30 && tick % 20 === 0) {
        const cell = cells[cells.length - 1 - deployed]
        if (sim.deployHero(HERO_IDS[deployed], cell.col, cell.row)) {
          rec.deploy(clock, HERO_IDS[deployed], cell.col, cell.row); bump('deploy'); deployed++
        }
      }
      // build out to the cap on the front cells, cycling elements
      if (building && tick % 24 === 12 && towerIds.length < TOWER_CAP && towerIds.length < cells.length - 3) {
        const cell = cells[towerIds.length]
        const kind = KINDS[towerIds.length % KINDS.length]
        const t = sim.placeTower(kind, cell.col, cell.row)
        if (t) { rec.place(clock, kind, cell.col, cell.row); bump('place'); towerIds.push(t.id) }
      }
      // upgrade tower #0 toward a branch (covers upgrade + branch opcodes)
      if (building && tick % 30 === 0 && towerIds.length > 0) {
        if (sim.upgradeTower(towerIds[0])) { rec.upgrade(clock, towerIds[0]); bump('upgrade') }
      }
      if (building && tick % 90 === 40 && towerIds.length > 0) {
        if (sim.chooseBranch(towerIds[0], (tick / 90) % 2 | 0)) { rec.branch(clock, towerIds[0], (tick / 90) % 2 | 0); bump('branch') }
      }
      // set targeting on the newest tower
      if (building && tick % 55 === 5 && towerIds.length > 1) {
        const id = towerIds[towerIds.length - 1]
        sim.setTargeting(id, 'Strong'); rec.target(clock, id, 'Strong'); bump('target')
      }
      // fuse the first two towers once they exist
      if (building && tick === 260 && towerIds.length >= 2) {
        if (sim.fuseTowers(towerIds[0], towerIds[1])) { rec.fuse(clock, towerIds[0], towerIds[1]); bump('fuse') }
      }
      // salvage the newest tower once (covers the OP_SALVAGE opcode), then
      // re-build on the freed cell next placement window if the cap allows
      if (building && tick === 300 && towerIds.length >= 3) {
        if (sim.salvageTower(towerIds[2]) !== null) { rec.salvage(clock, towerIds[2]); bump('salvage') }
      }
      // global spell + hero spell on cooldown — FROZEN after the build window too,
      // so no active-play offense keeps the frozen board alive past the curve.
      if (building && tick % 70 === 20 && sim.spellCd.meteor <= 0) {
        if (sim.castSpell('meteor' as SpellKey, 360, 500)) { rec.spell(clock, 'meteor', 360, 500); bump('spell') }
      }
      if (building && tick % 65 === 25) {
        for (const h of sim.deployedHeroes()) {
          if (h.spellCd <= 0 && sim.castHeroSpell(h.id, h.x, h.y)) { rec.heroSpell(clock, h.id, h.x, h.y); bump('heroSpell'); break }
        }
      }
      // start some waves early (manual), let the rest auto-start on the prep timer
      if (sim.state === 'prep' && tick % 41 === 7) {
        sim.startWave(); rec.startWave(clock); bump('startWave')
      }
      sim.step()
      tick++
    }
    return { rec: rec.record('endless', seed, 0, party, sim.score(), sim.waveIndex + 1), score: sim.score(), wave: sim.waveIndex + 1, state: sim.state, ops }
  }

  const seed = codeToSeed('AZURE-KOI-07') ?? 12345
  const run = driveRanked(seed)
  // The run must end in a NATURAL DEATH before any cap — otherwise the positive
  // replay below would only be proving replay-to-cap (a false green over the moat).
  if (run.state !== 'lost') fail(`ranked driver did NOT die naturally (ended '${run.state}' at wave ${run.wave}) — the board isn't being overrun, so replay-to-death is unproven`)
  if (run.rec.log.c.length < 20) fail(`ranked driver recorded too few commands (${run.rec.log.c.length}) — bot may not be building`)

  // opcode coverage — every command KIND must round-trip through the replay
  for (const need of ['place', 'upgrade', 'deploy', 'target', 'spell', 'heroSpell', 'startWave', 'salvage']) {
    if (!run.ops[need]) fail(`ranked replay self-test never exercised the '${need}' command opcode`)
  }

  // POSITIVE: replay reproduces the claimed score + wave EXACTLY
  const r1 = replayRun(run.rec)
  if (r1.score !== run.score) fail(`ranked replay score mismatch: replay ${r1.score} vs live ${run.score}`)
  if (r1.wave !== run.wave) fail(`ranked replay wave mismatch: replay ${r1.wave} vs live ${run.wave}`)

  // DETERMINISM: two replays of the same record are byte-identical
  const r2 = replayRun(run.rec)
  if (r1.fingerprint !== r2.fingerprint) fail(`ranked replay non-deterministic: ${r1.fingerprint} vs ${r2.fingerprint}`)

  // GATE: an honest record is ACCEPTED
  const vOk = verifyRun(run.rec)
  if (!vOk.ok || vOk.reason !== '') fail(`verifyRun rejected an HONEST run (reason '${vOk.reason}')`)

  // NEGATIVE: a tampered CLAIMED score is REJECTED (this is the whole point)
  const vHi = verifyRun({ ...run.rec, score: run.rec.score + 1000000 })
  if (vHi.ok || vHi.reason !== 'mismatch') fail(`verifyRun ACCEPTED a tampered score (reason '${vHi.reason}')`)
  const vWave = verifyRun({ ...run.rec, wave: run.rec.wave + 50 })
  if (vWave.ok || vWave.reason !== 'mismatch') fail(`verifyRun ACCEPTED a tampered wave (reason '${vWave.reason}')`)

  // VERSION GATE: a log recorded under a different sim version is REJECTED
  const vVer = verifyRun({ ...run.rec, v: SIM_VERSION + 1 })
  if (vVer.ok || vVer.reason !== 'version') fail(`verifyRun ACCEPTED a stale sim_version (reason '${vVer.reason}')`)

  // A DROPPED command must change the outcome (proves the log actually DRIVES the
  // sim — an inert log that verified regardless would be a broken moat). Strip the
  // opening tower placements: a run with no early towers dies far sooner.
  const trimmed: RankedRunRecord = { ...run.rec, log: { c: run.rec.log.c.filter((cmd) => cmd[0] !== 0), d: run.rec.log.d } }
  const rTrim = replayRun(trimmed)
  if (rTrim.score === run.score && rTrim.wave === run.wave) {
    fail('dropping ALL placement commands did NOT change the replay — the log may be inert')
  }

  // hash is stable + differs when the log differs
  if (logHash(run.rec) !== logHash(run.rec)) fail('logHash is non-deterministic')
  if (logHash(run.rec) === logHash(trimmed)) fail('logHash collides across different logs')

  console.log(`  ranked replay ✓ — recorded ${run.rec.log.c.length} cmds + ${run.rec.log.d.length} drafts, re-ran to score ${run.score}/wave ${run.wave}; tamper + version + drop all rejected`)
}

// ---------------------------------------------------------------------------
// (7) PATHFORGE JOINS THE RANKED SPINE (Chromancer#56) — THE MOAT, maze edition.
// Proves the SAME single verification path (verifyRun/replayRun) that just proved
// itself above for 'endless' also holds for 'pathforge': (a) record → replay →
// IDENTICAL score/wave; (b) an honest pathforge record is ACCEPTED; (c) the
// server-side maze re-validation REJECTS a route that doesn't reach the
// seed-derived spawn/base (the anti-trap rule, re-run server-side, never
// trusting the client's claimed route); (d) a tampered/reordered route is
// REJECTED even when every individual cell is legal; (e) a tampered score is
// still REJECTED exactly like every other mode.
// ---------------------------------------------------------------------------
console.log('\npathforge ranked replay — server-side re-validate + rebuild + replay (Chromancer#56)…')
{
  const seed = codeToSeed('AZURE-KOI-07') ?? 12345
  const { spawn, base } = pathforgeLayout(seed)
  // An L-corridor that ALWAYS connects this seed's spawn/base: spawn's full row,
  // then base's column from spawn's row down/up to base's row (spawn is col 0,
  // base is col COLS-1 for every seed — see pathforgeLayout).
  const road = new Set<number>()
  for (let c = 0; c < PF_COLS; c++) road.add(pfKey(c, spawn[1]))
  const rLo = Math.min(spawn[1], base[1]), rHi = Math.max(spawn[1], base[1])
  for (let r = rLo; r <= rHi; r++) road.add(pfKey(base[0], r))
  const mv = validateMaze(road, spawn, base)
  if (!mv.ok || !mv.route) {
    fail('pathforge ranked test: the constructed L-corridor maze was unexpectedly invalid')
  } else {
  const route = mv.route

  function drivePathforge(seed: number, route: PFCell[]): { rec: RankedRunRecord; score: number; wave: number; state: string } {
    const party: DeclaredHero[] = [{ heroId: 'ember' }, { heroId: 'glacia' }, { heroId: 'sylvan' }]
    const sim = new Sim(rankedConfig('pathforge', seed, party, route))
    const rec = new RunRecorder()
    const cells = sim.buildCells()
    const towerIds: number[] = []
    const TOWER_CAP = 3
    let tick = 0
    while (sim.state !== 'won' && sim.state !== 'lost' && tick <= REPLAY_TICK_CAP) {
      if (sim.state === 'draft') {
        const idx = sim.draftsTaken % Math.max(1, sim.draftOffer.length)
        if (sim.chooseDraft(idx)) rec.draft(idx)
        else sim.chooseDraft(0)
        continue
      }
      const clock = sim.clock
      // build a thin, frozen board (wave 10 and on) — the endless curve overruns it,
      // so this proves replay-to-a-NATURAL-death, not replay-to-cap.
      const building = sim.waveIndex < 10
      if (building && tick % 24 === 12 && towerIds.length < TOWER_CAP && towerIds.length < cells.length) {
        const cell = cells[towerIds.length]
        const kind: TowerKind = (['cannon', 'frost', 'flame'] as TowerKind[])[towerIds.length % 3]
        const t = sim.placeTower(kind, cell.col, cell.row)
        if (t) { rec.place(clock, kind, cell.col, cell.row); towerIds.push(t.id) }
      }
      if (sim.state === 'prep' && tick % 41 === 7) { sim.startWave(); rec.startWave(clock) }
      sim.step()
      tick++
    }
    return { rec: rec.record('pathforge', seed, 0, party, sim.score(), sim.waveIndex + 1, route), score: sim.score(), wave: sim.waveIndex + 1, state: sim.state }
  }

  const run = drivePathforge(seed, route)
  if (run.state !== 'lost') fail(`pathforge ranked driver did NOT die naturally (ended '${run.state}' at wave ${run.wave})`)
  if (!run.rec.route || run.rec.route.length !== route.length) fail('pathforge ranked record did not carry the committed route')

  // POSITIVE: replay reproduces the claimed score + wave EXACTLY, twice (determinism)
  const r1 = replayRun(run.rec)
  if (r1.score !== run.score || r1.wave !== run.wave) fail(`pathforge ranked replay mismatch: replay ${r1.score}/${r1.wave} vs live ${run.score}/${run.wave}`)
  const r2 = replayRun(run.rec)
  if (r1.fingerprint !== r2.fingerprint) fail(`pathforge ranked replay non-deterministic: ${r1.fingerprint} vs ${r2.fingerprint}`)

  // GATE: an honest pathforge record is ACCEPTED through the SAME verifyRun() —
  // no second/parallel verification path for this mode.
  const vOk = verifyRun(run.rec)
  if (!vOk.ok || vOk.reason !== '') fail(`verifyRun rejected an HONEST pathforge run (reason '${vOk.reason}')`)

  // NEGATIVE (anti-trap, server-side): a route walled off from the seed's base
  // (never reaches it) is REJECTED — the client's claimed route is NEVER trusted.
  const walledRoute: PFCell[] = route.slice(0, Math.max(2, Math.floor(route.length / 2)))
  const vWalled = verifyRun({ ...run.rec, route: walledRoute })
  if (vWalled.ok || vWalled.reason !== 'invalid') fail(`verifyRun ACCEPTED a route that never reaches the base (reason '${vWalled.reason}')`)

  // NEGATIVE: a route reordered/reversed (every cell individually legal, but not
  // the canonical BFS-shortest order for its own cell set) is REJECTED.
  const reversedRoute = route.slice().reverse()
  if (JSON.stringify(reversedRoute) !== JSON.stringify(route)) {
    const vRev = verifyRun({ ...run.rec, route: reversedRoute })
    if (vRev.ok || vRev.reason !== 'invalid') fail(`verifyRun ACCEPTED a reordered route (reason '${vRev.reason}')`)
  }

  // NEGATIVE: a tampered claimed score is REJECTED, exactly like every other mode.
  const vHi = verifyRun({ ...run.rec, score: run.rec.score + 1_000_000 })
  if (vHi.ok || vHi.reason !== 'mismatch') fail(`verifyRun ACCEPTED a tampered pathforge score (reason '${vHi.reason}')`)

  // VERSION GATE still applies to pathforge records.
  const vVer = verifyRun({ ...run.rec, v: SIM_VERSION + 1 })
  if (vVer.ok || vVer.reason !== 'version') fail(`verifyRun ACCEPTED a stale sim_version pathforge record (reason '${vVer.reason}')`)

  console.log(`  pathforge ranked replay ✓ — mode wired into verifyRun/replayRun, route ${route.length} tiles, re-ran to score ${run.score}/wave ${run.wave}; walled/reordered/tampered/version all rejected`)
  }
}

// ---------------------------------------------------------------------------
// PATHFORGE — the player-built maze mode. Proves: (1) the anti-trap HARD RULE
// (a maze without a completable Portal→Wellspring route is REJECTED — you can
// never wall the enemies off); (2) openBuild (every non-road tile is a tower
// slot); (3) determinism (same seed + same maze + same scripted play → identical);
// (4) beatability (a competent bot survives real waves on a built maze — no NaN /
// out-of-range along the way).
// ---------------------------------------------------------------------------
console.log('\npathforge — player-built maze: anti-trap rule, open-grid building, determinism, beatability…')
{
  const spawn: PFCell = [0, 0]
  const base: PFCell = [PF_COLS - 1, PF_ROWS - 1]

  // (1) ANTI-TRAP — endpoints only, not connected → REJECTED.
  const walled = new Set<number>([pfKey(spawn[0], spawn[1]), pfKey(base[0], base[1])])
  if (validateMaze(walled, spawn, base).ok) fail('pathforge: a disconnected maze was ACCEPTED (anti-trap rule broken)')

  // an L-corridor down the left edge then across the bottom → connected + valid.
  const corridor = new Set<number>()
  for (let r = 0; r < PF_ROWS; r++) corridor.add(pfKey(0, r))
  for (let c = 0; c < PF_COLS; c++) corridor.add(pfKey(c, PF_ROWS - 1))
  if (!validateMaze(corridor, spawn, base).ok) fail('pathforge: a connected corridor was REJECTED')

  // sever one interior tile → the maze must re-validate to INVALID (no mid-run trap).
  const broken = new Set(corridor); broken.delete(pfKey(0, 5))
  if (validateMaze(broken, spawn, base).ok) fail('pathforge: severing the corridor did NOT invalidate the maze')

  // A long single-corridor serpentine — BFS has no shortcut, so the committed route
  // traverses the WHOLE snake (the "longer maze = more fire" lever, proven long).
  const snake = new Set<number>()
  for (let r = 0; r < PF_ROWS; r++) {
    if (r % 2 === 0) { for (let c = 0; c < PF_COLS; c++) snake.add(pfKey(c, r)) }
    else snake.add(pfKey(((r - 1) / 2) % 2 === 0 ? PF_COLS - 1 : 0, r))
  }
  const vSnake = validateMaze(snake, spawn, base)
  if (!vSnake.ok || !vSnake.route) {
    fail('pathforge: the serpentine maze was REJECTED')
  } else {
    const route = vSnake.route
    if (route.length < PF_COLS * 4) fail(`pathforge: serpentine route unexpectedly short (${route.length})`)

    // (2) OPEN-GRID BUILDING — every non-road tile is buildable (openBuild).
    const probe = new Sim({
      level: pathforgeLevel(route), mods: { ...NEUTRAL }, seed: 0xF0, endless: true,
      startGold: 300, startLives: 20, party: BOT_PARTY,
    })
    const expectBuild = PF_COLS * PF_ROWS - route.length
    if (probe.buildCells().length !== expectBuild) {
      fail(`pathforge: openBuild wrong — ${probe.buildCells().length} build cells, expected ${expectBuild}`)
    }

    // (3) + (4) — scripted deterministic play; god-lives run for a fixed budget →
    // fingerprint must match byte-for-byte across two identical runs.
    const playPathforge = (seed: number, godMode: boolean, budget: number): { fp: string; wave: number; peak: number } => {
      const sim = new Sim({
        level: pathforgeLevel(route), mods: { ...NEUTRAL }, seed, endless: true,
        // godMode = stress/determinism coverage; else the REAL Pathforge economy
        // (ENDLESS_START_GOLD 300 / 20 lives) so beatability is a fair lower bound.
        startGold: godMode ? 5_000_000 : 300, startLives: godMode ? 10_000_000 : 20, party: BOT_PARTY,
      })
      deployParty(sim)
      const placeRef = { i: 0 }
      let peak = 0
      let h = 2166136261 >>> 0
      const mix = (n: number): void => { h = Math.imul(h ^ (n | 0), 16777619) >>> 0 }
      for (let t = 0; t < budget; t++) {
        if (sim.state === 'lost' || sim.state === 'won') break
        if (sim.state === 'draft') { sim.chooseDraft(0); continue } // endless between-wave draft
        if (sim.state === 'prep') { botSpend(sim, placeRef, TOWER_ORDER as unknown as string[]); sim.startWave() }
        sim.step()
        validate(sim, t)
        let live = 0
        for (const e of sim.enemies) if (e.active) live++
        if (live > peak) peak = live
        if (t % 30 === 0) {
          mix(Math.round(sim.lives * 100)); mix(sim.waveIndex); mix(Math.round(sim.gold))
          for (const e of sim.enemies) if (e.active) { mix(Math.round(e.x)); mix(Math.round(e.y)); mix(Math.round(e.hp)) }
        }
      }
      return { fp: (h >>> 0).toString(16), wave: sim.waveIndex + 1, peak }
    }

    const seed = 0x9A2E
    const a = playPathforge(seed, true, 60 * 60)
    const b = playPathforge(seed, true, 60 * 60)
    if (a.fp !== b.fp) fail(`pathforge: NON-DETERMINISTIC — ${a.fp} vs ${b.fp} (same seed + maze + play)`)

    // (4) BEATABILITY — with the REAL Pathforge economy (300 gold / 20 lives), a
    // competent bot on a built maze survives real waves. A bot clear is a valid lower
    // bound (a human does better), mirroring the campaign autoPlay proof.
    const fair = playPathforge(seed, false, 60 * 60 * 12)
    if (fair.wave < 8) fail(`pathforge: a built maze was NOT beatable at fair economy — bot fell at wave ${fair.wave}`)

    console.log(`  pathforge ✓ — anti-trap enforced, ${expectBuild} open build tiles, route ${route.length} tiles, deterministic (${a.fp}), fair-economy bot reached wave ${fair.wave}, peak ${Math.max(a.peak, fair.peak)} live`)
  }
}

if (failures > 0) {
  console.error(`\nSIMCHECK FAILED — ${failures} violation(s).`)
  process.exit(1)
} else {
  console.log(`\nSIMCHECK PASSED — max ${peak} concurrent entities, ${waves} waves, no NaN/Infinity/out-of-range.`)
  process.exit(0)
}
