// CAMPAIGN DIFFICULTY PROBE — the missing yardstick the balance harness never had.
//
// The endless sweep in balance.ts ranks a build's *ceiling*; it can't answer the
// question the owner's playthrough exposed: "how far does a LAZY strategy get on
// the hand-authored campaign ladder?" This probe fills that gap. It auto-plays the
// LIVE campaign with several distinct strategies over a realistic hero-progression
// model (the SAME level at each campaign point for every strategy, so the delta is
// the tower/upgrade/reaction axis) and reports how deep each survives.
//
//   run:  npm run difficulty            (full sweep + the design-goal GATE below)
//         npm run difficulty -- --json  (machine-readable)
//   knobs: DIFF_MAX / DIFF_MIN (level window), DIFF_SEEDS, DIFF_STRATS (subset),
//          DIFF_HERO (pin hero level), DIFF_TRACE=1 (per-level trace),
//          DIFF_INSTRUMENT=1 (build-state / leak diagnosis).
//
// It ASSERTS the difficulty-overhaul design goals and EXITS NON-ZERO on failure
// (the campaign half of the balance gate; simcheck proves beatability, this proves
// the depth is REQUIRED):
//   (a) the literal lazy builds (mono spam, owner 1+1+1) get WALLED early.
//   (b) an upgraded + reaction build clears deep with a comfortable safety margin.
//   (c) MULTIPLE distinct strategies stay viable (no single dominant key).
//   (d) DEPTH IS REQUIRED — no un-upgraded build clears comfortably (spam scrapes by
//       at ~1 life where reactions cruise at ~14).
// Deterministic + seeded, like every other sim tool.

import { Sim } from '../src/sim/index'
import { LEVELS } from '../src/game/levels'
import type { LevelDef } from '../src/game/levels'
import { NEUTRAL } from '../src/game/workshop'
import { TOWER_ORDER, STARTER_TOWERS, type TowerKind } from '../src/game/towers'
import type { TargetMode } from '../src/sim/combat'

