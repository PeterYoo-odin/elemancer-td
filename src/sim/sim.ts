// ============================================================================
//  Elemancer TD — PURE, renderer-agnostic, deterministic simulation core.
//  ZERO Phaser imports. All game logic lives here; a view merely reads state and
//  forwards input. Fixed-timestep, one seeded PRNG, object pooling, defensive
//  math (never NaN/Infinity/negative-HP/overflow). Swap to Three.js later without
//  touching a line of this file.
// ============================================================================

import { ENEMIES, type EnemyDef, type EnemyKind } from '../game/enemies'
import { TOWERS, type TowerBranch, type TowerDef, type TowerKind, type TowerLevel } from '../game/towers'
import { serpentine, type LevelDef, type Wave } from '../game/levels'
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
import { DRAFT_POOL, neutralUpgrades, type DraftCard, type RunUpgrades } from './drafts'

// ---- tunables --------------------------------------------------------------
const COMBO_WINDOW = 2.2 // seconds a combo lingers before it breaks
const COMBO_STEP = 0.15 // per-synergy-hit multiplier growth
const COMBO_MAX = 6 // hard cap (also a simcheck range bound)
const DRAFT_EVERY = 3 // offer a draft after every N cleared waves
const PROJECTILE_SPEED = 760

export type SimState = 'prep' | 'active' | 'draft' | 'won' | 'lost'

export interface SimConfig {
  level: LevelDef
  mods: RunModifiers
  seed: number
  endless: boolean
  startGold: number
  startLives: number
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
  // transient view hints
  hitFlash: number
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
}

// Semantic events — the VIEW decides the juice (shake/flash/particles) from these.
export type SimEvent =
  | { t: 'damage'; x: number; y: number; amount: number; eff: Effectiveness; combo: number }
  | { t: 'death'; x: number; y: number; kind: EnemyKind; color: number; boss: boolean }
  | { t: 'shieldBreak'; x: number; y: number; radius: number }
  | { t: 'leak'; x: number; y: number; boss: boolean }
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
  | { t: 'banner'; msg: string; color: number }
  | { t: 'text'; x: number; y: number; msg: string; color: number; size: number }

interface SpawnItem {
  kind: EnemyKind
  hpMul: number
  at: number
}

export class Sim {
  readonly config: SimConfig
  readonly rng: RNG
  readonly seed: number

  // path / grid
  grid: string[][] = []
  private occupied: (SimTower | null)[][] = []
  private waypoints: { x: number; y: number }[] = []
  private segments: Array<{ ax: number; ay: number; bx: number; by: number; len: number }> = []
  pathLength = 0

  // pooled entities (iterate skipping .active === false; never per-frame alloc)
  enemies: SimEnemy[] = []
  towers: SimTower[] = []
  projectiles: SimProjectile[] = []

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

  // run-wide draft upgrades
  upgrades: RunUpgrades = neutralUpgrades()
  draftOffer: DraftCard[] = []
  draftsTaken = 0

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
    this.buildGrid()
    this.enterPrep()
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
    const pathCells = serpentine(this.config.level.lanes)
    this.grid = []
    this.occupied = []
    for (let r = 0; r < ROWS; r++) {
      const gr: string[] = []
      const orow: (SimTower | null)[] = []
      for (let c = 0; c < COLS; c++) {
        gr.push('blocked')
        orow.push(null)
      }
      this.grid.push(gr)
      this.occupied.push(orow)
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
    return this.grid[row][col] === 'build' && this.occupied[row][col] === null
  }

  towerAt(col: number, row: number): SimTower | null {
    if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return null
    return this.occupied[row][col]
  }

