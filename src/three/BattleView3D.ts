// BattleView3D — a low-poly, candy-coloured Three.js WebGL view over the pure sim.
// It owns NO game logic: each frame the orchestrator advances the sim, then calls
// syncFrom() to reconcile pooled meshes to the sim's entity state, and render() to
// draw. FX methods turn semantic sim events into juice. Picking raycasts the board.
//
// Coordinate mapping: the sim runs in a 720×1280 px space; the map spans
// x∈[0,720], y∈[200,1080]. We map 1 TILE (80px) → 1 world unit, centred at origin,
// on the ground plane (Y up). So the board is X∈[-4.5,4.5], Z∈[-5.5,5.5].

import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

import type { Sim, SimEnemy, SimTower } from '../sim'
import { COLS, ROWS, MAP_X, MAP_Y, MAP_W, MAP_H, worldToCell } from '../sim'
import { TOWERS, type TowerKind } from '../game/towers'
import type { EnemyKind } from '../game/enemies'
import type { FieldPalette } from '../game/levels'

const TILE_PX = 80
const CX = MAP_X + MAP_W / 2 // 360
const CY = MAP_Y + MAP_H / 2 // 640

// sim px → world units
function wx(simX: number): number { return (simX - CX) / TILE_PX }
function wz(simY: number): number { return (simY - CY) / TILE_PX }
function wr(px: number): number { return px / TILE_PX }

// small deterministic hash for tile height variation (view-only, no sim impact)
function hash2(a: number, b: number): number {
  const n = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453
  return n - Math.floor(n)
}

interface EnemySlot {
  kind: EnemyKind
  group: THREE.Group
  body: THREE.Mesh
  bodyMat: THREE.MeshStandardMaterial
  hpBg: THREE.Mesh
  hpFill: THREE.Mesh
  hpFillMat: THREE.MeshBasicMaterial
  shield: THREE.Mesh | null
  shadow: THREE.Mesh
  baseScale: number
  hoverY: number
  spawnT: number // spawn squash timer (counts up)
  hitT: number // hit flash / squash timer
  radius: number
}

interface TowerSlot {
  group: THREE.Group
  turret: THREE.Group
  ring: THREE.Mesh
  ringMat: THREE.MeshBasicMaterial
  glow: THREE.PointLight
  level: number
  branch: number
  kind: TowerKind
  fireT: number
}

interface ProjSlot {
  mesh: THREE.Mesh
  light: THREE.PointLight | null
}

interface Transient {
  obj: THREE.Object3D
  mat: THREE.Material | THREE.Material[]
  geo?: THREE.BufferGeometry
  t: number
  life: number
  kind: 'ring' | 'flash' | 'beam' | 'spark'
  vx?: number
  vy?: number
  vz?: number
  baseScale?: number
  fade?: boolean
}

const MAX_PARTICLES = 900

export class BattleView3D {
  readonly canvas: HTMLCanvasElement
  private renderer: THREE.WebGLRenderer
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private composer: EffectComposer
  private bloom: UnrealBloomPass
  private renderPass: RenderPass
  private outputPass: OutputPass

