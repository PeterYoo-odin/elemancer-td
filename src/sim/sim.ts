// ============================================================================
//  CHROMANCER (Elemancer TD) — PURE, renderer-agnostic, deterministic simulation core.
//  ZERO Phaser imports. All game logic lives here; a view merely reads state and
//  forwards input. Fixed-timestep, one seeded PRNG, object pooling, defensive
//  math (never NaN/Infinity/negative-HP/overflow). Swap to Three.js later without
//  touching a line of this file.
// ============================================================================

import { ENEMIES, type EnemyDef, type EnemyKind } from '../game/enemies'
import { TOWERS, type TowerBranch, type TowerDef, type TowerKind, type TowerLevel } from '../game/towers'
import { type LevelDef, type Wave } from '../game/levels'
import { pathCellsFor, terrainDmgMul, terrainRngMul, terrainNoBuild, type TerrainKind } from '../game/paths'
import { SPELLS, SPELL_ORDER, type SpellKey } from '../game/spells'
import type { RunModifiers } from '../game/workshop'
import { RNG } from './rng'
import {
  clamp,
  computeHit,
  classify,
  dist2,
  distance,
  angleBetween,
  typeMultiplier,
  type AttackStats,
  type DamageType,
  type Element,
  type Effectiveness,
  type TargetMode,
} from './combat'
import { COLS, ROWS, TILE, FIXED_DT, MAX_STEPS_PER_FRAME, cellCenter } from './layout'
import { AURA_COLOR, FUSION_NAMES, REACTIONS, reactionFor, type AuraElement, type ReactionDef, type ReactionKey } from './reactions'
import { DRAFT_POOL, neutralUpgrades, type DraftCard, type RunUpgrades } from './drafts'
import { heroById, type HeroDef, type HeroRole, type HeroSpellDef, type SpellEffect } from '../game/heroes'
import { heroStats, heroSpellScaled, signatureAwake } from '../game/heroProgress'
import { resolveBond, type BondResolution } from '../game/wyrms'
import { computeSynergies, neutralSynergy, type SynergyBonus, type SynergyEffects } from '../game/synergy'
import { computeResonances, type ResonanceBonus } from '../game/resonance'
import {
  ECHO_CAST_MULT, ECHO_HP_MULT, KEEPER_BY_ID, KEEPER_PHASES, PHASE3_SPEED, PHASE_CAST_MULT,
  keeperPhaseFor, type KeeperAbility, type KeeperDef,
} from '../game/keepers'

// ---- tunables --------------------------------------------------------------
const COMBO_WINDOW = 2.2 // seconds a combo lingers before it breaks
const COMBO_STEP = 0.15 // per-synergy-hit multiplier growth
const COMBO_MAX = 6 // hard cap (also a simcheck range bound)
const DRAFT_EVERY = 3 // offer a draft after every N cleared waves
const PROJECTILE_SPEED = 760

// ---- Morose intrusions (campaign only, deterministic, telegraphed) ----------
const INTRUSION_WARN = 1.4 // seconds between the whisper and the grey landing
const INTRUSION_GREY_DUR = 6 // seconds a greyed tower sleeps
const INTRUSION_MIN_LEVEL = 1 // no intrusions on the tutorial level

// ---- elemental reactions (see reactions.ts for the pair table) -------------
const AURA_WINDOW = 4 // seconds an element tag lingers on an enemy
const REACT_LOCK = 1.1 // per-enemy cooldown after a reaction (paces the fireworks)
const AMPLIFY_TAKEN = 1.25 // damage multiplier on AMPLIFY-marked enemies
const AMPLIFY_DURATION = 4
const MAX_ZONES = 48 // burning-ground pool cap (oldest recycled beyond this)

// ---- Corrupted Keeper boss fights (campaign finales; see keepers.ts) --------
const KEEPER_FIRST_CAST = 0.6 // first cast at castEvery × this (show the twist early)
const KEEPER_MIN_CAST_GAP = 3 // casts never come faster than this, any phase
const KEEPER_COCOON_CAP = 0.6 // thornCocoon: ally shields cap at this × maxHp

// ---- FUSION TOWERS (two adjacent max towers → one dual-element tower) -------
// The host keeps its verb/branch and gains the partner's element, alternating
// auras every volley (solo reactions). The absorbed tower's tile is FREED —
// late-game board consolidation is part of the payoff.
const FUSION_COST = 300
const FUSION_DMG = 1.75 // fused towers hit much harder (they ate a whole tower)
const FUSION_RNG = 1.15 // and see a little further

// Aura an attacking tower paints (Arcane tags its OWN element so it combos with all).
const TOWER_AURA: Record<TowerKind, AuraElement | undefined> = {
  flame: 'Fire', frost: 'Water', storm: 'Storm', arcane: 'Arcane', cannon: undefined,
}

export type SimState = 'prep' | 'active' | 'draft' | 'won' | 'lost'

export interface SimConfig {
  level: LevelDef
  mods: RunModifiers
  seed: number
  endless: boolean
  startGold: number
  startLives: number
  // slice-6 hero loadout (optional). Each hero may carry a bonded Chromatic Wyrm
  // (companion dragon) — deterministic breath + aura resolved via resolveBond().
  party?: Array<{ heroId: string; level: number; wyrm?: { wyrmId: string; level: number } }>
  towerCap?: number // per-level challenge: max simultaneous towers (undefined = no cap)
}

export interface SimEnemy {
  id: number
  active: boolean
  def: EnemyDef
  kind: EnemyKind
  maxHp: number
  hp: number
  shield: number
  shieldMax: number
  dist: number // progress along the path in px
  x: number
  y: number
  // statuses (absolute clock deadlines)
  slowUntil: number
  slowFactor: number
  stunUntil: number
  burnUntil: number
  burnDps: number
  burnTick: number
  poisonUntil: number
  poisonDps: number
  tearUntil: number
  tearAmount: number
  healTick: number
  // elemental-reaction state (aura tag + pacing lock + AMPLIFY vulnerability mark)
  auraElem: AuraElement | ''
  auraUntil: number
  reactLockUntil: number
  amplifyUntil: number
  // Corrupted Keeper boss state ('' = not a keeper). Deterministic: casts on a
  // fixed clock with a telegraph, phases on HP thresholds, zero RNG.
  keeperId: string
  keeperEcho: boolean
  phase: number // 1..3 (echoes stay 1)
  castAt: number // absolute clock time the next ability lands
  castWarned: boolean // telegraph already emitted for the pending cast
  speedMult: number // phase-3 stride (1 for everything else)
  // transient view hints
  hitFlash: number
}

// A lingering ground hazard (Scorch branch: burning ground). Pooled like enemies.
export interface SimZone {
  id: number
  active: boolean
  x: number
  y: number
  radius: number // px
  dps: number
  until: number // absolute clock deadline
  color: number
}

export interface SimTower {
  id: number
  active: boolean
  def: TowerDef
  kind: TowerKind
  level: number // 0..2 linear, 3 = branched
  branch: number // -1 none else 0/1
  col: number
  row: number
  x: number
  y: number
  cd: number
  buffDmg: number
  buffRng: number
  aimAngle: number
  targeting: TargetMode
  fireFlash: number
  greyUntil: number // Morose intrusion: while clock < greyUntil the tower sleeps
  // FUSION state ('' = unfused). A fused tower alternates its own aura with
  // fusedElem every volley, so it primes AND detonates its reaction solo.
  fusedElem: AuraElement | ''
  fusionKey: ReactionKey | ''
  fusionName: string
  fusedColor: number // partner element colour, for the view's fusion crown
  auraFlip: boolean // which of the two elements the NEXT volley paints
}

// A deployed hero: a CHARACTER on a build tile. Auto-attacks through the same
// element wheel as towers, contributes to team synergy, and owns one active spell.
export interface SimHero {
  id: number
  active: boolean
  heroId: string
  def: HeroDef
  role: HeroRole
  level: number
  col: number
  row: number
  x: number
  y: number
  cd: number // auto-attack cooldown
  aimAngle: number
  fireFlash: number
  // scaled base combat (pre-synergy)
  baseDamage: number
  baseRange: number // tiles
  attackCd: number
  buffDamage: number // support: adjacency buff this hero GRANTS
  slowFactor: number // control: on-hit slow (1 = none)
  slowDuration: number
  // buffs received / temporary
  adjBuff: number // adjacency buff RECEIVED (from support neighbours), 1 = none
  buffMult: number // temporary self-buff (Holy Nova), 1 = none
  buffUntil: number
  // spell (level-scaled at deploy)
  spell: HeroSpellDef
  spellCd: number
  spellMaxCd: number
  // Moth Mirror (Vesper): while clock < greyUntil this hero is BORROWED — no
  // attacks, no spell casts, no gate intercession. Same motif as tower greying.
  greyUntil: number
  // SIGNATURE mechanic state — pure counters, no RNG, dormant below the unlock level
  sigAwake: boolean // level ≥ SIGNATURE_UNLOCK_LEVEL at deploy
  sigCounter: number // rhythm kinds (cindernova/foreseen/wager) + tithe text pacing
  sigRamp: number // deeproots: accumulated bonus aura from waves held
  sigGuardUsed: boolean // intercession: spent for the current wave
  // CHROMATIC WYRM bond (null = no companion). Deterministic breath + aura; all
  // effects folded through the shared damage/reaction pipeline (see updateHeroes).
  wyrm: BondResolution | null
  wyrmBreathCd: number // seconds until the next breath (0 = ready)
  wyrmUltUsed: boolean // PERFECT fused ultimate: spent for the current wave
}

export interface SimProjectile {
  id: number
  active: boolean
  x: number
  y: number
  tx: number
  ty: number
  targetId: number
  speed: number
  splash: number // px, 0 = single target
  atk: AttackStats
  synergy: boolean
  sourceKind: TowerKind
  color: number
  // Phoenix branch payload: burn applied on impact (0 = none)
  burnDps: number
  burnDur: number
}

// Semantic events — the VIEW decides the juice (shake/flash/particles) from these.
export type SimEvent =
  | { t: 'damage'; x: number; y: number; amount: number; eff: Effectiveness; combo: number }
  | { t: 'death'; x: number; y: number; kind: EnemyKind; color: number; boss: boolean }
  | { t: 'shieldBreak'; x: number; y: number; radius: number }
  | { t: 'leak'; x: number; y: number; kind: EnemyKind; boss: boolean }
  | { t: 'towerFire'; x: number; y: number; tx: number; ty: number; color: number; kind: TowerKind }
  | { t: 'hit'; x: number; y: number; color: number }
  | { t: 'chain'; points: Array<[number, number]>; color: number; count: number; supercharged: boolean }
  | { t: 'aoe'; x: number; y: number; radius: number; color: number; alpha: number }
  | { t: 'combo'; count: number; mult: number; x: number; y: number; milestone: boolean }
  | { t: 'heal'; x: number; y: number; amount: number; radius: number }
  | { t: 'gold'; x: number; y: number; amount: number }
  | { t: 'place'; x: number; y: number; color: number; radius: number }
  | { t: 'upgrade'; x: number; y: number; color: number; radius: number; label: string }
  | { t: 'spell'; key: SpellKey; x: number; y: number; radius: number; color: number; count: number }
  | { t: 'heroDeploy'; x: number; y: number; color: number; radius: number }
  | { t: 'heroFire'; x: number; y: number; tx: number; ty: number; color: number }
  | { t: 'heroSpell'; effect: SpellEffect; name: string; glyph: string; x: number; y: number; radius: number; color: number; count: number }
  | { t: 'banner'; msg: string; color: number }
  | { t: 'text'; x: number; y: number; msg: string; color: number; size: number }
  | { t: 'reaction'; key: ReactionKey; name: string; x: number; y: number; radius: number; color: number; color2: number }
  | { t: 'wyrmBreath'; wyrmId: string; element: Element; x: number; y: number; radius: number; color: number; ult: boolean; name: string }
  | { t: 'fuse'; towerId: number; name: string; x: number; y: number; px: number; py: number; color: number; color2: number }
  | { t: 'morose'; kind: 'warn' | 'greyTower' | 'stealDraft'; towerId: number; x: number; y: number; duration: number }
  | {
      t: 'keeper'
      kind: 'reveal' | 'telegraph' | 'cast' | 'phase' | 'redeemed'
      keeperId: string
      name: string
      ability: KeeperAbility
      abilityName: string
      x: number
      y: number
      radius: number // ability footprint in px (0 = not areal)
      color: number
      accent: number
      phase: number
      echo: boolean
    }

interface SpawnItem {
  kind: EnemyKind
  hpMul: number
  at: number
  keeperId?: string
  echo?: boolean
}

export class Sim {
  readonly config: SimConfig
  readonly rng: RNG
  readonly seed: number

  // path / grid
  grid: string[][] = []
  terrain: TerrainKind[][] = [] // per-cell terrain flag ('' = none); read by canPlace/effDamage/effRange
  private occupied: (SimTower | null)[][] = []
  private waypoints: { x: number; y: number }[] = []
  private segments: Array<{ ax: number; ay: number; bx: number; by: number; len: number }> = []
  pathLength = 0

  // pooled entities (iterate skipping .active === false; never per-frame alloc)
  enemies: SimEnemy[] = []
  towers: SimTower[] = []
  projectiles: SimProjectile[] = []
  heroes: SimHero[] = []
  zones: SimZone[] = [] // burning-ground hazards (Scorch branch)

  // heroes: the loadout available to deploy, which ids are already fielded, and the
  // live element-synergy state (recomputed whenever the field changes).
  private occupiedHero: (SimHero | null)[][] = []
  private partyDefs: Array<{ heroId: string; level: number; wyrm?: { wyrmId: string; level: number } }> = []
  deployedHeroIds = new Set<string>()
  synergyEffects: SynergyEffects = neutralSynergy()
  synergyBonuses: SynergyBonus[] = []

  // ELEMENT RESONANCE — awakened hero + 2/4+ towers of their resonant kind.
  // Recomputed on every placement/deploy; folded into effDamage / heroDamage.
  private resonances: ResonanceBonus[] = []
  private resTowerMult = new Map<TowerKind, number>()
  private resHeroMult = new Map<string, number>()
  private resSeen = new Set<string>() // banner each resonance tier only ONCE per run

  gold = 0
  lives = 0
  startLives = 0
  waveIndex = 0
  state: SimState = 'prep'
  clock = 0
  prepTimer = 0

  // combo engine
  comboCount = 0
  comboMult = 1
  comboTimer = 0

  // Greying restoration: kills this wave / wave size, for colorProgress()
  private waveKills = 0
  private waveSpawnTotal = 1

  // run-wide draft upgrades
  upgrades: RunUpgrades = neutralUpgrades()
  draftOffer: DraftCard[] = []
  draftsTaken = 0

  // Morose intrusions — planned up-front from a SEPARATE rng stream (the main
  // rng's draw order is untouched, so pre-intrusion seeds replay identically).
  // greyWaves: wave indices that get a mid-wave grey-a-tower moment.
  // stealDraftOrdinal: which draft (by draftsTaken) offers 2 cards instead of 3.
  private greyWaves = new Map<number, number>() // waveIndex -> seconds into the wave
  private stealDraftOrdinal = -1
  private greyPendingAt = -1 // clock time the pending grey lands (-1 = none)
  private greyWarned = false

