// RealmAtmosphere — the "aliveness" pass over the painted per-realm backdrops.
//
// The painted 16:9 landscape (one flat PNG per realm, see realmBackdrops.ts) can't
// be literally sliced into depth planes, so we deepen it PROCEDURALLY: a few extra
// world-fixed layers parked between the painted cylinder (far) and the board (near),
// each drifting/pulsing to match what the art already depicts (embers, snow, aurora,
// light-shafts, fog, pollen), plus 2–4 far critters and a camera-locked foreground
// frame for diorama depth-of-field. Natural perspective across the layers' differing
// radii gives real parallax for near-zero cost.
//
// THE DISCIPLINE (make-or-break): every layer is held DESATURATED, LOW-luminance and
// pushed BACK so it never steals board legibility and never trips the bloom pass
// (threshold 0.72 — full saturation stays reserved for the towers + reactions). The
// world stays half-greyed; your towers are the colour.
//
// Perf: procedural canvas textures (cheap, cached in-instance), Points fields (one
// buffer write/frame), a handful of banded planes (never full-frame — overdraw is
// the mobile killer). reduce-motion skips every animated layer entirely (the camera
// is frozen then too, so the static painted backdrop is what ships).

import * as THREE from 'three'
import type { RealmBackdrop } from '../game/realmBackdrops'

// Per-frame drive from BattleView3D (all view state — no sim coupling).
export interface AtmosphereCtx {
  clockT: number
  camBaseAngle: number // camera ambient sway (rad); layers offset a few px against it
  tension: number // 0..1 wave/boss approach → warm & thicken the sky
  reactionFade: number // 0..1, 1 = a big reaction burst is owning the frame → recede
}

// ---- per-realm layer recipe ------------------------------------------------
type Blend = 'add' | 'normal'
type ParticleKind = 'rise' | 'fall' | 'float'
interface BandSpec {
  tex: 'glow' | 'aurora' | 'shaft' | 'fog' | 'cloud'
  color: number
  radius: number // arc radius (board is ~5.5, painted cylinder is 32)
  y: number
  height: number
  opacity: number
  blend: Blend
  pulse?: number // opacity breathing amplitude
  pulseHz?: number
  hueDrift?: number // aurora hue wobble (0..1)
  scroll?: number // horizontal drift speed (cloud/fog scud)
  lightning?: boolean // rare luminance swell (storm) — a swell, never a white strobe
  parallax: number // lateral sway multiplier vs camBaseAngle
}
interface RealmAtmoCfg {
  particle?: { color: number; count: number; kind: ParticleKind; size: number; spanY: [number, number] }
  bands?: BandSpec[]
  critter?: { color: number; count: number; scale: number; speed: number }
  ridge?: { color: number; radius: number; y: number; height: number; shape: 'mesa' | 'peaks' | 'trees' | 'crags' | 'spires' | 'drift' }
  frame: 'branches' | 'crags' | 'peaks' | 'canopy' | 'pillars' | 'spires'
}

