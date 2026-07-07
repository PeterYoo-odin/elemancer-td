// BALANCE AUTO-TUNING HARNESS — the competitive edge our pure, deterministic sim
// buys us. It plays THOUSANDS of seeded battles across every tower/branch build,
// relic strategy and map layout, records how deep each survives, and emits a
// BALANCE REPORT that flags degenerate/dominant strategies and dead/underused
// content — plus a machine-readable SUGGESTED-TUNING diff for human review.
//
//   run:   npm run balance                  (CI-safe default sample)
//          BALANCE_RUNS=24 npm run balance   (deep sweep — thousands of sims)
//          BALANCE_ARENAS=6 npm run balance  (widen the map-layout sample)
//          npm run balance -- --fail-on-degenerate   (non-zero exit if a combo
//                                                      trips the degeneracy gate)
//
// WHY ENDLESS: every hand-authored campaign level is provably beatable (simcheck
// proves min-resource beatability), so on the ladder every build wins with full
// lives and there is no signal. Endless mode ramps difficulty without bound, so
// "waves survived on modest lives" becomes a clean, unbounded power yardstick that
// separates a fair build from a degenerate one. Difficulty IS the endless ramp.
//
// It NEVER mutates balance values. Outputs:
//   · BALANCE_REPORT.md      human-readable findings + suggested tuning
//   · balance-report.json    machine-readable metrics + suggested diff
//
// Runs via tsx (outside tsconfig `include`, like simcheck) so it never touches the
// `tsc --noEmit` gate. Imports only the headless sim + data tables (no Phaser/Three).

import { writeFileSync } from 'node:fs'
import { Sim } from '../src/sim/index'
import type { TowerKind } from '../src/game/towers'
import { DRAFT_POOL, type DraftCard } from '../src/sim/drafts'
import { LEVELS, type LevelDef } from '../src/game/levels'
import { NEUTRAL } from '../src/game/workshop'

// ---------------------------------------------------------------------------
//  Configuration (env-overridable so CI runs cheap and a manual deep-sweep runs
//  thousands). We LOG the sample so a truncated run never reads as exhaustive.
// ---------------------------------------------------------------------------
const RUNS_PER_CELL = clampInt(process.env.BALANCE_RUNS, 6, 1, 400)
const ARENA_SAMPLES = clampInt(process.env.BALANCE_ARENAS, 4, 1, 40)
const FAIL_ON_DEGENERATE = process.argv.includes('--fail-on-degenerate')

const WAVE_CAP = 90 // survive this deep in endless = a build that trivialises the ramp
const START_LIVES = 30 // enough that death is DPS-limited (the ramp out-scales clear
//                        rate), not one-leak-and-out — so depth reflects real power
const START_GOLD = 240 // ~3 opening towers; the rest must be EARNED (economy matters)
// A LIGHT hero floor (low level) so the TOWER/relic axes decide survival, not a
// pair of maxed champions swamping every difference. Heroes still fire + synergise.
const PARTY_LEVEL = 6
const STEP_BUDGET = 60 * 60 * 30 // ~30 min sim-time cap per battle (safety net)
const SPELL_EVERY = 150 // ticks between hero-spell casts
const SPEND_EVERY = 120 // ticks between build passes during a wave

function clampInt(raw: string | undefined, dflt: number, lo: number, hi: number): number {
  const v = raw === undefined ? dflt : Number.parseInt(raw, 10)
  if (!Number.isFinite(v)) return dflt
  return Math.max(lo, Math.min(hi, v))
}

// Sample a spread of real map LAYOUTS (path shapes vary tower placement value).
// Difficulty comes from the endless ramp, not the level index, so any layouts work.
function sampleArenas(): LevelDef[] {
  const n = Math.min(ARENA_SAMPLES, LEVELS.length)
  const out: LevelDef[] = []
  const seen = new Set<number>()
  for (let i = 0; i < n; i++) {
    const idx = Math.min(LEVELS.length - 1, Math.round((i / Math.max(1, n - 1)) * (LEVELS.length - 1)))
    if (!seen.has(idx)) { seen.add(idx); out.push(LEVELS[idx]) }
  }
  return out
}