// Hero level MODELS REAL PROGRESSION: a player's starter trio climbs as they play,
// so the probe scales hero level with campaign depth (from what a fresh-save player
// plausibly has at each stop), rather than freezing it — otherwise early rows are
// hero-heavy and late rows are pessimistically under-heroed. The SAME level is used
// for every strategy at a given campaign point, so the delta stays a TOWER delta.
// DIFF_HERO pins a fixed level for sensitivity checks (e.g. =16 for the ceiling proxy).
const FIXED_HERO = process.env.DIFF_HERO !== undefined ? clampInt(process.env.DIFF_HERO, 6, 1, 30) : null
function heroLevelFor(index: number): number {
  if (FIXED_HERO !== null) return FIXED_HERO
  // Caps at 16 — the level simcheck's beatability authority uses — so the probe never
  // hands a build STRONGER heroes than the "beatable by good play" standard (which
  // would let a lazy build's late-game hero carry masquerade as a tower success).
  return Math.max(3, Math.min(16, Math.round(3 + index * 0.075))) // L1→3 · L32→5 · L96→10 · L192→16
}
function partyFor(index: number): Array<{ heroId: string; level: number }> {
  const lvl = heroLevelFor(index)
  return [{ heroId: 'ember', level: lvl }, { heroId: 'glacia', level: lvl }, { heroId: 'sylvan', level: lvl }]
}
// Speed / focus knobs for fast iteration (default = full sweep).
const DIFF_MAX = clampInt(process.env.DIFF_MAX, LEVELS.length, 1, LEVELS.length)
const DIFF_MIN = clampInt(process.env.DIFF_MIN, 0, 0, LEVELS.length)
const DIFF_SEEDS = clampInt(process.env.DIFF_SEEDS, 1, 1, 9)
const ONLY = (process.env.DIFF_STRATS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
const TRACE = process.env.DIFF_TRACE === '1'

function clampInt(raw: string | undefined, dflt: number, lo: number, hi: number): number {
  const v = raw === undefined ? dflt : Number.parseInt(raw, 10)
  return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : dflt
}

interface Strat {
  id: string
  label: string
  kinds: TowerKind[] // towers it will place (intersected with what's OWNED)
  upgrade: boolean // upgrade toward level 3 + branch?
  branch: Partial<Record<TowerKind, 0 | 1>>
  primed?: boolean // set some towers to Primed (reaction-hunting) targeting
  fuse?: boolean // forge fusion towers from eligible adjacent max pairs
  targeting?: TargetMode // override default targeting on placed towers
  maxTowers?: number // hard cap on placed towers (models a literal small build)
  noBranch?: boolean // upgrade linearly only (never branch) — mirrors simcheck's bot
}

const STRATS: Strat[] = [
  // --- the owner's LITERAL build: exactly 1 cannon + 1 frost + 1 flame, NO upgrades.
  // This is the exact "played 15 levels, no problems" build we must make fail early. ---
  { id: 'owner3', label: 'Owner: 1 cannon+1 frost+1 flame (no upg)', kinds: ['cannon', 'frost', 'flame'], upgrade: false, branch: {}, maxTowers: 3 },
  // --- trio spam, no upgrades — the same three types but flooding every cell. ---
  { id: 'trio_flat', label: 'Trio spam, no upgrades', kinds: ['cannon', 'frost', 'flame'], upgrade: false, branch: {} },
  // --- mono spam, no upgrades — the laziest possible play. ---
  { id: 'mono_flat', label: 'Mono cannon, no upgrades', kinds: ['cannon'], upgrade: false, branch: {} },
  // --- heroes ONLY (zero towers) — isolates the hero carry-floor. ---
  { id: 'heroesonly', label: 'Heroes only (no towers)', kinds: ['cannon'], upgrade: false, branch: {}, maxTowers: 0 },
  // --- the intended path: a FOCUSED, fully-upgraded+branched, reaction-hunting core
  // (quality over spam — capped tower count so gold concentrates into tiers/branches). ---
  { id: 'varied_up', label: 'Varied + upgraded + reactions', kinds: ['cannon', 'frost', 'flame', 'storm', 'arcane'], upgrade: true, branch: { cannon: 0, frost: 0, flame: 1, storm: 0, arcane: 0 }, primed: true, fuse: true, maxTowers: 6 },
  // --- distinct viable strategy A: physical/armor-pen core (Sniper + Mortar) + frost CC. ---
  { id: 'physcc', label: 'Cannon(Sniper/Mortar) + Frost CC', kinds: ['cannon', 'frost'], upgrade: true, branch: { cannon: 0, frost: 1 }, targeting: 'Strong', maxTowers: 6 },
  // --- distinct viable strategy B: storm/arcane anti-air + flame burn (elemental/reaction). ---
  { id: 'elem', label: 'Storm + Flame + Arcane (elemental)', kinds: ['storm', 'flame', 'arcane'], upgrade: true, branch: { storm: 0, flame: 0, arcane: 1 }, primed: true, maxTowers: 6 },
  // --- distinct viable strategy C: frost/storm shatter combo (the crown-jewel reaction). ---
  { id: 'shatter', label: 'Frost + Storm (Shatter combo)', kinds: ['frost', 'storm'], upgrade: true, branch: { frost: 0, storm: 0 }, primed: true, fuse: true, maxTowers: 6 },
  // --- spam + upgrade: many towers, upgraded as gold allows (should be OUT-performed
  // by the focused core — proves "cheap spam" is not the efficient path). ---
  { id: 'spam_up', label: 'Spam + upgrade (no cap)', kinds: ['cannon', 'frost', 'flame', 'storm'], upgrade: true, branch: { cannon: 0, frost: 0, flame: 1, storm: 0 } },
  // --- CEILING proxy: mirrors simcheck's beatability bot (spread every owned tower,
  // upgrade linearly to L3, NO branches/fusions). Run with DIFF_HERO=16. If this
  // clears all 192 with margin, the real simcheck gate should pass — the authority. ---
  { id: 'ceiling', label: 'Ceiling proxy (@16, L3 spread, no branch)', kinds: ['cannon', 'frost', 'flame', 'storm', 'arcane'], upgrade: true, noBranch: true, branch: {} },
]

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

function botSpend(sim: Sim, strat: Strat, owned: Set<string>, cursor: { i: number }, primedCount: { n: number }): void {
  const kinds = strat.kinds.filter((k) => owned.has(k))
  if (kinds.length === 0) return
  if (strat.upgrade) {
    for (const t of sim.towers) {
      if (!t.active) continue
      const uc = sim.upgradeCostFor(t)
      if (uc !== null) { if (sim.gold >= uc) sim.upgradeTower(t.id); continue }
      if (t.level === 2 && !strat.noBranch) {
        const idx = strat.branch[t.kind] ?? 0
        const bc = sim.branchCostFor(t, idx)
        if (bc !== null && sim.gold >= bc) sim.chooseBranch(t.id, idx)
      }
    }
    if (strat.fuse) {
      for (const t of sim.towers) {
        if (!t.active || t.fusedElem !== '') continue
        const opts = sim.fusionOptions(t)
        if (opts.length && sim.gold >= opts[0].cost) { sim.fuseTowers(t.id, opts[0].partner.id); break }
      }
    }
  }
  for (const c of sim.buildCells()) {
    if (!sim.canPlace(c.col, c.row)) continue
    if (strat.maxTowers !== undefined && sim.towers.filter((t) => t.active).length >= strat.maxTowers) break
    const kind = kinds[cursor.i % kinds.length]
    if (sim.gold >= sim.placeCost(kind) && sim.placeTower(kind, c.col, c.row)) {
      const placed = sim.towerAt(c.col, c.row)
      if (placed) {
        if (strat.targeting) sim.setTargeting(placed.id, strat.targeting)
        // spread a few reaction-hunting Primed towers so combos actually fire
        else if (strat.primed && primedCount.n % 3 === 1) sim.setTargeting(placed.id, 'Primed')
      }
      primedCount.n++
      cursor.i++
    } else if (sim.gold < 40) break
  }
}

interface LevelResult {
  won: boolean; lives: number; wave: number; waves: number
  reactions: number; fusions: number
  tiers: [number, number, number, number] // towers at level 0,1,2,3(branched)
  leaks: Record<string, number> // leaked Wellspring-damage by enemy kind
  leakCount: number
}

function playLevel(level: LevelDef, strat: Strat, owned: Set<string>, seedSalt: number): LevelResult {
  const seed = (0xB0A5E ^ (level.index * 40503) ^ (0x77 + seedSalt * 2654435761)) >>> 0
  const sim = new Sim({
    level, mods: { ...NEUTRAL }, seed, endless: false,
    startGold: level.startGold, startLives: level.startLives, party: partyFor(level.index),
  })
  deployParty(sim)
  const cursor = { i: 0 }
  const primed = { n: 0 }
  const leaks: Record<string, number> = {}
  let leakCount = 0
  let tick = 0
  const budget = 60 * 60 * 20 // ~20 min sim time (matches simcheck's autoPlay budget)
  while (tick < budget) {
    if (sim.state === 'won' || sim.state === 'lost') break
    if (sim.state === 'draft') { sim.chooseDraft(0); continue }
    if (sim.state === 'prep') { botSpend(sim, strat, owned, cursor, primed); sim.startWave() }
    if (sim.state === 'active') {
      if (tick % 150 === 0) botSpend(sim, strat, owned, cursor, primed)
      if (tick % 150 === 0) castSpells(sim)
    }
    sim.step(); tick++
    for (const ev of sim.drainEvents()) {
      if (ev.t === 'leak') { leaks[ev.kind] = (leaks[ev.kind] ?? 0) + ev.dmg; leakCount++ }
    }
  }
  const tiers: [number, number, number, number] = [0, 0, 0, 0]
  for (const t of sim.towers) { if (t.active) tiers[Math.min(3, t.level)]++ }
  return {
    won: sim.state === 'won', lives: sim.lives, wave: sim.waveIndex, waves: level.waves.length,
    reactions: sim.runStats.reactions, fusions: sim.runStats.fusions, tiers, leaks, leakCount,
  }
}

interface StratOutcome { id: string; label: string; firstLoss: number; clearedThrough: number; won: number; total: number; tightestLives: number; tightestId: string; bucketWin: number[] }

// Win-rate buckets (per 8 levels) — a robust curve that variance spikes can't flip
// the way a single "first contiguous loss" can. bucketWin[b] = win fraction in
// levels [b*8, b*8+8).
const BUCKET = 8

function runStrat(strat: Strat): StratOutcome {
  const owned = new Set<string>(STARTER_TOWERS as string[])
  let firstLoss = -1
  let clearedThrough = -1
  let won = 0
  let plays = 0
  let contiguous = true
  let tightestLives = 1e9
  let tightestId = ''
  const bucketW: number[] = []
  const bucketN: number[] = []
  const trace: string[] = []
  for (const lvl of LEVELS) {
    if (lvl.index < DIFF_MIN) { if (lvl.unlockTower) owned.add(lvl.unlockTower); continue }
    if (lvl.index >= DIFF_MAX) break
    const allowed = new Set(owned) // snapshot: what the player owns ENTERING this level
    let levelWon = 0
    let minLives = 1e9
    for (let s = 0; s < DIFF_SEEDS; s++) {
      const r = playLevel(lvl, strat, allowed, s)
      plays++
      if (r.won) { won++; levelWon++; if (r.lives < minLives) minLives = r.lives } else minLives = 0
    }
    const b = Math.floor(lvl.index / BUCKET)
    bucketW[b] = (bucketW[b] ?? 0) + levelWon
    bucketN[b] = (bucketN[b] ?? 0) + DIFF_SEEDS
    const allWon = levelWon === DIFF_SEEDS
    if (allWon) {
      if (contiguous) clearedThrough = lvl.index
      if (minLives < tightestLives) { tightestLives = minLives; tightestId = lvl.id }
    } else {
      if (firstLoss < 0) firstLoss = lvl.index
      contiguous = false
    }
    if (TRACE) trace.push(`L${(lvl.index + 1).toString().padStart(3)} ${lvl.id.padEnd(10)} ${allWon ? 'WIN ' : levelWon > 0 ? 'PART' : 'LOSS'} lives ${minLives === 1e9 ? '?' : minLives}/${lvl.startLives}`)
    if (lvl.unlockTower) owned.add(lvl.unlockTower)
  }
  if (TRACE) { console.log(`\n--- ${strat.label} ---`); for (const t of trace) console.log('  ' + t) }
  const bucketWin = bucketW.map((wv, i) => +(wv / Math.max(1, bucketN[i])).toFixed(2))
  return { id: strat.id, label: strat.label, firstLoss, clearedThrough, won, total: plays, tightestLives, tightestId, bucketWin }
}

const chosen = ONLY.length ? STRATS.filter((s) => ONLY.includes(s.id)) : STRATS

// INSTRUMENT MODE — diagnose WHY builds diverge (or don't): per strategy, over the
// first DIFF_MAX levels, report the build state actually reached (tower tiers,
// fusions), reactions fired, win rate, and what LEAKS (by enemy kind). Answers
// "does the engaged build ever become engaged in this economy, and what kills the
// lazy one?" — the question raw win-rate can't.
if (process.env.DIFF_INSTRUMENT === '1') {
  console.log(`\nINSTRUMENT — first ${DIFF_MAX} levels · heroes @${heroLevelFor(0)}→@${heroLevelFor(LEVELS.length - 1)} · ${DIFF_SEEDS} seed(s)\n`)
  for (const strat of chosen) {
    const owned = new Set<string>(STARTER_TOWERS as string[])
    let plays = 0, wins = 0
    const tiers = [0, 0, 0, 0]
    let fusions = 0, reactions = 0, leakDmg = 0
    const leaks: Record<string, number> = {}
    for (const lvl of LEVELS) {
      if (lvl.index < DIFF_MIN) { if (lvl.unlockTower) owned.add(lvl.unlockTower); continue }
    if (lvl.index >= DIFF_MAX) break
      const allowed = new Set(owned)
      for (let s = 0; s < DIFF_SEEDS; s++) {
        const r = playLevel(lvl, strat, allowed, s)
        plays++; if (r.won) wins++
        for (let i = 0; i < 4; i++) tiers[i] += r.tiers[i]
        fusions += r.fusions; reactions += r.reactions; leakDmg += Object.values(r.leaks).reduce((a, b) => a + b, 0)
        for (const [k, v] of Object.entries(r.leaks)) leaks[k] = (leaks[k] ?? 0) + v
      }
      if (lvl.unlockTower) owned.add(lvl.unlockTower)
    }
    const leakStr = Object.entries(leaks).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' ') || 'none'
    console.log(`${strat.label}`)
    console.log(`  win ${wins}/${plays} · towers[L0/L1/L2/branch] ${tiers.map((t) => (t / plays).toFixed(1)).join('/')} · fusions ${(fusions / plays).toFixed(2)} · reactions/lvl ${(reactions / plays).toFixed(0)} · leakDmg/lvl ${(leakDmg / plays).toFixed(1)}`)
    console.log(`  leaks by kind: ${leakStr}`)
  }
  process.exit(0)
}

