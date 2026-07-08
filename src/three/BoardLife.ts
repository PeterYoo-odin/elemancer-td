// ---------------------------------------------------------------------------
//  BOARD LIFE — on-board diorama layers that live on the PLAY PLANE itself
//  (as opposed to RealmAtmosphere, which animates the FAR painted backdrop).
//
//  Two systems, both VIEW-ONLY + deterministic (no Math.random, no sim reads):
//    1) ON-BOARD WEATHER — per-realm embers / snow / leaves / motes that drift
//       across the board volume and settle toward the play plane.
//    2) PRISM-ROAD SHIMMER — an iridescent ribbon flowing along the enemy path,
//       so the lane reads as living colour being walked over.
//
//  Mirrors the RealmAtmosphere contract: construct(scene, …), update(dt, t),
//  dispose(). Reduce-motion collapses to static: NOTHING animated is built, the
//  bare (already-legible) road + tiles remain. Counts trimmed on low-perf mobile.
// ---------------------------------------------------------------------------

import * as THREE from 'three'

export interface BoardBounds {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  y: number // play-plane top (weather settles toward this, ribbon floats just above)
}

interface WeatherSpec {
  color: number
  count: number
  size: number
  speed: number // vertical drift units/sec
  kind: 'fall' | 'rise' // snow/ash/leaves fall; embers/motes rise
  additive: boolean
  top: number // ceiling above the plane the layer occupies
  opacity: number
}

// Per-realm weather recipe (keyed by RealmBackdrop.key). Falls back to embers.
const WEATHER: Record<string, WeatherSpec> = {
  emberwaste:     { color: 0xff8a3c, count: 70, size: 0.075, speed: 0.55, kind: 'rise', additive: true,  top: 4.2, opacity: 0.5 },
  frostreach:     { color: 0xdff2ff, count: 90, size: 0.07,  speed: 0.7,  kind: 'fall', additive: false, top: 4.8, opacity: 0.62 },
  stormpeaks:     { color: 0xbfa6ff, count: 64, size: 0.07,  speed: 0.5,  kind: 'rise', additive: true,  top: 4.6, opacity: 0.42 },
  verdantwilds:   { color: 0x9fe07a, count: 60, size: 0.09,  speed: 0.6,  kind: 'fall', additive: false, top: 4.4, opacity: 0.5 },
  radiantsanctum: { color: 0xffe6a0, count: 66, size: 0.07,  speed: 0.4,  kind: 'rise', additive: true,  top: 4.6, opacity: 0.46 },
  umbralvoid:     { color: 0xc07adf, count: 62, size: 0.075, speed: 0.42, kind: 'rise', additive: true,  top: 4.6, opacity: 0.4 },
}

// deterministic hash → [0,1) (no Math.random: the board must be reproducible)
function h1(n: number): number {
  const x = Math.sin(n * 127.1 + 13.7) * 43758.5453
  return x - Math.floor(x)
}

export class BoardLife {
  private group = new THREE.Group()
  private disposables: Array<{ dispose(): void }> = []

  // weather
  private points?: THREE.Points
  private pMat?: THREE.PointsMaterial
  private pPos?: Float32Array
  private pSeed?: Float32Array // bx, bz, phase, speedJitter
  private pCount = 0
  private pKind: 'fall' | 'rise' = 'fall'
  private pTop = 4
  private pSpeed = 0.55
  private pY0: number

  // prism-road
  private ribbonMat?: THREE.MeshBasicMaterial
  private ribbonTex?: THREE.CanvasTexture
  private ribbonBaseOpacity = 0.22

  constructor(
    scene: THREE.Scene,
    motionOk: boolean,
    realmKey: string,
    pathWorld: THREE.Vector3[],
    private bounds: BoardBounds,
  ) {
    this.pY0 = bounds.y
    scene.add(this.group)
    if (!motionOk) return // reduce-motion → static board (bare road + tiles), nothing added

    const lowPerf = typeof window !== 'undefined' && (window.innerWidth < 820 || 'ontouchstart' in window)
    const spec = WEATHER[realmKey] ?? WEATHER.emberwaste
    this.buildWeather(spec, lowPerf)
    this.buildPrismRoad(pathWorld, realmKey)
  }