// Recessive by construction: colours below are already muted; the builders desaturate
// and darken them further so nothing here competes with the play plane.
// Part D tail: the ADDITIVE light bands (glow/aurora/shaft) were authored ~1.5× lower
// to "hold everything desaturated" alongside the old colour floor — with the floor
// raised (D1) they were suppressing the painted world's own atmosphere, so their
// opacities are lifted ~1.5× to deepen each realm with COLOURED light. The dark
// normal-blend overlays (stormpeaks cloud / umbralvoid fog) are left as-is: raising
// those greys the world rather than enriching it. Judged under the bloom threshold
// (0.72) so nothing blows out.
const REALMS: Record<string, RealmAtmoCfg> = {
  emberwaste: {
    particle: { color: 0xff9a4a, count: 60, kind: 'rise', size: 0.07, spanY: [1.5, 12] },
    bands: [{ tex: 'glow', color: 0xff7a2c, radius: 22, y: 1.4, height: 6, opacity: 0.24, blend: 'add', pulse: 0.06, pulseHz: 0.5, parallax: 0.18 }],
    critter: { color: 0x2a1c22, count: 2, scale: 0.5, speed: 0.5 },
    ridge: { color: 0x6b4636, radius: 19, y: 6, height: 22, shape: 'mesa' },
    frame: 'branches',
  },
  frostreach: {
    particle: { color: 0xd6ecff, count: 80, kind: 'fall', size: 0.06, spanY: [1, 13] },
    bands: [{ tex: 'aurora', color: 0x6cc6e8, radius: 24, y: 9, height: 12, opacity: 0.18, blend: 'add', pulse: 0.05, pulseHz: 0.22, hueDrift: 0.5, parallax: 0.1 }],
    critter: { color: 0x2b3440, count: 2, scale: 0.5, speed: 0.45 },
    ridge: { color: 0x8fa8be, radius: 19, y: 6, height: 22, shape: 'drift' },
    frame: 'crags',
  },
  stormpeaks: {
    particle: { color: 0xbfb4d8, count: 46, kind: 'float', size: 0.06, spanY: [2, 12] },
    bands: [
      { tex: 'cloud', color: 0x6a5f80, radius: 23, y: 8.5, height: 10, opacity: 0.2, blend: 'normal', scroll: 0.03, parallax: 0.14 },
      { tex: 'glow', color: 0x9a86d8, radius: 21, y: 7, height: 9, opacity: 0.0, blend: 'add', lightning: true, parallax: 0.1 },
    ],
    critter: { color: 0x2a2836, count: 2, scale: 0.48, speed: 0.55 },
    ridge: { color: 0x6a6480, radius: 18.5, y: 6.5, height: 24, shape: 'peaks' },
    frame: 'peaks',
  },
  verdantwilds: {
    particle: { color: 0xc8e89a, count: 66, kind: 'float', size: 0.06, spanY: [1, 10] },
    bands: [{ tex: 'shaft', color: 0xbfe57a, radius: 22, y: 8, height: 14, opacity: 0.15, blend: 'add', pulse: 0.05, pulseHz: 0.3, parallax: 0.16 }],
    critter: { color: 0x24301f, count: 3, scale: 0.44, speed: 0.6 },
    ridge: { color: 0x3f5a3a, radius: 18.5, y: 6.5, height: 24, shape: 'trees' },
    frame: 'canopy',
  },
  radiantsanctum: {
    particle: { color: 0xffe9b0, count: 54, kind: 'float', size: 0.07, spanY: [1.5, 12] },
    bands: [
      { tex: 'shaft', color: 0xf0d68a, radius: 23, y: 9, height: 16, opacity: 0.18, blend: 'add', pulse: 0.06, pulseHz: 0.18, parallax: 0.14 },
      { tex: 'shaft', color: 0xffe6a8, radius: 20, y: 8, height: 15, opacity: 0.12, blend: 'add', pulse: 0.06, pulseHz: 0.24, parallax: 0.2 },
    ],
    critter: { color: 0x3a3020, count: 2, scale: 0.46, speed: 0.4 },
    ridge: { color: 0x9a8a64, radius: 19, y: 7, height: 22, shape: 'spires' },
    frame: 'pillars',
  },
  umbralvoid: {
    particle: { color: 0xb79ad8, count: 58, kind: 'rise', size: 0.06, spanY: [1, 12] },
    bands: [{ tex: 'fog', color: 0x2a1f3a, radius: 20, y: 3.5, height: 8, opacity: 0.26, blend: 'normal', scroll: 0.02, parallax: 0.22 }],
    critter: { color: 0x1a1424, count: 2, scale: 0.5, speed: 0.32 },
    ridge: { color: 0x413255, radius: 18.5, y: 6.5, height: 24, shape: 'crags' },
    frame: 'spires',
  },
}

// A far critter — bird/insect silhouette — must never read as a flying ENEMY (those
// are billboards at unit scale/saturation). Kept far, small, dark, high near the
// horizon, on a smooth drift so peripheral movement = "alive," not "incoming."
interface Critter {
  sprite: THREE.Sprite
  mat: THREE.SpriteMaterial
  baseX: number
  y: number
  z: number
  vx: number
  phase: number
  flap: number
}

export class RealmAtmosphere {
  private group = new THREE.Group() // world-fixed layers (natural parallax by radius)
  private frameMesh?: THREE.Mesh // camera-locked foreground vignette
  private disposables: Array<{ dispose(): void }> = []
  private particles?: THREE.Points
  private pPos?: Float32Array
  private pSeed?: Float32Array // baseX, baseZ, phase, speed
  private pMat?: THREE.PointsMaterial
  private pCount = 0
  private pKind: ParticleKind = 'float'
  private pSpanY: [number, number] = [1, 12]
  private bands: Array<{ mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; spec: BandSpec; base: THREE.Color; flick: number }> = []
  private ridgeMesh?: THREE.Mesh
  private ridgeSway = 0
  private critters: Critter[] = []
  private lowPerf: boolean

