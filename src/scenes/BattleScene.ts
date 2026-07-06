import Phaser from 'phaser'
import { ENEMIES, type EnemyDef, type EnemyKind } from '../game/enemies'
import {
  TOWERS,
  TOWER_ORDER,
  SYNERGY_MULT,
  type TowerDef,
  type TowerKind,
} from '../game/towers'
import { WAVES } from '../game/waves'

// ---- Layout constants (720x1280 portrait) ---------------------------------
const COLS = 9
const ROWS = 11
const TILE = 80
const MAP_X = 0
const MAP_Y = 200
const MAP_W = COLS * TILE // 720
const MAP_H = ROWS * TILE // 880  -> map spans y 200..1080

const START_GOLD = 260
const START_LIVES = 20

// Candy palette
const C = {
  grassA: 0x53c66e,
  grassB: 0x49b862,
  build: 0x74d98a,
  buildHi: 0xa6f0b5,
  path: 0xffcf5c,
  pathEdge: 0xe0a838,
  base: 0x2ff7c3,
  portal: 0x9a5cff,
  hudBg: 0x241447,
  panel: 0x2e1a5a,
  gold: 0xffd54a,
  life: 0xff5b7a,
  white: 0xffffff,
}

// Serpentine path as grid cells (col,row). Enemies walk cell-centre to cell-centre.
const PATH_CELLS: Array<[number, number]> = [
  [0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 1], [7, 1],
  [7, 2], [7, 3],
  [6, 3], [5, 3], [4, 3], [3, 3], [2, 3], [1, 3],
  [1, 4], [1, 5],
  [2, 5], [3, 5], [4, 5], [5, 5], [6, 5], [7, 5],
  [7, 6], [7, 7],
  [6, 7], [5, 7], [4, 7], [3, 7], [2, 7], [1, 7],
  [1, 8], [1, 9],
  [2, 9], [3, 9], [4, 9], [5, 9], [6, 9], [7, 9],
  [7, 10],
]

type GameState = 'prep' | 'active' | 'won' | 'lost'

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
  maxHp: number
  hp: number
  dist: number // distance travelled along path (px)
  x: number
  y: number
  slowUntil: number
  slowFactor: number
  burnUntil: number
  burnDps: number
  burnTick: number
  weakUntil: number // throttle for WEAK popups
  alive: boolean
}

interface Tower {
  def: TowerDef
  level: number // 0..2
  col: number
  row: number
  x: number
  y: number
  cont: Phaser.GameObjects.Container
  turret: Phaser.GameObjects.Shape
  ring: Phaser.GameObjects.Arc
  cd: number
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
}

interface SpawnItem {
  kind: EnemyKind
  hpMul: number
  at: number // clock time to spawn
}

export class BattleScene extends Phaser.Scene {
  // grid: 'path' | 'build' | 'blocked'
  private grid: string[][] = []
  private occupied: (Tower | null)[][] = []
  private waypoints: { x: number; y: number }[] = []
  private segments: Segment[] = []
  private pathLength = 0

  private enemies: Enemy[] = []
  private towers: Tower[] = []
  private projectiles: Projectile[] = []

  private gold = START_GOLD
  private lives = START_LIVES
  private waveIndex = 0 // 0-based; display waveIndex+1
  private state: GameState = 'prep'
  private clock = 0 // seconds, scaled by game speed
  private gameSpeed = 1
  private paused = false

  private spawnQueue: SpawnItem[] = []
  private prepTimer = 0

  // build / selection
  private buildKind: TowerKind | null = null
  private ghost?: Phaser.GameObjects.Container
  private ghostRing?: Phaser.GameObjects.Arc
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
  private upgradePanel?: Phaser.GameObjects.Container

  constructor() {
    super('Battle')
  }

