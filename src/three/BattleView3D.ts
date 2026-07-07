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

import type { Sim, SimEnemy, SimHero, SimTower } from '../sim'
import { COLS, ROWS, MAP_X, MAP_Y, MAP_W, MAP_H, worldToCell } from '../sim'
import { TOWERS, type TowerKind } from '../game/towers'
import { RARITY_COLOR } from '../game/heroes'
import type { SpellEffect } from '../game/heroes'
import type { EnemyKind } from '../game/enemies'
import type { FieldPalette } from '../game/levels'
import { models } from './models'

const TILE_PX = 80
const CX = MAP_X + MAP_W / 2 // 360
const CY = MAP_Y + MAP_H / 2 // 640

// The Kenney tiles are 1×1 with their top surface at y=0.2 — a near-flat board, so
// a single pick plane at this height is WYSIWYG everywhere (no per-cell-height hack).
const GROUND = 0.2

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
  bodyGroup: THREE.Group // fixed pedestal/body (Kenney stacked parts)
  turret: THREE.Group // aims toward the target (weapon/crystal cap + orbs)
  orbs: THREE.Object3D[] // bobbing emissive accents
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

// A deployed hero: an element-tinted robed figure with a floating element crystal,
// a rarity-coloured ground ring, a glow light and a billboard level badge.
interface HeroSlot {
  group: THREE.Group
  figure: THREE.Group // yaw toward the current target
  bodyMat: THREE.MeshStandardMaterial
  orb: THREE.Mesh
  orbMat: THREE.MeshStandardMaterial
  ringMat: THREE.MeshBasicMaterial
  glow: THREE.PointLight
  badgeTex: THREE.CanvasTexture
  badgeMat: THREE.SpriteMaterial
  color: number
  heroId: string
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
  // Pick plane sits exactly at the Kenney tile top (y=GROUND). The board is now
  // near-flat (all tiles top within 0.1 of each other), so this single plane is
  // WYSIWYG for both hover and a cold first tap — no per-cell-height hack needed.
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -GROUND)
  private hitPoint = new THREE.Vector3()

  private boardMeshes: THREE.InstancedMesh[] = [] // grass + road instanced tiles
  private detailGroup = new THREE.Group()
  private buildHighlight = new THREE.Group()
  private hoverMesh!: THREE.Mesh
  private hoverMat!: THREE.MeshBasicMaterial
  private portalMesh!: THREE.Mesh
  private baseMesh!: THREE.Mesh
  private buffDirty = true

  // shared kit materials (atlas map + role tint/emissive) — few draw-call state changes
  private atlasBaseMat!: THREE.MeshStandardMaterial
  private elemMats = new Map<TowerKind, THREE.MeshStandardMaterial>()
  private orbMats = new Map<TowerKind, THREE.MeshStandardMaterial>()
  private detailCrystalMat!: THREE.MeshStandardMaterial
  private orbGeo!: THREE.IcosahedronGeometry
  private blobTex!: THREE.CanvasTexture
  private blobMat!: THREE.MeshBasicMaterial
  private blobGeo!: THREE.CircleGeometry

  private enemyPools = new Map<EnemyKind, EnemySlot[]>()
  private enemyViews = new Map<number, EnemySlot>()
  private towerViews = new Map<number, TowerSlot>()
  private heroViews = new Map<number, HeroSlot>()
  private heroBodyGeo!: THREE.ConeGeometry
  private heroHeadGeo!: THREE.SphereGeometry
  private heroOrbGeo!: THREE.IcosahedronGeometry
  private heroRingGeo!: THREE.RingGeometry
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
    private pathCells: ReadonlyArray<[number, number]> = [], // ordered spawn→base cells
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

    this.scene.add(this.detailGroup)
    this.scene.add(this.buildHighlight)
    this.buildHighlight.visible = false

    this.initSharedGeom()
    this.initModelMaterials()
    this.setupLights()
    this.setupBoard()
    this.setupDetails()
    this.setupBuildHighlight()
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
  // Coherence rig: warm KEY + cool FILL + cool RIM + soft sky/ground hemi, plus a
  // low ambient floor so nothing crushes to black. Kept deliberately tight so the
  // whole board reads as one palette and the emissive tower caps are what pops.
  private setupLights(): void {
    const hemi = new THREE.HemisphereLight(0xdbeaff, 0x35264f, 0.7) // cool sky, warm-ish ground
    this.scene.add(hemi)
    this.scene.add(new THREE.AmbientLight(0x40507a, 0.35))
    const key = new THREE.DirectionalLight(0xfff1cf, 1.25) // warm sun from front-right
    key.position.set(7, 15, 9)
    this.scene.add(key)
    const fill = new THREE.DirectionalLight(0x9ec4ff, 0.4) // cool bounce from the left
    fill.position.set(-9, 6, -5)
    this.scene.add(fill)
    const rim = new THREE.DirectionalLight(0xbf9bff, 0.35) // violet rim from behind
    rim.position.set(0, 8, -12)
    this.scene.add(rim)
    // one soft coloured accent tuned to the world's element ground.
    const accent = new THREE.PointLight(this.accent, 0.45, 26, 2)
    accent.position.set(-2, 4, 3)
    this.scene.add(accent)
  }

  // ------------------------------------------------------ shared kit materials
  private initModelMaterials(): void {
    const atlas = models.atlas()
    // ONE textured material drives every kit body/tile mesh (their UVs index the
    // shared atlas), so the board + tower bodies collapse to a few draw calls.
    this.atlasBaseMat = new THREE.MeshStandardMaterial({
      map: atlas ?? null,
      color: atlas ? 0xffffff : 0x9aa4b0, // flat stone if the atlas ever fails
      roughness: 0.82,
      metalness: 0.05,
    })
    this.disposables.push(this.atlasBaseMat)

    for (const kind of Object.keys(TOWERS) as TowerKind[]) {
      const col = TOWERS[kind].color
      const sig = new THREE.MeshStandardMaterial({
        map: atlas ?? null, color: atlas ? 0xffffff : col,
        emissive: col, emissiveIntensity: 0.6, roughness: 0.5, metalness: 0.25,
      })
      this.elemMats.set(kind, sig)
      this.disposables.push(sig)
      const orb = new THREE.MeshStandardMaterial({
        color: col, emissive: col, emissiveIntensity: 1.5, roughness: 0.3, metalness: 0.1, flatShading: true,
      })
      this.orbMats.set(kind, orb)
      this.disposables.push(orb)
    }
    this.orbGeo = new THREE.IcosahedronGeometry(0.12, 0)
    this.disposables.push(this.orbGeo)

    this.detailCrystalMat = new THREE.MeshStandardMaterial({
      map: atlas ?? null, color: atlas ? 0xffffff : 0x4ad9ff,
      emissive: 0x4ad9ff, emissiveIntensity: 0.5, roughness: 0.4, metalness: 0.2,
    })
    this.disposables.push(this.detailCrystalMat)

    // Soft radial contact-shadow blob (cheap substitute for real shadow maps).
    const cv = document.createElement('canvas')
    cv.width = cv.height = 64
    const ctx = cv.getContext('2d')!
    const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 30)
    grad.addColorStop(0, 'rgba(0,0,0,0.5)')
    grad.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, 64, 64)
    this.blobTex = new THREE.CanvasTexture(cv)
    this.disposables.push(this.blobTex)
    this.blobMat = new THREE.MeshBasicMaterial({ map: this.blobTex, transparent: true, depthWrite: false, opacity: 0.85 })
    this.disposables.push(this.blobMat)
    this.blobGeo = new THREE.CircleGeometry(1, 20)
    this.disposables.push(this.blobGeo)
  }

  // paint every mesh in a cloned model with a shared material (drops the model's
  // own per-file material so we hold few materials and re-tint by role).
  private paint(obj: THREE.Object3D, mat: THREE.Material): void {
    obj.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.material = mat })
  }

  private addBlob(parent: THREE.Object3D, radius: number, y = 0.012): void {
    const b = new THREE.Mesh(this.blobGeo, this.blobMat)
    b.rotation.x = -Math.PI / 2
    b.position.y = y
    b.scale.setScalar(radius)
    parent.add(b)
  }

  // ---------------------------------------------------------------- board
  // Renders the near-flat Kenney board: one InstancedMesh for grass/build tiles
  // (per-instance world tint) plus a small InstancedMesh per road-tile TYPE, each
  // oriented by matching the tile's default open edges to the local path direction.
  private setupBoard(): void {
    const groundGeo = models.geometry('tile')
    if (groundGeo) {
      const nonPath: Array<[number, number, string]> = []
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++)
          if (this.sim.grid[r][c] !== 'path') nonPath.push([c, r, this.sim.grid[r][c]])
      const inst = new THREE.InstancedMesh(groundGeo, this.atlasBaseMat, nonPath.length)
      const dummy = new THREE.Object3D()
      // Tint the (green) atlas grass toward each world's palette, lifted toward white
      // so the multiply stays bright and readable instead of muddying to brown.
      const white = new THREE.Color(0xffffff)
      const grassA = new THREE.Color(this.palette.grassA).lerp(white, 0.24)
      const grassB = new THREE.Color(this.palette.grassB).lerp(white, 0.24)
      const buildC = new THREE.Color(this.palette.build).lerp(white, 0.34)
      nonPath.forEach(([c, r, kind], i) => {
        dummy.position.set(wx(MAP_X + c * TILE_PX + TILE_PX / 2), 0, wz(MAP_Y + r * TILE_PX + TILE_PX / 2))
        dummy.rotation.set(0, 0, 0)
        dummy.scale.setScalar(1)
        dummy.updateMatrix()
        inst.setMatrixAt(i, dummy.matrix)
        inst.setColorAt(i, kind === 'build' ? buildC : (c + r) % 2 === 0 ? grassA : grassB)
      })
      inst.instanceMatrix.needsUpdate = true
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true
      inst.frustumCulled = false
      this.boardMeshes.push(inst)
      this.scene.add(inst)
      this.disposables.push(groundGeo)
    }

    this.setupRoad()
    this.setupEndpoints()
  }

  // Classify each ordered path cell → tile type + Y-rotation, then batch by type.
  private setupRoad(): void {
    const geos: Record<string, THREE.BufferGeometry | null> = {
      straight: models.geometry('tile-straight'),
      corner: models.geometry('tile-corner-round'),
      spawn: models.geometry('tile-spawn'),
      end: models.geometry('tile-end'),
    }
    for (const g of Object.values(geos)) if (g) this.disposables.push(g)

    const path = this.pathCells
    if (!path.length) return
    const buckets: Record<string, Array<{ x: number; z: number; theta: number }>> = {
      straight: [], corner: [], spawn: [], end: [],
    }
    const V = (x: number, z: number) => new THREE.Vector3(x, 0, z)
    const dirTo = (from: [number, number], to: [number, number]) =>
      V(Math.sign(to[0] - from[0]), Math.sign(to[1] - from[1]))
    const ROT = [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]
    const rot = (v: THREE.Vector3, th: number) => {
      const c = Math.cos(th), s = Math.sin(th)
      return V(v.x * c + v.z * s, -v.x * s + v.z * c)
    }
    const eq = (a: THREE.Vector3, b: THREE.Vector3) => Math.abs(a.x - b.x) < 0.01 && Math.abs(a.z - b.z) < 0.01
    // find θ mapping default open-edge set → required set (pair, unordered)
    const solvePair = (d1: THREE.Vector3, d2: THREE.Vector3, r1: THREE.Vector3, r2: THREE.Vector3) => {
      for (const th of ROT) {
        const a = rot(d1, th), b = rot(d2, th)
        if ((eq(a, r1) && eq(b, r2)) || (eq(a, r2) && eq(b, r1))) return th
      }
      return 0
    }
    const solveSingle = (d: THREE.Vector3, r: THREE.Vector3) => {
      for (const th of ROT) if (eq(rot(d, th), r)) return th
      return 0
    }
    const PZ = V(0, 1), NZ = V(0, -1), PX = V(1, 0)

    for (let i = 0; i < path.length; i++) {
      const cell = path[i]
      const x = wx(MAP_X + cell[0] * TILE_PX + TILE_PX / 2)
      const z = wz(MAP_Y + cell[1] * TILE_PX + TILE_PX / 2)
      const toNext = i < path.length - 1 ? dirTo(cell, path[i + 1]) : null
      const toPrev = i > 0 ? dirTo(cell, path[i - 1]) : null
      if (i === 0 && toNext) {
        // spawn: road passes straight through (off-board entry is opposite `next`)
        buckets.spawn.push({ x, z, theta: solvePair(PZ, NZ, toNext, rot(toNext, Math.PI)) })
      } else if (i === path.length - 1 && toPrev) {
        // base: road enters from the previous cell and terminates
        buckets.end.push({ x, z, theta: solveSingle(PZ, toPrev) })
      } else if (toPrev && toNext) {
        if (eq(toPrev, rot(toNext, Math.PI))) {
          buckets.straight.push({ x, z, theta: solvePair(PZ, NZ, toPrev, toNext) })
        } else {
          buckets.corner.push({ x, z, theta: solvePair(PX, PZ, toPrev, toNext) })
        }
      }
    }

    const dummy = new THREE.Object3D()
    for (const type of ['straight', 'corner', 'spawn', 'end'] as const) {
      const geo = geos[type]
      const list = buckets[type]
      if (!geo || !list.length) continue
      const inst = new THREE.InstancedMesh(geo, this.atlasBaseMat, list.length)
      list.forEach((t, i) => {
        dummy.position.set(t.x, 0, t.z)
        dummy.rotation.set(0, t.theta, 0)
        dummy.scale.setScalar(1)
        dummy.updateMatrix()
        inst.setMatrixAt(i, dummy.matrix)
      })
      inst.instanceMatrix.needsUpdate = true
      inst.frustumCulled = false
      this.boardMeshes.push(inst)
      this.scene.add(inst)
    }
  }

  // Scatter trees / rocks / crystals on non-play (blocked) cells for life.
  private setupDetails(): void {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (this.sim.grid[r][c] !== 'blocked') continue
        const h = hash2(c * 3 + 1, r * 5 + 2)
        if (h > 0.5) continue // only decorate ~half the blocked cells
        const pick = hash2(c * 7 + 3, r * 2 + 9)
        let name: string, mat: THREE.Material, blob: number, scale: number
        if (pick < 0.34) { name = h < 0.25 ? 'detail-tree-large' : 'detail-tree'; mat = this.atlasBaseMat; blob = 0.28; scale = 0.9 + h }
        else if (pick < 0.68) { name = h < 0.25 ? 'detail-rocks-large' : 'detail-rocks'; mat = this.atlasBaseMat; blob = 0.32; scale = 0.85 + h * 0.5 }
        else { name = h < 0.2 ? 'detail-crystal-large' : 'detail-crystal'; mat = this.detailCrystalMat; blob = 0.22; scale = 0.9 + h }
        const g = new THREE.Group()
        const obj = models.clone(name)
        this.paint(obj, mat)
        obj.scale.setScalar(scale)
        obj.rotation.y = pick * Math.PI * 2
        g.add(obj)
        if (name.indexOf('rocks') < 0) this.addBlob(g, blob)
        // jitter within the cell so scatter doesn't look grid-locked
        const jx = (hash2(c, r * 2) - 0.5) * 0.4
        const jz = (hash2(c * 2, r) - 0.5) * 0.4
        g.position.set(wx(MAP_X + c * TILE_PX + TILE_PX / 2) + jx, GROUND, wz(MAP_Y + r * TILE_PX + TILE_PX / 2) + jz)
        this.detailGroup.add(g)
      }
    }
  }

  // Buildable-cell highlight (shown while placing a tower) using selection markers.
  private setupBuildHighlight(): void {
    const cells = this.sim.buildCells()
    const geo = models.geometry('selection-a')
    const mat = new THREE.MeshBasicMaterial({ color: 0x8affc0, transparent: true, opacity: 0.32, depthWrite: false })
    this.disposables.push(mat)
    if (geo) this.disposables.push(geo)
    for (const { col, row } of cells) {
      const mesh = geo
        ? new THREE.Mesh(geo, mat)
        : new THREE.Mesh(this.blobGeo, mat)
      if (!geo) mesh.rotation.x = -Math.PI / 2
      mesh.position.set(wx(MAP_X + col * TILE_PX + TILE_PX / 2), GROUND + 0.015, wz(MAP_Y + row * TILE_PX + TILE_PX / 2))
      this.buildHighlight.add(mesh)
    }
  }

  setBuildHighlight(on: boolean): void {
    this.buildHighlight.visible = on
  }

  private setupEndpoints(): void {
    const portal = this.sim.waypointFor('portal')
    const base = this.sim.waypointFor('base')

    const portalGeo = new THREE.TorusGeometry(0.42, 0.11, 10, 24)
    const portalMat = new THREE.MeshStandardMaterial({ color: 0x9a5cff, emissive: 0x9a5cff, emissiveIntensity: 1.4, roughness: 0.4 })
    this.disposables.push(portalGeo, portalMat)
    const portalMesh = new THREE.Mesh(portalGeo, portalMat)
    portalMesh.position.set(wx(portal.x), GROUND + 0.35, wz(portal.y))
    portalMesh.rotation.x = Math.PI / 2
    this.scene.add(portalMesh)
    this.portalMesh = portalMesh

    const baseGeo = new THREE.OctahedronGeometry(0.5, 0)
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x2ff7c3, emissive: 0x2ff7c3, emissiveIntensity: 1.1, roughness: 0.25, metalness: 0.2, flatShading: true })
    this.disposables.push(baseGeo, baseMat)
    const baseMesh = new THREE.Mesh(baseGeo, baseMat)
    baseMesh.position.set(wx(base.x), GROUND + 0.55, wz(base.y))
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
    this.hoverMesh.position.set(x, GROUND + 0.03, z)
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

    // grounded on the (near-flat) Kenney board: ground bodies rest their base on the
    // tile top; flyers hover above it. Shadow stays pinned to the ground plane.
    const hoverY = def.isAir ? GROUND + 0.8 : GROUND + r

    // contact shadow (kept on the ground under the unit, even for flyers)
    const shadow = new THREE.Mesh(this.shadowGeo, this.shadowMat())
    shadow.rotation.x = -Math.PI / 2
    shadow.position.y = GROUND + 0.03 - hoverY
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
  // Kenney modular parts stacked on a fixed body; an aiming cap (weapon/crystals)
  // carries the ELEMENT via an emissive-tinted material + optional bobbing orb.
  // Tier (level) grows the silhouette by adding parts; branch swaps the crown/weapon.
  private static readonly PART_H: Record<string, number> = {
    'tower-round-base': 0.21,
    'tower-round-bottom-a': 0.6, 'tower-round-bottom-b': 0.6, 'tower-round-bottom-c': 0.6,
    'tower-round-middle-a': 0.6, 'tower-round-middle-b': 0.6, 'tower-round-middle-c': 0.6,
    'tower-round-top-a': 0.5, 'tower-round-top-b': 0.5, 'tower-round-top-c': 0.533,
  }
  private static readonly BOTTOM: Record<TowerKind, string> = { cannon: 'a', frost: 'a', flame: 'b', storm: 'c', arcane: 'a' }
  private static readonly MIDDLE: Record<TowerKind, string> = { cannon: 'a', frost: 'c', flame: 'a', storm: 'b', arcane: 'c' }
  private static readonly TOP: Record<TowerKind, string> = { cannon: 'a', frost: 'c', flame: 'a', storm: 'b', arcane: 'c' }

  private addOrb(slot: TowerSlot, kind: TowerKind, h: number, scale: number): void {
    const o = new THREE.Mesh(this.orbGeo, this.orbMats.get(kind)!)
    o.scale.setScalar(scale)
    o.position.y = h
    o.userData.y0 = h
    o.userData.phase = slot.orbs.length * 1.7
    slot.turret.add(o)
    slot.orbs.push(o)
  }

  private assembleTower(slot: TowerSlot, t: SimTower): void {
    slot.bodyGroup.clear()
    slot.turret.clear()
    slot.orbs = []
    const kind = t.kind
    const level = t.level // 0..2 linear, 3 = branched
    const branch = t.branch // -1 none else 0/1
    const H = BattleView3D.PART_H
    const add = (name: string, y: number): number => {
      const o = models.clone(name)
      this.paint(o, this.atlasBaseMat)
      o.position.y = y
      slot.bodyGroup.add(o)
      return y + (H[name] ?? 0.5)
    }
    let y = add('tower-round-base', 0)
    y = add('tower-round-bottom-' + BattleView3D.BOTTOM[kind], y)
    if (level >= 1) y = add('tower-round-middle-' + BattleView3D.MIDDLE[kind], y)
    if (level >= 2) {
      let topVar = BattleView3D.TOP[kind]
      if (level >= 3) topVar = branch === 0 ? 'a' : 'b'
      y = add('tower-round-top-' + topVar, y)
    }

    // aiming cap pivots at the top of the body
    slot.turret.position.y = y
    const capMat = this.elemMats.get(kind)!
    const grow = 1 + Math.min(level, 3) * 0.07
    const putWeapon = (name: string) => {
      const o = models.clone(name)
      this.paint(o, capMat)
      o.scale.setScalar(grow)
      slot.turret.add(o)
    }
    const putCrystals = (scale: number) => {
      const o = models.clone('tower-round-crystals')
      this.paint(o, capMat)
      o.scale.setScalar(scale)
      o.position.y = 0.365 * scale // seat its centred geometry on the body top
      slot.turret.add(o)
    }
    if (kind === 'cannon') putWeapon(branch === 1 ? 'weapon-catapult' : 'weapon-cannon')
    else if (kind === 'flame') putWeapon(branch === 0 ? 'weapon-catapult' : 'weapon-turret')
    else if (kind === 'storm') { putWeapon(branch === 1 ? 'weapon-cannon' : 'weapon-ballista'); this.addOrb(slot, kind, 0.55, 1) }
    else if (kind === 'frost') putCrystals(grow * (branch === 1 ? 1.25 : 1))
    else { putCrystals(grow); this.addOrb(slot, kind, 0.7, branch === 1 ? 1.4 : 1) } // arcane

    slot.level = level
    slot.branch = branch
  }

  private createTowerSlot(t: SimTower): TowerSlot {
    const def = t.def
    const g = new THREE.Group()
    g.position.set(wx(t.x), GROUND, wz(t.y)) // sits on the tile top
    const bodyGroup = new THREE.Group()
    const turret = new THREE.Group()
    g.add(bodyGroup, turret)
    this.addBlob(g, 0.5) // contact shadow

    // range ring on the ground (element coloured)
    const ringGeo = new THREE.RingGeometry(0.9, 0.98, 40)
    const ringMat = new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.85, side: THREE.DoubleSide })
    this.disposables.push(ringGeo, ringMat)
    const ring = new THREE.Mesh(ringGeo, ringMat)
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 0.03
    ring.visible = false
    g.add(ring)

    const glow = new THREE.PointLight(def.color, 0.5, 4, 2)
    glow.position.y = 1.1
    g.add(glow)

    const slot: TowerSlot = { group: g, bodyGroup, turret, orbs: [], ring, ringMat, glow, level: t.level, branch: t.branch, kind: t.kind, fireT: 0 }
    this.assembleTower(slot, t)
    this.scene.add(g)
    return slot
  }

  private rebuildTurret(slot: TowerSlot, t: SimTower): void {
    this.assembleTower(slot, t)
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
    this.syncHeroes()
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

  // ---------------------------------------------------------------- heroes
  private syncHeroes(): void {
    const active = this.activeScratch
    active.clear()
    for (const h of this.sim.heroes) {
      if (!h.active) continue
      active.add(h.id)
      let s = this.heroViews.get(h.id)
      if (!s) { s = this.createHeroSlot(h); this.heroViews.set(h.id, s); this.buffDirty = true }
      this.updateHeroSlot(s, h)
    }
    for (const [id, s] of this.heroViews) {
      if (!active.has(id)) {
        this.scene.remove(s.group)
        this.disposeHeroSlot(s)
        this.heroViews.delete(id)
        this.buffDirty = true
      }
    }
  }

  private makeLevelBadge(level: number, color: number): { tex: THREE.CanvasTexture; mat: THREE.SpriteMaterial; sprite: THREE.Sprite } {
    const c = document.createElement('canvas')
    c.width = 128
    c.height = 64
    const ctx = c.getContext('2d')!
    ctx.fillStyle = 'rgba(10,6,22,0.9)'
    ctx.beginPath()
    if (typeof ctx.roundRect === 'function') ctx.roundRect(6, 10, 116, 44, 12)
    else ctx.rect(6, 10, 116, 44) // older Safari lacks roundRect
    ctx.fill()
    ctx.lineWidth = 6
    ctx.strokeStyle = '#' + (color & 0xffffff).toString(16).padStart(6, '0')
    ctx.stroke()
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 34px Baloo 2, Arial, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('Lv ' + level, 64, 34)
    const tex = new THREE.CanvasTexture(c)
    tex.anisotropy = 2
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false })
    const sprite = new THREE.Sprite(mat)
    sprite.scale.set(0.95, 0.48, 1)
    return { tex, mat, sprite }
  }

  private createHeroSlot(h: SimHero): HeroSlot {
    const def = h.def
    const g = new THREE.Group()
    g.position.set(wx(h.x), GROUND, wz(h.y))

    const figure = new THREE.Group()
    const bodyMat = new THREE.MeshStandardMaterial({ color: def.color, emissive: def.color, emissiveIntensity: 0.5, roughness: 0.4, metalness: 0.25, flatShading: true })
    const body = new THREE.Mesh(this.heroBodyGeo, bodyMat)
    body.position.y = 0.48
    const head = new THREE.Mesh(this.heroHeadGeo, bodyMat)
    head.position.y = 1.02
    figure.add(body, head)
    g.add(figure)

    // floating element crystal
    const orbMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: def.color, emissiveIntensity: 1.5, roughness: 0.15, metalness: 0.1 })
    const orb = new THREE.Mesh(this.heroOrbGeo, orbMat)
    orb.position.set(0.46, 1.12, 0)
    orb.userData.y0 = 1.12
    g.add(orb)

    // rarity-coloured ground ring (marks the character apart from towers)
    const ringMat = new THREE.MeshBasicMaterial({ color: RARITY_COLOR[def.rarity], transparent: true, opacity: 0.95, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
    const ring = new THREE.Mesh(this.heroRingGeo, ringMat)
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 0.045
    g.add(ring)

    this.addBlob(g, 0.4)

    const glow = new THREE.PointLight(def.color, 0.9, 4.5, 2)
    glow.position.y = 1.0
    g.add(glow)

    const badge = this.makeLevelBadge(h.level, def.color)
    badge.sprite.position.y = 1.62
    g.add(badge.sprite)

    this.scene.add(g)
    return { group: g, figure, bodyMat, orb, orbMat, ringMat, glow, badgeTex: badge.tex, badgeMat: badge.mat, color: def.color, heroId: h.heroId }
  }

  private updateHeroSlot(s: HeroSlot, h: SimHero): void {
    s.group.position.set(wx(h.x), GROUND, wz(h.y))
    s.figure.rotation.y = -h.aimAngle + Math.PI / 2
    const flashing = h.fireFlash > 0
    s.bodyMat.emissiveIntensity = flashing ? 1.2 : 0.5
    s.glow.intensity = 0.9 + (flashing ? 1.6 : 0)
    // temporary Holy-Nova buff → brighten the crystal
    const buffed = h.buffUntil > this.sim.clock
    s.orbMat.emissiveIntensity = buffed ? 2.6 : 1.5
  }

  private disposeHeroSlot(s: HeroSlot): void {
    s.bodyMat.dispose()
    s.orbMat.dispose()
    s.ringMat.dispose()
    s.badgeMat.dispose()
    s.badgeTex.dispose()
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
    // element-synergy glow links between fielded heroes (brighter, additive)
    for (const l of this.sim.synergyLinks()) {
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(wx(l.ax), 0.95, wz(l.ay)),
        new THREE.Vector3(wx(l.bx), 0.95, wz(l.by)),
      ])
      const mat = new THREE.LineBasicMaterial({ color: l.color, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false })
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

  // ---------------------------------------------------------------- hero FX
  fxHeroDeploy(simX: number, simY: number, color: number, radiusPx: number): void {
    this.pushRing(simX, simY, radiusPx, color, 0.9)
    this.emitParticles(wx(simX), 0.9, wz(simY), color, 24, 3.2)
    this.emitParticles(wx(simX), 0.9, wz(simY), 0xffffff, 8, 2)
  }

  fxHeroFire(simX: number, simY: number, tsimX: number, tsimY: number, color: number): void {
    this.fxBeam(simX, simY, tsimX, tsimY, color, 0.12)
    this.emitParticles(wx(tsimX), 0.7, wz(tsimY), color, 5, 2.2)
  }

  fxHeroSpell(effect: SpellEffect, simX: number, simY: number, radiusPx: number, color: number): void {
    const wxp = wx(simX)
    const wzp = wz(simY)
    if (effect === 'aoeBurn') {
      this.pushRing(simX, simY, radiusPx, 0xff8a3c, 0.95)
      this.emitParticles(wxp, 0.8, wzp, 0xffb15c, 54, 5)
      this.emitParticles(wxp, 0.8, wzp, 0xffd54a, 26, 4)
      this.spellFlash(simX, simY, radiusPx, 0xffe0a0, 2.0)
    } else if (effect === 'freeze') {
      this.pushRing(simX, simY, radiusPx, 0x9fdcff, 0.95)
      this.emitParticles(wxp, 0.8, wzp, 0x9fdcff, 46, 4)
      this.spellFlash(simX, simY, radiusPx, 0xd6f4ff, 1.7)
    } else if (effect === 'heal') {
      this.pushRing(simX, simY, radiusPx, 0x6bffb0, 0.95)
      this.emitParticles(wxp, 0.7, wzp, 0x6bffb0, 40, 3.4)
    } else if (effect === 'novaBuff') {
      this.pushRing(simX, simY, radiusPx, 0xfff0a0, 0.95)
      this.emitParticles(wxp, 0.9, wzp, 0xfff0a0, 60, 4.5)
      this.spellFlash(simX, simY, radiusPx, 0xfff6c8, 2.4)
    } else if (effect === 'execute') {
      this.emitParticles(wxp, 0.8, wzp, color, 44, 5)
      this.emitParticles(wxp, 0.8, wzp, 0x000000, 18, 3)
      this.spellFlash(simX, simY, radiusPx || 60, color, 1.4)
    } else {
      // chain: handled by the separate 'chain' event; just a spark at the origin
      this.emitParticles(wxp, 0.8, wzp, color, 12, 3)
    }
  }

  private spellFlash(simX: number, simY: number, radiusPx: number, color: number, scale: number): void {
    const geo = new THREE.SphereGeometry(Math.max(0.2, wr(radiusPx) * 0.5), 12, 10)
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(wx(simX), 0.8, wz(simY))
    this.scene.add(mesh)
    this.transients.push({ obj: mesh, mat, geo, t: 0, life: 0.4, kind: 'flash', baseScale: scale, fade: true })
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
    this.baseMesh.position.y = GROUND + 0.55 + Math.sin(this.clockT * 2) * 0.06

    // hover pulse
    if (this.hoverMesh.visible) this.hoverMesh.scale.setScalar(1 + Math.sin(this.clockT * 6) * 0.06)

    // bob tower accent orbs
    for (const [, s] of this.towerViews) {
      for (const o of s.orbs) {
        const y0 = o.userData.y0 as number
        o.position.y = y0 + Math.sin(this.clockT * 2.2 + (o.userData.phase as number)) * 0.07
        o.rotation.y += dt * 1.5
      }
    }

    // hero: bob + spin the element crystal, gentle idle sway of the figure
    for (const [, s] of this.heroViews) {
      const y0 = s.orb.userData.y0 as number
      s.orb.position.y = y0 + Math.sin(this.clockT * 2.6) * 0.06
      s.orb.rotation.y += dt * 2.2
      s.orb.rotation.x += dt * 1.1
      s.figure.position.y = Math.sin(this.clockT * 2 + s.group.position.x) * 0.03
    }

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
    // hero figure primitives (shared across all hero slots)
    this.heroBodyGeo = new THREE.ConeGeometry(0.34, 0.95, 7)
    this.heroHeadGeo = new THREE.SphereGeometry(0.19, 12, 10)
    this.heroOrbGeo = new THREE.IcosahedronGeometry(0.16, 0)
    this.heroRingGeo = new THREE.RingGeometry(0.5, 0.6, 32)
    this.disposables.push(this.heroBodyGeo, this.heroHeadGeo, this.heroOrbGeo, this.heroRingGeo)
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

    // towers + details share REGISTRY geometry/materials — just detach; never
    // dispose their geometry (the persistent registry re-uploads it next battle).
    for (const [, s] of this.towerViews) this.scene.remove(s.group)
    this.towerViews.clear()
    // hero slots own per-slot materials + a canvas badge texture — dispose them
    for (const [, s] of this.heroViews) { this.scene.remove(s.group); this.disposeHeroSlot(s) }
    this.heroViews.clear()
    this.scene.remove(this.detailGroup)
    this.scene.remove(this.buildHighlight)

    // projectiles pooled — geos/mats tracked in disposables
    this.projViews.clear()
    this.projPool = []

    // everything registered
    for (const d of this.disposables) {
      try { d.dispose() } catch { /* ignore */ }
    }
    this.disposables = []

    // board instanced meshes (dispose instance buffers; their cloned geometry is
    // also tracked in `disposables` above — dispose is idempotent)
    for (const m of this.boardMeshes) { this.scene.remove(m); m.dispose() }
    this.boardMeshes = []

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
