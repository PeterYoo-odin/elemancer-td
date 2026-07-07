// Procedural tower models — hand-shaped, per-element silhouettes that replace the
// old stacked-kit look. Every (kind, level, branch) variant is built ONCE from
// lathe/chamfered primitives, merged into a handful of BufferGeometries keyed by
// MATERIAL ROLE (body / trim / dark / core), and cached in a persistent module
// singleton (same lifecycle as the model registry: geometry is never disposed,
// it simply re-uploads when a battle starts a fresh GL context).
//
// Design language, per element:
//   Cannon — heavy armored bastion: octagonal plinth, battered round hull,
//            steel bands, domed turret with a proper barrel (recoil-ready).
//   Frost  — crystalline spire: snowy plinth, tiered ice pedestal, a ring of
//            leaning shards and a tall faceted core crystal.
//   Flame  — molten obsidian: dark gourd hull split by glowing ember-crack
//            bands, bronze-rimmed brazier crowned by a living flame core.
//   Storm  — tesla spire: dark mast wrapped in brass coils, pronged emitter
//            head cradling a humming charge orb.
//   Arcane — runed monolith: pale waisted pillar, gold collars, a floating
//            emissive core orbited by rings and runestones.
//
// Tiers grow mass + ornament (L0→L2); the two L3 branches get DISTINCT crowns
// (sniper/mortar, blizzard/glacier, scorch/phoenix, tempest/overload,
// amplify/prism) so the fork reads at a glance.
//
// Coordinates: 1 world unit = 1 tile; base sits on y=0 (the view parents it at
// tile-top height). Turret "forward" is local +X (matches the sim aim mapping).

import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { TowerKind } from '../game/towers'

export type PartRole = 'body' | 'trim' | 'dark' | 'core'
const ROLES: PartRole[] = ['body', 'trim', 'dark', 'core']

// Small animated garnish the view instantiates from shared unit geometry.
// All motion fields are OPTIONAL and the view freezes them under reduce-motion.
export interface AccentSpec {
  shape: 'orb' | 'ring' | 'shard' | 'flame' | 'prism'
  role: 'core' | 'trim'
  attach: 'body' | 'turret'
  x?: number
  y: number
  z?: number
  scale: number
  scaleY?: number // vertical stretch (teardrop flames, tall prisms)
  tiltX?: number // fixed tilt; combined with spin (YXZ order) it precesses
  tiltZ?: number
  spin?: number // rad/s around local Y
  orbit?: number // radius — revolves around its anchor at `spin` rad/s
  bobAmp?: number
  bobSpeed?: number
  flicker?: number // 0..1 scale shimmer (flame cores, charge orbs)
  phase?: number // animation de-sync offset
}

export interface TowerVisual {
  body: Partial<Record<PartRole, THREE.BufferGeometry>> // static hull, merged
  turret: Partial<Record<PartRole, THREE.BufferGeometry>> // aims + recoils
  turretY: number // turret pivot height
  height: number // approx total height (veil / glow placement)
  accents: AccentSpec[]
  emitter?: { type: 'mist' | 'embers' | 'sparks' | 'motes'; y: number; rate: number }
}

// ---------------------------------------------------------------- geometry kit
type Pt = [number, number] // [radius, height] lathe profile point

function lathe(pts: Pt[], seg = 20): THREE.BufferGeometry {
  return new THREE.LatheGeometry(pts.map((p) => new THREE.Vector2(Math.max(p[0], 0.001), p[1])), seg)
}

/** Cylinder standing on y=0 (not centred) — the natural way to stack parts. */
function cyl(rTop: number, rBottom: number, h: number, seg = 16): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBottom, h, seg)
  g.translate(0, h / 2, 0)
  return g
}

/** Horizontal ring around the Y axis (a band / collar). */
function band(r: number, tube: number, seg = 18, tubeSeg = 7): THREE.BufferGeometry {
  const g = new THREE.TorusGeometry(r, tube, tubeSeg, seg)
  g.rotateX(Math.PI / 2)
  return g
}