// Deterministic seed set — the same battle plays identically every run, so the
// report is reproducible across machines and CI.
function seeds(count: number, salt: number): number[] {
  const out: number[] = []
  for (let i = 0; i < count; i++) out.push((0xC0FFEE ^ (salt * 2654435761) ^ (i * 40503)) >>> 0)
  return out
}

function hash(s: string, n: number): number {
  let h = 2166136261 ^ n
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

// ---------------------------------------------------------------------------
//  Build archetypes — a build = which towers to spam + which final branch to take.
//  Single-tower archetypes isolate each branch's power; combo archetypes probe
//  synergies (incl. the suspected Tempest+Blizzard degenerate).
// ---------------------------------------------------------------------------
type BranchMap = Partial<Record<TowerKind, 0 | 1>>
interface Build { id: string; label: string; kinds: TowerKind[]; branch: BranchMap; tag: 'tower' | 'combo' | 'control' }

const BUILDS: Build[] = [
  { id: 'cannon_sniper', label: 'Cannon → Sniper', kinds: ['cannon'], branch: { cannon: 0 }, tag: 'tower' },
  { id: 'cannon_mortar', label: 'Cannon → Mortar', kinds: ['cannon'], branch: { cannon: 1 }, tag: 'tower' },
  { id: 'frost_blizzard', label: 'Frost → Blizzard (+cannon)', kinds: ['frost', 'cannon'], branch: { frost: 0, cannon: 0 }, tag: 'tower' },
  { id: 'frost_glacier', label: 'Frost → Glacier (+cannon)', kinds: ['frost', 'cannon'], branch: { frost: 1, cannon: 0 }, tag: 'tower' },
  { id: 'flame_scorch', label: 'Flame → Scorch', kinds: ['flame'], branch: { flame: 0 }, tag: 'tower' },
  { id: 'flame_phoenix', label: 'Flame → Phoenix', kinds: ['flame'], branch: { flame: 1 }, tag: 'tower' },
  { id: 'storm_tempest', label: 'Storm → Tempest', kinds: ['storm'], branch: { storm: 0 }, tag: 'tower' },
  { id: 'storm_overload', label: 'Storm → Overload', kinds: ['storm'], branch: { storm: 1 }, tag: 'tower' },
  { id: 'arcane_amplify', label: 'Arcane → Amplify (+cannon)', kinds: ['cannon', 'arcane'], branch: { arcane: 0, cannon: 0 }, tag: 'tower' },
  { id: 'arcane_prism', label: 'Arcane → Prism', kinds: ['arcane'], branch: { arcane: 1 }, tag: 'tower' },
  { id: 'balanced', label: 'Balanced spread', kinds: ['cannon', 'frost', 'flame', 'storm'], branch: { cannon: 0, frost: 1, flame: 0, storm: 1 }, tag: 'control' },
  { id: 'tempest_blizzard', label: 'Tempest + Blizzard (suspect)', kinds: ['storm', 'frost'], branch: { storm: 0, frost: 0 }, tag: 'combo' },
]

// ---------------------------------------------------------------------------
//  Relic (draft) strategies — the offer is SEEDED, so we can only pick a preferred
//  card WHEN it appears. We record what was actually acquired, never assume it.
// ---------------------------------------------------------------------------
interface RelicStrat { id: string; label: string; prefer: string[] }
const RELIC_STRATS: RelicStrat[] = [
  { id: 'neutral', label: 'First offered (control)', prefer: [] },
  { id: 'combo', label: 'Chain Reactor greedy', prefer: ['combo', 'glass', 'alldmg'] },
  { id: 'power', label: 'Raw damage', prefer: ['alldmg', 'glass', 'firerate', 'pen'] },
  { id: 'economy', label: 'Economy / scaling', prefer: ['gold', 'cost', 'firerate'] },
  { id: 'survival', label: 'Survival', prefer: ['heal', 'frost', 'alldmg'] },
]

function pickDraft(offer: DraftCard[], strat: RelicStrat): number {
  for (const want of strat.prefer) {
    const i = offer.findIndex((c) => c.id === want)
    if (i >= 0) return i
  }
  return 0
}

// A fixed, fair starter party for every battle (the fresh-save roster) so the
// tower/relic axes are isolated from hero-collection power.
const STARTER_PARTY = [
  { heroId: 'ember', level: PARTY_LEVEL },
  { heroId: 'glacia', level: PARTY_LEVEL },
  { heroId: 'sylvan', level: PARTY_LEVEL },
]

// ---------------------------------------------------------------------------
//  A single seeded ENDLESS battle. Returns how deep it survived + snowball timing.
// ---------------------------------------------------------------------------
interface Regime { lives: number; gold: number; cap: number; noHeroes?: boolean }
// STANDARD: DPS-limited depth probe (fair resources, deep cap) — ranks tower power.
const REGIME_STD: Regime = { lives: START_LIVES, gold: START_GOLD, cap: WAVE_CAP }
// EARLY: harsh, HEROLESS, low-resource snowball probe. With no champion DPS floor
// and scarce lives/gold, survival depends purely on how fast the TOWER+RELIC build
// snowballs (reach the 6× combo cap on minimal investment). This is where the
// suspected Tempest+Blizzard+comboRamp degeneracy actually bites — it isolates the
// combo engine from everything that would otherwise mask it.
const REGIME_EARLY: Regime = { lives: 4, gold: 150, cap: 26, noHeroes: true }
const COMBO_CAP = 6 // COMBO_MAX in sim.ts — comboMult saturates here

interface Outcome {
  wavesSurvived: number
  reachedCap: boolean
  maxCombo: number
  reactions: number
  fusions: number
  comboCapWave: number // wave at which comboMult first saturated (≈6×); -1 = never
  relicsTaken: string[]
}

function playBattle(arena: LevelDef, seed: number, build: Build, strat: RelicStrat, regime: Regime = REGIME_STD): Outcome {
  const sim = new Sim({
    level: arena, mods: { ...NEUTRAL }, seed, endless: true,
    startGold: regime.gold, startLives: regime.lives, party: regime.noHeroes ? [] : STARTER_PARTY,
  })
  if (!regime.noHeroes) deployParty(sim)
  const relicsTaken: string[] = []
  let comboCapWave = -1
  let tick = 0
  let placeCursor = 0
  while (tick < STEP_BUDGET) {
    if (sim.state === 'lost') break
    if (sim.waveIndex >= regime.cap) break // trivialised the ramp — cap it
    if (sim.state === 'draft') {
      const idx = pickDraft(sim.draftOffer, strat)
      const card = sim.draftOffer[idx]
      if (card) relicsTaken.push(card.id)
      sim.chooseDraft(idx)
      continue
    }
    if (sim.state === 'prep') {
      placeCursor = spend(sim, build, placeCursor)
      sim.startWave()
    }
    if (sim.state === 'active') {
      if (tick % SPEND_EVERY === 0) placeCursor = spend(sim, build, placeCursor)
      if (tick % SPELL_EVERY === 0) castSpells(sim)
    }
    sim.step()
    if (comboCapWave < 0 && sim.comboMult >= COMBO_CAP - 0.6) comboCapWave = sim.waveIndex
    tick++
  }
  return {
    wavesSurvived: sim.waveIndex,
    reachedCap: sim.waveIndex >= regime.cap,
    maxCombo: sim.runStats.maxCombo,
    reactions: sim.runStats.reactions,
    fusions: sim.runStats.fusions,
    comboCapWave,
    relicsTaken,
  }
}

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

function castSpells(sim: Sim): void {
  for (const h of sim.deployedHeroes()) {
    if (h.spellCd <= 0) sim.castHeroSpell(h.id, h.x, h.y - 40)
  }
}

// Greedy builder that honours the archetype: upgrade toward each tower's chosen
// branch, then place fresh towers cycling through the build's allowed kinds.
function spend(sim: Sim, build: Build, cursor: number): number {
  for (const t of sim.towers) {
    if (!t.active) continue
    const uc = sim.upgradeCostFor(t)
    if (uc !== null) { if (sim.gold >= uc) sim.upgradeTower(t.id); continue }
    if (t.level === 2) {
      const idx = build.branch[t.kind] ?? 0
      const bc = sim.branchCostFor(t, idx)
      if (bc !== null && sim.gold >= bc) sim.chooseBranch(t.id, idx)
    }
  }
  for (const c of sim.buildCells()) {
    if (!sim.canPlace(c.col, c.row)) continue
    const kind = build.kinds[cursor % build.kinds.length]
    if (sim.gold >= sim.placeCost(kind) && sim.placeTower(kind, c.col, c.row)) cursor++
    else if (sim.gold < 40) break
  }
  return cursor
}

// ---------------------------------------------------------------------------
//  Aggregation + scoring. Power = mean waves survived (0..WAVE_CAP).
// ---------------------------------------------------------------------------
interface Cell {
  key: string
  buildId: string
  buildLabel: string
  stratId: string
  stratLabel: string
  tag: Build['tag']
  n: number
  caps: number
  sumWaves: number
  sumCombo: number
  sumReactions: number
  sumCapWave: number // Σ combo-saturation wave (over runs that saturated)
  capWaveN: number // count of runs that ever saturated combo
}

function newCell(build: Build, strat: RelicStrat): Cell {
  return {
    key: `${build.id}|${strat.id}`, buildId: build.id, buildLabel: build.label,
    stratId: strat.id, stratLabel: strat.label, tag: build.tag,
    n: 0, caps: 0, sumWaves: 0, sumCombo: 0, sumReactions: 0, sumCapWave: 0, capWaveN: 0,
  }
}
function record(cell: Cell, o: Outcome): void {
  cell.n++
  if (o.reachedCap) cell.caps++
  cell.sumWaves += o.wavesSurvived
  cell.sumCombo += o.maxCombo
  cell.sumReactions += o.reactions
  if (o.comboCapWave >= 0) { cell.sumCapWave += o.comboCapWave; cell.capWaveN++ }
}
const avgWaves = (c: Cell) => (c.n > 0 ? c.sumWaves / c.n : 0)
const capRate = (c: Cell) => (c.n > 0 ? c.caps / c.n : 0)
const avgCombo = (c: Cell) => (c.n > 0 ? c.sumCombo / c.n : 0)
// Mean wave at which combo saturated; Infinity if it never did (weaker snowball).
const avgCapWave = (c: Cell) => (c.capWaveN > 0 ? c.sumCapWave / c.capWaveN : Infinity)
const capWaveRate = (c: Cell) => (c.n > 0 ? c.capWaveN / c.n : 0)
const powerScore = (c: Cell) => avgWaves(c) // interpretable: mean waves survived

function median(xs: number[]): number {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

// ---------------------------------------------------------------------------
//  Run the sweeps.
// ---------------------------------------------------------------------------
const arenas = sampleArenas()
const relicNeutral = RELIC_STRATS[0]
const relicCombo = RELIC_STRATS.find((r) => r.id === 'combo')!

const cells: Cell[] = []
const relicAcquired: Record<string, number> = {}
for (const c of DRAFT_POOL) relicAcquired[c.id] = 0
let sims = 0

log(`Balance sweep — endless, cap ${WAVE_CAP} waves, ${START_LIVES} lives · ${RUNS_PER_CELL} runs/cell across ${arenas.length} arenas (${arenas.map((a) => a.id).join(', ')})`)

// Sweep A: every build vs neutral relics (isolates tower/branch power).
for (const build of BUILDS) {
  const cell = newCell(build, relicNeutral)
  for (const arena of arenas) {
    for (const seed of seeds(RUNS_PER_CELL, hash(build.id, arena.index))) {
      const o = playBattle(arena, seed, build, relicNeutral)
      record(cell, o)
      for (const id of o.relicsTaken) relicAcquired[id] = (relicAcquired[id] ?? 0) + 1
      sims++
    }
  }
  cells.push(cell)
}

// Sweep B: balanced build across every relic strategy (isolates relic power).
const balanced = BUILDS.find((b) => b.id === 'balanced')!
for (const strat of RELIC_STRATS) {
  if (strat.id === 'neutral') continue // balanced+neutral already covered in Sweep A
  const cell = newCell(balanced, strat)
  for (const arena of arenas) {
    for (const seed of seeds(RUNS_PER_CELL, hash('B' + strat.id, arena.index))) {
      const o = playBattle(arena, seed, balanced, strat)
      record(cell, o)
      for (const id of o.relicsTaken) relicAcquired[id] = (relicAcquired[id] ?? 0) + 1
      sims++
    }
  }
  cells.push(cell)
}

// Sweep C: the degeneracy probe, run in the HARSH EARLY regime where snowball
// speed decides the run. The suspect (Tempest+Blizzard, Chain-Reactor-greedy) is
// matched against a balanced control on the SAME seeds/arenas, so the delta is the
// combo's doing. (Combo hard-caps at 6×, so at deep-endless resources both plateau
// at the same DPS wall — the degeneracy only shows when investment is scarce.)
const suspect = BUILDS.find((b) => b.id === 'tempest_blizzard')!
const suspectCell = newCell(suspect, relicCombo)
const earlyControlCell = newCell(balanced, relicNeutral)
for (const arena of arenas) {
  for (const seed of seeds(RUNS_PER_CELL, hash('C' + arena.index, arena.index))) {
    const os = playBattle(arena, seed, suspect, relicCombo, REGIME_EARLY)
    record(suspectCell, os)
    for (const id of os.relicsTaken) relicAcquired[id] = (relicAcquired[id] ?? 0) + 1
    const oc = playBattle(arena, seed, balanced, relicNeutral, REGIME_EARLY)
    record(earlyControlCell, oc)
    sims += 2
  }
}
cells.push(suspectCell)

// ---------------------------------------------------------------------------
//  Analysis — flag dominant + dead content.
// ---------------------------------------------------------------------------
const towerCells = cells.filter((c) => c.tag === 'tower')
const towerScores = towerCells.map(powerScore)
const medScore = median(towerScores)
const maxScore = Math.max(...towerScores)
const minScore = Math.min(...towerScores)
const sortedTower = [...towerCells].sort((a, b) => powerScore(b) - powerScore(a))

// Dominant: survives ≥1.35× the tower median AND clears the cap most of the time.
const DOMINANCE_RATIO = 1.35
const dominant = sortedTower.filter((c) => medScore > 0 && powerScore(c) >= medScore * DOMINANCE_RATIO && capRate(c) >= 0.5)
// Dead: bottom of the ladder — ≤55% of median depth (and not itself a cap-clearer).
const dead = sortedTower.filter((c) => medScore > 0 && powerScore(c) <= medScore * 0.55 && capRate(c) < 0.5)

// Relic lift: each strategy's depth delta vs the balanced+neutral control.
const balancedNeutral = cells.find((c) => c.buildId === 'balanced' && c.stratId === 'neutral')!
const relicLift = cells
  .filter((c) => c.buildId === 'balanced')
  .map((c) => ({ cell: c, lift: avgWaves(c) - avgWaves(balancedNeutral) }))
  .sort((a, b) => b.lift - a.lift)

// Degeneracy probe: suspect combo vs a matched balanced control, BOTH in the harsh
// early regime (where the snowball decides the run). Two signals: (1) it survives
// deeper on scarce resources; (2) it saturates the 6× combo cap earlier and more
// reliably (the snowball itself). Either strong signal flags it.
const ctrl = earlyControlCell
const degenLift = avgWaves(suspectCell) - avgWaves(ctrl)
const degenRatio = avgWaves(ctrl) > 0 ? avgWaves(suspectCell) / avgWaves(ctrl) : 1
const snowballLead = avgCapWave(ctrl) - avgCapWave(suspectCell) // + ⇒ suspect saturates earlier
const finiteLead = Number.isFinite(snowballLead) ? snowballLead : 0
const DEGENERATE =
  (degenRatio >= 1.25 && degenLift >= 2) ||
  (capWaveRate(suspectCell) >= 0.5 && capWaveRate(suspectCell) - capWaveRate(ctrl) >= 0.25 && finiteLead >= 2)

// Relic usage across the whole sweep.
const relicUsage = DRAFT_POOL.map((c) => ({ id: c.id, title: c.title, rarity: c.rarity, taken: relicAcquired[c.id] ?? 0 }))
  .sort((a, b) => a.taken - b.taken)

// ---------------------------------------------------------------------------
//  Suggested tuning diff — CONSERVATIVE, human-reviewed. Never auto-applied.
// ---------------------------------------------------------------------------
interface Suggestion { target: string; file: string; change: string; from: string; to: string; rationale: string; kind: 'nerf' | 'buff' }
const suggestions: Suggestion[] = []
function pct(x: number): string { return `${(x * 100).toFixed(0)}%` }

if (DEGENERATE || degenRatio >= 1.25) {
  suggestions.push({
    target: 'Chain Reactor relic (comboRamp)', file: 'src/sim/drafts.ts', kind: 'nerf',
    change: 'combo card comboRamp multiplier', from: '1.6', to: '1.45',
    rationale: `On scarce early-game resources, Chain-Reactor-greedy Tempest+Blizzard survives ${avgWaves(suspectCell).toFixed(1)} waves vs ${avgWaves(ctrl).toFixed(1)} for the balanced control (${degenRatio.toFixed(2)}× deeper) and saturates the 6× combo cap ${finiteLead >= 0 ? finiteLead.toFixed(1) + ' waves earlier' : 'faster'} (${pct(capWaveRate(suspectCell))} of runs vs ${pct(capWaveRate(ctrl))}). comboRamp is the escalator; a small trim slows the snowball without gutting the relic.`,
  })
  suggestions.push({
    target: 'Blizzard branch (frost)', file: 'src/game/towers.ts', kind: 'nerf',
    change: 'blizzard branch range', from: '4.0', to: '3.5',
    rationale: 'Blizzard’s board-wide slow keeps the pack clustered so Tempest chains hit everything and the combo ramps. Narrowing the aura preserves its "wide chill" identity while cutting the free clustering that feeds the degenerate loop.',
  })
}
if (dead.length > 0) {
  for (const d of dead.slice(0, 2)) {
    const s = buffFor(d.buildId)
    if (s) suggestions.push(s)
  }
}

function buffFor(buildId: string): Suggestion | null {
  switch (buildId) {
    case 'arcane_prism':
      return { target: 'Prism branch (arcane)', file: 'src/game/towers.ts', kind: 'buff', change: 'prism branch damage', from: '52', to: '66', rationale: 'Prism sits at the bottom of the tower sweep: it neither buffs as widely as Amplify nor out-damages a real DPS branch. A modest damage bump makes the "buffs AND blasts" fantasy competitive.' }
    case 'arcane_amplify':
      return { target: 'Amplify branch (arcane)', file: 'src/game/towers.ts', kind: 'buff', change: 'amplify buffDamage', from: '0.55', to: '0.65', rationale: 'Amplify’s support payoff is too weak to justify a slot on the tested boards; a stronger damage aura rewards the network build.' }
    case 'frost_glacier':
      return { target: 'Glacier branch (frost)', file: 'src/game/towers.ts', kind: 'buff', change: 'glacier stunDuration', from: '0.5', to: '0.7', rationale: 'Glacier underperforms Blizzard on every board; a longer hard-stun gives its single-target lock a clearer niche.' }
    case 'cannon_mortar':
      return { target: 'Mortar branch (cannon)', file: 'src/game/towers.ts', kind: 'buff', change: 'mortar splash', from: '1.5', to: '1.8', rationale: 'Mortar trails the tower sweep; a wider blast improves its crowd-clear against the swarms it is meant to answer.' }
    case 'flame_scorch':
      return { target: 'Scorch branch (flame)', file: 'src/game/towers.ts', kind: 'buff', change: 'scorch zoneDps', from: '30', to: '40', rationale: 'Scorch’s area-denial DPS is too low to matter at the tested difficulty; a higher burning-ground tick makes the zone a real threat.' }
    case 'flame_phoenix':
      return { target: 'Phoenix branch (flame)', file: 'src/game/towers.ts', kind: 'buff', change: 'phoenix damage', from: '95', to: '110', rationale: 'Phoenix’s single-target hunt lags the pack-clear branches; a damage bump sharpens its boss-killer role.' }
    case 'storm_overload':
      return { target: 'Overload branch (storm)', file: 'src/game/towers.ts', kind: 'buff', change: 'overload damage', from: '210', to: '235', rationale: 'Overload’s one-big-bolt identity falls behind Tempest’s chain; a bigger hit keeps the single-target option relevant.' }
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
//  Emit the report.
// ---------------------------------------------------------------------------
function fmtCell(c: Cell): string {
  return `${avgWaves(c).toFixed(1)} waves · cap-clear ${pct(capRate(c))} · maxCombo ${avgCombo(c).toFixed(1)}`
}

const lines: string[] = []
lines.push('# Chromancer — Balance Report')
lines.push('')
lines.push(`_Generated by \`npm run balance\` — ${sims.toLocaleString('en-US')} seeded endless sims · ${RUNS_PER_CELL} runs/cell · ${arenas.length}-arena sample (${arenas.map((a) => a.id).join(', ')}) · cap ${WAVE_CAP} waves on ${START_LIVES} lives._`)
lines.push('')
lines.push('> The sim is pure and deterministic, so this report is reproducible bit-for-bit. It **never** changes balance values — it produces findings + a suggested-tuning diff for human review. Difficulty is the endless ramp; a build’s power is how many waves it survives on modest lives.')
lines.push('')

lines.push('## 1. Tower / branch power ranking')
lines.push('')
lines.push('| Rank | Build | Waves survived | Cap-clear | Avg max combo |')
lines.push('|---:|---|---:|---:|---:|')
sortedTower.forEach((c, i) => {
  lines.push(`| ${i + 1} | ${c.buildLabel} | ${avgWaves(c).toFixed(1)} | ${pct(capRate(c))} | ${avgCombo(c).toFixed(1)} |`)
})
lines.push('')
lines.push(`Tower median depth **${medScore.toFixed(1)}**, ceiling **${maxScore.toFixed(1)}**, floor **${minScore.toFixed(1)}** waves.`)
lines.push('')

lines.push('## 2. Dominant / degenerate strategies')
lines.push('')
if (dominant.length > 0) {
  for (const c of dominant) lines.push(`- ⚠️ **${c.buildLabel}** — ${fmtCell(c)} (≥${DOMINANCE_RATIO}× median depth, clears the cap).`)
} else {
  lines.push('- No single tower branch clears the dominance gate on its own.')
}
lines.push('')
lines.push(`_Harsh early regime — ${REGIME_EARLY.lives} lives, ${REGIME_EARLY.gold} gold, cap ${REGIME_EARLY.cap}, no heroes — where the snowball, not the DPS ceiling, decides the run._`)
lines.push('')
lines.push(`**Degeneracy probe — Tempest + Blizzard + Chain Reactor:** ${fmtCell(suspectCell)}, combo-cap in ${pct(capWaveRate(suspectCell))} of runs by wave ${Number.isFinite(avgCapWave(suspectCell)) ? avgCapWave(suspectCell).toFixed(1) : '—'}.`)
lines.push(`Versus the matched balanced control (${fmtCell(ctrl)}, combo-cap in ${pct(capWaveRate(ctrl))} of runs by wave ${Number.isFinite(avgCapWave(ctrl)) ? avgCapWave(ctrl).toFixed(1) : '—'}): **${degenRatio.toFixed(2)}× deeper**, ${degenLift >= 0 ? '+' : ''}${degenLift.toFixed(1)} waves, snowball ${finiteLead >= 0 ? finiteLead.toFixed(1) + ' waves earlier' : `${(-finiteLead).toFixed(1)} waves later`}.`)
lines.push(DEGENERATE
  ? '- 🚩 **DEGENERATE** — on scarce resources the combo snowballs past the control and saturates the combo cap early. See suggested tuning below.'
  : '- ✅ Within tolerance on this sample (still the strongest synergy — keep watching after any relic change).')
lines.push('')

lines.push('## 3. Relic strategy lift (balanced build)')
lines.push('')
lines.push('| Strategy | Waves survived | vs control |')
lines.push('|---|---:|---:|')
for (const r of relicLift) {
  lines.push(`| ${r.cell.stratLabel} | ${avgWaves(r.cell).toFixed(1)} | ${r.lift >= 0 ? '+' : ''}${r.lift.toFixed(1)} |`)
}
lines.push('')

lines.push('## 4. Dead / underused content')
lines.push('')
if (dead.length > 0) {
  for (const c of dead) lines.push(`- 💤 **${c.buildLabel}** — ${fmtCell(c)} (≤55% of median depth).`)
} else {
  lines.push('- No tower branch is dead on this sample.')
}
lines.push('')
lines.push('Relic acquisition (times taken across the whole sweep — low counts on the wheel are situational, not necessarily weak):')
lines.push('')
lines.push('| Relic | Rarity | Taken |')
lines.push('|---|---|---:|')
for (const r of relicUsage) lines.push(`| ${r.title} | ${r.rarity} | ${r.taken} |`)
lines.push('')

lines.push('## 5. Suggested tuning diff (for review — NOT auto-applied)')
lines.push('')
if (suggestions.length === 0) {
  lines.push('_No tuning suggested on this sample._')
} else {
  for (const s of suggestions) {
    const badge = s.kind === 'nerf' ? '🔻 NERF' : '🔺 BUFF'
    lines.push(`### ${badge} — ${s.target}`)
    lines.push(`- \`${s.file}\`: ${s.change} **${s.from} → ${s.to}**`)
    lines.push(`- ${s.rationale}`)
    lines.push('')
  }
}
lines.push('_Discipline: every suggestion keeps the "no immunities, rates are fair" rule — it tunes magnitudes, never adds hard counters._')
lines.push('')

const report = lines.join('\n')
writeFileSync('BALANCE_REPORT.md', report)
writeFileSync('balance-report.json', JSON.stringify({
  generatedBy: 'npm run balance',
  config: { runsPerCell: RUNS_PER_CELL, arenas: arenas.map((a) => a.id), waveCap: WAVE_CAP, startLives: START_LIVES, startGold: START_GOLD, totalSims: sims },
  towerRanking: sortedTower.map((c) => ({ build: c.buildId, label: c.buildLabel, avgWaves: avgWaves(c), capRate: capRate(c), avgCombo: avgCombo(c) })),
  dominant: dominant.map((c) => c.buildId),
  dead: dead.map((c) => c.buildId),
  degeneracyProbe: { build: suspect.id, regime: REGIME_EARLY, avgWaves: avgWaves(suspectCell), controlAvgWaves: avgWaves(ctrl), ratioVsControl: degenRatio, waveLiftVsControl: degenLift, comboCapRate: capWaveRate(suspectCell), controlComboCapRate: capWaveRate(ctrl), snowballLeadWaves: finiteLead, flaggedDegenerate: DEGENERATE },
  relicLift: relicLift.map((r) => ({ strat: r.cell.stratId, avgWaves: avgWaves(r.cell), lift: r.lift })),
  relicUsage,
  suggestions,
}, null, 2))

// ---------------------------------------------------------------------------
//  Console summary.
// ---------------------------------------------------------------------------
console.log('')
console.log(`BALANCE — ${sims.toLocaleString('en-US')} endless sims across ${arenas.length} arenas · ${RUNS_PER_CELL} runs/cell`)
console.log('Top 3 tower branches: ' + sortedTower.slice(0, 3).map((c) => `${c.buildLabel} (${avgWaves(c).toFixed(1)}w)`).join(', '))
console.log('Weakest 2 tower branches: ' + [...sortedTower].slice(-2).map((c) => `${c.buildLabel} (${avgWaves(c).toFixed(1)}w)`).join(', '))
console.log(`Degeneracy probe (Tempest+Blizzard+ChainReactor, early regime): ${avgWaves(suspectCell).toFixed(1)}w vs ${avgWaves(ctrl).toFixed(1)}w control (${degenRatio.toFixed(2)}×), snowball ${finiteLead.toFixed(1)}w earlier → ${DEGENERATE ? 'DEGENERATE 🚩' : 'within tolerance'}`)
console.log(`Suggestions: ${suggestions.length} (${suggestions.filter((s) => s.kind === 'nerf').length} nerf, ${suggestions.filter((s) => s.kind === 'buff').length} buff) → see BALANCE_REPORT.md + balance-report.json`)

function log(msg: string): void { console.log('· ' + msg) }

if (FAIL_ON_DEGENERATE && (DEGENERATE || dominant.length > 0)) {
  console.error('\nBALANCE GATE: degenerate/dominant strategy detected (--fail-on-degenerate).')
  process.exit(1)
}
process.exit(0)