  private raycaster = new THREE.Raycaster()
  private ndc = new THREE.Vector2()
  // Pick plane raised to the build-tile top (y≈0.5): with the tilted camera a y=0
  // plane crosses ~1/3 tile past the visible surface, so a cold touch tap (no prior
  // hover) would land a cell off. y=0.5 keeps hover+tap WYSIWYG. (plane: y = -const)
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.5)
  private hitPoint = new THREE.Vector3()

  private boardTiles!: THREE.InstancedMesh
  private hoverMesh!: THREE.Mesh
  private hoverMat!: THREE.MeshBasicMaterial
  private portalMesh!: THREE.Mesh
  private baseMesh!: THREE.Mesh
  private buffDirty = true

  private enemyPools = new Map<EnemyKind, EnemySlot[]>()
  private enemyViews = new Map<number, EnemySlot>()
  private towerViews = new Map<number, TowerSlot>()
  private projViews = new Map<number, ProjSlot>()
  private projPool: ProjSlot[] = []
  private activeScratch = new Set<number>()

  private transients: Transient[] = []
  private buffLinesGroup: THREE.Group

  // particle system (single pooled Points)
  private particles!: THREE.Points
  private pPos!: Float32Array
  private pCol!: Float32Array
  private pVel: Float32Array
  private pLife: Float32Array
  private pMaxLife: Float32Array
  private pHead = 0

  // shared geometries/materials for disposal
  private disposables: Array<{ dispose(): void }> = []
  private enemyGeo = new Map<EnemyKind, THREE.BufferGeometry>()
  private shadowGeo!: THREE.CircleGeometry
  private hpBgGeo!: THREE.PlaneGeometry
  private hpFillGeo!: THREE.PlaneGeometry
  private hpBgMat!: THREE.MeshBasicMaterial

  private clockT = 0
  private camBaseAngle = 0
  private disposed = false
  private tmpV = new THREE.Vector3()
  private tmpQ = new THREE.Quaternion()

  constructor(
    private sim: Sim,
    private palette: FieldPalette,
    private accent: number, // element-ground accent for the arena floor
  ) {
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'battle3d-canvas'
    this.canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;display:block;z-index:10;touch-action:none;'

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: false, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.setSize(window.innerWidth, window.innerHeight, false)
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05

    this.scene = new THREE.Scene()
    const bg = new THREE.Color(0x140a2a)
    this.scene.background = bg
    this.scene.fog = new THREE.Fog(0x140a2a, 22, 40)

    this.camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.1, 100)

    this.buffLinesGroup = new THREE.Group()
    this.scene.add(this.buffLinesGroup)

    // pre-alloc particle buffers (never realloc per-frame)
    this.pVel = new Float32Array(MAX_PARTICLES * 3)
    this.pLife = new Float32Array(MAX_PARTICLES)
    this.pMaxLife = new Float32Array(MAX_PARTICLES)

    this.initSharedGeom()
    this.setupLights()
    this.setupBoard()
    this.setupParticles()
    this.setupHover()

    // post-processing: single bloom pass for neon glow
    this.composer = new EffectComposer(this.renderer)
    this.renderPass = new RenderPass(this.scene, this.camera)
    this.composer.addPass(this.renderPass)
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.62, 0.55, 0.72)
    this.composer.addPass(this.bloom)
    this.outputPass = new OutputPass()
    this.composer.addPass(this.outputPass)
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.composer.setSize(window.innerWidth, window.innerHeight)

    this.frameCamera()
  }

  mount(parent: HTMLElement): void {
    parent.appendChild(this.canvas)
  }

  // ---------------------------------------------------------------- lights
  private setupLights(): void {
    const hemi = new THREE.HemisphereLight(0xcfe4ff, 0x2a1c48, 0.85)
    this.scene.add(hemi)
    const key = new THREE.DirectionalLight(0xfff2d6, 1.15)
    key.position.set(6, 14, 8)
    this.scene.add(key)
    const fill = new THREE.DirectionalLight(0x8fb4ff, 0.35)
    fill.position.set(-8, 6, -6)
    this.scene.add(fill)
    // two soft coloured accents for the candy neon feel
    const p1 = new THREE.PointLight(this.accent, 0.6, 26, 2)
    p1.position.set(-3, 4, 4)
    this.scene.add(p1)
    const p2 = new THREE.PointLight(0xff6ad5, 0.5, 26, 2)
    p2.position.set(3, 4, -4)
    this.scene.add(p2)
  }

  // ---------------------------------------------------------------- board
  private setupBoard(): void {
    // one InstancedMesh of beveled-feel boxes; per-instance colour + height.
    const total = COLS * ROWS
    const geo = new THREE.BoxGeometry(0.92, 1, 0.92)
    this.disposables.push(geo)
    const mat = new THREE.MeshStandardMaterial({ vertexColors: false, flatShading: true, roughness: 0.85, metalness: 0.05 })
    this.disposables.push(mat)
    const inst = new THREE.InstancedMesh(geo, mat, total)
    inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    const dummy = new THREE.Object3D()
    const grassA = new THREE.Color(this.palette.grassA)
    const grassB = new THREE.Color(this.palette.grassB)
    const buildC = new THREE.Color(this.palette.build)
    const pathC = new THREE.Color(this.palette.path)
    const pathEdge = new THREE.Color(this.palette.pathEdge)
    let i = 0
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cell = this.sim.grid[r][c]
        const x = wx(MAP_X + c * TILE_PX + TILE_PX / 2)
        const z = wz(MAP_Y + r * TILE_PX + TILE_PX / 2)
        let col: THREE.Color
        let top: number // top-surface height
        const h = hash2(c, r)
        if (cell === 'path') {
          col = pathC.clone().lerp(pathEdge, ((c + r) % 2) * 0.25)
          top = 0.16 // sunken road
        } else if (cell === 'build') {
          col = buildC.clone()
          top = 0.5 + h * 0.12
        } else {
          col = ((c + r) % 2 === 0 ? grassA : grassB).clone()
          top = 0.4 + h * 0.18
        }
        // box height so its TOP sits at `top`, bottom well below (thick base)
        const boxH = top + 1.2
        dummy.position.set(x, top - boxH / 2, z)
        dummy.scale.set(1, boxH, 1)
        dummy.rotation.set(0, 0, 0)
        dummy.updateMatrix()
        inst.setMatrixAt(i, dummy.matrix)
        inst.setColorAt(i, col)
        i++
      }
    }
    inst.instanceMatrix.needsUpdate = true
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true
    inst.frustumCulled = false
    this.boardTiles = inst
    this.scene.add(inst)

    // portal (top) + base crystal (bottom) markers
    this.setupEndpoints()
  }

  private setupEndpoints(): void {
    const portal = this.sim.waypointFor('portal')
    const base = this.sim.waypointFor('base')

    const portalGeo = new THREE.TorusGeometry(0.42, 0.11, 10, 24)
    const portalMat = new THREE.MeshStandardMaterial({ color: 0x9a5cff, emissive: 0x9a5cff, emissiveIntensity: 1.4, roughness: 0.4 })
    this.disposables.push(portalGeo, portalMat)
    const portalMesh = new THREE.Mesh(portalGeo, portalMat)
    portalMesh.position.set(wx(portal.x), 0.55, wz(portal.y))
    portalMesh.rotation.x = Math.PI / 2
    this.scene.add(portalMesh)
    this.portalMesh = portalMesh

    const baseGeo = new THREE.OctahedronGeometry(0.5, 0)
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x2ff7c3, emissive: 0x2ff7c3, emissiveIntensity: 1.1, roughness: 0.25, metalness: 0.2, flatShading: true })
    this.disposables.push(baseGeo, baseMat)
    const baseMesh = new THREE.Mesh(baseGeo, baseMat)
    baseMesh.position.set(wx(base.x), 0.85, wz(base.y))
    this.scene.add(baseMesh)
    this.baseMesh = baseMesh
    const baseLight = new THREE.PointLight(0x2ff7c3, 0.8, 8, 2)
    baseLight.position.copy(baseMesh.position)
    this.scene.add(baseLight)
  }

  private setupHover(): void {
    const geo = new THREE.RingGeometry(0.28, 0.46, 24)
    this.disposables.push(geo)
    this.hoverMat = new THREE.MeshBasicMaterial({ color: 0x9affc0, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
    this.disposables.push(this.hoverMat)
    this.hoverMesh = new THREE.Mesh(geo, this.hoverMat)
    this.hoverMesh.rotation.x = -Math.PI / 2
    this.hoverMesh.visible = false
    this.scene.add(this.hoverMesh)
  }

  // ---------------------------------------------------------------- particles
  private setupParticles(): void {
    const geo = new THREE.BufferGeometry()
    this.pPos = new Float32Array(MAX_PARTICLES * 3)
    this.pCol = new Float32Array(MAX_PARTICLES * 3)
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.pPos[i * 3 + 1] = -999 // park below the world
    }
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3))
    this.disposables.push(geo)
    const mat = new THREE.PointsMaterial({ size: 0.22, vertexColors: true, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true })
    this.disposables.push(mat)
    this.particles = new THREE.Points(geo, mat)
    this.particles.frustumCulled = false
    this.scene.add(this.particles)
  }

  private emitParticles(x: number, y: number, z: number, color: number, count: number, speed: number): void {
    const c = new THREE.Color(color)
    for (let n = 0; n < count; n++) {
      const i = this.pHead
      this.pHead = (this.pHead + 1) % MAX_PARTICLES
      const a = Math.random() * Math.PI * 2
      const up = Math.random() * 0.8 + 0.2
      const sp = speed * (0.5 + Math.random() * 0.8)
      this.pVel[i * 3] = Math.cos(a) * sp
      this.pVel[i * 3 + 1] = up * sp
      this.pVel[i * 3 + 2] = Math.sin(a) * sp
      this.pPos[i * 3] = x
      this.pPos[i * 3 + 1] = y
      this.pPos[i * 3 + 2] = z
      this.pCol[i * 3] = c.r
      this.pCol[i * 3 + 1] = c.g
      this.pCol[i * 3 + 2] = c.b
      this.pLife[i] = 0.55 + Math.random() * 0.35
      this.pMaxLife[i] = this.pLife[i]
    }
  }

  private updateParticles(dt: number): void {
    let any = false
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.pLife[i] <= 0) continue
      any = true
      this.pLife[i] -= dt
      if (this.pLife[i] <= 0) {
        this.pPos[i * 3 + 1] = -999
        continue
      }
      this.pVel[i * 3 + 1] -= 2.2 * dt // gravity
      this.pPos[i * 3] += this.pVel[i * 3] * dt
      this.pPos[i * 3 + 1] += this.pVel[i * 3 + 1] * dt
      this.pPos[i * 3 + 2] += this.pVel[i * 3 + 2] * dt
    }
    if (any) {
      ;(this.particles.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
      // colours are written per-emit; flag them too or every burst renders black
      ;(this.particles.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true
    }
  }

  // ---------------------------------------------------------------- camera
  private frameCamera(): void {
    const aspect = window.innerWidth / Math.max(1, window.innerHeight)
    this.camera.aspect = aspect
    const pitch = 52 * Math.PI / 180
    // fit the board: horizontal half-extent 4.5, depth half-extent 5.5 (+margin)
    const halfX = 5.3
    const halfZ = 5.8
    const vFov = this.camera.fov * Math.PI / 180
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect)
    const dForWidth = halfX / Math.tan(hFov / 2)
    // depth is foreshortened by the tilt; approximate its screen span
    const dForDepth = (halfZ * Math.sin(pitch) + 1.5) / Math.tan(vFov / 2)
    const dist = Math.min(34, Math.max(13, Math.max(dForWidth, dForDepth) + 1.5))
    const targetY = -0.2
    const camY = dist * Math.sin(pitch)
    const camZ = dist * Math.cos(pitch)
    this.camera.position.set(Math.sin(this.camBaseAngle) * 0.6, camY, camZ + 0.5)
    this.camera.lookAt(0, targetY, -0.4)
    this.camera.updateProjectionMatrix()
  }

  resize(): void {
    if (this.disposed) return
    const w = window.innerWidth, h = window.innerHeight
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.setSize(w, h, false)
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.composer.setSize(w, h)
    this.bloom.setSize(w, h)
    this.frameCamera()
  }

  // ---------------------------------------------------------------- picking
  // Raycast the pointer onto the ground plane → sim px, or null if it misses.
  pickPoint(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = this.canvas.getBoundingClientRect()
    this.ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1
    this.ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1
    this.raycaster.setFromCamera(this.ndc, this.camera)
    const hit = this.raycaster.ray.intersectPlane(this.groundPlane, this.hitPoint)
    if (!hit) return null
    return { x: this.hitPoint.x * TILE_PX + CX, y: this.hitPoint.z * TILE_PX + CY }
  }

  // Same raycast → grid cell (the SINGLE source of truth for both hover + tap, so
  // a cold first tap resolves to exactly the highlighted buildable cell).
  pickCell(clientX: number, clientY: number): { col: number; row: number } | null {
    const p = this.pickPoint(clientX, clientY)
    if (!p) return null
    return worldToCell(p.x, p.y)
  }

  // world (sim px + height) → screen pixels for HTML floating text
  projectToScreen(simX: number, simY: number, worldY: number): { x: number; y: number; visible: boolean } {
    this.tmpV.set(wx(simX), worldY, wz(simY))
    this.tmpV.project(this.camera)
    const visible = this.tmpV.z < 1
    return {
      x: (this.tmpV.x * 0.5 + 0.5) * window.innerWidth,
      y: (-this.tmpV.y * 0.5 + 0.5) * window.innerHeight,
      visible,
    }
  }

  // ---------------------------------------------------------------- hover/ghost
  setHover(cell: { col: number; row: number } | null, ok: boolean): void {
    if (!cell) { this.hoverMesh.visible = false; return }
    const x = wx(MAP_X + cell.col * TILE_PX + TILE_PX / 2)
    const z = wz(MAP_Y + cell.row * TILE_PX + TILE_PX / 2)
    this.hoverMesh.visible = true
    this.hoverMesh.position.set(x, 0.62, z)
    this.hoverMat.color.set(ok ? 0x9affc0 : 0xff5b7a)
  }

  // ---------------------------------------------------------------- enemies
  private enemyGeometry(kind: EnemyKind, radius: number, shape: string): THREE.BufferGeometry {
    let g = this.enemyGeo.get(kind)
    if (g) return g
    const r = radius
    switch (shape) {
      case 'triangle': g = new THREE.ConeGeometry(r, r * 2.1, 5); break
      case 'square': g = new THREE.BoxGeometry(r * 1.7, r * 1.7, r * 1.7); break
      case 'circle': g = new THREE.SphereGeometry(r, 14, 12); break
      case 'diamond': g = new THREE.OctahedronGeometry(r * 1.15, 0); break
      default: g = new THREE.IcosahedronGeometry(r * 1.15, 0) // hex-ish
    }
    this.enemyGeo.set(kind, g)
    return g
  }

  private acquireEnemySlot(e: SimEnemy): EnemySlot {
    const pool = this.enemyPools.get(e.kind)
    if (pool && pool.length) {
      const s = pool.pop()!
      s.group.visible = true
      return s
    }
    return this.createEnemySlot(e)
  }

  private createEnemySlot(e: SimEnemy): EnemySlot {
    const def = e.def
    const r = wr(def.radius)
    const geo = this.enemyGeometry(e.kind, r, def.shape)
    const bodyMat = new THREE.MeshStandardMaterial({ color: def.color, emissive: def.color, emissiveIntensity: 0.28, roughness: 0.5, metalness: 0.15, flatShading: true })
    const body = new THREE.Mesh(geo, bodyMat)
    const group = new THREE.Group()
    group.add(body)

    // contact shadow
    const shadow = new THREE.Mesh(this.shadowGeo, this.shadowMat())
    shadow.rotation.x = -Math.PI / 2
    shadow.position.y = 0.02
    shadow.scale.setScalar(r * 1.6)
    group.add(shadow)

    // HP billboard
    const hpBg = new THREE.Mesh(this.hpBgGeo, this.hpBgMat)
    const hpFillMat = new THREE.MeshBasicMaterial({ color: 0x36e05a, transparent: true })
    const hpFill = new THREE.Mesh(this.hpFillGeo, hpFillMat)
    const barY = r + 0.42 + (def.isAir ? 0.6 : 0)
    hpBg.position.y = barY
    hpFill.position.y = barY
    group.add(hpBg, hpFill)

    let shield: THREE.Mesh | null = null
    if (e.shieldMax > 0) {
      const sg = new THREE.SphereGeometry(r * 1.5, 12, 10)
      const sm = new THREE.MeshBasicMaterial({ color: 0x9fdcff, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false })
      shield = new THREE.Mesh(sg, sm)
      // track for disposal via slot (disposed on teardown)
      this.disposables.push(sg, sm)
      group.add(shield)
    }

    this.scene.add(group)
    const hoverY = def.isAir ? 0.9 : r + 0.05
    return { kind: e.kind, group, body, bodyMat, hpBg, hpFill, hpFillMat, shield, shadow, baseScale: 1, hoverY, spawnT: 0, hitT: 0, radius: r }
  }

  private shadowMatCache: THREE.MeshBasicMaterial | null = null
  private shadowMat(): THREE.MeshBasicMaterial {
    if (!this.shadowMatCache) {
      this.shadowMatCache = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false })
      this.disposables.push(this.shadowMatCache)
    }
    return this.shadowMatCache
  }

  private releaseEnemySlot(id: number): void {
    const s = this.enemyViews.get(id)
    if (!s) return
    this.enemyViews.delete(id)
    s.group.visible = false
    let pool = this.enemyPools.get(s.kind)
    if (!pool) { pool = []; this.enemyPools.set(s.kind, pool) }
    pool.push(s)
  }

  // ---------------------------------------------------------------- towers
  private makeTowerTurret(kind: TowerKind, level: number, branch: number): THREE.Group {
    const def = TOWERS[kind]
    const g = new THREE.Group()
    const col = def.color
    const emis = new THREE.Color(col)
    const mat = () => new THREE.MeshStandardMaterial({ color: col, emissive: emis, emissiveIntensity: 0.55, roughness: 0.35, metalness: 0.3, flatShading: true })
    const tier = Math.min(level, 3)
    const grow = 1 + tier * 0.12
    if (kind === 'cannon') {
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.26 * grow, 12, 10), mat())
      head.position.y = 0.9
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.55 + tier * 0.08, 10), mat())
      barrel.rotation.z = Math.PI / 2
      barrel.position.set(0.28, 0.9, 0)
      g.add(head, barrel)
      if (branch === 0) { // sniper — long barrel
        const bg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.0, 8), mat())
        bg.rotation.z = Math.PI / 2; bg.position.set(0.5, 0.9, 0); g.add(bg)
      } else if (branch === 1) { // mortar — wide mouth
        const bg = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.12, 0.4, 10), mat())
        bg.rotation.z = Math.PI / 2; bg.position.set(0.34, 0.95, 0); g.add(bg)
      }
    } else if (kind === 'frost') {
      const spire = new THREE.Mesh(new THREE.ConeGeometry(0.24 * grow, 0.7 + tier * 0.12, 6), mat())
      spire.position.y = 1.0
      g.add(spire)
      for (let k = 0; k < 3 + tier; k++) {
        const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.12, 0), mat())
        const a = (k / (3 + tier)) * Math.PI * 2
        shard.position.set(Math.cos(a) * 0.3, 0.65, Math.sin(a) * 0.3)
        g.add(shard)
      }
    } else if (kind === 'flame') {
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.28 * grow, 0.18, 0.4, 8), mat())
      bowl.position.y = 0.75
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.2 * grow, 0.5 + tier * 0.12, 6), mat())
      flame.position.y = 1.15
      g.add(bowl, flame)
    } else if (kind === 'storm') {
      const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.26 * grow, 0), mat())
      orb.position.y = 1.05
      g.add(orb)
      for (let k = 0; k < 2 + tier; k++) {
        const bolt = new THREE.Mesh(new THREE.TetrahedronGeometry(0.14, 0), mat())
        const a = (k / (2 + tier)) * Math.PI * 2
        bolt.position.set(Math.cos(a) * 0.34, 1.05, Math.sin(a) * 0.34)
        g.add(bolt)
      }
    } else { // arcane
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.26 * grow, 0.06, 8, 18), mat())
      ring.position.y = 1.0
      const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.16 * grow, 0), mat())
      core.position.y = 1.0
      g.add(ring, core)
    }
    // register disposal for all created geos/mats in this turret
    g.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh) {
        this.disposables.push(m.geometry)
        if (Array.isArray(m.material)) m.material.forEach((mm) => this.disposables.push(mm))
        else this.disposables.push(m.material)
      }
    })
    return g
  }

  private createTowerSlot(t: SimTower): TowerSlot {
    const def = t.def
    const g = new THREE.Group()
    g.position.set(wx(t.x), 0, wz(t.y))

    // base pedestal
    const baseGeo = new THREE.CylinderGeometry(0.36, 0.42, 0.7, 8)
    const baseMat = new THREE.MeshStandardMaterial({ color: def.accent, roughness: 0.7, metalness: 0.2, flatShading: true })
    this.disposables.push(baseGeo, baseMat)
    const base = new THREE.Mesh(baseGeo, baseMat)
    base.position.y = 0.85
    g.add(base)

    const turret = this.makeTowerTurret(t.kind, t.level, t.branch)
    g.add(turret)

    // range ring on the ground
    const ringGeo = new THREE.RingGeometry(0.9, 0.98, 40)
    const ringMat = new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.85, side: THREE.DoubleSide })
    this.disposables.push(ringGeo, ringMat)
    const ring = new THREE.Mesh(ringGeo, ringMat)
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 0.62
    ring.visible = false
    g.add(ring)

    const glow = new THREE.PointLight(def.color, 0.5, 4, 2)
    glow.position.y = 1.1
    g.add(glow)

    this.scene.add(g)
    return { group: g, turret, ring, ringMat, glow, level: t.level, branch: t.branch, kind: t.kind, fireT: 0 }
  }

  private rebuildTurret(slot: TowerSlot, t: SimTower): void {
    slot.group.remove(slot.turret)
    slot.turret.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { /* geos/mats disposed at teardown */ } })
    const turret = this.makeTowerTurret(t.kind, t.level, t.branch)
    slot.group.add(turret)
    slot.turret = turret
    slot.level = t.level
    slot.branch = t.branch
  }

  // ---------------------------------------------------------------- projectiles
  private acquireProj(color: number): ProjSlot {
    const s = this.projPool.pop()
    if (s) {
      ;(s.mesh.material as THREE.MeshBasicMaterial).color.set(color)
      s.mesh.visible = true
      if (s.light) { s.light.color.set(color); s.light.visible = true }
      return s
    }
    const geo = new THREE.SphereGeometry(0.14, 10, 8)
    this.disposables.push(geo)
    const mat = new THREE.MeshBasicMaterial({ color })
    this.disposables.push(mat)
    const mesh = new THREE.Mesh(geo, mat)
    this.scene.add(mesh)
    return { mesh, light: null }
  }

  private releaseProj(id: number): void {
    const s = this.projViews.get(id)
    if (!s) return
    this.projViews.delete(id)
    s.mesh.visible = false
    if (s.light) s.light.visible = false
    this.projPool.push(s)
  }

  // ---------------------------------------------------------------- sync
  syncFrom(selectedId: number | null): void {
    if (!this.shadowGeo) return
    this.syncEnemies()
    this.syncTowers(selectedId)
    this.syncProjectiles()
    if (this.buffDirty) { this.syncBuffLinks(); this.buffDirty = false }
  }

  private syncEnemies(): void {
    const active = this.activeScratch
    active.clear()
    const clock = this.sim.clock
    for (const e of this.sim.enemies) {
      if (!e.active) continue
      active.add(e.id)
      let s = this.enemyViews.get(e.id)
      if (!s || s.kind !== e.kind) {
        if (s) this.releaseEnemySlot(e.id)
        s = this.acquireEnemySlot(e)
        this.enemyViews.set(e.id, s)
        s.spawnT = 0.001
        this.configureShield(s, e)
      }
      this.updateEnemySlot(s, e, clock)
    }
    for (const [id] of this.enemyViews) {
      if (!active.has(id)) this.releaseEnemySlot(id)
    }
  }

  private configureShield(s: EnemySlot, e: SimEnemy): void {
    if (s.shield) s.shield.visible = e.shieldMax > 0
  }

  private updateEnemySlot(s: EnemySlot, e: SimEnemy, clock: number): void {
    s.group.position.set(wx(e.x), s.hoverY, wz(e.y))
    // face travel direction (approx via aim toward base along +Z path handled by billboard-free body)
    const stunned = e.stunUntil > clock
    const slowed = e.slowUntil > clock
    const burning = e.burnUntil > clock
    // status tint
    if (e.hitFlash > 0) { s.bodyMat.emissive.setHex(0xffffff); s.bodyMat.emissiveIntensity = 0.9 }
    else if (stunned) { s.bodyMat.color.setHex(0xbfeaff); s.bodyMat.emissive.setHex(0x6fc4ff); s.bodyMat.emissiveIntensity = 0.4 }
    else if (slowed) { s.bodyMat.color.setHex(0x8fe9ff); s.bodyMat.emissive.setHex(0x4ad9ff); s.bodyMat.emissiveIntensity = 0.35 }
    else if (burning) { s.bodyMat.color.setHex(0xffb15c); s.bodyMat.emissive.setHex(0xff6a2c); s.bodyMat.emissiveIntensity = 0.5 }
    else { s.bodyMat.color.setHex(e.def.color); s.bodyMat.emissive.setHex(e.def.color); s.bodyMat.emissiveIntensity = 0.28 }

    // hit squash impulse
    if (e.hitFlash > 0 && s.hitT <= 0) s.hitT = 0.14

    // spin flyers gently; rotate cone-shaped bodies to point up already
    s.body.rotation.y += 0.02

    // HP bar (centred plane; scales symmetrically — clean at this size)
    const ratio = Math.max(0, Math.min(1, e.hp / Math.max(1, e.maxHp)))
    s.hpFill.scale.x = Math.max(0.001, ratio)
    s.hpFillMat.color.setHex(ratio > 0.5 ? 0x36e05a : ratio > 0.25 ? 0xffd54a : 0xff5b7a)
    if (s.shield) {
      const sm = s.shield.material as THREE.MeshBasicMaterial
      sm.opacity = e.shield > 0 ? 0.22 : 0
    }
  }

  private syncTowers(selectedId: number | null): void {
    const active = this.activeScratch
    active.clear()
    for (const t of this.sim.towers) {
      if (!t.active) continue
      active.add(t.id)
      let s = this.towerViews.get(t.id)
      if (!s) {
        s = this.createTowerSlot(t)
        this.towerViews.set(t.id, s)
        this.buffDirty = true
      }
      if (t.level !== s.level || t.branch !== s.branch) {
        this.rebuildTurret(s, t)
        this.pushRing(t.x, t.y, this.sim.effRange(t), t.def.color, 0.9)
        this.buffDirty = true
      }
      // aim turret
      s.turret.rotation.y = -t.aimAngle
      // range ring
      const rr = wr(this.sim.effRange(t))
      s.ring.scale.setScalar(rr / 0.94)
      s.ring.visible = selectedId === t.id
      s.ringMat.opacity = 0.85
      // fire flash → brief glow bump
      s.glow.intensity = 0.5 + (t.fireFlash > 0 ? 1.4 : 0)
    }
    for (const [id, s] of this.towerViews) {
      if (!active.has(id)) {
        this.scene.remove(s.group)
        this.towerViews.delete(id)
      }
    }
  }

  private syncProjectiles(): void {
    const active = this.activeScratch
    active.clear()
    for (const p of this.sim.projectiles) {
      if (!p.active) continue
      active.add(p.id)
      let s = this.projViews.get(p.id)
      if (!s) {
        s = this.acquireProj(p.color)
        this.projViews.set(p.id, s)
      }
      s.mesh.position.set(wx(p.x), 0.85, wz(p.y))
    }
    for (const [id] of this.projViews) {
      if (!active.has(id)) this.releaseProj(id)
    }
  }

  private syncBuffLinks(): void {
    // clear old lines
    for (let i = this.buffLinesGroup.children.length - 1; i >= 0; i--) {
      const o = this.buffLinesGroup.children[i] as THREE.Line
      o.geometry.dispose()
      ;(o.material as THREE.Material).dispose()
      this.buffLinesGroup.remove(o)
    }
    for (const l of this.sim.buffLinks()) {
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(wx(l.ax), 0.7, wz(l.ay)),
        new THREE.Vector3(wx(l.bx), 0.7, wz(l.by)),
      ])
      const mat = new THREE.LineBasicMaterial({ color: l.color, transparent: true, opacity: 0.5 })
      this.buffLinesGroup.add(new THREE.Line(geo, mat))
    }
  }

  // ---------------------------------------------------------------- transient FX
  private pushRing(simX: number, simY: number, radiusPx: number, color: number, alpha: number): void {
    const geo = new THREE.RingGeometry(0.6, 0.72, 32)
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: alpha, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(wx(simX), 0.3, wz(simY))
    const target = wr(radiusPx)
    mesh.scale.setScalar(0.3)
    this.scene.add(mesh)
    this.transients.push({ obj: mesh, mat, geo, t: 0, life: 0.45, kind: 'ring', baseScale: target, fade: true })
  }

  fxAoe(simX: number, simY: number, radiusPx: number, color: number, alpha: number): void {
    this.pushRing(simX, simY, radiusPx, color, alpha)
  }

  fxHit(simX: number, simY: number, color: number): void {
    this.emitParticles(wx(simX), 0.7, wz(simY), color, 6, 2.2)
  }

  fxDeath(simX: number, simY: number, color: number, boss: boolean): void {
    this.emitParticles(wx(simX), 0.7, wz(simY), color, boss ? 40 : 14, boss ? 4 : 3)
    // white flash sphere
    const geo = new THREE.SphereGeometry(0.3, 10, 8)
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(wx(simX), 0.7, wz(simY))
    this.scene.add(mesh)
    this.transients.push({ obj: mesh, mat, geo, t: 0, life: 0.3, kind: 'flash', baseScale: boss ? 3.5 : 1.8, fade: true })
  }

  fxMuzzle(simX: number, simY: number, tsimX: number, tsimY: number, color: number, kind: TowerKind): void {
    this.emitParticles(wx(simX), 0.95, wz(simY), color, 4, 1.6)
    if (kind === 'arcane' || kind === 'flame') this.fxBeam(simX, simY, tsimX, tsimY, color, 0.16)
  }

  fxBeam(ax: number, ay: number, bx: number, by: number, color: number, life: number): void {
    const a = new THREE.Vector3(wx(ax), 0.95, wz(ay))
    const b = new THREE.Vector3(wx(bx), 0.8, wz(by))
    const geo = new THREE.BufferGeometry().setFromPoints([a, b])
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false })
    const line = new THREE.Line(geo, mat)
    this.scene.add(line)
    this.transients.push({ obj: line, mat, geo, t: 0, life, kind: 'beam', fade: true })
  }

  fxChain(points: Array<[number, number]>, color: number, supercharged: boolean): void {
    if (points.length < 2) return
    const pts: THREE.Vector3[] = []
    for (const p of points) pts.push(new THREE.Vector3(wx(p[0]), 0.8, wz(p[1])))
    const geo = new THREE.BufferGeometry().setFromPoints(pts)
    const mat = new THREE.LineBasicMaterial({ color: supercharged ? 0xffffff : color, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, linewidth: 2 })
    const line = new THREE.Line(geo, mat)
    this.scene.add(line)
    this.transients.push({ obj: line, mat, geo, t: 0, life: 0.28, kind: 'beam', fade: true })
    for (const p of points) this.emitParticles(wx(p[0]), 0.8, wz(p[1]), color, 3, 2)
  }

  fxPlace(simX: number, simY: number, color: number, radiusPx: number): void {
    this.pushRing(simX, simY, radiusPx, color, 0.9)
    this.emitParticles(wx(simX), 0.7, wz(simY), color, 16, 3)
  }

  fxSpell(key: string, simX: number, simY: number, radiusPx: number, color: number): void {
    if (key === 'meteor') {
      this.pushRing(simX, simY, radiusPx, color, 0.95)
      this.emitParticles(wx(simX), 0.8, wz(simY), 0xffb15c, 60, 5)
      this.emitParticles(wx(simX), 0.8, wz(simY), 0xffd54a, 30, 4)
      const geo = new THREE.SphereGeometry(wr(radiusPx) * 0.6, 12, 10)
      const mat = new THREE.MeshBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.set(wx(simX), 0.8, wz(simY))
      this.scene.add(mesh)
      this.transients.push({ obj: mesh, mat, geo, t: 0, life: 0.4, kind: 'flash', baseScale: 2.2, fade: true })
    } else if (key === 'freeze') {
      for (const [, s] of this.enemyViews) this.emitParticles(s.group.position.x, s.group.position.y, s.group.position.z, 0x9fdcff, 4, 1.5)
    } else {
      this.emitParticles(wx(simX), 0.8, wz(simY), 0xffd54a, 24, 3)
    }
  }

  private updateTransients(dt: number): void {
    for (let i = this.transients.length - 1; i >= 0; i--) {
      const tr = this.transients[i]
      tr.t += dt
      const k = tr.t / tr.life
      if (k >= 1) {
        this.scene.remove(tr.obj)
        if (Array.isArray(tr.mat)) tr.mat.forEach((m) => m.dispose())
        else tr.mat.dispose()
        tr.geo?.dispose()
        this.transients.splice(i, 1)
        continue
      }
      if (tr.kind === 'ring' && tr.baseScale) {
        const sc = 0.3 + (tr.baseScale / 0.66) * k
        tr.obj.scale.setScalar(sc)
      } else if (tr.kind === 'flash' && tr.baseScale) {
        tr.obj.scale.setScalar(0.3 + tr.baseScale * k)
      }
      if (tr.fade) {
        const m = Array.isArray(tr.mat) ? tr.mat[0] : tr.mat
        ;(m as THREE.Material & { opacity: number }).opacity = Math.max(0, 1 - k)
      }
    }
  }

  // ---------------------------------------------------------------- render
  render(dt: number): void {
    if (this.disposed) return
    this.clockT += dt
    // gentle idle camera drift
    this.camBaseAngle = Math.sin(this.clockT * 0.12) * 0.12
    this.camera.position.x = Math.sin(this.camBaseAngle) * 0.9
    this.camera.lookAt(0, -0.2, -0.4)

    // billboard HP bars + shadows follow camera facing (bars face camera on Y)
    for (const [, s] of this.enemyViews) {
      // spawn squash
      if (s.spawnT > 0) {
        s.spawnT += dt
        const p = Math.min(1, s.spawnT / 0.25)
        const sc = p < 1 ? 0.3 + 0.7 * this.easeBack(p) : 1
        s.group.scale.setScalar(sc)
        if (p >= 1) s.spawnT = 0
      }
      if (s.hitT > 0) {
        s.hitT -= dt
        const squash = 1 + Math.max(0, s.hitT / 0.14) * 0.25
        s.body.scale.set(squash, 1 / squash, squash)
      } else {
        s.body.scale.set(1, 1, 1)
      }
      // billboard the hp bar group toward camera (only yaw)
      s.hpBg.quaternion.copy(this.camera.quaternion)
      s.hpFill.quaternion.copy(this.camera.quaternion)
    }
    // billboard particles handled by Points automatically

    // portal spin + base bob (cached refs — no per-frame scene-graph walk)
    this.portalMesh.rotation.z += dt * 1.2
    this.baseMesh.rotation.y += dt * 0.8
    this.baseMesh.position.y = 0.85 + Math.sin(this.clockT * 2) * 0.06

    // hover pulse
    if (this.hoverMesh.visible) this.hoverMesh.scale.setScalar(1 + Math.sin(this.clockT * 6) * 0.06)

    // tower turret idle spin for orb-y ones
    this.updateParticles(dt)
    this.updateTransients(dt)
    this.composer.render()
  }

  private easeBack(p: number): number {
    const c = 1.70158
    const x = p - 1
    return 1 + (c + 1) * x * x * x + c * x * x
  }

  // ---------------------------------------------------------------- init geoms that depend on nothing
  private initSharedGeom(): void {
    this.shadowGeo = new THREE.CircleGeometry(1, 16)
    this.disposables.push(this.shadowGeo)
    this.hpBgGeo = new THREE.PlaneGeometry(0.7, 0.1)
    this.hpFillGeo = new THREE.PlaneGeometry(0.66, 0.07)
    this.disposables.push(this.hpBgGeo, this.hpFillGeo)
    this.hpBgMat = new THREE.MeshBasicMaterial({ color: 0x101018, transparent: true, opacity: 0.7 })
    this.disposables.push(this.hpBgMat)
  }

  // ---------------------------------------------------------------- teardown
  dispose(): void {
    if (this.disposed) return
    this.disposed = true

    // transients
    for (const tr of this.transients) {
      this.scene.remove(tr.obj)
      if (Array.isArray(tr.mat)) tr.mat.forEach((m) => m.dispose()); else tr.mat.dispose()
      tr.geo?.dispose()
    }
    this.transients = []

    // buff lines
    for (const o of this.buffLinesGroup.children) {
      const l = o as THREE.Line
      l.geometry.dispose()
      ;(l.material as THREE.Material).dispose()
    }

    // enemy slots (pooled + active) — dispose their per-slot materials
    const disposeSlot = (s: EnemySlot) => {
      s.bodyMat.dispose()
      s.hpFillMat.dispose()
      if (s.shield) { /* geo/mat tracked in disposables */ }
    }
    for (const [, s] of this.enemyViews) disposeSlot(s)
    for (const [, pool] of this.enemyPools) for (const s of pool) disposeSlot(s)
    this.enemyViews.clear()
    this.enemyPools.clear()

    // enemy shared geometries
    for (const [, g] of this.enemyGeo) g.dispose()
    this.enemyGeo.clear()

    // towers
    for (const [, s] of this.towerViews) this.scene.remove(s.group)
    this.towerViews.clear()

    // projectiles pooled — geos/mats tracked in disposables
    this.projViews.clear()
    this.projPool = []

    // everything registered
    for (const d of this.disposables) {
      try { d.dispose() } catch { /* ignore */ }
    }
    this.disposables = []

    // board
    this.boardTiles.dispose()

    // composer render targets + passes
    this.composer.dispose()
    this.bloom.dispose()
    this.renderPass.dispose?.()
    this.outputPass.dispose?.()

    this.renderer.dispose()
    this.renderer.forceContextLoss()

    if (this.canvas.parentElement) this.canvas.parentElement.removeChild(this.canvas)
    // help the GC
    this.scene.clear()
  }
}