  private frameDepth = 1.2 // camera-space distance of the foreground frame

  constructor(
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    backdrop: RealmBackdrop,
    private motionOk: boolean,
  ) {
    const cfg = REALMS[backdrop.key] ?? REALMS.emberwaste
    // Coarse mobile heuristic — trims the fill-rate budget (fewer particles/critters).
    this.lowPerf = typeof window !== 'undefined' && (window.innerWidth < 820 || 'ontouchstart' in window)

    this.group.renderOrder = -1
    this.scene.add(this.group)

    // reduce-motion → NOTHING added: collapse to exactly the static painted backdrop
    // that ships today (the accessibility contract), no extra ridge/frame to differ.
    if (this.motionOk) {
      if (cfg.ridge) this.buildRidge(cfg.ridge)
      this.buildFrame(cfg.frame)
      if (cfg.particle) this.buildParticles(cfg.particle)
      if (cfg.bands) for (const b of cfg.bands) this.buildBand(b)
      if (cfg.critter) this.buildCritters(cfg.critter)
    }
  }

  // ---- desaturate + darken so a layer stays recessive & under the bloom threshold
  private mute(hex: number, keep: number, lum: number): THREE.Color {
    const c = new THREE.Color(hex)
    const grey = (c.r + c.g + c.b) / 3
    c.lerp(new THREE.Color(grey, grey, grey), 1 - keep) // pull toward its own grey
    c.multiplyScalar(lum)
    return c
  }

  // ---- curved arc, matching the painted cylinder so it reads at every pan angle ---
  private makeArc(radius: number, height: number, yCenter: number): THREE.CylinderGeometry {
    const arc = 170 * Math.PI / 180
    const geo = new THREE.CylinderGeometry(radius, radius, height, 28, 1, true, Math.PI - arc / 2, arc)
    this.disposables.push(geo)
    void yCenter
    return geo
  }