  // ---- fixed-timestep driver ---------------------------------------------
  // View passes already-scaled dt (realDt * gameSpeed, or 0 when paused). We
  // accumulate and step in fixed increments so behaviour is frame-rate independent.
  advance(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return
    this.accumulator += Math.min(dt, 0.25) // clamp catastrophic frames
    let steps = 0
    while (this.accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
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
    this.updateEnemies(dt)
    this.updateTowers(dt)
    this.updateProjectiles(dt)
    this.updateSpellCooldowns(dt)
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
    this.buildSpawnQueue()
    return bonus
  }

  private buildSpawnQueue(): void {
    this.spawnQueue = []
    const wave = this.currentWave()
    let t = this.clock + 0.4
    for (const entry of wave.entries) {
      for (let i = 0; i < entry.count; i++) {
        this.spawnQueue.push({ kind: entry.kind, hpMul: entry.hpMul, at: t })
        t += Math.max(0.02, entry.spacing)
      }
      t += 0.5
    }
  }

  private waveCleared(): void {
    const bonus = this.currentWave().clearBonus
    this.addGold(bonus)
    this.emit({ t: 'banner', msg: `WAVE CLEAR  +${bonus}`, color: 0x2ff7c3 })
    this.emit({ t: 'gold', x: 360, y: 250, amount: bonus })
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
  private spawnEnemy(kind: EnemyKind, hpMul: number): void {
    const def = ENEMIES[kind]
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
    e.hitFlash = 0
  }

  private freeEnemy(): SimEnemy {
    for (const e of this.enemies) if (!e.active) return e
    const e: SimEnemy = {
      id: 0, active: false, def: ENEMIES.runner, kind: 'runner', maxHp: 1, hp: 1, shield: 0, shieldMax: 0,
      dist: 0, x: 0, y: 0, slowUntil: 0, slowFactor: 1, stunUntil: 0, burnUntil: 0, burnDps: 0, burnTick: 0,
      poisonUntil: 0, poisonDps: 0, tearUntil: 0, tearAmount: 0, healTick: 0, hitFlash: 0,
    }
    this.enemies.push(e)
    e.id = this.nextId++
    return e
  }

  private updateEnemies(dt: number): void {
    if (this.state === 'active') {
      while (this.spawnQueue.length && this.spawnQueue[0].at <= this.clock) {
        const item = this.spawnQueue.shift()!
        this.spawnEnemy(item.kind, item.hpMul)
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

      // movement (stun overrides slow)
      const stunned = e.stunUntil > this.clock
      const slowed = e.slowUntil > this.clock
      if (!slowed) e.slowFactor = 1
      let speed = e.def.speed * TILE
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

  private enemyReachedBase(e: SimEnemy): void {
    e.active = false
    const base = this.waypointFor('base')
    this.loseLife(e.def.boss ? 5 : 1)
    this.emit({ t: 'leak', x: base.x, y: base.y, boss: !!e.def.boss })
  }

  // ---- towers -------------------------------------------------------------
  placeTower(kind: TowerKind, col: number, row: number): SimTower | null {
    if (!this.canPlace(col, row)) return null
    const cost = this.placeCost(kind)
    if (this.gold < cost) return null
    this.spendGold(cost)
    const def = TOWERS[kind]
    const cc = cellCenter(col, row)
    let t: SimTower | null = null
    for (const cand of this.towers) if (!cand.active) { t = cand; break }
    if (!t) {
      t = {
        id: this.nextId++, active: false, def, kind, level: 0, branch: -1, col, row,
        x: cc.x, y: cc.y, cd: 0, buffDmg: 1, buffRng: 1, aimAngle: 0, targeting: def.defaultTargeting, fireFlash: 0,
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
    this.occupied[row][col] = t
    this.recomputeBuffs()
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
    return clamp(this.stats(t).range * TILE * t.buffRng * this.config.mods.rangeMult, TILE * 0.5, TILE * 12)
  }
  effCooldown(t: SimTower): number {
    return clamp(this.stats(t).cooldown * this.config.mods.cooldownMult * this.upgrades.fireRateMult, 0.05, 10)
  }
  effDamage(t: SimTower): number {
    const s = this.stats(t)
    const elem = t.def.element ? this.upgrades.elementDmg[t.def.element] : 1
    const dmg = s.damage * t.buffDmg * this.config.mods.towerDamageMult * this.upgrades.allDmg * elem
    return clamp(dmg, 0, 1e7)
  }
  // DPS shown in the UI (splash/chain not counted, single-target baseline).
  effDps(t: SimTower): number {
    return clamp(this.effDamage(t) / Math.max(0.05, this.effCooldown(t)), 0, 1e7)
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
    }
  }

  private recomputeBuffs(): void {
    for (const t of this.towers) {
      if (!t.active) continue
      t.buffDmg = 1
      t.buffRng = 1
    }
    for (const a of this.towers) {
      if (!a.active || !a.def.support) continue
      const s = this.stats(a)
      const bd = s.buffDamage ?? 0
      const br = s.buffRange ?? 0
      for (const n of this.towers) {
        if (!n.active || n === a) continue
        if (Math.abs(n.col - a.col) <= 1 && Math.abs(n.row - a.row) <= 1) {
          n.buffDmg += bd
          n.buffRng += br
        }
      }
    }
  }

  // Support-buff adjacency, for the view to draw glow links.
  buffLinks(): Array<{ ax: number; ay: number; bx: number; by: number; color: number }> {
    const out: Array<{ ax: number; ay: number; bx: number; by: number; color: number }> = []
    for (const a of this.towers) {
      if (!a.active || !a.def.support) continue
      for (const n of this.towers) {
        if (!n.active || n === a) continue
        if (Math.abs(n.col - a.col) <= 1 && Math.abs(n.row - a.row) <= 1) {
          out.push({ ax: a.x, ay: a.y, bx: n.x, by: n.y, color: a.def.color })
        }
      }
    }
    return out
  }

  private updateTowers(dt: number): void {
    for (const t of this.towers) {
      if (!t.active) continue
      if (t.fireFlash > 0) t.fireFlash = Math.max(0, t.fireFlash - dt)
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
      else if (t.kind === 'flame') this.flameBurst(t, target)
      else if (t.kind === 'storm') this.stormBolt(t, target)
      else this.arcaneZap(t, target)
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
        default: score = e.dist
      }
      if (score > bestScore) {
        bestScore = score
        best = e
      }
    }
    return best
  }

  private fireProjectile(t: SimTower, target: SimEnemy): void {
    const s = this.stats(t)
    const splash = (s.splash ?? 0) * TILE * (1 + this.upgrades.splashBonus)
    let p: SimProjectile | null = null
    for (const cand of this.projectiles) if (!cand.active) { p = cand; break }
    if (!p) {
      p = {
        id: this.nextId++, active: false, x: 0, y: 0, tx: 0, ty: 0, targetId: -1, speed: PROJECTILE_SPEED,
        splash: 0, atk: { damage: 0, dmgType: 'Physical', armorPen: 0 }, synergy: false, sourceKind: 'cannon', color: 0xffffff,
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
    const reward = Math.max(0, Math.round(e.def.reward * this.config.mods.goldGainMult * this.upgrades.goldGainMult))
    this.addGold(reward)
    this.emit({ t: 'gold', x: e.x, y: e.y, amount: reward })
    this.emit({ t: 'death', x: e.x, y: e.y, kind: e.kind, color: e.def.color, boss: !!e.def.boss })
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

  // Dominant incoming armor + affinity for the pre-wave telegraph.
  waveTelegraph(): { armor: string; element?: Element; boss: boolean } {
    const wave = this.currentWave()
    const counts = new Map<string, number>()
    let element: Element | undefined
    let boss = false
    for (const entry of wave.entries) {
      const def = ENEMIES[entry.kind]
      counts.set(def.armor, (counts.get(def.armor) ?? 0) + entry.count)
      if (def.affinity) element = def.affinity
      if (def.boss) boss = true
    }
    let armor = 'Unarmored'
    let max = -1
    for (const [k, v] of counts) if (v > max) { max = v; armor = k }
    return { armor, element, boss }
  }

  liveEnemyCount(): number {
    let n = 0
    for (const e of this.enemies) if (e.active) n++
    return n
  }
}

const EMPTY_EVENTS: SimEvent[] = []
