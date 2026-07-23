// enemyArt — painted "greyling" enemy sprites (public/concepts/enemies/*).
// These are hand-painted transparent PNG cutouts (grey/ashen corrupted creatures,
// each with a signature Greying accent glow), wired into BattleView3D as
// camera-facing billboards that REPLACE the old primitive-shape enemy meshes.
//
// Unlike heroArt's cutout path, no background keying is needed — the PNGs already
// ship with a clean alpha channel, so we load them straight into a texture.
// Every archetype is decoded at most once and cached; nothing here runs per frame.

import * as THREE from 'three'
import { artUrl, artMiss, artBound } from './webp'
import type { EnemyKind } from '../game/enemies'

const BASE = import.meta.env.BASE_URL + 'concepts/enemies/'

interface EnemyArtDef {
  file: string
  accent: number // signature Greying accent glow (matches manifest.json)
}

// EnemyKind → painted sprite + accent. This is a TOTAL Record over EnemyKind (D2):
// every one of the sim's eleven kinds has its own painted-art contract, so adding a
// new kind without wiring its sprite is a COMPILE ERROR, not a silent primitive.
//   grunt   → grunt.png   (amber)      · the ashen foot-soldier of level 1
//   keeper  → keeper.png  (violet)     · sub-boss silhouette, own set-piece art
//   boss    → boss.png    (magenta)    · the Morose Titan, scaled to fill the arena
// grunt/keeper/boss PNGs are generated in parallel with this wiring — until they
// land, each degrades SAFELY: pose 404 → loud artMiss → base-sprite 404 → loud
// artMiss → primitive mesh kept (crash-safe, never blanks a unit). juicecheck's
// positive enemy-pose assertion is gated on the file existing on disk, so a
// not-yet-shipped sprite never turns CI red — but a REGRESSION on an existing
// sprite (a 404 that fails soft) does. See scripts/juicecheck.ts.
const ENEMY_ART: Record<EnemyKind, EnemyArtDef> = {
  runner: { file: 'runner.png', accent: 0x7fe05a },
  grunt: { file: 'grunt.png', accent: 0xff9b2f },
  brute: { file: 'brute.png', accent: 0xe8a23c },
  flyer: { file: 'flyer.png', accent: 0x63d6e0 },
  shielded: { file: 'shielded.png', accent: 0xb07de0 },
  healer: { file: 'healer.png', accent: 0x4fd6b0 },
  swarm: { file: 'swarm.png', accent: 0xe8d24a },
  armored: { file: 'armored.png', accent: 0x7fa8d6 },
  elite: { file: 'elite.png', accent: 0xe0507d },
  keeper: { file: 'keeper.png', accent: 0xc9b6ff },
  boss: { file: 'boss.png', accent: 0xff4db8 },
}

export interface EnemyFrame {
  tex: THREE.Texture
  aspect: number // width / height of the frame
  relH: number // frame height relative to WALK-A (frames share a pixel scale)
}

/** Painted pose frames: 2-frame walk cycle + a hit-flinch, cel-shaded cutouts
 *  under concepts/enemies/poses/. Textures are SHARED per kind (billboards
 *  swap `material.map` between shared textures — no per-entity allocs). */
export interface EnemyFrames {
  walkA: EnemyFrame
  walkB: EnemyFrame
  hit: EnemyFrame
}

export interface EnemyArt {
  tex: THREE.Texture // walk-A when pose frames landed; legacy single sprite otherwise
  aspect: number // width / height of `tex`
  accent: number
  frames: EnemyFrames | null // null → legacy single-frame billboard
}

/** Signature accent colour for a kind, available synchronously (no decode). */
export function enemyAccent(kind: EnemyKind): number | null {
  return ENEMY_ART[kind]?.accent ?? null
}

function loadOne(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('enemy art load failed: ' + url))
    img.src = url
  })
}

/** WebP-first (≈93% smaller), falling back to the original PNG on a miss. */
function loadImage(pngUrl: string): Promise<HTMLImageElement> {
  const preferred = artUrl(pngUrl)
  return preferred === pngUrl ? loadOne(pngUrl) : loadOne(preferred).catch(() => loadOne(pngUrl))
}

const cache = new Map<EnemyKind, Promise<EnemyArt | null>>()
const resolved = new Map<EnemyKind, EnemyArt>() // decoded art for sync consumers (fxDeath)

/** Cached, camera-facing billboard texture for an enemy kind (null → keep mesh). */
export function enemyArt(kind: EnemyKind): Promise<EnemyArt | null> {
  let p = cache.get(kind)
  if (!p) {
    p = build(kind).catch(() => { artMiss('enemy billboard', ENEMY_ART[kind]?.file ?? String(kind)); return null })
    cache.set(kind, p)
  }
  return p
}

/** Already-decoded art, or null — for FX (death ghost) that can't await. */
export function enemyArtReady(kind: EnemyKind): EnemyArt | null {
  return resolved.get(kind) ?? null
}

function makeTex(img: HTMLImageElement): THREE.Texture {
  const tex = new THREE.Texture(img)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  tex.needsUpdate = true
  return tex
}

// pose frames are decoded once per FILE prefix (keeper/boss reuse elite's) and
// shared by every kind that maps onto it
const POSE_BASE = BASE + 'poses/'
const framesCache = new Map<string, Promise<EnemyFrames | null>>()

function poseFrames(prefix: string): Promise<EnemyFrames | null> {
  let p = framesCache.get(prefix)
  if (!p) {
    p = buildFrames(prefix).catch(() => { artMiss('enemy pose art', prefix); return null })
    framesCache.set(prefix, p)
  }
  return p
}

async function buildFrames(prefix: string): Promise<EnemyFrames | null> {
  const [a, b, hit] = await Promise.all(
    ['walk-a', 'walk-b', 'hit'].map((f) => loadImage(`${POSE_BASE}${prefix}-${f}.png`)),
  )
  const frame = (img: HTMLImageElement): EnemyFrame => ({
    tex: makeTex(img),
    aspect: img.naturalWidth / Math.max(1, img.naturalHeight),
    relH: Math.max(0.7, Math.min(1.45, img.naturalHeight / Math.max(1, a.naturalHeight))),
  })
  artBound('enemy-pose', prefix)
  return { walkA: frame(a), walkB: frame(b), hit: frame(hit) }
}

async function build(kind: EnemyKind): Promise<EnemyArt | null> {
  const def = ENEMY_ART[kind]
  if (!def) return null
  const prefix = def.file.replace(/\.png$/, '')
  // painted pose frames first (walk×2 + hit); the legacy single-frame sprite
  // stays as the fallback rung so a missing pose file can never blank a unit —
  // and the miss is already reported LOUD by poseFrames().
  const frames = await poseFrames(prefix)
  if (frames) {
    const art: EnemyArt = { tex: frames.walkA.tex, aspect: frames.walkA.aspect, accent: def.accent, frames }
    resolved.set(kind, art)
    return art
  }
  const img = await loadImage(BASE + def.file)
  const art: EnemyArt = {
    tex: makeTex(img),
    aspect: img.naturalWidth / Math.max(1, img.naturalHeight),
    accent: def.accent,
    frames: null,
  }
  resolved.set(kind, art)
  return art
}
