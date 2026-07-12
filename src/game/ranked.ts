// ============================================================================
//  RANKED — the provably-fair core. "The tower defense that literally cannot
//  cheat." Every ranked run is a SEED you can share and a deterministic INPUT
//  LOG we RE-RUN on the server to confirm the claimed score before it touches
//  the board. Nothing you buy changes ranked strength; the whole mode is a pure
//  function of (seed, party, inputs).
//
//  THIS MODULE IS PURE. It imports ONLY the headless sim + headless game data
//  (no DOM, no renderer, no economy/localStorage singleton), so the SAME code
//  runs in the browser (record), in `npm run simcheck` (gate), and in the
//  server verify function (re-run). If a client and the server ever built the
//  ranked config differently the moat would silently break — so both sides call
//  rankedConfig() here, and nothing else.
// ============================================================================

import { Sim, FIXED_DT, type SimConfig, type TargetMode } from '../sim'
import { NEUTRAL } from './workshop'
import { LEVELS, type LevelDef } from './levels'
import { RANKED_WYRM_LEVEL } from './wyrms'
import { canonicalSeed, dailySeed, utcDayIndex } from './seedcode'
import { pathforgeLayout, pathforgeLevel, validateMaze, pfKey, type PFCell } from './pathforge'
import type { TowerKind } from './towers'
import type { SpellKey } from './spells'

// ---------------------------------------------------------------------------
//  Version gate — BUMP whenever any sim math changes OR the record shape
//  changes. A submitted log carries the version it was recorded under; the
//  server rejects logs whose version no longer reproduces (an old log can't be
//  re-run by new sim code, or may be missing a field the new replay needs).
//  This keeps the board honest across balance patches instead of silently
//  mis-verifying.
// ---------------------------------------------------------------------------
// v2: the Prism Wellspring — leak damage is now strength-scaled per archetype
// (was flat 1 / boss 5), so run outcomes shift; bump to invalidate old replays.
// v3: difficulty overhaul (balance pass 19) — the endless ramp now ACCELERATES
// (quadratic HP + tougher bosses) and the campaign curve was retuned, so endless
// run outcomes shift; bump to invalidate old replays under the old ramp.
// v4: (baseline before PathForge joined ranked)
// v5: PathForge joins the ranked spine — RankedRunRecord gained the optional
// `route` field the server needs to rebuild a player-built maze's LevelDef.
// Old records never carry a route, so bump to force a clean re-record instead
// of silently replaying a pathforge-shaped record under the old field set.
export const SIM_VERSION = 5

// RANKED CONSTANTS — the store constitution, in code. Single source of truth
// (economy.ts + BattleScene import these so no purchase/grind path can drift
// ranked strength). Endless/daily/weekly/pathforge all share this normalized
// envelope.
export const RANKED_HERO_LEVEL = 5
export const ENDLESS_START_GOLD = 300
export const ENDLESS_START_LIVES = 20

// 'pathforge' = the player-built-maze board (Chromancer#56): same normalized
// envelope + replay-verify path as every other mode, just a different LevelDef
// (baked from the player's committed, server-revalidated route instead of the
// fixed endless arena).
export type RankedMode = 'daily' | 'weekly' | 'endless' | 'pathforge'

/** A ranked loadout entry as DECLARED by the client. Only the CHOICE of hero +
 *  bonded wyrm is player-supplied; the server re-normalizes every level, so a
 *  tampered "level 99" loadout can never reach the sim. */
export interface DeclaredHero {
  heroId: string
  wyrmId?: string
}

// ---------------------------------------------------------------------------
//  Canonical ranked config — the ONE place a ranked Sim is described. Reproduced
//  byte-for-byte by client and server from (mode, seed, declared party) alone.
// ---------------------------------------------------------------------------

/** The fixed endless/ranked arena. Palette is cosmetic (view only); the sim
 *  reads lanes + gold + lives, all constants here. */