/** Tube extending along +X from the origin (barrels). */
function tubeX(r: number, len: number, seg = 14, rTip = r): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTip, r, len, seg)
  g.rotateZ(-Math.PI / 2) // +Y → +X, wide end at the origin side
  g.translate(len / 2, 0, 0)
  return g
}

/** Ring whose hole faces +X (muzzle rings, lenses). */
function ringX(r: number, tube: number, seg = 16, tubeSeg = 7): THREE.BufferGeometry {
  const g = new THREE.TorusGeometry(r, tube, tubeSeg, seg)
  g.rotateY(Math.PI / 2)
  return g
}

function cone(r: number, h: number, seg = 10): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(r, h, seg)
  g.translate(0, h / 2, 0)
  return g
}

function orb(r: number, w = 12, h = 9): THREE.BufferGeometry {
  return new THREE.SphereGeometry(r, w, h)
}

/**
 * Faceted crystal shard standing on y=0: an elongated bipyramid with flat
 * facets (non-indexed + recomputed normals so each face catches light hard).
 */
function crystal(r: number, h: number, sides = 6): THREE.BufferGeometry {
  const up = cone(r, h * 0.78, sides)
  up.translate(0, h * 0.22, 0)
  const dn = new THREE.ConeGeometry(r, h * 0.22, sides)
  dn.rotateX(Math.PI)
  dn.translate(0, h * 0.11, 0)
  const g = mergeGeometries([up.toNonIndexed(), dn.toNonIndexed()])!
  up.dispose(); dn.dispose()
  g.deleteAttribute('normal')
  g.computeVertexNormals()
  return g
}

interface Xf {
  x?: number; y?: number; z?: number
  rx?: number; ry?: number; rz?: number
  s?: number; sx?: number; sy?: number; sz?: number
}

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _v = new THREE.Vector3()
const _sv = new THREE.Vector3()

/** Collects transformed parts per material role, then merges each role to ONE geometry. */
class Build {
  private parts: Record<PartRole, THREE.BufferGeometry[]> = { body: [], trim: [], dark: [], core: [] }

  add(role: PartRole, g: THREE.BufferGeometry, t: Xf = {}): void {
    _e.set(t.rx ?? 0, t.ry ?? 0, t.rz ?? 0)
    _q.setFromEuler(_e)
    _v.set(t.x ?? 0, t.y ?? 0, t.z ?? 0)
    const s = t.s ?? 1
    _sv.set(t.sx ?? s, t.sy ?? s, t.sz ?? s)
    _m.compose(_v, _q, _sv)
    g.applyMatrix4(_m)
    this.parts[role].push(g)
  }

  merged(): Partial<Record<PartRole, THREE.BufferGeometry>> {
    const out: Partial<Record<PartRole, THREE.BufferGeometry>> = {}
    for (const role of ROLES) {
      const list = this.parts[role]
      if (!list.length) continue
      if (list.length === 1) { out[role] = list[0]; continue }
      // normalise to non-indexed so faceted crystals merge with smooth lathes
      const flat = list.map((g) => {
        if (!g.index) return g
        const n = g.toNonIndexed()
        g.dispose()
        return n
      })
      const m = mergeGeometries(flat)
      if (m) {
        for (const g of flat) g.dispose()
        out[role] = m
      } else {
        out[role] = flat[0]
      }
    }
    return out
  }
}

// deterministic per-slot jitter (no Math.random — variants must be cache-stable)
function jit(i: number, salt: number): number {
  const n = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453
  return n - Math.floor(n)
}