const results = chosen.map(runStrat)
const asJson = process.argv.includes('--json')

if (asJson) {
  console.log(JSON.stringify({ generatedBy: 'npm run difficulty', heroLevelStart: heroLevelFor(0), heroLevelEnd: heroLevelFor(LEVELS.length - 1), results }, null, 2))
} else {
  console.log(`\nCAMPAIGN DIFFICULTY PROBE — ${Math.min(DIFF_MAX, LEVELS.length)} levels · heroes @${heroLevelFor(0)}→@${heroLevelFor(LEVELS.length - 1)} · ${DIFF_SEEDS} seed(s)/level\n`)
  console.log('| Strategy | First loss | Cleared thru | Win rate | Tightest | Win-rate by 8-level bucket (L1-8, L9-16, …) |')
  console.log('|---|---:|---:|---:|---|---|')
  for (const r of results) {
    const fl = r.firstLoss < 0 ? '—' : `L${r.firstLoss + 1}`
    const tight = r.tightestId ? `${r.tightestLives}@${r.tightestId}` : '—'
    console.log(`| ${r.label} | ${fl} | L${r.clearedThrough + 1} | ${((r.won / r.total) * 100).toFixed(0)}% | ${tight} | ${r.bucketWin.map((x) => x.toFixed(2)).join(' ')} |`)
  }
  console.log('')

  // ---- DESIGN-GOAL ASSERTIONS (the campaign half of the balance gate) --------
  // A player progresses CONTIGUOUSLY — they can't skip the level that walls them —
  // so `clearedThrough` (how deep a strategy gets before its FIRST loss) is the
  // faithful "how far does this build carry you" metric, not overall win-rate
  // (which a late hero-scaling recovery can inflate). Only meaningful on a full run.
  if (!ONLY.length && DIFF_MAX >= LEVELS.length && DIFF_MIN === 0) {
    const by = (id: string) => results.find((r) => r.id === id)
    const upgraded = ['varied_up', 'shatter', 'elem', 'physcc', 'spam_up'].map(by).filter(Boolean) as StratOutcome[]
    const winRate = (r: StratOutcome) => r.won / r.total
    // Deep-realm reach: mean win-rate across realms 4-6 (buckets 12+, levels 96+).
    // Proves a build can PROGRESS to the endgame, not just clear the opener — a
    // spike a competent player passes with a retry still counts (win-rate metric),
    // but a build that collapses in the deep realms does not.
    const deepReach = (r: StratOutcome) => { const b = r.bucketWin.slice(12); return b.length ? b.reduce((a, x) => a + x, 0) / b.length : 0 }
    const isViable = (r: StratOutcome) => winRate(r) >= 0.9 && deepReach(r) >= 0.7
    const bestQuality = upgraded.reduce((m, r) => (r.clearedThrough > m.clearedThrough ? r : m), upgraded[0])
    const bestMargin = upgraded.reduce((m, r) => Math.max(m, r.clearedThrough >= LEVELS.length - 1 ? r.tightestLives : 0), 0)
    const viableUpgraded = upgraded.filter(isViable)
    const mono = by('mono_flat'); const owner = by('owner3'); const trio = by('trio_flat')
    // The two LITERAL "played 15 levels, no problems" builds — mono spam and the
    // owner's 1-cannon/1-frost/1-flame. These must be UNRELIABLE: they wall in the
    // early campaign AND keep losing through the deep realms (low win-rate + reach),
    // so a player is forced to engage depth. (Nothing hard-walls forever — simcheck
    // proves every level beatable — so "walled" means "cannot reliably progress".)
    const literalLazy = [mono, owner].filter(Boolean) as StratOutcome[]
    // Depth-required test, margin-based (seed-robust — verified at 3 seeds): NO
    // un-upgraded build may be BOTH reliable (wins ≥95%) AND safe (margin > knife).
    // Active 3-type spam CAN grind the campaign, but only on a thin ~2-life margin
    // where the reaction build cruises at ~14 — so depth buys the safety, as intended.
    const allLazy = [mono, owner, trio].filter(Boolean) as StratOutcome[]
    const KNIFE = 3 // lives — a clear at ≤ this is a knife's-edge run any variance kills
    const lazyReliableAndSafe = allLazy.filter((r) => winRate(r) >= 0.95 && r.clearedThrough >= LEVELS.length - 1 && r.tightestLives > KNIFE)

    const checks: Array<{ name: string; pass: boolean; detail: string }> = [
      { name: '(a) the literal lazy builds (mono spam, owner 1+1+1) are UNRELIABLE — wall early AND keep losing deep',
        pass: literalLazy.every((r) => r.clearedThrough < 64 && winRate(r) < 0.9 && deepReach(r) < 0.85),
        detail: literalLazy.map((r) => `${r.id}→wall@L${r.clearedThrough + 2}, ${(winRate(r) * 100).toFixed(0)}% win, ${(deepReach(r) * 100).toFixed(0)}% deep`).join(' · ') },
      { name: '(b) an upgraded + reaction build clears deep (contiguous, all realms) with a comfortable margin',
        pass: bestQuality.clearedThrough >= LEVELS.length - 1 && bestMargin >= 8,
        detail: `${bestQuality.id}→L${bestQuality.clearedThrough + 1}, best safety margin ${bestMargin} lives` },
      { name: '(c) MULTIPLE distinct strategies stay viable (≥3 upgraded builds win ≥90% AND reach the deep realms)',
        pass: viableUpgraded.length >= 3,
        detail: `${viableUpgraded.length} viable: ${viableUpgraded.map((r) => `${r.id}(${(winRate(r) * 100).toFixed(0)}%,deep ${(deepReach(r) * 100).toFixed(0)}%)`).join(', ')}` },
      { name: '(d) DEPTH REQUIRED for reliable+safe play — no un-upgraded build is BOTH ≥95%-reliable AND above the knife-edge margin',
        pass: lazyReliableAndSafe.length === 0 && bestMargin >= KNIFE + 5,
        detail: `un-upgraded: ${allLazy.map((r) => `${r.id}[${(winRate(r) * 100).toFixed(0)}%, ${r.clearedThrough >= LEVELS.length - 1 ? 'margin ' + r.tightestLives : 'wall@L' + (r.clearedThrough + 2)}]`).join(', ')}; best quality margin ${bestMargin}` },
    ]
    console.log('DESIGN-GOAL ASSERTIONS:')
    let allPass = true
    for (const c of checks) { console.log(`  ${c.pass ? '✓' : '✗'} ${c.name}\n      ${c.detail}`); if (!c.pass) allPass = false }
    console.log(`\n${allPass ? '✅ CAMPAIGN BALANCE GATE PASSED' : '❌ CAMPAIGN BALANCE GATE FAILED'}`)
    if (!allPass) process.exit(1)
  } else {
    const trio = results.find((r) => r.id === 'trio_flat')
    const varied = results.find((r) => r.id === 'varied_up')
    const viable = results.filter((r) => r.id !== 'trio_flat' && r.id !== 'mono_flat' && r.id !== 'owner3')
    if (trio) console.log(`Owner build (trio, no upgrades): first loss L${trio.firstLoss < 0 ? '∞' : trio.firstLoss + 1}, overall ${((trio.won / trio.total) * 100).toFixed(0)}%`)
    if (varied) console.log(`Varied+upgraded+reactions: cleared thru L${varied.clearedThrough + 1}, overall ${((varied.won / varied.total) * 100).toFixed(0)}%`)
    console.log(`Distinct viable strategies (≥80% overall): ${viable.filter((v) => v.won / v.total >= 0.8).length}/${viable.length}`)
  }
}
