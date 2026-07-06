import Phaser from 'phaser'
import { ENEMIES, type EnemyDef, type EnemyKind } from '../game/enemies'
import {
  TOWERS,
  TOWER_ORDER,
  SYNERGY_MULT,
  type TowerBranch,
  type TowerDef,
  type TowerKind,
  type TowerLevel,
} from '../game/towers'
import {
  GRID_COLS,
  GRID_ROWS,
  LEVELS,
  levelById,
  serpentine,
  starsForClear,
  type LevelDef,
  type Wave,
} from '../game/levels'
import { SPELLS, SPELL_ORDER, type SpellDef, type SpellKey } from '../game/spells'
import { economy } from '../game/economy'
import type { RunModifiers } from '../game/workshop'

// ---- Layout constants (720x1280 portrait) ---------------------------------
const COLS = GRID_COLS // 9
const ROWS = GRID_ROWS // 11
const TILE = 80
const MAP_X = 0
const MAP_Y = 200
const MAP_W = COLS * TILE // 720
const MAP_H = ROWS * TILE // 880 -> map spans y 200..1080

const ENDLESS_START_GOLD = 300
const ENDLESS_START_LIVES = 20

// Candy palette (path/grass colours come from the level palette)
const C = {
  base: 0x2ff7c3,
  portal: 0x9a5cff,
  hudBg: 0x241447,
  panel: 0x2e1a5a,
  gold: 0xffd54a,
  life: 0xff5b7a,
  white: 0xffffff,
}

type GameState = 'prep' | 'active' | 'won' | 'lost'
type InputMode = 'idle' | 'building' | 'aiming'

interface Segment {
  ax: number
  ay: number
  bx: number
  by: number
  len: number
}

interface Enemy {
  def: EnemyDef
  cont: Phaser.GameObjects.Container
  body: Phaser.GameObjects.Shape
  hpBg: Phaser.GameObjects.Rectangle
  hpFill: Phaser.GameObjects.Rectangle
  tag: Phaser.GameObjects.Text
  shieldGfx: Phaser.GameObjects.Arc | null
  maxHp: number
  hp: number
  shield: number
  shieldMax: number
  dist: number
  x: number
  y: number
  slowUntil: number
  slowFactor: number
  stunUntil: number
  burnUntil: number
  burnDps: number
  burnTick: number
  healTick: number
  weakUntil: number
  alive: boolean
}

interface Tower {
  def: TowerDef
  level: number // 0..2 linear, 3 = branched
  branch: number // -1 none, else 0/1
  col: number
  row: number
  x: number
  y: number
  cont: Phaser.GameObjects.Container
  turret: Phaser.GameObjects.Shape
  ring: Phaser.GameObjects.Arc
  cd: number
  buffDmg: number // aggregated multiplier from adjacent Arcane (1 = none)
  buffRng: number
}

interface Projectile {
  gfx: Phaser.GameObjects.Arc
  x: number
  y: number
  target: Enemy | null
  tx: number
  ty: number
  speed: number
  damage: number
  source: TowerDef
  splash: number // tiles, 0 = single target
}

interface SpawnItem {
  kind: EnemyKind
  hpMul: number
  at: number
}

interface SpellButton {
  key: SpellKey
  def: SpellDef
  cont: Phaser.GameObjects.Container
  ring: Phaser.GameObjects.Graphics
  cd: number
  maxCd: number
}

export class BattleScene extends Phaser.Scene {
  // run config
  private levelId = 'l1'
  private endless = false
  private level!: LevelDef
  private mods!: RunModifiers
  private pathCells: Array<[number, number]> = []
  private waveTable: Wave[] = []
  private startGold = 260
  private startLives = 20

  // grid / path
  private grid: string[][] = []
  private occupied: (Tower | null)[][] = []
  private waypoints: { x: number; y: number }[] = []
  private segments: Segment[] = []
  private pathLength = 0

  private enemies: Enemy[] = []
  private towers: Tower[] = []
  private projectiles: Projectile[] = []

  private gold = 0
  private lives = 0
  private waveIndex = 0
  private state: GameState = 'prep'
  private clock = 0
  private gameSpeed = 1
  private paused = false

  private spawnQueue: SpawnItem[] = []
  private prepTimer = 0

  // input
  private mode: InputMode = 'idle'
  private buildKind: TowerKind | null = null
  private aimingSpell: SpellKey | null = null
  private ghost?: Phaser.GameObjects.Container
  private ghostRing?: Phaser.GameObjects.Arc
  private aimReticle?: Phaser.GameObjects.Container
  private selected: Tower | null = null

  // HUD refs
  private goldText!: Phaser.GameObjects.Text
  private livesText!: Phaser.GameObjects.Text
  private waveText!: Phaser.GameObjects.Text
  private goldIcon!: { x: number; y: number }
  private startBtn!: Phaser.GameObjects.Container
  private startLabel!: Phaser.GameObjects.Text
  private speedLabel!: Phaser.GameObjects.Text
  private pauseLabel!: Phaser.GameObjects.Text
  private towerButtons: Phaser.GameObjects.Container[] = []
  private spellButtons: SpellButton[] = []
  private upgradePanel?: Phaser.GameObjects.Container
  private buffLinks!: Phaser.GameObjects.Graphics
  private banner?: Phaser.GameObjects.Text

  constructor() {
    super('Battle')
  }

  init(data: { levelId?: string; endless?: boolean }): void {
    this.endless = !!data?.endless
    this.levelId = data?.levelId ?? 'l1'
  }

  create(): void {
    // resolve run config
    this.level = this.endless ? this.endlessLevel() : levelById(this.levelId) ?? LEVELS[0]
    this.mods = economy.runModifiers(this.endless)
    this.pathCells = serpentine(this.level.lanes)
    this.waveTable = this.level.waves
    this.startGold = this.endless
      ? ENDLESS_START_GOLD
      : this.level.startGold + this.mods.startGoldBonus
    this.startLives = this.endless
      ? ENDLESS_START_LIVES
      : this.level.startLives + this.mods.startLivesBonus

    // reset ALL scene-level state (scene.start reuses the instance)
    this.enemies = []
    this.towers = []
    this.projectiles = []
    this.gold = this.startGold
    this.lives = this.startLives
    this.waveIndex = 0
    this.state = 'prep'
    this.clock = 0
    this.gameSpeed = 1
    this.paused = false
    this.mode = 'idle'
    this.buildKind = null
    this.aimingSpell = null
    this.selected = null
    this.towerButtons = []
    this.spellButtons = []
    this.spawnQueue = []
    this.ghost = undefined
    this.ghostRing = undefined
    this.aimReticle = undefined
    this.upgradePanel = undefined
    this.banner = undefined
    this.tweens.timeScale = 1

    this.buildGrid()
    this.drawField()
    this.drawPath()
    this.drawPortalAndBase()
    this.buffLinks = this.add.graphics().setDepth(5)
    this.buildHud()
    this.buildTowerBar()
    this.buildSpellBar()
    this.setupInput()
    this.enterPrep()

    // touch idle timestamp when leaving the meta screens into a run
    economy.touchLastSeen()
    this.cameras.main.fadeIn(350, 20, 12, 50)
  }

  // ---- Endless procedural level -------------------------------------------
  private endlessLevel(): LevelDef {
    return {
      id: 'endless',
      index: 99,
      name: 'Endless — Ranked',
      blurb: 'Purchases do not affect this mode',
      lanes: [1, 3, 5, 7, 9],
      startGold: ENDLESS_START_GOLD,
      startLives: ENDLESS_START_LIVES,
      baseCoins: 0,
      palette: LEVELS[3].palette,
      waves: [], // generated on demand
    }
  }