// ---------------------------------------------------------------- CANNON
// Heavy armored bastion. Branches: Sniper = one LONG rifled barrel + scope mast;
// Mortar = fat up-angled siege tube on struts.
function buildCannon(b: Build, tb: Build, L: number, branch: number) {
  const k = 1 + L * 0.09
  const accents: AccentSpec[] = []
  // octagonal chamfered plinth (flat facets read "fortified", chamfer kills the box)
  b.add('dark', lathe([[0.47, 0], [0.47, 0.05], [0.40, 0.12], [0.33, 0.15], [0.001, 0.15]], 8), { ry: Math.PI / 8 })
  b.add('trim', band(0.41, 0.02, 8), { y: 0.115, ry: Math.PI / 8 })

  const bodyH = 0.5 + L * 0.14
  const r0 = 0.30 * k, r1 = 0.215 * k
  const y0 = 0.14
  // battered hull with a flared machicolation collar at the top
  b.add('body', lathe([
    [r0 + 0.03, y0], [r0, y0 + bodyH * 0.28], [r1 + 0.005, y0 + bodyH * 0.78],
    [r1 + 0.05, y0 + bodyH * 0.9], [r1 + 0.04, y0 + bodyH], [0.001, y0 + bodyH],
  ], 18))
  // steel bands (count grows with tier)
  const bands = 1 + Math.min(L, 2)
  for (let i = 0; i < bands; i++) {
    const f = (i + 1) / (bands + 1)
    const r = r0 + (r1 - r0) * f
    b.add('trim', band(r + 0.012, 0.024, 18), { y: y0 + bodyH * (0.15 + f * 0.55) })
  }
  // rivet studs at L2+
  if (L >= 2) for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8
    b.add('trim', new THREE.IcosahedronGeometry(0.024, 0), { x: Math.cos(a) * (r0 - 0.01), z: Math.sin(a) * (r0 - 0.01), y: y0 + bodyH * 0.22 })
  }
  // glowing sight-slit ring under the collar — the element core
  b.add('core', band(r1 + 0.028, 0.014, 18), { y: y0 + bodyH * 0.85 })

  const turretY = y0 + bodyH + 0.015
  // armored dome + collar
  tb.add('dark', cyl(0.205 * k, 0.23 * k, 0.07, 16))
  const dome = orb(0.195 * k, 16, 10)
  tb.add('body', dome, { y: 0.09, sy: 0.72 })
  if (L >= 1) { // side cheek plates
    tb.add('trim', orb(0.085 * k, 10, 8), { y: 0.12, z: 0.155 * k, sz: 0.55 })
    tb.add('trim', orb(0.085 * k, 10, 8), { y: 0.12, z: -0.155 * k, sz: 0.55 })
  }
  if (L >= 2) tb.add('dark', cyl(0.035, 0.045, 0.14, 8), { x: -0.1 * k, y: 0.16 }) // exhaust stack

  const gy = 0.15 // gun axis height above pivot
  if (L >= 3 && branch === 0) {
    // SNIPER — one long rifled barrel, muzzle brake, scope mast with a glint
    tb.add('dark', tubeX(0.062, 0.92, 12, 0.055), { x: 0.02, y: gy })
    tb.add('trim', ringX(0.075, 0.018), { x: 0.68, y: gy })
    tb.add('trim', ringX(0.075, 0.018), { x: 0.78, y: gy })
    tb.add('trim', ringX(0.08, 0.02), { x: 0.9, y: gy })
    tb.add('core', tubeX(0.036, 0.025), { x: 0.935, y: gy })
    tb.add('dark', tubeX(0.028, 0.2), { x: 0.08, y: gy + 0.11 }) // scope
    tb.add('core', ringX(0.03, 0.01), { x: 0.285, y: gy + 0.11 }) // scope lens
    tb.add('trim', cone(0.02, 0.24, 6), { x: -0.14, y: 0.2 }) // rangefinder mast
    accents.push({ shape: 'orb', role: 'core', attach: 'turret', x: -0.14, y: 0.46, scale: 0.035, flicker: 0.25, phase: 1.3 })
  } else if (L >= 3 && branch === 1) {
    // MORTAR — fat siege tube angled steeply skyward on bronze struts
    const ma = 0.8 // elevation — unmistakably a lobber next to the flat sniper
    tb.add('dark', tubeX(0.17, 0.48, 14, 0.2), { x: -0.08, y: gy - 0.02, rz: ma })
    tb.add('trim', ringX(0.21, 0.03), { x: -0.08 + Math.cos(ma) * 0.46, y: gy - 0.02 + Math.sin(ma) * 0.46, rz: ma })
    tb.add('core', tubeX(0.14, 0.02), { x: -0.08 + Math.cos(ma) * 0.47, y: gy - 0.02 + Math.sin(ma) * 0.47, rz: ma })
    tb.add('trim', cyl(0.03, 0.035, 0.2, 8), { x: 0.14, z: 0.1, y: 0.0, rz: -0.5, rx: 0.35 }) // struts
    tb.add('trim', cyl(0.03, 0.035, 0.2, 8), { x: 0.14, z: -0.1, y: 0.0, rz: -0.5, rx: -0.35 })
  } else {
    // standard cannon: tapered barrel + breech & muzzle rings + glowing bore
    const bl = 0.46 + L * 0.09, br = 0.082 + L * 0.011
    tb.add('dark', tubeX(br, bl, 12, br * 0.9), { x: 0.04, y: gy })
    tb.add('trim', ringX(br + 0.016, 0.022), { x: 0.12, y: gy })
    tb.add('trim', ringX(br + 0.01, 0.018), { x: 0.04 + bl - 0.05, y: gy })
    tb.add('core', tubeX(br * 0.55, 0.02), { x: 0.04 + bl, y: gy })
    tb.add('dark', orb(0.085 * k, 10, 8), { x: -0.15 * k, y: gy, sx: 1.25 }) // counterweight
  }

  return { turretY, height: turretY + 0.42, accents, emitter: undefined }
}