  // ---- soft round sprite so points read as motes, not hard squares -----------
  private dotTexture(): THREE.CanvasTexture {
    const cv = document.createElement('canvas')
    cv.width = cv.height = 32
    const ctx = cv.getContext('2d')!
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.5, 'rgba(255,255,255,0.55)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 32, 32)
    const t = new THREE.CanvasTexture(cv)
    this.disposables.push(t)
    return t
  }

  private buildWeather(spec: WeatherSpec, lowPerf: boolean): void {
    const count = Math.max(12, Math.round(spec.count * (lowPerf ? 0.55 : 1)))
    this.pCount = count
    this.pKind = spec.kind
    this.pTop = spec.top
    this.pSpeed = spec.speed
    const pos = new Float32Array(count * 3)
    const seed = new Float32Array(count * 4)
    const { minX, maxX, minZ, maxZ } = this.bounds
    for (let i = 0; i < count; i++) {
      const bx = minX + h1(i * 2.1 + 1) * (maxX - minX)
      const bz = minZ + h1(i * 3.7 + 5) * (maxZ - minZ)
      seed[i * 4] = bx
      seed[i * 4 + 1] = bz
      seed[i * 4 + 2] = h1(i * 5.3 + 9) // phase 0..1
      seed[i * 4 + 3] = 0.7 + h1(i * 7.9 + 2) * 0.6 // per-mote speed jitter
      pos[i * 3] = bx
      pos[i * 3 + 1] = this.pY0 + h1(i * 5.3 + 9) * spec.top
      pos[i * 3 + 2] = bz
    }
    this.pPos = pos
    this.pSeed = seed
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    this.disposables.push(geo)
    const mat = new THREE.PointsMaterial({
      color: spec.color,
      size: spec.size,
      map: this.dotTexture(),
      transparent: true,
      opacity: spec.opacity,
      depthWrite: false,
      sizeAttenuation: true,
      blending: spec.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      toneMapped: !spec.additive,
    })
    this.disposables.push(mat)
    this.pMat = mat
    const pts = new THREE.Points(geo, mat)
    pts.frustumCulled = false
    pts.renderOrder = 2
    this.points = pts
    this.group.add(pts)
  }