  create(): void {
    // reset (scene.restart re-runs create with fresh instance, but be safe)
    this.enemies = []
    this.towers = []
    this.projectiles = []
    this.gold = START_GOLD
    this.lives = START_LIVES
    this.waveIndex = 0
    this.state = 'prep'
    this.clock = 0
    this.gameSpeed = 1
    this.paused = false
    this.buildKind = null
    this.selected = null
    this.towerButtons = []
    this.spawnQueue = []
    this.ghost = undefined
    this.ghostRing = undefined
    this.upgradePanel = undefined
    this.banner = undefined
    this.tweens.timeScale = 1

    this.buildGrid()
    this.drawField()
    this.drawPath()
    this.drawPortalAndBase()
    this.buildHud()
    this.buildTowerBar()
    this.setupInput()
    this.enterPrep()

    this.cameras.main.fadeIn(350, 20, 12, 50)
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
    // mark path
    const onPath = new Set<string>()
    for (const [c, r] of PATH_CELLS) {
      if (r >= 0 && r < ROWS && c >= 0 && c < COLS) {
        this.grid[r][c] = 'path'
        onPath.add(`${c},${r}`)
      }
    }
    // buildable = non-path cell 8-adjacent to a path cell
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
    // waypoints (prepend an off-screen entry so enemies stroll in from the left)
    this.waypoints = []
    const first = PATH_CELLS[0]
    this.waypoints.push(this.cellCenter(first[0] - 1.2, first[1]))
    for (const [c, r] of PATH_CELLS) this.waypoints.push(this.cellCenter(c, r))
    // segments + length
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
    this.add.rectangle(360, 640, 720, 1280, C.hudBg).setDepth(0)
    // checker grass + buildable highlight
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cc = this.cellCenter(c, r)
        const cell = this.grid[r][c]
        let color = (c + r) % 2 === 0 ? C.grassA : C.grassB
        if (cell === 'build') color = (c + r) % 2 === 0 ? C.build : 0x66cf7d
        const rect = this.add
          .rectangle(cc.x, cc.y, TILE - 2, TILE - 2, color)
          .setDepth(1)
        if (cell === 'build') rect.setStrokeStyle(2, C.buildHi, 0.35)
      }
    }
  }

  private drawPath(): void {
    // wide road: draw rounded rects along each path cell + connectors, with edge underlay
    const g = this.add.graphics().setDepth(2)
    const roadW = TILE * 0.78
    // edge underlay
    g.fillStyle(C.pathEdge, 1)
    for (let i = 0; i < PATH_CELLS.length; i++) {
      const [c, r] = PATH_CELLS[i]
      const cc = this.cellCenter(c, r)
      g.fillRoundedRect(cc.x - roadW / 2 - 5, cc.y - roadW / 2 - 5, roadW + 10, roadW + 10, 14)
    }
    // bright road
    g.fillStyle(C.path, 1)
    for (let i = 0; i < PATH_CELLS.length; i++) {
      const [c, r] = PATH_CELLS[i]
      const cc = this.cellCenter(c, r)
      g.fillRoundedRect(cc.x - roadW / 2, cc.y - roadW / 2, roadW, roadW, 12)
    }
    // dashed centre line to sell "road" + direction
    const dash = this.add.graphics().setDepth(2)
    dash.fillStyle(0xffffff, 0.55)
    for (let i = 1; i < this.waypoints.length; i++) {
      const a = this.waypoints[i - 1]
      const b = this.waypoints[i]
      const len = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y)
      const steps = Math.max(1, Math.floor(len / 26))
      for (let s = 0; s < steps; s += 2) {
        const t = s / steps
        const x = a.x + (b.x - a.x) * t
        const y = a.y + (b.y - a.y) * t
        dash.fillCircle(x, y, 3.5)
      }
    }
  }

  private drawPortalAndBase(): void {
    const start = this.waypoints[1] // first real path cell
    const ring1 = this.add.circle(start.x, start.y, 30, C.portal, 0.9).setDepth(3)
    ring1.setStrokeStyle(5, 0xd7b8ff)
    this.add.circle(start.x, start.y, 15, 0xf0e0ff, 0.9).setDepth(3)
    this.tweens.add({ targets: ring1, scale: 1.25, alpha: 0.55, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' })

    // Base crystal (glowing diamond gem) at final waypoint
    const base = this.waypoints[this.waypoints.length - 1]
    const glow = this.add.circle(base.x, base.y, 46, C.base, 0.28).setDepth(3)
    this.tweens.add({ targets: glow, scale: 1.3, alpha: 0.12, duration: 1100, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' })
    const gem = this.add
      .polygon(base.x, base.y, [0, -34, 26, 0, 0, 34, -26, 0], C.base, 1)
      .setDepth(4)
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
    this.pill(150, 46, 200, 56, 0x3a2470)
    const gc = this.add.circle(78, 46, 17, C.gold).setDepth(20)
    gc.setStrokeStyle(3, 0xffe9a6)
    this.add.text(78, 46, '$', { fontFamily: 'Arial Black', fontSize: '22px', color: '#7a5600' }).setOrigin(0.5).setDepth(21)
    this.goldIcon = { x: 78, y: 46 }
    this.goldText = this.add
      .text(108, 46, `${this.gold}`, { fontFamily: 'Arial Black', fontSize: '30px', color: '#ffe27a' })
      .setOrigin(0, 0.5)
      .setDepth(21)

    // Lives pill
    this.pill(360, 46, 168, 56, 0x3a2470)
    const heart = this.add.circle(300, 46, 15, C.life).setDepth(20)
    heart.setStrokeStyle(3, 0xffd0da)
    this.livesText = this.add
      .text(324, 46, `${this.lives}`, { fontFamily: 'Arial Black', fontSize: '30px', color: '#ffd0da' })
      .setOrigin(0, 0.5)
      .setDepth(21)

    // Wave pill
    this.pill(552, 46, 200, 56, 0x3a2470)
    this.waveText = this.add
      .text(552, 46, `WAVE 1/${WAVES.length}`, { fontFamily: 'Arial Black', fontSize: '26px', color: '#a0f0ff' })
      .setOrigin(0.5)
      .setDepth(21)

    // Pause + speed controls (top-right, second row)
    this.makeButton(624, 118, 82, 62, 'II', 0x4a3a7a, () => this.togglePause()).then((c) => {
      this.pauseLabel = c.getData('label') as Phaser.GameObjects.Text
    })
    this.makeButton(680, 118, 82, 62, '1x', 0x4a3a7a, () => this.toggleSpeed()).then((c) => {
      this.speedLabel = c.getData('label') as Phaser.GameObjects.Text
    })

    // Start wave button (centre-left, second row)
    this.startBtn = this.makeButtonSync(300, 118, 420, 66, 'START WAVE  ▶', 0x2ea043, () => this.startWave())
    this.startLabel = this.startBtn.getData('label') as Phaser.GameObjects.Text
  }

  // makeButton returns a promise only so we can grab label ref; provide sync variant too.
  private makeButtonSync(
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    color: number,
    onClick: () => void,
  ): Phaser.GameObjects.Container {
    const bg = this.add.graphics()
    bg.fillStyle(color, 1)
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, 14)
    bg.lineStyle(3, 0xffffff, 0.25)
    bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 14)
    const txt = this.add
      .text(0, 0, label, { fontFamily: 'Arial Black', fontSize: '28px', color: '#ffffff' })
      .setOrigin(0.5)
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

  private makeButton(
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    color: number,
    onClick: () => void,
  ): Promise<Phaser.GameObjects.Container> {
    return Promise.resolve(this.makeButtonSync(x, y, w, h, label, color, onClick))
  }

  private buildTowerBar(): void {
    this.add.rectangle(360, 1180, 720, 200, C.panel, 1).setDepth(19)
    this.add.rectangle(360, 1080, 720, 4, 0x000000, 0.25).setDepth(19)
    const xs = [130, 360, 590]
    TOWER_ORDER.forEach((kind, i) => {
      const def = TOWERS[kind]
      const x = xs[i]
      const y = 1180
      const w = 210
      const h = 168
      const bg = this.add.graphics()
      bg.fillStyle(0x3a2470, 1)
      bg.fillRoundedRect(-w / 2, -h / 2, w, h, 18)
      bg.lineStyle(4, def.color, 0.9)
      bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 18)
      // icon
      const icon = this.towerIconShapes(0, -34, def, 0)
      const name = this.add
        .text(0, 14, def.name, { fontFamily: 'Arial Black', fontSize: '26px', color: '#ffffff' })
        .setOrigin(0.5)
      const costTxt = this.add
        .text(0, 46, `$${def.cost}`, { fontFamily: 'Arial Black', fontSize: '24px', color: '#ffe27a' })
        .setOrigin(0.5)
      const cont = this.add.container(x, y, [bg, ...icon, name, costTxt]).setDepth(22)
      cont.setSize(w, h)
      cont.setData('bg', bg)
      cont.setData('kind', kind)
      cont.setData('w', w)
      cont.setData('h', h)
      cont.setData('def', def)
      cont.setInteractive(new Phaser.Geom.Rectangle(-w / 2, -h / 2, w, h), Phaser.Geom.Rectangle.Contains)
      cont.on('pointerdown', () => this.onTowerButton(kind, cont))
      this.towerButtons.push(cont)
    })
  }

  private refreshTowerButtons(): void {
    for (const cont of this.towerButtons) {
      const def = cont.getData('def') as TowerDef
      const bg = cont.getData('bg') as Phaser.GameObjects.Graphics
      const kind = cont.getData('kind') as TowerKind
      const w = cont.getData('w') as number
      const h = cont.getData('h') as number
      const selected = this.buildKind === kind
      const afford = this.gold >= def.cost
      bg.clear()
      bg.fillStyle(selected ? def.color : 0x3a2470, selected ? 0.85 : 1)
      bg.fillRoundedRect(-w / 2, -h / 2, w, h, 18)
      bg.lineStyle(selected ? 6 : 4, def.color, afford ? 1 : 0.35)
      bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 18)
      cont.setAlpha(afford ? 1 : 0.55)
    }
  }

  // Small tower silhouette used on buttons / ghosts.
  private towerIconShapes(x: number, y: number, def: TowerDef, depth: number): Phaser.GameObjects.Shape[] {
    const shapes: Phaser.GameObjects.Shape[] = []
    const base = this.add.circle(x, y, 22, def.accent).setDepth(depth)
    shapes.push(base)
    if (def.kind === 'cannon') {
      const body = this.add.circle(x, y, 15, def.color).setDepth(depth)
      const barrel = this.add.rectangle(x, y - 14, 10, 22, def.color).setDepth(depth)
      barrel.setStrokeStyle(2, 0xffffff, 0.4)
      shapes.push(body, barrel)
    } else if (def.kind === 'frost') {
      const body = this.add.star(x, y, 6, 7, 16, def.color).setDepth(depth)
      body.setStrokeStyle(2, 0xffffff, 0.5)
      shapes.push(body)
    } else {
      const body = this.add.triangle(x, y, 0, 16, 14, -14, -14, -14, def.color).setDepth(depth)
      body.setStrokeStyle(2, 0xffffff, 0.4)
      shapes.push(body)
    }
    return shapes
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
    if (!this.buildKind || !this.ghost || !this.ghostRing) return
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
  }

  private onPointerDown(p: Phaser.Input.Pointer): void {
    if (this.state === 'won' || this.state === 'lost') return
    // Let the upgrade panel's own buttons handle taps that land on it.
    if (this.upgradePanel && Phaser.Geom.Rectangle.Contains(new Phaser.Geom.Rectangle(130, 905, 460, 150), p.x, p.y)) {
      return
    }
    const cell = this.pointerCell(p)
    if (!cell) return // taps outside the map are handled by HUD/tower buttons

    if (this.buildKind) {
      this.tryPlace(cell.col, cell.row)
      return
    }
    // selection / upgrade
    const t = this.occupied[cell.row][cell.col]
    if (t) {
      this.selectTower(t)
    } else {
      this.deselect()
    }
  }

  private onTowerButton(kind: TowerKind, _cont: Phaser.GameObjects.Container): void {
    if (this.state === 'won' || this.state === 'lost') return
    this.deselect()
    if (this.buildKind === kind) {
      this.exitBuild()
      return
    }
    this.buildKind = kind
    this.spawnGhost(kind)
    this.refreshTowerButtons()
  }

  private spawnGhost(kind: TowerKind): void {
    this.clearGhost()
    const def = TOWERS[kind]
    const shapes = this.towerIconShapes(0, 0, def, 6)
    this.ghost = this.add.container(-100, -100, shapes).setDepth(6).setVisible(false)
    const range = def.levels[0].range * TILE
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
    this.clearGhost()
    this.refreshTowerButtons()
  }

  private canPlace(col: number, row: number): boolean {
    return this.grid[row][col] === 'build' && this.occupied[row][col] === null
  }

  private tryPlace(col: number, row: number): void {
    if (!this.buildKind) return
    const def = TOWERS[this.buildKind]
    if (!this.canPlace(col, row)) {
      this.floatText(this.cellCenter(col, row).x, this.cellCenter(col, row).y, 'CANT BUILD', 0xff5b7a)
      return
    }
    if (this.gold < def.cost) {
      this.floatText(this.cellCenter(col, row).x, this.cellCenter(col, row).y, 'NEED GOLD', 0xff5b7a)
      return
    }
    this.spendGold(def.cost)
    this.placeTower(def, col, row)
    // keep build mode active if still affordable, else exit
    if (this.gold < def.cost) this.exitBuild()
  }

  private placeTower(def: TowerDef, col: number, row: number): void {
    const cc = this.cellCenter(col, row)
    const ringR = def.levels[0].range * TILE
    const ring = this.add.circle(cc.x, cc.y, ringR, def.color, 0.1).setDepth(5).setVisible(false)
    ring.setStrokeStyle(3, def.color, 0.9)
    const turretShapes = this.towerIconShapes(0, 0, def, 6)
    const cont = this.add.container(cc.x, cc.y, [...turretShapes]).setDepth(6)
    const turret = turretShapes[turretShapes.length - 1]
    const tower: Tower = {
      def,
      level: 0,
      col,
      row,
      x: cc.x,
      y: cc.y,
      cont,
      turret,
      ring,
      cd: 0,
    }
    this.towers.push(tower)
    this.occupied[row][col] = tower

    // pop feedback
    cont.setScale(0.2)
    this.tweens.add({ targets: cont, scale: 1, duration: 260, ease: 'Back.easeOut' })
    this.pulseRing(cc.x, cc.y, ringR, def.color)
    this.cameras.main.shake(90, 0.004)
  }

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
    const w = 460
    const h = 150
    const x = 360
    const y = 980
    const bg = this.add.graphics()
    bg.fillStyle(0x1c1038, 0.96)
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, 18)
    bg.lineStyle(4, t.def.color, 1)
    bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 18)
    const cur = t.def.levels[t.level]
    const title = this.add
      .text(-w / 2 + 20, -h / 2 + 16, `${t.def.name}  ·  Lv ${t.level + 1}`, {
        fontFamily: 'Arial Black',
        fontSize: '26px',
        color: '#ffffff',
      })
      .setOrigin(0, 0)
    const stats = this.add
      .text(-w / 2 + 20, -h / 2 + 54, `DMG ${cur.damage}   RNG ${cur.range.toFixed(1)}`, {
        fontFamily: 'Arial',
        fontSize: '22px',
        color: '#a0f0ff',
      })
      .setOrigin(0, 0)
    const children: Phaser.GameObjects.GameObject[] = [bg, title, stats]

    if (t.level < 2) {
      const next = t.def.levels[t.level + 1]
      const cost = next.upgradeCost
      const afford = this.gold >= cost
      const bw = 190
      const bh = 60
      const bx = w / 2 - bw / 2 - 16
      const by = 4
      const btnBg = this.add.graphics()
      btnBg.fillStyle(afford ? 0x2ea043 : 0x555070, 1)
      btnBg.fillRoundedRect(bx - bw / 2, by - bh / 2, bw, bh, 14)
      const btnTxt = this.add
        .text(bx, by, `UPGRADE $${cost}`, { fontFamily: 'Arial Black', fontSize: '22px', color: '#ffffff' })
        .setOrigin(0.5)
      const upInfo = this.add
        .text(-w / 2 + 20, h / 2 - 34, `NEXT: DMG ${next.damage}  RNG ${next.range.toFixed(1)}`, {
          fontFamily: 'Arial',
          fontSize: '19px',
          color: '#ffe27a',
        })
        .setOrigin(0, 0)
      children.push(upInfo, btnBg, btnTxt)
      const panel = this.add.container(x, y, children).setDepth(30)
      btnBg.setInteractive(new Phaser.Geom.Rectangle(bx - bw / 2, by - bh / 2, bw, bh), Phaser.Geom.Rectangle.Contains)
      btnBg.on('pointerdown', () => this.upgradeTower(t))
      this.upgradePanel = panel
    } else {
      const maxTxt = this.add
        .text(w / 2 - 20, 4, 'MAX', { fontFamily: 'Arial Black', fontSize: '30px', color: '#ffd54a' })
        .setOrigin(1, 0.5)
      children.push(maxTxt)
      this.upgradePanel = this.add.container(x, y, children).setDepth(30)
    }
    this.upgradePanel.setScale(0.85)
    this.tweens.add({ targets: this.upgradePanel, scale: 1, duration: 160, ease: 'Back.easeOut' })
  }

  private upgradeTower(t: Tower): void {
    if (t.level >= 2) return
    const next = t.def.levels[t.level + 1]
    if (this.gold < next.upgradeCost) {
      this.floatText(t.x, t.y - 30, 'NEED GOLD', 0xff5b7a)
      return
    }
    this.spendGold(next.upgradeCost)
    t.level++
    const newR = t.def.levels[t.level].range * TILE
    t.ring.setRadius(newR)
    // visual: bigger turret + pop
    this.tweens.add({ targets: t.cont, scale: 1 + 0.12 * t.level, duration: 220, ease: 'Back.easeOut' })
    this.pulseRing(t.x, t.y, newR, t.def.color)
    this.floatText(t.x, t.y - 34, `LV ${t.level + 1}!`, t.def.color)
    this.cameras.main.shake(80, 0.003)
    this.showUpgradePanel(t) // refresh
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
    // early-start bonus
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
    const wave = WAVES[this.waveIndex]
    let t = this.clock + 0.4
    for (const entry of wave.entries) {
      for (let i = 0; i < entry.count; i++) {
        this.spawnQueue.push({ kind: entry.kind, hpMul: entry.hpMul, at: t })
        t += entry.spacing
      }
      t += 0.5 // gap between entry groups
    }
  }

  private updateWaveText(): void {
    this.waveText.setText(`WAVE ${Math.min(this.waveIndex + 1, WAVES.length)}/${WAVES.length}`)
  }

  private waveCleared(): void {
    const bonus = WAVES[this.waveIndex].clearBonus
    this.addGold(bonus)
    this.floatText(360, 250, `WAVE CLEAR  +${bonus}`, C.base)
    if (this.waveIndex >= WAVES.length - 1) {
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
    const hpBg = this.add.rectangle(0, -def.radius - 12, def.radius * 2 + 6, 7, 0x000000, 0.55)
    const hpFill = this.add.rectangle(-(def.radius + 3), -def.radius - 12, def.radius * 2 + 6, 7, 0x36e05a).setOrigin(0, 0.5)
    const tag = this.add
      .text(0, -def.radius - 26, '', { fontFamily: 'Arial Black', fontSize: '15px', color: '#4ad9ff' })
      .setOrigin(0.5)
    const cont = this.add.container(start.x, start.y, [body, hpBg, hpFill, tag]).setDepth(7)
    const enemy: Enemy = {
      def,
      cont,
      body,
      hpBg,
      hpFill,
      tag,
      maxHp,
      hp: maxHp,
      dist: 0,
      x: start.x,
      y: start.y,
      slowUntil: 0,
      slowFactor: 1,
      burnUntil: 0,
      burnDps: 0,
      burnTick: 0,
      weakUntil: 0,
      alive: true,
    }
    this.enemies.push(enemy)
  }

  private makeEnemyBody(def: EnemyDef): Phaser.GameObjects.Shape {
    let body: Phaser.GameObjects.Shape
    const r = def.radius
    if (def.shape === 'triangle') {
      body = this.add.triangle(0, 0, 0, r, r, -r * 0.9, -r, -r * 0.9, def.color)
    } else if (def.shape === 'square') {
      body = this.add.rectangle(0, 0, r * 1.8, r * 1.8, def.color)
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
    // spawn from queue
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
      // move
      const slowed = e.slowUntil > this.clock
      if (!slowed) e.slowFactor = 1
      const speed = e.def.speed * TILE * (slowed ? e.slowFactor : 1)
      e.dist += speed * dt
      const pos = this.positionAt(e.dist)
      e.x = pos.x
      e.y = pos.y
      e.cont.setPosition(pos.x, pos.y)
      // visuals: tint when slowed, status tag
      const burning = e.burnUntil > this.clock
      if (slowed) e.body.setFillStyle(0x8fe9ff)
      else if (burning) e.body.setFillStyle(0xffb15c)
      else e.body.setFillStyle(e.def.color)
      if (slowed) e.tag.setText('SLOW').setColor('#4ad9ff').setVisible(true)
      else if (burning) e.tag.setText('BURN').setColor('#ff8a3c').setVisible(true)
      else e.tag.setVisible(false)
      // hp bar
      const ratio = Phaser.Math.Clamp(e.hp / e.maxHp, 0, 1)
      e.hpFill.width = (e.def.radius * 2 + 6) * ratio
      e.hpFill.setFillStyle(ratio > 0.5 ? 0x36e05a : ratio > 0.25 ? 0xffd54a : 0xff5b7a)

      if (pos.done) {
        this.enemyReachedBase(e)
      }
    }

    // sweep dead / arrived
    this.enemies = this.enemies.filter((e) => e.alive)

    // wave clear check
    if (this.state === 'active' && this.spawnQueue.length === 0 && this.enemies.length === 0) {
      this.waveCleared()
    }
  }

  private enemyReachedBase(e: Enemy): void {
    e.alive = false
    e.cont.destroy()
    this.loseLife(1)
    const base = this.waypoints[this.waypoints.length - 1]
    this.cameras.main.shake(180, 0.008)
    this.cameras.main.flash(120, 255, 60, 90)
    this.pulseRing(base.x, base.y, 40, C.life)
  }

  // ---- Combat --------------------------------------------------------------
  private updateTowers(dt: number): void {
    for (const t of this.towers) {
      const lvl = t.def.levels[t.level]
      const range = lvl.range * TILE
      t.cd -= dt

      if (t.def.kind === 'frost') {
        // continuous slow to everything in range
        for (const e of this.enemies) {
          if (!e.alive) continue
          if (this.dist2(t.x, t.y, e.x, e.y) <= range * range) {
            e.slowUntil = this.clock + (lvl.slowDuration ?? 1)
            e.slowFactor = Math.min(e.slowFactor, lvl.slowFactor ?? 0.5)
          }
        }
      }

      if (t.cd > 0) continue
      const target = this.acquire(t, range)
      if (!target) continue
      t.cd = lvl.cooldown
      this.aimTurret(t, target)

      if (t.def.kind === 'cannon') {
        this.fireProjectile(t, target, lvl.damage)
      } else if (t.def.kind === 'frost') {
        this.frostZap(t, range, lvl.damage)
      } else {
        this.flameBurst(t, target, range, lvl)
      }
    }
  }

  private acquire(t: Tower, range: number): Enemy | null {
    // nearest enemy in range (by path progress -> favours closest to base among nearby)
    let best: Enemy | null = null
    let bestDist = Infinity
    const r2 = range * range
    for (const e of this.enemies) {
      if (!e.alive) continue
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

  private fireProjectile(t: Tower, target: Enemy, damage: number): void {
    const gfx = this.add.circle(t.x, t.y - 6, 8, 0x1a1030).setDepth(8)
    gfx.setStrokeStyle(3, t.def.color)
    // muzzle flash
    const flash = this.add.circle(t.x, t.y - 20, 12, 0xffe9a6, 0.9).setDepth(8)
    this.tweens.add({ targets: flash, scale: 0, alpha: 0, duration: 140, onComplete: () => flash.destroy() })
    this.projectiles.push({
      gfx,
      x: t.x,
      y: t.y - 6,
      target,
      tx: target.x,
      ty: target.y,
      speed: 720,
      damage,
      source: t.def,
    })
  }

  private frostZap(t: Tower, range: number, damage: number): void {
    // pulse ring + small damage to all in range
    this.pulseRing(t.x, t.y, range, t.def.color, 0.5)
    for (const e of this.enemies) {
      if (!e.alive) continue
      if (this.dist2(t.x, t.y, e.x, e.y) <= range * range) {
        this.dealDamage(e, damage, t.def)
      }
    }
  }

  private flameBurst(t: Tower, target: Enemy, range: number, lvl: TowerDef['levels'][number]): void {
    // cone/blob toward target + splash + burn
    const ang = Phaser.Math.Angle.Between(t.x, t.y, target.x, target.y)
    const fx = this.add.circle(t.x + Math.cos(ang) * 24, t.y + Math.sin(ang) * 24, 16, 0xff8a3c, 0.9).setDepth(8)
    this.tweens.add({ targets: fx, scale: 2.2, alpha: 0, duration: 220, onComplete: () => fx.destroy() })
    const splash = (lvl.splash ?? 1) * TILE
    for (const e of this.enemies) {
      if (!e.alive) continue
      if (this.dist2(target.x, target.y, e.x, e.y) <= splash * splash) {
        this.dealDamage(e, lvl.damage, t.def)
        if (e.alive) {
          e.burnUntil = this.clock + (lvl.burnDuration ?? 2)
          e.burnDps = Math.max(e.burnDps, lvl.burnDps ?? 8)
        }
      }
    }
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
        // impact
        if (p.target && p.target.alive) this.dealDamage(p.target, p.damage, p.source)
        this.hitSpark(p.tx, p.ty, p.source.color)
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

  private dealDamage(e: Enemy, amount: number, source: TowerDef): void {
    if (!e.alive) return
    let dmg = amount
    let weak = false
    if (source.synergyDamage && e.slowUntil > this.clock) {
      dmg *= SYNERGY_MULT
      weak = true
    }
    // damage number + hit pop while the enemy still exists...
    this.floatText(e.x + Phaser.Math.Between(-8, 8), e.y - e.def.radius - 6, `${Math.round(dmg)}`, 0xffffff, weak ? 26 : 22)
    this.tweens.add({ targets: e.cont, scaleX: 1.22, scaleY: 0.82, duration: 70, yoyo: true })
    if (weak && this.clock > e.weakUntil) {
      e.weakUntil = this.clock + 0.5
      this.floatText(e.x, e.y - e.def.radius - 30, 'WEAK! +50%', 0xffd54a, 24)
    }
    // ...then apply damage (may destroy the container via killEnemy).
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
    this.addGold(e.def.reward)
    this.spawnCoins(e.x, e.y, e.def.reward)
    this.deathBurst(e.x, e.y, e.def.color)
    if (e.def.kind === 'brute') this.cameras.main.shake(160, 0.006)
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
    const t = this.add
      .text(x, y, msg, { fontFamily: 'Arial Black', fontSize: `${size}px`, color: hex })
      .setOrigin(0.5)
      .setDepth(15)
    t.setStroke('#000000', 4)
    t.setScale(0.4)
    this.tweens.add({ targets: t, scale: 1, duration: 120, ease: 'Back.easeOut' })
    this.tweens.add({
      targets: t,
      y: y - 44,
      alpha: 0,
      delay: 220,
      duration: 560,
      ease: 'Cubic.easeIn',
      onComplete: () => t.destroy(),
    })
  }

  private hitSpark(x: number, y: number, color: number): void {
    for (let i = 0; i < 5; i++) {
      const a = Phaser.Math.FloatBetween(0, Math.PI * 2)
      const sp = this.add.circle(x, y, Phaser.Math.Between(2, 4), color).setDepth(14)
      this.tweens.add({
        targets: sp,
        x: x + Math.cos(a) * Phaser.Math.Between(14, 30),
        y: y + Math.sin(a) * Phaser.Math.Between(14, 30),
        alpha: 0,
        duration: 260,
        onComplete: () => sp.destroy(),
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
        targets: piece,
        x: x + Math.cos(a) * Phaser.Math.Between(24, 54),
        y: y + Math.sin(a) * Phaser.Math.Between(24, 54),
        angle: piece.angle + 220,
        alpha: 0,
        scale: 0.2,
        duration: Phaser.Math.Between(320, 500),
        ease: 'Cubic.easeOut',
        onComplete: () => piece.destroy(),
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
        targets: coin,
        x: midx,
        y: midy,
        duration: 180,
        ease: 'Cubic.easeOut',
        onComplete: () => {
          this.tweens.add({
            targets: coin,
            x: this.goldIcon.x,
            y: this.goldIcon.y,
            scale: 0.4,
            delay: i * 20,
            duration: 320,
            ease: 'Cubic.easeIn',
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
    this.tweens.add({
      targets: ring,
      scale: 2.6,
      alpha: 0,
      duration: 340,
      ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy(),
    })
  }

  // ---- Controls ------------------------------------------------------------
  private togglePause(): void {
    if (this.state === 'won' || this.state === 'lost') return
    this.paused = !this.paused
    if (this.pauseLabel) this.pauseLabel.setText(this.paused ? '▶' : 'II')
    this.tweens.timeScale = this.paused ? 0 : this.gameSpeed
    if (this.paused) {
      this.showBanner('PAUSED')
    } else {
      this.clearBanner()
    }
  }

  private toggleSpeed(): void {
    this.gameSpeed = this.gameSpeed === 1 ? 2 : 1
    if (this.speedLabel) this.speedLabel.setText(`${this.gameSpeed}x`)
    if (!this.paused) this.tweens.timeScale = this.gameSpeed
  }

  private banner?: Phaser.GameObjects.Text
  private showBanner(msg: string): void {
    this.clearBanner()
    this.banner = this.add
      .text(360, 640, msg, { fontFamily: 'Arial Black', fontSize: '64px', color: '#ffffff' })
      .setOrigin(0.5)
      .setDepth(40)
    this.banner.setStroke('#7b2ff7', 10)
  }
  private clearBanner(): void {
    this.banner?.destroy()
    this.banner = undefined
  }

  // ---- Win / lose ----------------------------------------------------------
  private win(): void {
    this.state = 'won'
    this.endPanel('VICTORY!', 'You defended the crystal!', C.base)
    for (let i = 0; i < 3; i++) {
      this.time.delayedCall(i * 250, () => this.cameras.main.flash(200, 47, 247, 195))
    }
  }

  private lose(): void {
    this.state = 'lost'
    this.endPanel('DEFEAT', 'The crystal was overrun…', C.life)
    this.cameras.main.shake(300, 0.01)
  }

  private endPanel(title: string, sub: string, color: number): void {
    this.buildKind = null
    this.clearGhost()
    this.deselect()
    this.startBtn.setVisible(false)
    const overlay = this.add.rectangle(360, 640, 720, 1280, 0x000000, 0.62).setDepth(38)
    overlay.setInteractive() // block taps beneath
    const w = 560
    const h = 420
    const bg = this.add.graphics().setDepth(39)
    bg.fillStyle(0x1c1038, 0.98)
    bg.fillRoundedRect(360 - w / 2, 640 - h / 2, w, h, 26)
    bg.lineStyle(6, color, 1)
    bg.strokeRoundedRect(360 - w / 2, 640 - h / 2, w, h, 26)
    const hex = '#' + color.toString(16).padStart(6, '0')
    const t = this.add
      .text(360, 520, title, { fontFamily: 'Arial Black', fontSize: '74px', color: hex })
      .setOrigin(0.5)
      .setDepth(40)
    t.setStroke('#000000', 8)
    this.add
      .text(360, 600, sub, { fontFamily: 'Arial', fontSize: '28px', color: '#d8d0ff' })
      .setOrigin(0.5)
      .setDepth(40)
    this.add
      .text(360, 660, `Reached Wave ${Math.min(this.waveIndex + 1, WAVES.length)}/${WAVES.length}`, {
        fontFamily: 'Arial',
        fontSize: '24px',
        color: '#a0f0ff',
      })
      .setOrigin(0.5)
      .setDepth(40)
    const btn = this.makeButtonSync(360, 760, 320, 82, 'PLAY AGAIN', 0x2ea043, () => {
      this.cameras.main.fadeOut(220, 20, 12, 50)
      this.time.delayedCall(240, () => this.scene.restart())
    })
    btn.setDepth(41)
    btn.setScale(0.6)
    this.tweens.add({ targets: btn, scale: 1, duration: 300, ease: 'Back.easeOut' })
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
      this.startLabel.setText(`START WAVE ▶  (${secs})`)
      if (this.prepTimer <= 0) this.startWave()
    }

    this.updateEnemies(dt)
    this.updateTowers(dt)
    this.updateProjectiles(dt)
  }
}