// ---------------------------------------------------------------- FROST
// Crystalline spire. Branches: Blizzard = wide radiating crown + spinning halo;
// Glacier = one MASSIVE chunky deep-blue crystal.
function buildFrost(b: Build, tb: Build, L: number, branch: number) {
  const k = 1 + L * 0.09
  const accents: AccentSpec[] = []
  // soft snowy plinth
  b.add('body', lathe([[0.44, 0], [0.45, 0.06], [0.37, 0.12], [0.29, 0.15], [0.001, 0.15]], 20))
  b.add('trim', band(0.40, 0.018, 20), { y: 0.10 })

  const pedH = 0.32 + L * 0.09
  const y0 = 0.14
  // tiered icy pedestal — shelf bumps like frozen drip terraces
  b.add('body', lathe([
    [0.27 * k, y0], [0.24 * k, y0 + pedH * 0.3], [0.285 * k, y0 + pedH * 0.38],
    [0.21 * k, y0 + pedH * 0.66], [0.24 * k, y0 + pedH * 0.74],
    [0.165 * k, y0 + pedH], [0.001, y0 + pedH],
  ], 18))

  const topY = y0 + pedH
  const glacier = L >= 3 && branch === 1
  const blizzard = L >= 3 && branch === 0
  // ring of leaning shards around the pedestal shoulder
  const n = blizzard ? 8 : 4 + Math.min(L, 2)
  const lean = blizzard ? 0.72 : 0.38
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + jit(i, L) * 0.5
    const h = (glacier ? 0.3 : 0.24) + jit(i, 7) * 0.1 + L * 0.045
    const r = (glacier ? 0.075 : 0.05) + L * 0.008
    const c = crystal(r, h, 5)
    c.rotateZ(-lean)
    b.add('trim', c, { ry: -a, x: Math.cos(a) * 0.235 * k, z: Math.sin(a) * 0.235 * k, y: topY - 0.1 })
  }

  // main crystal (in the turret so the fire "kick" pulses it)
  if (glacier) {
    tb.add('core', crystal(0.19, 0.95, 6))
    tb.add('core', crystal(0.09, 0.42, 5), { x: 0.13, z: 0.05, rz: -0.32 })
    tb.add('core', crystal(0.08, 0.36, 5), { x: -0.1, z: -0.09, rz: 0.3, ry: 1.1 })
  } else {
    const h = 0.5 + L * 0.12
    tb.add('core', crystal(0.1 + L * 0.016, h, 6))
    tb.add('core', crystal(0.055, h * 0.55, 5), { x: 0.1, z: 0.045, rz: -0.3 })
    tb.add('core', crystal(0.05, h * 0.45, 5), { x: -0.09, z: -0.065, rz: 0.28, ry: 0.9 })
  }
  if (blizzard) {
    accents.push({ shape: 'ring', role: 'core', attach: 'turret', y: 0.42, scale: 0.34, tiltX: 0.5, spin: 1.1, scaleY: 0.5 })
    accents.push({ shape: 'ring', role: 'core', attach: 'turret', y: 0.6, scale: 0.24, tiltX: -0.4, spin: -1.6, scaleY: 0.5, phase: 2.1 })
  }
  if (L >= 1 && !glacier) {
    // slow-orbiting ice mote
    accents.push({ shape: 'shard', role: 'core', attach: 'turret', y: 0.3, scale: 0.05, orbit: 0.26 + L * 0.03, spin: 0.8, bobAmp: 0.05, phase: 0.7 })
  }

  const coreH = glacier ? 0.95 : 0.5 + L * 0.12
  return {
    turretY: topY,
    height: topY + coreH,
    accents,
    emitter: { type: 'mist' as const, y: topY - 0.05, rate: 0.8 + L * 0.5 },
  }
}