export function rankedLevelDef(): LevelDef {
  return {
    id: 'endless', index: 99, name: 'Endless — Ranked', blurb: 'Purchases do not affect this mode',
    lanes: [1, 3, 5, 7, 9], startGold: ENDLESS_START_GOLD, startLives: ENDLESS_START_LIVES,
    baseCoins: 0, palette: LEVELS[3].palette, waves: [],
  }
}

/** Re-normalize a declared party into a sim loadout: dedupe, cap at 3, and FORCE
 *  the ranked hero/wyrm levels. Invalid ids are left for the Sim to self-defend
 *  against (its constructor drops unknown heroes/wyrms), so this stays pure. */
export function normalizeRankedParty(party: readonly DeclaredHero[] | undefined): NonNullable<SimConfig['party']> {
  const out: NonNullable<SimConfig['party']> = []
  const seen = new Set<string>()
  for (const p of party ?? []) {
    if (out.length >= 3) break
    if (!p || !p.heroId || seen.has(p.heroId)) continue
    seen.add(p.heroId)
    out.push({
      heroId: p.heroId,
      level: RANKED_HERO_LEVEL,
      wyrm: p.wyrmId ? { wyrmId: p.wyrmId, level: RANKED_WYRM_LEVEL } : undefined,
    })
  }
  return out
}

/** Build the canonical ranked SimConfig. `seed` is the FINAL seed the sim runs
 *  (already in the shareable code space); no re-folding here so client + server
 *  agree exactly. Every mode but 'pathforge' shares one fixed arena; pathforge
 *  bakes the COMMITTED route (already server-revalidated by the caller — see
 *  verifyRun) into its own LevelDef via pathforgeLevel(), same as every other
 *  ranked arena is a pure function of (mode, seed, party). `route` is REQUIRED
 *  for mode === 'pathforge' and ignored otherwise. */
export function rankedConfig(
  mode: RankedMode,
  seed: number,
  party: readonly DeclaredHero[] | undefined,
  route?: readonly PFCell[],
): SimConfig {
  const level = mode === 'pathforge' && route && route.length >= 2
    ? pathforgeLevel(route as PFCell[])
    : rankedLevelDef()
  return {
    level,
    mods: { ...NEUTRAL }, // ranked is provably fair: no meta modifiers, ever
    seed: seed >>> 0,
    endless: true, // ranked reuses the endless wave curve; rogue layer stays OFF
    startGold: ENDLESS_START_GOLD,
    startLives: ENDLESS_START_LIVES,
    party: normalizeRankedParty(party),
  }
}

// ---------------------------------------------------------------------------
//  Seeds — daily reuses landing dailySeed(); weekly + endless below. All land
//  in the shareable WORD-WORD-NN code space so any board seed is copy-a-link.
// ---------------------------------------------------------------------------

/** UTC week index (7-day buckets from the epoch). */
export function weekIndexFor(nowMs: number = Date.now()): number {
  return Math.floor(utcDayIndex(nowMs) / 7)
}

/** Weekly ranked seed — a distinct hash from the daily so the two boards never
 *  share a run. Deterministic + shared by every device for the same week. */
export function weeklyRankedSeed(week: number): number {
  return canonicalSeed((Math.imul(week, 40503) ^ 0x51ed270b) >>> 0)
}

/** The board-partition period for a run: UTC day (daily; pathforge reuses the
 *  same UTC-day bucket — everyone forges the SAME maze puzzle that day), UTC
 *  week (weekly), or 0 (endless — an all-time high-score board across per-run
 *  seeds). */
export function rankedPeriod(mode: RankedMode, nowMs: number = Date.now()): number {
  if (mode === 'daily' || mode === 'pathforge') return utcDayIndex(nowMs)
  if (mode === 'weekly') return weekIndexFor(nowMs)
  return 0
}

// ---------------------------------------------------------------------------
//  Input log — the compact, replayable record of a run. Two streams:
//   • c: clock-keyed MUTATING commands, stamped with the sim TICK they landed
//        on (tick = round(clock / FIXED_DT); the sim steps at a fixed 1/60s, so
//        a command that succeeded live at tick T succeeds again at T on replay).
//   • d: draft picks, in order — keyed to draft STATE (the clock freezes during
//        a draft, so these can't be tick-stamped) exactly as the live game does.
//  Encoded as tuple arrays (opcode-first) — small, JSON-safe, float64 exact.
// ---------------------------------------------------------------------------

