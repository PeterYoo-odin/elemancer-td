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

import type { Sim, SimEnemy, SimHero, SimTower, AuraElement } from '../sim'
import { COLS, ROWS, MAP_X, MAP_Y, MAP_W, MAP_H, AURA_COLOR, worldToCell } from '../sim'
import { TOWERS, type TowerKind } from '../game/towers'
import { towerPalette, spellColor, heroDye } from '../game/skins'
import { RARITY_COLOR } from '../game/heroes'
import type { SpellEffect } from '../game/heroes'
import type { EnemyKind } from '../game/enemies'
import type { FieldPalette } from '../game/levels'
import { models } from './models'
import { towerVisual, accentGeometry, type AccentSpec, type PartRole, type TowerVisual } from './towerModels'
import { appSettings } from '../ui/settings'
import { heroCutout } from '../ui/heroArt'

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
  // procedural walk/status animation state (view-only)
  prevX: number // last sim px position, for travel-direction facing
  prevY: number
  yaw: number // smoothed facing
  walkT: number // walk-bob phase, advances with movement speed
  animSpeed: number // 1 normal · <1 slowed · 0 stunned/frozen
  burning: boolean
  emberAcc: number // throttles burning-ember emission
  isAir: boolean
  // PRIMED aura pip — a small orbiting crystal in the painted element's colour,
  // so "one more different-element hit detonates" is readable at a glance.
  auraPip: THREE.Mesh | null
  auraPipMat: THREE.MeshBasicMaterial | null
  // Corrupted Keeper crown — a slow-precessing halo ring in the Keeper's realm
  // colour ('keeper' kind only; retinted per Keeper since the pool is shared)
  crown: THREE.Mesh | null
  crownMat: THREE.MeshBasicMaterial | null
}

// One animated garnish on a tower (floating ring / orb / flame / runestone):
// spawned from the tower's AccentSpec list; render() drives spin/bob/flicker.
interface TowerAccent {
  obj: THREE.Object3D
  spec: AccentSpec
  x0: number
  y0: number
  z0: number
  s0: number // base uniform scale (flicker multiplies this)
}

interface TowerSlot {
  group: THREE.Group
  bodyGroup: THREE.Group // fixed pedestal/body (procedural merged hull)
  turret: THREE.Group // aims toward the target (weapon/crystal crown)
  accents: TowerAccent[] // animated emissive garnish (rings, orbs, flames)
  emitter: TowerVisual['emitter'] | null // idle element FX (mist/embers/sparks)
  emitAcc: number // throttles idle emission
  height: number // approx model height (veil + glow placement)
  ring: THREE.Mesh
  ringMat: THREE.MeshBasicMaterial
  glow: THREE.PointLight
  level: number
  branch: number
  kind: TowerKind
  fireT: number
  // motion state (view-only)
  aimYaw: number // smoothed turret yaw
  targetYaw: number
  recoilT: number // fire kick-back timer
  lastFireFlash: number // detects a fresh shot (fireFlash rising edge)
  dropT: number // placement drop-in timer (counts up; 0 = settled)
  dropDone: boolean
  pulseT: number // upgrade flourish scale-punch timer
  phase: number // per-tower idle sway phase
  turretY0: number // turret rest height (recoil/bob offsets from here)
  baseRange: number
  greyed: boolean // Morose intrusion: frozen mid-gesture under a grey veil
  greyVeil: THREE.Mesh | null // lazily created shroud (shared geo/mat)
  fused: boolean // fusion tower: precessing halo in the absorbed element's colour
  fusionRing: THREE.Mesh | null
}

interface ProjSlot {
  mesh: THREE.Mesh
  mat: THREE.MeshBasicMaterial
  kind: string
  trailAcc: number
  hasPrev: boolean
  prevX: number
  prevZ: number
}

// A deployed hero: the painted-portrait cutout as a billboard token (falls back
// to the element-tinted robed figure while it loads / if keying fails), plus a
// floating element crystal, rarity ground ring, glow light and level badge.
interface HeroSlot {
  group: THREE.Group
  figure: THREE.Group // low-poly fallback; hidden once the painted art lands
  bodyMat: THREE.MeshStandardMaterial
  orb: THREE.Mesh
  orbMat: THREE.MeshStandardMaterial
  ring: THREE.Mesh
  ringMat: THREE.MeshBasicMaterial
  glow: THREE.PointLight
  badge: THREE.Sprite
  badgeTex: THREE.CanvasTexture
  badgeMat: THREE.SpriteMaterial
  art: THREE.Sprite | null // painted billboard token (async)
  artMat: THREE.SpriteMaterial | null
  color: number
  heroId: string
  artTint: number // equipped hero-skin dye (0xffffff = stock)
}

// painted cutout textures, keyed by heroId — shared across battles, never disposed
// (7 small canvases; re-uploaded automatically when a new renderer context starts)
const heroArtTexCache = new Map<string, THREE.CanvasTexture>()
const HERO_ART_H = 1.55 // world-units tall — reads over towers without looming

interface Transient {
  obj: THREE.Object3D
  mat: THREE.Material | THREE.Material[]
  geo?: THREE.BufferGeometry
  t: number
  life: number
  kind: 'ring' | 'flash' | 'beam' | 'spark' | 'pop' | 'crack'
  vx?: number
  vy?: number
  vz?: number
  baseScale?: number
  fade?: boolean
}

const MAX_PARTICLES = 900
const MAX_MOTES = 110 // ambient atmosphere dust

// A cinematic camera pose: look target in sim px + spherical offset.
export interface CinePose {
  x: number
  y: number
  dist: number
  pitch: number // degrees
  yaw: number // degrees
}

// shortest angular distance in degrees (for yaw blending across the seam)
function shortestDeg(a: number, b: number): number {
  let d = (b - a) % 360
  if (d > 180) d -= 360
  if (d < -180) d += 360
  return d
}