  // ---- iridescent gradient the ribbon SCROLLS to read as flowing prism-light --
  private prismTexture(realmKey: string): THREE.CanvasTexture {
    const w = 256, h = 32
    const cv = document.createElement('canvas')
    cv.width = w; cv.height = h
    const ctx = cv.getContext('2d')!
    // horizontal spectral sweep (prism); slightly biased warm/cool per realm so it
    // harmonises with the biome rather than reading as a literal rainbow road.
    const hueBias = realmKey === 'frostreach' ? 0.55 : realmKey === 'emberwaste' ? 0.03
      : realmKey === 'verdantwilds' ? 0.3 : realmKey === 'umbralvoid' ? 0.78
      : realmKey === 'radiantsanctum' ? 0.13 : 0.7
    const grad = ctx.createLinearGradient(0, 0, w, 0)
    for (let s = 0; s <= 8; s++) {
      const f = s / 8
      const hue = (hueBias + f * 0.5) % 1 // half-spectrum sweep, anchored to the biome
      grad.addColorStop(f, `hsl(${Math.round(hue * 360)}, 85%, 62%)`)
    }
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, w, h)
    // vertical alpha falloff → bright spine, feathered edges (blends onto the road)
    const va = ctx.createLinearGradient(0, 0, 0, h)
    va.addColorStop(0, 'rgba(0,0,0,1)')
    va.addColorStop(0.5, 'rgba(0,0,0,0)')
    va.addColorStop(1, 'rgba(0,0,0,1)')
    ctx.globalCompositeOperation = 'destination-out'
    ctx.fillStyle = va
    ctx.fillRect(0, 0, w, h)
    const t = new THREE.CanvasTexture(cv)
    t.wrapS = THREE.RepeatWrapping
    t.wrapT = THREE.ClampToEdgeWrapping
    this.disposables.push(t)
    return t
  }

  private buildPrismRoad(pathWorld: THREE.Vector3[], realmKey: string): void {
    if (pathWorld.length < 2) return
    const half = 0.34 // ribbon half-width (road tile ~1 unit; keep it inside the lane)
    const period = 1.6 // world units per texture repeat (tunes the flow density)
    const n = pathWorld.length
    const positions: number[] = []
    const uvs: number[] = []
    const y = this.bounds.y + 0.02 // just above the road tile top (no z-fight w/ FX)
    const dir = new THREE.Vector3()
    const nrm = new THREE.Vector3()
    let run = 0
    const left: THREE.Vector3[] = []
    const right: THREE.Vector3[] = []
    const uCoord: number[] = []
    for (let i = 0; i < n; i++) {
      const prev = pathWorld[Math.max(0, i - 1)]
      const next = pathWorld[Math.min(n - 1, i + 1)]
      dir.set(next.x - prev.x, 0, next.z - prev.z)
      if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0)
      dir.normalize()
      nrm.set(-dir.z, 0, dir.x) // in-plane perpendicular
      const p = pathWorld[i]
      if (i > 0) run += Math.hypot(p.x - pathWorld[i - 1].x, p.z - pathWorld[i - 1].z)
      uCoord.push(run / period)
      left.push(new THREE.Vector3(p.x + nrm.x * half, y, p.z + nrm.z * half))
      right.push(new THREE.Vector3(p.x - nrm.x * half, y, p.z - nrm.z * half))
    }
    for (let i = 0; i < n - 1; i++) {
      const l0 = left[i], r0 = right[i], l1 = left[i + 1], r1 = right[i + 1]
      const u0 = uCoord[i], u1 = uCoord[i + 1]
      // two triangles per segment (l0,r0,l1) + (r0,r1,l1)
      positions.push(l0.x, l0.y, l0.z, r0.x, r0.y, r0.z, l1.x, l1.y, l1.z)
      positions.push(r0.x, r0.y, r0.z, r1.x, r1.y, r1.z, l1.x, l1.y, l1.z)
      uvs.push(u0, 0, u0, 1, u1, 0)
      uvs.push(u0, 1, u1, 1, u1, 0)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    this.disposables.push(geo)
    const tex = this.prismTexture(realmKey)
    this.ribbonTex = tex
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: this.ribbonBaseOpacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      side: THREE.DoubleSide,
    })
    this.disposables.push(mat)
    this.ribbonMat = mat
    const mesh = new THREE.Mesh(geo, mat)
    mesh.frustumCulled = false
    mesh.renderOrder = 1 // over the road tiles, under units/FX
    this.group.add(mesh)
  }

  // ---- per-frame -------------------------------------------------------------
  update(dt: number, t: number): void {
    void dt
    // weather: drift vertically (fall/rise + wrap) with a lateral sway
    if (this.points && this.pPos && this.pSeed) {
      const span = this.pTop
      for (let i = 0; i < this.pCount; i++) {
        const bx = this.pSeed[i * 4]
        const bz = this.pSeed[i * 4 + 1]
        const ph = this.pSeed[i * 4 + 2]
        const sp = this.pSeed[i * 4 + 3]
        const travel = (t * this.pSpeed * sp + ph * span) % span
        const y = this.pKind === 'rise' ? this.pY0 + travel : this.pY0 + span - travel
        this.pPos[i * 3] = bx + Math.sin(t * 0.35 * sp + ph * 6.28) * 0.5
        this.pPos[i * 3 + 1] = y
        this.pPos[i * 3 + 2] = bz + Math.cos(t * 0.28 * sp + ph * 6.28) * 0.4
      }
      ;(this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
    }
    // prism-road: scroll the spectral sweep + a gentle breathing opacity
    if (this.ribbonTex && this.ribbonMat) {
      this.ribbonTex.offset.x = (t * 0.16) % 1
      this.ribbonMat.opacity = this.ribbonBaseOpacity * (0.8 + Math.sin(t * 1.3) * 0.2)
    }
  }

  dispose(): void {
    if (this.points) this.group.remove(this.points)
    this.group.removeFromParent()
    for (const d of this.disposables) d.dispose()
    this.disposables.length = 0
  }
}