// ---------------------------------------------------------------- FLAME
// Molten obsidian. Branches: Scorch = wide low fire-pit + ground ember nubs;
// Phoenix = swept bronze wings + a tall teardrop flame spike.
function buildFlame(b: Build, tb: Build, L: number, branch: number) {
  const k = 1 + L * 0.09
  const accents: AccentSpec[] = []
  const scorch = L >= 3 && branch === 0
  const phoenix = L >= 3 && branch === 1
  // volcanic plinth + ember ring smouldering at its foot
  b.add('dark', lathe([[0.45, 0], [0.44, 0.07], [0.35, 0.13], [0.27, 0.15], [0.001, 0.15]], 18))
  b.add('core', band(0.365, 0.011, 18), { y: 0.03 })

  const bodH = 0.4 + L * 0.11
  const y0 = 0.14
  // obsidian gourd: swollen belly, pinched waist, flared neck
  b.add('dark', lathe([
    [0.19 * k, y0], [0.29 * k, y0 + bodH * 0.22], [0.265 * k, y0 + bodH * 0.5],
    [0.16 * k, y0 + bodH * 0.8], [0.2 * k, y0 + bodH], [0.001, y0 + bodH],
  ], 18))
  // ember-crack bands glowing through the obsidian
  b.add('core', band(0.285 * k, 0.012, 18), { y: y0 + bodH * 0.24 })
  if (L >= 1) b.add('core', band(0.245 * k, 0.011, 18), { y: y0 + bodH * 0.56 })
  if (L >= 1) {
    // side vents with hot tips
    for (const sz of [1, -1]) {
      b.add('dark', cone(0.05, 0.16, 8), { x: 0.05, z: sz * 0.24 * k, y: y0 + bodH * 0.45, rx: sz * -0.9 })
      b.add('core', orb(0.022, 8, 6), { x: 0.05, z: sz * 0.3 * k, y: y0 + bodH * 0.52 })
    }
  }

  const turretY = y0 + bodH
  // brazier bowl + bronze rim
  const bw = scorch ? 1.4 : 1
  tb.add('dark', lathe([
    [0.09 * k, 0], [0.17 * k * bw, 0.04], [0.215 * k * bw, 0.12],
    [0.2 * k * bw, 0.155], [0.001, 0.155],
  ], 18))
  tb.add('trim', band(0.208 * k * bw, 0.02, 18), { y: 0.14 })
  if (L >= 2 && !phoenix) {
    // bronze claw prongs cradling the fire
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4
      const c = cone(0.028, 0.2, 6)
      c.rotateZ(-0.5)
      tb.add('trim', c, { ry: -a, x: Math.cos(a) * 0.19 * k * bw, z: Math.sin(a) * 0.19 * k * bw, y: 0.1 })
    }
  }
  if (phoenix) {
    // swept wings: flattened blades raking up and back
    for (const sz of [1, -1]) {
      const w = cone(0.09, 0.62, 8)
      w.scale(1, 1, 0.22)
      tb.add('trim', w, { x: -0.12, z: sz * 0.16, y: 0.08, rx: sz * 0.75, rz: 0.85 })
    }
  }

  // the living flame — a slim teardrop tongue licking out of the bowl, not a
  // fat orb: seated deep so only the tapering top rises past the bronze rim
  const fs = scorch ? 0.15 : 0.1 + L * 0.014
  const fy = phoenix ? 2.9 : 2.1
  accents.push({ shape: 'flame', role: 'core', attach: 'turret', y: 0.08 + fs * fy * 0.55, scale: fs, scaleY: fy, flicker: 0.24, bobSpeed: 2.6 })
  accents.push({ shape: 'flame', role: 'core', attach: 'turret', y: 0.1 + fs * fy * 0.72, scale: fs * 0.48, scaleY: fy * 1.3, flicker: 0.36, phase: 1.7, bobSpeed: 3.2 })
  if (scorch) {
    // smouldering ground nubs ring the plinth — "this ground burns"
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.4
      b.add('core', cone(0.035, 0.09, 6), { x: Math.cos(a) * 0.4, z: Math.sin(a) * 0.4 })
    }
  }

  return {
    turretY,
    height: turretY + 0.08 + fs * fy * 1.1,
    accents,
    emitter: { type: 'embers' as const, y: turretY + 0.25, rate: 1.2 + L * 0.8 + (scorch ? 1.5 : 0) },
  }
}