// opcodes
const OP_PLACE = 0
const OP_UPGRADE = 1
const OP_BRANCH = 2
const OP_FUSE = 3
const OP_DEPLOY = 4
const OP_HEROSPELL = 5
const OP_SPELL = 6
const OP_TARGET = 7
const OP_STARTWAVE = 8
const OP_HEROMOVE = 9 // relocate a fielded hero to a new tile
const OP_HEROTARGET = 10 // set a hero's auto-attack priority
const OP_HEROFOCUS = 11 // sticky-lock a hero onto one enemy (0 = clear)

// TargetMode <-> compact index (stable order; append-only if ever extended)
const TARGET_MODES_ORDER: TargetMode[] = ['First', 'Last', 'Close', 'Strong', 'Weak', 'Primed']

/** One encoded command tuple (opcode-first). Mixed number/string is intentional
 *  — ids/coords are numbers, hero/tower/spell keys stay strings so the log never
 *  depends on a lookup table's ordering that a balance patch might reshuffle. */
export type Cmd = (number | string)[]

export interface RankedLog {
  c: Cmd[] // mutating commands, ascending tick
  d: number[] // draft pick indices, in order
}

/** The full submittable run record — everything the server needs to re-run and
 *  confirm, and nothing it must trust: score/wave are CLAIMS, verified by replay.
 *  `route` is the PathForge run's committed spawn→base road (absent/ignored for
 *  every other mode) — a CLAIM too: verifyRun re-validates it with the same
 *  validateMaze() the client's editor enforces before trusting it. */
export interface RankedRunRecord {
  v: number // SIM_VERSION the log was recorded under
  mode: RankedMode
  seed: number // the exact seed the sim ran
  period: number // board partition (day / week / 0)
  party: DeclaredHero[] // declared loadout (levels re-normalized server-side)
  score: number // CLAIMED score
  wave: number // CLAIMED wave reached (waveIndex + 1)
  log: RankedLog
  route?: PFCell[] // PathForge only: the committed maze route
}

/** Records a live ranked run into a replayable log. Call one method per
 *  SUCCESSFUL, state-mutating sim command, passing the sim clock at the moment
 *  it landed — the recorder stamps the tick. Recording only successes keeps
 *  replay a single pass with no retry windows (which would desync the tick). */
export class RunRecorder {
  private c: Cmd[] = []
  private d: number[] = []

  private tick(clock: number): number {
    return Math.max(0, Math.round(clock / FIXED_DT))
  }

  place(clock: number, kind: TowerKind, col: number, row: number): void {
    this.c.push([OP_PLACE, this.tick(clock), kind, col, row])
  }
  upgrade(clock: number, id: number): void {
    this.c.push([OP_UPGRADE, this.tick(clock), id])
  }
  branch(clock: number, id: number, idx: number): void {
    this.c.push([OP_BRANCH, this.tick(clock), id, idx])
  }
  fuse(clock: number, hostId: number, partnerId: number): void {
    this.c.push([OP_FUSE, this.tick(clock), hostId, partnerId])
  }
  deploy(clock: number, heroId: string, col: number, row: number): void {
    this.c.push([OP_DEPLOY, this.tick(clock), heroId, col, row])
  }
  heroSpell(clock: number, slotId: number, x: number, y: number): void {
    this.c.push([OP_HEROSPELL, this.tick(clock), slotId, x, y])
  }
  spell(clock: number, key: SpellKey, x: number, y: number): void {
    this.c.push([OP_SPELL, this.tick(clock), key, x, y])
  }
  target(clock: number, id: number, mode: TargetMode): void {
    const mi = TARGET_MODES_ORDER.indexOf(mode)
    this.c.push([OP_TARGET, this.tick(clock), id, mi < 0 ? 0 : mi])
  }
  heroMove(clock: number, slotId: number, col: number, row: number): void {
    this.c.push([OP_HEROMOVE, this.tick(clock), slotId, col, row])
  }
  heroTarget(clock: number, slotId: number, mode: TargetMode): void {
    const mi = TARGET_MODES_ORDER.indexOf(mode)
    this.c.push([OP_HEROTARGET, this.tick(clock), slotId, mi < 0 ? 0 : mi])
  }
  heroFocus(clock: number, slotId: number, enemyId: number): void {
    this.c.push([OP_HEROFOCUS, this.tick(clock), slotId, enemyId])
  }
  startWave(clock: number): void {
    this.c.push([OP_STARTWAVE, this.tick(clock)])
  }
  draft(index: number): void {
    this.d.push(Math.max(0, Math.floor(index)))
  }