  // ---- procedural canvas textures (cheap, disposed with the instance) ------------
  private canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
    const cv = document.createElement('canvas')
    cv.width = w
    cv.height = h
    return [cv, cv.getContext('2d')!]
  }
  private toTex(cv: HTMLCanvasElement): THREE.CanvasTexture {
    const t = new THREE.CanvasTexture(cv)
    t.colorSpace = THREE.SRGBColorSpace
    t.wrapS = THREE.ClampToEdgeWrapping
    t.wrapT = THREE.ClampToEdgeWrapping
    this.disposables.push(t)
    return t
  }

  // Rolling silhouette (bottom-anchored, soft alpha above) for the mid parallax band.
  private ridgeTexture(shape: string, col: THREE.Color): THREE.CanvasTexture {
    const [cv, ctx] = this.canvas(1024, 256)
    const hex = '#' + col.getHexString()
    ctx.clearRect(0, 0, 1024, 256)
    ctx.fillStyle = hex
    ctx.beginPath()
    ctx.moveTo(0, 256)
    const seed = shape.length * 7.3
    const n = 24
    for (let i = 0; i <= n; i++) {
      const x = (i / n) * 1024
      let hgt: number
      // one horizon profile per realm — all kept low & soft, pure recessive silhouette
      switch (shape) {
        case 'peaks': hgt = 60 + Math.abs(Math.sin(i * 1.3 + seed)) * 130 + Math.sin(i * 0.7) * 20; break
        case 'spires': hgt = 50 + (i % 3 === 0 ? 120 : 40) + Math.sin(i + seed) * 15; break
        case 'trees': hgt = 70 + Math.abs(Math.sin(i * 2.1 + seed)) * 40 + (i % 2 ? 25 : 0); break
        case 'crags': hgt = 70 + Math.sin(i * 1.7 + seed) * 55 + Math.cos(i * 0.9) * 30; break
        case 'drift': hgt = 55 + Math.sin(i * 0.6 + seed) * 30; break
        default: hgt = 60 + Math.sin(i * 0.8 + seed) * 45 + Math.sin(i * 0.31) * 18 // mesa
      }
      ctx.lineTo(x, 256 - Math.max(20, hgt))
    }
    ctx.lineTo(1024, 256)
    ctx.closePath()
    ctx.fill()
    // soft top edge so the ridge dissolves into the painted horizon (no hard cut)
    const g = ctx.createLinearGradient(0, 40, 0, 200)
    g.addColorStop(0, 'rgba(0,0,0,0.35)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.globalCompositeOperation = 'destination-out'
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 1024, 200)
    ctx.globalCompositeOperation = 'source-over'
    return this.toTex(cv)
  }

  // Bands bake their SHAPE in white; the (muted) colour rides on the material, so
  // hue-drift, tension-warming and pulse all drive through one channel at runtime.
  private bandTexture(kind: string): THREE.CanvasTexture {
    const [cv, ctx] = this.canvas(512, 256)
    const hex = '#ffffff'
    ctx.clearRect(0, 0, 512, 256)
    if (kind === 'glow') {
      const g = ctx.createLinearGradient(0, 256, 0, 0)
      g.addColorStop(0, hex); g.addColorStop(0.5, hex); g.addColorStop(1, 'rgba(0,0,0,0)')
      // fade to transparent at the horizontal edges (no seam at the arc ends)
      ctx.fillStyle = g; ctx.fillRect(0, 0, 512, 256)
      this.edgeFade(ctx)
    } else if (kind === 'aurora' || kind === 'shaft') {
      // vertical soft columns — breathing light. Narrow, banded (low overdraw).
      const cols = kind === 'shaft' ? 5 : 7
      for (let i = 0; i < cols; i++) {
        const x = (i + 0.5) / cols * 512 + (i * 37 % 40) - 20
        const w = kind === 'shaft' ? 26 : 46
        const g = ctx.createLinearGradient(x, 0, x, 256)
        g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, hex); g.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = g; ctx.fillRect(x - w / 2, 0, w, 256)
      }
      this.edgeFade(ctx)
    } else if (kind === 'cloud' || kind === 'fog') {
      // lumpy horizontal band — soft blobs. Wrap-safe for horizontal scroll.
      for (let i = 0; i < 26; i++) {
        const x = (i / 26) * 512
        const y = 60 + Math.sin(i * 1.7) * 40 + Math.cos(i * 0.9) * 30
        const r = 50 + (i * 53 % 60)
        const g = ctx.createRadialGradient(x, y, 0, x, y, r)
        g.addColorStop(0, hex); g.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2)
      }
    }
    const t = this.toTex(cv)
    if (kind === 'cloud' || kind === 'fog') t.wrapS = THREE.RepeatWrapping
    return t
  }

  private edgeFade(ctx: CanvasRenderingContext2D): void {
    const g = ctx.createLinearGradient(0, 0, 512, 0)
    g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.14, 'rgba(0,0,0,0)')
    g.addColorStop(0.86, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,1)')
    ctx.globalCompositeOperation = 'destination-out'
    ctx.fillStyle = g; ctx.fillRect(0, 0, 512, 256)
    ctx.globalCompositeOperation = 'source-over'
  }

  // Dark, soft, blurred corner frame — the Kingdom Rush diorama trick. Corners ONLY,
  // so it deepens the frame without ever covering the play area.
  private frameTexture(style: string): THREE.CanvasTexture {
    const [cv, ctx] = this.canvas(512, 512)
    ctx.clearRect(0, 0, 512, 512)
    ctx.fillStyle = '#0a0710'
    ctx.filter = 'blur(6px)' // cheap depth-of-field — baked once, not per-frame
    const corner = (cx: number, cy: number, dir: number) => {
      ctx.save(); ctx.translate(cx, cy)
      ctx.beginPath()
      if (style === 'branches' || style === 'canopy') {
        // gnarled boughs / leaf clumps reaching in from the top corners
        ctx.moveTo(0, 0)
        for (let a = 0; a < 5; a++) {
          const ang = dir * (0.2 + a * 0.32)
          const len = 150 + a * 20
          ctx.lineTo(Math.cos(ang) * len, Math.abs(Math.sin(ang)) * len + 30)
          if (style === 'canopy') ctx.arc(Math.cos(ang) * len, Math.abs(Math.sin(ang)) * len + 30, 34, 0, Math.PI * 2)
        }
        ctx.lineTo(0, 200); ctx.closePath()
      } else {
        // rock / peak / pillar / spire mass — a soft triangular wedge from the corner
        ctx.moveTo(0, 0)
        ctx.lineTo(dir * 210, 0)
        ctx.lineTo(dir * (style === 'spires' || style === 'peaks' ? 40 : 120), 230)
        ctx.lineTo(0, 170)
        ctx.closePath()
      }
      ctx.fill(); ctx.restore()
    }
    corner(0, 0, 1) // top-left
    corner(512, 0, -1) // top-right
    // a lighter base weight in the bottom corners (keeps the center clear of the dock)
    ctx.globalAlpha = 0.7
    corner(0, 512, 1); corner(512, 512, -1)
    ctx.globalAlpha = 1
    ctx.filter = 'none'
    return this.toTex(cv)
  }

  // ---- layer builders ------------------------------------------------------------
  private buildRidge(r: NonNullable<RealmAtmoCfg['ridge']>): void {
    const col = this.mute(r.color, 0.35, 0.5) // heavily desaturated & darkened
    const tex = this.ridgeTexture(r.shape, col)
    const geo = this.makeArc(r.radius, r.height, r.y)
    const mat = new THREE.MeshBasicMaterial({
      map: tex, color: 0xffffff, side: THREE.BackSide, transparent: true, opacity: 0.85,
      depthWrite: false, fog: false, // depthTest ON: the board correctly occludes its foot
    })
    this.disposables.push(mat)
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.y = r.y
    mesh.renderOrder = -0.9 // painted cylinder (-1) → ridge → board (0)
    mesh.frustumCulled = false
    this.ridgeMesh = mesh
    this.group.add(mesh)
  }

  private buildBand(spec: BandSpec): void {
    const col = spec.blend === 'add' ? this.mute(spec.color, 0.6, 0.55) : this.mute(spec.color, 0.5, 0.6)
    const tex = this.bandTexture(spec.tex)
    const geo = this.makeArc(spec.radius, spec.height, spec.y)
    const mat = new THREE.MeshBasicMaterial({
      map: tex, color: col, side: THREE.BackSide, transparent: true, opacity: spec.opacity,
      depthWrite: false, fog: false,
      blending: spec.blend === 'add' ? THREE.AdditiveBlending : THREE.NormalBlending,
    })
    this.disposables.push(mat)
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.y = spec.y
    mesh.renderOrder = spec.blend === 'add' ? -0.5 : -0.8
    mesh.frustumCulled = false
    this.group.add(mesh)
    this.bands.push({ mesh, mat, spec, base: col.clone(), flick: 0 })
  }

  private buildParticles(p: NonNullable<RealmAtmoCfg['particle']>): void {
    const count = Math.round(p.count * (this.lowPerf ? 0.55 : 1))
    this.pCount = count
    this.pKind = p.kind
    this.pSpanY = p.spanY
    const geo = new THREE.BufferGeometry()
    this.pPos = new Float32Array(count * 3)
    this.pSeed = new Float32Array(count * 4)
    for (let i = 0; i < count; i++) {
      this.pSeed[i * 4] = (Math.random() - 0.5) * 26 // baseX (spread wide, behind board)
      this.pSeed[i * 4 + 1] = -8 - Math.random() * 14 // baseZ (parked on the −z backdrop side)
      this.pSeed[i * 4 + 2] = Math.random() * Math.PI * 2
      this.pSeed[i * 4 + 3] = 0.3 + Math.random() * 0.8 // drift/rise speed
    }
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3))
    this.disposables.push(geo)
    const col = this.mute(p.color, 0.6, 0.6) // desaturated + dim so additive stacks stay under bloom
    this.pMat = new THREE.PointsMaterial({
      color: col, size: p.size, transparent: true, opacity: 0.45,
      blending: p.kind === 'fall' ? THREE.NormalBlending : THREE.AdditiveBlending,
      depthWrite: false, sizeAttenuation: true,
    })
    this.disposables.push(this.pMat)
    this.particles = new THREE.Points(geo, this.pMat)
    this.particles.renderOrder = -0.4
    this.particles.frustumCulled = false
    this.group.add(this.particles)
    this.stepParticles(0)
  }

  private buildCritters(c: NonNullable<RealmAtmoCfg['critter']>): void {
    const count = this.lowPerf ? Math.max(1, c.count - 1) : c.count
    const col = this.mute(c.color, 0.5, 0.45)
    const tex = this.critterTexture(col)
    for (let i = 0; i < count; i++) {
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.4, depthWrite: false, fog: false })
      this.disposables.push(mat)
      const sprite = new THREE.Sprite(mat)
      const scale = c.scale * (0.8 + Math.random() * 0.5)
      sprite.scale.set(scale, scale * 0.5, 1)
      const baseX = (Math.random() - 0.5) * 24
      const y = 8 + Math.random() * 6 // high, near the horizon — never in the board plane
      const z = -14 - Math.random() * 8
      sprite.position.set(baseX, y, z)
      sprite.renderOrder = -0.3
      this.group.add(sprite)
      this.critters.push({
        sprite, mat, baseX, y, z,
        vx: c.speed * (Math.random() < 0.5 ? -1 : 1) * (0.7 + Math.random() * 0.6),
        phase: Math.random() * Math.PI * 2, flap: c.scale,
      })
    }
  }

  private critterTexture(col: THREE.Color): THREE.CanvasTexture {
    const [cv, ctx] = this.canvas(64, 32)
    ctx.clearRect(0, 0, 64, 32)
    ctx.strokeStyle = '#' + col.getHexString()
    ctx.lineWidth = 4
    ctx.lineCap = 'round'
    // a simple far-away "M" gull silhouette — reads as a bird, not an enemy
    ctx.beginPath()
    ctx.moveTo(8, 20); ctx.quadraticCurveTo(24, 6, 32, 18)
    ctx.quadraticCurveTo(40, 6, 56, 20)
    ctx.stroke()
    return this.toTex(cv)
  }

  private buildFrame(style: string): void {
    const tex = this.frameTexture(style)
    // A unit plane locked to the camera at a fixed near depth → always frames the
    // corners, regardless of pan/orbit/zoom. Scaled to the exact frustum each frame
    // (see fitFrame) so the texture corners land on the SCREEN corners at any aspect
    // (critical for mobile portrait). depthTest OFF so it draws over the board edges;
    // its center is transparent, so it never covers the play area.
    const geo = new THREE.PlaneGeometry(1, 1)
    this.disposables.push(geo)
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, opacity: 0.72, depthTest: false, depthWrite: false, fog: false,
    })
    this.disposables.push(mat)
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(0, 0, -this.frameDepth) // just in front of the near clip
    mesh.renderOrder = 20 // over everything
    mesh.frustumCulled = false
    this.frameMesh = mesh
    this.fitFrame()
    this.camera.add(mesh)
    // camera renders its children only when it's part of the scene graph
    if (!this.camera.parent) this.scene.add(this.camera)
  }

  // Scale the frame to cover the camera frustum at frameDepth (+4% overscan), so the
  // corner art frames the true screen corners on every aspect (desktop → mobile).
  // UNIFORM ("cover") scale, not per-axis stretch: the source texture is square
  // (512x512). Scaling it non-uniformly to exactly fill an arbitrary-aspect frustum
  // stretches the corner wedges — on tall/narrow phone aspects that stretch pushes
  // the top-left/top-right wedges far enough down and inward that they visually merge
  // into a single dark trapezoid band across the upper board. A uniform max(halfW,
  // halfH) scale keeps the corner art's own proportions intact (harmless overscan
  // beyond the frustum on the shorter axis) while still fully covering every corner.
  private fitFrame(): void {
    if (!this.frameMesh) return
    const halfH = this.frameDepth * Math.tan((this.camera.fov * Math.PI / 180) / 2)
    const halfW = halfH * this.camera.aspect
    const half = Math.max(halfW, halfH)
    this.frameMesh.scale.set(half * 2 * 1.04, half * 2 * 1.04, 1)
  }

  // ---- per-frame update ----------------------------------------------------------
  update(dt: number, ctx: AtmosphereCtx): void {
    this.fitFrame() // track aspect/resize (frame persists as a static vignette even reduced)
    if (!this.motionOk) return
    const sway = Math.sin(ctx.camBaseAngle)
    const recede = 1 - ctx.reactionFade * 0.8 // big reaction burst → ambient recedes
    const warm = ctx.tension // 0..1

    if (this.ridgeMesh) this.ridgeMesh.rotation.y = sway * 0.06

    // particles
    if (this.particles && this.pPos && this.pSeed) {
      this.stepParticles(ctx.clockT)
      if (this.pMat) this.pMat.opacity = 0.45 * recede
      this.particles.rotation.y = sway * 0.08
    }

    // bands
    for (const b of this.bands) {
      const s = b.spec
      let op = s.opacity
      if (s.pulse) op += Math.sin(ctx.clockT * (s.pulseHz ?? 0.3) * Math.PI * 2) * s.pulse
      if (s.lightning) {
        // rare, brief luminance SWELL (never a white strobe): decay a flick counter,
        // reseed on a deterministic-ish schedule keyed to the clock.
        b.flick = Math.max(0, b.flick - dt * 2.2)
        const t = ctx.clockT
        if (b.flick <= 0 && (t % 3.3) < dt * 1.2) b.flick = 0.5 + (Math.sin(t * 12.7) * 0.5 + 0.5) * 0.4
        op = b.flick * (0.4 + warm * 0.4)
      }
      if (s.hueDrift) {
        // oscillate hue AROUND the base (not a random walk) so the mood stays anchored
        const hsl = { h: 0, s: 0, l: 0 }
        b.base.getHSL(hsl)
        b.mat.color.setHSL((hsl.h + Math.sin(ctx.clockT * 0.08) * 0.05 * s.hueDrift + 1) % 1, hsl.s, hsl.l)
      }
      if (s.scroll && b.mat.map) b.mat.map.offset.x = (ctx.clockT * s.scroll) % 1
      // warm/thicken toward the boss: glow & fog gain a little presence as tension rises
      const warmGain = s.blend === 'add' ? 1 + warm * 0.5 : 1 + warm * 0.25
      b.mat.opacity = Math.max(0, op) * recede * warmGain
      b.mesh.rotation.y = sway * s.parallax
    }

    // critters — smooth lateral drift with a gentle wing-flap; wrap at the edges
    for (const cr of this.critters) {
      cr.baseX += cr.vx * dt
      if (cr.baseX > 15) cr.baseX = -15
      else if (cr.baseX < -15) cr.baseX = 15
      const bob = Math.sin(ctx.clockT * 0.7 + cr.phase) * 0.4
      cr.sprite.position.x = cr.baseX + sway * 0.3
      cr.sprite.position.y = cr.y + bob
      const flap = 1 + Math.sin(ctx.clockT * 5 + cr.phase) * 0.12
      const sc = cr.flap * (0.8 + Math.sin(cr.phase) * 0.2)
      cr.sprite.scale.set(sc, sc * 0.5 * flap, 1)
      cr.mat.opacity = 0.4 * recede
    }

    // foreground frame: a whisper of sway parallax (it's camera-locked, so this is a
    // tiny counter-drift that sells the depth) + recede during reaction bursts
    if (this.frameMesh) {
      this.frameMesh.position.x = -sway * 0.05
      ;(this.frameMesh.material as THREE.MeshBasicMaterial).opacity = 0.72 * (1 - ctx.reactionFade * 0.4)
    }
  }

  private stepParticles(t: number): void {
    if (!this.pPos || !this.pSeed) return
    const [y0, y1] = this.pSpanY
    const span = y1 - y0
    for (let i = 0; i < this.pCount; i++) {
      const bx = this.pSeed[i * 4]
      const bz = this.pSeed[i * 4 + 1]
      const ph = this.pSeed[i * 4 + 2]
      const sp = this.pSeed[i * 4 + 3]
      let y: number
      if (this.pKind === 'rise') y = y0 + ((t * sp * 0.6 + ph) % span)
      else if (this.pKind === 'fall') y = y1 - ((t * sp * 0.6 + ph) % span)
      else y = y0 + span * (0.5 + Math.sin(t * sp * 0.3 + ph) * 0.5)
      this.pPos[i * 3] = bx + Math.sin(t * 0.25 * sp + ph) * 1.2
      this.pPos[i * 3 + 1] = y
      this.pPos[i * 3 + 2] = bz + Math.cos(t * 0.2 * sp + ph * 1.3) * 0.9
    }
    if (this.particles) (this.particles.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
  }

  dispose(): void {
    if (this.frameMesh) this.camera.remove(this.frameMesh)
    this.scene.remove(this.group)
    for (const d of this.disposables) d.dispose()
    this.disposables.length = 0
    this.bands.length = 0
    this.critters.length = 0
  }
}