// ---------------------------------------------------------------- STORM
// Tesla spire. Branches: Tempest = triple spires + racing arc ring;
// Overload = one massive coil stack, giant orb, lightning rod.
function buildStorm(b: Build, tb: Build, L: number, branch: number) {
  const k = 1 + L * 0.09
  const accents: AccentSpec[] = []
  const tempest = L >= 3 && branch === 0
  const overload = L >= 3 && branch === 1
  // dark plinth + brass ring
  b.add('dark', lathe([[0.44, 0], [0.44, 0.06], [0.35, 0.13], [0.26, 0.15], [0.001, 0.15]], 18))
  b.add('trim', band(0.375, 0.022, 18), { y: 0.11 })

  const mastH = 0.52 + L * 0.15
  const y0 = 0.14
  const mr = overload ? 1.25 : 1
  b.add('dark', cyl(0.095 * k * mr, 0.185 * k * mr, mastH, 14), { y: y0 })
  // brass coils climbing the mast
  const coils = 3 + Math.min(L, 2) + (overload ? 1 : 0)
  const ct = overload ? 0.042 : 0.028
  for (let i = 0; i < coils; i++) {
    const f = i / (coils - 1)
    const r = (0.205 - 0.09 * f) * k * mr
    b.add('trim', band(r, ct, 18, 6), { y: y0 + mastH * (0.12 + 0.72 * f) })
  }
  if (tempest) {
    // two flanking mini-spires with their own charge tips
    for (const sz of [1, -1]) {
      const mh = 0.42
      b.add('dark', cyl(0.045, 0.09, mh, 10), { z: sz * 0.3, y: 0.1 })
      b.add('trim', band(0.085, 0.018, 12, 6), { z: sz * 0.3, y: 0.1 + mh * 0.35 })
      b.add('trim', band(0.07, 0.016, 12, 6), { z: sz * 0.3, y: 0.1 + mh * 0.7 })
      accents.push({ shape: 'orb', role: 'core', attach: 'body', z: sz * 0.3, y: 0.1 + mh + 0.05, scale: 0.05, flicker: 0.3, phase: sz * 1.2, bobAmp: 0.02 })
    }
    accents.push({ shape: 'ring', role: 'core', attach: 'body', y: y0 + mastH * 0.55, scale: 0.36, scaleY: 0.5, tiltX: 0.25, spin: 2.6 })
  }

  const turretY = y0 + mastH + 0.01
  // emitter head: brass collar + prongs cradling the charge orb
  tb.add('trim', cyl(0.075 * k, 0.1 * k, 0.06, 12))
  const prongs = overload ? 4 : 3
  for (let i = 0; i < prongs; i++) {
    const a = (i / prongs) * Math.PI * 2
    const p = cone(0.02, 0.2 + L * 0.02, 6)
    p.rotateZ(-0.55)
    tb.add('trim', p, { ry: -a, x: Math.cos(a) * 0.08, z: Math.sin(a) * 0.08, y: 0.04 })
  }
  const orbR = (overload ? 0.17 : 0.1 + L * 0.016)
  accents.push({ shape: 'orb', role: 'core', attach: 'turret', y: 0.16 + orbR, scale: orbR, flicker: 0.14, bobAmp: 0.02, spin: 1.8 })
  if (overload) {
    tb.add('trim', cone(0.016, 0.42, 6), { y: 0.16 + orbR * 0.6 }) // rod piercing the orb
    tb.add('core', orb(0.02, 8, 6), { y: 0.16 + orbR * 0.6 + 0.43 })
  }

  return {
    turretY,
    height: turretY + 0.16 + orbR * 2 + (overload ? 0.3 : 0),
    accents,
    emitter: { type: 'sparks' as const, y: turretY + 0.2, rate: 0.7 + L * 0.5 },
  }
}