  // run stats — pure counters for the prove-it share card / score. They consume
  // no RNG and never feed back into gameplay, so determinism is untouched.
  readonly runStats = {
    kills: 0,
    bossKills: 0,
    maxCombo: 0, // highest comboCount reached
    reactions: 0, // total elemental reactions detonated
    reactionCounts: {} as Record<string, number>, // reaction NAME -> times fired
    fusions: 0, // fusion towers forged this run
    goldEarned: 0, // all battle-gold income (kills + clears + bonuses)
  }

  // spells
  spellCd: Record<SpellKey, number> = { meteor: 0, freeze: 0, goldrush: 0 }
  spellMaxCd: Record<SpellKey, number> = { meteor: 0, freeze: 0, goldrush: 0 }

  private spawnQueue: SpawnItem[] = []
  private nextId = 1
  private accumulator = 0
  private events: SimEvent[] = []

  constructor(config: SimConfig) {
    this.config = config
    this.seed = config.seed >>> 0
    this.rng = new RNG(this.seed)
    this.gold = Math.max(0, Math.floor(config.startGold))
    this.startLives = Math.max(1, Math.floor(config.startLives))
    this.lives = this.startLives
    for (const k of SPELL_ORDER) {
      this.spellMaxCd[k] = Math.max(0.5, SPELLS[k].cooldown * config.mods.spellCooldownMult)
    }
    // Validate the loadout: only known heroes, deduped, capped at 3. A bad id never
    // reaches deployHero — the scene should pre-filter too, but the sim self-defends.
    const seenHeroes = new Set<string>()
    for (const p of config.party ?? []) {
      if (this.partyDefs.length >= 3) break
      if (!p || seenHeroes.has(p.heroId) || !heroById(p.heroId)) continue
      seenHeroes.add(p.heroId)
      // A bonded Wyrm rides along only if it resolves to a real companion; a bad
      // id is dropped here so deployHero never sees it (the sim self-defends).
      const wyrm = p.wyrm && resolveBond(p.heroId, p.wyrm.wyrmId, p.wyrm.level)
        ? { wyrmId: p.wyrm.wyrmId, level: Math.max(1, Math.floor(p.wyrm.level || 1)) }
        : undefined
      this.partyDefs.push({ heroId: p.heroId, level: Math.max(1, Math.floor(p.level || 1)), wyrm })
    }
    this.planIntrusions()
    this.buildGrid()
    this.enterPrep()
  }

  // Decide, deterministically, where Morose intrudes on this run. Balanced:
  // never the tutorial, never more than two grey moments, the steal always
  // leaves the player a real choice (2 cards).
  private planIntrusions(): void {
    if (this.config.endless) return // Ranked stays pure (and simcheck untouched)
    const idx = this.config.level.index
    if (idx < INTRUSION_MIN_LEVEL) return
    const waves = this.config.level.waves.length
    if (waves < 3) return
    const irng = new RNG((this.seed ^ 0x51edc0de) >>> 0)
    // one grey moment mid-level…
    const mid = Math.min(waves - 1, 1 + Math.floor(waves / 2) + irng.int(-1, 0))
    this.greyWaves.set(mid, irng.range(4, 9))
    // …a second one on the harder back half of the campaign
    if (idx >= 3) this.greyWaves.set(waves - 1, irng.range(5, 10))
    // and from level 3 on, he takes a draft option once per run
    if (idx >= 2) this.stealDraftOrdinal = irng.int(0, 1)
  }

  // ---- events -------------------------------------------------------------
  private emit(e: SimEvent): void {
    // bounded buffer so a non-draining consumer can never grow it without limit
    if (this.events.length < 4000) this.events.push(e)
  }
  drainEvents(): SimEvent[] {
    if (this.events.length === 0) return EMPTY_EVENTS
    const out = this.events
    this.events = []
    return out
  }