  /** How many commands captured (for the HUD's "replay recorded" affordance). */
  size(): number {
    return this.c.length + this.d.length
  }

  log(): RankedLog {
    return { c: this.c.slice(), d: this.d.slice() }
  }

  /** Assemble the full submittable record from the finished sim's own numbers.
   *  `route` is required (and only meaningful) for mode === 'pathforge'. */
  record(
    mode: RankedMode, seed: number, period: number, party: DeclaredHero[], score: number, wave: number,
    route?: readonly PFCell[],
  ): RankedRunRecord {
    const rec: RankedRunRecord = { v: SIM_VERSION, mode, seed: seed >>> 0, period, party: party.slice(), score, wave, log: this.log() }
    if (route && route.length) rec.route = route.map(([c, r]) => [c, r] as PFCell)
    return rec
  }
}

// ---------------------------------------------------------------------------
//  Replay — re-run a recorded log through a freshly-built canonical sim and read
//  the resulting score + wave. Pure; identical in browser, simcheck, and server.
// ---------------------------------------------------------------------------

// A pure anti-abuse backstop, NOT a gameplay limit. It must sit FAR above any
// survivable ranked run so it never truncates (and thus never false-rejects) a
// real death — the live battle loop is uncapped and always ends in a natural
// loss, so replay must be able to reach that same tick. Endless HP+count scale
// unbounded, so ~90 sim-minutes is orders of magnitude past any human run yet
// still ~10s in Node — comfortably inside the serverless timeout.
export const REPLAY_TICK_CAP = 60 * 60 * 90

function applyCmd(sim: Sim, cmd: Cmd): void {
  switch (cmd[0] as number) {
    case OP_PLACE:
      sim.placeTower(cmd[2] as TowerKind, cmd[3] as number, cmd[4] as number)
      break
    case OP_UPGRADE:
      sim.upgradeTower(cmd[2] as number)
      break
    case OP_BRANCH:
      sim.chooseBranch(cmd[2] as number, cmd[3] as number)
      break
    case OP_FUSE:
      sim.fuseTowers(cmd[2] as number, cmd[3] as number)
      break
    case OP_DEPLOY:
      sim.deployHero(cmd[2] as string, cmd[3] as number, cmd[4] as number)
      break
    case OP_HEROSPELL:
      sim.castHeroSpell(cmd[2] as number, cmd[3] as number, cmd[4] as number)
      break
    case OP_SPELL:
      sim.castSpell(cmd[2] as SpellKey, cmd[3] as number, cmd[4] as number)
      break
    case OP_TARGET:
      sim.setTargeting(cmd[2] as number, TARGET_MODES_ORDER[cmd[3] as number] ?? 'First')
      break
    case OP_STARTWAVE:
      if (sim.state === 'prep') sim.startWave()
      break
    case OP_HEROMOVE:
      sim.moveHero(cmd[2] as number, cmd[3] as number, cmd[4] as number)
      break
    case OP_HEROTARGET:
      sim.setHeroTargeting(cmd[2] as number, TARGET_MODES_ORDER[cmd[3] as number] ?? 'First')
      break
    case OP_HEROFOCUS:
      sim.focusHero(cmd[2] as number, cmd[3] as number)
      break
  }
}

export interface ReplayResult {
  score: number
  wave: number
  fingerprint: string // soft debug signal — NEVER the accept/reject gate
}