// ---------------------------------------------------------------- ARCANE
// Runed monolith. Branches: Amplify = wide slow twin halos (network reach);
// Prism = aimed faceted prism + focusing lens (beam weapon).
function buildArcane(b: Build, tb: Build, L: number, branch: number) {
  const k = 1 + L * 0.08
  const accents: AccentSpec[] = []
  const amplify = L >= 3 && branch === 0
  const prism = L >= 3 && branch === 1
  // pale plinth with a glowing rune-ring inlay
  b.add('body', lathe([[0.43, 0], [0.44, 0.05], [0.36, 0.12], [0.28, 0.15], [0.001, 0.15]], 20))
  b.add('core', band(0.335, 0.011, 20), { y: 0.04 })

  const pilH = 0.38 + L * 0.1
  const y0 = 0.14
  // waisted pillar flaring into a cradle dish
  b.add('body', lathe([
    [0.24 * k, y0], [0.145 * k, y0 + pilH * 0.35], [0.13 * k, y0 + pilH * 0.6],
    [0.185 * k, y0 + pilH * 0.88], [0.21 * k, y0 + pilH], [0.001, y0 + pilH],
  ], 18))
  b.add('trim', band(0.15 * k, 0.018, 18), { y: y0 + pilH * 0.48 }) // gold waist collar
  b.add('trim', band(0.2 * k, 0.02, 18), { y: y0 + pilH * 0.97 })
  if (L >= 2) {
    // curved horns rising from the cradle rim
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.5
      const c = cone(0.024, 0.24, 6)
      c.rotateZ(-0.65)
      b.add('trim', c, { ry: -a, x: Math.cos(a) * 0.19 * k, z: Math.sin(a) * 0.19 * k, y: y0 + pilH - 0.02 })
    }
  }

  const turretY = y0 + pilH + 0.04
  const coreY = 0.18 + L * 0.03

  if (prism) {
    // aimed prism: 3-sided crystal laid forward + a focusing lens ring
    accents.push({ shape: 'prism', role: 'core', attach: 'turret', y: coreY, scale: 0.16, spin: 2.2, bobAmp: 0.02 })
    tb.add('trim', ringX(0.075, 0.016), { x: 0.24, y: coreY })
    tb.add('core', ringX(0.045, 0.01), { x: 0.26, y: coreY })
    accents.push({ shape: 'ring', role: 'trim', attach: 'turret', y: coreY, scale: 0.2, tiltX: 1.571, tiltZ: 1.571, spin: 3 })
  } else {
    // floating core orb
    accents.push({ shape: 'orb', role: 'core', attach: 'turret', y: coreY, scale: 0.115 + L * 0.02, spin: 1.3, bobAmp: 0.045, flicker: 0.08 })
    const r1 = amplify ? 0.46 : 0.22 + L * 0.025
    accents.push({ shape: 'ring', role: 'trim', attach: 'turret', y: coreY, scale: r1, scaleY: amplify ? 0.35 : 0.6, tiltX: 0.45, spin: amplify ? 0.55 : 0.95 })
    accents.push({ shape: 'ring', role: 'trim', attach: 'turret', y: coreY, scale: r1 * 0.78, scaleY: 0.6, tiltX: -0.6, spin: -1.3, phase: 2.4 })
    if (L >= 2) accents.push({ shape: 'ring', role: 'core', attach: 'turret', y: coreY, scale: r1 * 0.55, scaleY: 0.5, tiltX: 1.1, spin: 1.9, phase: 4.1 })
    if (amplify) {
      // beacon spike above the orb — "my reach is long"
      tb.add('core', cyl(0.012, 0.02, 0.5, 6), { y: coreY + 0.1 })
    }
  }
  // orbiting runestones
  const stones = 2 + Math.min(L, 2) + (amplify ? 2 : 0)
  for (let i = 0; i < stones; i++) {
    accents.push({
      shape: 'shard', role: 'core', attach: 'turret', y: coreY - 0.04 + jit(i, 3) * 0.1,
      scale: 0.035 + jit(i, 5) * 0.012, orbit: (amplify ? 0.4 : 0.3) + jit(i, 9) * 0.05,
      spin: 0.9 + jit(i, 11) * 0.5, phase: (i / stones) * Math.PI * 2, bobAmp: 0.03,
    })
  }

  return {
    turretY,
    height: turretY + coreY + 0.25,
    accents,
    emitter: { type: 'motes' as const, y: turretY + 0.1, rate: 0.6 + L * 0.4 },
  }
}