  // ---- path / grid --------------------------------------------------------
  private buildGrid(): void {
    const pathCells = pathCellsFor(this.config.level)
    this.grid = []
    this.terrain = []
    this.occupied = []
    this.occupiedHero = []
    for (let r = 0; r < ROWS; r++) {
      const gr: string[] = []
      const trow: TerrainKind[] = []
      const orow: (SimTower | null)[] = []
      const hrow: (SimHero | null)[] = []
      for (let c = 0; c < COLS; c++) {
        gr.push('blocked')
        trow.push('')
        orow.push(null)
        hrow.push(null)
      }
      this.grid.push(gr)
      this.terrain.push(trow)
      this.occupied.push(orow)
      this.occupiedHero.push(hrow)
    }
    // Lay down authored terrain flags (only on in-bounds cells; non-build tiles ignored downstream).
    for (const tc of this.config.level.terrain ?? []) {
      if (tc.row >= 0 && tc.row < ROWS && tc.col >= 0 && tc.col < COLS) this.terrain[tc.row][tc.col] = tc.kind
    }
    const onPath = new Set<string>()
    for (const [c, r] of pathCells) {
      if (r >= 0 && r < ROWS && c >= 0 && c < COLS) {
        this.grid[r][c] = 'path'
        onPath.add(`${c},${r}`)
      }
    }
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (this.grid[r][c] === 'path') continue
        let near = false
        for (let dr = -1; dr <= 1 && !near; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (onPath.has(`${c + dc},${r + dr}`)) {
              near = true
              break
            }
          }
        }
        this.grid[r][c] = near ? 'build' : 'blocked'
      }
    }
    this.waypoints = []
    const first = pathCells[0]
    this.waypoints.push(cellCenter(first[0] - 1.2, first[1]))
    for (const [c, r] of pathCells) this.waypoints.push(cellCenter(c, r))
    this.segments = []
    this.pathLength = 0
    for (let i = 0; i < this.waypoints.length - 1; i++) {
      const a = this.waypoints[i]
      const b = this.waypoints[i + 1]
      const len = distance(a.x, a.y, b.x, b.y)
      this.segments.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, len })
      this.pathLength += len
    }
  }

  private positionAt(dist: number): { x: number; y: number; done: boolean } {
    const wp = this.waypoints
    const last = wp[wp.length - 1]
    if (dist >= this.pathLength) return { x: last.x, y: last.y, done: true }
    let d = Math.max(0, dist)
    for (const s of this.segments) {
      if (d <= s.len) {
        const t = s.len === 0 ? 0 : d / s.len
        return { x: s.ax + (s.bx - s.ax) * t, y: s.ay + (s.by - s.ay) * t, done: false }
      }
      d -= s.len
    }
    return { x: last.x, y: last.y, done: true }
  }

  waypointFor(which: 'portal' | 'base'): { x: number; y: number } {
    return which === 'portal' ? this.waypoints[1] : this.waypoints[this.waypoints.length - 1]
  }

  // The full waypoint chain, for the view to draw the road/dashes (read-only use).
  pathWaypoints(): ReadonlyArray<{ x: number; y: number }> {
    return this.waypoints
  }

  buildCells(): Array<{ col: number; row: number }> {
    const out: Array<{ col: number; row: number }> = []
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (this.grid[r][c] === 'build') out.push({ col: c, row: r })
    return out
  }

  canPlace(col: number, row: number): boolean {
    if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return false
    if (terrainNoBuild(this.terrain[row]?.[col] ?? '')) return false // fog-of-placement
    return this.grid[row][col] === 'build' && this.occupied[row][col] === null && this.occupiedHero[row][col] === null
  }

  terrainAt(col: number, row: number): TerrainKind {
    if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return ''
    return this.terrain[row]?.[col] ?? ''
  }

  // Count of active towers on the field (for the tower-cap challenge).
  private activeTowerCount(): number {
    let n = 0
    for (const t of this.towers) if (t.active) n++
    return n
  }

  towerAt(col: number, row: number): SimTower | null {
    if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return null
    return this.occupied[row][col]
  }

  heroAt(col: number, row: number): SimHero | null {
    if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return null
    return this.occupiedHero[row][col]
  }

  // ---- fixed-timestep driver ---------------------------------------------
  // View passes already-scaled dt (realDt * gameSpeed, or 0 when paused). We
  // accumulate and step in fixed increments so behaviour is frame-rate independent.
  // beforeStep (optional) runs before EVERY fixed step — scripted input (the
  // attract/demo reel) injects commands there so they land on exact tick
  // boundaries and replay identically at any frame rate or game speed.
  advance(dt: number, beforeStep?: () => void): void {
    if (!Number.isFinite(dt) || dt <= 0) return
    this.accumulator += Math.min(dt, 0.25) // clamp catastrophic frames
    let steps = 0
    while (this.accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      beforeStep?.()
      this.step()
      this.accumulator -= FIXED_DT
      steps++
    }
    if (steps >= MAX_STEPS_PER_FRAME) this.accumulator = 0 // drop backlog, avoid spiral
  }

  // One deterministic tick.
  step(): void {
    if (this.state === 'won' || this.state === 'lost' || this.state === 'draft') return
    const dt = FIXED_DT
    this.clock += dt

    if (this.state === 'prep') {
      this.prepTimer -= dt
      if (this.prepTimer <= 0) this.startWave()
    }

    this.updateCombo(dt)
    this.updateIntrusion()
    this.updateEnemies(dt)
    this.updateZones(dt)
    this.updateTowers(dt)
    this.updateHeroes(dt)
    this.updateProjectiles(dt)
    this.updateSpellCooldowns(dt)
  }

  // ---- Morose intrusion driver (telegraph → grey the proudest tower) -------
  private updateIntrusion(): void {
    if (this.greyPendingAt < 0 || this.state !== 'active') return
    if (!this.greyWarned) {
      if (this.clock >= this.greyPendingAt - INTRUSION_WARN) {
        this.greyWarned = true
        this.emit({ t: 'morose', kind: 'warn', towerId: -1, x: 360, y: 400, duration: INTRUSION_WARN })
      }
      return
    }
    if (this.clock < this.greyPendingAt) return
    this.greyPendingAt = -1
    this.greyWarned = false
    // target the strongest awake tower — the one the player is proudest of
    let best: SimTower | null = null
    let bestDps = -1
    for (const t of this.towers) {
      if (!t.active || t.greyUntil > this.clock) continue
      const dps = this.effDps(t)
      if (dps > bestDps) { bestDps = dps; best = t }
    }
    if (!best) return // nothing to grey — mercy by vacancy
    best.greyUntil = this.clock + INTRUSION_GREY_DUR
    this.emit({ t: 'morose', kind: 'greyTower', towerId: best.id, x: best.x, y: best.y, duration: INTRUSION_GREY_DUR })
  }

  /** view helper: is this tower currently greyed by a Morose intrusion? */
  towerGreyed(t: SimTower): boolean {
    return t.greyUntil > this.clock
  }

  // How much of the level's colour the player has painted back (0 = fully Greyed,
  // 1 = restored). Monotonic across a run: waves cleared + kills within the wave.
  colorProgress(): number {
    if (this.state === 'won') return 1
    if (this.config.endless) return clamp(this.waveIndex / 12, 0, 1)
    const total = Math.max(1, this.config.level.waves.length)
    const frac = this.state === 'active' ? clamp(this.waveKills / this.waveSpawnTotal, 0, 1) : 0
    return clamp((this.waveIndex + frac) / total, 0, 1)
  }

  // ---- combo engine -------------------------------------------------------
  private updateCombo(dt: number): void {
    if (this.comboTimer > 0) {
      this.comboTimer -= dt
      if (this.comboTimer <= 0) {
        this.comboTimer = 0
        this.comboCount = 0
        this.comboMult = 1
      }
    }
  }

  private bumpCombo(x: number, y: number): number {
    this.comboCount = Math.min(this.comboCount + 1, 9999)
    if (this.comboCount > this.runStats.maxCombo) this.runStats.maxCombo = this.comboCount
    this.comboTimer = COMBO_WINDOW
    const stepAmt = COMBO_STEP * this.upgrades.comboRamp
    this.comboMult = clamp(1 + this.comboCount * stepAmt, 1, COMBO_MAX)
    if (this.comboCount >= 2) {
      this.emit({ t: 'combo', count: this.comboCount, mult: this.comboMult, x, y, milestone: this.comboCount % 5 === 0 })
    }
    return this.comboMult
  }

  // ---- waves --------------------------------------------------------------
  private enterPrep(): void {
    this.state = 'prep'
    this.prepTimer = this.waveIndex === 0 ? 6 : 7
  }

  currentWave(): Wave {
    if (this.config.endless) return this.endlessWave(this.waveIndex + 1)
    const t = this.config.level.waves
    return t[Math.min(this.waveIndex, t.length - 1)]
  }

  totalWaves(): number {
    return this.config.endless ? Infinity : this.config.level.waves.length
  }

  private endlessWave(n: number): Wave {
    const hp = 1 + n * 0.18
    const entries: Wave['entries'] = []
    entries.push({ kind: 'runner', count: 6 + Math.floor(n * 0.8), spacing: 0.3, hpMul: hp })
    entries.push({ kind: 'grunt', count: 4 + Math.floor(n * 0.6), spacing: 0.5, hpMul: hp })
    if (n >= 3) entries.push({ kind: 'flyer', count: 3 + Math.floor(n * 0.4), spacing: 0.6, hpMul: hp })
    if (n >= 4) entries.push({ kind: 'shielded', count: 2 + Math.floor(n * 0.3), spacing: 0.7, hpMul: hp })
    if (n >= 5 && n % 2 === 0) entries.push({ kind: 'healer', count: 1 + Math.floor(n * 0.15), spacing: 1.1, hpMul: hp })
    if (n >= 4) entries.push({ kind: 'swarm', count: 10 + n * 2, spacing: 0.12, hpMul: hp })
    if (n >= 6) entries.push({ kind: 'brute', count: 1 + Math.floor(n * 0.25), spacing: 1.0, hpMul: hp })
    if (n % 5 === 0) entries.push({ kind: 'boss', count: Math.floor(n / 5), spacing: 2.0, hpMul: 1 + n * 0.12 })
    return { entries, clearBonus: 30 + n * 6 }
  }

  // Player (or sim auto-timer) starts the current wave. Returns early-bonus gold.
  startWave(): number {
    if (this.state !== 'prep') return 0
    const bonus = Math.max(0, Math.ceil(this.prepTimer)) * 2
    if (bonus > 0) {
      this.addGold(bonus)
      this.emit({ t: 'gold', x: 360, y: 250, amount: bonus })
      this.emit({ t: 'text', x: 360, y: 250, msg: `+${bonus} EARLY`, color: 0xffd54a, size: 24 })
    }
    this.state = 'active'
    // fresh wave → Seraphine's once-per-wave intercession + the Wyrm's fused
    // ultimate are available again.
    for (const h of this.heroes) if (h.active) { h.sigGuardUsed = false; h.wyrmUltUsed = false }
    this.buildSpawnQueue()
    // arm this wave's planned Morose moment (if any)
    const greyAt = this.greyWaves.get(this.waveIndex)
    if (greyAt !== undefined) {
      this.greyWaves.delete(this.waveIndex)
      this.greyPendingAt = this.clock + greyAt
      this.greyWarned = false
    }
    return bonus
  }

  private buildSpawnQueue(): void {
    this.spawnQueue = []
    const wave = this.currentWave()
    let t = this.clock + 0.4
    for (const entry of wave.entries) {
      for (let i = 0; i < entry.count; i++) {
        this.spawnQueue.push({ kind: entry.kind, hpMul: entry.hpMul, at: t, keeperId: entry.keeperId, echo: entry.echo })
        t += Math.max(0.02, entry.spacing)
      }
      t += 0.5
    }
    this.waveKills = 0
    this.waveSpawnTotal = Math.max(1, this.spawnQueue.length)
  }

  private waveCleared(): void {
    const bonus = this.currentWave().clearBonus
    this.addGold(bonus)
    this.emit({ t: 'banner', msg: `WAVE CLEAR  +${bonus}`, color: 0x2ff7c3 })
    this.emit({ t: 'gold', x: 360, y: 250, amount: bonus })
    // Give It a Minute (Thornwick's signature): each wave held grows his aura.
    for (const h of this.heroes) {
      if (!h.active || !h.sigAwake || h.def.signature.kind !== 'deeproots') continue
      const sig = h.def.signature
      const prev = h.sigRamp
      h.sigRamp = Math.min(sig.rampMax ?? 0.18, h.sigRamp + (sig.ramp ?? 0.03))
      if (h.sigRamp > prev) {
        this.recomputeBuffs()
        this.emit({ t: 'text', x: h.x, y: h.y - 40, msg: `🌳 ROOTS DEEPEN +${Math.round(h.sigRamp * 100)}%`, color: h.def.color, size: 15 })
      }
    }
    if (!this.config.endless && this.waveIndex >= this.config.level.waves.length - 1) {
      this.state = 'won'
      return
    }
    this.waveIndex++
    // Offer a draft every few waves (before the upcoming prep).
    if ((this.waveIndex % DRAFT_EVERY) === 0) this.enterDraft()
    else this.enterPrep()
  }

  // ---- drafts -------------------------------------------------------------
  private enterDraft(): void {
    this.state = 'draft'
    this.draftOffer = this.rng.sample(DRAFT_POOL, 3)
    // Morose steals one option from the planned draft — a choice still remains.
    if (!this.config.endless && this.draftsTaken === this.stealDraftOrdinal && this.draftOffer.length === 3) {
      this.stealDraftOrdinal = -2 // spent
      this.draftOffer = this.draftOffer.slice(0, 2)
      this.emit({ t: 'morose', kind: 'stealDraft', towerId: -1, x: 360, y: 400, duration: 0 })
    }
    this.emit({ t: 'banner', msg: 'CHOOSE A POWER', color: 0xc06bff })
  }

  // View calls this with the chosen offer index (0..2).
  chooseDraft(index: number): boolean {
    if (this.state !== 'draft') return false
    const card = this.draftOffer[index]
    if (!card) return false
    card.apply(this.upgrades)
    if (card.livesDelta) {
      this.lives = clamp(this.lives + card.livesDelta, 0, 9999)
      if (this.lives <= 0) {
        this.state = 'lost'
        return true
      }
    }
    this.draftsTaken++
    this.draftOffer = []
    this.emit({ t: 'text', x: 360, y: 640, msg: card.title.toUpperCase() + '!', color: card.color, size: 40 })
    this.enterPrep()
    return true
  }

  // ---- enemies ------------------------------------------------------------
  private spawnEnemy(kind: EnemyKind, hpMul: number, keeperId?: string, echo?: boolean): void {
    // Corrupted Keepers ride the same pipeline with their own stat block. Echoes
    // (final-gauntlet ghosts) come pre-weakened; an unknown id degrades to the
    // fallback ENEMIES.keeper block instead of crashing.
    const keeper = kind === 'keeper' && keeperId ? KEEPER_BY_ID[keeperId] : undefined
    const def = keeper ? keeper.enemy : ENEMIES[kind]
    if (echo) hpMul *= ECHO_HP_MULT
    const maxHp = Math.max(1, Math.round(def.hp * Math.max(0.1, hpMul)))
    const shieldMax = def.shield ? Math.max(0, Math.round(def.shield * Math.max(0.1, hpMul))) : 0
    const start = this.positionAt(0)
    const e = this.freeEnemy()
    e.active = true
    e.def = def
    e.kind = kind
    e.maxHp = maxHp
    e.hp = maxHp
    e.shield = shieldMax
    e.shieldMax = shieldMax
    e.dist = 0
    e.x = start.x
    e.y = start.y
    e.slowUntil = 0
    e.slowFactor = 1
    e.stunUntil = 0
    e.burnUntil = 0
    e.burnDps = 0
    e.burnTick = 0
    e.poisonUntil = 0
    e.poisonDps = 0
    e.tearUntil = 0
    e.tearAmount = 0
    e.healTick = 0
    e.auraElem = ''
    e.auraUntil = 0
    e.reactLockUntil = 0
    e.amplifyUntil = 0
    e.keeperId = keeper ? keeper.id : ''
    e.keeperEcho = !!echo
    e.phase = 1
    e.castAt = 0
    e.castWarned = false
    e.speedMult = 1
    e.hitFlash = 0
    if (keeper) {
      // first cast lands early so the twist is legible from the start
      e.castAt = this.clock + Math.max(KEEPER_MIN_CAST_GAP, keeper.castEvery * KEEPER_FIRST_CAST * (echo ? ECHO_CAST_MULT : 1))
      this.emitKeeper('reveal', e, keeper, 0)
    }
  }

  private freeEnemy(): SimEnemy {
    // A reused pooled slot MUST get a fresh monotonic id, or the view keeps the
    // dead entity's GameObject and projectiles re-home onto the reused slot.
    for (const e of this.enemies) if (!e.active) { e.id = this.nextId++; return e }
    const e: SimEnemy = {
      id: 0, active: false, def: ENEMIES.runner, kind: 'runner', maxHp: 1, hp: 1, shield: 0, shieldMax: 0,
      dist: 0, x: 0, y: 0, slowUntil: 0, slowFactor: 1, stunUntil: 0, burnUntil: 0, burnDps: 0, burnTick: 0,
      poisonUntil: 0, poisonDps: 0, tearUntil: 0, tearAmount: 0, healTick: 0,
      auraElem: '', auraUntil: 0, reactLockUntil: 0, amplifyUntil: 0,
      keeperId: '', keeperEcho: false, phase: 1, castAt: 0, castWarned: false, speedMult: 1, hitFlash: 0,
    }
    this.enemies.push(e)
    e.id = this.nextId++
    return e
  }

  private updateEnemies(dt: number): void {
    if (this.state === 'active') {
      while (this.spawnQueue.length && this.spawnQueue[0].at <= this.clock) {
        const item = this.spawnQueue.shift()!
        this.spawnEnemy(item.kind, item.hpMul, item.keeperId, item.echo)
      }
    }

    let liveCount = 0
    for (const e of this.enemies) {
      if (!e.active) continue
      if (e.hitFlash > 0) e.hitFlash = Math.max(0, e.hitFlash - dt)

      // damage-over-time (burn ignores armor — it's fire, not an attack)
      if (e.burnUntil > this.clock && e.burnDps > 0) {
        e.burnTick += dt
        this.applyRaw(e, e.burnDps * dt, false)
        if (e.burnTick >= 0.4 && e.active) {
          this.emit({ t: 'damage', x: e.x + 12, y: e.y - e.def.radius, amount: e.burnDps * 0.4, eff: 'neutral', combo: 0 })
          e.burnTick = 0
        }
        if (!e.active) continue
      }
      if (e.poisonUntil > this.clock && e.poisonDps > 0) {
        this.applyRaw(e, e.poisonDps * dt, false)
        if (!e.active) continue
      }

      // healer aura
      if (e.def.healInterval && e.def.healRadius && e.def.healAmount) {
        e.healTick += dt
        if (e.healTick >= e.def.healInterval) {
          e.healTick = 0
          this.doHeal(e)
        }
      }

      // Corrupted Keeper driver: phases on HP, telegraphed casts on the clock
      if (e.keeperId !== '') this.updateKeeper(e)

      // movement (stun overrides slow)
      const stunned = e.stunUntil > this.clock
      const slowed = e.slowUntil > this.clock
      if (!slowed) e.slowFactor = 1
      let speed = e.def.speed * TILE * e.speedMult
      if (stunned) speed = 0
      else if (slowed) speed *= clamp(e.slowFactor, 0.05, 1)
      e.dist = clamp(e.dist + speed * dt, 0, this.pathLength + 1)
      const pos = this.positionAt(e.dist)
      e.x = pos.x
      e.y = pos.y

      if (pos.done) {
        this.enemyReachedBase(e)
        continue
      }
      liveCount++
    }

    if (this.state === 'active' && this.spawnQueue.length === 0 && liveCount === 0) {
      this.waveCleared()
    }
  }

  private doHeal(healer: SimEnemy): void {
    const radius = (healer.def.healRadius ?? 2) * TILE
    const amount = Math.max(0, healer.def.healAmount ?? 10)
    const r2 = radius * radius
    let any = false
    for (const a of this.enemies) {
      if (!a.active || a === healer || a.hp >= a.maxHp) continue
      if (dist2(healer.x, healer.y, a.x, a.y) > r2) continue
      a.hp = clamp(a.hp + amount, 0, a.maxHp)
      this.emit({ t: 'heal', x: a.x, y: a.y - a.def.radius - 8, amount, radius: 0 })
      any = true
    }
    if (any) this.emit({ t: 'heal', x: healer.x, y: healer.y, amount: 0, radius })
  }

  // ======================================================================
  //  CORRUPTED KEEPERS — boss driver. Fully deterministic: no RNG anywhere.
  //  Phases flip on HP thresholds, casts land on a fixed clock after a visible
  //  telegraph, and every target choice is a pure "strongest/nearest" scan.
  // ======================================================================
  private emitKeeper(kind: 'reveal' | 'telegraph' | 'cast' | 'phase' | 'redeemed', e: SimEnemy, k: KeeperDef, radius: number): void {
    this.emit({
      t: 'keeper', kind, keeperId: k.id, name: e.keeperEcho ? `ECHO OF ${k.trueName.split(',')[0].toUpperCase()}` : k.name,
      ability: k.ability, abilityName: k.abilityName, x: e.x, y: e.y, radius,
      color: k.enemy.color, accent: k.enemy.accent, phase: e.phase, echo: e.keeperEcho,
    })
  }

  private updateKeeper(e: SimEnemy): void {
    const k = KEEPER_BY_ID[e.keeperId]
    if (!k) return
    // phase flips (full Keepers only — echoes are memories, single phase)
    if (!e.keeperEcho) {
      const p = keeperPhaseFor(e.hp / Math.max(1, e.maxHp))
      if (p > e.phase) {
        e.phase = Math.min(p, KEEPER_PHASES)
        if (e.phase >= 3) e.speedMult = PHASE3_SPEED
        // the phase change is FELT: the pending cast hurries up (telegraph intact)
        e.castAt = Math.min(e.castAt, this.clock + k.telegraph + 0.6)
        this.emitKeeper('phase', e, k, 0)
      }
    }
    if (!e.castWarned && this.clock >= e.castAt - k.telegraph) {
      e.castWarned = true
      this.emitKeeper('telegraph', e, k, this.keeperCastRadius(k))
    }
    if (this.clock >= e.castAt) {
      e.castWarned = false
      const mult = e.keeperEcho ? ECHO_CAST_MULT : PHASE_CAST_MULT[e.phase - 1]
      e.castAt = this.clock + Math.max(KEEPER_MIN_CAST_GAP, k.castEvery * mult)
      this.keeperCast(e, k)
    }
  }

  private keeperCastRadius(k: KeeperDef): number {
    if (k.ability === 'ashenSnuff') return k.power * TILE
    if (k.ability === 'thornCocoon') return 3.2 * TILE
    if (k.ability === 'becalm') return 2.8 * TILE
    return 0
  }

  private keeperCast(e: SimEnemy, k: KeeperDef): void {
    switch (k.ability) {
      case 'ashenSnuff': {
        // Kaelen: snuff every burn/poison/primed aura around him (Ashka, inverted)
        const r2 = (k.power * TILE) ** 2
        let snuffed = 0
        for (const o of this.enemies) {
          if (!o.active) continue
          if (dist2(e.x, e.y, o.x, o.y) > r2) continue
          if (o.burnUntil > this.clock || o.poisonUntil > this.clock || o.auraElem !== '' || o.amplifyUntil > this.clock) snuffed++
          o.burnUntil = 0
          o.burnDps = 0
          o.poisonUntil = 0
          o.poisonDps = 0
          o.auraElem = ''
          o.auraUntil = 0
          o.amplifyUntil = 0
        }
        if (snuffed > 0) this.emit({ t: 'text', x: e.x, y: e.y - e.def.radius - 30, msg: `🌫 ${snuffed} FLAME${snuffed > 1 ? 'S' : ''} SNUFFED`, color: 0xb8b0d0, size: 16 })
        break
      }
      case 'stillGrace':
      case 'gildedHalo': {
        // Maravelle / Aurelin: seal the strongest awake tower(s) in stillness.
        // Same sleep field as Morose's intrusions — the view's veil just works.
        const count = Math.max(1, Math.round(k.power))
        for (let i = 0; i < count; i++) {
          let best: SimTower | null = null
          let bestDps = -1
          for (const t of this.towers) {
            if (!t.active || t.greyUntil > this.clock) continue
            const dps = this.effDps(t)
            if (dps > bestDps) { bestDps = dps; best = t }
          }
          if (!best) break
          best.greyUntil = this.clock + k.greySeconds
          this.emit({ t: 'aoe', x: best.x, y: best.y, radius: TILE * 0.9, color: k.enemy.accent, alpha: 0.55 })
          this.emit({ t: 'text', x: best.x, y: best.y - 34, msg: k.ability === 'stillGrace' ? '❄ STILLED' : '😇 PACIFIED', color: k.enemy.accent, size: 16 })
        }
        break
      }
      case 'becalm': {
        // Vorn: Galea's squall reversed — grey rigging links his fleet and heals it
        const hopR2 = (2.8 * TILE) ** 2
        const chain: SimEnemy[] = []
        const used = new Set<number>([e.id])
        let cx = e.x
        let cy = e.y
        while (chain.length < 4) {
          let best: SimEnemy | null = null
          let bd = Infinity
          for (const o of this.enemies) {
            if (!o.active || o.hp <= 0 || used.has(o.id) || o.keeperId !== '') continue
            const d2 = dist2(cx, cy, o.x, o.y)
            if (d2 <= hopR2 && d2 < bd) { bd = d2; best = o }
          }
          if (!best) break
          chain.push(best)
          used.add(best.id)
          cx = best.x
          cy = best.y
        }
        if (chain.length) {
          const points: Array<[number, number]> = [[e.x, e.y]]
          for (const o of chain) {
            const heal = Math.max(0, o.maxHp * k.power)
            o.hp = clamp(o.hp + heal, 0, o.maxHp)
            points.push([o.x, o.y])
            this.emit({ t: 'heal', x: o.x, y: o.y - o.def.radius - 8, amount: Math.round(heal), radius: 0 })
          }
          this.emit({ t: 'chain', points, color: 0x9a94b8, count: chain.length, supercharged: false })
        }
        break
      }
      case 'thornCocoon': {
        // Wessa: preservative thorn-shields — nothing may die, so nothing may live
        const r2 = (3.2 * TILE) ** 2
        let wrapped = 0
        for (const o of this.enemies) {
          if (!o.active || o === e || o.keeperId !== '') continue
          if (dist2(e.x, e.y, o.x, o.y) > r2) continue
          const cap = o.maxHp * KEEPER_COCOON_CAP
          const next = Math.min(cap, o.shield + o.maxHp * k.power)
          if (next > o.shield) {
            o.shield = next
            o.shieldMax = Math.max(o.shieldMax, o.shield)
            wrapped++
          }
        }
        if (wrapped > 0) this.emit({ t: 'text', x: e.x, y: e.y - e.def.radius - 30, msg: `🌿 ${wrapped} COCOONED`, color: k.enemy.accent, size: 16 })
        break
      }
      case 'mothMirror': {
        // Vesper: BORROWS one of your heroes (lowest id = longest on the field).
        // With no hero fielded he settles for your strongest tower.
        let mark: SimHero | null = null
        for (const h of this.heroes) {
          if (!h.active || h.greyUntil > this.clock) continue
          if (!mark || h.id < mark.id) mark = h
        }
        if (mark) {
          mark.greyUntil = this.clock + k.greySeconds
          this.emit({ t: 'aoe', x: mark.x, y: mark.y, radius: TILE * 1.0, color: k.enemy.accent, alpha: 0.6 })
          this.emit({ t: 'text', x: mark.x, y: mark.y - 40, msg: `🦋 ${mark.def.name.toUpperCase()} IS BORROWED`, color: k.enemy.accent, size: 17 })
        } else {
          let best: SimTower | null = null
          let bestDps = -1
          for (const t of this.towers) {
            if (!t.active || t.greyUntil > this.clock) continue
            const dps = this.effDps(t)
            if (dps > bestDps) { bestDps = dps; best = t }
          }
          if (best) {
            best.greyUntil = this.clock + k.greySeconds
            this.emit({ t: 'text', x: best.x, y: best.y - 34, msg: '🦋 BORROWED', color: k.enemy.accent, size: 16 })
          }
        }
        break
      }
    }
    this.emitKeeper('cast', e, k, this.keeperCastRadius(k))
  }

  /** view helper: is this hero currently borrowed by the Moth Mirror? */
  heroGreyed(h: SimHero): boolean {
    return h.greyUntil > this.clock
  }

  // Boss-bar snapshot for the HUD: the live Keeper (full fights outrank echoes,
  // then the biggest). Null when no Keeper walks the field.
  bossStatus(): {
    keeperId: string; name: string; ability: KeeperAbility; abilityName: string; twist: string
    hp: number; maxHp: number; shield: number; shieldMax: number
    phase: number; phases: number; color: number; accent: number; echo: boolean
    castIn: number; castEvery: number; telegraphing: boolean
  } | null {
    let best: SimEnemy | null = null
    for (const e of this.enemies) {
      if (!e.active || e.keeperId === '') continue
      if (!best) { best = e; continue }
      if (best.keeperEcho !== e.keeperEcho) { if (best.keeperEcho) best = e; continue }
      if (e.maxHp > best.maxHp) best = e
    }
    if (!best) return null
    const k = KEEPER_BY_ID[best.keeperId]
    if (!k) return null
    return {
      keeperId: k.id,
      name: best.keeperEcho ? `ECHO OF ${k.trueName.split(',')[0].toUpperCase()}` : k.name,
      ability: k.ability,
      abilityName: k.abilityName,
      twist: k.twist,
      hp: best.hp,
      maxHp: best.maxHp,
      shield: best.shield,
      shieldMax: best.shieldMax,
      phase: best.phase,
      phases: KEEPER_PHASES,
      color: k.enemy.color,
      accent: k.enemy.accent,
      echo: best.keeperEcho,
      castIn: Math.max(0, best.castAt - this.clock),
      castEvery: Math.max(KEEPER_MIN_CAST_GAP, k.castEvery * (best.keeperEcho ? ECHO_CAST_MULT : PHASE_CAST_MULT[best.phase - 1])),
      telegraphing: best.castWarned,
    }
  }

  private enemyReachedBase(e: SimEnemy): void {
    // Hold the Line (Seraphine's signature): once per wave, the first enemy about
    // to breach the gate is smitten by dawn. If it dies, the leak never happens.
    for (const h of this.heroes) {
      if (!h.active || !h.sigAwake || h.def.signature.kind !== 'intercession' || h.sigGuardUsed) continue
      if (h.greyUntil > this.clock) continue // borrowed by the Moth Mirror — the dawn is elsewhere
      h.sigGuardUsed = true
      const nuke = clamp(h.baseDamage * (h.def.signature.nukeMult ?? 8), 0, 1e7)
      this.emit({ t: 'heroFire', x: h.x, y: h.y - 6, tx: e.x, ty: e.y, color: h.def.color })
      this.emit({ t: 'aoe', x: e.x, y: e.y, radius: TILE * 1.1, color: h.def.color, alpha: 0.7 })
      this.emit({ t: 'text', x: e.x, y: e.y - e.def.radius - 26, msg: '🛡 THE DAWN HOLDS!', color: h.def.color, size: 18 })
      this.applyDirect(e, nuke)
      if (!e.active) return // smitten at the gate — no leak, bounty paid
      break // it survived the dawn: the leak stands (one intercession per wave)
    }
    e.active = false
    const base = this.waypointFor('base')
    this.loseLife(e.def.boss ? 5 : 1)
    this.emit({ t: 'leak', x: base.x, y: base.y, kind: e.def.kind, boss: !!e.def.boss })
  }

  // ---- towers -------------------------------------------------------------
  placeTower(kind: TowerKind, col: number, row: number): SimTower | null {
    if (!this.canPlace(col, row)) return null
    if (this.config.towerCap !== undefined && this.activeTowerCount() >= this.config.towerCap) return null
    const cost = this.placeCost(kind)
    if (this.gold < cost) return null
    this.spendGold(cost)
    const def = TOWERS[kind]
    const cc = cellCenter(col, row)
    let t: SimTower | null = null
    for (const cand of this.towers) if (!cand.active) { t = cand; t.id = this.nextId++; break }
    if (!t) {
      t = {
        id: this.nextId++, active: false, def, kind, level: 0, branch: -1, col, row,
        x: cc.x, y: cc.y, cd: 0, buffDmg: 1, buffRng: 1, aimAngle: 0, targeting: def.defaultTargeting, fireFlash: 0,
        greyUntil: 0, fusedElem: '', fusionKey: '', fusionName: '', fusedColor: 0, auraFlip: false,
      }
      this.towers.push(t)
    }
    t.active = true
    t.def = def
    t.kind = kind
    t.level = 0
    t.branch = -1
    t.col = col
    t.row = row
    t.x = cc.x
    t.y = cc.y
    t.cd = 0
    t.buffDmg = 1
    t.buffRng = 1
    t.aimAngle = 0
    t.targeting = def.defaultTargeting
    t.fireFlash = 0
    t.greyUntil = 0
    t.fusedElem = ''
    t.fusionKey = ''
    t.fusionName = ''
    t.fusedColor = 0
    t.auraFlip = false
    this.occupied[row][col] = t
    this.recomputeBuffs()
    this.recomputeResonances()
    this.emit({ t: 'place', x: cc.x, y: cc.y, color: def.color, radius: this.effRange(t) })
    return t
  }

  placeCost(kind: TowerKind): number {
    return Math.max(1, Math.round(TOWERS[kind].cost * this.config.mods.towerCostMult * this.upgrades.towerCostMult))
  }

  upgradeCostFor(t: SimTower): number | null {
    if (t.level >= 2) return null
    const next = t.def.levels[t.level + 1]
    return Math.max(1, Math.round(next.upgradeCost * this.config.mods.towerCostMult * this.upgrades.towerCostMult))
  }

  branchCostFor(t: SimTower, idx: number): number | null {
    if (t.level !== 2) return null
    const br = t.def.branches[idx]
    if (!br) return null
    return Math.max(1, Math.round(br.upgradeCost * this.config.mods.towerCostMult * this.upgrades.towerCostMult))
  }

  upgradeTower(id: number): boolean {
    const t = this.towerById(id)
    if (!t || t.level >= 2) return false
    const cost = this.upgradeCostFor(t)
    if (cost === null || this.gold < cost) return false
    this.spendGold(cost)
    t.level++
    this.recomputeBuffs()
    this.emit({ t: 'upgrade', x: t.x, y: t.y, color: t.def.color, radius: this.effRange(t), label: `LV ${t.level + 1}!` })
    return true
  }

  chooseBranch(id: number, idx: number): boolean {
    const t = this.towerById(id)
    if (!t || t.level !== 2 || (idx !== 0 && idx !== 1)) return false
    const cost = this.branchCostFor(t, idx)
    if (cost === null || this.gold < cost) return false
    this.spendGold(cost)
    t.level = 3
    t.branch = idx
    this.recomputeBuffs()
    this.emit({ t: 'upgrade', x: t.x, y: t.y, color: t.def.color, radius: this.effRange(t), label: `${t.def.branches[idx].name.toUpperCase()}!` })
    return true
  }

  setTargeting(id: number, mode: TargetMode): void {
    const t = this.towerById(id)
    if (t) t.targeting = mode
  }

  // ---- FUSION TOWERS -------------------------------------------------------
  // A host can fuse with an ADJACENT max-tier tower whose aura forms a reaction
  // pair with its own (Arcane is the wildcard). Both must be unfused and awake.
  fusionCost(): number {
    return Math.max(1, Math.round(FUSION_COST * this.config.mods.towerCostMult * this.upgrades.towerCostMult))
  }

  fusionOptions(t: SimTower): Array<{ partner: SimTower; key: ReactionKey; name: string; cost: number; color: number; color2: number }> {
    const out: Array<{ partner: SimTower; key: ReactionKey; name: string; cost: number; color: number; color2: number }> = []
    const ownAura = TOWER_AURA[t.kind]
    if (!t.active || !ownAura || !this.isMax(t) || t.fusedElem !== '') return out
    for (const p of this.towers) {
      if (!p.active || p === t || p.fusedElem !== '') continue
      if (!adjacentCell(t, p)) continue
      if (!this.isMax(p)) continue
      const pAura = TOWER_AURA[p.kind]
      if (!pAura) continue
      const def = reactionFor(ownAura, pAura)
      if (!def) continue
      out.push({ partner: p, key: def.key, name: FUSION_NAMES[def.key], cost: this.fusionCost(), color: def.color, color2: def.color2 })
    }
    return out
  }

  // Fuse host + partner: partner's tile is freed, host becomes the fusion tower.
  fuseTowers(hostId: number, partnerId: number): boolean {
    const t = this.towerById(hostId)
    if (!t) return false
    const opt = this.fusionOptions(t).find((o) => o.partner.id === partnerId)
    if (!opt) return false
    const cost = this.fusionCost()
    if (this.gold < cost) return false
    this.spendGold(cost)
    const p = opt.partner
    const pAura = TOWER_AURA[p.kind]!
    // absorb the partner: free its cell, retire its slot
    p.active = false
    this.occupied[p.row][p.col] = null
    // the host becomes the fusion tower (keeps its verb, gains the second element)
    t.fusedElem = pAura
    t.fusionKey = opt.key
    t.fusionName = opt.name
    t.fusedColor = AURA_COLOR[pAura]
    t.auraFlip = false
    this.runStats.fusions++
    this.recomputeBuffs()
    this.recomputeResonances()
    this.emit({ t: 'fuse', towerId: t.id, name: opt.name, x: t.x, y: t.y, px: p.x, py: p.y, color: opt.color, color2: opt.color2 })
    this.emit({ t: 'banner', msg: `⚛ ${opt.name.toUpperCase()} FORGED!`, color: opt.color })
    this.emit({ t: 'upgrade', x: t.x, y: t.y, color: opt.color, radius: this.effRange(t), label: `⚛ ${opt.name.toUpperCase()}` })
    return true
  }

  // The reaction a fused tower detonates (for the UI); null when unfused.
  fusionReaction(t: SimTower): ReactionDef | null {
    return t.fusionKey !== '' ? REACTIONS[t.fusionKey] : null
  }

  towerById(id: number): SimTower | null {
    for (const t of this.towers) if (t.active && t.id === id) return t
    return null
  }

  stats(t: SimTower): TowerLevel | TowerBranch {
    if (t.level >= 3 && t.branch >= 0) return t.def.branches[t.branch]
    return t.def.levels[Math.min(t.level, 2)]
  }
  isMax(t: SimTower): boolean {
    return t.level >= 3
  }

  effRange(t: SimTower): number {
    const fus = t.fusedElem !== '' ? FUSION_RNG : 1
    const terr = terrainRngMul(this.terrain[t.row]?.[t.col] ?? '')
    return clamp(this.stats(t).range * TILE * t.buffRng * fus * this.config.mods.rangeMult * terr, TILE * 0.5, TILE * 12)
  }
  effCooldown(t: SimTower): number {
    return clamp(this.stats(t).cooldown * this.config.mods.cooldownMult * this.upgrades.fireRateMult, 0.05, 10)
  }
  effDamage(t: SimTower): number {
    const s = this.stats(t)
    const elem = t.def.element ? this.upgrades.elementDmg[t.def.element] : 1
    const res = this.resTowerMult.get(t.kind) ?? 1
    const fus = t.fusedElem !== '' ? FUSION_DMG : 1
    const terr = terrainDmgMul(this.terrain[t.row]?.[t.col] ?? '', t.def.element)
    const dmg = s.damage * t.buffDmg * this.config.mods.towerDamageMult * this.upgrades.allDmg * elem * res * fus * terr
    return clamp(dmg, 0, 1e7)
  }
  // DPS shown in the UI (splash/chain not counted, single-target baseline).
  effDps(t: SimTower): number {
    return clamp(this.effDamage(t) / Math.max(0.05, this.effCooldown(t)), 0, 1e7)
  }

  // The aura this tower's NEXT volley paints. Fused towers alternate between
  // their own element and the absorbed one (auraFlip toggles per volley).
  private towerAura(t: SimTower): AuraElement | undefined {
    const own = TOWER_AURA[t.kind]
    if (t.fusedElem === '' || !own) return own
    return t.auraFlip ? t.fusedElem : own
  }

  private towerAttack(t: SimTower, damageOverride?: number): AttackStats {
    const s = this.stats(t)
    const dmgType: DamageType = s.damageType ?? t.def.damageType
    const armorPen = (s.armorPen ?? t.def.armorPen ?? 0) + this.upgrades.armorPenBonus
    return {
      damage: damageOverride ?? this.effDamage(t),
      dmgType,
      element: t.def.element,
      armorPen,
      aura: this.towerAura(t),
    }
  }

  private recomputeBuffs(): void {
    for (const t of this.towers) {
      if (!t.active) continue
      t.buffDmg = 1
      t.buffRng = 1
    }
    for (const h of this.heroes) {
      if (!h.active) continue
      h.adjBuff = 1
    }
    for (const a of this.towers) {
      if (!a.active || !a.def.support) continue
      const s = this.stats(a)
      const bd = s.buffDamage ?? 0
      const br = s.buffRange ?? 0
      const reach = Math.max(1, Math.round(s.buffReach ?? 1)) // Amplify branch: wider network
      for (const n of this.towers) {
        if (!n.active || n === a) continue
        if (adjacentCell(a, n, reach)) {
          n.buffDmg += bd
          n.buffRng += br
        }
      }
      // support towers also empower adjacent heroes
      for (const n of this.heroes) {
        if (!n.active) continue
        if (adjacentCell(a, n, reach)) n.adjBuff += bd
      }
    }
    // support HEROES buff adjacent towers AND heroes (Sylvan/Pyra/Aurelia).
    // sigRamp is Thornwick's Deep Roots growth (0 unless awakened + waves held).
    for (const a of this.heroes) {
      if (!a.active) continue
      const aura = a.buffDamage + a.sigRamp
      if (aura <= 0) continue
      for (const n of this.towers) {
        if (!n.active) continue
        if (adjacentCell(a, n)) n.buffDmg += aura
      }
      for (const n of this.heroes) {
        if (!n.active || n === a) continue
        if (adjacentCell(a, n)) n.adjBuff += aura
      }
    }
    // Chromatic Wyrm aura: nearby towers of the Wyrm's element hit harder.
    const WYRM_AURA_R2 = (3 * TILE) * (3 * TILE)
    for (const a of this.heroes) {
      if (!a.active || !a.wyrm || a.wyrm.towerBuff <= 0) continue
      const elem = a.wyrm.wyrm.element
      for (const n of this.towers) {
        if (!n.active || n.def.element !== elem) continue
        if (dist2(a.x, a.y, n.x, n.y) <= WYRM_AURA_R2) n.buffDmg += a.wyrm.towerBuff
      }
    }
  }

  // Support-buff adjacency, for the view to draw glow links.
  buffLinks(): Array<{ ax: number; ay: number; bx: number; by: number; color: number }> {
    const out: Array<{ ax: number; ay: number; bx: number; by: number; color: number }> = []
    for (const a of this.towers) {
      if (!a.active || !a.def.support) continue
      const reach = Math.max(1, Math.round(this.stats(a).buffReach ?? 1))
      for (const n of this.towers) {
        if (!n.active || n === a) continue
        if (adjacentCell(a, n, reach)) {
          out.push({ ax: a.x, ay: a.y, bx: n.x, by: n.y, color: a.def.color })
        }
      }
    }
    // support-hero buff links (hero → adjacent tower/hero)
    for (const a of this.heroes) {
      if (!a.active || a.buffDamage <= 0) continue
      for (const n of this.towers) {
        if (!n.active) continue
        if (adjacentCell(a, n)) out.push({ ax: a.x, ay: a.y, bx: n.x, by: n.y, color: a.def.color })
      }
      for (const n of this.heroes) {
        if (!n.active || n === a) continue
        if (adjacentCell(a, n)) out.push({ ax: a.x, ay: a.y, bx: n.x, by: n.y, color: a.def.color })
      }
    }
    return out
  }

  // Glow links between deployed heroes that share an active synergy (for the view).
  synergyLinks(): Array<{ ax: number; ay: number; bx: number; by: number; color: number }> {
    const out: Array<{ ax: number; ay: number; bx: number; by: number; color: number }> = []
    const active = this.deployedHeroes()
    if (active.length < 2) return out
    for (const b of this.synergyBonuses) {
      const members = active.filter((h) => b.members.includes(h.def.element))
      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          out.push({ ax: members[i].x, ay: members[i].y, bx: members[j].x, by: members[j].y, color: b.color })
        }
      }
    }
    return out
  }

  private updateTowers(dt: number): void {
    for (const t of this.towers) {
      if (!t.active) continue
      if (t.fireFlash > 0) t.fireFlash = Math.max(0, t.fireFlash - dt)
      if (t.greyUntil > this.clock) continue // Morose greyed it: no aura, no shots
      const range = this.effRange(t)
      t.cd -= dt

      // Frost is a continuous slow aura on everything in range.
      if (t.kind === 'frost') {
        const r2 = range * range
        const s = this.stats(t)
        const slowF = clamp((s.slowFactor ?? 0.5) - this.upgrades.frostSlowBonus, 0.1, 1)
        for (const e of this.enemies) {
          if (!this.canTarget(t, e)) continue
          if (dist2(t.x, t.y, e.x, e.y) <= r2) {
            e.slowUntil = this.clock + (s.slowDuration ?? 1)
            e.slowFactor = Math.min(e.slowFactor, slowF)
            if (s.stunDuration) e.stunUntil = Math.max(e.stunUntil, this.clock + s.stunDuration)
          }
        }
      }

      if (t.cd > 0) continue
      const target = this.acquire(t, range)
      if (!target) continue
      t.cd = this.effCooldown(t)
      t.aimAngle = angleBetween(t.x, t.y, target.x, target.y)
      t.fireFlash = 0.12

      if (t.kind === 'cannon') this.fireProjectile(t, target)
      else if (t.kind === 'frost') this.frostZap(t, range)
      else if (t.kind === 'flame') {
        // Phoenix branch: a seeking firebolt (homing projectile) instead of the burst.
        if (this.stats(t).seeking) this.fireProjectile(t, target)
        else this.flameBurst(t, target)
      }
      else if (t.kind === 'storm') this.stormBolt(t, target)
      else this.arcaneZap(t, target)

      // fusion: NEXT volley paints the other element (whole volley shares one aura)
      if (t.fusedElem !== '') t.auraFlip = !t.auraFlip
    }
  }

  private canTarget(t: SimTower, e: SimEnemy): boolean {
    if (!e.active || e.hp <= 0) return false
    if (e.def.isAir && !t.def.antiAir) return false
    return true
  }

  private acquire(t: SimTower, range: number): SimEnemy | null {
    const r2 = range * range
    let best: SimEnemy | null = null
    let bestScore = -Infinity
    for (const e of this.enemies) {
      if (!this.canTarget(t, e)) continue
      const d2 = dist2(t.x, t.y, e.x, e.y)
      if (d2 > r2) continue
      let score: number
      switch (t.targeting) {
        case 'First': score = e.dist; break
        case 'Last': score = -e.dist; break
        case 'Close': score = -d2; break
        case 'Strong': score = e.hp; break
        case 'Weak': score = -e.hp; break
        case 'Primed': score = (this.wouldDetonate(t, e) ? 1e7 : 0) + e.dist; break
        default: score = e.dist
      }
      if (score > bestScore) {
        bestScore = score
        best = e
      }
    }
    return best
  }

  // Primed targeting: would this tower's next hit detonate a reaction on e?
  // Elementless towers (cannon) instead hunt AMPLIFY-marked enemies (they take
  // bonus damage) — every tower gets something real out of the mode.
  private wouldDetonate(t: SimTower, e: SimEnemy): boolean {
    const aura = this.towerAura(t)
    if (!aura) return e.amplifyUntil > this.clock
    if (this.clock < e.reactLockUntil) return false
    if (e.auraElem === '' || e.auraUntil <= this.clock || e.auraElem === aura) return false
    return reactionFor(e.auraElem as AuraElement, aura) !== null
  }

  private fireProjectile(t: SimTower, target: SimEnemy): void {
    const s = this.stats(t)
    const splash = (s.splash ?? 0) * TILE * (1 + this.upgrades.splashBonus)
    let p: SimProjectile | null = null
    for (const cand of this.projectiles) if (!cand.active) { p = cand; p.id = this.nextId++; break }
    if (!p) {
      p = {
        id: this.nextId++, active: false, x: 0, y: 0, tx: 0, ty: 0, targetId: -1, speed: PROJECTILE_SPEED,
        splash: 0, atk: { damage: 0, dmgType: 'Physical', armorPen: 0 }, synergy: false, sourceKind: 'cannon', color: 0xffffff,
        burnDps: 0, burnDur: 0,
      }
      this.projectiles.push(p)
    }
    p.active = true
    p.x = t.x
    p.y = t.y - 6
    p.tx = target.x
    p.ty = target.y
    p.targetId = target.id
    p.speed = PROJECTILE_SPEED
    p.splash = splash
    p.atk = this.towerAttack(t)
    p.synergy = t.def.synergyDamage
    p.sourceKind = t.kind
    p.color = t.def.color
    // Phoenix payload: the seeking bolt sets its target ablaze on impact.
    p.burnDps = (s.burnDps ?? 0) * this.upgrades.burnDmgMult
    p.burnDur = s.burnDuration ?? 0
    this.emit({ t: 'towerFire', x: t.x, y: t.y, tx: target.x, ty: target.y, color: t.def.color, kind: t.kind })
  }

  private frostZap(t: SimTower, range: number): void {
    this.emit({ t: 'aoe', x: t.x, y: t.y, radius: range, color: t.def.color, alpha: 0.5 })
    const r2 = range * range
    const atk = this.towerAttack(t)
    for (const e of this.enemies) {
      if (!this.canTarget(t, e)) continue
      if (dist2(t.x, t.y, e.x, e.y) <= r2) this.dealDamage(e, atk, t)
    }
  }

  private flameBurst(t: SimTower, target: SimEnemy): void {
    const s = this.stats(t)
    const splash = (s.splash ?? 1) * TILE * (1 + this.upgrades.splashBonus)
    this.emit({ t: 'aoe', x: target.x, y: target.y, radius: splash, color: 0xff8a3c, alpha: 0.6 })
    const r2 = splash * splash
    const atk = this.towerAttack(t)
    const burnDps = (s.burnDps ?? 8) * this.upgrades.burnDmgMult
    const burnDur = s.burnDuration ?? 2
    for (const e of this.enemies) {
      if (!this.canTarget(t, e)) continue
      if (dist2(target.x, target.y, e.x, e.y) > r2) continue
      this.dealDamage(e, atk, t)
      if (e.active) {
        e.burnUntil = this.clock + burnDur
        e.burnDps = Math.max(e.burnDps, burnDps)
      }
    }
    // Scorch branch: the impact leaves burning ground — area denial you can SEE.
    const zoneDps = s.zoneDps ?? 0
    if (zoneDps > 0) {
      this.spawnZone(target.x, target.y, (s.zoneRadius ?? 1.2) * TILE, zoneDps * this.upgrades.burnDmgMult, s.zoneDuration ?? 3, 0xff7a30)
    }
  }

  // ---- burning ground (Scorch) ---------------------------------------------
  // Zones near an existing one MERGE into it (refresh + grow) so a fast-firing
  // Scorch tower reads as one persistent burning patch, not confetti.
  private spawnZone(x: number, y: number, radius: number, dps: number, duration: number, color: number): void {
    const mergeR2 = (TILE * 0.6) * (TILE * 0.6)
    for (const z of this.zones) {
      if (!z.active) continue
      if (dist2(z.x, z.y, x, y) <= mergeR2) {
        z.until = Math.max(z.until, this.clock + duration)
        z.dps = Math.max(z.dps, dps)
        z.radius = Math.max(z.radius, radius)
        return
      }
    }
    let z: SimZone | null = null
    for (const cand of this.zones) if (!cand.active) { z = cand; break }
    if (!z && this.zones.length >= MAX_ZONES) {
      // pool full → recycle the zone closest to expiring
      z = this.zones[0]
      for (const cand of this.zones) if (cand.until < z.until) z = cand
    }
    if (!z) {
      z = { id: 0, active: false, x: 0, y: 0, radius: 1, dps: 0, until: 0, color }
      this.zones.push(z)
    }
    z.id = this.nextId++
    z.active = true
    z.x = x
    z.y = y
    z.radius = Math.max(8, radius)
    z.dps = Math.max(0, dps)
    z.until = this.clock + Math.max(0.1, duration)
    z.color = color
    this.emit({ t: 'aoe', x, y, radius: z.radius, color, alpha: 0.5 })
  }

  private updateZones(dt: number): void {
    for (const z of this.zones) {
      if (!z.active) continue
      if (this.clock >= z.until) { z.active = false; continue }
      const r2 = z.radius * z.radius
      for (const e of this.enemies) {
        if (!e.active || e.def.isAir) continue // ground fire can't reach flyers
        if (dist2(z.x, z.y, e.x, e.y) > r2) continue
        // standing in fire counts as afflicted (combo hook + burning visual)
        e.burnUntil = Math.max(e.burnUntil, this.clock + 0.2)
        this.applyRaw(e, z.dps * dt, false)
      }
    }
  }

  // Storm: bounce a bolt across nearby enemies. Build the FULL chain first, then
  // apply damage — never touch an enemy a kill may pool-free mid-loop.
  private stormBolt(t: SimTower, first: SimEnemy): void {
    const s = this.stats(t)
    let chainCount = (s.chainCount ?? 0) + this.upgrades.stormChainBonus
    const chainRange = (s.chainRange ?? 2) * TILE
    const falloff = clamp(s.chainFalloff ?? 0.85, 0.1, 1)
    const supercharged = first.slowUntil > this.clock && chainCount > 0
    if (supercharged) {
      chainCount += 2
      this.emit({ t: 'text', x: first.x, y: first.y - first.def.radius - 34, msg: 'SUPERCHARGED!', color: 0xffe14a, size: 24 })
    }
    const chain: SimEnemy[] = [first]
    const used = new Set<number>([first.id])
    let cursor = first
    const r2 = chainRange * chainRange
    while (chain.length <= chainCount) {
      let bestNode: SimEnemy | null = null
      let bestD = Infinity
      for (const e of this.enemies) {
        if (!e.active || e.hp <= 0 || used.has(e.id)) continue
        if (e.def.isAir && !t.def.antiAir) continue
        const d2 = dist2(cursor.x, cursor.y, e.x, e.y)
        if (d2 <= r2 && d2 < bestD) { bestD = d2; bestNode = e }
      }
      if (!bestNode) break
      chain.push(bestNode)
      used.add(bestNode.id)
      cursor = bestNode
    }
    const points: Array<[number, number]> = [[t.x, t.y]]
    for (const e of chain) points.push([e.x, e.y])
    this.emit({ t: 'chain', points, color: t.def.color, count: chain.length, supercharged })
    let dmg = this.effDamage(t)
    for (const e of chain) {
      if (!e.active) continue
      this.dealDamage(e, this.towerAttack(t, dmg), t)
      dmg *= falloff
    }
  }

  private arcaneZap(t: SimTower, target: SimEnemy): void {
    this.emit({ t: 'towerFire', x: t.x, y: t.y, tx: target.x, ty: target.y, color: t.def.color, kind: t.kind })
    this.emit({ t: 'hit', x: target.x, y: target.y, color: t.def.color })
    this.dealDamage(target, this.towerAttack(t), t)
  }

  // ---- projectiles --------------------------------------------------------
  private updateProjectiles(dt: number): void {
    for (const p of this.projectiles) {
      if (!p.active) continue
      const target = p.targetId >= 0 ? this.enemyById(p.targetId) : null
      if (target && target.active) {
        p.tx = target.x
        p.ty = target.y
      }
      const step = p.speed * dt
      const d = distance(p.x, p.y, p.tx, p.ty)
      if (d <= step + 6) {
        this.emit({ t: 'hit', x: p.tx, y: p.ty, color: p.color })
        if (p.splash > 0) {
          this.emit({ t: 'aoe', x: p.tx, y: p.ty, radius: p.splash, color: p.color, alpha: 0.6 })
          const r2 = p.splash * p.splash
          for (const e of this.enemies) {
            if (!e.active || e.hp <= 0) continue
            if (e.def.isAir && !TOWERS[p.sourceKind].antiAir) continue
            if (dist2(p.tx, p.ty, e.x, e.y) <= r2) this.dealDamageProjectile(e, p)
          }
        } else if (target && target.active) {
          this.dealDamageProjectile(target, p)
        }
        p.active = false
      } else {
        const ang = Math.atan2(p.ty - p.y, p.tx - p.x)
        p.x += Math.cos(ang) * step
        p.y += Math.sin(ang) * step
      }
    }
  }

  private enemyById(id: number): SimEnemy | null {
    for (const e of this.enemies) if (e.active && e.id === id) return e
    return null
  }

  private dealDamageProjectile(e: SimEnemy, p: SimProjectile): void {
    this.dealDamageWith(e, p.atk, p.synergy, p.x, p.y)
    if (p.burnDps > 0 && e.active) {
      e.burnUntil = this.clock + Math.max(0.1, p.burnDur)
      e.burnDps = Math.max(e.burnDps, p.burnDps)
    }
  }

  // ---- damage pipeline (grid × wheel × combo × shield) --------------------
  private dealDamage(e: SimEnemy, atk: AttackStats, source: SimTower): void {
    this.dealDamageWith(e, atk, source.def.synergyDamage, e.x, e.y)
  }

  private dealDamageWith(e: SimEnemy, atk: AttackStats, synergyTower: boolean, _sx: number, _sy: number): void {
    if (!e.active || e.hp <= 0) return
    const def = e.def
    const effArmorPen = atk.armorPen
    const tear = e.tearUntil > this.clock ? e.tearAmount : 0
    const defStats = { armor: def.armor, flatArmor: Math.max(0, def.flatArmor - tear), affinity: def.affinity }
    const mult = typeMultiplier(atk, defStats)
    let dmg = computeHit(atk, defStats)

    // combo: a synergy tower striking an AFFLICTED enemy ramps the combo meter.
    const afflicted = e.slowUntil > this.clock || e.burnUntil > this.clock || e.stunUntil > this.clock || e.poisonUntil > this.clock
    let comboN = 0
    if (synergyTower && afflicted) {
      const m = this.bumpCombo(e.x, e.y - e.def.radius - 10)
      dmg *= m
      comboN = this.comboCount
    }

    // AMPLIFY reaction mark: the target takes bonus damage while marked.
    if (e.amplifyUntil > this.clock) dmg *= AMPLIFY_TAKEN

    // shield absorption (breaks → not an immunity)
    if (e.shield > 0) {
      const block = def.shieldBlock ?? 0.6
      const absorbed = Math.min(e.shield, dmg * block)
      e.shield = Math.max(0, e.shield - absorbed)
      dmg = Math.max(0, dmg - absorbed)
      if (e.shield <= 0) {
        this.emit({ t: 'shieldBreak', x: e.x, y: e.y - e.def.radius - 30, radius: e.def.radius + 10 })
      }
    }

    const eff: Effectiveness = classify(mult)
    this.emit({ t: 'damage', x: e.x, y: e.y - e.def.radius - 6, amount: dmg, eff, combo: comboN })
    e.hitFlash = 0.09
    this.applyRaw(e, dmg, true)

    // elemental reactions: paint the aura / detonate a pair (survivors only)
    if (e.active && atk.aura) this.applyAura(e, atk.aura, dmg)
  }

  // ======================================================================
  //  ELEMENTAL REACTIONS — two different elements on one enemy inside the
  //  window detonate a named reaction. Deterministic: no RNG anywhere here.
  // ======================================================================
  private applyAura(e: SimEnemy, aura: AuraElement, triggerDmg: number): void {
    if (this.clock < e.reactLockUntil) return // paced: no tags during the lock
    const hasAura = e.auraElem !== '' && e.auraUntil > this.clock
    if (hasAura && e.auraElem !== aura) {
      const def = reactionFor(e.auraElem as AuraElement, aura)
      if (def) {
        e.auraElem = ''
        e.auraUntil = 0
        e.reactLockUntil = this.clock + REACT_LOCK
        this.triggerReaction(e, def, clamp(triggerDmg, 0, 1e6))
        return
      }
    }
    // no reaction for this pair (or same element) → set/refresh the tag
    e.auraElem = aura
    e.auraUntil = this.clock + AURA_WINDOW
  }

  // burst damage from a reaction: ignores armor (it's a detonation, not an attack)
  private reactionBurst(e: SimEnemy, amount: number): void {
    if (!e.active) return
    const dmg = clamp(amount, 0, 1e7)
    if (dmg <= 0) return
    this.emit({ t: 'damage', x: e.x, y: e.y - e.def.radius - 6, amount: dmg, eff: 'strong', combo: 0 })
    e.hitFlash = 0.09
    this.applyRaw(e, dmg, false)
  }

  private triggerReaction(e: SimEnemy, def: ReactionDef, trigger: number): void {
    this.runStats.reactions++
    this.runStats.reactionCounts[def.name] = (this.runStats.reactionCounts[def.name] ?? 0) + 1
    const cx = e.x
    const cy = e.y
    let radius = 0

    if (def.key === 'thermal') {
      // THERMAL SHOCK: armor break — strips flat armor for a while + a burst
      e.tearUntil = Math.max(e.tearUntil, this.clock + 5)
      e.tearAmount = Math.max(e.tearAmount, 8)
      this.reactionBurst(e, trigger * 0.8)
    } else if (def.key === 'shatter') {
      // SHATTER: big burst, doubled against armored targets
      const armored = e.def.flatArmor > 0 || e.def.armor === 'Heavy' || e.def.armor === 'Fortified'
      this.reactionBurst(e, trigger * 1.3 * (armored ? 2 : 1))
    } else if (def.key === 'flashover') {
      // FLASHOVER: explosion around the target
      radius = TILE * 1.6
      const r2 = radius * radius
      for (const o of this.enemies) {
        if (!o.active || o.hp <= 0) continue
        if (dist2(cx, cy, o.x, o.y) > r2) continue
        this.reactionBurst(o, trigger * 0.9)
      }
    } else if (def.key === 'wildfire') {
      // WILDFIRE: the burn leaps to everything nearby
      radius = TILE * 2
      const r2 = radius * radius
      const dps = clamp(12 + trigger * 0.35, 0, 400)
      for (const o of this.enemies) {
        if (!o.active || o.hp <= 0) continue
        if (dist2(cx, cy, o.x, o.y) > r2) continue
        o.burnUntil = Math.max(o.burnUntil, this.clock + 3)
        o.burnDps = Math.max(o.burnDps, dps)
      }
    } else if (def.key === 'overgrow') {
      // OVERGROW: roots erupt — heavy area slow
      radius = TILE * 1.8
      const r2 = radius * radius
      for (const o of this.enemies) {
        if (!o.active || o.hp <= 0) continue
        if (dist2(cx, cy, o.x, o.y) > r2) continue
        o.slowUntil = Math.max(o.slowUntil, this.clock + 2.5)
        o.slowFactor = Math.min(o.slowFactor, 0.3)
      }
    } else if (def.key === 'eclipse') {
      // ECLIPSE: a blink of darkness — brief area stun
      radius = TILE * 1.5
      const r2 = radius * radius
      for (const o of this.enemies) {
        if (!o.active || o.hp <= 0) continue
        if (dist2(cx, cy, o.x, o.y) > r2) continue
        o.stunUntil = Math.max(o.stunUntil, this.clock + 0.85)
      }
    } else if (def.key === 'conduct') {
      // CONDUCT: the charge arcs outward — a bonus chain off the target
      radius = TILE * 2.5
      const r2 = radius * radius
      const chain: SimEnemy[] = []
      let cursor: SimEnemy = e
      const used = new Set<number>([e.id])
      while (chain.length < 4) {
        let best: SimEnemy | null = null
        let bd = Infinity
        for (const o of this.enemies) {
          if (!o.active || o.hp <= 0 || used.has(o.id)) continue
          const d2 = dist2(cursor.x, cursor.y, o.x, o.y)
          if (d2 <= r2 && d2 < bd) { bd = d2; best = o }
        }
        if (!best) break
        chain.push(best)
        used.add(best.id)
        cursor = best
      }
      if (chain.length) {
        const points: Array<[number, number]> = [[e.x, e.y]]
        for (const o of chain) points.push([o.x, o.y])
        this.emit({ t: 'chain', points, color: def.color, count: chain.length, supercharged: false })
        let dmg = trigger * 0.75
        for (const o of chain) {
          this.reactionBurst(o, dmg)
          dmg *= 0.85
        }
      }
    } else if (def.key === 'blight') {
      // BLIGHT: corrupted spores — poison DoT area
      radius = TILE * 1.6
      const r2 = radius * radius
      const dps = clamp(10 + trigger * 0.3, 0, 300)
      for (const o of this.enemies) {
        if (!o.active || o.hp <= 0) continue
        if (dist2(cx, cy, o.x, o.y) > r2) continue
        o.poisonUntil = Math.max(o.poisonUntil, this.clock + 4)
        o.poisonDps = Math.max(o.poisonDps, dps)
      }
    } else {
      // AMPLIFY: mark the target — it takes bonus damage from everything
      e.amplifyUntil = this.clock + AMPLIFY_DURATION
      this.reactionBurst(e, trigger * 0.4)
    }

    this.emit({ t: 'reaction', key: def.key, name: def.name, x: cx, y: cy, radius, color: def.color, color2: def.color2 })
  }

  private applyRaw(e: SimEnemy, dmg: number, _tag: boolean): void {
    if (!e.active) return
    const d = Math.max(0, Number.isFinite(dmg) ? dmg : 0)
    e.hp = e.hp - d
    if (e.hp <= 0) {
      e.hp = 0
      this.killEnemy(e)
    }
  }

  private killEnemy(e: SimEnemy): void {
    if (!e.active) return
    e.active = false
    this.waveKills++ // every kill paints a little colour back (Greying restoration)
    this.runStats.kills++
    if (e.def.boss) this.runStats.bossKills++
    const reward = Math.max(0, Math.round(e.def.reward * this.config.mods.goldGainMult * this.upgrades.goldGainMult))
    this.addGold(reward)
    this.emit({ t: 'gold', x: e.x, y: e.y, amount: reward })
    this.emit({ t: 'death', x: e.x, y: e.y, kind: e.kind, color: e.def.color, boss: !!e.def.boss })
    // A Keeper is never slain — the grey breaks and the colour comes home.
    if (e.keeperId !== '') {
      const k = KEEPER_BY_ID[e.keeperId]
      if (k) this.emitKeeper('redeemed', e, k, TILE * 3)
    }
  }

  // ======================================================================
  //  HEROES — deployable characters. Deploy on a build tile (costs gold, once per
  //  party hero), auto-attack through the element wheel, and cast one spell.
  // ======================================================================
  heroDeployCost(heroId: string): number {
    const def = heroById(heroId)
    if (!def) return 0
    return Math.max(1, Math.round(def.deployCost * this.config.mods.towerCostMult * this.upgrades.towerCostMult))
  }

  canDeployHero(heroId: string): boolean {
    if (this.state === 'won' || this.state === 'lost' || this.state === 'draft') return false
    if (this.deployedHeroIds.has(heroId)) return false
    return this.partyDefs.some((p) => p.heroId === heroId)
  }

  deployHero(heroId: string, col: number, row: number): SimHero | null {
    if (!this.canDeployHero(heroId)) return null
    if (!this.canPlace(col, row)) return null
    const pd = this.partyDefs.find((p) => p.heroId === heroId)
    const def = heroById(heroId)
    if (!pd || !def) return null
    const cost = this.heroDeployCost(heroId)
    if (this.gold < cost) return null
    this.spendGold(cost)
    const cc = cellCenter(col, row)
    const stats = heroStats(def, pd.level)
    const spell = heroSpellScaled(def.spell, pd.level)
    const bond = pd.wyrm ? resolveBond(heroId, pd.wyrm.wyrmId, pd.wyrm.level) : null
    let h: SimHero | null = null
    for (const cand of this.heroes) if (!cand.active) { h = cand; h.id = this.nextId++; break }
    if (!h) {
      h = {
        id: this.nextId++, active: false, heroId, def, role: def.role, level: pd.level, col, row, x: cc.x, y: cc.y,
        cd: 0, aimAngle: 0, fireFlash: 0, baseDamage: 0, baseRange: 0, attackCd: 1, buffDamage: 0, slowFactor: 1,
        slowDuration: 0, adjBuff: 1, buffMult: 1, buffUntil: 0, spell, spellCd: 0, spellMaxCd: 1,
        greyUntil: 0, sigAwake: false, sigCounter: 0, sigRamp: 0, sigGuardUsed: false,
        wyrm: null, wyrmBreathCd: 0, wyrmUltUsed: false,
      }
      this.heroes.push(h)
    }
    h.active = true
    h.heroId = heroId
    h.def = def
    h.role = def.role
    h.level = pd.level
    h.col = col
    h.row = row
    h.x = cc.x
    h.y = cc.y
    h.cd = 0
    h.aimAngle = 0
    h.fireFlash = 0
    h.baseDamage = stats.damage
    h.baseRange = stats.range
    h.attackCd = stats.cooldown
    h.buffDamage = stats.buffDamage
    h.slowFactor = stats.slowFactor
    h.slowDuration = stats.slowDuration
    h.adjBuff = 1
    h.buffMult = 1
    h.buffUntil = 0
    h.spell = spell
    h.spellCd = 0
    h.spellMaxCd = clamp(spell.cooldown * this.config.mods.spellCooldownMult, 0.5, 60)
    h.greyUntil = 0
    h.sigAwake = signatureAwake(pd.level)
    h.sigCounter = 0
    h.sigRamp = 0
    h.sigGuardUsed = false
    // reset the Wyrm bond (pooled slots must never carry a prior hero's companion)
    h.wyrm = bond
    h.wyrmBreathCd = bond ? bond.breathCd * 0.5 : 0 // first breath comes fast
    h.wyrmUltUsed = false
    this.occupiedHero[row][col] = h
    this.deployedHeroIds.add(heroId)
    this.recomputeSynergies()
    this.recomputeBuffs()
    this.recomputeResonances()
    this.emit({ t: 'heroDeploy', x: cc.x, y: cc.y, color: def.color, radius: this.heroRange(h) })
    this.emit({ t: 'text', x: cc.x, y: cc.y - 44, msg: def.name.toUpperCase() + '!', color: def.color, size: 26 })
    if (h.sigAwake) this.emit({ t: 'text', x: cc.x, y: cc.y - 70, msg: `✦ ${def.signature.name}`, color: def.color, size: 15 })
    if (bond) {
      this.emit({ t: 'text', x: cc.x, y: cc.y - 96, msg: `${bond.wyrm.emoji} ${bond.wyrm.name} · ${bond.tierLabel}`, color: bond.wyrm.color, size: 15 })
      this.emit({ t: 'banner', msg: `${bond.wyrm.emoji} ${bond.wyrm.name.toUpperCase()} TAKES FLIGHT — ${bond.tier.toUpperCase()} BOND`, color: bond.wyrm.color })
    }
    return h
  }

  // ---- ELEMENT RESONANCE (hero + 2/4+ same-kind towers) --------------------
  // Deterministic: pure function of live towers + fielded awakened heroes.
  private recomputeResonances(): void {
    const counts: Partial<Record<TowerKind, number>> = {}
    for (const t of this.towers) if (t.active) counts[t.kind] = (counts[t.kind] ?? 0) + 1
    const fielded: Array<{ heroId: string; awake: boolean }> = []
    for (const h of this.heroes) if (h.active) fielded.push({ heroId: h.heroId, awake: h.sigAwake })
    this.resonances = computeResonances(fielded, counts)
    this.resTowerMult.clear()
    this.resHeroMult.clear()
    for (const r of this.resonances) {
      this.resTowerMult.set(r.towerKind, Math.max(this.resTowerMult.get(r.towerKind) ?? 1, r.towerMult))
      for (const id of r.heroIds) this.resHeroMult.set(id, Math.max(this.resHeroMult.get(id) ?? 1, r.heroMult))
    }
    // celebrate each newly-reached resonance tier once
    for (const r of this.resonances) {
      if (this.resSeen.has(r.id)) continue
      this.resSeen.add(r.id)
      this.emit({ t: 'banner', msg: `🔗 ${r.name.toUpperCase()}!`, color: r.color })
      for (const h of this.heroes) {
        if (h.active && r.heroIds.includes(h.heroId)) {
          this.emit({ t: 'text', x: h.x, y: h.y - 46, msg: 'RESONANCE!', color: r.color, size: 22 })
        }
      }
    }
  }
  activeResonances(): ResonanceBonus[] {
    return this.resonances
  }

  // Live element-synergy recompute from the currently-fielded heroes.
  recomputeSynergies(): void {
    const elements: Element[] = []
    for (const h of this.heroes) if (h.active) elements.push(h.def.element)
    const { bonuses, effects } = computeSynergies(elements)
    this.synergyBonuses = bonuses
    this.synergyEffects = effects
  }
  activeSynergies(): SynergyBonus[] {
    return this.synergyBonuses
  }

  // effective hero stats (base × adjacency × synergy × temp buff × run mods)
  heroDamage(h: SimHero): number {
    const syn = this.synergyEffects
    const elem = syn.elementDmg[h.def.element] ?? 1
    const buff = h.buffUntil > this.clock ? h.buffMult : 1
    const res = this.resHeroMult.get(h.heroId) ?? 1
    // Wyrm aura AMPLIFIES the bonded hero (stronger the tighter the bond).
    const wyrmAmp = h.wyrm ? h.wyrm.heroAmp : 1
    const dmg = h.baseDamage * h.adjBuff * elem * syn.allDmgMult * syn.allStatMult * buff * res * wyrmAmp * this.config.mods.towerDamageMult
    return clamp(dmg, 0, 1e7)
  }
  heroRange(h: SimHero): number {
    return clamp(h.baseRange * TILE * this.synergyEffects.allStatMult * this.config.mods.rangeMult, TILE * 0.5, TILE * 12)
  }
  heroCooldown(h: SimHero): number {
    const syn = this.synergyEffects
    return clamp((h.attackCd * syn.atkSpeedMult) / Math.max(0.5, syn.allStatMult), 0.05, 10)
  }
  heroDps(h: SimHero): number {
    return clamp(this.heroDamage(h) / Math.max(0.05, this.heroCooldown(h)), 0, 1e7)
  }

  // loadout view for the HUD (party order, deploy state + cost)
  partyLoadout(): Array<{ heroId: string; def: HeroDef; level: number; deployed: boolean; cost: number; wyrm: BondResolution | null }> {
    const out: Array<{ heroId: string; def: HeroDef; level: number; deployed: boolean; cost: number; wyrm: BondResolution | null }> = []
    for (const p of this.partyDefs) {
      const def = heroById(p.heroId)
      if (!def) continue
      const wyrm = p.wyrm ? resolveBond(p.heroId, p.wyrm.wyrmId, p.wyrm.level) : null
      out.push({ heroId: p.heroId, def, level: p.level, deployed: this.deployedHeroIds.has(p.heroId), cost: this.heroDeployCost(p.heroId), wyrm })
    }
    return out
  }
  deployedHeroes(): SimHero[] {
    const out: SimHero[] = []
    for (const h of this.heroes) if (h.active) out.push(h)
    return out
  }
  heroBySlot(id: number): SimHero | null {
    for (const h of this.heroes) if (h.active && h.id === id) return h
    return null
  }

  private updateHeroes(dt: number): void {
    for (const h of this.heroes) {
      if (!h.active) continue
      if (h.fireFlash > 0) h.fireFlash = Math.max(0, h.fireFlash - dt)
      if (h.spellCd > 0) h.spellCd = Math.max(0, h.spellCd - dt)
      if (h.greyUntil > this.clock) continue // borrowed by the Moth Mirror: no attacks
      // the bonded Wyrm circles the hero and breathes on its own cadence (only
      // while the hero is present + not borrowed) — runs before the attack gate.
      if (h.wyrm) this.updateWyrm(h, dt)
      h.cd -= dt
      if (h.cd > 0) continue
      const range = this.heroRange(h)
      const target = this.acquireForHero(h, range)
      if (!target) continue
      h.cd = this.heroCooldown(h)
      h.aimAngle = angleBetween(h.x, h.y, target.x, target.y)
      h.fireFlash = 0.12
      this.heroAttack(h, target)
    }
  }

  // heroes always fire at the FIRST enemy in range, and CAN hit air (they are mages).
  private acquireForHero(h: SimHero, range: number): SimEnemy | null {
    const r2 = range * range
    let best: SimEnemy | null = null
    let bestScore = -Infinity
    for (const e of this.enemies) {
      if (!e.active || e.hp <= 0) continue
      const d2 = dist2(h.x, h.y, e.x, e.y)
      if (d2 > r2) continue
      if (e.dist > bestScore) { bestScore = e.dist; best = e }
    }
    return best
  }

  private heroAttack(h: SimHero, target: SimEnemy): void {
    this.emit({ t: 'heroFire', x: h.x, y: h.y - 6, tx: target.x, ty: target.y, color: h.def.color })
    this.emit({ t: 'hit', x: target.x, y: target.y, color: h.def.color })
    const sig = h.def.signature
    let dmg = this.heroDamage(h)
    const tx = target.x
    const ty = target.y

    // SIGNATURE pre-hit hooks (rhythm counters + conditionals — never RNG)
    let foreseen = false
    let nova = false
    let wager = false
    if (h.sigAwake) {
      if (sig.kind === 'cindernova' || sig.kind === 'foreseen' || sig.kind === 'wager') {
        h.sigCounter++
        if (h.sigCounter >= (sig.every ?? 4)) {
          h.sigCounter = 0
          if (sig.kind === 'cindernova') nova = true
          else if (sig.kind === 'foreseen') foreseen = true
          else wager = true
        }
      } else if (sig.kind === 'overload') {
        // The One Percent: exploit stasis — bonus vs slowed/stunned, extend the slow
        if (target.slowUntil > this.clock || target.stunUntil > this.clock) {
          dmg *= sig.mult ?? 1.5
          if (target.slowUntil > this.clock) target.slowUntil += sig.slowExtend ?? 0.5
          this.emit({ t: 'text', x: tx, y: ty - target.def.radius - 26, msg: 'OVERLOAD!', color: h.def.color, size: 15 })
        }
      }
    }
    if (foreseen) {
      dmg *= sig.mult ?? 2
      this.emit({ t: 'text', x: tx, y: ty - target.def.radius - 28, msg: '👁 FORESEEN', color: h.def.color, size: 16 })
    }

    const atk: AttackStats = { damage: dmg, dmgType: h.def.damageType, element: h.def.element, armorPen: this.upgrades.armorPenBonus, aura: h.def.element }
    // heroes are synergy sources — striking an afflicted enemy ramps the combo meter
    this.dealDamageWith(target, atk, true, tx, ty)

    // SIGNATURE post-hit payoffs
    if (foreseen && target.active) {
      target.stunUntil = Math.max(target.stunUntil, this.clock + (sig.stun ?? 0.7))
    }
    if (nova) this.heroNova(h, tx, ty, dmg)
    if (wager) this.heroSquall(h, tx, ty, dmg)
    if (h.sigAwake && sig.kind === 'twinspark' && target.active) {
      // Two of Us: the twin's echo strike (paints the element again → reactions)
      const echo: AttackStats = { ...atk, damage: dmg * (sig.echo ?? 0.5) }
      this.emit({ t: 'heroFire', x: h.x, y: h.y - 12, tx: target.x, ty: target.y, color: h.def.accent })
      this.dealDamageWith(target, echo, true, tx, ty)
    }
    if (h.sigAwake && sig.kind === 'tithe' && !target.active) {
      // Their Loss: pickpocket the kill for bonus gold
      const bonus = Math.max(1, Math.round(target.def.reward * (sig.goldFrac ?? 0.4) * this.config.mods.goldGainMult * this.upgrades.goldGainMult))
      this.addGold(bonus)
      this.emit({ t: 'gold', x: tx, y: ty - 14, amount: bonus })
      h.sigCounter++
      if (h.sigCounter % 4 === 1) this.emit({ t: 'text', x: tx, y: ty - 34, msg: `PILFERED +${bonus}`, color: h.def.color, size: 15 })
    }

    if (h.role === 'Control' && target.active && h.slowFactor < 1) {
      target.slowUntil = Math.max(target.slowUntil, this.clock + h.slowDuration)
      target.slowFactor = Math.min(target.slowFactor, h.slowFactor)
    }
  }

  // Stay Lit: the 4th strike detonates — the target already took the full foreseen
  // hit via dealDamageWith; the nova splashes everything AROUND it (burn included).
  private heroNova(h: SimHero, cx: number, cy: number, baseDmg: number): void {
    const sig = h.def.signature
    const radius = (sig.radius ?? 1.4) * TILE
    const burst = baseDmg * (sig.mult ?? 1.5)
    const burnDps = clamp(baseDmg * 0.5, 0, 1e6)
    const r2 = radius * radius
    this.emit({ t: 'aoe', x: cx, y: cy, radius, color: h.def.color, alpha: 0.6 })
    this.emit({ t: 'text', x: cx, y: cy - 30, msg: '💥 CINDERNOVA', color: h.def.color, size: 16 })
    for (const e of this.enemies) {
      if (!e.active || e.hp <= 0) continue
      if (dist2(cx, cy, e.x, e.y) > r2) continue
      this.applyDirect(e, burst)
      if (e.active) {
        e.burnUntil = Math.max(e.burnUntil, this.clock + 2.5)
        e.burnDps = Math.max(e.burnDps, burnDps)
      }
    }
  }

  // Wager's On: the 6th strike pays out — a squall arcs from the target through
  // the pack. Builds the FULL chain first (never touch pool-freed enemies mid-loop).
  private heroSquall(h: SimHero, cx: number, cy: number, baseDmg: number): void {
    const sig = h.def.signature
    const maxArcs = sig.chainCount ?? 4
    const falloff = clamp(sig.chainFalloff ?? 0.85, 0.1, 1)
    const arcRange = 2.6 * TILE
    const r2 = arcRange * arcRange
    const chain: SimEnemy[] = []
    const used = new Set<number>()
    let curX = cx
    let curY = cy
    while (chain.length < maxArcs) {
      let best: SimEnemy | null = null
      let bd = Infinity
      for (const e of this.enemies) {
        if (!e.active || e.hp <= 0 || used.has(e.id)) continue
        const d2 = dist2(curX, curY, e.x, e.y)
        if (d2 <= r2 && d2 < bd) { bd = d2; best = e }
      }
      if (!best) break
      chain.push(best)
      used.add(best.id)
      curX = best.x
      curY = best.y
    }
    if (chain.length === 0) return
    const points: Array<[number, number]> = [[h.x, h.y]]
    for (const e of chain) points.push([e.x, e.y])
    this.emit({ t: 'chain', points, color: h.def.color, count: chain.length, supercharged: false })
    this.emit({ t: 'text', x: cx, y: cy - 32, msg: '🎲 WAGER PAYS!', color: h.def.color, size: 16 })
    let dmg = baseDmg * (sig.mult ?? 0.7)
    for (const e of chain) {
      if (!e.active) continue
      this.applyDirect(e, dmg)
      dmg *= falloff
    }
  }

  // ---- CHROMATIC WYRM companion ------------------------------------------
  // The bonded Wyrm breathes its element in a burst around the hero on a fixed
  // cadence. Deterministic (clock-paced, no RNG). CRITICAL: each hit routes
  // through dealDamageWith so the breath PAINTS the element aura and detonates
  // reactions — fire breath shatters frozen/primed enemies, etc. (req 1a).
  private updateWyrm(h: SimHero, dt: number): void {
    const b = h.wyrm
    if (!b) return
    if (h.wyrmBreathCd > 0) { h.wyrmBreathCd = Math.max(0, h.wyrmBreathCd - dt); return }
    // Only breathe when there's something to breathe at (near the hero). If not,
    // idle a short beat and re-check — the cadence never runs away.
    const isUlt = b.ult != null && !h.wyrmUltUsed
    const radius = (isUlt && b.ult ? b.ult.radiusTiles : b.breathRadiusTiles) * TILE
    const r2 = radius * radius
    let any = false
    for (const e of this.enemies) {
      if (e.active && e.hp > 0 && dist2(h.x, h.y, e.x, e.y) <= r2) { any = true; break }
    }
    if (!any) { h.wyrmBreathCd = 0.25; return }
    this.wyrmBreath(h, b, isUlt, radius, r2)
    if (isUlt) h.wyrmUltUsed = true
    h.wyrmBreathCd = b.breathCd
  }

  private wyrmBreath(h: SimHero, b: BondResolution, isUlt: boolean, radius: number, r2: number): void {
    const cx = h.x
    const cy = h.y
    const element = b.wyrm.element
    const dmg = clamp(b.breathDamage * (isUlt && b.ult ? b.ult.damageMult : 1) * this.config.mods.towerDamageMult, 0, 1e7)
    const name = isUlt && b.ult ? b.ult.name : b.wyrm.breathName
    this.emit({ t: 'wyrmBreath', wyrmId: b.wyrm.id, element, x: cx, y: cy, radius, color: b.wyrm.color, ult: isUlt, name })
    if (isUlt) this.emit({ t: 'banner', msg: `★ ${name.toUpperCase()}!`, color: b.wyrm.color })
    else this.emit({ t: 'text', x: cx, y: cy - 30, msg: `${b.wyrm.emoji} ${name}`, color: b.wyrm.color, size: 14 })
    for (const e of this.enemies) {
      if (!e.active || e.hp <= 0) continue
      if (dist2(cx, cy, e.x, e.y) > r2) continue
      // aura === element → paints + detonates through the shared reaction path
      const atk: AttackStats = { damage: dmg, dmgType: 'Magic', element, armorPen: this.upgrades.armorPenBonus, aura: element }
      this.dealDamageWith(e, atk, true, cx, cy)
      if (e.active && b.status) this.applyBreathStatus(e, b, dmg, isUlt)
    }
  }

  // The element "bite" a GOOD/PERFECT breath adds (regular = pure damage+aura).
  private applyBreathStatus(e: SimEnemy, b: BondResolution, dmg: number, isUlt: boolean): void {
    const dur = isUlt ? 3.5 : 2
    switch (b.status) {
      case 'burn':
        e.burnUntil = Math.max(e.burnUntil, this.clock + dur)
        e.burnDps = Math.max(e.burnDps, clamp(dmg * 0.4, 0, 1e6))
        break
      case 'slow':
        e.slowUntil = Math.max(e.slowUntil, this.clock + dur)
        e.slowFactor = Math.min(e.slowFactor, isUlt ? 0.4 : 0.55)
        break
      case 'poison':
        e.poisonUntil = Math.max(e.poisonUntil, this.clock + dur + 1)
        e.poisonDps = Math.max(e.poisonDps, clamp(dmg * 0.3, 0, 1e6))
        break
      case 'stun':
        e.stunUntil = Math.max(e.stunUntil, this.clock + (isUlt ? 0.7 : 0.4))
        break
      case 'tear':
        e.tearUntil = Math.max(e.tearUntil, this.clock + 4)
        e.tearAmount = Math.max(e.tearAmount, isUlt ? 14 : 8)
        break
    }
  }

  private nearestEnemyTo(x: number, y: number): SimEnemy | null {
    let best: SimEnemy | null = null
    let bd = Infinity
    for (const e of this.enemies) {
      if (!e.active || e.hp <= 0) continue
      const d = dist2(x, y, e.x, e.y)
      if (d < bd) { bd = d; best = e }
    }
    return best
  }

  // Cast a deployed hero's signature spell. slotId is the SimHero.id.
  castHeroSpell(slotId: number, x: number, y: number): boolean {
    if (this.state === 'won' || this.state === 'lost' || this.state === 'draft') return false
    const h = this.heroBySlot(slotId)
    if (!h || h.spellCd > 0) return false
    if (h.greyUntil > this.clock) return false // borrowed by the Moth Mirror
    const sp = h.spell
    const power = this.config.mods.spellPowerMult
    const color = h.def.color
    h.spellCd = h.spellMaxCd
    const cx = sp.targeted ? x : h.x
    const cy = sp.targeted ? y : h.y

    if (sp.effect === 'aoeBurn') {
      const radius = (sp.radius ?? 2) * TILE
      const dmg = (sp.damage ?? 100) * power
      const r2 = radius * radius
      for (const e of this.enemies) {
        if (!e.active || e.hp <= 0) continue
        if (dist2(cx, cy, e.x, e.y) > r2) continue
        this.applyDirect(e, dmg)
        if (e.active) {
          e.burnUntil = this.clock + (sp.burnDuration ?? 2)
          e.burnDps = Math.max(e.burnDps, (sp.burnDps ?? 20) * power)
        }
      }
      this.emit({ t: 'heroSpell', effect: 'aoeBurn', name: sp.name, glyph: sp.glyph, x: cx, y: cy, radius, color, count: 0 })
    } else if (sp.effect === 'freeze') {
      const radius = (sp.radius ?? 2) * TILE
      const r2 = radius * radius
      const dur = sp.stunDuration ?? 1.5
      let n = 0
      for (const e of this.enemies) {
        if (!e.active || e.hp <= 0) continue
        if (dist2(cx, cy, e.x, e.y) > r2) continue
        e.stunUntil = Math.max(e.stunUntil, this.clock + dur)
        if (sp.slowFactor) {
          e.slowUntil = Math.max(e.slowUntil, this.clock + (sp.slowDuration ?? dur))
          e.slowFactor = Math.min(e.slowFactor, clamp(sp.slowFactor, 0.1, 1))
        }
        n++
      }
      this.emit({ t: 'heroSpell', effect: 'freeze', name: sp.name, glyph: sp.glyph, x: cx, y: cy, radius, color, count: n })
    } else if (sp.effect === 'chain') {
      const first = this.nearestEnemyTo(cx, cy)
      if (first) this.castHeroChain(h, first)
      else this.emit({ t: 'heroSpell', effect: 'chain', name: sp.name, glyph: sp.glyph, x: cx, y: cy, radius: 0, color, count: 0 })
    } else if (sp.effect === 'heal') {
      const heal = Math.max(0, Math.round(sp.heal ?? 0))
      if (heal > 0) this.lives = clamp(this.lives + heal, 0, this.startLives)
      const radius = (sp.radius ?? 2) * TILE
      const r2 = radius * radius
      for (const e of this.enemies) {
        if (!e.active || e.hp <= 0) continue
        if (dist2(cx, cy, e.x, e.y) > r2) continue
        if (sp.slowFactor) {
          e.slowUntil = Math.max(e.slowUntil, this.clock + (sp.slowDuration ?? 2))
          e.slowFactor = Math.min(e.slowFactor, clamp(sp.slowFactor, 0.1, 1))
        }
      }
      this.emit({ t: 'heroSpell', effect: 'heal', name: sp.name, glyph: sp.glyph, x: cx, y: cy, radius, color, count: heal })
      if (heal > 0) this.emit({ t: 'heal', x: cx, y: cy, amount: heal, radius })
    } else if (sp.effect === 'novaBuff') {
      const radius = (sp.radius ?? 2) * TILE
      const dmg = (sp.damage ?? 80) * power
      const r2 = radius * radius
      for (const e of this.enemies) {
        if (!e.active || e.hp <= 0) continue
        if (dist2(cx, cy, e.x, e.y) > r2) continue
        this.applyDirect(e, dmg)
      }
      const dur = sp.buffDuration ?? 5
      const mult = sp.buffMult ?? 1.4
      for (const o of this.heroes) {
        if (!o.active) continue
        o.buffMult = Math.max(o.buffMult, mult)
        o.buffUntil = this.clock + dur
      }
      this.emit({ t: 'heroSpell', effect: 'novaBuff', name: sp.name, glyph: sp.glyph, x: cx, y: cy, radius, color, count: 0 })
    } else {
      // execute
      const target = this.nearestEnemyTo(cx, cy)
      if (target) {
        let dmg = (sp.damage ?? 150) * power
        const thr = sp.executeThreshold ?? 0.3
        if (target.maxHp > 0 && target.hp / target.maxHp <= thr) dmg *= sp.executeMult ?? 2
        this.applyDirect(target, dmg)
        this.emit({ t: 'heroSpell', effect: 'execute', name: sp.name, glyph: sp.glyph, x: target.x, y: target.y, radius: 0, color, count: 0 })
      } else {
        this.emit({ t: 'heroSpell', effect: 'execute', name: sp.name, glyph: sp.glyph, x: cx, y: cy, radius: 0, color, count: 0 })
      }
    }
    return true
  }

  private castHeroChain(h: SimHero, first: SimEnemy): void {
    const sp = h.spell
    const chainCount = sp.chainCount ?? 5
    const chainRange = (sp.chainRange ?? 2.5) * TILE
    const falloff = clamp(sp.chainFalloff ?? 0.85, 0.1, 1)
    const chain: SimEnemy[] = [first]
    const used = new Set<number>([first.id])
    let cursor = first
    const r2 = chainRange * chainRange
    while (chain.length <= chainCount) {
      let bestNode: SimEnemy | null = null
      let bestD = Infinity
      for (const e of this.enemies) {
        if (!e.active || e.hp <= 0 || used.has(e.id)) continue
        const d2 = dist2(cursor.x, cursor.y, e.x, e.y)
        if (d2 <= r2 && d2 < bestD) { bestD = d2; bestNode = e }
      }
      if (!bestNode) break
      chain.push(bestNode)
      used.add(bestNode.id)
      cursor = bestNode
    }
    const points: Array<[number, number]> = [[h.x, h.y]]
    for (const e of chain) points.push([e.x, e.y])
    this.emit({ t: 'chain', points, color: h.def.color, count: chain.length, supercharged: false })
    let dmg = (sp.damage ?? 90) * this.config.mods.spellPowerMult
    for (const e of chain) {
      if (!e.active) continue
      this.applyDirect(e, dmg)
      dmg *= falloff
    }
    this.emit({ t: 'heroSpell', effect: 'chain', name: sp.name, glyph: sp.glyph, x: first.x, y: first.y, radius: 0, color: h.def.color, count: chain.length })
  }

  // ---- spells -------------------------------------------------------------
  castSpell(key: SpellKey, x: number, y: number): boolean {
    if (this.state === 'won' || this.state === 'lost') return false
    if (this.spellCd[key] > 0) return false
    const def = SPELLS[key]
    const power = this.config.mods.spellPowerMult
    this.spellCd[key] = this.spellMaxCd[key]
    if (key === 'meteor') {
      const radius = (def.radius ?? 2) * TILE
      const dmg = (def.damage ?? 120) * power
      const r2 = radius * radius
      for (const e of this.enemies) {
        if (!e.active || e.hp <= 0) continue
        if (dist2(x, y, e.x, e.y) > r2) continue
        this.applyDirect(e, dmg)
        if (e.active) {
          e.burnUntil = this.clock + (def.burnDuration ?? 2)
          e.burnDps = Math.max(e.burnDps, (def.burnDps ?? 20) * power)
        }
      }
      this.emit({ t: 'spell', key, x, y, radius, color: def.color, count: 0 })
    } else if (key === 'freeze') {
      const dur = def.stunDuration ?? 2
      let froze = 0
      for (const e of this.enemies) {
        if (!e.active || e.hp <= 0) continue
        e.stunUntil = Math.max(e.stunUntil, this.clock + dur)
        froze++
      }
      this.emit({ t: 'spell', key, x, y, radius: 0, color: def.color, count: froze })
    } else {
      const amt = Math.max(0, Math.round((def.gold ?? 100) * power))
      this.addGold(amt)
      this.emit({ t: 'gold', x, y, amount: amt })
      this.emit({ t: 'spell', key, x, y, radius: 0, color: def.color, count: amt })
    }
    return true
  }

  // direct spell damage: respects shield, ignores combo
  private applyDirect(e: SimEnemy, amount: number): void {
    if (!e.active) return
    let dmg = Math.max(0, Number.isFinite(amount) ? amount : 0)
    if (e.shield > 0) {
      const block = e.def.shieldBlock ?? 0.6
      const absorbed = Math.min(e.shield, dmg * block)
      e.shield = Math.max(0, e.shield - absorbed)
      dmg = Math.max(0, dmg - absorbed)
    }
    this.emit({ t: 'damage', x: e.x, y: e.y - e.def.radius - 6, amount: dmg, eff: 'neutral', combo: 0 })
    e.hitFlash = 0.09
    this.applyRaw(e, dmg, true)
  }

  private updateSpellCooldowns(dt: number): void {
    for (const k of SPELL_ORDER) {
      if (this.spellCd[k] > 0) this.spellCd[k] = Math.max(0, this.spellCd[k] - dt)
    }
  }

  // ---- economy / lives ----------------------------------------------------
  private addGold(n: number): void {
    if (n <= 0) return
    this.gold = clamp(this.gold + Math.round(n), 0, 1e9)
    this.runStats.goldEarned += Math.round(n)
  }

  // The prove-it score shown on share cards. Pure function of run stats so a
  // future replay-verifier recomputes the identical number from the same run.
  score(): number {
    const wavesCleared = this.state === 'won' && !this.config.endless
      ? this.config.level.waves.length
      : this.waveIndex
    const s = this.runStats.kills * 20 + this.runStats.reactions * 45 + this.runStats.maxCombo * 30
      + this.runStats.bossKills * 400 + this.runStats.fusions * 300 + wavesCleared * 250 + Math.max(0, this.lives) * 60
    return clamp(Math.round(s), 0, 1e9)
  }
  private spendGold(n: number): void {
    this.gold = clamp(this.gold - Math.round(n), 0, 1e9)
  }
  private loseLife(n: number): void {
    this.lives = clamp(this.lives - n, 0, this.startLives)
    if (this.lives <= 0 && this.state !== 'lost' && this.state !== 'won') {
      this.state = 'lost'
    }
  }

  // ---- effectiveness preview (approachability UI) -------------------------
  // Best type-multiplier this tower would get vs the given enemy kind.
  effectivenessVs(t: SimTower, kind: EnemyKind): { mult: number; eff: Effectiveness } {
    const def = ENEMIES[kind]
    const atk = this.towerAttack(t)
    const mult = typeMultiplier(atk, { armor: def.armor, flatArmor: def.flatArmor, affinity: def.affinity })
    return { mult, eff: classify(mult) }
  }

  // 1..5 power tier from single-target DPS (coarse, at-a-glance).
  powerTier(t: SimTower): number {
    const dps = this.effDps(t)
    if (dps >= 220) return 5
    if (dps >= 130) return 4
    if (dps >= 75) return 3
    if (dps >= 40) return 2
    return 1
  }

  // Dominant incoming armor + affinity for the pre-wave telegraph. When a
  // Corrupted Keeper walks in this wave, the telegraph says WHO by name.
  waveTelegraph(): { armor: string; element?: Element; boss: boolean; keeperName?: string } {
    const wave = this.currentWave()
    const counts = new Map<string, number>()
    let element: Element | undefined
    let boss = false
    let keeperName: string | undefined
    for (const entry of wave.entries) {
      const keeper = entry.kind === 'keeper' && entry.keeperId ? KEEPER_BY_ID[entry.keeperId] : undefined
      const def = keeper ? keeper.enemy : ENEMIES[entry.kind]
      counts.set(def.armor, (counts.get(def.armor) ?? 0) + entry.count)
      if (def.affinity) element = def.affinity
      if (def.boss) boss = true
      if (keeper && !keeperName) keeperName = entry.echo ? 'ECHOES OF THE FIVE' : keeper.name
    }
    let armor = 'Unarmored'
    let max = -1
    for (const [k, v] of counts) if (v > max) { max = v; armor = k }
    return { armor, element, boss, keeperName }
  }

  liveEnemyCount(): number {
    let n = 0
    for (const e of this.enemies) if (e.active) n++
    return n
  }
}

const EMPTY_EVENTS: SimEvent[] = []

// Grid adjacency within `reach` cells (default 1 = the classic 3×3 ring).
// The Amplify branch widens its buff network to reach 2.
function adjacentCell(a: { col: number; row: number }, b: { col: number; row: number }, reach = 1): boolean {
  return Math.abs(a.col - b.col) <= reach && Math.abs(a.row - b.row) <= reach
}