/** Re-run a recorded log and read the final score + wave. Deterministic: the
 *  same record always yields the same numbers on any V8 runtime. */
export function replayRun(rec: RankedRunRecord): ReplayResult {
  const sim = new Sim(rankedConfig(rec.mode, rec.seed, rec.party, rec.route))
  const cmds = rec.log?.c ?? []
  const drafts = rec.log?.d ?? []
  let ci = 0
  let di = 0
  let tick = 0
  while (sim.state !== 'won' && sim.state !== 'lost' && tick <= REPLAY_TICK_CAP) {
    if (sim.state === 'draft') {
      // clock is frozen mid-draft — apply the next recorded pick (or card 0), no
      // tick advance, exactly like the live game's draft hold.
      const idx = di < drafts.length ? drafts[di++] : 0
      const clamped = Math.min(Math.max(0, idx), Math.max(0, sim.draftOffer.length - 1))
      if (!sim.chooseDraft(clamped)) sim.chooseDraft(0)
      continue
    }
    // apply every command stamped at (or before) this tick, in recorded order
    while (ci < cmds.length && (cmds[ci][1] as number) <= tick) {
      applyCmd(sim, cmds[ci])
      ci++
    }
    sim.step()
    tick++
  }
  // drain any commands stamped past the run's natural end (no-op; keeps ci sane)
  return {
    score: sim.score(),
    wave: sim.waveIndex + 1,
    fingerprint: `${sim.state}|${sim.waveIndex}|${sim.gold}|${sim.lives}|${sim.runStats.kills}|${sim.runStats.reactions}`,
  }
}

// ---------------------------------------------------------------------------
//  Ghost — an INCREMENTAL replay you can drive with real dt, to race a downloaded
//  top run alongside your own live run. Same tick-keyed command application as
//  replayRun, but advanced frame-by-frame so its pace tracks wall-clock time.
// ---------------------------------------------------------------------------
export class GhostRunner {
  readonly sim: Sim
  private cmds: Cmd[]
  private drafts: number[]
  private ci = 0
  private di = 0
  private tick = 0
  private acc = 0

  constructor(
    mode: RankedMode, seed: number, party: readonly DeclaredHero[] | undefined, log: RankedLog,
    route?: readonly PFCell[],
  ) {
    this.sim = new Sim(rankedConfig(mode, seed, party, route))
    this.cmds = log?.c ?? []
    this.drafts = log?.d ?? []
  }

  /** Advance the ghost by `dt` seconds of sim time (fixed-step, like Sim.advance). */
  advance(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0 || this.done()) return
    this.acc += Math.min(dt, 0.25)
    let steps = 0
    while (this.acc >= FIXED_DT && steps < 8 && !this.done()) {
      this.stepOne()
      this.acc -= FIXED_DT
      steps++
    }
  }

  private stepOne(): void {
    // resolve any pending draft instantly (the clock is frozen mid-draft)
    let guard = 0
    while (this.sim.state === 'draft' && guard++ < 8) {
      const idx = this.di < this.drafts.length ? this.drafts[this.di++] : 0
      const clamped = Math.min(Math.max(0, idx), Math.max(0, this.sim.draftOffer.length - 1))
      if (!this.sim.chooseDraft(clamped)) { this.sim.chooseDraft(0); break }
    }
    if (this.done()) return
    while (this.ci < this.cmds.length && (this.cmds[this.ci][1] as number) <= this.tick) {
      applyCmd(this.sim, this.cmds[this.ci])
      this.ci++
    }
    this.sim.step()
    this.tick++
    // ghost never renders, so drop its event stream to avoid unbounded growth
    this.sim.drainEvents()
  }

  score(): number { return this.sim.score() }
  wave(): number { return this.sim.waveIndex + 1 }
  done(): boolean { return this.sim.state === 'won' || this.sim.state === 'lost' }
}

export interface VerifyResult {
  ok: boolean
  score: number // the RE-RUN score (what actually gets boarded)
  wave: number // the RE-RUN wave
  reason: '' | 'version' | 'mismatch' | 'invalid'
  fingerprint: string
}