// ---------------------------------------------------------------- factory
const BUILDERS: Record<TowerKind, (b: Build, tb: Build, L: number, branch: number) => {
  turretY: number; height: number; accents: AccentSpec[]
  emitter?: TowerVisual['emitter']
}> = {
  cannon: buildCannon, frost: buildFrost, flame: buildFlame, storm: buildStorm, arcane: buildArcane,
}

// Persistent cache — geometry survives battle restarts (like the model registry);
// 5 kinds × ≤5 tier/branch states, each a handful of small merged buffers.
const cache = new Map<string, TowerVisual>()

export function towerVisual(kind: TowerKind, level: number, branch: number): TowerVisual {
  const L = Math.min(Math.max(level, 0), 3)
  const br = L >= 3 ? (branch === 1 ? 1 : 0) : -1
  const key = kind + ':' + L + ':' + br
  let v = cache.get(key)
  if (v) return v
  const b = new Build()
  const tb = new Build()
  const r = BUILDERS[kind](b, tb, L, br)
  v = { body: b.merged(), turret: tb.merged(), turretY: r.turretY, height: r.height, accents: r.accents, emitter: r.emitter }
  cache.set(key, v)
  return v
}

// Shared unit geometries for animated accents (scaled per-spec by the view).
let accentGeos: Record<AccentSpec['shape'], THREE.BufferGeometry> | null = null

export function accentGeometry(shape: AccentSpec['shape']): THREE.BufferGeometry {
  if (!accentGeos) {
    const ring = new THREE.TorusGeometry(1, 0.06, 7, 30)
    ring.rotateX(Math.PI / 2) // lie flat: tiltX rocks it, rotation.y precesses (YXZ)
    const pr = crystal(0.55, 2, 3)
    pr.translate(0, -1, 0) // centre the prism so it spins about its middle
    accentGeos = {
      orb: new THREE.IcosahedronGeometry(1, 1),
      ring,
      shard: new THREE.OctahedronGeometry(1, 0),
      flame: new THREE.SphereGeometry(1, 10, 8),
      prism: pr,
    }
  }
  return accentGeos[shape]
}