  // Build a procedural endless wave scaled by wave number (n = 1-based).
  private endlessWave(n: number): Wave {
    const hp = 1 + n * 0.18
    const entries = [] as Wave['entries']
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

  private currentWave(): Wave {
    if (this.endless) return this.endlessWave(this.waveIndex + 1)
    return this.waveTable[Math.min(this.waveIndex, this.waveTable.length - 1)]
  }

  // ---- Tower stat helper (the ONLY place level/branch is resolved) --------
  private currentStats(t: Tower): TowerLevel | TowerBranch {
    if (t.level >= 3 && t.branch >= 0) return t.def.branches[t.branch]
    return t.def.levels[Math.min(t.level, 2)]
  }
  private isMax(t: Tower): boolean {
    return t.level >= 3
  }
  private effRange(t: Tower): number {
    return this.currentStats(t).range * TILE * t.buffRng * this.mods.rangeMult
  }
  private effDamage(t: Tower): number {
    return this.currentStats(t).damage * t.buffDmg * this.mods.towerDamageMult
  }
  private effCooldown(t: Tower): number {
    return this.currentStats(t).cooldown * this.mods.cooldownMult
  }

  // ---- Grid & path ---------------------------------------------------------
  private cellCenter(col: number, row: number): { x: number; y: number } {
    return { x: MAP_X + col * TILE + TILE / 2, y: MAP_Y + row * TILE + TILE / 2 }
  }

  private buildGrid(): void {
    this.grid = []
    this.occupied = []
    for (let r = 0; r < ROWS; r++) {
      const gr: string[] = []
      const orow: (Tower | null)[] = []
      for (let c = 0; c < COLS; c++) {
        gr.push('blocked')
        orow.push(null)
      }
      this.grid.push(gr)
      this.occupied.push(orow)
    }
    const onPath = new Set<string>()
    for (const [c, r] of this.pathCells) {
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
    // waypoints (prepend an off-screen entry so enemies stroll in)
    this.waypoints = []
    const first = this.pathCells[0]
    this.waypoints.push(this.cellCenter(first[0] - 1.2, first[1]))
    for (const [c, r] of this.pathCells) this.waypoints.push(this.cellCenter(c, r))
    this.segments = []
    this.pathLength = 0
    for (let i = 0; i < this.waypoints.length - 1; i++) {
      const a = this.waypoints[i]
      const b = this.waypoints[i + 1]
      const len = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y)
      this.segments.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, len })
      this.pathLength += len
    }
  }

  private positionAt(dist: number): { x: number; y: number; done: boolean } {
    if (dist >= this.pathLength) {
      const last = this.waypoints[this.waypoints.length - 1]
      return { x: last.x, y: last.y, done: true }
    }
    let d = dist
    for (const s of this.segments) {
      if (d <= s.len) {
        const t = s.len === 0 ? 0 : d / s.len
        return { x: s.ax + (s.bx - s.ax) * t, y: s.ay + (s.by - s.ay) * t, done: false }
      }
      d -= s.len
    }
    const last = this.waypoints[this.waypoints.length - 1]
    return { x: last.x, y: last.y, done: true }
  }

  // ---- Visual field --------------------------------------------------------
  private drawField(): void {
    const p = this.level.palette
    this.add.rectangle(360, 640, 720, 1280, C.hudBg).setDepth(0)
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cc = this.cellCenter(c, r)
        const cell = this.grid[r][c]
        let color = (c + r) % 2 === 0 ? p.grassA : p.grassB
        if (cell === 'build') color = (c + r) % 2 === 0 ? p.build : this.mix(p.build, 0x000000, 0.08)
        const rect = this.add.rectangle(cc.x, cc.y, TILE - 2, TILE - 2, color).setDepth(1)
        if (cell === 'build') rect.setStrokeStyle(2, 0xffffff, 0.22)
      }
    }
  }

  private mix(a: number, b: number, t: number): number {
    const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255
    const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255
    const r = Math.round(ar + (br - ar) * t)
    const g = Math.round(ag + (bg - ag) * t)
    const bl = Math.round(ab + (bb - ab) * t)
    return (r << 16) | (g << 8) | bl
  }

  private drawPath(): void {
    const p = this.level.palette
    const g = this.add.graphics().setDepth(2)
    const roadW = TILE * 0.78
    g.fillStyle(p.pathEdge, 1)
    for (const [c, r] of this.pathCells) {
      const cc = this.cellCenter(c, r)
      g.fillRoundedRect(cc.x - roadW / 2 - 5, cc.y - roadW / 2 - 5, roadW + 10, roadW + 10, 14)
    }
    g.fillStyle(p.path, 1)
    for (const [c, r] of this.pathCells) {
      const cc = this.cellCenter(c, r)
      g.fillRoundedRect(cc.x - roadW / 2, cc.y - roadW / 2, roadW, roadW, 12)
    }
    const dash = this.add.graphics().setDepth(2)
    dash.fillStyle(0xffffff, 0.5)
    for (let i = 1; i < this.waypoints.length; i++) {
      const a = this.waypoints[i - 1]
      const b = this.waypoints[i]
      const len = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y)
      const steps = Math.max(1, Math.floor(len / 26))
      for (let s = 0; s < steps; s += 2) {
        const t = s / steps
        dash.fillCircle(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, 3.5)
      }
    }
  }

  private drawPortalAndBase(): void {
    const start = this.waypoints[1]
    const ring1 = this.add.circle(start.x, start.y, 30, C.portal, 0.9).setDepth(3)
    ring1.setStrokeStyle(5, 0xd7b8ff)
    this.add.circle(start.x, start.y, 15, 0xf0e0ff, 0.9).setDepth(3)
    this.tweens.add({ targets: ring1, scale: 1.25, alpha: 0.55, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' })

    const base = this.waypoints[this.waypoints.length - 1]
    const glow = this.add.circle(base.x, base.y, 46, C.base, 0.28).setDepth(3)
    this.tweens.add({ targets: glow, scale: 1.3, alpha: 0.12, duration: 1100, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' })
    const gem = this.add.polygon(base.x, base.y, [0, -34, 26, 0, 0, 34, -26, 0], C.base, 1).setDepth(4)
    gem.setStrokeStyle(4, 0xd6fff5)
    this.add.polygon(base.x, base.y, [0, -34, 26, 0, 0, 0, -12, -10], 0xeafffb, 0.7).setDepth(4)
    this.tweens.add({ targets: gem, angle: 8, duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' })
  }

  // ---- HUD -----------------------------------------------------------------
  private pill(x: number, y: number, w: number, h: number, color: number): Phaser.GameObjects.Graphics {
    const g = this.add.graphics().setDepth(20)
    g.fillStyle(color, 0.9)
    g.fillRoundedRect(x - w / 2, y - h / 2, w, h, h / 2)
    g.lineStyle(3, 0xffffff, 0.18)
    g.strokeRoundedRect(x - w / 2, y - h / 2, w, h, h / 2)
    return g
  }

  private buildHud(): void {
    this.add.rectangle(360, 100, 720, 200, C.panel, 1).setDepth(19)
    this.add.rectangle(360, 200, 720, 4, 0x000000, 0.25).setDepth(19)

    // Gold pill
    this.pill(140, 42, 190, 50, 0x3a2470)
    const gc = this.add.circle(72, 42, 16, C.gold).setDepth(20)
    gc.setStrokeStyle(3, 0xffe9a6)
    this.add.text(72, 42, '$', { fontFamily: 'Arial Black', fontSize: '20px', color: '#7a5600' }).setOrigin(0.5).setDepth(21)
    this.goldIcon = { x: 72, y: 42 }
    this.goldText = this.add
      .text(98, 42, `${this.gold}`, { fontFamily: 'Arial Black', fontSize: '28px', color: '#ffe27a' })
      .setOrigin(0, 0.5)
      .setDepth(21)

    // Lives pill
    this.pill(340, 42, 150, 50, 0x3a2470)
    const heart = this.add.circle(288, 42, 14, C.life).setDepth(20)
    heart.setStrokeStyle(3, 0xffd0da)
    this.livesText = this.add
      .text(310, 42, `${this.lives}`, { fontFamily: 'Arial Black', fontSize: '28px', color: '#ffd0da' })
      .setOrigin(0, 0.5)
      .setDepth(21)

    // Wave pill
    this.pill(540, 42, 180, 50, 0x3a2470)
    this.waveText = this.add
      .text(540, 42, '', { fontFamily: 'Arial Black', fontSize: '24px', color: '#a0f0ff' })
      .setOrigin(0.5)
      .setDepth(21)

    // Level name (tiny, right)
    this.add
      .text(714, 16, this.level.name.toUpperCase(), { fontFamily: 'Arial Black', fontSize: '15px', color: '#c9b6ff' })
      .setOrigin(1, 0)
      .setDepth(21)

    // Row 2: start wave (left) + pause/speed (right); spells fill the middle.
    this.startBtn = this.makeButtonSync(150, 120, 250, 58, 'START ▶', 0x2ea043, () => this.startWave())
    this.startLabel = this.startBtn.getData('label') as Phaser.GameObjects.Text

    this.pauseLabel = (this.makeButtonSync(612, 120, 74, 58, 'II', 0x4a3a7a, () => this.togglePause())
      .getData('label') as Phaser.GameObjects.Text)
    this.speedLabel = (this.makeButtonSync(680, 120, 74, 58, '1x', 0x4a3a7a, () => this.toggleSpeed())
      .getData('label') as Phaser.GameObjects.Text)
  }

  private makeButtonSync(
    x: number, y: number, w: number, h: number, label: string, color: number, onClick: () => void,
  ): Phaser.GameObjects.Container {
    const bg = this.add.graphics()
    bg.fillStyle(color, 1)
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, 14)
    bg.lineStyle(3, 0xffffff, 0.25)
    bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 14)
    const txt = this.add.text(0, 0, label, { fontFamily: 'Arial Black', fontSize: '26px', color: '#ffffff' }).setOrigin(0.5)
    const cont = this.add.container(x, y, [bg, txt]).setDepth(22)
    cont.setSize(w, h)
    cont.setData('label', txt)
    cont.setInteractive(new Phaser.Geom.Rectangle(-w / 2, -h / 2, w, h), Phaser.Geom.Rectangle.Contains)
    cont.on('pointerdown', () => {
      this.tweens.add({ targets: cont, scale: 0.92, duration: 70, yoyo: true })
      onClick()
    })
    return cont
  }

  private buildTowerBar(): void {
    this.add.rectangle(360, 1180, 720, 200, C.panel, 1).setDepth(19)
    this.add.rectangle(360, 1080, 720, 4, 0x000000, 0.25).setDepth(19)
    const xs = [76, 204, 332, 460, 588]
    const w = 120
    const h = 158
    TOWER_ORDER.forEach((kind, i) => {
      const def = TOWERS[kind]
      const x = xs[i]
      const y = 1178
      const bg = this.add.graphics()
      const icon = this.towerIconShapes(0, -38, def, 0)
      const name = this.add.text(0, 22, def.name, { fontFamily: 'Arial Black', fontSize: '20px', color: '#ffffff' }).setOrigin(0.5)
      const costTxt = this.add.text(0, 48, `$${this.placeCost(def)}`, { fontFamily: 'Arial Black', fontSize: '20px', color: '#ffe27a' }).setOrigin(0.5)
      const lock = this.add.text(0, -38, '🔒', { fontSize: '30px' }).setOrigin(0.5).setVisible(false)
      const cont = this.add.container(x, y, [bg, ...icon, name, costTxt, lock]).setDepth(22)
      cont.setSize(w, h)
      cont.setData('bg', bg)
      cont.setData('kind', kind)
      cont.setData('w', w)
      cont.setData('h', h)
      cont.setData('def', def)
      cont.setData('lock', lock)
      cont.setData('cost', costTxt)
      cont.setInteractive(new Phaser.Geom.Rectangle(-w / 2, -h / 2, w, h), Phaser.Geom.Rectangle.Contains)
      cont.on('pointerdown', () => this.onTowerButton(kind))
      this.towerButtons.push(cont)
    })
    this.refreshTowerButtons()
  }

  private placeCost(def: TowerDef): number {
    return Math.round(def.cost * this.mods.towerCostMult)
  }

  private towerUnlocked(kind: TowerKind): boolean {
    return this.endless || economy.isTowerUnlocked(kind)
  }

  private refreshTowerButtons(): void {
    for (const cont of this.towerButtons) {
      const def = cont.getData('def') as TowerDef
      const bg = cont.getData('bg') as Phaser.GameObjects.Graphics
      const kind = cont.getData('kind') as TowerKind
      const w = cont.getData('w') as number
      const h = cont.getData('h') as number
      const lock = cont.getData('lock') as Phaser.GameObjects.Text
      const costTxt = cont.getData('cost') as Phaser.GameObjects.Text
      const unlocked = this.towerUnlocked(kind)
      const selected = this.buildKind === kind
      const afford = this.gold >= this.placeCost(def)
      bg.clear()
      bg.fillStyle(selected ? def.color : 0x3a2470, selected ? 0.85 : 1)
      bg.fillRoundedRect(-w / 2, -h / 2, w, h, 16)
      bg.lineStyle(selected ? 6 : 4, def.color, unlocked && afford ? 1 : 0.35)
      bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 16)
      lock.setVisible(!unlocked)
      costTxt.setVisible(unlocked)
      cont.setAlpha(!unlocked ? 0.55 : afford ? 1 : 0.6)
    }
  }

  private towerIconShapes(x: number, y: number, def: TowerDef, depth: number): Phaser.GameObjects.Shape[] {
    const shapes: Phaser.GameObjects.Shape[] = []
    const base = this.add.circle(x, y, 20, def.accent).setDepth(depth)
    shapes.push(base)
    if (def.kind === 'cannon') {
      shapes.push(this.add.circle(x, y, 13, def.color).setDepth(depth))
      const barrel = this.add.rectangle(x, y - 12, 9, 20, def.color).setDepth(depth)
      barrel.setStrokeStyle(2, 0xffffff, 0.4)
      shapes.push(barrel)
    } else if (def.kind === 'frost') {
      const body = this.add.star(x, y, 6, 6, 14, def.color).setDepth(depth)
      body.setStrokeStyle(2, 0xffffff, 0.5)
      shapes.push(body)
    } else if (def.kind === 'flame') {
      const body = this.add.triangle(x, y, 0, 14, 12, -12, -12, -12, def.color).setDepth(depth)
      body.setStrokeStyle(2, 0xffffff, 0.4)
      shapes.push(body)
    } else if (def.kind === 'storm') {
      const body = this.add.star(x, y, 4, 5, 15, def.color).setDepth(depth)
      body.setStrokeStyle(2, 0xffffff, 0.5)
      shapes.push(body)
    } else {
      // arcane — hex crystal
      const pts: number[] = []
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 2
        pts.push(Math.cos(a) * 14, Math.sin(a) * 14)
      }
      const body = this.add.polygon(x, y, pts, def.color).setDepth(depth)
      body.setStrokeStyle(2, 0xffffff, 0.5)
      shapes.push(body)
    }
    return shapes
  }

  // ---- Spell bar -----------------------------------------------------------
  private buildSpellBar(): void {
    const xs = [320, 410, 500]
    SPELL_ORDER.forEach((key, i) => {
      const def = SPELLS[key]
      const x = xs[i]
      const y = 120
      const r = 30
      const bg = this.add.circle(0, 0, r, 0x1c1038, 1)
      bg.setStrokeStyle(3, def.color, 0.9)
      const icon = this.spellIcon(0, 0, def)
      const ring = this.add.graphics()
      const cont = this.add.container(x, y, [bg, ...icon, ring]).setDepth(23)
      cont.setSize(r * 2, r * 2)
      cont.setInteractive(new Phaser.Geom.Circle(0, 0, r), Phaser.Geom.Circle.Contains)
      const sb: SpellButton = { key, def, cont, ring, cd: 0, maxCd: def.cooldown * this.mods.spellCooldownMult }
      cont.on('pointerdown', () => this.onSpellButton(sb))
      this.spellButtons.push(sb)
    })
  }

  private spellIcon(x: number, y: number, def: SpellDef): Phaser.GameObjects.Shape[] {
    const out: Phaser.GameObjects.Shape[] = []
    if (def.key === 'meteor') {
      out.push(this.add.circle(x, y, 11, def.color))
      out.push(this.add.circle(x - 4, y - 4, 4, 0xffe9a6))
    } else if (def.key === 'freeze') {
      out.push(this.add.star(x, y, 6, 5, 13, def.color))
    } else {
      const c = this.add.circle(x, y, 11, def.color)
      c.setStrokeStyle(3, 0xffe9a6)
      out.push(c)
    }
    return out
  }

  private onSpellButton(sb: SpellButton): void {
    if (this.state === 'won' || this.state === 'lost') return
    if (sb.cd > 0) {
      this.floatText(sb.cont.x, sb.cont.y + 40, 'CHARGING', 0xff5b7a, 18)
      return
    }
    if (sb.def.targeted) {
      // enter aiming mode
      this.exitBuild()
      this.deselect()
      this.mode = 'aiming'
      this.aimingSpell = sb.key
      this.spawnAimReticle(sb.def)
    } else {
      this.castSpell(sb, this.scale.width / 2, MAP_Y + MAP_H / 2)
    }
  }

  private spawnAimReticle(def: SpellDef): void {
    this.clearAimReticle()
    const r = (def.radius ?? 2) * TILE
    const ring = this.add.circle(0, 0, r, def.color, 0.15)
    ring.setStrokeStyle(4, def.color, 0.9)
    const cross = this.add.rectangle(0, 0, r * 2, 3, def.color, 0.5)
    const cross2 = this.add.rectangle(0, 0, 3, r * 2, def.color, 0.5)
    this.aimReticle = this.add.container(-200, -200, [ring, cross, cross2]).setDepth(12).setVisible(false)
  }

  private clearAimReticle(): void {
    this.aimReticle?.destroy()
    this.aimReticle = undefined
  }

  private spellByKey(key: SpellKey): SpellButton | undefined {
    return this.spellButtons.find((s) => s.key === key)
  }

  private castSpell(sb: SpellButton, x: number, y: number): void {
    sb.cd = sb.maxCd
    const def = sb.def
    const power = this.mods.spellPowerMult
    if (def.key === 'meteor') {
      this.castMeteor(x, y, def, power)
    } else if (def.key === 'freeze') {
      this.castFreeze(def)
    } else {
      const amt = Math.round((def.gold ?? 100) * power)
      this.addGold(amt)
      this.floatText(x, y, `+${amt} GOLD!`, C.gold, 34)
      this.spawnCoins(x, y, amt)
      this.cameras.main.flash(140, 255, 213, 74)
    }
  }

  private castMeteor(x: number, y: number, def: SpellDef, power: number): void {
    const radius = (def.radius ?? 2) * TILE
    // incoming streak
    const streak = this.add.circle(x - 120, y - 260, 18, 0xffe9a6, 0.9).setDepth(13)
    this.tweens.add({
      targets: streak, x, y, duration: 260, ease: 'Cubic.easeIn',
      onComplete: () => {
        streak.destroy()
        this.meteorImpact(x, y, radius, def, power)
      },
    })
  }

  private meteorImpact(x: number, y: number, radius: number, def: SpellDef, power: number): void {
    this.cameras.main.shake(240, 0.012)
    this.cameras.main.flash(160, 255, 140, 60)
    const flash = this.add.circle(x, y, radius * 0.5, 0xffe0a0, 0.9).setDepth(14)
    this.tweens.add({ targets: flash, scale: 2.2, alpha: 0, duration: 380, onComplete: () => flash.destroy() })
    this.pulseRing(x, y, radius, def.color)
    for (let i = 0; i < 22; i++) {
      const a = Phaser.Math.FloatBetween(0, Math.PI * 2)
      const spark = this.add.rectangle(x, y, 7, 7, i % 2 ? 0xff7a3c : 0xffd54a).setDepth(14)
      this.tweens.add({
        targets: spark, x: x + Math.cos(a) * Phaser.Math.Between(30, radius),
        y: y + Math.sin(a) * Phaser.Math.Between(30, radius), alpha: 0, scale: 0.2,
        duration: Phaser.Math.Between(320, 560), ease: 'Cubic.easeOut', onComplete: () => spark.destroy(),
      })
    }
    // gather then damage (never mutate list mid-iterate)
    const dmg = (def.damage ?? 120) * power
    const targets = this.enemies.filter((e) => e.alive && this.dist2(x, y, e.x, e.y) <= radius * radius)
    for (const e of targets) {
      if (!e.alive) continue
      this.dealDamageDirect(e, dmg)
      if (e.alive) {
        e.burnUntil = this.clock + (def.burnDuration ?? 2)
        e.burnDps = Math.max(e.burnDps, (def.burnDps ?? 20) * power)
      }
    }
  }

  private castFreeze(def: SpellDef): void {
    const dur = def.stunDuration ?? 2
    this.cameras.main.flash(200, 120, 220, 255)
    const overlay = this.add.rectangle(360, 640, 720, 1280, def.color, 0.22).setDepth(12)
    this.tweens.add({ targets: overlay, alpha: 0, duration: 700, onComplete: () => overlay.destroy() })
    let froze = 0
    for (const e of this.enemies) {
      if (!e.alive) continue
      e.stunUntil = Math.max(e.stunUntil, this.clock + dur)
      froze++
    }
    if (froze > 0) this.floatText(360, 300, `FROZEN x${froze}!`, def.color, 36)
    // frost crystals blip on each enemy
    for (const e of this.enemies) {
      if (!e.alive) continue
      this.pulseRing(e.x, e.y, e.def.radius + 8, def.color, 0.7)
    }
  }

  // ---- Input ---------------------------------------------------------------
  private setupInput(): void {
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.onPointerMove(p))
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.onPointerDown(p))
  }

  private pointerCell(p: Phaser.Input.Pointer): { col: number; row: number } | null {
    if (p.x < MAP_X || p.x >= MAP_X + MAP_W || p.y < MAP_Y || p.y >= MAP_Y + MAP_H) return null
    const col = Math.floor((p.x - MAP_X) / TILE)
    const row = Math.floor((p.y - MAP_Y) / TILE)
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return null
    return { col, row }
  }

  private onPointerMove(p: Phaser.Input.Pointer): void {
    if (this.mode === 'building' && this.ghost && this.ghostRing) {
      const cell = this.pointerCell(p)
      if (!cell) {
        this.ghost.setVisible(false)
        this.ghostRing.setVisible(false)
        return
      }
      const cc = this.cellCenter(cell.col, cell.row)
      this.ghost.setVisible(true).setPosition(cc.x, cc.y)
      this.ghostRing.setVisible(true).setPosition(cc.x, cc.y)
      const ok = this.canPlace(cell.col, cell.row)
      this.ghost.setAlpha(ok ? 0.9 : 0.4)
      this.ghostRing.setStrokeStyle(3, ok ? 0x9affc0 : 0xff5b7a, 0.9)
    } else if (this.mode === 'aiming' && this.aimReticle) {
      const inMap = p.x >= MAP_X && p.x < MAP_X + MAP_W && p.y >= MAP_Y && p.y < MAP_Y + MAP_H
      this.aimReticle.setVisible(inMap).setPosition(p.x, p.y)
    }
  }

  private onPointerDown(p: Phaser.Input.Pointer): void {
    if (this.state === 'won' || this.state === 'lost') return

    if (this.mode === 'aiming') {
      const inMap = p.x >= MAP_X && p.x < MAP_X + MAP_W && p.y >= MAP_Y && p.y < MAP_Y + MAP_H
      if (inMap && this.aimingSpell) {
        const sb = this.spellByKey(this.aimingSpell)
        if (sb && sb.cd <= 0) this.castSpell(sb, p.x, p.y)
      }
      this.exitAiming()
      return
    }

    // Let the upgrade panel's own buttons handle taps that land on it.
    if (this.upgradePanel && Phaser.Geom.Rectangle.Contains(new Phaser.Geom.Rectangle(120, 855, 480, 200), p.x, p.y)) {
      return
    }
    const cell = this.pointerCell(p)
    if (!cell) return

    if (this.mode === 'building') {
      this.tryPlace(cell.col, cell.row)
      return
    }
    const t = this.occupied[cell.row][cell.col]
    if (t) this.selectTower(t)
    else this.deselect()
  }

  private onTowerButton(kind: TowerKind): void {
    if (this.state === 'won' || this.state === 'lost') return
    if (!this.towerUnlocked(kind)) {
      this.floatText(360, 1080, 'LOCKED — clear levels to unlock', 0xff5b7a, 22)
      return
    }
    this.exitAiming()
    this.deselect()
    if (this.buildKind === kind) {
      this.exitBuild()
      return
    }
    this.buildKind = kind
    this.mode = 'building'
    this.spawnGhost(kind)
    this.refreshTowerButtons()
  }

  private spawnGhost(kind: TowerKind): void {
    this.clearGhost()
    const def = TOWERS[kind]
    const shapes = this.towerIconShapes(0, 0, def, 6)
    this.ghost = this.add.container(-100, -100, shapes).setDepth(6).setVisible(false)
    const range = def.levels[0].range * TILE * this.mods.rangeMult
    this.ghostRing = this.add.circle(-100, -100, range, def.color, 0.12).setDepth(5).setVisible(false)
    this.ghostRing.setStrokeStyle(3, 0x9affc0, 0.9)
  }

  private clearGhost(): void {
    this.ghost?.destroy()
    this.ghostRing?.destroy()
    this.ghost = undefined
    this.ghostRing = undefined
  }

  private exitBuild(): void {
    this.buildKind = null
    if (this.mode === 'building') this.mode = 'idle'
    this.clearGhost()
    this.refreshTowerButtons()
  }

  private exitAiming(): void {
    this.aimingSpell = null
    if (this.mode === 'aiming') this.mode = 'idle'
    this.clearAimReticle()
  }

  private canPlace(col: number, row: number): boolean {
    return this.grid[row][col] === 'build' && this.occupied[row][col] === null
  }

  private tryPlace(col: number, row: number): void {
    if (!this.buildKind) return
    const def = TOWERS[this.buildKind]
    const cost = this.placeCost(def)
    const cc = this.cellCenter(col, row)
    if (!this.canPlace(col, row)) {
      this.floatText(cc.x, cc.y, 'CANT BUILD', 0xff5b7a)
      return
    }
    if (this.gold < cost) {
      this.floatText(cc.x, cc.y, 'NEED GOLD', 0xff5b7a)
      return
    }
    this.spendGold(cost)
    this.placeTower(def, col, row)
    if (this.gold < cost) this.exitBuild()
  }

  private placeTower(def: TowerDef, col: number, row: number): void {
    const cc = this.cellCenter(col, row)
    const ringR = def.levels[0].range * TILE * this.mods.rangeMult
    const ring = this.add.circle(cc.x, cc.y, ringR, def.color, 0.1).setDepth(5).setVisible(false)
    ring.setStrokeStyle(3, def.color, 0.9)
    const turretShapes = this.towerIconShapes(0, 0, def, 6)
    const cont = this.add.container(cc.x, cc.y, [...turretShapes]).setDepth(6)
    const turret = turretShapes[turretShapes.length - 1]
    const tower: Tower = {
      def, level: 0, branch: -1, col, row, x: cc.x, y: cc.y, cont, turret, ring, cd: 0, buffDmg: 1, buffRng: 1,
    }
    this.towers.push(tower)
    this.occupied[row][col] = tower
    this.recomputeBuffs()

    cont.setScale(0.2)
    this.tweens.add({ targets: cont, scale: 1, duration: 260, ease: 'Back.easeOut' })
    this.pulseRing(cc.x, cc.y, ringR, def.color)
    this.cameras.main.shake(90, 0.004)
  }

  // ---- Arcane support buffs ------------------------------------------------
  private recomputeBuffs(): void {
    for (const t of this.towers) {
      t.buffDmg = 1
      t.buffRng = 1
    }
    for (const a of this.towers) {
      if (!a.def.support) continue
      const s = this.currentStats(a)
      const bd = s.buffDamage ?? 0
      const br = s.buffRange ?? 0
      for (const n of this.towers) {
        if (n === a) continue
        if (Math.abs(n.col - a.col) <= 1 && Math.abs(n.row - a.row) <= 1) {
          n.buffDmg += bd
          n.buffRng += br
        }
      }
    }
    // update range rings + redraw glow links
    for (const t of this.towers) t.ring.setRadius(this.effRange(t))
    this.drawBuffLinks()
  }

  private drawBuffLinks(): void {
    this.buffLinks.clear()
    for (const a of this.towers) {
      if (!a.def.support) continue
      for (const n of this.towers) {
        if (n === a) continue
        if (Math.abs(n.col - a.col) <= 1 && Math.abs(n.row - a.row) <= 1) {
          this.buffLinks.lineStyle(4, a.def.color, 0.5)
          this.buffLinks.lineBetween(a.x, a.y, n.x, n.y)
          this.buffLinks.fillStyle(a.def.color, 0.18)
          this.buffLinks.fillCircle(n.x, n.y, 26)
        }
      }
    }
  }

  // ---- Selection / upgrade -------------------------------------------------
  private selectTower(t: Tower): void {
    this.deselect()
    this.selected = t
    t.ring.setVisible(true)
    this.showUpgradePanel(t)
  }

  private deselect(): void {
    if (this.selected) this.selected.ring.setVisible(false)
    this.selected = null
    this.upgradePanel?.destroy()
    this.upgradePanel = undefined
  }

  private showUpgradePanel(t: Tower): void {
    this.upgradePanel?.destroy()
    const w = 480
    const h = 190
    const x = 360
    const y = 960
    const bg = this.add.graphics()
    bg.fillStyle(0x1c1038, 0.97)
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, 18)
    bg.lineStyle(4, t.def.color, 1)
    bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 18)
    const cur = this.currentStats(t)
    const tierName = t.level >= 3 && t.branch >= 0 ? (cur as TowerBranch).name : `Lv ${t.level + 1}`
    const title = this.add
      .text(-w / 2 + 20, -h / 2 + 14, `${t.def.name}  ·  ${tierName}`, { fontFamily: 'Arial Black', fontSize: '24px', color: '#ffffff' })
      .setOrigin(0, 0)
    const dps = t.def.support ? `BUFF +${Math.round((cur.buffDamage ?? 0) * 100)}%` : `DMG ${Math.round(this.effDamage(t))}`
    const stats = this.add
      .text(-w / 2 + 20, -h / 2 + 48, `${dps}   RNG ${(this.effRange(t) / TILE).toFixed(1)}`, { fontFamily: 'Arial', fontSize: '20px', color: '#a0f0ff' })
      .setOrigin(0, 0)
    const children: Phaser.GameObjects.GameObject[] = [bg, title, stats]

    if (t.level < 2) {
      // linear upgrade
      const next = t.def.levels[t.level + 1]
      const cost = Math.round(next.upgradeCost * this.mods.towerCostMult)
      const afford = this.gold >= cost
      const bw = 200, bh = 60, bx = w / 2 - bw / 2 - 16, by = 10
      const btnBg = this.add.graphics()
      btnBg.fillStyle(afford ? 0x2ea043 : 0x555070, 1)
      btnBg.fillRoundedRect(bx - bw / 2, by - bh / 2, bw, bh, 14)
      const btnTxt = this.add.text(bx, by, `UPGRADE $${cost}`, { fontFamily: 'Arial Black', fontSize: '22px', color: '#ffffff' }).setOrigin(0.5)
      const upInfo = this.add
        .text(-w / 2 + 20, h / 2 - 40, `NEXT: DMG ${Math.round(next.damage * t.buffDmg * this.mods.towerDamageMult)}`, { fontFamily: 'Arial', fontSize: '18px', color: '#ffe27a' })
        .setOrigin(0, 0)
      children.push(upInfo, btnBg, btnTxt)
      const panel = this.add.container(x, y, children).setDepth(30)
      btnBg.setInteractive(new Phaser.Geom.Rectangle(bx - bw / 2, by - bh / 2, bw, bh), Phaser.Geom.Rectangle.Contains)
      btnBg.on('pointerdown', () => this.upgradeTower(t))
      this.upgradePanel = panel
    } else if (t.level === 2) {
      // BRANCH choice — two mutually-exclusive final forms
      const label = this.add
        .text(-w / 2 + 20, -h / 2 + 78, 'CHOOSE A PATH:', { fontFamily: 'Arial Black', fontSize: '18px', color: '#ffd54a' })
        .setOrigin(0, 0)
      children.push(label)
      const panel = this.add.container(x, y, children).setDepth(30)
      t.def.branches.forEach((br, idx) => {
        const bw = 218, bh = 66
        const bx = idx === 0 ? -w / 2 + 20 + bw / 2 : w / 2 - 20 - bw / 2
        const by = h / 2 - bh / 2 - 12
        const cost = Math.round(br.upgradeCost * this.mods.towerCostMult)
        const afford = this.gold >= cost
        const bBg = this.add.graphics()
        bBg.fillStyle(afford ? t.def.color : 0x555070, 0.9)
        bBg.fillRoundedRect(bx - bw / 2, by - bh / 2, bw, bh, 12)
        bBg.lineStyle(3, 0xffffff, 0.3)
        bBg.strokeRoundedRect(bx - bw / 2, by - bh / 2, bw, bh, 12)
        const bName = this.add.text(bx, by - 12, br.name, { fontFamily: 'Arial Black', fontSize: '19px', color: '#ffffff' }).setOrigin(0.5)
        const bCost = this.add.text(bx, by + 12, `$${cost} · ${br.blurb}`.slice(0, 30), { fontFamily: 'Arial', fontSize: '13px', color: '#eae0ff' }).setOrigin(0.5)
        panel.add([bBg, bName, bCost])
        bBg.setInteractive(new Phaser.Geom.Rectangle(bx - bw / 2, by - bh / 2, bw, bh), Phaser.Geom.Rectangle.Contains)
        bBg.on('pointerdown', () => this.chooseBranch(t, idx))
      })
      this.upgradePanel = panel
    } else {
      const maxTxt = this.add.text(w / 2 - 20, 10, 'MAX', { fontFamily: 'Arial Black', fontSize: '28px', color: '#ffd54a' }).setOrigin(1, 0.5)
      const blurb = this.add.text(-w / 2 + 20, h / 2 - 40, (cur as TowerBranch).blurb ?? '', { fontFamily: 'Arial', fontSize: '17px', color: '#ffe27a' }).setOrigin(0, 0)
      children.push(maxTxt, blurb)
      this.upgradePanel = this.add.container(x, y, children).setDepth(30)
    }
    this.upgradePanel.setScale(0.85)
    this.tweens.add({ targets: this.upgradePanel, scale: 1, duration: 160, ease: 'Back.easeOut' })
  }

  private upgradeTower(t: Tower): void {
    if (t.level >= 2) return
    const next = t.def.levels[t.level + 1]
    const cost = Math.round(next.upgradeCost * this.mods.towerCostMult)
    if (this.gold < cost) {
      this.floatText(t.x, t.y - 30, 'NEED GOLD', 0xff5b7a)
      return
    }
    this.spendGold(cost)
    t.level++
    this.recomputeBuffs()
    this.tweens.add({ targets: t.cont, scale: 1 + 0.1 * t.level, duration: 220, ease: 'Back.easeOut' })
    this.pulseRing(t.x, t.y, this.effRange(t), t.def.color)
    this.floatText(t.x, t.y - 34, `LV ${t.level + 1}!`, t.def.color)
    this.cameras.main.shake(80, 0.003)
    this.showUpgradePanel(t)
  }

  private chooseBranch(t: Tower, idx: number): void {
    const br = t.def.branches[idx]
    const cost = Math.round(br.upgradeCost * this.mods.towerCostMult)
    if (this.gold < cost) {
      this.floatText(t.x, t.y - 30, 'NEED GOLD', 0xff5b7a)
      return
    }
    this.spendGold(cost)
    t.level = 3
    t.branch = idx
    this.recomputeBuffs()
    // evolve the turret: add a bright evolved core
    const core = this.add.circle(0, 0, 10, 0xffffff, 0.9)
    t.cont.add(core)
    this.tweens.add({ targets: core, scale: 0, alpha: 0, duration: 500, onComplete: () => core.destroy() })
    this.tweens.add({ targets: t.cont, scale: 1.35, duration: 260, ease: 'Back.easeOut' })
    this.pulseRing(t.x, t.y, this.effRange(t), t.def.color)
    this.floatText(t.x, t.y - 40, `${br.name.toUpperCase()}!`, t.def.color, 30)
    this.cameras.main.shake(140, 0.006)
    this.cameras.main.flash(160, (t.def.color >> 16) & 255, (t.def.color >> 8) & 255, t.def.color & 255)
    this.showUpgradePanel(t)
  }

  // ---- Waves ---------------------------------------------------------------
  private enterPrep(): void {
    this.state = 'prep'
    this.prepTimer = this.waveIndex === 0 ? 6 : 7
    this.startBtn.setVisible(true)
    this.updateWaveText()
  }

  private startWave(): void {
    if (this.state !== 'prep') return
    const bonus = Math.ceil(this.prepTimer) * 2
    if (bonus > 0) {
      this.addGold(bonus)
      this.floatText(360, 250, `+${bonus} EARLY`, C.gold)
    }
    this.state = 'active'
    this.startBtn.setVisible(false)
    this.buildSpawnQueue()
  }

  private buildSpawnQueue(): void {
    this.spawnQueue = []
    const wave = this.currentWave()
    let t = this.clock + 0.4
    for (const entry of wave.entries) {
      for (let i = 0; i < entry.count; i++) {
        this.spawnQueue.push({ kind: entry.kind, hpMul: entry.hpMul, at: t })
        t += entry.spacing
      }
      t += 0.5
    }
  }

  private updateWaveText(): void {
    if (this.endless) this.waveText.setText(`WAVE ${this.waveIndex + 1} ∞`)
    else this.waveText.setText(`WAVE ${Math.min(this.waveIndex + 1, this.waveTable.length)}/${this.waveTable.length}`)
  }

  private waveCleared(): void {
    const bonus = this.currentWave().clearBonus
    this.addGold(bonus)
    this.floatText(360, 250, `WAVE CLEAR  +${bonus}`, C.base)
    if (!this.endless && this.waveIndex >= this.waveTable.length - 1) {
      this.win()
      return
    }
    this.waveIndex++
    this.updateWaveText()
    this.enterPrep()
  }

  // ---- Enemies -------------------------------------------------------------
  private spawnEnemy(kind: EnemyKind, hpMul: number): void {
    const def = ENEMIES[kind]
    const maxHp = Math.round(def.hp * hpMul)
    const start = this.positionAt(0)
    const body = this.makeEnemyBody(def)
    const shieldMax = def.shield ? Math.round(def.shield * hpMul) : 0
    let shieldGfx: Phaser.GameObjects.Arc | null = null
    if (shieldMax > 0) {
      shieldGfx = this.add.circle(0, 0, def.radius + 7, 0x9fdcff, 0.0)
      shieldGfx.setStrokeStyle(3, 0x9fdcff, 0.8)
    }
    const hpBg = this.add.rectangle(0, -def.radius - 12, def.radius * 2 + 6, 7, 0x000000, 0.55)
    const hpFill = this.add.rectangle(-(def.radius + 3), -def.radius - 12, def.radius * 2 + 6, 7, 0x36e05a).setOrigin(0, 0.5)
    const tag = this.add.text(0, -def.radius - 26, '', { fontFamily: 'Arial Black', fontSize: '15px', color: '#4ad9ff' }).setOrigin(0.5)
    const kids: Phaser.GameObjects.GameObject[] = [body]
    if (shieldGfx) kids.push(shieldGfx)
    kids.push(hpBg, hpFill, tag)
    const cont = this.add.container(start.x, start.y, kids).setDepth(def.flying ? 9 : 7)
    if (def.flying) {
      // little drop shadow to sell altitude
      const shadow = this.add.ellipse(0, def.radius + 6, def.radius * 1.4, def.radius * 0.5, 0x000000, 0.25)
      cont.addAt(shadow, 0)
    }
    const enemy: Enemy = {
      def, cont, body, hpBg, hpFill, tag, shieldGfx,
      maxHp, hp: maxHp, shield: shieldMax, shieldMax,
      dist: 0, x: start.x, y: start.y,
      slowUntil: 0, slowFactor: 1, stunUntil: 0,
      burnUntil: 0, burnDps: 0, burnTick: 0, healTick: 0, weakUntil: 0, alive: true,
    }
    this.enemies.push(enemy)
    cont.setScale(0.3)
    this.tweens.add({ targets: cont, scale: 1, duration: 200, ease: 'Back.easeOut' })
    if (def.boss) this.cameras.main.shake(200, 0.006)
  }

  private makeEnemyBody(def: EnemyDef): Phaser.GameObjects.Shape {
    let body: Phaser.GameObjects.Shape
    const r = def.radius
    if (def.shape === 'triangle') {
      body = this.add.triangle(0, 0, 0, r, r, -r * 0.9, -r, -r * 0.9, def.color)
    } else if (def.shape === 'square') {
      body = this.add.rectangle(0, 0, r * 1.8, r * 1.8, def.color)
    } else if (def.shape === 'circle') {
      body = this.add.circle(0, 0, r, def.color)
    } else if (def.shape === 'diamond') {
      body = this.add.polygon(0, 0, [0, -r, r, 0, 0, r, -r, 0], def.color)
    } else {
      const pts: number[] = []
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 2
        pts.push(Math.cos(a) * r, Math.sin(a) * r)
      }
      body = this.add.polygon(0, 0, pts, def.color)
    }
    body.setStrokeStyle(3, def.accent)
    return body
  }

  private updateEnemies(dt: number): void {
    if (this.state === 'active') {
      while (this.spawnQueue.length && this.spawnQueue[0].at <= this.clock) {
        const item = this.spawnQueue.shift()!
        this.spawnEnemy(item.kind, item.hpMul)
      }
    }

    for (const e of this.enemies) {
      if (!e.alive) continue
      // burn DoT
      if (e.burnUntil > this.clock && e.burnDps > 0) {
        e.burnTick += dt
        this.applyDamageRaw(e, e.burnDps * dt)
        if (e.burnTick >= 0.4 && e.alive) {
          this.floatText(e.x + 12, e.y - e.def.radius, `${Math.round(e.burnDps * 0.4)}`, 0xff8a3c, 18)
          e.burnTick = 0
        }
        if (!e.alive) continue
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
      else if (slowed) speed *= e.slowFactor
      e.dist += speed * dt
      const pos = this.positionAt(e.dist)
      e.x = pos.x
      e.y = pos.y
      e.cont.setPosition(pos.x, pos.y)

      // visuals
      const burning = e.burnUntil > this.clock
      if (stunned) e.body.setFillStyle(0xbfeaff)
      else if (slowed) e.body.setFillStyle(0x8fe9ff)
      else if (burning) e.body.setFillStyle(0xffb15c)
      else e.body.setFillStyle(e.def.color)
      if (stunned) e.tag.setText('FROZEN').setColor('#bfeaff').setVisible(true)
      else if (slowed) e.tag.setText('SLOW').setColor('#4ad9ff').setVisible(true)
      else if (burning) e.tag.setText('BURN').setColor('#ff8a3c').setVisible(true)
      else e.tag.setVisible(false)
      if (e.shieldGfx) e.shieldGfx.setStrokeStyle(3, 0x9fdcff, e.shield > 0 ? 0.8 : 0)

      const ratio = Phaser.Math.Clamp(e.hp / e.maxHp, 0, 1)
      e.hpFill.width = (e.def.radius * 2 + 6) * ratio
      e.hpFill.setFillStyle(ratio > 0.5 ? 0x36e05a : ratio > 0.25 ? 0xffd54a : 0xff5b7a)

      if (pos.done) this.enemyReachedBase(e)
    }

    this.enemies = this.enemies.filter((e) => e.alive)

    if (this.state === 'active' && this.spawnQueue.length === 0 && this.enemies.length === 0) {
      this.waveCleared()
    }
  }

  private doHeal(healer: Enemy): void {
    const radius = (healer.def.healRadius ?? 2) * TILE
    const amount = healer.def.healAmount ?? 10
    // gather first, then apply (no mutation of list here, but keep discipline)
    const allies = this.enemies.filter(
      (e) => e.alive && e !== healer && e.hp < e.maxHp && this.dist2(healer.x, healer.y, e.x, e.y) <= radius * radius,
    )
    this.pulseRing(healer.x, healer.y, radius, 0x6bffb0, 0.6)
    let any = false
    for (const a of allies) {
      a.hp = Math.min(a.maxHp, a.hp + amount)
      this.floatText(a.x, a.y - a.def.radius - 8, `+${amount}`, 0x6bffb0, 18)
      any = true
    }
    if (any) this.floatText(healer.x, healer.y - healer.def.radius - 20, 'HEAL', 0x6bffb0, 20)
  }

  private enemyReachedBase(e: Enemy): void {
    e.alive = false
    e.cont.destroy()
    this.loseLife(e.def.boss ? 5 : 1)
    const base = this.waypoints[this.waypoints.length - 1]
    this.cameras.main.shake(180, 0.008)
    this.cameras.main.flash(120, 255, 60, 90)
    this.pulseRing(base.x, base.y, 40, C.life)
  }

  // ---- Combat --------------------------------------------------------------
  private canTarget(t: Tower, e: Enemy): boolean {
    if (!e.alive) return false
    if (e.def.flying && !t.def.antiAir) return false
    return true
  }

  private updateTowers(dt: number): void {
    for (const t of this.towers) {
      const range = this.effRange(t)
      t.cd -= dt

      if (t.def.kind === 'frost') {
        for (const e of this.enemies) {
          if (!this.canTarget(t, e)) continue
          if (this.dist2(t.x, t.y, e.x, e.y) <= range * range) {
            const s = this.currentStats(t)
            e.slowUntil = this.clock + (s.slowDuration ?? 1)
            e.slowFactor = Math.min(e.slowFactor, s.slowFactor ?? 0.5)
            if (s.stunDuration) e.stunUntil = Math.max(e.stunUntil, this.clock + s.stunDuration)
          }
        }
      }

      if (t.cd > 0) continue
      const target = this.acquire(t, range)
      if (!target) continue
      t.cd = this.effCooldown(t)
      this.aimTurret(t, target)

      if (t.def.kind === 'cannon') {
        const s = this.currentStats(t)
        this.fireProjectile(t, target, this.effDamage(t), (s.splash ?? 0) * TILE)
      } else if (t.def.kind === 'frost') {
        this.frostZap(t, range, this.effDamage(t))
      } else if (t.def.kind === 'flame') {
        this.flameBurst(t, target, this.effDamage(t))
      } else if (t.def.kind === 'storm') {
        this.stormBolt(t, target, this.effDamage(t))
      } else {
        this.arcaneZap(t, target, this.effDamage(t))
      }
    }
  }

  private acquire(t: Tower, range: number): Enemy | null {
    let best: Enemy | null = null
    let bestDist = Infinity
    const r2 = range * range
    for (const e of this.enemies) {
      if (!this.canTarget(t, e)) continue
      const d2 = this.dist2(t.x, t.y, e.x, e.y)
      if (d2 <= r2 && d2 < bestDist) {
        bestDist = d2
        best = e
      }
    }
    return best
  }

  private aimTurret(t: Tower, target: Enemy): void {
    const ang = Phaser.Math.Angle.Between(t.x, t.y, target.x, target.y)
    t.turret.setRotation(ang + Math.PI / 2)
  }

  private fireProjectile(t: Tower, target: Enemy, damage: number, splash: number): void {
    const gfx = this.add.circle(t.x, t.y - 6, 8, 0x1a1030).setDepth(8)
    gfx.setStrokeStyle(3, t.def.color)
    const flash = this.add.circle(t.x, t.y - 20, 12, 0xffe9a6, 0.9).setDepth(8)
    this.tweens.add({ targets: flash, scale: 0, alpha: 0, duration: 140, onComplete: () => flash.destroy() })
    this.projectiles.push({ gfx, x: t.x, y: t.y - 6, target, tx: target.x, ty: target.y, speed: 760, damage, source: t.def, splash })
  }

  private frostZap(t: Tower, range: number, damage: number): void {
    this.pulseRing(t.x, t.y, range, t.def.color, 0.5)
    const targets = this.enemies.filter((e) => this.canTarget(t, e) && this.dist2(t.x, t.y, e.x, e.y) <= range * range)
    for (const e of targets) this.dealDamage(e, damage, t.def)
  }

  private flameBurst(t: Tower, target: Enemy, damage: number): void {
    const s = this.currentStats(t)
    const ang = Phaser.Math.Angle.Between(t.x, t.y, target.x, target.y)
    const fx = this.add.circle(t.x + Math.cos(ang) * 24, t.y + Math.sin(ang) * 24, 16, 0xff8a3c, 0.9).setDepth(8)
    this.tweens.add({ targets: fx, scale: 2.2, alpha: 0, duration: 220, onComplete: () => fx.destroy() })
    const splash = (s.splash ?? 1) * TILE
    const targets = this.enemies.filter((e) => this.canTarget(t, e) && this.dist2(target.x, target.y, e.x, e.y) <= splash * splash)
    for (const e of targets) {
      if (!e.alive) continue
      this.dealDamage(e, damage, t.def)
      if (e.alive) {
        e.burnUntil = this.clock + (s.burnDuration ?? 2)
        e.burnDps = Math.max(e.burnDps, s.burnDps ?? 8)
      }
    }
  }

  // Storm: bounce a bolt across nearby enemies. Build the FULL chain first,
  // draw it, THEN apply damage — never touch an enemy that a kill may free.
  private stormBolt(t: Tower, first: Enemy, baseDamage: number): void {
    const s = this.currentStats(t)
    let chainCount = s.chainCount ?? 0
    const chainRange = (s.chainRange ?? 2) * TILE
    const falloff = s.chainFalloff ?? 0.85
    // Synergy: chains further off frost-slowed enemies
    const superCharged = first.slowUntil > this.clock
    if (superCharged && chainCount > 0) {
      chainCount += 2
      this.floatText(first.x, first.y - first.def.radius - 34, 'SUPERCHARGED!', 0xffe14a, 24)
    }
    const chain: Enemy[] = [first]
    const used = new Set<Enemy>([first])
    let cursor = first
    while (chain.length <= chainCount) {
      let best: Enemy | null = null
      let bestD = Infinity
      const r2 = chainRange * chainRange
      for (const e of this.enemies) {
        if (!e.alive || used.has(e)) continue
        if (e.def.flying && !t.def.antiAir) continue
        const d2 = this.dist2(cursor.x, cursor.y, e.x, e.y)
        if (d2 <= r2 && d2 < bestD) { bestD = d2; best = e }
      }
      if (!best) break
      chain.push(best)
      used.add(best)
      cursor = best
    }
    // draw the bolt
    const g = this.add.graphics().setDepth(11)
    g.lineStyle(4, 0xffffff, 0.95)
    g.beginPath()
    g.moveTo(t.x, t.y)
    for (const e of chain) {
      // jagged segment
      const midx = (t.x + e.x) / 2 + Phaser.Math.Between(-10, 10)
      const midy = (t.y + e.y) / 2 + Phaser.Math.Between(-10, 10)
      g.lineTo(midx, midy)
      g.lineTo(e.x, e.y)
    }
    g.strokePath()
    const g2 = this.add.graphics().setDepth(10)
    g2.lineStyle(9, t.def.color, 0.5)
    g2.beginPath()
    g2.moveTo(t.x, t.y)
    for (const e of chain) g2.lineTo(e.x, e.y)
    g2.strokePath()
    this.tweens.add({ targets: [g, g2], alpha: 0, duration: 220, onComplete: () => { g.destroy(); g2.destroy() } })
    if (chain.length > 1) this.floatText(chain[chain.length - 1].x, chain[chain.length - 1].y - 24, `CHAIN x${chain.length}`, 0xffe14a, 20)
    // apply damage last, with per-jump falloff
    let dmg = baseDamage
    for (const e of chain) {
      if (!e.alive) continue
      this.hitSpark(e.x, e.y, t.def.color)
      this.dealDamage(e, dmg, t.def)
      dmg *= falloff
    }
  }

  // Arcane: a support beam that also zaps its target (Prism branch hits hard).
  private arcaneZap(t: Tower, target: Enemy, damage: number): void {
    const g = this.add.graphics().setDepth(10)
    g.lineStyle(5, t.def.color, 0.8)
    g.lineBetween(t.x, t.y, target.x, target.y)
    this.tweens.add({ targets: g, alpha: 0, duration: 200, onComplete: () => g.destroy() })
    this.hitSpark(target.x, target.y, t.def.color)
    this.dealDamage(target, damage, t.def)
  }

  private updateProjectiles(dt: number): void {
    for (const p of this.projectiles) {
      if (p.target && p.target.alive) {
        p.tx = p.target.x
        p.ty = p.target.y
      }
      const ang = Math.atan2(p.ty - p.y, p.tx - p.x)
      const step = p.speed * dt
      const d = Phaser.Math.Distance.Between(p.x, p.y, p.tx, p.ty)
      if (d <= step + 6) {
        this.hitSpark(p.tx, p.ty, p.source.color)
        if (p.splash > 0) {
          // splash: gather then damage
          this.pulseRing(p.tx, p.ty, p.splash, p.source.color, 0.6)
          const hits = this.enemies.filter((e) => e.alive && !(e.def.flying && !p.source.antiAir) && this.dist2(p.tx, p.ty, e.x, e.y) <= p.splash * p.splash)
          for (const e of hits) if (e.alive) this.dealDamage(e, p.damage, p.source)
        } else if (p.target && p.target.alive) {
          this.dealDamage(p.target, p.damage, p.source)
        }
        p.gfx.destroy()
        p.gfx.setData('dead', true)
      } else {
        p.x += Math.cos(ang) * step
        p.y += Math.sin(ang) * step
        p.gfx.setPosition(p.x, p.y)
      }
    }
    this.projectiles = this.projectiles.filter((p) => !p.gfx.getData('dead'))
  }

  // Damage from a tower (applies synergy + shield). Order: compute → float text
  // + squash while alive → THEN applyDamageRaw (which may destroy the container).
  private dealDamage(e: Enemy, amount: number, source: TowerDef): void {
    if (!e.alive) return
    let dmg = amount
    let weak = false
    if (source.synergyDamage && e.slowUntil > this.clock) {
      dmg *= SYNERGY_MULT
      weak = true
    }
    // shield absorption
    if (e.shield > 0) {
      const block = e.def.shieldBlock ?? 0.6
      const absorbed = Math.min(e.shield, dmg * block)
      e.shield -= absorbed
      dmg -= absorbed
      if (e.shield <= 0) {
        e.shield = 0
        this.floatText(e.x, e.y - e.def.radius - 30, 'SHIELD BREAK!', 0x9fdcff, 22)
        this.pulseRing(e.x, e.y, e.def.radius + 10, 0x9fdcff, 0.9)
      }
    }
    this.floatText(e.x + Phaser.Math.Between(-8, 8), e.y - e.def.radius - 6, `${Math.round(dmg)}`, 0xffffff, weak ? 26 : 22)
    this.tweens.add({ targets: e.cont, scaleX: 1.22, scaleY: 0.82, duration: 70, yoyo: true })
    if (weak && this.clock > e.weakUntil) {
      e.weakUntil = this.clock + 0.5
      this.floatText(e.x, e.y - e.def.radius - 30, 'WEAK! +50%', 0xffd54a, 24)
    }
    this.applyDamageRaw(e, dmg)
  }

  // Direct damage (spells) — respects shield, ignores synergy.
  private dealDamageDirect(e: Enemy, amount: number): void {
    if (!e.alive) return
    let dmg = amount
    if (e.shield > 0) {
      const block = e.def.shieldBlock ?? 0.6
      const absorbed = Math.min(e.shield, dmg * block)
      e.shield -= absorbed
      dmg -= absorbed
      if (e.shield <= 0) e.shield = 0
    }
    this.floatText(e.x, e.y - e.def.radius - 6, `${Math.round(dmg)}`, 0xffe0a0, 24)
    this.applyDamageRaw(e, dmg)
  }

  private applyDamageRaw(e: Enemy, dmg: number): void {
    if (!e.alive) return
    e.hp -= dmg
    if (e.hp <= 0) this.killEnemy(e)
  }

  private killEnemy(e: Enemy): void {
    if (!e.alive) return
    e.alive = false
    const reward = Math.round(e.def.reward * this.mods.goldGainMult)
    this.addGold(reward)
    this.spawnCoins(e.x, e.y, reward)
    this.deathBurst(e.x, e.y, e.def.color)
    if (e.def.boss) {
      this.cameras.main.shake(320, 0.012)
      this.cameras.main.flash(200, 255, 120, 200)
    } else if (e.def.kind === 'brute') {
      this.cameras.main.shake(160, 0.006)
    }
    e.cont.destroy()
  }

  // ---- Economy / lives -----------------------------------------------------
  private spendGold(n: number): void {
    this.gold -= n
    this.updateGoldText()
    this.refreshTowerButtons()
  }
  private addGold(n: number): void {
    this.gold += n
    this.updateGoldText()
    this.refreshTowerButtons()
  }
  private updateGoldText(): void {
    this.goldText.setText(`${this.gold}`)
    this.tweens.add({ targets: this.goldText, scale: 1.25, duration: 90, yoyo: true })
  }
  private loseLife(n: number): void {
    this.lives = Math.max(0, this.lives - n)
    this.livesText.setText(`${this.lives}`)
    this.tweens.add({ targets: this.livesText, scale: 1.4, duration: 110, yoyo: true })
    if (this.lives <= 0 && this.state !== 'lost' && this.state !== 'won') this.lose()
  }

  // ---- Juice ---------------------------------------------------------------
  private floatText(x: number, y: number, msg: string, color: number, size = 24): void {
    const hex = '#' + color.toString(16).padStart(6, '0')
    const t = this.add.text(x, y, msg, { fontFamily: 'Arial Black', fontSize: `${size}px`, color: hex }).setOrigin(0.5).setDepth(15)
    t.setStroke('#000000', 4)
    t.setScale(0.4)
    this.tweens.add({ targets: t, scale: 1, duration: 120, ease: 'Back.easeOut' })
    this.tweens.add({ targets: t, y: y - 44, alpha: 0, delay: 220, duration: 560, ease: 'Cubic.easeIn', onComplete: () => t.destroy() })
  }

  private hitSpark(x: number, y: number, color: number): void {
    for (let i = 0; i < 5; i++) {
      const a = Phaser.Math.FloatBetween(0, Math.PI * 2)
      const sp = this.add.circle(x, y, Phaser.Math.Between(2, 4), color).setDepth(14)
      this.tweens.add({
        targets: sp, x: x + Math.cos(a) * Phaser.Math.Between(14, 30), y: y + Math.sin(a) * Phaser.Math.Between(14, 30),
        alpha: 0, duration: 260, onComplete: () => sp.destroy(),
      })
    }
  }

  private deathBurst(x: number, y: number, color: number): void {
    const flash = this.add.circle(x, y, 20, 0xffffff, 0.9).setDepth(14)
    this.tweens.add({ targets: flash, scale: 1.8, alpha: 0, duration: 220, onComplete: () => flash.destroy() })
    for (let i = 0; i < 10; i++) {
      const a = (Math.PI * 2 * i) / 10 + Phaser.Math.FloatBetween(-0.3, 0.3)
      const piece = this.add.rectangle(x, y, 8, 8, color).setDepth(14).setAngle(Phaser.Math.Between(0, 360))
      this.tweens.add({
        targets: piece, x: x + Math.cos(a) * Phaser.Math.Between(24, 54), y: y + Math.sin(a) * Phaser.Math.Between(24, 54),
        angle: piece.angle + 220, alpha: 0, scale: 0.2, duration: Phaser.Math.Between(320, 500), ease: 'Cubic.easeOut', onComplete: () => piece.destroy(),
      })
    }
  }

  private spawnCoins(x: number, y: number, amount: number): void {
    const n = Phaser.Math.Clamp(Math.round(amount / 4), 2, 6)
    for (let i = 0; i < n; i++) {
      const coin = this.add.circle(x, y, 7, C.gold).setDepth(16)
      coin.setStrokeStyle(2, 0xffe9a6)
      const midx = x + Phaser.Math.Between(-40, 40)
      const midy = y - Phaser.Math.Between(30, 70)
      this.tweens.add({
        targets: coin, x: midx, y: midy, duration: 180, ease: 'Cubic.easeOut',
        onComplete: () => {
          this.tweens.add({
            targets: coin, x: this.goldIcon.x, y: this.goldIcon.y, scale: 0.4, delay: i * 20, duration: 320, ease: 'Cubic.easeIn',
            onComplete: () => {
              coin.destroy()
              this.tweens.add({ targets: this.goldText, scale: 1.3, duration: 80, yoyo: true })
            },
          })
        },
      })
    }
  }

  private pulseRing(x: number, y: number, r: number, color: number, alpha = 0.8): void {
    const ring = this.add.circle(x, y, r * 0.4, color, 0).setDepth(13)
    ring.setStrokeStyle(4, color, alpha)
    this.tweens.add({ targets: ring, scale: 2.6, alpha: 0, duration: 340, ease: 'Cubic.easeOut', onComplete: () => ring.destroy() })
  }

  // ---- Controls ------------------------------------------------------------
  private togglePause(): void {
    if (this.state === 'won' || this.state === 'lost') return
    this.paused = !this.paused
    if (this.pauseLabel) this.pauseLabel.setText(this.paused ? '▶' : 'II')
    this.tweens.timeScale = this.paused ? 0 : this.gameSpeed
    if (this.paused) this.showBanner('PAUSED')
    else this.clearBanner()
  }

  private toggleSpeed(): void {
    this.gameSpeed = this.gameSpeed === 1 ? 2 : 1
    if (this.speedLabel) this.speedLabel.setText(`${this.gameSpeed}x`)
    if (!this.paused) this.tweens.timeScale = this.gameSpeed
  }

  private showBanner(msg: string): void {
    this.clearBanner()
    this.banner = this.add.text(360, 640, msg, { fontFamily: 'Arial Black', fontSize: '64px', color: '#ffffff' }).setOrigin(0.5).setDepth(40)
    this.banner.setStroke('#7b2ff7', 10)
  }
  private clearBanner(): void {
    this.banner?.destroy()
    this.banner = undefined
  }

  // ---- Win / lose ----------------------------------------------------------
  private win(): void {
    this.state = 'won'
    const stars = starsForClear(this.lives, this.startLives)
    const result = economy.awardCampaign(this.level.id, stars, this.level.baseCoins)
    let unlocked: string | null = null
    if (result.firstClear && this.level.unlockTower && !economy.isTowerUnlocked(this.level.unlockTower)) {
      economy.unlockTower(this.level.unlockTower)
      unlocked = TOWERS[this.level.unlockTower].name
    }
    for (let i = 0; i < 3; i++) this.time.delayedCall(i * 250, () => this.cameras.main.flash(200, 47, 247, 195))
    this.resultPanel('VICTORY!', C.base, stars, result.coins, result.diamonds, unlocked)
  }

  private lose(): void {
    this.state = 'lost'
    this.cameras.main.shake(300, 0.01)
    if (this.endless) {
      const res = economy.awardEndless(this.waveIndex)
      this.resultPanel('DEFEAT', C.life, 0, res.coins, 0, null, `Reached wave ${this.waveIndex + 1}${res.best ? ' · NEW BEST!' : ''}`)
    } else {
      this.resultPanel('DEFEAT', C.life, 0, 0, 0, null, 'The crystal was overrun…')
    }
  }

  private resultPanel(
    title: string, color: number, stars: number, coins: number, diamonds: number, unlocked: string | null, subOverride?: string,
  ): void {
    this.buildKind = null
    this.aimingSpell = null
    this.mode = 'idle'
    this.clearGhost()
    this.clearAimReticle()
    this.deselect()
    this.startBtn.setVisible(false)
    const overlay = this.add.rectangle(360, 640, 720, 1280, 0x000000, 0.62).setDepth(38)
    overlay.setInteractive()
    const w = 580, h = 560
    const bg = this.add.graphics().setDepth(39)
    bg.fillStyle(0x1c1038, 0.98)
    bg.fillRoundedRect(360 - w / 2, 640 - h / 2, w, h, 26)
    bg.lineStyle(6, color, 1)
    bg.strokeRoundedRect(360 - w / 2, 640 - h / 2, w, h, 26)
    const hex = '#' + color.toString(16).padStart(6, '0')
    const t = this.add.text(360, 470, title, { fontFamily: 'Arial Black', fontSize: '70px', color: hex }).setOrigin(0.5).setDepth(40)
    t.setStroke('#000000', 8)

    // stars (campaign win)
    if (!this.endless && title === 'VICTORY!') {
      for (let i = 0; i < 3; i++) {
        const filled = i < stars
        const star = this.add.star(360 - 90 + i * 90, 560, 5, 18, 40, filled ? C.gold : 0x3a2c66).setDepth(40)
        star.setStrokeStyle(4, filled ? 0xffe9a6 : 0x554a86)
        star.setScale(0)
        this.tweens.add({ targets: star, scale: 1, duration: 300, delay: 300 + i * 160, ease: 'Back.easeOut' })
        if (filled) this.time.delayedCall(300 + i * 160, () => this.pulseRing(star.x, star.y, 44, C.gold))
      }
    } else if (subOverride) {
      this.add.text(360, 560, subOverride, { fontFamily: 'Arial', fontSize: '26px', color: '#d8d0ff' }).setOrigin(0.5).setDepth(40)
    }

    // rewards
    let ry = 640
    if (coins > 0) {
      this.add.text(360, ry, `+${coins} 🪙 Coins`, { fontFamily: 'Arial Black', fontSize: '30px', color: '#ffe27a' }).setOrigin(0.5).setDepth(40)
      ry += 46
    }
    if (diamonds > 0) {
      this.add.text(360, ry, `+${diamonds} 💎 Diamonds`, { fontFamily: 'Arial Black', fontSize: '30px', color: '#8fe9ff' }).setOrigin(0.5).setDepth(40)
      ry += 46
    }
    if (unlocked) {
      this.add.text(360, ry, `NEW TOWER: ${unlocked}!`, { fontFamily: 'Arial Black', fontSize: '26px', color: '#c06bff' }).setOrigin(0.5).setDepth(40)
      ry += 46
    }

    // buttons
    const retry = this.makeButtonSync(360, 800, 300, 74, 'REPLAY', 0x4a3a7a, () => {
      this.cameras.main.fadeOut(220, 20, 12, 50)
      this.time.delayedCall(240, () => this.scene.restart({ levelId: this.levelId, endless: this.endless }))
    })
    retry.setDepth(41).setScale(0.6)
    this.tweens.add({ targets: retry, scale: 1, duration: 300, ease: 'Back.easeOut' })
    const back = this.makeButtonSync(360, 888, 300, 74, this.endless ? 'MENU' : 'WORLD MAP', 0x2ea043, () => {
      this.cameras.main.fadeOut(220, 20, 12, 50)
      this.time.delayedCall(240, () => this.scene.start(this.endless ? 'Menu' : 'Map'))
    })
    back.setDepth(41).setScale(0.6)
    this.tweens.add({ targets: back, scale: 1, duration: 300, delay: 80, ease: 'Back.easeOut' })
  }

  private dist2(ax: number, ay: number, bx: number, by: number): number {
    const dx = ax - bx
    const dy = ay - by
    return dx * dx + dy * dy
  }

  // ---- Main loop -----------------------------------------------------------
  update(_time: number, delta: number): void {
    if (this.paused || this.state === 'won' || this.state === 'lost') return
    const dt = (delta / 1000) * this.gameSpeed
    if (dt <= 0) return
    this.clock += dt

    if (this.state === 'prep') {
      this.prepTimer -= dt
      const secs = Math.max(0, Math.ceil(this.prepTimer))
      this.startLabel.setText(`START ▶ (${secs})`)
      if (this.prepTimer <= 0) this.startWave()
    }

    this.updateEnemies(dt)
    this.updateTowers(dt)
    this.updateProjectiles(dt)
    this.updateSpellCooldowns(dt)
  }

  private updateSpellCooldowns(dt: number): void {
    for (const sb of this.spellButtons) {
      if (sb.cd > 0) {
        sb.cd = Math.max(0, sb.cd - dt)
        sb.ring.clear()
        if (sb.cd > 0) {
          const frac = sb.cd / sb.maxCd
          sb.ring.fillStyle(0x000000, 0.55)
          sb.ring.slice(0, 0, 30, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac, false)
          sb.ring.fillPath()
        } else {
          this.pulseRing(sb.cont.x, sb.cont.y, 34, sb.def.color, 0.9)
          this.floatText(sb.cont.x, sb.cont.y - 40, 'READY', sb.def.color, 18)
        }
      }
    }
  }
}
