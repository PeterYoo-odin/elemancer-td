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
import type { RealmBackdrop } from '../game/realmBackdrops'
import { RealmAtmosphere } from './RealmAtmosphere'
import { BoardLife } from './BoardLife'
import { TERRAIN_META } from '../game/paths'
import { models } from './models'
import { towerVisual, accentGeometry, type AccentSpec, type PartRole, type TowerVisual } from './towerModels'
import { appSettings } from '../ui/settings'
import { heroCutout } from '../ui/heroArt'
import { wyrmCutout } from '../ui/wyrmArt'
import { enemyArt, enemyArtReady } from '../ui/enemyArt'

const TILE_PX = 80
const CX = MAP_X + MAP_W / 2 // 360
const CY = MAP_Y + MAP_H / 2 // 640

// The Kenney tiles are 1×1 with their top surface at y=0.2 — a near-flat board, so
// a single pick plane at this height is WYSIWYG everywhere (no per-cell-height hack).
const GROUND = 0.2

// Terrain sculpt tuning: subdivisions per tile edge (smooth relief on a tiny 9×11
// board is cheap) and how many extra tile-rings of cliff skirt fall away beyond the
// board into the fog/haze.
const TSUB = 3
const TSKIRT = 3
// Ground/path texture tiling: repeats per BOARD TILE (not per quad) — high enough
// that several painted slabs read across one tile rather than one giant stretched
// copy, computed from a continuous tile-space UV so there are no seams anywhere
// on the merged mesh regardless of this value.
const GROUND_TEX_REPEAT = 2
// Empirical: the scene's stacked lighting reads a flat-vertex-coloured surface
// noticeably brighter than its input albedo — this compensates so the sculpted
// terrain's ON-SCREEN mid-luma matches the per-realm design target, not a washed
// grey/white regardless of hue.
const TERRAIN_LIGHT_COMP = 0.55

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
  phase: number // per-member desync (swarm skitter / body sway) so clusters crawl
  animSpeed: number // 1 normal · <1 slowed · 0 stunned/frozen
  burning: boolean
  emberAcc: number // throttles burning-ember emission
  streakAcc: number // throttles the runner's speed-streak wisps
  isAir: boolean
  // PRIMED aura pip — a small orbiting crystal in the painted element's colour,
  // so "one more different-element hit detonates" is readable at a glance.
  auraPip: THREE.Mesh | null
  auraPipMat: THREE.MeshBasicMaterial | null
  // Corrupted Keeper crown — a slow-precessing halo ring in the Keeper's realm
  // colour ('keeper' kind only; retinted per Keeper since the pool is shared)
  crown: THREE.Mesh | null
  crownMat: THREE.MeshBasicMaterial | null
  // Painted "greyling" billboard token (async) — REPLACES the primitive body mesh
  // once the hand-painted PNG lands; the mesh stays as the load/miss fallback.
  art: THREE.Sprite | null
  artMat: THREE.SpriteMaterial | null
  artH: number // billboard height in world units (drives the squash/bob math)
  accentGlow: THREE.Sprite | null // additive signature-accent halo (skipped for swarm)
  accentGlowMat: THREE.SpriteMaterial | null
  accent: number // signature Greying accent colour
  boss: boolean // keeper / Titan → set-piece scale + extra spectacle
  castWarned: boolean // keeper telegraph active → flare the accent glow as a tell
  prevShield: number // Titan mid-fight phase: the frame its shield shatters is a beat
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
  glowBase: number // idle glow intensity — ramps per tier so upgrades read brighter
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
  // bonded Chromatic Wyrm — a painted billboard that circles the hero (async)
  wyrm: THREE.Sprite | null
  wyrmMat: THREE.SpriteMaterial | null
  wyrmPhase: number // per-hero orbit phase so companions don't fly in lockstep
  // --- LIVE PRESENCE: the billboard is no longer a sticker ---
  phase: number // per-hero idle phase so the roster doesn't breathe in lockstep
  artBaseW: number // stock sprite width (world units) — squash/stretch multiplies it
  castUntil: number // clockT until which the CAST pose (spell/signature) plays
  hurtUntil: number // clockT until which the HURT recoil plays
  awakenUntil: number // clockT until which the level-3 AWAKENING flourish plays
  // BASIC ATTACK: a directional thrust/lunge toward the target on each auto-attack,
  // fired off the sim's fireFlash rising edge (view-only), then a recoil/settle.
  atkUntil: number // clockT until which the basic-attack lunge plays
  atkDx: number // world-space lunge direction toward the target (X)
  atkDz: number // world-space lunge direction toward the target (Z)
  prevFire: number // last-seen h.fireFlash, to detect a fresh shot
}

// painted cutout textures, keyed by heroId — shared across battles, never disposed
// (7 small canvases; re-uploaded automatically when a new renderer context starts)
const heroArtTexCache = new Map<string, THREE.CanvasTexture>()
// painted Wyrm cutout textures, keyed by wyrmId (6 canvases; shared like heroes)
const wyrmArtTexCache = new Map<string, THREE.CanvasTexture>()
const WYRM_ART_H = 1.15 // world-units tall — the companion reads smaller than its hero
const HERO_ART_H = 1.55 // world-units tall — reads over towers without looming
// hero billboard pose-envelope lengths (seconds) — short so the board stays lively
const CAST_DUR = 0.5
const HURT_DUR = 0.45
const AWAKEN_DUR = 1.1
const HERO_ATK_DUR = 0.3 // basic-attack thrust window (short — snaps out and settles)
const _sigCol = new THREE.Color() // scratch: hero signature-colour cast flash (no per-frame alloc)
const _orbCol = new THREE.Color() // scratch: tower core idle colour-breath (no per-frame alloc)
const _reactA = new THREE.Color() // scratch: reaction particle-ramp blend
const _reactB = new THREE.Color()

// Tower element-core (orb) idle glow: base emissive + how hard the idle breath
// swells it. Kept modest so the bloom pass never blows the towers out (legibility).
const ORB_EMISSIVE_BASE = 1.85
const ORB_EMISSIVE_SWELL = 0.4
const WHITE_COL = new THREE.Color(0xffffff)
// per-kind phase offset so the element cores breathe out of sync
const KIND_PHASE: Record<TowerKind, number> = {
  cannon: 0, frost: 1.3, flame: 2.6, storm: 3.9, arcane: 5.2, bloom: 0.7, radiant: 2.0, shade: 4.5,
}

// -------------------------------------------------------------------------
// PER-ARCHETYPE LOCOMOTION — the fix for the "escalator" (sprites that slide
// with no internal motion). Each painted billboard runs a procedural walk cycle
// combining: a foot-plant vertical BOB, a step SQUASH-&-STRETCH (stomp on
// plant), a rhythmic forward LEAN, a slow body SWAY, and per-type extras
// (flyer WING-FLAP, swarm skitter JITTER). All VIEW-ONLY, driven off the fixed
// sim clock; reduce-motion collapses every profile to a minimal bob. The cycle
// RATE scales with the unit's move state via animSpeed (slow→drag, frozen→halt),
// so status stays readable. `cyc` is baked per archetype so faster kinds stride
// faster than heavy ones — a runner bounces, a brute trudges.
// (Clean seam for a later pass: swap the sq/bob/lean drive for AI-posed frames.)
interface LocoProfile {
  cyc: number // stride phase advance (rad/s at animSpeed 1) — sets tempo
  bob: number // vertical foot-plant hop amplitude, as a FRACTION of sprite height
  sq: number // squash-&-stretch amplitude (stomp depth on plant, scale factor)
  lean: number // rhythmic forward/back rock (radians of sprite tilt)
  sway: number // slow weight-shift body sway (radians)
  shift: number // horizontal weight-shift waddle (fraction of sprite height)
  wing: number // flyer wing-flap horizontal scale pulse (0 = grounded)
  jitter: number // swarm skitter horizontal displacement (fraction of sprite height)
}
// AMPLITUDES ARE FRACTIONS OF SPRITE HEIGHT (bob/shift/jitter) so the motion reads
// at the SAME screen-pixel size on a tiny runner and a towering boss — the tuning
// pass that killed the "escalator" glide. Biased strong on purpose: the observed
// failure was "too subtle", and overshoot is recoverable where a glide is not.
const LOCO: Record<EnemyKind, LocoProfile> = {
  // bouncy sprinter — big air time, hard forward lean, quick tempo
  runner: { cyc: 22, bob: 0.26, sq: 0.22, lean: 0.16, sway: 0.03, shift: 0.10, wing: 0, jitter: 0 },
  // steady infantry trudge — clear step bounce + waddle
  grunt: { cyc: 13, bob: 0.18, sq: 0.16, lean: 0.09, sway: 0.04, shift: 0.08, wing: 0, jitter: 0 },
  // heavy slow trudge + DEEP stomp squash and a big side-to-side lumber
  brute: { cyc: 7.5, bob: 0.11, sq: 0.30, lean: 0.05, sway: 0.06, shift: 0.11, wing: 0, jitter: 0 },
  // NO ground contact: hover sine + pronounced wing-flap oscillation
  flyer: { cyc: 13, bob: 0.16, sq: 0.05, lean: 0.05, sway: 0.035, shift: 0, wing: 0.22, jitter: 0 },
  // braced shuffle — short choppy steps, minimal sway
  shielded: { cyc: 10, bob: 0.11, sq: 0.15, lean: 0.05, sway: 0.02, shift: 0.06, wing: 0, jitter: 0 },
  // smooth FLOAT (no foot-plant stomp) + wide robe sway
  healer: { cyc: 10.5, bob: 0.13, sq: 0.05, lean: 0.03, sway: 0.10, shift: 0.03, wing: 0, jitter: 0 },
  // rapid skitter with per-member phase so the cluster crawls (not marches)
  swarm: { cyc: 30, bob: 0.17, sq: 0.18, lean: 0.07, sway: 0.05, shift: 0.05, wing: 0, jitter: 0.06 },
  // braced heavy plate — a slower, stiffer cousin of shielded's shuffle
  armored: { cyc: 9, bob: 0.12, sq: 0.20, lean: 0.05, sway: 0.03, shift: 0.07, wing: 0, jitter: 0 },
  // confident veteran advance — deep stomp, proud lean, not yet boss-ponderous
  elite: { cyc: 8, bob: 0.12, sq: 0.24, lean: 0.06, sway: 0.045, shift: 0.09, wing: 0, jitter: 0 },
  // set-piece finale: ponderous, ground-shaking stomp + heavy lumber
  boss: { cyc: 6, bob: 0.10, sq: 0.26, lean: 0.04, sway: 0.05, shift: 0.12, wing: 0, jitter: 0 },
  // Corrupted Keeper — a slow, imperious advance with a deep stomp
  keeper: { cyc: 7, bob: 0.11, sq: 0.24, lean: 0.045, sway: 0.06, shift: 0.11, wing: 0, jitter: 0 },
}

interface Transient {
  obj: THREE.Object3D
  mat: THREE.Material | THREE.Material[]
  geo?: THREE.BufferGeometry
  t: number
  life: number
  kind: 'ring' | 'flash' | 'beam' | 'spark' | 'pop' | 'crack' | 'strike' | 'decal'
  vx?: number
  vy?: number
  vz?: number
  baseScale?: number
  fade?: boolean
  op0?: number // peak opacity (ground decals hold this, then fade)
}

const MAX_PARTICLES = 900
const MAX_MOTES = 110 // ambient atmosphere dust