/** PATHFORGE anti-exploit re-check: NEVER trust a client-submitted route. Treat
 *  the submitted cells as the painted road and re-derive spawn/base from the
 *  SEED alone (never from the client), then re-run the exact same
 *  validateMaze() the editor enforces live. The recomputed canonical route must
 *  match the submission cell-for-cell — any mismatch (disconnected road, a
 *  route that isn't the true BFS-shortest one for its own cell set, wrong
 *  spawn/base) is rejected. Returns the trusted route to replay with, or null. */
function revalidatedPathforgeRoute(seed: number, submitted: unknown): PFCell[] | null {
  if (!Array.isArray(submitted) || submitted.length < 2) return null
  const route: PFCell[] = []
  for (const cell of submitted) {
    if (!Array.isArray(cell) || cell.length !== 2) return null
    const [c, r] = cell
    if (!Number.isInteger(c) || !Number.isInteger(r)) return null
    route.push([c, r])
  }
  const { spawn, base } = pathforgeLayout(seed)
  const road = new Set<number>(route.map(([c, r]) => pfKey(c, r)))
  const mv = validateMaze(road, spawn, base)
  if (!mv.ok || !mv.route) return null
  if (mv.route.length !== route.length) return null
  for (let i = 0; i < route.length; i++) {
    if (mv.route[i][0] !== route[i][0] || mv.route[i][1] !== route[i][1]) return null
  }
  return mv.route
}

/** THE MOAT. Re-run a submitted record and accept it ONLY if the replay's
 *  integer score AND wave match the claim under the current sim version. This
 *  is what the server calls before a run is allowed onto the board — the SAME
 *  single code path for every mode, including PathForge (no parallel verifier:
 *  a maze run is just a record whose LevelDef comes from a re-validated route
 *  instead of the fixed endless arena; everything downstream is identical). */
export function verifyRun(rec: RankedRunRecord): VerifyResult {
  if (!rec || typeof rec !== 'object') {
    return { ok: false, score: 0, wave: 0, reason: 'invalid', fingerprint: '' }
  }
  if (rec.v !== SIM_VERSION) {
    return { ok: false, score: 0, wave: 0, reason: 'version', fingerprint: '' }
  }
  if (!Number.isFinite(rec.seed) || !Number.isFinite(rec.score) || !Number.isFinite(rec.wave)) {
    return { ok: false, score: 0, wave: 0, reason: 'invalid', fingerprint: '' }
  }
  let route: PFCell[] | undefined
  if (rec.mode === 'pathforge') {
    // THE ANTI-EXPLOIT HARD RULE, RE-RUN SERVER-SIDE: a client-submitted maze
    // is never trusted as-is — only the seed-derived spawn/base + the same
    // validateMaze() the live editor enforces decide whether a route is legal.
    const revalidated = revalidatedPathforgeRoute(rec.seed, rec.route)
    if (!revalidated) return { ok: false, score: 0, wave: 0, reason: 'invalid', fingerprint: '' }
    route = revalidated
  }
  let res: ReplayResult
  try {
    res = replayRun(route ? { ...rec, route } : rec)
  } catch {
    return { ok: false, score: 0, wave: 0, reason: 'invalid', fingerprint: '' }
  }
  const ok = res.score === rec.score && res.wave === rec.wave
  return { ok, score: res.score, wave: res.wave, reason: ok ? '' : 'mismatch', fingerprint: res.fingerprint }
}

// ---------------------------------------------------------------------------
//  Wire helpers — a compact deterministic hash of a log (the replay_input_hash
//  column, so the same log dedupes/verifies) + JSON round-trip guards.
// ---------------------------------------------------------------------------

/** FNV-1a (32-bit) hex of a string — small, stable, dependency-free. Used as the
 *  run's replay_input_hash so identical logs collapse to one board row. */
export function fnv1a(str: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** Canonical serialization of a record's log (stable key order) for hashing. */
export function logHash(rec: RankedRunRecord): string {
  return fnv1a(JSON.stringify([rec.v, rec.seed, rec.log?.c ?? [], rec.log?.d ?? []]))
}