// shortest-path angle lerp (keeps facing turns smooth across the ±π seam)
function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return a + d * t
}

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
  // per-element tower materials by role: body (stone/hull), trim (metal), dark
  // (iron/obsidian). The 'core' role uses orbMats — the palette-driven emissive.
  private towerMats = new Map<TowerKind, { body: THREE.MeshStandardMaterial; trim: THREE.MeshStandardMaterial; dark: THREE.MeshStandardMaterial }>()
  private orbMats = new Map<TowerKind, THREE.MeshStandardMaterial>()
  private detailCrystalMat!: THREE.MeshStandardMaterial
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
  private projPools = new Map<string, ProjSlot[]>()
  private activeScratch = new Set<number>()

  // burning-ground zones (Scorch branch): glowing pulsing discs + throttled embers
  private zoneViews = new Map<number, { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; emberAcc: number; phase: number }>()
  private zoneGeo!: THREE.CircleGeometry
  private auraPipGeo!: THREE.OctahedronGeometry
  private fusionRingGeo!: THREE.TorusGeometry

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

  // camera juice: base pose from frameCamera(); render() layers drift/shake/push on it
  private camBasePos = new THREE.Vector3()
  private camLook = new THREE.Vector3(0, -0.2, -0.4)

  // CINEMATIC camera (attract/demo reel): poses blend from→to over dur seconds
  // with gentle breathing on top. Time advances by cineTimeScale × real dt so
  // ?speed= capture stays in sync with the sim-clock-keyed cue timeline.
  private cineActive = false
  private cineFrom: CinePose | null = null
  private cineDest: CinePose | null = null
  private cineT = 0
  private cineDur = 1
  cineTimeScale = 1
  private shakeAmp = 0 // decaying screenshake amplitude (world units)
  private pushAmp = 0 // current push-in strength 0..1
  private pushTarget = 0
  private portalPulse = 0 // portal scale-punch on spawns
  private bloomAmp = 0 // decaying bloom surge (big moments literally glow brighter)
  // accessibility: reduce-motion users keep every FX read, minus the camera violence
  private motionOk = !appSettings.reducedMotion()

  // ambient motes (second small Points cloud for depth/atmosphere)
  private motes!: THREE.Points
  private motePos!: Float32Array
  private moteSeed!: Float32Array

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
    this.scene.background = this.makeSkyTexture()
    this.scene.fog = new THREE.Fog(0x180d33, 22, 40)

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
    this.setupMotes()
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

  // ---------------------------------------------------------------- sky
  // Vertical gradient backdrop: violet glow at the horizon sinking to deep space
  // at the bottom, tinted faintly toward the world's element accent for mood.
  private makeSkyTexture(): THREE.CanvasTexture {
    const cv = document.createElement('canvas')
    cv.width = 2
    cv.height = 512
    const ctx = cv.getContext('2d')!
    const accent = new THREE.Color(this.accent).lerp(new THREE.Color(0x5a3cae), 0.7)
    const grad = ctx.createLinearGradient(0, 0, 0, 512)
    grad.addColorStop(0, '#3b2378')
    grad.addColorStop(0.35, '#' + accent.getHexString())
    grad.addColorStop(0.7, '#1a0f38')
    grad.addColorStop(1, '#0b0620')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, 2, 512)
    const tex = new THREE.CanvasTexture(cv)
    tex.colorSpace = THREE.SRGBColorSpace
    this.disposables.push(tex)
    return tex
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

    // Per-element PBR-ish tower themes. Bodies/trims are hand-picked so each
    // element reads at a glance; the CORE (orbMats) carries the palette colour —
    // towers are pockets of restored colour, so the glow is what pops.
    const THEME: Record<TowerKind, { body: number; bodyRough: number; bodyMetal: number; trim: number; trimRough: number; trimMetal: number; trimGlow: number; dark: number }> = {
      cannon: { body: 0x8a96b4, bodyRough: 0.62, bodyMetal: 0.28, trim: 0xb9c7dd, trimRough: 0.34, trimMetal: 0.85, trimGlow: 0, dark: 0x3a4258 },
      frost: { body: 0xe4f2fb, bodyRough: 0.42, bodyMetal: 0.05, trim: 0x9fdcf5, trimRough: 0.25, trimMetal: 0.1, trimGlow: 0.28, dark: 0x7d97ac },
      flame: { body: 0x54424a, bodyRough: 0.6, bodyMetal: 0.15, trim: 0xc9884a, trimRough: 0.38, trimMetal: 0.8, trimGlow: 0.06, dark: 0x271c20 },
      storm: { body: 0x6b6377, bodyRough: 0.55, bodyMetal: 0.35, trim: 0xd9b25e, trimRough: 0.3, trimMetal: 0.9, trimGlow: 0.05, dark: 0x393344 },
      arcane: { body: 0xd7cdec, bodyRough: 0.5, bodyMetal: 0.08, trim: 0xe2c477, trimRough: 0.32, trimMetal: 0.85, trimGlow: 0.08, dark: 0x5b4c7f },
    }
    for (const kind of Object.keys(TOWERS) as TowerKind[]) {
      // equipped store skin = palette swap; falls back to the stock element color
      const col = towerPalette(kind).color
      const th = THEME[kind]
      const body = new THREE.MeshStandardMaterial({ color: th.body, roughness: th.bodyRough, metalness: th.bodyMetal })
      const trim = new THREE.MeshStandardMaterial({
        color: th.trim, roughness: th.trimRough, metalness: th.trimMetal,
        emissive: th.trimGlow > 0 ? th.trim : 0x000000, emissiveIntensity: th.trimGlow,
      })
      const dark = new THREE.MeshStandardMaterial({ color: th.dark, roughness: 0.5, metalness: 0.45 })
      this.towerMats.set(kind, { body, trim, dark })
      this.disposables.push(body, trim, dark)
      const orb = new THREE.MeshStandardMaterial({
        color: col, emissive: col, emissiveIntensity: 1.5, roughness: 0.3, metalness: 0.1, flatShading: true,
      })
      this.orbMats.set(kind, orb)
      this.disposables.push(orb)
    }

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

  // Slow-drifting ambient dust motes: parametric paths (base + time), so the
  // per-frame cost is one small buffer write and zero allocation.
  private setupMotes(): void {
    const geo = new THREE.BufferGeometry()
    this.motePos = new Float32Array(MAX_MOTES * 3)
    this.moteSeed = new Float32Array(MAX_MOTES * 4) // baseX, baseZ, phase, rise
    const col = new Float32Array(MAX_MOTES * 3)
    const tints = [new THREE.Color(0xc9b0ff), new THREE.Color(0x8fe9ff), new THREE.Color(0xffe2a0), new THREE.Color(this.accent).lerp(new THREE.Color(0xffffff), 0.5)]
    for (let i = 0; i < MAX_MOTES; i++) {
      this.moteSeed[i * 4] = (Math.random() - 0.5) * 15
      this.moteSeed[i * 4 + 1] = (Math.random() - 0.5) * 13
      this.moteSeed[i * 4 + 2] = Math.random() * Math.PI * 2
      this.moteSeed[i * 4 + 3] = 0.12 + Math.random() * 0.25 // rise speed
      const c = tints[i % tints.length]
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b
    }
    geo.setAttribute('position', new THREE.BufferAttribute(this.motePos, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
    this.disposables.push(geo)
    const mat = new THREE.PointsMaterial({ size: 0.09, vertexColors: true, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true })
    this.disposables.push(mat)
    this.motes = new THREE.Points(geo, mat)
    this.motes.frustumCulled = false
    this.scene.add(this.motes)
  }

  private updateMotes(): void {
    const t = this.clockT
    for (let i = 0; i < MAX_MOTES; i++) {
      const bx = this.moteSeed[i * 4]
      const bz = this.moteSeed[i * 4 + 1]
      const ph = this.moteSeed[i * 4 + 2]
      const rise = this.moteSeed[i * 4 + 3]
      this.motePos[i * 3] = bx + Math.sin(t * 0.22 + ph) * 0.6
      this.motePos[i * 3 + 1] = 0.25 + ((t * rise + ph) % 4.4)
      this.motePos[i * 3 + 2] = bz + Math.cos(t * 0.17 + ph * 1.7) * 0.5
    }
    ;(this.motes.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
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
    if (this.cineActive) { this.camera.updateProjectionMatrix(); return } // cine owns the pose
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
    this.camBasePos.set(Math.sin(this.camBaseAngle) * 0.6, camY, camZ + 0.5)
    this.camLook.set(0, targetY, -0.4)
    this.camera.position.copy(this.camBasePos)
    this.camera.lookAt(this.camLook)
    this.camera.updateProjectionMatrix()
  }

  // ------------------------------------------------------- cinematic camera
  /** Enter/leave cinematic mode. Leaving restores the standard framed pose. */
  setCinematic(on: boolean, startPose?: CinePose): void {
    this.cineActive = on
    if (on) {
      const pose = startPose ?? { x: 360, y: 640, dist: 22, pitch: 55, yaw: 0 }
      this.cineFrom = { ...pose }
      this.cineDest = { ...pose }
      this.cineT = 0
      this.cineDur = 0.01
    } else {
      this.cineFrom = this.cineDest = null
      this.frameCamera()
    }
  }

  /** Blend to a new pose over dur seconds (sim-time; scaled by cineTimeScale). */
  cineTo(pose: CinePose, dur: number): void {
    if (!this.cineActive) return
    this.cineFrom = this.evalCine()
    this.cineDest = { ...pose }
    this.cineT = 0
    this.cineDur = Math.max(0.01, dur)
  }

  private evalCine(): CinePose {
    const a = this.cineFrom
    const b = this.cineDest
    if (!a || !b) return { x: 360, y: 640, dist: 22, pitch: 55, yaw: 0 }
    const t = Math.min(1, this.cineT / this.cineDur)
    const k = t * t * (3 - 2 * t) // smoothstep — slow in, slow out
    const yawD = shortestDeg(a.yaw, b.yaw)
    return {
      x: a.x + (b.x - a.x) * k,
      y: a.y + (b.y - a.y) * k,
      dist: a.dist + (b.dist - a.dist) * k,
      pitch: a.pitch + (b.pitch - a.pitch) * k,
      yaw: a.yaw + yawD * k,
    }
  }

  private applyCine(dt: number): void {
    this.cineT += dt * this.cineTimeScale
    const p = this.evalCine()
    // gentle breathing so held shots never feel frozen
    const breathe = 1 + Math.sin(this.clockT * 0.42) * 0.012
    const yaw = (p.yaw + Math.sin(this.clockT * 0.21) * 1.1) * Math.PI / 180
    const pitch = Math.max(8, Math.min(84, p.pitch)) * Math.PI / 180
    const dist = Math.max(4, p.dist * breathe)
    const lx = wx(p.x)
    const lz = wz(p.y)
    const sh = this.shakeAmp
    const jx = sh > 0.001 ? (Math.sin(this.clockT * 91) + Math.sin(this.clockT * 47)) * 0.5 * sh : 0
    const jy = sh > 0.001 ? (Math.sin(this.clockT * 83 + 1.7) + Math.sin(this.clockT * 59)) * 0.5 * sh : 0
    this.camera.position.set(
      lx + Math.sin(yaw) * Math.cos(pitch) * dist + jx,
      Math.sin(pitch) * dist + jy,
      lz + Math.cos(yaw) * Math.cos(pitch) * dist,
    )
    this.camLook.set(lx, -0.1, lz)
    this.camera.lookAt(this.camLook)
  }

  // Screenshake, scaled to impact: amplitudes stack via max (never spiral), decay
  // fast. Reserve ≥0.12 for big moments — small hits should stay readable.
  shake(amp: number): void {
    if (!this.motionOk) return
    this.shakeAmp = Math.min(0.3, Math.max(this.shakeAmp, amp))
  }

  // Subtle dolly toward the board (boss spawns / big spells); eases in then releases.
  pushIn(strength = 1): void {
    if (!this.motionOk) return
    this.pushTarget = Math.min(1, Math.max(this.pushTarget, strength))
  }

  // Bloom surge: big moments (victory bloom, fusion, boss kill, first reaction)
  // push the post-process glow itself, then it settles back. Stacks via max.
  bloomPulse(amp: number): void {
    this.bloomAmp = Math.min(0.9, Math.max(this.bloomAmp, amp))
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

    // Corrupted Keeper: a floating crown-halo marks the boss at any zoom
    let crown: THREE.Mesh | null = null
    let crownMat: THREE.MeshBasicMaterial | null = null
    if (e.kind === 'keeper') {
      const cg = new THREE.TorusGeometry(r * 1.35, 0.07, 8, 28)
      crownMat = new THREE.MeshBasicMaterial({ color: def.accent, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
      crown = new THREE.Mesh(cg, crownMat)
      crown.position.y = r + 0.65
      crown.rotation.x = Math.PI / 2.4
      this.disposables.push(cg, crownMat)
      group.add(crown)
    }

    this.scene.add(group)
    return {
      kind: e.kind, group, body, bodyMat, hpBg, hpFill, hpFillMat, shield, shadow, baseScale: 1, hoverY, spawnT: 0, hitT: 0, radius: r,
      prevX: e.x, prevY: e.y, yaw: 0, walkT: Math.random() * Math.PI * 2, animSpeed: 1, burning: false, emberAcc: 0, isAir: !!def.isAir,
      auraPip: null, auraPipMat: null, crown, crownMat,
    }
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
  // Procedural per-element models (towerModels.ts): each (kind, level, branch)
  // resolves to cached merged geometry per MATERIAL ROLE, plus a list of animated
  // accents. Tier grows mass + ornament; the two L3 branches get distinct crowns.
  private roleMat(kind: TowerKind, role: PartRole): THREE.Material {
    if (role === 'core') return this.orbMats.get(kind)!
    return this.towerMats.get(kind)![role]
  }

  private addAccent(slot: TowerSlot, kind: TowerKind, spec: AccentSpec): void {
    const mat = spec.role === 'core' ? this.orbMats.get(kind)! : this.towerMats.get(kind)!.trim
    const m = new THREE.Mesh(accentGeometry(spec.shape), mat)
    m.rotation.order = 'YXZ' // fixed X/Z tilt + animated Y spin = precession
    m.rotation.x = spec.tiltX ?? 0
    m.rotation.z = spec.tiltZ ?? 0
    const s = spec.scale
    m.scale.set(s, s * (spec.scaleY ?? 1), s)
    const x0 = spec.x ?? 0
    const z0 = spec.z ?? 0
    m.position.set(x0 + (spec.orbit ?? 0), spec.y, z0)
    ;(spec.attach === 'body' ? slot.bodyGroup : slot.turret).add(m)
    slot.accents.push({ obj: m, spec, x0, y0: spec.y, z0, s0: s })
  }

  private assembleTower(slot: TowerSlot, t: SimTower): void {
    slot.bodyGroup.clear()
    slot.turret.clear()
    slot.accents = []
    const kind = t.kind
    const v = towerVisual(kind, t.level, t.branch)
    for (const role of Object.keys(v.body) as PartRole[]) {
      slot.bodyGroup.add(new THREE.Mesh(v.body[role]!, this.roleMat(kind, role)))
    }
    for (const role of Object.keys(v.turret) as PartRole[]) {
      slot.turret.add(new THREE.Mesh(v.turret[role]!, this.roleMat(kind, role)))
    }
    slot.turret.position.y = v.turretY
    slot.turretY0 = v.turretY
    slot.height = v.height
    slot.emitter = v.emitter ?? null
    slot.glow.position.y = v.height * 0.8
    for (const spec of v.accents) this.addAccent(slot, kind, spec)

    slot.level = t.level
    slot.branch = t.branch
  }

  private createTowerSlot(t: SimTower): TowerSlot {
    const def = { ...t.def, ...towerPalette(t.kind) } // skin palette overrides color/accent
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

    const slot: TowerSlot = {
      group: g, bodyGroup, turret, accents: [], emitter: null, emitAcc: 0, height: 1,
      ring, ringMat, glow, level: t.level, branch: t.branch, kind: t.kind, fireT: 0,
      aimYaw: -t.aimAngle, targetYaw: -t.aimAngle, recoilT: 0, lastFireFlash: 0,
      dropT: 0.0001, dropDone: false, pulseT: 0, phase: (t.x * 13.37 + t.y * 7.77) % (Math.PI * 2), turretY0: 0, baseRange: 0,
      greyed: false, greyVeil: null, fused: false, fusionRing: null,
    }
    this.assembleTower(slot, t)
    this.scene.add(g)
    return slot
  }

  // Morose grey veil: a translucent grey shroud (shared geo/mat) that drops
  // over a greyed tower — it reads as "asleep", not destroyed.
  private greyVeilGeo: THREE.SphereGeometry | null = null
  private greyVeilMat: THREE.MeshBasicMaterial | null = null
  private setTowerVeil(s: TowerSlot, on: boolean): void {
    if (on && !s.greyVeil) {
      if (!this.greyVeilGeo || !this.greyVeilMat) {
        this.greyVeilGeo = new THREE.SphereGeometry(0.85, 12, 10)
        this.greyVeilMat = new THREE.MeshBasicMaterial({ color: 0x8b8698, transparent: true, opacity: 0.32, depthWrite: false })
        this.disposables.push(this.greyVeilGeo, this.greyVeilMat)
      }
      const m = new THREE.Mesh(this.greyVeilGeo, this.greyVeilMat)
      s.group.add(m)
      s.greyVeil = m
    }
    if (s.greyVeil) {
      s.greyVeil.visible = on
      if (on) { // size the shroud to the current tier's silhouette
        s.greyVeil.position.y = s.height * 0.52
        s.greyVeil.scale.set(1, Math.max(1.2, s.height * 0.75), 1)
      }
    }
  }

  private rebuildTurret(slot: TowerSlot, t: SimTower): void {
    this.assembleTower(slot, t)
    // upgrade flourish: scale-punch + sparkle fountain + glow spike (via pulseT)
    slot.pulseT = 0.5
    this.emitParticles(wx(t.x), GROUND + 1.1, wz(t.y), towerPalette(t.kind).color, 20, 2.6)
    this.emitParticles(wx(t.x), GROUND + 1.3, wz(t.y), 0xffffff, 8, 2)
  }

  // ---------------------------------------------------------------- projectiles
  // Element-shaped, pooled per kind: fireballs, frost shards, storm bolts, arcane
  // orbs, cannon shells. Trails are throttled emits into the shared particle pool.
  private projGeoCache = new Map<string, THREE.BufferGeometry>()
  private projGeometry(kind: string): THREE.BufferGeometry {
    let g = this.projGeoCache.get(kind)
    if (g) return g
    switch (kind) {
      case 'flame': g = new THREE.SphereGeometry(0.16, 10, 8); break
      case 'frost': g = new THREE.OctahedronGeometry(0.17, 0); break
      case 'storm': g = new THREE.OctahedronGeometry(0.13, 0); break
      case 'arcane': g = new THREE.IcosahedronGeometry(0.16, 0); break
      default: g = new THREE.SphereGeometry(0.14, 10, 8)
    }
    this.projGeoCache.set(kind, g)
    this.disposables.push(g)
    return g
  }

  private static readonly TRAIL_COLOR: Record<string, number> = {
    flame: 0xffa04c, frost: 0xbfeaff, storm: 0xffe97a, arcane: 0xd6a6ff, cannon: 0x9aa0b8,
  }

  private acquireProj(kind: string, color: number): ProjSlot {
    let pool = this.projPools.get(kind)
    if (!pool) { pool = []; this.projPools.set(kind, pool) }
    const s = pool.pop()
    if (s) {
      s.mat.color.set(color)
      s.mesh.visible = true
      s.trailAcc = 0
      s.hasPrev = false
      return s
    }
    const geo = this.projGeometry(kind)
    const mat = new THREE.MeshBasicMaterial({ color, toneMapped: false })
    this.disposables.push(mat)
    const mesh = new THREE.Mesh(geo, mat)
    this.scene.add(mesh)
    return { mesh, mat, kind, trailAcc: 0, hasPrev: false, prevX: 0, prevZ: 0 }
  }

  private releaseProj(id: number): void {
    const s = this.projViews.get(id)
    if (!s) return
    this.projViews.delete(id)
    s.mesh.visible = false
    let pool = this.projPools.get(s.kind)
    if (!pool) { pool = []; this.projPools.set(s.kind, pool) }
    pool.push(s)
  }

  // ---------------------------------------------------------------- sync
  syncFrom(selectedId: number | null): void {
    if (!this.shadowGeo) return
    this.syncEnemies()
    this.syncTowers(selectedId)
    this.syncHeroes()
    this.syncProjectiles()
    this.syncZones()
    if (this.buffDirty) { this.syncBuffLinks(); this.buffDirty = false }
  }

  private syncZones(): void {
    const active = this.activeScratch
    active.clear()
    for (const z of this.sim.zones) {
      if (!z.active) continue
      active.add(z.id)
      let s = this.zoneViews.get(z.id)
      if (!s) {
        const mat = new THREE.MeshBasicMaterial({ color: z.color, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
        const mesh = new THREE.Mesh(this.zoneGeo, mat)
        mesh.rotation.x = -Math.PI / 2
        this.scene.add(mesh)
        s = { mesh, mat, emberAcc: 0, phase: (z.x * 7.3 + z.y * 3.1) % (Math.PI * 2) }
        this.zoneViews.set(z.id, s)
      }
      s.mesh.position.set(wx(z.x), GROUND + 0.025, wz(z.y))
      s.mesh.scale.setScalar(wr(z.radius))
    }
    for (const [id, s] of this.zoneViews) {
      if (!active.has(id)) {
        this.scene.remove(s.mesh)
        s.mat.dispose()
        this.zoneViews.delete(id)
      }
    }
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
        s.hitT = 0
        s.prevX = e.x
        s.prevY = e.y
        s.yaw = 0
        s.burning = false
        s.emberAcc = 0
        this.configureShield(s, e)
        // portal birth: glow ring at the spawn point + a pulse of the portal torus
        this.pushRing(e.x, e.y, e.def.radius + 34, 0x9a5cff, 0.8)
        this.emitParticles(wx(e.x), s.hoverY + 0.2, wz(e.y), 0xb98aff, 6, 1.8)
        this.portalPulse = 1
        if (e.def.boss) { this.pushIn(1); this.shake(0.14) }
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
    // face travel direction: yaw from the position delta this frame (smoothed in render)
    const dx = e.x - s.prevX
    const dy = e.y - s.prevY
    if (dx * dx + dy * dy > 0.01) s.yaw = lerpAngle(s.yaw, Math.atan2(dx, dy), 0.2)
    s.prevX = e.x
    s.prevY = e.y
    if (!s.isAir) s.group.rotation.y = s.yaw

    const stunned = e.stunUntil > clock
    const slowed = e.slowUntil > clock
    const burning = e.burnUntil > clock
    s.animSpeed = stunned ? 0 : slowed ? 0.45 : 1
    s.burning = burning
    // status tint
    if (e.hitFlash > 0) { s.bodyMat.emissive.setHex(0xffffff); s.bodyMat.emissiveIntensity = 0.9 }
    else if (stunned) { s.bodyMat.color.setHex(0xbfeaff); s.bodyMat.emissive.setHex(0x6fc4ff); s.bodyMat.emissiveIntensity = 0.4 }
    else if (slowed) { s.bodyMat.color.setHex(0x8fe9ff); s.bodyMat.emissive.setHex(0x4ad9ff); s.bodyMat.emissiveIntensity = 0.35 }
    else if (burning) { s.bodyMat.color.setHex(0xffb15c); s.bodyMat.emissive.setHex(0xff6a2c); s.bodyMat.emissiveIntensity = 0.5 }
    else { s.bodyMat.color.setHex(e.def.color); s.bodyMat.emissive.setHex(e.def.color); s.bodyMat.emissiveIntensity = 0.28 }

    // hit squash impulse
    if (e.hitFlash > 0 && s.hitT <= 0) s.hitT = 0.14

    // PRIMED aura pip — orbiting crystal in the painted element's colour. One
    // different-element hit will detonate; the pip says so without a tooltip.
    const primed = e.auraElem !== '' && e.auraUntil > clock
    if (primed) {
      if (!s.auraPip) {
        const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
        this.disposables.push(mat)
        const pip = new THREE.Mesh(this.auraPipGeo, mat)
        s.auraPip = pip
        s.auraPipMat = mat
        s.group.add(pip)
      }
      s.auraPip.visible = true
      s.auraPipMat!.color.set(AURA_COLOR[e.auraElem as AuraElement] ?? 0xffffff)
      const a = clock * 3.2 + s.walkT
      const orbit = s.radius + 0.24
      s.auraPip.position.set(Math.cos(a) * orbit, s.radius + 0.5, Math.sin(a) * orbit)
      s.auraPip.rotation.y = clock * 4
    } else if (s.auraPip) {
      s.auraPip.visible = false
    }

    // Keeper crown: retint per Keeper (shared pool), slow precession, phase pulse
    if (s.crown && s.crownMat) {
      s.crownMat.color.setHex(e.def.accent)
      s.crown.rotation.z = clock * 0.9
      const pulse = e.castWarned ? 0.55 + 0.45 * Math.sin(clock * 14) : 0.85
      s.crownMat.opacity = pulse
    }

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
        this.pushRing(t.x, t.y, this.sim.effRange(t), towerPalette(t.kind).color, 0.9)
        this.buffDirty = true
      }
      // aim turret (target only — render() eases toward it for weighty turns)
      s.targetYaw = -t.aimAngle
      // range ring (pulse animated in render while selected)
      s.baseRange = wr(this.sim.effRange(t)) / 0.94
      s.ring.visible = selectedId === t.id
      // fresh shot → recoil kick + light pop (fireFlash rising edge)
      if (t.fireFlash > s.lastFireFlash) s.recoilT = 0.16
      s.lastFireFlash = t.fireFlash
      // Morose intrusion: grey veil drops over the tower, its glow dies; on
      // release the colour pops back with a spark of its element.
      const greyed = this.sim.towerGreyed(t)
      if (greyed !== s.greyed) {
        s.greyed = greyed
        this.setTowerVeil(s, greyed)
        if (greyed) {
          this.pushRing(t.x, t.y, 60, 0x9a94b8, 0.9)
        } else {
          const pc = towerPalette(t.kind).color
          this.pushRing(t.x, t.y, 70, pc, 0.9)
          this.emitParticles(wx(t.x), GROUND + 1.0, wz(t.y), pc, 14, 2.2)
        }
      }
      s.glow.intensity = greyed ? 0.05 : 0.5 + (t.fireFlash > 0 ? 1.6 : 0) + s.pulseT * 3

      // FUSION halo: a precessing ring in the absorbed element's colour, plus a
      // one-time forge celebration the moment the fusion lands.
      const fused = t.fusedElem !== ''
      if (fused !== s.fused) {
        s.fused = fused
        if (fused) {
          if (!s.fusionRing) {
            const mat = new THREE.MeshBasicMaterial({ color: t.fusedColor, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
            this.disposables.push(mat)
            s.fusionRing = new THREE.Mesh(this.fusionRingGeo, mat)
            s.fusionRing.rotation.order = 'YXZ'
            s.group.add(s.fusionRing)
          }
          ;(s.fusionRing.material as THREE.MeshBasicMaterial).color.set(t.fusedColor)
          s.fusionRing.visible = true
          s.pulseT = 1
          this.pushRing(t.x, t.y, 90, t.fusedColor, 1)
          this.emitParticles(wx(t.x), GROUND + s.turretY0 + 0.6, wz(t.y), t.fusedColor, 22, 2.8)
          this.pushIn(0.6)
        } else if (s.fusionRing) {
          s.fusionRing.visible = false
        }
      }
      if (s.fused && s.fusionRing) {
        const ck = this.sim.clock
        s.fusionRing.position.y = s.turretY0 + 0.42 + Math.sin(ck * 1.7 + s.phase) * 0.06
        s.fusionRing.rotation.y = ck * 2.1 + s.phase
        s.fusionRing.rotation.x = Math.PI / 2 + 0.42
      }
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
    const slot: HeroSlot = {
      group: g, figure, bodyMat, orb, orbMat, ring, ringMat, glow,
      badge: badge.sprite, badgeTex: badge.tex, badgeMat: badge.mat,
      art: null, artMat: null, color: def.color, heroId: h.heroId,
      artTint: heroDye(h.heroId)?.tint ?? 0xffffff, // equipped hero-skin dye
    }

    // swap the low-poly figure for the painted billboard token once the cached
    // background-keyed cutout is ready (first battle pays one decode; after
    // that it resolves instantly). Keying failure → keep the figure.
    heroCutout(h.heroId).then((cut) => {
      if (!cut || this.disposed || this.heroViews.get(h.id) !== slot) return
      let tex = heroArtTexCache.get(h.heroId)
      if (!tex) {
        tex = new THREE.CanvasTexture(cut.canvas)
        tex.colorSpace = THREE.SRGBColorSpace
        tex.anisotropy = 4
        heroArtTexCache.set(h.heroId, tex)
      }
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, alphaTest: 0.05, depthWrite: false })
      const sprite = new THREE.Sprite(mat)
      sprite.scale.set(HERO_ART_H * cut.aspect, HERO_ART_H, 1)
      sprite.position.y = HERO_ART_H / 2 + 0.05
      sprite.userData.y0 = sprite.position.y
      g.add(sprite)
      figure.visible = false
      slot.badge.position.y = HERO_ART_H + 0.32 // clear the taller token
      slot.art = sprite
      slot.artMat = mat
    })
    return slot
  }

  private updateHeroSlot(s: HeroSlot, h: SimHero): void {
    s.group.position.set(wx(h.x), GROUND, wz(h.y))
    s.figure.rotation.y = -h.aimAngle + Math.PI / 2
    // Moth Mirror: a borrowed hero drains to grey — colour and glow gutter out
    const greyed = this.sim.heroGreyed(h)
    if (greyed) {
      s.bodyMat.color.setHex(0x8f8a9e)
      s.bodyMat.emissive.setHex(0x55516226)
      s.bodyMat.emissiveIntensity = 0.12
      s.orbMat.emissiveIntensity = 0.2
      s.glow.intensity = 0.08
      if (s.artMat) s.artMat.color.setHex(0x777486) // painted token drains to grey
      return
    }
    if (s.artMat) s.artMat.color.setHex(s.artTint)
    s.bodyMat.color.setHex(s.color)
    s.bodyMat.emissive.setHex(s.color)
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
    s.artMat?.dispose() // material only — the cutout texture is cached for reuse
  }

  private syncProjectiles(): void {
    const active = this.activeScratch
    active.clear()
    for (const p of this.sim.projectiles) {
      if (!p.active) continue
      active.add(p.id)
      let s = this.projViews.get(p.id)
      if (!s || s.kind !== p.sourceKind) {
        if (s) this.releaseProj(p.id)
        // skinned towers recolor their shots too (sim color is only a default)
        const pal = towerPalette(p.sourceKind)
        s = this.acquireProj(p.sourceKind, pal.skinned ? pal.color : p.color)
        this.projViews.set(p.id, s)
      }
      const x = wx(p.x)
      const z = wz(p.y)
      // face travel + spin (shards/orbs tumble; the yaw keeps stretch believable)
      if (s.hasPrev) {
        const dx = x - s.prevX
        const dz = z - s.prevZ
        if (dx * dx + dz * dz > 1e-6) s.mesh.rotation.y = Math.atan2(dx, dz)
      }
      s.mesh.rotation.x += 0.3
      s.prevX = x
      s.prevZ = z
      s.hasPrev = true
      s.mesh.position.set(x, 0.85, z)
    }
    for (const [id] of this.projViews) {
      if (!active.has(id)) this.releaseProj(id)
    }
  }

  // called from render() with real dt: throttled ember/mist/rune trails
  private updateProjTrails(dt: number): void {
    for (const [, s] of this.projViews) {
      s.trailAcc += dt
      if (s.trailAcc > 0.055) {
        s.trailAcc = 0
        const c = BattleView3D.TRAIL_COLOR[s.kind] ?? 0xffffff
        this.emitParticles(s.mesh.position.x, s.mesh.position.y, s.mesh.position.z, c, 1, 0.55)
      }
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

  fxDeath(simX: number, simY: number, color: number, boss: boolean, kind?: EnemyKind): void {
    this.emitParticles(wx(simX), 0.7, wz(simY), color, boss ? 40 : 14, boss ? 4 : 3)
    this.emitParticles(wx(simX), 0.7, wz(simY), 0xffffff, boss ? 14 : 4, boss ? 3 : 2.2)
    // white flash sphere
    const geo = new THREE.SphereGeometry(0.3, 10, 8)
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(wx(simX), 0.7, wz(simY))
    this.scene.add(mesh)
    this.transients.push({ obj: mesh, mat, geo, t: 0, life: 0.3, kind: 'flash', baseScale: boss ? 3.5 : 1.8, fade: true })
    // dissolving body ghost: pops up + inflates + fades — the "kill" read
    const bodyGeo = kind ? this.enemyGeo.get(kind) : undefined
    if (bodyGeo) {
      const gm = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false })
      const ghost = new THREE.Mesh(bodyGeo, gm) // shares pooled geometry — never disposed here
      ghost.position.set(wx(simX), 0.55, wz(simY))
      this.scene.add(ghost)
      this.transients.push({ obj: ghost, mat: gm, t: 0, life: boss ? 0.5 : 0.34, kind: 'pop', baseScale: boss ? 2 : 1.45, fade: true, vy: boss ? 2.4 : 1.8 })
    }
    // ground shockwave on every kill; camera speaks only for bosses
    this.pushRing(simX, simY, boss ? 120 : 55, color, boss ? 0.9 : 0.5)
    if (boss) { this.shake(0.18); this.pushIn(0.8) }
    else this.shake(0.035)
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

  // Jagged glowing lightning: each hop is subdivided with perpendicular jitter,
  // drawn twice (bright white core + coloured aura) so bloom reads it as a bolt.
  fxChain(points: Array<[number, number]>, color: number, supercharged: boolean): void {
    if (points.length < 2) return
    const pts: THREE.Vector3[] = []
    for (let i = 0; i < points.length - 1; i++) {
      const ax = wx(points[i][0]), az = wz(points[i][1])
      const bx = wx(points[i + 1][0]), bz = wz(points[i + 1][1])
      const dx = bx - ax, dz = bz - az
      const len = Math.max(0.001, Math.hypot(dx, dz))
      const px = -dz / len, pz = dx / len // perpendicular
      const segs = Math.min(6, Math.max(3, Math.round(len * 3)))
      for (let sg = 0; sg <= segs; sg++) {
        const k = sg / segs
        const amp = (sg === 0 || sg === segs) ? 0 : (Math.random() - 0.5) * 0.3
        pts.push(new THREE.Vector3(ax + dx * k + px * amp, 0.8 + (Math.random() - 0.5) * 0.12, az + dz * k + pz * amp))
      }
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts)
    const core = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false })
    const aura = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false })
    const coreLine = new THREE.Line(geo, core)
    const auraLine = new THREE.Line(geo, aura)
    auraLine.position.y = 0.03
    this.scene.add(coreLine, auraLine)
    // same life so the shared geometry is disposed only after BOTH lines retire
    this.transients.push({ obj: auraLine, mat: aura, t: 0, life: 0.26, kind: 'beam', fade: true })
    this.transients.push({ obj: coreLine, mat: core, geo, t: 0, life: 0.26, kind: 'beam', fade: true })
    for (const p of points) this.emitParticles(wx(p[0]), 0.8, wz(p[1]), color, 3, 2)
    if (supercharged) this.fxShatter(points[0][0], points[0][1], color)
  }

  // SIGNATURE Frost→Storm combo: ice cracks radiating on the ground + a cold
  // flash + lightning burst + camera bite. Loud on purpose — it's the money shot.
  private fxShatter(simX: number, simY: number, color: number): void {
    const x = wx(simX)
    const z = wz(simY)
    // radiating jagged ground cracks
    const pts: THREE.Vector3[] = []
    const arms = 7
    for (let a = 0; a < arms; a++) {
      const th = (a / arms) * Math.PI * 2 + Math.random() * 0.5
      let px = x, pz = z
      let dirX = Math.cos(th), dirZ = Math.sin(th)
      const segs = 3
      for (let sg = 0; sg < segs; sg++) {
        const stepLen = 0.28 + Math.random() * 0.3
        const nx = px + dirX * stepLen
        const nz = pz + dirZ * stepLen
        pts.push(new THREE.Vector3(px, GROUND + 0.03, pz), new THREE.Vector3(nx, GROUND + 0.03, nz))
        px = nx; pz = nz
        const bend = (Math.random() - 0.5) * 0.9
        const c = Math.cos(bend), s = Math.sin(bend)
        const ndx = dirX * c - dirZ * s
        dirZ = dirX * s + dirZ * c
        dirX = ndx
      }
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts)
    const mat = new THREE.LineBasicMaterial({ color: 0xcdf3ff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false })
    const cracks = new THREE.LineSegments(geo, mat)
    this.scene.add(cracks)
    this.transients.push({ obj: cracks, mat, geo, t: 0, life: 0.55, kind: 'crack', fade: true })

    this.pushRing(simX, simY, 130, 0x9fdcff, 0.95)
    this.spellFlash(simX, simY, 100, 0xd6f4ff, 1.9)
    this.emitParticles(x, 0.7, z, 0x9fdcff, 26, 4)
    this.emitParticles(x, 0.7, z, 0xffffff, 12, 3)
    this.emitParticles(x, 0.7, z, color, 14, 4.5)
    this.shake(0.12)
    this.pushIn(0.6)
  }

  fxPlace(simX: number, simY: number, color: number, radiusPx: number): void {
    this.pushRing(simX, simY, radiusPx, color, 0.9)
    this.emitParticles(wx(simX), 0.7, wz(simY), color, 16, 3)
  }

  // ELEMENTAL REACTION detonation: two-tone burst + shock ring + flash + camera bite.
  fxReaction(simX: number, simY: number, radiusPx: number, color: number, color2: number): void {
    const r = Math.max(60, radiusPx || 70)
    this.pushRing(simX, simY, r + 30, color, 0.95)
    this.spellFlash(simX, simY, r, color2, 1.6)
    const x = wx(simX)
    const z = wz(simY)
    this.emitParticles(x, 0.8, z, color, 22, 4.2)
    this.emitParticles(x, 0.8, z, color2, 14, 3.4)
    this.emitParticles(x, 0.9, z, 0xffffff, 8, 2.6)
    this.shake(0.085)
    this.pushIn(0.35)
  }

  fxSpell(key: string, simX: number, simY: number, radiusPx: number, color: number): void {
    color = spellColor(key, color) // equipped VFX recolor (paint only)
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
      this.shake(0.2)
      this.pushIn(1)
    } else if (key === 'freeze') {
      for (const [, s] of this.enemyViews) this.emitParticles(s.group.position.x, s.group.position.y, s.group.position.z, 0x9fdcff, 4, 1.5)
      this.shake(0.07)
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
    this.shake(effect === 'aoeBurn' || effect === 'execute' ? 0.13 : 0.07)
    this.pushIn(0.7)
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
      } else if (tr.kind === 'pop') {
        // death ghost: quick inflate + rise, then the generic fade dissolves it
        const e = 1 - (1 - k) * (1 - k)
        tr.obj.scale.setScalar((tr.baseScale ?? 1.4) * (0.9 + e * 0.9))
        tr.obj.position.y += (tr.vy ?? 1.8) * (1 - k) * dt
        tr.obj.rotation.y += dt * 3
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

    // camera: idle drift + push-in on big moments + decaying screenshake
    this.pushAmp += (this.pushTarget - this.pushAmp) * Math.min(1, dt * 6)
    this.pushTarget = Math.max(0, this.pushTarget - dt * 1.1) // release
    this.shakeAmp = Math.max(0, this.shakeAmp - dt * 1.4)
    if (this.cineActive) {
      this.applyCine(dt) // attract reel: authored poses own the camera
    } else {
      this.camBaseAngle = Math.sin(this.clockT * 0.12) * 0.12
      const sh = this.shakeAmp
      const jx = sh > 0.001 ? (Math.sin(this.clockT * 91) + Math.sin(this.clockT * 47)) * 0.5 * sh : 0
      const jy = sh > 0.001 ? (Math.sin(this.clockT * 83 + 1.7) + Math.sin(this.clockT * 59)) * 0.5 * sh : 0
      this.tmpV.copy(this.camLook).sub(this.camBasePos).normalize().multiplyScalar(this.pushAmp * 1.4)
      this.camera.position.set(
        this.camBasePos.x + Math.sin(this.camBaseAngle) * 0.9 + this.tmpV.x + jx,
        this.camBasePos.y + Math.sin(this.clockT * 0.31) * 0.12 + this.tmpV.y + jy,
        this.camBasePos.z + this.tmpV.z,
      )
      this.camera.lookAt(this.camLook)
    }

    // enemies: spawn pop, walk bob (squash & stretch), hit knockback, status anim
    for (const [, s] of this.enemyViews) {
      // spawn squash
      if (s.spawnT > 0) {
        s.spawnT += dt
        const p = Math.min(1, s.spawnT / 0.25)
        const sc = p < 1 ? 0.3 + 0.7 * this.easeBack(p) : 1
        s.group.scale.setScalar(sc)
        if (p >= 1) s.spawnT = 0
      }
      // procedural walk: bob hops + counter-phased squash/stretch; freezes when
      // stunned/frozen (animSpeed 0) and drags when slowed — status you can SEE.
      s.walkT += dt * 10 * s.animSpeed
      const hop = Math.abs(Math.sin(s.walkT))
      const stretch = 1 + Math.sin(s.walkT * 2) * 0.06 * s.animSpeed
      let sqX = 1 / Math.sqrt(stretch)
      let sqY = stretch
      if (s.hitT > 0) {
        s.hitT -= dt
        const k = Math.max(0, s.hitT / 0.14)
        sqX *= 1 + k * 0.3
        sqY *= 1 - k * 0.22
        s.body.position.z = -k * 0.09 // knockback nudge, opposite travel
      } else {
        s.body.position.z = 0
      }
      s.body.scale.set(sqX, sqY, sqX)
      s.body.position.y = s.isAir ? Math.sin(this.clockT * 3 + s.walkT) * 0.08 : hop * 0.07 * s.animSpeed
      if (s.isAir) s.body.rotation.y += dt * 1.4
      // burning → embers (throttled per enemy so swarms stay cheap)
      if (s.burning) {
        s.emberAcc += dt
        if (s.emberAcc > 0.13) {
          s.emberAcc = 0
          this.emitParticles(s.group.position.x, s.group.position.y + 0.25, s.group.position.z, 0xff8a3c, 1, 1.1)
        }
      }
      // billboard the hp bar toward camera in WORLD space (group may be yawed)
      this.tmpQ.copy(s.group.quaternion).invert().multiply(this.camera.quaternion)
      s.hpBg.quaternion.copy(this.tmpQ)
      s.hpFill.quaternion.copy(this.tmpQ)
    }
    // billboard particles handled by Points automatically

    // portal spin + spawn pulse; base bob (cached refs — no per-frame graph walk)
    this.portalMesh.rotation.z += dt * 1.2
    this.portalPulse = Math.max(0, this.portalPulse - dt * 3.5)
    this.portalMesh.scale.setScalar(1 + this.portalPulse * 0.35)
    this.baseMesh.rotation.y += dt * 0.8
    this.baseMesh.position.y = GROUND + 0.55 + Math.sin(this.clockT * 2) * 0.06

    // hover pulse
    if (this.hoverMesh.visible) this.hoverMesh.scale.setScalar(1 + Math.sin(this.clockT * 6) * 0.06)

    // towers: drop-in, eased aiming, fire recoil, idle sway, upgrade pulse, orbs
    for (const [, s] of this.towerViews) {
      // placement drop-in: fall from above, land with a pop + dust puff
      if (!s.dropDone) {
        s.dropT += dt
        const p = Math.min(1, s.dropT / 0.32)
        s.group.position.y = GROUND + (1 - p * p) * 2.4
        if (p >= 1) {
          s.dropDone = true
          s.group.position.y = GROUND
          s.pulseT = Math.max(s.pulseT, 0.35)
          this.emitParticles(s.group.position.x, GROUND + 0.15, s.group.position.z, 0xcbb9a0, 10, 1.6)
          this.shake(0.05)
        }
      }
      // smooth turret aim
      s.aimYaw = lerpAngle(s.aimYaw, s.targetYaw, Math.min(1, dt * 11))
      s.turret.rotation.y = s.aimYaw
      // recoil: quick kick opposite the aim + a snap back
      if (s.recoilT > 0) {
        s.recoilT -= dt
        const k = Math.sin(Math.max(0, s.recoilT / 0.16) * Math.PI) * 0.085
        s.turret.position.x = -Math.cos(s.aimYaw) * k
        s.turret.position.z = Math.sin(s.aimYaw) * k
        s.turret.position.y = s.turretY0 + k * 0.35
      } else {
        s.turret.position.x = 0
        s.turret.position.z = 0
        // greyed towers freeze mid-gesture — no idle hum under the veil
        s.turret.position.y = s.turretY0 + (s.greyed ? 0 : Math.sin(this.clockT * 1.8 + s.phase) * 0.015)
      }
      // upgrade flourish scale-punch (decays)
      if (s.pulseT > 0) {
        s.pulseT = Math.max(0, s.pulseT - dt)
        const k = s.pulseT / 0.5
        s.group.scale.setScalar(1 + Math.sin(k * Math.PI) * 0.14)
      } else {
        s.group.scale.setScalar(1)
      }
      // selected range ring: breathe
      if (s.ring.visible) {
        s.ring.scale.setScalar(s.baseRange * (1 + Math.sin(this.clockT * 4) * 0.015))
        s.ringMat.opacity = 0.62 + Math.sin(this.clockT * 4) * 0.22
      }
      // idle LIFE: floating rings, orbiting runestones, flickering flame cores.
      // Frozen (but visible) when greyed or under reduce-motion — glow still reads.
      if (!s.greyed && this.motionOk) {
        const tt = this.clockT
        for (const a of s.accents) {
          const sp = a.spec
          const ph = (sp.phase ?? 0) + s.phase
          if (sp.orbit) {
            const ang = tt * (sp.spin ?? 1) + ph
            a.obj.position.x = a.x0 + Math.cos(ang) * sp.orbit
            a.obj.position.z = a.z0 + Math.sin(ang) * sp.orbit
          } else if (sp.spin) {
            a.obj.rotation.y = tt * sp.spin + ph
          }
          if (sp.bobAmp) a.obj.position.y = a.y0 + Math.sin(tt * (sp.bobSpeed ?? 2.2) + ph) * sp.bobAmp
          if (sp.flicker) {
            // two off-beat sines ≈ organic shimmer; slight inverse-Y squash-stretch
            const f = 1 + (Math.sin(tt * 11 + ph) * 0.6 + Math.sin(tt * 17.3 + ph * 2) * 0.4) * sp.flicker
            a.obj.scale.set(a.s0 * f, a.s0 * (sp.scaleY ?? 1) * (1 + (1 - f) * 0.7), a.s0 * f)
          }
        }
        // idle element breath: frost mist / flame embers / storm sparks / arcane motes
        if (s.emitter) {
          s.emitAcc += dt
          const period = 1 / s.emitter.rate
          if (s.emitAcc >= period) {
            s.emitAcc %= period
            const e = s.emitter
            const col = e.type === 'mist' ? 0xcfeeff : e.type === 'embers' ? 0xff8a3c : e.type === 'sparks' ? 0xffe97a : 0xd6a6ff
            this.emitParticles(
              s.group.position.x + (Math.random() - 0.5) * 0.34, GROUND + e.y,
              s.group.position.z + (Math.random() - 0.5) * 0.34,
              col, 1, e.type === 'sparks' ? 1.5 : 0.45,
            )
          }
        }
      }
    }

    // hero: bob + spin the element crystal, idle sway, breathing aura ring
    for (const [, s] of this.heroViews) {
      const y0 = s.orb.userData.y0 as number
      s.orb.position.y = y0 + Math.sin(this.clockT * 2.6) * 0.06
      s.orb.rotation.y += dt * 2.2
      s.orb.rotation.x += dt * 1.1
      s.figure.position.y = Math.abs(Math.sin(this.clockT * 2 + s.group.position.x)) * 0.05
      if (s.art) s.art.position.y = (s.art.userData.y0 as number) + Math.abs(Math.sin(this.clockT * 2 + s.group.position.x)) * 0.05
      s.ring.rotation.z += dt * 0.7
      s.ringMat.opacity = 0.72 + Math.sin(this.clockT * 3 + s.group.position.z) * 0.22
      s.glow.intensity = Math.max(s.glow.intensity, 0.9 + Math.sin(this.clockT * 2.4) * 0.18)
    }

    // burning ground: pulse the disc + throttled rising embers
    for (const [, s] of this.zoneViews) {
      s.mat.opacity = 0.24 + Math.sin(this.clockT * 5 + s.phase) * 0.09
      s.emberAcc += dt
      if (s.emberAcc > 0.1) {
        s.emberAcc = 0
        const a = Math.random() * Math.PI * 2
        const rr = Math.random() * s.mesh.scale.x * 0.8
        this.emitParticles(s.mesh.position.x + Math.cos(a) * rr, GROUND + 0.15, s.mesh.position.z + Math.sin(a) * rr, 0xff8a3c, 1, 0.9)
      }
    }

    this.updateProjTrails(dt)
    this.updateParticles(dt)
    this.updateMotes()
    this.updateTransients(dt)

    // bloom surge decay (0.62 = the calibrated base set in the constructor)
    if (this.bloomAmp > 0) {
      this.bloomAmp = Math.max(0, this.bloomAmp - dt * 0.55)
      this.bloom.strength = 0.62 + this.bloomAmp
    }

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
    this.zoneGeo = new THREE.CircleGeometry(1, 26)
    this.disposables.push(this.zoneGeo)
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
    // primed-aura pip (enemies) + fusion halo (towers)
    this.auraPipGeo = new THREE.OctahedronGeometry(0.11, 0)
    this.fusionRingGeo = new THREE.TorusGeometry(0.44, 0.045, 8, 26)
    this.disposables.push(this.auraPipGeo, this.fusionRingGeo)
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
    this.projPools.clear()
    this.projGeoCache.clear()

    // burning-ground zones own per-zone materials (shared geo is in disposables)
    for (const [, s] of this.zoneViews) { this.scene.remove(s.mesh); s.mat.dispose() }
    this.zoneViews.clear()

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