// USER ORBIT CAMERA limits — clamped so the board always stays readable:
// never street-level, never upside-down, never panned off into the void.
const DEF_PITCH = 52 * Math.PI / 180 // default tilt from the ground plane
const PITCH_MIN = 28 * Math.PI / 180
const PITCH_MAX = 80 * Math.PI / 180 // near top-down (never flips over the pole)
const CAM_DIST_MIN = 6
const CAM_DIST_MAX = 42
const PAN_X = 5.5 // look-target clamp (world units) — stays on/near the board
const PAN_Z = 6.5
const LOOK_Y = -0.2

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

  private boardMeshes: THREE.Object3D[] = [] // the merged terrain mesh (kept as an array for teardown symmetry)
  // ONE sculpted, vertex-coloured terrain mesh replaces the old Kenney tile-kit grid:
  // a subdivided heightfield (flat plaza on build/path tiles — never moves a tower or
  // the pick plane — rising into rocky highlands on blocked/scenery tiles, plus a
  // perimeter skirt that falls away into haze). See computeTileRise()/buildTerrainMesh().
  private terrainGeo?: THREE.BufferGeometry
  // Ground/path/blocked each get their own material (CHROMANCER #58 — a painted
  // cel-shaded ground texture instead of one flat vertex-coloured kit tint) so the
  // three tile roles read as instantly distinct materials, not just a vertex tint.
  private pathMat?: THREE.MeshStandardMaterial
  private groundMat?: THREE.MeshStandardMaterial
  private rockMat?: THREE.MeshStandardMaterial
  // The SPECIFIC loaded painted textures — compared by reference at QA-query time
  // against each material's live `.map` so boardTexture() reports reality (loaded
  // vs fell back to the kit atlas), never an optimistically-set flag.
  private realmGroundTex: THREE.Texture | null = null
  private pathRoadTex: THREE.Texture | null = null
  private tileRise: Float32Array = new Float32Array(0) // per-tile extra height above GROUND (blocked cells only), COLS*ROWS
  // Grey→colour reveal: as the realm is cleared (sim.colorProgress 0..1) the ashen
  // field regains its palette saturation — the board itself proves the thesis. Stored
  // per vertex-write (flat-shaded quads: 6 writes/quad) so the re-tint is one buffer pass.
  private terrainFull: Float32Array = new Float32Array(0) // full-saturation target colour (r,g,b per vertex-write)
  private terrainGrey: Float32Array = new Float32Array(0) // ashen-monochrome colour (r,g,b per vertex-write)
  private terrainHold: Uint8Array = new Uint8Array(0) // hazard quads: never mute (gameplay read)
  private groundRevealQ = -1 // last quantised reveal level (throttles the re-tint)
  private ashenTint = new THREE.Color(0x4a4a5c) // cool desaturated "Limbo" grey — the Greying's target, not mud
  // Hard floor on how far the grey reveal may pull the board toward ashenTint — at
  // colorProgress 0 the terrain must still read as the realm's OWN colour, never mud.
  private static readonly GREY_CLAMP = 0.45
  private hazeTint = new THREE.Color(0x241a3c) // skirt fall-away colour (set to the realm fog tint in buildTerrainMesh)
  private boardLife?: BoardLife // on-board weather + prism-road shimmer
  private detailGroup = new THREE.Group()
  private buildHighlight = new THREE.Group()
  private hoverMesh!: THREE.Mesh
  private hoverMat!: THREE.MeshBasicMaterial
  // PLACEMENT range ring — a live, element-tinted coverage preview shown while the
  // player is positioning a tower/hero (before commit). Ring outline is the primary
  // read; a faint disc hints the covered area. Sized to the unit's real range.
  private placeRing!: THREE.Mesh
  private placeRingMat!: THREE.MeshBasicMaterial
  private placeDisc!: THREE.Mesh
  private placeDiscMat!: THREE.MeshBasicMaterial
  private placeRingR = 1 // current world radius (base for the idle breathe)
  private placeRingOk = true
  private portalMesh!: THREE.Mesh
  private extraPortals: THREE.Mesh[] = [] // additional spawn portals (multi-lane maps)
  private baseMesh!: THREE.Mesh
  // THE PRISM WELLSPRING — the defended base. A procedural crystalline fount
  // (baseMesh core + halo ring + light) that desaturates/cracks with HP, with an
  // OPTIONAL painted billboard crossfade (radiant → critical) when the art exists.
  private baseLight!: THREE.PointLight
  private baseHalo!: THREE.Mesh
  private baseHaloMat!: THREE.MeshBasicMaterial
  private baseArt: THREE.Sprite | null = null // radiant/full-HP painting
  private baseArtCrit: THREE.Sprite | null = null // greyed/cracked painting
  private baseArtMat: THREE.SpriteMaterial | null = null
  private baseArtCritMat: THREE.SpriteMaterial | null = null
  private baseIntegrity = 1
  private buffDirty = true

  // shared kit materials (atlas map + role tint/emissive) — few draw-call state changes
  private atlasBaseMat!: THREE.MeshStandardMaterial
  // per-element tower materials by role: body (stone/hull), trim (metal), dark
  // (iron/obsidian). The 'core' role uses orbMats — the palette-driven emissive.
  private towerMats = new Map<TowerKind, { body: THREE.MeshStandardMaterial; trim: THREE.MeshStandardMaterial; dark: THREE.MeshStandardMaterial }>()
  private orbMats = new Map<TowerKind, THREE.MeshStandardMaterial>()
  private orbBaseCol = new Map<TowerKind, THREE.Color>() // element hue for the idle core breath
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
  private particlesMat!: THREE.PointsMaterial
  private particleAlive = 0 // live count, refreshed each frame — drives the #55 density budget
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

  // camera juice: base pose from the orbit rig; render() layers drift/shake/push on it
  private camBasePos = new THREE.Vector3()
  private camLook = new THREE.Vector3(0, LOOK_Y, -0.35)

  // USER ORBIT RIG — a clamped spherical pose around a ground look-target.
  // Gestures (CameraControls) write the GOAL; render() eases the live pose
  // toward it so every pan/zoom/rotate lands smooth. Defaults re-fit on resize.
  private camGoal = { yaw: 0, pitch: DEF_PITCH, dist: 20, tx: 0, tz: -0.35 }
  private camCur = { yaw: 0, pitch: DEF_PITCH, dist: 20, tx: 0, tz: -0.35 }
  private camDefDist = 20
  private userCam = false // player owns the camera → idle drift stands down

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

  // painted-backdrop "aliveness" pass: procedural moving atmosphere layers over the
  // static per-realm painting (parallax, drifting FX, critters, foreground frame).
  private backdropMesh?: THREE.Mesh // the painted cylinder (parallax-swayed vs atmosphere)
  private atmosphere?: RealmAtmosphere
  private atmoReactFade = 0 // 0..1, a big reaction burst briefly fades ambient particles

  constructor(
    private sim: Sim,
    private palette: FieldPalette,
    private accent: number, // element-ground accent for the arena floor
    private pathCells: ReadonlyArray<[number, number]> = [], // ordered spawn→base cells
    private backdrop?: RealmBackdrop, // painted per-realm landscape (lazy-loaded)
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
    // Per-realm atmosphere: nudge the base fog toward the biome tint so the whole
    // scene reads as that world, without swamping the deep-violet base (keeps the
    // board / tokens / HP bars legible on top).
    this.scene.fog = new THREE.Fog(this.fogColor(), 22, 40)

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
    this.setupBackdrop()
    this.setupBoard()
    this.setupDetails()
    this.setupBoardLife()
    this.setupBuildHighlight()
    this.setupParticles()
    this.setupMotes()
    this.setupHover()
    this.setupPlaceRing()

    // post-processing: single bloom pass for neon glow
    this.composer = new EffectComposer(this.renderer)
    this.renderPass = new RenderPass(this.scene, this.camera)
    this.composer.addPass(this.renderPass)
    // Base bloom kept deliberately low (0.45) so the ambient hum doesn't wash the
    // frame out; the bloomAmp surges (pushIn / bloomPulse) do the heavy lifting so
    // big moments visibly OUT-glow the baseline instead of merely matching it.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.45, 0.55, 0.72)
    this.composer.addPass(this.bloom)
    this.outputPass = new OutputPass()
    this.composer.addPass(this.outputPass)
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.composer.setSize(window.innerWidth, window.innerHeight)

    this.frameCamera()
    // snap the live pose onto the default framing and place the camera so the
    // very first pick/projection (before the first render) is already correct
    Object.assign(this.camCur, this.camGoal)
    const c0 = this.camCur
    const cp0 = Math.cos(c0.pitch)
    this.camLook.set(c0.tx, LOOK_Y, c0.tz)
    this.camera.position.set(
      c0.tx + Math.sin(c0.yaw) * cp0 * c0.dist,
      LOOK_Y + Math.sin(c0.pitch) * c0.dist,
      c0.tz + Math.cos(c0.yaw) * cp0 * c0.dist,
    )
    this.camera.lookAt(this.camLook)
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
    // Bias the horizon band toward the realm tint (when present) so the all-angle
    // gradient backstop — the safety net when the painted plane is off-screen or
    // missing — still reads as this biome.
    const tint = this.backdrop ? new THREE.Color(this.backdrop.tint) : new THREE.Color(0x5a3cae)
    const accent = new THREE.Color(this.accent).lerp(tint, this.backdrop ? 0.55 : 0.7)
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

  // Base fog nudged toward the realm tint — biome mood without losing readability.
  private fogColor(): number {
    const base = new THREE.Color(0x180d33)
    if (this.backdrop) base.lerp(new THREE.Color(this.backdrop.tint), 0.22)
    return base.getHex()
  }

  // ---------------------------------------------------------------- backdrop
  // Painted per-realm landscape: ONE world-fixed curved plane parked behind the
  // board (−z, the default-view side). It shows the 16:9 art undistorted and
  // parallaxes correctly as the camera pans/orbits/zooms; orbit far enough past
  // it and the tinted gradient sky takes over (no edge-reveal, no tiling). Lazy-
  // loaded off the render path — the gradient shows until the texture decodes,
  // and a missing/failed file just stays on the gradient (graceful fallback).
  //
  // Gotchas handled: fog is disabled on the material (linear fog past ~40u would
  // otherwise paint it a solid wall), and the color is multiplied DOWN so it
  // stays under the bloom threshold and never washes out towers/enemies/HP bars.
  private setupBackdrop(): void {
    if (!this.backdrop) return
    const R = 32          // radius: camera (default rig, panned/zoomed) stays inside
    const H = 40          // tall enough to fill the frame at the shallowest pitch
    const arc = 150 * Math.PI / 180
    const geo = new THREE.CylinderGeometry(R, R, H, 48, 1, true, Math.PI - arc / 2, arc)
    this.disposables.push(geo)
    // Biome-tinted multiply — present enough that the painted world and the sculpted
    // terrain read as the SAME place (CHROMANCER #54), still dimmed below full bright
    // so the gameplay layer (towers/enemies/HP bars) stays the most saturated thing
    // on screen and bloom doesn't blow the painting out.
    const col = new THREE.Color(0xa8a8a8).lerp(new THREE.Color(this.backdrop.tint), 0.3)
    const mat = new THREE.MeshBasicMaterial({
      color: col,
      side: THREE.DoubleSide, // visible whether the camera sits just inside or outside R
      fog: false,             // never let the scene fog erase it into a flat wall
      depthWrite: false,      // pure backdrop — never occludes the play layer
      transparent: false,
    })
    this.disposables.push(mat)
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(0, H / 2 - 4, 0) // horizon of the art sits just below the board
    mesh.renderOrder = -1
    mesh.frustumCulled = false
    this.scene.add(mesh)
    this.backdropMesh = mesh

    // Aliveness pass: procedural moving layers over the painting (see RealmAtmosphere).
    // Built now (procedural — no extra fetch), recessive by construction, reduce-motion
    // aware. The painting stays the "far" plane; these deepen it without stealing focus.
    // Guarded: this is visual polish over a flagship board — any device-specific failure
    // (canvas 2D / material quirk) must degrade to the static painting, never break the
    // view (mirrors the texture-load onError fallback above).
    try {
      this.atmosphere = new RealmAtmosphere(this.scene, this.camera, this.backdrop, this.motionOk)
    } catch (e) {
      console.warn('RealmAtmosphere init failed — falling back to static backdrop', e)
      this.atmosphere = undefined
    }

    new THREE.TextureLoader().load(
      this.backdrop.url,
      (tex) => {
        if (this.disposed) { tex.dispose(); return }
        tex.colorSpace = THREE.SRGBColorSpace
        tex.wrapS = THREE.ClampToEdgeWrapping
        tex.wrapT = THREE.ClampToEdgeWrapping
        tex.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy())
        this.disposables.push(tex)
        mat.map = tex
        mat.needsUpdate = true
      },
      undefined,
      () => { /* missing/failed → stay on the tinted gradient sky (graceful fallback) */ },
    )
  }

  // ---------------------------------------------------------------- lights
  // Coherence rig: warm KEY + cool FILL + cool RIM + soft sky/ground hemi, plus a
  // low ambient floor so nothing crushes to black. Kept deliberately tight so the
  // whole board reads as one palette and the emissive tower caps are what pops.
  private setupLights(): void {
    // Per-realm ambient: nudge the sky-hemi + ambient floor toward the biome tint
    // so board, towers and greylings all read as this world. Kept subtle (≤18%)
    // so nothing gets recoloured enough to hurt readability.
    const tint = this.backdrop ? new THREE.Color(this.backdrop.tint) : null
    const hemiSky = new THREE.Color(0xdbeaff)
    const ambCol = new THREE.Color(0x40507a)
    if (tint) { hemiSky.lerp(tint, 0.16); ambCol.lerp(tint, 0.18) }
    const hemi = new THREE.HemisphereLight(hemiSky.getHex(), 0x35264f, 0.7) // cool sky, warm-ish ground
    this.scene.add(hemi)
    this.scene.add(new THREE.AmbientLight(ambCol.getHex(), 0.35))
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
    // bodyGlow: a low element-keyed emissive rim so each tower reads as a POCKET
    // of restored colour against the grey board (kept ≤0.14 so bloom never washes
    // it out). storm↔arcane are pulled apart in VALUE (dark slate vs pale lilac)
    // AND warmed trims, so the two spire silhouettes never read the same.
    const THEME: Record<TowerKind, { body: number; bodyRough: number; bodyMetal: number; trim: number; trimRough: number; trimMetal: number; trimGlow: number; dark: number; bodyGlow: number }> = {
      cannon: { body: 0x8a96b4, bodyRough: 0.62, bodyMetal: 0.28, trim: 0xc2d0e6, trimRough: 0.32, trimMetal: 0.88, trimGlow: 0.05, dark: 0x3a4258, bodyGlow: 0.04 },
      frost: { body: 0xe8f5fd, bodyRough: 0.4, bodyMetal: 0.05, trim: 0xa8e4fb, trimRough: 0.22, trimMetal: 0.12, trimGlow: 0.34, dark: 0x7d97ac, bodyGlow: 0.11 },
      flame: { body: 0x5a4650, bodyRough: 0.58, bodyMetal: 0.15, trim: 0xd6924e, trimRough: 0.36, trimMetal: 0.82, trimGlow: 0.16, dark: 0x271c20, bodyGlow: 0.13 },
      storm: { body: 0x4f495c, bodyRough: 0.52, bodyMetal: 0.4, trim: 0xe6bd5c, trimRough: 0.28, trimMetal: 0.92, trimGlow: 0.16, dark: 0x2b2636, bodyGlow: 0.11 },
      arcane: { body: 0xe3daf6, bodyRough: 0.48, bodyMetal: 0.07, trim: 0xecd08a, trimRough: 0.3, trimMetal: 0.85, trimGlow: 0.18, dark: 0x5b4c7f, bodyGlow: 0.14 },
      bloom: { body: 0x6e8a52, bodyRough: 0.6, bodyMetal: 0.04, trim: 0x9fe066, trimRough: 0.4, trimMetal: 0.06, trimGlow: 0.16, dark: 0x2e3a1e, bodyGlow: 0.12 },
      radiant: { body: 0xf3e4b0, bodyRough: 0.36, bodyMetal: 0.1, trim: 0xffe27a, trimRough: 0.24, trimMetal: 0.3, trimGlow: 0.28, dark: 0x6a5220, bodyGlow: 0.16 },
      shade: { body: 0x4a3a5e, bodyRough: 0.5, bodyMetal: 0.2, trim: 0xc9a6ff, trimRough: 0.3, trimMetal: 0.25, trimGlow: 0.2, dark: 0x1a0f2a, bodyGlow: 0.13 },
    }
    for (const kind of Object.keys(TOWERS) as TowerKind[]) {
      // equipped store skin = palette swap; falls back to the stock element color
      const col = towerPalette(kind).color
      const th = THEME[kind]
      // body carries a faint element-coloured self-glow (the "colour the world lost")
      const body = new THREE.MeshStandardMaterial({
        color: th.body, roughness: th.bodyRough, metalness: th.bodyMetal,
        emissive: col, emissiveIntensity: th.bodyGlow,
      })
      const trim = new THREE.MeshStandardMaterial({
        color: th.trim, roughness: th.trimRough, metalness: th.trimMetal,
        emissive: th.trimGlow > 0 ? th.trim : 0x000000, emissiveIntensity: th.trimGlow,
      })
      const dark = new THREE.MeshStandardMaterial({ color: th.dark, roughness: 0.5, metalness: 0.45 })
      this.towerMats.set(kind, { body, trim, dark })
      this.disposables.push(body, trim, dark)
      const orb = new THREE.MeshStandardMaterial({
        color: col, emissive: col, emissiveIntensity: ORB_EMISSIVE_BASE, roughness: 0.3, metalness: 0.1, flatShading: true, toneMapped: false,
      })
      this.orbMats.set(kind, orb)
      this.orbBaseCol.set(kind, new THREE.Color(col))
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
  // ONE sculpted terrain mesh — the fix for the "asset-kit tile grid" read. Build
  // and path tiles stay a perfectly flat plaza at y=GROUND (so towers, enemies, the
  // pick plane and every other fixed-height placement are UNTOUCHED — the logical
  // grid + WYSIWYG placement contract is identical to before). Blocked/scenery tiles
  // rise into rocky highlands starting one tile OUTSIDE that plaza, so the lane and
  // build footprint read as a carved plateau in a continuous landmass, not a grid of
  // separate flat squares. See computeTileRise()/buildTerrainMesh() for the sculpt.
  private setupBoard(): void {
    this.computeTileRise()
    this.buildTerrainMesh()
    this.setupEndpoints()
  }

  // BFS "clearance" (tile-steps to the nearest build/path tile) drives how far a
  // blocked tile has risen into the highlands, plus an additive dais bump near the
  // Wellspring so the base visibly emerges from a plinth of rock. Pure view data —
  // never touches sim.grid/terrain, so simcheck and placement are unaffected.
  private computeTileRise(): void {
    const n = COLS * ROWS
    const clear = new Int32Array(n).fill(-1)
    const queue: number[] = []
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const idx = r * COLS + c
      if (this.sim.grid[r][c] !== 'blocked') { clear[idx] = 0; queue.push(idx) }
    }
    let qi = 0
    const NB: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]]
    while (qi < queue.length) {
      const idx = queue[qi++]
      const c = idx % COLS, r = (idx / COLS) | 0
      const d = clear[idx]
      for (const [dc, dr] of NB) {
        const nc = c + dc, nr = r + dr
        if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) continue
        const nidx = nr * COLS + nc
        if (clear[nidx] === -1) { clear[nidx] = d + 1; queue.push(nidx) }
      }
    }
    const base = this.sim.waypointFor('base')
    const baseCol = (base.x - MAP_X) / TILE_PX - 0.5
    const baseRow = (base.y - MAP_Y) / TILE_PX - 0.5
    this.tileRise = new Float32Array(n)
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const idx = r * COLS + c
      if (this.sim.grid[r][c] !== 'blocked') continue // plaza stays exactly GROUND
      const cl = clear[idx]
      const n1 = hash2(c * 3 + 11, r * 5 + 17)
      const n2 = hash2(c * 7 + 2, r * 2 + 9)
      let rise: number
      if (cl <= 1) rise = 0.05 + n1 * 0.09       // shoulder — one tile out from the plaza
      else if (cl === 2) rise = 0.16 + n1 * 0.14  // rising bank
      else rise = 0.26 + n1 * 0.20                // highland interior
      rise += (n2 - 0.5) * 0.05
      // plinth: the land noticeably rises toward the Wellspring's plinth (base tile
      // itself stays flat via the blocked-only rule above; this bumps its neighbours)
      const dx = c - baseCol, dz = r - baseRow
      const distToBase = Math.sqrt(dx * dx + dz * dz)
      const plinth = Math.max(0, 1 - distToBase / 1.9)
      rise += plinth * plinth * 0.24
      this.tileRise[idx] = Math.max(0, rise)
    }
  }

  // Average of the (up to 4) tiles touching interior corner (cx,cz), cx∈[0,COLS],
  // cz∈[0,ROWS]. Forced flat (GROUND) the instant ANY touching tile is build/path —
  // this is what guarantees a one-tile flat shoulder around the whole plaza.
  private cornerHeightInterior(cx: number, cz: number): number {
    let sum = 0, cnt = 0, flat = false
    const offs: Array<[number, number]> = [[0, 0], [-1, 0], [0, -1], [-1, -1]]
    for (const [dc, dr] of offs) {
      const c = cx + dc, r = cz + dr
      if (c < 0 || c >= COLS || r < 0 || r >= ROWS) continue
      if (this.sim.grid[r][c] !== 'blocked') { flat = true; continue }
      sum += this.tileRise[r * COLS + c]
      cnt++
    }
    if (flat || cnt === 0) return GROUND
    return GROUND + sum / cnt
  }

  // Extends cornerHeightInterior beyond the board into the cliff skirt: a short rim
  // rise, then a sharp fall-away so the land recedes into the fog/haze at the frame's
  // edge instead of stopping in a hard, dead-flat cutoff.
  private cornerHeight(cx: number, cz: number): number {
    const out = Math.max(0, -cx, cx - COLS, -cz, cz - ROWS)
    const ccx = Math.min(COLS, Math.max(0, cx))
    const ccz = Math.min(ROWS, Math.max(0, cz))
    const base = this.cornerHeightInterior(ccx, ccz)
    if (out <= 0) return base
    if (out <= 1.15) return base + out * 0.2 // rim crest
    const crest = base + 0.23
    const d = out - 1.15
    return crest - d * d * 1.35 // falls away
  }

  // Bilinear height sample at fractional grid coords (gx=c is tile c's left edge).
  private heightAt(gx: number, gz: number): number {
    const x0 = Math.floor(gx), z0 = Math.floor(gz)
    const tx = gx - x0, tz = gz - z0
    const h00 = this.cornerHeight(x0, z0)
    const h10 = this.cornerHeight(x0 + 1, z0)
    const h01 = this.cornerHeight(x0, z0 + 1)
    const h11 = this.cornerHeight(x0 + 1, z0 + 1)
    const a = h00 + (h10 - h00) * tx
    const b = h01 + (h11 - h01) * tx
    return a + (b - a) * tz
  }

  // matIndex 0=path, 1=build(ground), 2=blocked(rock) — one geometry group per
  // material below. Path/build quads now carry the realm's PAINTED texture (see
  // buildTerrainMesh); the colour returned here is a MODULATION tint multiplied
  // over that texture, so it's kept near-white (worn-lip/hazard/AO only) rather
  // than the old flat palette albedo — that albedo now lives in the PNG, and
  // re-tinting it away from white is exactly the "washed beige" bug we're fixing.
  // Rock/blocked quads have no painted texture (they read as a darker, desaturated
  // highland — the readability contrast against the bright buildable ground) so
  // they keep the original flat-vertex-coloured strata treatment untouched.
  private terrainQuadColor(
    tc: number, tr: number, si: number, sj: number,
    h00: number, h10: number, h01: number, h11: number,
  ): [THREE.Color, boolean, number] {
    const inBoard = tc >= 0 && tc < COLS && tr >= 0 && tr < ROWS
    const kind = inBoard ? this.sim.grid[tr][tc] : 'blocked'
    let hold = false
    let col: THREE.Color
    let matIndex: number
    if (kind === 'path') {
      matIndex = 0
      col = new THREE.Color(0xffffff)
    } else if (kind === 'build') {
      matIndex = 1
      col = new THREE.Color(0xffffff)
      const terr = this.sim.terrainAt(tc, tr)
      if (terr !== '' && TERRAIN_META[terr]) {
        col = col.clone().lerp(new THREE.Color(TERRAIN_META[terr].color), 0.55)
        hold = true
      }
      // worn lip: darken the strip of build tile that actually touches the lane
      const nKind = (dc: number, dr: number): string => {
        const c = tc + dc, r = tr + dr
        if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return 'blocked'
        return this.sim.grid[r][c]
      }
      let edge = false
      if (si === 0 && nKind(-1, 0) === 'path') edge = true
      if (si === TSUB - 1 && nKind(1, 0) === 'path') edge = true
      if (sj === 0 && nKind(0, -1) === 'path') edge = true
      if (sj === TSUB - 1 && nKind(0, 1) === 'path') edge = true
      if (edge) col = col.clone().multiplyScalar(0.86)
    } else {
      matIndex = 2
      // rock: two grass-slot hues blended per-tile, a subtle strata band by elevation,
      // and per-quad grain so the highlands never read as one flat colour.
      const h1 = hash2(tc * 3 + 11, tr * 5 + 17)
      const h2 = hash2(tc * 7 + si * 2 + 3, tr * 9 + sj * 2 + 5)
      col = new THREE.Color(this.palette.grassA).lerp(new THREE.Color(this.palette.grassB), h1)
      const avgH = (h00 + h10 + h01 + h11) / 4
      const band = 0.5 + 0.5 * Math.sin(avgH * 30 + h1 * 5)
      if (band > 0.68) col = col.lerp(new THREE.Color(this.palette.build), (band - 0.68) * 0.9)
      col.offsetHSL(0, 0, (h2 - 0.5) * 0.1)
      // darker/desaturated vs. the now-bright painted ground: blocked/unbuildable
      // must read as visibly OFF-LIMITS at a glance (CHROMANCER #58 hierarchy fix).
      col.offsetHSL(0, -0.12, 0)
      col.multiplyScalar(0.78)
    }
    // slope AO: darken quads sitting on a height gradient (crevices, shoulders, rim)
    const slope = Math.max(h00, h10, h01, h11) - Math.min(h00, h10, h01, h11)
    const ao = Math.min(0.38, slope * 5.2)
    if (ao > 0) col = col.clone().multiplyScalar(1 - ao * 0.6)
    // skirt haze: recede into the realm's fog tint as the land falls away (skirt
    // rings are always outside the board, i.e. always matIndex 2 — never touches
    // the textured path/build modulation)
    const out = Math.max(0, -tc, tc - COLS + 1, -tr, tr - ROWS + 1)
    if (out > 0) {
      const t = Math.min(1, out / TSKIRT)
      col = col.clone().lerp(this.hazeTint, t * t * 0.9)
    }
    // LIGHT COMPENSATION: the board's stacked rig (hemi + ambient + 3 directional +
    // a point accent) reads a flat vertex-coloured surface noticeably brighter than
    // its input — uncompensated, the rock highlands would wash toward pale grey/white
    // on screen regardless of hue. Only the UNTEXTURED rock material needs this; the
    // painted path/build textures are already contrast-gated to their on-screen target.
    if (matIndex === 2) col = col.clone().multiplyScalar(TERRAIN_LIGHT_COMP)
    return [col, hold, matIndex]
  }

  // Ashen target for the Greying's wave-1 state: a single CLAMPED lerp toward the
  // cool "Limbo" tint, capped at GREY_CLAMP (0.45) — never a full desaturate-to-
  // luminance-then-tint stack, which was eating the realm's own colour down to
  // ~27% at colorProgress 0 (the "bottoms out into mud" bug). At the clamp, the
  // board still reads as its own hue at HALF-plus strength; full colour still
  // rewards clearing the realm.
  private ashenColorFor(full: THREE.Color): THREE.Color {
    return full.clone().lerp(this.ashenTint, BattleView3D.GREY_CLAMP)
  }

  // Build the merged, non-indexed (flat-shaded) terrain BufferGeometry: the whole
  // board + a cliff-skirt apron, one draw call, vertex-coloured per quad. Non-indexed
  // so computeVertexNormals() yields clean per-facet lighting (the low-poly look the
  // rest of the board already uses) without the complexity of a shared-vertex mesh.
  private buildTerrainMesh(): void {
    this.hazeTint = new THREE.Color(this.fogColor())
    const cols = COLS + 2 * TSKIRT
    const rows = ROWS + 2 * TSKIRT
    const quads = cols * TSUB * rows * TSUB
    const verts = quads * 6
    const pos = new Float32Array(verts * 3)
    const full = new Float32Array(verts * 3)
    const grey = new Float32Array(verts * 3)
    const hold = new Uint8Array(verts)
    const uv = new Float32Array(verts * 2)
    let vi = 0
    const _full = new THREE.Color()
    const geo = new THREE.BufferGeometry()
    let groupStart = 0
    let groupMatIndex = -1
    for (let tr = -TSKIRT; tr < ROWS + TSKIRT; tr++) {
      for (let tc = -TSKIRT; tc < COLS + TSKIRT; tc++) {
        for (let sj = 0; sj < TSUB; sj++) {
          for (let si = 0; si < TSUB; si++) {
            const gx0 = tc + si / TSUB, gx1 = tc + (si + 1) / TSUB
            const gz0 = tr + sj / TSUB, gz1 = tr + (sj + 1) / TSUB
            const h00 = this.heightAt(gx0, gz0), h10 = this.heightAt(gx1, gz0)
            const h01 = this.heightAt(gx0, gz1), h11 = this.heightAt(gx1, gz1)
            const x0 = wx(MAP_X + gx0 * TILE_PX), x1 = wx(MAP_X + gx1 * TILE_PX)
            const z0 = wz(MAP_Y + gz0 * TILE_PX), z1 = wz(MAP_Y + gz1 * TILE_PX)
            const [c, hd, matIndex] = this.terrainQuadColor(tc, tr, si, sj, h00, h10, h01, h11)
            // One geometry group per contiguous run of same-material quads (path /
            // build / blocked each render with their OWN textured material below —
            // still just 3 draw calls total for the whole board, not per-tile).
            if (matIndex !== groupMatIndex) {
              if (groupMatIndex >= 0) geo.addGroup(groupStart, vi - groupStart, groupMatIndex)
              groupStart = vi
              groupMatIndex = matIndex
            }
            _full.copy(c)
            const g = this.ashenColorFor(_full)
            const quad: Array<[number, number, number, number, number]> = [
              [x0, h00, z0, gx0, gz0], [x1, h10, z0, gx1, gz0], [x1, h11, z1, gx1, gz1],
              [x0, h00, z0, gx0, gz0], [x1, h11, z1, gx1, gz1], [x0, h01, z1, gx0, gz1],
            ]
            for (const [x, y, z, gx, gz] of quad) {
              pos[vi * 3] = x; pos[vi * 3 + 1] = y; pos[vi * 3 + 2] = z
              full[vi * 3] = _full.r; full[vi * 3 + 1] = _full.g; full[vi * 3 + 2] = _full.b
              grey[vi * 3] = g.r; grey[vi * 3 + 1] = g.g; grey[vi * 3 + 2] = g.b
              hold[vi] = hd ? 1 : 0
              // Continuous tile-space coords (never reset per-tile) → seamless
              // RepeatWrapping tiling across the whole merged mesh, no per-quad seams.
              uv[vi * 2] = gx * GROUND_TEX_REPEAT
              uv[vi * 2 + 1] = gz * GROUND_TEX_REPEAT
              vi++
            }
          }
        }
      }
    }
    if (groupMatIndex >= 0) geo.addGroup(groupStart, vi - groupStart, groupMatIndex)
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(full.slice(), 3))
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
    geo.computeVertexNormals()
    this.terrainFull = full
    this.terrainGrey = grey
    this.terrainHold = hold
    this.terrainGeo = geo

    const kitAtlas = models.atlas()
    // Buildable ground: the realm's painted cel-shaded texture. Falls back to the
    // old kit atlas (never a blank/white board) if the PNG 404s — see loadGroundTex.
    this.groundMat = new THREE.MeshStandardMaterial({
      map: null, color: kitAtlas ? 0xffffff : this.palette.build,
      vertexColors: true, roughness: 0.92, metalness: 0.03,
    })
    // Path: its own lighter/warmer/more-neutral texture — the deliberate contrast
    // against every realm's ground IS the buildable/path readability cue.
    this.pathMat = new THREE.MeshStandardMaterial({
      map: null, color: kitAtlas ? 0xffffff : this.palette.path,
      vertexColors: true, roughness: 0.88, metalness: 0.02,
    })
    // Blocked/highland: unchanged flat vertex-coloured rock (see terrainQuadColor) —
    // no painted texture, so it never fights the ground/path readability contrast.
    this.rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.03 })
    this.disposables.push(geo, this.groundMat, this.pathMat, this.rockMat)
    this.loadGroundTextures(kitAtlas)

    const mesh = new THREE.Mesh(geo, [this.pathMat, this.groundMat, this.rockMat])
    mesh.frustumCulled = false
    this.scene.add(mesh)
    this.boardMeshes.push(mesh)
    // Paint the initial reveal state: ashen when animation is on (climbs to full
    // colour as the realm clears); snap to full colour under reduce-motion (static).
    this.groundRevealQ = -1
    this.applyGroundReveal(this.motionOk ? this.sim.colorProgress() : 1)
  }

  // Fail-soft PNG load for the ground/path textures: on success, swap the live
  // material's `.map` to the painted texture (colour stays 0xffffff so the PNG's
  // OWN saturated palette survives); on 404/failure, fall back to the shared kit
  // atlas (or a flat palette tint if even that's missing) — the board must never
  // render blank. boardTextureState() reads back whichever actually landed.
  private loadGroundTextures(kitAtlas: THREE.Texture | null): void {
    const realmKey = this.backdrop?.key ?? ''
    const loader = new THREE.TextureLoader()
    const groundUrl = `${import.meta.env.BASE_URL}textures/realms/${realmKey}-ground.png`
    loader.load(
      groundUrl,
      (tex) => {
        if (this.disposed || !this.groundMat) { tex.dispose(); return }
        tex.colorSpace = THREE.SRGBColorSpace
        tex.wrapS = THREE.RepeatWrapping
        tex.wrapT = THREE.RepeatWrapping
        tex.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy())
        this.disposables.push(tex)
        this.realmGroundTex = tex
        this.groundMat.map = tex
        this.groundMat.color.set(0xffffff)
        this.groundMat.needsUpdate = true
      },
      undefined,
      () => {
        if (this.disposed || !this.groundMat) return
        this.groundMat.map = kitAtlas ?? null
        this.groundMat.color.set(kitAtlas ? 0xffffff : this.palette.build)
        this.groundMat.needsUpdate = true
      },
    )
    const pathUrl = `${import.meta.env.BASE_URL}textures/path-road.png`
    loader.load(
      pathUrl,
      (tex) => {
        if (this.disposed || !this.pathMat) { tex.dispose(); return }
        tex.colorSpace = THREE.SRGBColorSpace
        tex.wrapS = THREE.RepeatWrapping
        tex.wrapT = THREE.RepeatWrapping
        tex.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy())
        this.disposables.push(tex)
        this.pathRoadTex = tex
        this.pathMat.map = tex
        this.pathMat.color.set(0xffffff)
        this.pathMat.needsUpdate = true
      },
      undefined,
      () => {
        if (this.disposed || !this.pathMat) return
        this.pathMat.map = kitAtlas ?? null
        this.pathMat.color.set(kitAtlas ? 0xffffff : this.palette.path)
        this.pathMat.needsUpdate = true
      },
    )
  }

  // ?qa=1 drive-API surface (see qa.ts QaBoardTexture): reads the LIVE material's
  // bound `.map` reference back against the specific textures we loaded above —
  // never an optimistic flag — so a silent texture 404 can't report as success.
  boardTextureState(): { realm: string; ground: 'realm-png' | 'fallback-atlas'; path: 'path-png' | 'fallback-atlas' } {
    return {
      realm: this.backdrop?.key ?? '',
      ground: this.groundMat && this.groundMat.map === this.realmGroundTex && this.realmGroundTex ? 'realm-png' : 'fallback-atlas',
      path: this.pathMat && this.pathMat.map === this.pathRoadTex && this.pathRoadTex ? 'path-png' : 'fallback-atlas',
    }
  }

  // Re-tint the terrain toward its palette as the realm is cleared. reveal 0 → ashen
  // monochrome; reveal 1 → full palette colour. Hazard quads are pinned to full
  // colour so the terrain read never fades. Cheap: only touched when the quantised
  // reveal changes (a handful of times per battle).
  private applyGroundReveal(reveal: number): void {
    const geo = this.terrainGeo
    if (!geo) return
    const colAttr = geo.getAttribute('color') as THREE.BufferAttribute
    const arr = colAttr.array as Float32Array
    const mute = (1 - Math.max(0, Math.min(1, reveal))) * 0.85
    for (let i = 0; i < this.terrainHold.length; i++) {
      const o = i * 3
      if (this.terrainHold[i] || mute <= 0) {
        arr[o] = this.terrainFull[o]; arr[o + 1] = this.terrainFull[o + 1]; arr[o + 2] = this.terrainFull[o + 2]
      } else {
        arr[o] = this.terrainFull[o] + (this.terrainGrey[o] - this.terrainFull[o]) * mute
        arr[o + 1] = this.terrainFull[o + 1] + (this.terrainGrey[o + 1] - this.terrainFull[o + 1]) * mute
        arr[o + 2] = this.terrainFull[o + 2] + (this.terrainGrey[o + 2] - this.terrainFull[o + 2]) * mute
      }
    }
    colAttr.needsUpdate = true
  }

  // Per-frame: drive the reveal off battle progress, throttled to ~2% steps so the
  // full-board re-tint only fires when the clear fraction actually advances.
  private updateGroundReveal(): void {
    if (!this.terrainGeo || !this.motionOk) return // static (already full) when reduced
    const prog = this.sim.colorProgress()
    const q = Math.round(prog * 50)
    if (q === this.groundRevealQ) return
    this.groundRevealQ = q
    this.applyGroundReveal(q / 50)
  }

  // On-board diorama layers (per-realm weather drifting across the plane + a
  // prism-road shimmer flowing along the lane). Isolated + fail-soft: a throw
  // here must never sink the board, so we swallow and continue on the bare tiles.
  private setupBoardLife(): void {
    try {
      const path = this.pathCells.map(([c, r]) =>
        new THREE.Vector3(wx(MAP_X + c * TILE_PX + TILE_PX / 2), 0, wz(MAP_Y + r * TILE_PX + TILE_PX / 2)))
      // board world extent (with a small margin so weather crosses the whole plane)
      const x0 = wx(MAP_X + TILE_PX / 2), x1 = wx(MAP_X + (COLS - 1) * TILE_PX + TILE_PX / 2)
      const z0 = wz(MAP_Y + TILE_PX / 2), z1 = wz(MAP_Y + (ROWS - 1) * TILE_PX + TILE_PX / 2)
      const bounds = {
        minX: Math.min(x0, x1) - 0.6, maxX: Math.max(x0, x1) + 0.6,
        minZ: Math.min(z0, z1) - 0.6, maxZ: Math.max(z0, z1) + 0.6,
        y: GROUND,
      }
      this.boardLife = new BoardLife(this.scene, this.motionOk, this.backdrop?.key ?? 'emberwaste', path, bounds)
    } catch (e) {
      console.warn('BoardLife init failed — board renders without weather/shimmer', e)
      this.boardLife = undefined
    }
  }


  // Scatter per-realm props on non-play (blocked) cells so the board reads as a
  // populated diorama, not a bare lane. Kept OFF gameplay tiles (build/path) and
  // low/non-occluding. The mix + crystal glow are biased by realm (ruins & embers in
  // Emberwaste, ice shards in Frostreach, foliage in Verdantwilds, …).
  private setupDetails(): void {
    // per-realm prop weighting: [foliage<, rocks/ruins<] thresholds + crystal glow hue
    const REALM_PROPS: Record<string, { tree: number; rocks: number; glow: number }> = {
      emberwaste:     { tree: 0.10, rocks: 0.74, glow: 0xff7a3c }, // scorched ruins + ember shards
      frostreach:     { tree: 0.12, rocks: 0.52, glow: 0x9fe8ff }, // ice shards + frosted rock
      stormpeaks:     { tree: 0.16, rocks: 0.66, glow: 0xb69cff }, // storm-charged crags
      verdantwilds:   { tree: 0.58, rocks: 0.84, glow: 0x8fe07a }, // dense foliage
      radiantsanctum: { tree: 0.24, rocks: 0.56, glow: 0xffe6a0 }, // gilded ruins + light crystal
      umbralvoid:     { tree: 0.10, rocks: 0.52, glow: 0xc07adf }, // void shards
    }
    const rp = REALM_PROPS[this.backdrop?.key ?? ''] ?? { tree: 0.34, rocks: 0.68, glow: 0x4ad9ff }
    // Crystals carry the realm's signature glow (ice/ember/void) — cheap, shared mat.
    this.detailCrystalMat.emissive.setHex(rp.glow)
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (this.sim.grid[r][c] !== 'blocked') continue
        const propY = GROUND + (this.tileRise[r * COLS + c] ?? 0)
        this.scatterProp(c, r, propY, rp, 0.78) // ~78% of blocked cells populated (denser diorama)
      }
    }
    // BORDER ring — the level's outer edge (one skirt tile beyond the play board)
    // gets its own sparser scatter pass so it reads as inhabited land continuing
    // past the frame, not a bare cutoff. Always outside sim.grid, so this can
    // never overlap a path/build tile or occlude a tower.
    for (let r = -1; r <= ROWS; r++) {
      for (let c = -1; c <= COLS; c++) {
        if (r >= 0 && r < ROWS && c >= 0 && c < COLS) continue // interior already scattered above
        const propY = this.heightAt(c + 0.5, r + 0.5)
        this.scatterProp(c, r, propY, rp, 0.6)
      }
    }
  }

  // One deterministically-seeded prop draw for cell (c,r) — shared by the interior
  // blocked-tile scatter and the outer border-ring pass. `density` is the fraction
  // of cells populated (kept lower on the border so it frames rather than crowds).
  private scatterProp(
    c: number, r: number, propY: number,
    rp: { tree: number; rocks: number; glow: number }, density: number,
  ): void {
    const h = hash2(c * 3 + 1, r * 5 + 2)
    if (h > density) return
    const pick = hash2(c * 7 + 3, r * 2 + 9)
    let name: string, mat: THREE.Material, blob: number, scale: number
    if (pick < rp.tree) { name = h < 0.25 ? 'detail-tree-large' : 'detail-tree'; mat = this.atlasBaseMat; blob = 0.28; scale = 0.9 + h }
    else if (pick < rp.rocks) { name = h < 0.25 ? 'detail-rocks-large' : 'detail-rocks'; mat = this.atlasBaseMat; blob = 0.32; scale = 0.85 + h * 0.5 }
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
    g.position.set(wx(MAP_X + c * TILE_PX + TILE_PX / 2) + jx, propY, wz(MAP_Y + r * TILE_PX + TILE_PX / 2) + jz)
    this.detailGroup.add(g)
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

    // MULTI-LANE maps spawn from 2+ portals converging on the base — draw one torus
    // per additional route so the extra spawn point reads clearly (the road tiles are
    // already laid by the grid). They share the primary's geometry/material.
    this.extraPortals = []
    const allPortals = this.sim.portals()
    for (let i = 1; i < allPortals.length; i++) {
      const p = allPortals[i]
      const m = new THREE.Mesh(portalGeo, portalMat)
      m.position.set(wx(p.x), GROUND + 0.35, wz(p.y))
      m.rotation.x = Math.PI / 2
      this.scene.add(m)
      this.extraPortals.push(m)
    }

    const bx = wx(base.x)
    const bz = wz(base.y)

    // Procedural fount core — a faceted crystal that the HP-driven desaturation
    // grips onto (the guaranteed fallback when the painted Wellspring is absent).
    const baseGeo = new THREE.OctahedronGeometry(0.5, 0)
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x2ff7c3, emissive: 0x2ff7c3, emissiveIntensity: 1.1, roughness: 0.25, metalness: 0.2, flatShading: true })
    this.disposables.push(baseGeo, baseMat)
    const baseMesh = new THREE.Mesh(baseGeo, baseMat)
    baseMesh.position.set(bx, GROUND + 0.55, bz)
    this.scene.add(baseMesh)
    this.baseMesh = baseMesh
    const baseLight = new THREE.PointLight(0x2ff7c3, 0.8, 8, 2)
    baseLight.position.copy(baseMesh.position)
    this.scene.add(baseLight)
    this.baseLight = baseLight

    // Radiant ground halo — a soft colour bloom on the floor that dims as HP falls.
    // A radial-gradient glow (alpha → 0 at the rim) on a small flat quad, NOT a
    // flat-opacity ring: a solid-opacity annulus reads as a hard-edged milky disc
    // (and, clipped by the board edge + amplified by bloom, as the "quad with
    // straight edges" the owner saw washing out START). The gradient falls off
    // smoothly so it stays a gentle glow that never boxes or reaches the HUD.
    const haloGeo = new THREE.PlaneGeometry(2.2, 2.2)
    this.baseHaloMat = new THREE.MeshBasicMaterial({ map: this.enemyGlowTexture(), color: 0x2ff7c3, transparent: true, opacity: 0.42, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
    this.disposables.push(haloGeo, this.baseHaloMat)
    this.baseHalo = new THREE.Mesh(haloGeo, this.baseHaloMat)
    this.baseHalo.rotation.x = -Math.PI / 2
    this.baseHalo.position.set(bx, GROUND + 0.04, bz)
    this.scene.add(this.baseHalo)

    // OPTIONAL painted Wellspring billboards (radiant + critical), crossfaded by HP.
    // Graceful fallback: if the art is missing the procedural fount above carries it.
    const artBase = import.meta.env.BASE_URL + 'concepts/base/'
    const mkArt = (file: string, initOpacity: number, primary: boolean, assign: (s: THREE.Sprite, m: THREE.SpriteMaterial) => void): void => {
      new THREE.TextureLoader().load(
        artBase + file,
        (tex) => {
          if (this.disposed) { tex.dispose(); return }
          tex.colorSpace = THREE.SRGBColorSpace
          tex.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy())
          this.disposables.push(tex)
          const aspect = tex.image && tex.image.width ? tex.image.width / tex.image.height : 1
          const h = 2.6
          // alphaTest discards the fully-transparent quad corners BEFORE any blend
          // runs — without it the sprite's transparent region blends as a hard-edged
          // milky/dark box on some GPUs (the owner's iOS artifact). Matches the enemy
          // (0.04) / tower (0.05) body sprites, which never showed the box for this
          // exact reason. Kept low so the painting's soft anti-aliased rim survives.
          const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: initOpacity, alphaTest: 0.06, depthWrite: false, depthTest: true })
          this.disposables.push(mat)
          const sprite = new THREE.Sprite(mat)
          sprite.scale.set(h * aspect, h, 1)
          sprite.position.set(bx, GROUND + h / 2, bz)
          this.scene.add(sprite)
          assign(sprite, mat)
          // once the RADIANT painting exists, hand the core role over to it (the
          // light + halo stay); the critical sprite only ever fades IN over it.
          if (primary) this.baseMesh.visible = false
          this.setBaseIntegrity(this.baseIntegrity) // re-apply current HP state to the new sprite
        },
        undefined,
        () => { /* missing → procedural fount ships (graceful fallback) */ },
      )
    }
    mkArt('wellspring.png', 1, true, (s, m) => { this.baseArt = s; this.baseArtMat = m })
    mkArt('wellspring-critical.png', 0, false, (s, m) => { this.baseArtCrit = s; this.baseArtCritMat = m })
  }

  // Drive the Wellspring's health read: crossfade radiant→cracked art (or desaturate
  // the procedural fount) so losing base HP literally looks like the world greying.
  private static readonly BASE_FULL = new THREE.Color(0x2ff7c3)
  private static readonly BASE_GREY = new THREE.Color(0x6b6b73)
  setBaseIntegrity(frac: number): void {
    const f = Math.max(0, Math.min(1, frac))
    this.baseIntegrity = f
    // colour bleeds from radiant teal toward ashen grey as HP drains
    const tint = BattleView3D.BASE_FULL.clone().lerp(BattleView3D.BASE_GREY, 1 - f)
    if (this.baseLight) { this.baseLight.color.copy(tint); this.baseLight.intensity = 0.28 + 0.62 * f }
    if (this.baseHaloMat) { this.baseHaloMat.color.copy(tint); this.baseHaloMat.opacity = 0.1 + 0.36 * f }
    if (this.baseArtMat && this.baseArtCritMat) {
      // painted crossfade: radiant fades out and desaturates, cracked fades in
      this.baseArtMat.opacity = Math.max(0.15, f)
      this.baseArtMat.color.copy(BattleView3D.BASE_FULL.clone().lerp(BattleView3D.BASE_GREY, (1 - f) * 0.85))
      this.baseArtCritMat.opacity = Math.min(1, (1 - f) * 1.3)
    } else if (this.baseMesh) {
      // procedural fount: desaturate + dim + shrink a touch as it cracks
      const m = this.baseMesh.material as THREE.MeshStandardMaterial
      m.color.copy(tint)
      m.emissive.copy(tint)
      m.emissiveIntensity = 0.18 + 0.92 * f
    }
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

  // Placement range ring: a crisp unit-radius outline (scaled to the unit's real
  // range) plus a faint coverage disc, both re-tinted per unit and flipped red on
  // a blocked tile. Kept flat on the ground, breathing gently while shown.
  private setupPlaceRing(): void {
    const ringGeo = new THREE.RingGeometry(0.955, 1.0, 72) // outer edge == radius 1 → scale = range
    this.placeRingMat = new THREE.MeshBasicMaterial({ color: 0x9affc0, transparent: true, opacity: 0.92, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })
    this.placeRing = new THREE.Mesh(ringGeo, this.placeRingMat)
    this.placeRing.rotation.x = -Math.PI / 2
    this.placeRing.position.y = GROUND + 0.025
    this.placeRing.renderOrder = 3
    this.placeRing.visible = false
    this.scene.add(this.placeRing)

    const discGeo = new THREE.CircleGeometry(1, 72)
    this.placeDiscMat = new THREE.MeshBasicMaterial({ color: 0x9affc0, transparent: true, opacity: 0.06, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })
    this.placeDisc = new THREE.Mesh(discGeo, this.placeDiscMat)
    this.placeDisc.rotation.x = -Math.PI / 2
    this.placeDisc.position.y = GROUND + 0.018
    this.placeDisc.renderOrder = 2
    this.placeDisc.visible = false
    this.scene.add(this.placeDisc)

    this.disposables.push(ringGeo, this.placeRingMat, discGeo, this.placeDiscMat)
  }

  // Show/refresh the placement range ring at a buildable tile. `rangePx` is the
  // unit's REAL range (sim px); `color` its element tint; `ok` false → blocked tile.
  // Pass cell=null (or range<=0) to hide it. Called live from the scene's hover.
  setPlaceRing(cell: { col: number; row: number } | null, rangePx: number, color: number, ok: boolean): void {
    if (!cell || rangePx <= 0) { this.placeRing.visible = false; this.placeDisc.visible = false; return }
    const x = wx(MAP_X + cell.col * TILE_PX + TILE_PX / 2)
    const z = wz(MAP_Y + cell.row * TILE_PX + TILE_PX / 2)
    const r = wr(rangePx)
    this.placeRingR = r
    this.placeRingOk = ok
    const c = ok ? color : 0xff5b7a
    this.placeRing.position.set(x, GROUND + 0.025, z)
    this.placeDisc.position.set(x, GROUND + 0.018, z)
    this.placeRing.scale.set(r, r, 1)
    this.placeDisc.scale.set(r, r, 1)
    this.placeRingMat.color.setHex(c)
    this.placeDiscMat.color.setHex(c)
    this.placeRingMat.opacity = ok ? 0.92 : 0.7
    this.placeDiscMat.opacity = ok ? 0.06 : 0.04
    this.placeRing.visible = true
    this.placeDisc.visible = true
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
    // toneMapped:false — these are ADDITIVE gameplay bursts (kills, reactions, hero
    // FX), not lit surfaces; letting ACES compress them washed the element colours
    // toward white. Exempting them keeps every spark vivid + saturated ("units pop").
    const mat = new THREE.PointsMaterial({ size: 0.22, vertexColors: true, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true, toneMapped: false })
    this.disposables.push(mat)
    this.particlesMat = mat
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

  // Drive the painted-backdrop aliveness pass: a whisper of parallax sway on the
  // painting itself (differential vs the atmosphere layers = depth) + the wave-driven
  // atmosphere (warm/thicken as the boss nears) and the reaction-burst recede (gameplay
  // FX briefly own the frame). All no-ops under reduce-motion (atmosphere.update guards).
  private updateBackdrop(dt: number): void {
    if (!this.atmosphere) return
    this.atmoReactFade = Math.max(0, this.atmoReactFade - dt * 1.6)
    // painting sways a touch LESS than the mid/near atmosphere → parallax read
    if (this.backdropMesh && this.motionOk) this.backdropMesh.rotation.y = Math.sin(this.camBaseAngle) * 0.03
    // tension: how close the boss is. Run progress + a strong bump while a boss lives.
    const waves = Math.max(1, this.sim.config.level.waves.length)
    let bossAlive = false
    for (const e of this.sim.enemies) { if (e.active && e.def.boss) { bossAlive = true; break } }
    const progress = Math.min(1, this.sim.waveIndex / waves)
    const tension = Math.min(1, progress * 0.45 + (bossAlive ? 0.6 : 0))
    try {
      this.atmosphere.update(dt, {
        clockT: this.clockT,
        camBaseAngle: this.camBaseAngle,
        tension,
        reactionFade: this.atmoReactFade,
      })
    } catch (e) {
      // a failing atmosphere must never take the whole frame down — drop it and
      // continue on the static painting.
      console.warn('RealmAtmosphere update failed — dropping atmosphere', e)
      this.atmosphere.dispose()
      this.atmosphere = undefined
    }
  }

  // CHROMANCER #55 — peak-density readability: a density-aware budget on burst
  // SIZE (not just the frame's overall opacity, set in updateParticles below).
  // A single reaction at a quiet moment gets its full, punchy particle count;
  // when many bursts are already alive on screen (a chained-reaction peak),
  // each NEW burst is scaled down so the total stays a readable flurry instead
  // of compositing into an opaque additive wall over the lane.
  private densityScaleFor(): number {
    if (this.particleAlive > 550) return 0.3
    if (this.particleAlive > 320) return 0.55
    if (this.particleAlive > 160) return 0.8
    return 1
  }

  private emitParticles(x: number, y: number, z: number, color: number, count: number, speed: number): void {
    count = Math.max(1, Math.round(count * this.densityScaleFor()))
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
    let alive = 0
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.pLife[i] <= 0) continue
      any = true
      alive++
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
    this.particleAlive = alive
    // CHROMANCER #55: at high concurrent-particle density, pull the shared
    // material's opacity down a touch — many additive bursts overlapping at
    // full opacity compose into a bright wall; slightly dimmer bursts still
    // read as punchy flashes (untouched at low/normal density — the single-
    // reaction punch is never nerfed when the board is calm).
    const densOpacity = alive > 550 ? 0.62 : alive > 320 ? 0.78 : 0.95
    if (this.particlesMat.opacity !== densOpacity) this.particlesMat.opacity = densOpacity
    if (any) {
      ;(this.particles.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
      // colours are written per-emit; flag them too or every burst renders black
      ;(this.particles.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true
    }
  }

  // ---------------------------------------------------------------- camera
  // Fit the DEFAULT framing (whole board + path + base, nothing cut off) for the
  // current aspect, then adopt it — unless the player owns the camera, in which
  // case only the clamps are refreshed and their pose is preserved.
  private frameCamera(): void {
    const aspect = window.innerWidth / Math.max(1, window.innerHeight)
    this.camera.aspect = aspect
    this.camera.updateProjectionMatrix()
    if (this.cineActive) return // cine owns the pose
    // fit the board: horizontal half-extent 4.5, depth half-extent 5.5 (+margin)
    const halfX = 5.3
    const halfZ = 5.8
    const vFov = this.camera.fov * Math.PI / 180
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect)
    const dForWidth = halfX / Math.tan(hFov / 2)
    // depth is foreshortened by the tilt; approximate its screen span
    const dForDepth = (halfZ * Math.sin(DEF_PITCH) + 1.5) / Math.tan(vFov / 2)
    this.camDefDist = Math.min(34, Math.max(13, Math.max(dForWidth, dForDepth) + 1.5))
    if (this.userCam) { this.clampGoal(); return }
    // On tall screens the bottom action bar eats the lower band, so bias the
    // look target toward +Z — the board rides UP into the un-occluded space
    // instead of hiding its bottom edge behind the dock.
    const tz0 = aspect < 0.7 ? 2.3 : aspect < 1 ? 1.1 : -0.35
    this.camGoal.yaw = 0
    this.camGoal.pitch = DEF_PITCH
    this.camGoal.dist = this.camDefDist
    this.camGoal.tx = 0
    this.camGoal.tz = tz0
  }

  private clampGoal(): void {
    const g = this.camGoal
    g.pitch = Math.min(PITCH_MAX, Math.max(PITCH_MIN, g.pitch))
    const dMax = Math.min(CAM_DIST_MAX, this.camDefDist * 1.45)
    g.dist = Math.min(dMax, Math.max(CAM_DIST_MIN, g.dist))
    g.tx = Math.min(PAN_X, Math.max(-PAN_X, g.tx))
    g.tz = Math.min(PAN_Z, Math.max(-PAN_Z, g.tz))
  }

  // ---- user camera controls (the gesture layer calls these; cine ignores them)
  orbitBy(dYaw: number, dPitch: number): void {
    if (this.cineActive) return
    this.userCam = true
    this.camGoal.yaw += dYaw
    this.camGoal.pitch += dPitch
    this.clampGoal()
  }

  /** Pan by screen pixels — the world slides ~1:1 under the finger at any zoom. */
  panBy(dxPx: number, dyPx: number): void {
    if (this.cineActive) return
    this.userCam = true
    const h = Math.max(1, window.innerHeight)
    const wpp = 2 * this.camCur.dist * Math.tan(this.camera.fov * Math.PI / 360) / h
    // vertical screen travel is foreshortened by the tilt — compensate
    const dyW = dyPx * wpp / Math.max(0.5, Math.sin(this.camCur.pitch))
    const dxW = dxPx * wpp
    const sy = Math.sin(this.camCur.yaw)
    const cy = Math.cos(this.camCur.yaw)
    // screen-right on the ground = (cy, -sy); screen-down = (sy, cy)
    this.camGoal.tx -= dxW * cy + dyW * sy
    this.camGoal.tz -= dxW * -sy + dyW * cy
    this.clampGoal()
  }

  zoomBy(factor: number): void {
    if (this.cineActive) return
    this.userCam = true
    this.camGoal.dist *= factor
    this.clampGoal()
  }

  /** Glide back to the sensible center-safe default framing. */
  resetView(): void {
    if (this.cineActive) return
    this.userCam = false
    this.frameCamera()
    if (!this.motionOk) Object.assign(this.camCur, this.camGoal) // reduce-motion: snap
  }

  /** True once the player has panned/zoomed/rotated away from the default. */
  viewCustomized(): boolean {
    return this.userCam
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
      // leaving cine: seed the orbit rig from the current cine pose so the
      // camera GLIDES home to the default framing instead of teleporting
      const p = this.cineFrom && this.cineDest ? this.evalCine() : null
      this.cineFrom = this.cineDest = null
      this.userCam = false
      this.frameCamera()
      if (p) {
        this.camCur.yaw = p.yaw * Math.PI / 180
        this.camCur.pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, p.pitch * Math.PI / 180))
        this.camCur.dist = p.dist
        this.camCur.tx = wx(p.x)
        this.camCur.tz = wz(p.y)
      }
      if (!this.motionOk) Object.assign(this.camCur, this.camGoal)
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
    // Clearing the tile marker also retires the placement range ring — every
    // build/deploy/move exit path already routes through setHover(null,...).
    if (!cell) { this.hoverMesh.visible = false; this.placeRing.visible = false; this.placeDisc.visible = false; return }
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
    const slot: EnemySlot = {
      kind: e.kind, group, body, bodyMat, hpBg, hpFill, hpFillMat, shield, shadow, baseScale: 1, hoverY, spawnT: 0, hitT: 0, radius: r,
      prevX: e.x, prevY: e.y, yaw: 0, walkT: Math.random() * Math.PI * 2, phase: Math.random() * Math.PI * 2, animSpeed: 1, burning: false, emberAcc: 0, streakAcc: 0, isAir: !!def.isAir,
      auraPip: null, auraPipMat: null, crown, crownMat,
      art: null, artMat: null, artH: 0, accentGlow: null, accentGlowMat: null, accent: def.accent, boss: !!def.boss, castWarned: false, prevShield: e.shieldMax,
    }

    // Swap the primitive body for the painted "greyling" billboard once its PNG
    // decodes (cached per kind — first battle pays one decode, rest resolve
    // instantly). Load/miss → keep the mesh so nothing ever breaks. The slot pool
    // is keyed by kind, so this attaches at most once and survives reuse.
    enemyArt(e.kind).then((art) => {
      if (!art || this.disposed || slot.art) return
      const artH = r * (def.boss ? 3.6 : 2.8) // boss kinds read as set-pieces
      const w = artH * art.aspect
      const mat = new THREE.SpriteMaterial({ map: art.tex, transparent: true, alphaTest: 0.04, depthWrite: false })
      const sprite = new THREE.Sprite(mat)
      sprite.scale.set(w, artH, 1)
      // ground units plant their feet on the tile top (group sits at GROUND+r, so
      // the ground plane is local −r); flyers keep hovering near the body centre.
      const posY = def.isAir ? artH * 0.12 : artH / 2 - r
      sprite.position.y = posY
      sprite.userData.y0 = posY
      sprite.userData.w = w
      sprite.userData.h = artH
      group.add(sprite)
      slot.art = sprite
      slot.artMat = mat
      slot.artH = artH
      slot.accent = art.accent // bright signature glow (not def.accent's dark outline)
      body.visible = false

      // signature accent glow: a soft additive halo in the archetype's Greying
      // colour so roles read at a glance. Skipped for swarm — dense clusters, and
      // the painted silhouette already carries the yellow read.
      if (e.kind !== 'swarm') {
        // saturated signature BACKLIGHT: the greyling body stays ashen (artMat is
        // white), but this additive halo behind it burns in the archetype's colour
        // so it reads ALIVE + menacing against the desaturated ground. Pulsed per
        // frame (threat-keyed) in updateEnemySlot; frozen mid-value on reduce-motion.
        const gmat = new THREE.SpriteMaterial({ map: this.enemyGlowTexture(), color: art.accent, transparent: true, opacity: 0.52, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
        const glow = new THREE.Sprite(gmat)
        const gs = Math.max(w, artH) * (def.boss ? 1.7 : 1.55)
        glow.scale.set(gs, gs, 1)
        glow.position.y = posY
        glow.renderOrder = -1 // draw behind the billboard so it blooms around the edges
        group.add(glow)
        slot.accentGlow = glow
        slot.accentGlowMat = gmat
      }

      // lift the HP bar / crown clear of the taller token
      const barY = posY + artH / 2 + 0.3
      hpBg.position.y = barY
      hpFill.position.y = barY
      if (crown) crown.position.y = posY + artH / 2 + 0.05
    })
    return slot
  }

  // shared soft radial-glow texture for enemy accent halos (one upload, reused)
  private enemyGlowTex: THREE.CanvasTexture | null = null
  private enemyGlowTexture(): THREE.CanvasTexture {
    if (this.enemyGlowTex) return this.enemyGlowTex
    const c = document.createElement('canvas')
    c.width = 64
    c.height = 64
    const g = c.getContext('2d')!
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
    grad.addColorStop(0, 'rgba(255,255,255,0.9)')
    grad.addColorStop(0.45, 'rgba(255,255,255,0.35)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, 64, 64)
    this.enemyGlowTex = new THREE.CanvasTexture(c)
    this.disposables.push(this.enemyGlowTex)
    return this.enemyGlowTex
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
    // TIER GLOW-UP: the element core burns brighter and reaches farther each tier
    // (T1→T2→T3), so an upgrade lands as a visible surge of light, and the two T3
    // branches over-drive it hardest. Base is folded into the fire/pulse in sync.
    const tier = Math.min(t.level, 3)
    slot.glowBase = 0.5 + tier * 0.42 + (t.level >= 3 ? 0.45 : 0)
    slot.glow.distance = 4 + tier * 1.3 + (t.level >= 3 ? 1.4 : 0)
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
      ring, ringMat, glow, glowBase: 0.5, level: t.level, branch: t.branch, kind: t.kind, fireT: 0,
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
    // upgrade flourish: scale-punch + sparkle fountain + glow spike (via pulseT).
    // A T3 branch fork is the grandest beat — punch harder and kick the camera so
    // the new silhouette lands as a real GLOW-UP, not a quiet swap.
    const branchPick = t.level >= 3
    slot.pulseT = branchPick ? 0.62 : 0.55
    const pc = towerPalette(t.kind).color
    this.emitParticles(wx(t.x), GROUND + 1.1, wz(t.y), pc, branchPick ? 30 : 22, 2.8)
    this.emitParticles(wx(t.x), GROUND + 1.35, wz(t.y), 0xffffff, branchPick ? 14 : 9, 2.2)
    if (branchPick) this.pushIn(0.4)
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
      case 'bloom': g = new THREE.ConeGeometry(0.11, 0.3, 6); break
      case 'radiant': g = new THREE.TetrahedronGeometry(0.17, 0); break
      case 'shade': g = new THREE.OctahedronGeometry(0.15, 1); break
      default: g = new THREE.SphereGeometry(0.14, 10, 8)
    }
    this.projGeoCache.set(kind, g)
    this.disposables.push(g)
    return g
  }

  private static readonly TRAIL_COLOR: Record<string, number> = {
    flame: 0xffa04c, frost: 0xbfeaff, storm: 0xffe97a, arcane: 0xd6a6ff, cannon: 0x9aa0b8,
    bloom: 0x9fe066, radiant: 0xffe27a, shade: 0xc9a6ff,
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
        s.walkT = Math.random() * Math.PI * 2 // fresh gait phase (pool reuse)
        s.phase = Math.random() * Math.PI * 2
        s.burning = false
        s.emberAcc = 0
        s.prevShield = e.shieldMax // fresh spawn: arm the Titan shield-break beat
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

    // painted billboard shares the same status read via a colour multiply (works
    // under reduce-motion — it's tint, not motion). Frozen/stunned freezes the
    // walk pose too (animSpeed 0 halts walkT), keeping the frozen-mid-gesture trick.
    if (s.artMat) {
      if (e.hitFlash > 0) s.artMat.color.setHex(0xffffff)
      else if (stunned) s.artMat.color.setHex(0x9fd8ff)
      else if (slowed) s.artMat.color.setHex(0xc2ecff)
      else if (burning) s.artMat.color.setHex(0xffc39a)
      else s.artMat.color.setHex(0xffffff)
    }

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

    // Keeper crown: retint per Keeper (shared pool), slow precession, phase pulse.
    // Match the accent glow to the same realm colour so the six Keepers read apart
    // despite sharing the crimson 'elite' sprite.
    s.castWarned = e.castWarned
    if (e.kind === 'keeper') s.accent = e.def.accent
    if (s.crown && s.crownMat) {
      s.crownMat.color.setHex(e.def.accent)
      s.crown.rotation.z = clock * 0.9
      const pulse = e.castWarned ? 0.55 + 0.45 * Math.sin(clock * 14) : 0.85
      s.crownMat.opacity = pulse
    }

    // signature BACKLIGHT breath: the halo swells with threat — a fast, hard pulse
    // when a caster is winding up, a quicker beat when primed (a reaction is one hit
    // away), a slow menace otherwise. Body stays grey; only this glow is chromatic.
    if (s.accentGlowMat) {
      const base = s.boss ? 0.62 : 0.5
      if (this.motionOk) {
        const spd = e.castWarned ? 9 : primed ? 5 : 2.3
        const amp = e.castWarned ? 0.3 : primed ? 0.2 : 0.13
        let op = base + Math.sin(clock * spd + s.phase) * amp
        if (e.hitFlash > 0) op += 0.35 // struck → a bright flare of its own colour
        s.accentGlowMat.opacity = Math.min(1, op)
      } else {
        s.accentGlowMat.opacity = base
      }
    }

    // HP bar (centred plane; scales symmetrically — clean at this size)
    const ratio = Math.max(0, Math.min(1, e.hp / Math.max(1, e.maxHp)))
    s.hpFill.scale.x = Math.max(0.001, ratio)
    s.hpFillMat.color.setHex(ratio > 0.5 ? 0x36e05a : ratio > 0.25 ? 0xffd54a : 0xff5b7a)
    if (s.shield) {
      const sm = s.shield.material as THREE.MeshBasicMaterial
      sm.opacity = e.shield > 0 ? 0.22 : 0
    }

    // Morose Titan mid-fight phase: the frame its shield shatters is a set-piece
    // beat — a real arc of entrance → shield-break → screen-filling finale. Pure
    // view read of e.shield (no sim change); reduce-motion auto-handled by shake/push.
    if (s.boss && e.kind === 'boss') {
      if (s.prevShield > 0 && e.shield <= 0) this.fxKeeperPhase(e.x, e.y, e.def.color, e.def.accent)
      s.prevShield = e.shield
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
      s.glow.intensity = greyed ? 0.05 : s.glowBase + (t.fireFlash > 0 ? 1.6 : 0) + s.pulseT * 3

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
      wyrm: null, wyrmMat: null, wyrmPhase: (h.id * 1.7) % (Math.PI * 2),
      phase: (h.id * 2.399963) % (Math.PI * 2), artBaseW: 0.9,
      castUntil: 0, hurtUntil: 0, awakenUntil: 0,
      atkUntil: 0, atkDx: 0, atkDz: 0, prevFire: 0,
    }

    // bonded Chromatic Wyrm: a painted billboard that circles above the hero.
    // Async (first battle decodes once; cached thereafter). Missing art → no
    // companion sprite, but the sim breath/aura still runs (graceful fallback).
    if (h.wyrm) {
      const wid = h.wyrm.wyrm.id
      wyrmCutout(wid).then((cut) => {
        if (!cut || this.disposed || this.heroViews.get(h.id) !== slot) return
        let tex = wyrmArtTexCache.get(wid)
        if (!tex) {
          tex = new THREE.CanvasTexture(cut.canvas)
          tex.colorSpace = THREE.SRGBColorSpace
          tex.anisotropy = 4
          wyrmArtTexCache.set(wid, tex)
        }
        const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, alphaTest: 0.05, depthWrite: false })
        const sprite = new THREE.Sprite(mat)
        const wAspect = Math.max(0.4, cut.aspect)
        sprite.scale.set(WYRM_ART_H * wAspect, WYRM_ART_H, 1)
        g.add(sprite)
        slot.wyrm = sprite
        slot.wyrmMat = mat
      })
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
      slot.artBaseW = HERO_ART_H * cut.aspect
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
      s.prevFire = h.fireFlash // keep the edge-detector in sync so un-greying can't false-fire
      return
    }
    if (s.artMat) s.artMat.color.setHex(s.artTint)
    s.bodyMat.color.setHex(s.color)
    s.bodyMat.emissive.setHex(s.color)
    const flashing = h.fireFlash > 0
    // BASIC-ATTACK LUNGE: the sim bumps fireFlash to 0.12 the instant a hero swings.
    // Catch that rising edge → thrust toward the target (world dir from aimAngle:
    // worldX∝simX, worldZ∝simY, so dir = (cos,sin) of aimAngle). Cast/signature use
    // their own pose (castUntil), so don't lunge while a cast pose is playing.
    if (h.fireFlash > s.prevFire + 1e-4 && s.castUntil <= this.clockT) {
      s.atkUntil = this.clockT + HERO_ATK_DUR
      s.atkDx = Math.cos(h.aimAngle)
      s.atkDz = Math.sin(h.aimAngle)
    }
    s.prevFire = h.fireFlash
    s.bodyMat.emissiveIntensity = flashing ? 1.2 : 0.5
    s.glow.intensity = 0.9 + (flashing ? 1.6 : 0)
    // temporary Holy-Nova buff → brighten the crystal
    const buffed = h.buffUntil > this.sim.clock
    s.orbMat.emissiveIntensity = buffed ? 2.6 : 1.5

    // the bonded Wyrm circles above the hero; it flares as its breath nears.
    if (s.wyrm) {
      const t = this.clockT * 0.9 + s.wyrmPhase
      const orbitR = 1.05
      s.wyrm.position.set(Math.cos(t) * orbitR, WYRM_ART_H * 0.5 + 1.15 + Math.sin(t * 1.6) * 0.12, Math.sin(t) * orbitR * 0.5)
      // wing-beat pulse; brighten just before a breath fires (cd near zero)
      const charge = h.wyrm ? Math.max(0, 1 - h.wyrmBreathCd / Math.max(0.5, h.wyrm.breathCd)) : 0
      if (s.wyrmMat) s.wyrmMat.color.setScalar(1 + charge * 0.4)
      const beat = this.motionOk ? 1 + Math.sin(this.clockT * 8 + s.wyrmPhase) * 0.05 : 1
      s.wyrm.scale.y = WYRM_ART_H * beat
    }

    this.animateHeroPresence(s, buffed)
  }

  // Make the deployed hero feel ALIVE on the board: idle breathing + weight-shift
  // sway, a CAST lunge on spell/signature, a HURT recoil, and a level-3 AWAKENING
  // rise. Drives the painted billboard when it has landed, else the low-poly
  // fallback figure (so pyra / any keying failure still animates — no statues).
  // Every beat degrades to a still, readable pose under reduce-motion.
  private animateHeroPresence(s: HeroSlot, buffed: boolean): void {
    const t = this.clockT
    const usingArt = !!s.art && s.art.visible
    const body: THREE.Object3D = usingArt ? s.art! : s.figure
    const baseY = usingArt ? (s.art!.userData.y0 as number) : 0
    const baseW = usingArt ? s.artBaseW : 1
    const baseH = usingArt ? HERO_ART_H : 1

    // pose envelopes (1 at trigger → 0 when the window closes); a soft ease-out
    const env = (until: number, dur: number): number => (until > t ? Math.max(0, Math.min(1, (until - t) / dur)) : 0)
    const cast = env(s.castUntil, CAST_DUR)
    const hurt = env(s.hurtUntil, HURT_DUR)
    const awaken = env(s.awakenUntil, AWAKEN_DUR)
    const atk = env(s.atkUntil, HERO_ATK_DUR)

    let dy = 0, sx = 1, sy = 1, tilt = 0, glow = buffed ? 0.15 : 0
    let lx = 0, lz = 0 // world-space lunge offset toward the target (basic attack)

    if (this.motionOk) {
      // idle: a slow breath (vertical squash+lift) plus an even slower weight shift
      const breath = Math.sin(t * 1.7 + s.phase)
      const shift = Math.sin(t * 0.9 + s.phase * 1.3)
      dy += 0.02 + breath * 0.03
      sy += breath * 0.02
      sx -= breath * 0.012
      tilt += shift * 0.05
      // BASIC ATTACK: a directional THRUST toward the target — snaps out fast, eases
      // back. Suppressed while a CAST pose plays so the two never blur together.
      if (atk > 0 && cast <= 0) {
        const u = 1 - atk // 0→1 through the window
        const push = u < 0.35 ? u / 0.35 : 1 - (u - 0.35) / 0.65 // fast out · slow settle
        const amp = usingArt ? 0.22 : 0.18
        lx = s.atkDx * push * amp
        lz = s.atkDz * push * amp
        dy -= push * 0.03 // slight forward dip into the swing
        tilt += push * 0.06 * (s.atkDx >= 0 ? 1 : -1)
      }
      // CAST: a distinct pose — anticipatory PULL-BACK/crouch, then a proud SCALE-UP
      // bloom (kept apart from the flat basic-attack thrust above).
      if (cast > 0) {
        const u = 1 - cast
        const anticip = Math.max(0, 1 - u * 4) // strong in the first quarter
        const bloom = Math.sin(Math.min(1, u * 1.15) * Math.PI) // swell peaks late
        dy += -anticip * 0.05 + bloom * 0.15
        sy += -anticip * 0.05 + bloom * 0.14
        sx += anticip * 0.06 - bloom * 0.02
        tilt += anticip * 0.10 * (s.phase > Math.PI ? -1 : 1)
      }
      // HURT: a sharp recoil + high-frequency shudder that settles
      if (hurt > 0) {
        dy -= hurt * 0.05
        tilt -= Math.sin(t * 40) * hurt * 0.14
        sx += hurt * 0.05
        sy -= hurt * 0.04
      }
      // AWAKEN: a proud rise + swell
      if (awaken > 0) {
        const rise = Math.sin(awaken * Math.PI)
        dy += rise * 0.28
        sy += rise * 0.12
        sx += rise * 0.06
      }
    }
    // brightness reads even when motion is off, so cast/hurt/awaken never go silent
    glow += cast * 0.5 + awaken * 0.7
    const flash = hurt

    body.position.y = baseY + dy
    body.position.x = lx
    body.position.z = lz
    body.scale.set(baseW * sx, baseH * sy, 1)
    if (usingArt && s.artMat) {
      s.artMat.rotation = tilt
      // tint: base skin dye, pushed brighter on cast/awaken, reddened on hurt
      const g2 = Math.max(0, 1 - flash * 0.5)
      const b2 = Math.max(0, 1 - flash * 0.6)
      s.artMat.color.setRGB((1 + glow), g2 * (1 + glow * 0.7), b2 * (1 + glow * 0.7))
      // CAST: bloom the flash toward the hero's SIGNATURE colour — a coloured flash,
      // not a white one, so a signature reads distinctly (survives reduce-motion).
      if (cast > 0.01) {
        _sigCol.setHex(s.color)
        s.artMat.color.lerp(_sigCol, Math.min(0.55, cast * 0.55))
        s.artMat.color.addScalar(cast * 0.3) // keep it bright — it's a flash
      }
      // fold in the equipped dye by multiplying — keeps skins tinted while idle
      if (s.artTint !== 0xffffff && glow < 0.01 && flash < 0.01 && cast < 0.01) s.artMat.color.setHex(s.artTint)
    } else {
      s.figure.rotation.z = tilt
    }
    if (glow > 0.01) s.glow.intensity = Math.max(s.glow.intensity, 0.9 + glow * 1.4)
  }

  /** CAST lunge on a hero's active spell (called with the SimHero slot id). */
  heroCastPose(slotId: number): void {
    const s = this.heroViews.get(slotId)
    if (s) s.castUntil = this.clockT + CAST_DUR
  }

  /** A hero's SIGNATURE detonated: element flourish (ring + sparks) + a cast pop. */
  pulseHeroSig(slotId: number, simX: number, simY: number, color: number): void {
    const s = this.heroViews.get(slotId)
    if (s) s.castUntil = Math.max(s.castUntil, this.clockT + CAST_DUR * 0.7)
    if (!this.motionOk) return
    this.pushRing(simX, simY, TILE_PX * 0.9, color, 0.7)
    this.emitParticles(wx(simX), 0.9, wz(simY), color, 10, 2.6)
  }

  /** HURT recoil for every fielded hero (a leak reached the base). */
  heroHurtAll(): void {
    for (const [, s] of this.heroViews) s.hurtUntil = this.clockT + HURT_DUR
  }

  /** AWAKENING flourish on a freshly-deployed level-3 hero (signature awake). */
  heroAwakenPose(slotId: number, simX: number, simY: number, color: number): void {
    const s = this.heroViews.get(slotId)
    if (s) s.awakenUntil = this.clockT + AWAKEN_DUR
    if (!this.motionOk) return
    this.pushRing(simX, simY, TILE_PX * 1.3, color, 0.9)
    this.emitParticles(wx(simX), 1.0, wz(simY), color, 22, 3.4)
    this.emitParticles(wx(simX), 1.0, wz(simY), 0xffffff, 8, 2.2)
  }

  private disposeHeroSlot(s: HeroSlot): void {
    s.bodyMat.dispose()
    s.orbMat.dispose()
    s.ringMat.dispose()
    s.badgeMat.dispose()
    s.badgeTex.dispose()
    s.artMat?.dispose() // material only — the cutout texture is cached for reuse
    s.wyrmMat?.dispose() // Wyrm billboard material (shared texture stays cached)
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
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: alpha, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
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

  // ENEMY ATTACK ON THE BASE — an enemy vanishes the instant it reaches the
  // Wellspring (it leaks and is gone), so the "strike" is a view-only ghost: a
  // painted double of the breaching kind winds up just outside the base, LUNGES
  // in to strike, then recoils and fades. Frame-locked with the leak SFX/shake
  // (both fire on the same 'leak' event). No more sprites that just touch the end.
  // View-only; reduce-motion skips the lunge (the shake/flash carry the beat).
  enemyStrike(baseSimX: number, baseSimY: number, kind: EnemyKind, boss: boolean): void {
    if (!this.motionOk) return
    const art = enemyArtReady(kind)
    if (!art) return
    // approach direction: portal→base (cheap, path-agnostic). `dir` points OUT of
    // the base toward where the enemy came from, so the ghost stages there.
    const portal = this.sim.waypointFor('portal')
    let dx = baseSimX - portal.x
    let dz = baseSimY - portal.y
    const len = Math.hypot(dx, dz) || 1
    // world dir out of the base toward the approach (negate: from base back to portal)
    dx = -dx / len
    dz = -dz / len
    const reach = boss ? 1.1 : 0.75
    const h = boss ? 1.5 : 0.95
    const gm = new THREE.SpriteMaterial({ map: art.tex, transparent: true, opacity: 0.98, depthWrite: false, toneMapped: false })
    const ghost = new THREE.Sprite(gm)
    ghost.userData.w0 = h * art.aspect
    ghost.userData.h0 = h
    ghost.userData.bx = wx(baseSimX)
    ghost.userData.bz = wz(baseSimY)
    ghost.userData.by = GROUND + h * 0.5
    ghost.userData.dx = dx
    ghost.userData.dz = dz
    ghost.userData.reach = reach
    ghost.scale.set(h * art.aspect, h, 1)
    ghost.position.set(wx(baseSimX) + dx * reach, GROUND + h * 0.5, wz(baseSimY) + dz * reach)
    this.scene.add(ghost)
    this.transients.push({ obj: ghost, mat: gm, t: 0, life: boss ? 0.5 : 0.4, kind: 'strike', fade: false })
  }

  fxDeath(simX: number, simY: number, color: number, boss: boolean, kind?: EnemyKind, elite = false): void {
    // Three kill tiers so the burst reads the target's weight: a grunt pops, an
    // affixed ELITE gets a fatter soul-burst + its own shockwave ring, the Titan
    // gets the screen-filling finale below.
    this.emitParticles(wx(simX), 0.7, wz(simY), color, boss ? 40 : elite ? 24 : 14, boss ? 4 : elite ? 3.4 : 3)
    this.emitParticles(wx(simX), 0.7, wz(simY), 0xffffff, boss ? 14 : elite ? 8 : 4, boss ? 3 : elite ? 2.6 : 2.2)
    // white flash sphere
    const geo = new THREE.SphereGeometry(0.3, 10, 8)
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(wx(simX), 0.7, wz(simY))
    this.scene.add(mesh)
    this.transients.push({ obj: mesh, mat, geo, t: 0, life: 0.3, kind: 'flash', baseScale: boss ? 3.5 : 1.8, fade: true })
    // dissolving body ghost: pops up + inflates + fades — the "kill" read. Prefer
    // the painted billboard so the ghost matches the greyling; fall back to the
    // primitive mesh geometry if the art hasn't decoded (or the kind has none).
    const readyArt = kind ? enemyArtReady(kind) : null
    if (readyArt) {
      const gm = new THREE.SpriteMaterial({ map: readyArt.tex, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
      const ghost = new THREE.Sprite(gm)
      const h = (boss ? 1.3 : 0.7) // world-height seed; the 'pop' handler inflates it
      ghost.userData.w0 = h * readyArt.aspect
      ghost.userData.h0 = h
      ghost.scale.set(h * readyArt.aspect, h, 1)
      ghost.position.set(wx(simX), 0.55, wz(simY))
      this.scene.add(ghost)
      this.transients.push({ obj: ghost, mat: gm, t: 0, life: boss ? 0.55 : 0.36, kind: 'pop', baseScale: boss ? 1.9 : 1.4, fade: true, vy: boss ? 2.4 : 1.8 })
    } else {
      const bodyGeo = kind ? this.enemyGeo.get(kind) : undefined
      if (bodyGeo) {
        const gm = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false })
        const ghost = new THREE.Mesh(bodyGeo, gm) // shares pooled geometry — never disposed here
        ghost.position.set(wx(simX), 0.55, wz(simY))
        this.scene.add(ghost)
        this.transients.push({ obj: ghost, mat: gm, t: 0, life: boss ? 0.5 : 0.34, kind: 'pop', baseScale: boss ? 2 : 1.45, fade: true, vy: boss ? 2.4 : 1.8 })
      }
    }
    // ground shockwave on every kill; the Titan gets a screen-filling finale.
    this.pushRing(simX, simY, boss ? 120 : elite ? 82 : 55, color, boss ? 0.9 : elite ? 0.7 : 0.5)
    if (!boss && elite) {
      // elite pop: a bright soul-flare + a firmer camera bite (short of the boss set-piece)
      this.spellFlash(simX, simY, 90, 0xfff2ff, 1.6)
      this.shake(0.09)
      this.pushIn(0.4)
    }
    if (boss) {
      // stacked shock rings + a bright flare + a hard camera bite — a set-piece end
      this.pushRing(simX, simY, 210, 0xffffff, 0.85)
      this.pushRing(simX, simY, 300, color, 0.7)
      this.spellFlash(simX, simY, 220, 0xfff2ff, 3.2)
      this.emitParticles(wx(simX), 0.7, wz(simY), 0xffffff, 26, 5)
      this.shake(0.26)
      this.pushIn(1.1)
      this.bloomPulse(0.5)
    } else this.shake(0.035)
  }

  // ---- Corrupted Keeper spectacle: view-only beats keyed off the sim's keeper
  // events (reveal/telegraph/cast/phase/redeemed). No sim state invented — the
  // shake/pushIn/bloomPulse helpers already no-op under reduce-motion, and the
  // rings/particles stay subtle + additive so the fight reads instead of blinds.
  fxKeeperReveal(simX: number, simY: number, color: number, accent: number): void {
    this.pushRing(simX, simY, 90, accent, 0.9)
    this.pushRing(simX, simY, 150, color, 0.65)
    this.spellFlash(simX, simY, 80, accent, 2.4)
    for (let i = 0; i < 3; i++) this.emitParticles(wx(simX), 0.6 + i * 0.5, wz(simY), accent, 8, 3)
    this.pushIn(0.9)
    this.shake(0.08)
    this.bloomPulse(0.35)
  }

  fxKeeperTelegraph(simX: number, simY: number, radiusPx: number, accent: number): void {
    // a warning footprint at the cast radius so the incoming attack is readable
    this.pushRing(simX, simY, Math.max(70, radiusPx), accent, 0.85)
    this.emitParticles(wx(simX), 0.7, wz(simY), accent, 6, 2)
  }

  fxKeeperCast(simX: number, simY: number, radiusPx: number, color: number, accent: number): void {
    // the telegraphed attack lands — two-tone shock + flash + a measured bite
    const r = Math.max(70, radiusPx)
    this.pushRing(simX, simY, r, accent, 0.95)
    this.pushRing(simX, simY, r * 1.4, color, 0.6)
    this.spellFlash(simX, simY, r, color, 1.9)
    this.emitParticles(wx(simX), 0.7, wz(simY), accent, 18, 4)
    this.emitParticles(wx(simX), 0.7, wz(simY), 0xffffff, 6, 3)
    this.shake(0.12)
    this.pushIn(0.5)
  }

  fxKeeperPhase(simX: number, simY: number, color: number, accent: number): void {
    // phase break — the grey cracks: hard bite, bloom, expanding shock, motes
    this.pushRing(simX, simY, 130, 0xffffff, 0.85)
    this.pushRing(simX, simY, 190, accent, 0.55)
    this.spellFlash(simX, simY, 110, accent, 2.6)
    this.emitParticles(wx(simX), 0.8, wz(simY), accent, 22, 4.5)
    this.shake(0.2)
    this.pushIn(0.9)
    this.bloomPulse(0.4)
  }

  fxKeeperRedeem(simX: number, simY: number, color: number, accent: number): void {
    // the payoff — the colour returns in a warm swell of the true palette
    this.pushRing(simX, simY, 160, accent, 0.9)
    this.pushRing(simX, simY, 240, color, 0.55)
    this.spellFlash(simX, simY, 140, 0xfff2ff, 2.6)
    for (let i = 0; i < 3; i++) this.emitParticles(wx(simX), 0.7 + i * 0.4, wz(simY), accent, 14, 3.5)
    this.emitParticles(wx(simX), 0.8, wz(simY), color, 16, 4)
    this.pushIn(0.7)
    this.bloomPulse(0.5)
  }

  fxMuzzle(simX: number, simY: number, tsimX: number, tsimY: number, color: number, kind: TowerKind): void {
    this.emitParticles(wx(simX), 0.95, wz(simY), color, 4, 1.6)
    if (kind === 'arcane' || kind === 'flame' || kind === 'bloom' || kind === 'radiant') this.fxBeam(simX, simY, tsimX, tsimY, color, 0.16)
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
  // The `key` (optional) picks a lingering ground-decal flavour; the reaction's own
  // two colours drive a richer 4-stop particle ramp so each of the nine reads chromatic.
  // `mag` (~0.5 light · 0.75 med · 1.0 big) scales the whole detonation so a big AoE
  // reaction (FLASHOVER / SHATTER / ECLIPSE) lands harder than a light mark (AMPLIFY):
  // more sparks, a second shock ring, a stronger flash + camera bite. Defaults to 1
  // so fusion / wyrm-ult calls stay full-force.
  fxReaction(simX: number, simY: number, radiusPx: number, color: number, color2: number, key?: string, mag = 1): void {
    const r = Math.max(60, radiusPx || 70)
    const m = Math.max(0.4, mag)
    this.pushRing(simX, simY, r + 30, color, 0.95)
    if (m >= 0.85) this.pushRing(simX, simY, r + 74, color2, 0.55) // big reactions: a second, wider shock ring
    this.spellFlash(simX, simY, r, color2, 1.6 * (0.82 + 0.28 * m))
    this.spellFlash(simX, simY, r * 0.62, color, 1.05 * (0.82 + 0.28 * m)) // inner element-keyed bloom core
    const x = wx(simX)
    const z = wz(simY)
    // 4-stop ramp: primary → blended mid → secondary → white spark core
    _reactA.setHex(color); _reactB.setHex(color2)
    const mid = _reactA.lerp(_reactB, 0.5).getHex() // _reactA now holds the blend
    this.emitParticles(x, 0.8, z, color, Math.round(14 + 14 * m), 4.4)
    this.emitParticles(x, 0.86, z, mid, Math.round(8 + 8 * m), 3.7)
    this.emitParticles(x, 0.8, z, color2, Math.round(9 + 9 * m), 3.3)
    this.emitParticles(x, 0.92, z, 0xffffff, Math.round(5 + 5 * m), 2.6)
    // lingering colored ground decal — the "colour + action" beat, and safe against
    // the recessive-land discipline because it always fades back out.
    this.fxGroundDecal(simX, simY, r, color, color2, key)
    this.shake(0.055 + 0.055 * m)
    this.pushIn(0.22 + 0.26 * m)
    // big reaction burst → briefly fade the backdrop's OWN ambient particles so the
    // gameplay FX own the frame (dynamic particle budget, not a fixed one)
    this.atmoReactFade = 1
  }

  // Colored ground decal left by a reaction (scorch / frost / spark / bloom). Reuses
  // the shared soft-radial texture + the shared blob geometry (NO per-decal geometry
  // alloc); routed through the transients pool so it auto-disposes. Under reduce-motion
  // it still fires (it's a fade, not camera violence — matches spellFlash/pushRing).
  private static readonly DECAL_FLAVOR: Record<string, 'scorch' | 'frost' | 'spark' | 'bloom'> = {
    thermal: 'scorch', flashover: 'scorch', wildfire: 'scorch',
    shatter: 'frost',
    overgrow: 'bloom', blight: 'bloom',
    eclipse: 'spark', conduct: 'spark', amplify: 'spark',
  }
  private fxGroundDecal(simX: number, simY: number, radiusPx: number, color: number, color2: number, key?: string): void {
    const flavor = (key && BattleView3D.DECAL_FLAVOR[key]) || 'spark'
    // scorch/bloom linger + spread; frost holds crisp; spark snaps quick & bright
    const life = flavor === 'scorch' ? 1.5 : flavor === 'bloom' ? 1.35 : flavor === 'frost' ? 1.2 : 0.85
    const peak = flavor === 'spark' ? 0.6 : flavor === 'frost' ? 0.55 : 0.5
    const spread = flavor === 'bloom' || flavor === 'scorch' ? 1.35 : 1.15
    const mat = new THREE.MeshBasicMaterial({
      map: this.enemyGlowTexture(), color, transparent: true, opacity: peak,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    })
    const mesh = new THREE.Mesh(this.blobGeo, mat)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(wx(simX), GROUND + 0.02, wz(simY))
    const rr = Math.max(0.5, wr(radiusPx) * spread)
    mesh.scale.setScalar(rr)
    mesh.renderOrder = -1 // sit under the units/particles so it reads as ground
    this.scene.add(mesh)
    this.transients.push({ obj: mesh, mat, t: 0, life, kind: 'decal', baseScale: rr, op0: peak })
    // frost/bloom get a smaller two-tone inner heart in the secondary colour
    if ((flavor === 'frost' || flavor === 'bloom') && color2 !== color) {
      const mat2 = new THREE.MeshBasicMaterial({
        map: this.enemyGlowTexture(), color: color2, transparent: true, opacity: peak,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      })
      const m2 = new THREE.Mesh(this.blobGeo, mat2)
      m2.rotation.x = -Math.PI / 2
      m2.position.set(wx(simX), GROUND + 0.025, wz(simY))
      m2.scale.setScalar(rr * 0.55)
      m2.renderOrder = -1
      this.scene.add(m2)
      this.transients.push({ obj: m2, mat: mat2, t: 0, life: life * 0.85, kind: 'decal', baseScale: rr * 0.55, op0: peak })
    }
  }

  fxSpell(key: string, simX: number, simY: number, radiusPx: number, color: number): void {
    color = spellColor(key, color) // equipped VFX recolor (paint only)
    if (key === 'meteor') {
      this.pushRing(simX, simY, radiusPx, color, 0.95)
      this.emitParticles(wx(simX), 0.8, wz(simY), 0xffb15c, 60, 5)
      this.emitParticles(wx(simX), 0.8, wz(simY), 0xffd54a, 30, 4)
      const geo = new THREE.SphereGeometry(wr(radiusPx) * 0.6, 12, 10)
      const mat = new THREE.MeshBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
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
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
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
        const infl = (tr.baseScale ?? 1.4) * (0.9 + e * 0.9)
        if (tr.obj instanceof THREE.Sprite) {
          // painted ghost: preserve aspect (uniform setScalar would distort it)
          const w0 = tr.obj.userData.w0 as number
          const h0 = tr.obj.userData.h0 as number
          tr.obj.scale.set(w0 * infl, h0 * infl, 1)
        } else {
          tr.obj.scale.setScalar(infl)
          tr.obj.rotation.y += dt * 3
        }
        tr.obj.position.y += (tr.vy ?? 1.8) * (1 - k) * dt
      } else if (tr.kind === 'strike') {
        // wind-up (draw back) → snappy LUNGE past the base core → recoil out + fade.
        // L = signed distance from the base along the approach dir (+ = outside).
        const ud = tr.obj.userData
        const reach = ud.reach as number
        let L: number
        let op: number
        if (k < 0.25) {
          L = reach * (1 + 0.35 * (k / 0.25)) // anticipation: pull back
          op = 0.98
        } else if (k < 0.5) {
          const u = (k - 0.25) / 0.25
          L = reach * 1.35 - reach * 1.5 * (u * u) // strike: accelerate in, punch past
          op = 0.98
        } else {
          const u = (k - 0.5) / 0.5
          L = -reach * 0.15 + reach * 0.7 * u // recoil out
          op = 0.98 * (1 - u)
        }
        tr.obj.position.set((ud.bx as number) + (ud.dx as number) * L, ud.by as number, (ud.bz as number) + (ud.dz as number) * L)
        ;(tr.mat as THREE.SpriteMaterial).opacity = op
      } else if (tr.kind === 'decal') {
        // colored ground scorch/frost/spark/bloom: a quick grow-in, HOLD near full,
        // then a soft fade to zero. It always vanishes — the land is never repainted.
        const grow = Math.min(1, k / 0.12)
        tr.obj.scale.setScalar((tr.baseScale ?? 1) * (0.8 + 0.2 * grow))
        const hold = 0.4
        const env = k < hold ? 1 : 1 - (k - hold) / (1 - hold)
        ;(tr.mat as THREE.Material & { opacity: number }).opacity = (tr.op0 ?? 0.5) * env
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
      // ease the live orbit pose toward the gesture goal (frame-rate safe)
      const g = this.camGoal
      const c = this.camCur
      const k = 1 - Math.exp(-dt * 9)
      c.yaw += (g.yaw - c.yaw) * k
      c.pitch += (g.pitch - c.pitch) * k
      c.dist += (g.dist - c.dist) * k
      c.tx += (g.tx - c.tx) * k
      c.tz += (g.tz - c.tz) * k
      const cp = Math.cos(c.pitch)
      this.camLook.set(c.tx, LOOK_Y, c.tz)
      this.camBasePos.set(
        c.tx + Math.sin(c.yaw) * cp * c.dist,
        LOOK_Y + Math.sin(c.pitch) * c.dist,
        c.tz + Math.cos(c.yaw) * cp * c.dist,
      )
      // idle drift only while the framing is still ours (and motion is welcome);
      // once the player takes the camera their pose holds perfectly still
      const drift = this.userCam || !this.motionOk ? 0 : 1
      this.camBaseAngle = Math.sin(this.clockT * 0.12) * 0.12 * drift
      const sh = this.shakeAmp
      const jx = sh > 0.001 ? (Math.sin(this.clockT * 91) + Math.sin(this.clockT * 47)) * 0.5 * sh : 0
      const jy = sh > 0.001 ? (Math.sin(this.clockT * 83 + 1.7) + Math.sin(this.clockT * 59)) * 0.5 * sh : 0
      this.tmpV.copy(this.camLook).sub(this.camBasePos).normalize().multiplyScalar(this.pushAmp * 1.4)
      this.camera.position.set(
        this.camBasePos.x + Math.sin(this.camBaseAngle) * 0.9 + this.tmpV.x + jx,
        this.camBasePos.y + Math.sin(this.clockT * 0.31) * 0.12 * drift + this.tmpV.y + jy,
        this.camBasePos.z + this.tmpV.z,
      )
      this.camera.lookAt(this.camLook)
      // fog tracks zoom so the board never drowns in haze when pulled back
      const fog = this.scene.fog as THREE.Fog
      fog.near = c.dist + 6
      fog.far = c.dist + 26
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
      // PER-ARCHETYPE procedural walk cycle — the escalator fix. A foot-plant BOB,
      // a step SQUASH-&-STRETCH (stomp on plant), a rhythmic forward LEAN + slow
      // body SWAY, plus per-type extras (flyer wing-flap, swarm skitter jitter).
      // Tempo (loco.cyc) is baked per kind; animSpeed drags it (slow) or halts it
      // mid-step (frozen) so status still reads. Reduce-motion → a minimal bob only.
      const loco = LOCO[s.kind]
      s.walkT += dt * loco.cyc * s.animSpeed
      // scale reference: bob/shift/jitter are FRACTIONS of the sprite's height so
      // the walk reads identically in screen pixels on a runner or a boss. Mesh
      // fallback (art not yet loaded / missing) borrows a radius-derived height.
      const hgt = s.artH || s.radius * 2.5
      const stride = Math.sin(s.walkT) // −1..1 gait phase (one full stride / 2π)
      const hop = Math.abs(stride) // 0 at foot-plant · 1 at mid-step (2 plants/stride)
      const plantC = hop - 0.5 // <0 near the plant (stomp) · >0 mid-air (stretch)
      const moving = this.motionOk ? s.animSpeed : 0
      // squash & stretch: wide + short on the plant (stomp), tall + narrow mid-step.
      // Screen-vertical, so it sells the step at ANY orbit yaw (unlike horizontal shift).
      const sqAmt = loco.sq * moving
      let sqX = 1 - sqAmt * plantC
      let sqY = 1 + sqAmt * plantC * 2
      let leanRot = 0 // sprite tilt: forward rock + slow sway (billboard, screen-space)
      let offX = 0 // horizontal weight-shift waddle + swarm skitter (bonus cue)
      let bob: number
      if (s.isAir) {
        // flyer: NO ground contact — a smooth hover sine + a fast wing-flap that
        // pulses the silhouette wide/narrow. Wholly reduce-motion gated.
        bob = this.motionOk ? loco.bob * hgt * Math.sin(this.clockT * 2.6 + s.phase) : 0
        if (this.motionOk) {
          const flap = loco.wing * Math.sin(this.clockT * 9 + s.phase)
          sqX += flap
          sqY -= flap * 0.4
          leanRot = loco.lean * Math.sin(this.clockT * 2.2 + s.phase)
        }
      } else if (s.kind === 'healer') {
        // healer: FLOATS — a smooth hover (no foot-plant stomp) with a wide robe
        // sway, so it reads distinct from the trudging walkers around it.
        bob = this.motionOk ? loco.bob * hgt * Math.sin(this.clockT * 2.4 + s.phase) : loco.bob * hgt * 0.12 * hop
        if (this.motionOk) {
          leanRot = loco.sway * Math.sin(this.clockT * 1.5 + s.phase)
          offX = loco.shift * hgt * Math.sin(this.clockT * 1.5 + s.phase)
        }
      } else {
        // grounded WALK: body rises at mid-step, stomps/dips at the foot-plant; weight
        // shifts side-to-side once per stride (waddle); forward lean rocks with the gait.
        // Drag on slow, halt mid-step on frozen. A trace of bob survives reduce-motion
        // so the unit still breathes (task: "minimal bob").
        bob = this.motionOk ? loco.bob * hgt * hop * s.animSpeed : loco.bob * hgt * 0.12 * hop
        if (this.motionOk) {
          leanRot = loco.lean * stride * s.animSpeed + loco.sway * Math.sin(s.walkT * 0.5 + s.phase) * s.animSpeed
          offX = (loco.shift * Math.sin(s.walkT) + loco.jitter * Math.sin(s.walkT * 1.7 + s.phase)) * hgt * s.animSpeed
        }
      }
      let hitK = 0
      if (s.hitT > 0) {
        s.hitT -= dt
        hitK = Math.max(0, s.hitT / 0.14)
        sqX *= 1 + hitK * 0.3
        sqY *= 1 - hitK * 0.22
      }
      if (s.art) {
        // painted billboard: the full gait applied to the sprite's base dims. Facing
        // is camera-locked (that's the billboard read); lean is a screen-space tilt.
        const w = s.art.userData.w as number
        const h = s.art.userData.h as number
        s.art.scale.set(w * sqX, h * sqY, 1)
        const y0 = s.art.userData.y0 as number
        s.art.position.y = y0 + bob
        s.art.position.x = offX
        if (s.artMat) s.artMat.rotation = leanRot
        s.body.position.z = 0
        // accent glow: gentle breathing pulse, flares white on a hit — tracks the token
        if (s.accentGlow && s.accentGlowMat) {
          s.accentGlow.position.y = s.art.position.y
          s.accentGlow.position.x = offX
          // keeper telegraph → the accent glow flares as a readable "attack incoming"
          // tell; pulses when motion is on, else a static-but-brighter hold
          const tell = s.castWarned ? (this.motionOk ? 0.35 + 0.35 * Math.abs(Math.sin(this.clockT * 12)) : 0.5) : 0
          const base = this.motionOk ? 0.32 + 0.12 * Math.sin(this.clockT * 2.4 + s.walkT) : 0.36
          s.accentGlowMat.opacity = Math.min(0.98, base + hitK * 0.7 + tell)
          const gs = Math.max(w, h) * (1.5 + hitK * 0.35 + tell * 0.4)
          s.accentGlow.scale.set(gs, gs, 1)
          if (hitK > 0) s.accentGlowMat.color.setRGB(1, 1, 1)
          else s.accentGlowMat.color.setHex(s.accent)
        }
      } else {
        s.body.position.z = hitK > 0 ? -hitK * 0.09 : 0 // knockback nudge, opposite travel
        s.body.position.x = offX
        s.body.scale.set(sqX, sqY, sqX)
        s.body.position.y = bob
        s.body.rotation.z = leanRot
        if (s.isAir) s.body.rotation.y += dt * 1.4
      }
      // burning → embers (throttled per enemy so swarms stay cheap)
      if (s.burning) {
        s.emberAcc += dt
        if (s.emberAcc > 0.13) {
          s.emberAcc = 0
          this.emitParticles(s.group.position.x, s.group.position.y + 0.25, s.group.position.z, 0xff8a3c, 1, 1.1)
        }
      }
      // runner speed-STREAK: a wisp trailing off the sprinter's heels while it's at
      // full tilt — reinforces the "moving fast", not "sliding" read. Throttled;
      // motion-gated; dies when the runner is slowed/frozen (animSpeed drops).
      if (s.kind === 'runner' && this.motionOk && s.animSpeed > 0.6) {
        s.streakAcc += dt
        if (s.streakAcc > 0.055) {
          s.streakAcc = 0
          this.emitParticles(s.group.position.x, s.group.position.y + 0.12, s.group.position.z, s.accent, 1, 0.8)
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
    for (const p of this.extraPortals) p.rotation.z += dt * 1.2
    this.baseMesh.rotation.y += dt * 0.8
    this.baseMesh.position.y = GROUND + 0.55 + Math.sin(this.clockT * 2) * 0.06

    // hover pulse
    if (this.hoverMesh.visible) this.hoverMesh.scale.setScalar(1 + Math.sin(this.clockT * 6) * 0.06)

    // element-core idle BREATH: the shared per-kind orb material slow-pulses its
    // emissive (a living hue swell toward white at the peak) so every tower core
    // reads as alive against the grey board. One write per kind (not per tower);
    // frozen at the mid value under reduce-motion so the glow still reads.
    for (const [kind, om] of this.orbMats) {
      if (this.motionOk) {
        const b = 0.5 + 0.5 * Math.sin(this.clockT * 1.7 + KIND_PHASE[kind])
        om.emissiveIntensity = ORB_EMISSIVE_BASE + b * ORB_EMISSIVE_SWELL
        const base = this.orbBaseCol.get(kind)
        if (base) om.emissive.copy(_orbCol.copy(base).lerp(WHITE_COL, b * 0.14))
      } else {
        om.emissiveIntensity = ORB_EMISSIVE_BASE + ORB_EMISSIVE_SWELL * 0.5
      }
    }

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
        const k = s.pulseT / 0.62
        s.group.scale.setScalar(1 + Math.sin(Math.min(1, k) * Math.PI) * 0.2)
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
            const col = e.type === 'mist' ? 0xcfeeff : e.type === 'embers' ? 0xff8a3c : e.type === 'sparks' ? 0xffe97a : e.type === 'spores' ? 0xa4ff6a : 0xd6a6ff
            this.emitParticles(
              s.group.position.x + (Math.random() - 0.5) * 0.34, GROUND + e.y,
              s.group.position.z + (Math.random() - 0.5) * 0.34,
              col, 1, e.type === 'sparks' ? 1.5 : 0.45,
            )
          }
        }
      }
    }

    // placement range ring: gentle breathe (frozen under reduce-motion) so the
    // live coverage preview reads as "alive" without distracting from the board.
    if (this.placeRing.visible) {
      const br = this.motionOk ? 1 + Math.sin(this.clockT * 4) * 0.012 : 1
      this.placeRing.scale.set(this.placeRingR * br, this.placeRingR * br, 1)
      this.placeRingMat.opacity = (this.placeRingOk ? 0.82 : 0.62) + (this.motionOk ? Math.sin(this.clockT * 4) * 0.14 : 0.1)
    }

    // THE PRISM WELLSPRING: gentle hover + spin; at low integrity it shudders and
    // the halo guts like a failing flame — the base visibly fighting the Greying.
    {
      const wob = this.baseIntegrity < 0.45 ? (1 - this.baseIntegrity / 0.45) : 0
      const bob = Math.sin(this.clockT * 1.6) * 0.05 + (wob > 0 ? Math.sin(this.clockT * 34) * 0.03 * wob : 0)
      if (this.baseMesh && this.baseMesh.visible) {
        this.baseMesh.rotation.y += dt * 0.6
        this.baseMesh.position.y = GROUND + 0.55 + bob
        this.baseMesh.scale.setScalar(0.72 + 0.28 * this.baseIntegrity)
      }
      if (this.baseArt) this.baseArt.position.y = GROUND + this.baseArt.scale.y / 2 + bob
      if (this.baseArtCrit) this.baseArtCrit.position.y = GROUND + this.baseArtCrit.scale.y / 2 + bob
      if (this.baseHalo) {
        this.baseHalo.scale.setScalar(1 + Math.sin(this.clockT * 2) * 0.05)
        if (wob > 0) this.baseHaloMat.opacity *= 0.7 + Math.random() * 0.3
      }
    }

    // hero: bob + spin the element crystal, idle sway, breathing aura ring
    for (const [, s] of this.heroViews) {
      const y0 = s.orb.userData.y0 as number
      s.orb.position.y = y0 + Math.sin(this.clockT * 2.6) * 0.06
      s.orb.rotation.y += dt * 2.2
      s.orb.rotation.x += dt * 1.1
      // NB: the hero body's idle bob + attack/cast/hurt pose (position.y & lunge x/z)
      // are owned by animateHeroPresence() in the sync pass — don't overwrite Y here,
      // or the pose dip/rise gets clobbered every frame.
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
    this.updateBackdrop(dt)
    this.updateGroundReveal() // grey→colour as the realm is cleared (thesis on the board)
    if (this.boardLife) {
      try {
        this.boardLife.update(dt, this.clockT)
      } catch (e) {
        console.warn('BoardLife update failed — dropping on-board layers', e)
        this.boardLife.dispose()
        this.boardLife = undefined
      }
    }
    this.updateTransients(dt)

    // bloom surge decay (0.45 = the calibrated base set in the constructor)
    if (this.bloomAmp > 0) {
      this.bloomAmp = Math.max(0, this.bloomAmp - dt * 0.55)
      this.bloom.strength = 0.45 + this.bloomAmp
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

    // painted-backdrop atmosphere (its own geoms/mats/textures + camera-child frame)
    this.atmosphere?.dispose()
    // on-board weather + prism-road shimmer
    this.boardLife?.dispose()
    this.boardLife = undefined

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
      s.artMat?.dispose() // painted-billboard material (shared texture is cached, not disposed)
      s.accentGlowMat?.dispose()
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

    // board mesh(es) — geometry/material are already disposed via `disposables` above
    for (const m of this.boardMeshes) this.scene.remove(m)
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
