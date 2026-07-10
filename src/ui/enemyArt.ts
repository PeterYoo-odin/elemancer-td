// enemyArt — painted "greyling" enemy sprites (public/concepts/enemies/*).
// These are hand-painted transparent PNG cutouts (grey/ashen corrupted creatures,
// each with a signature Greying accent glow), wired into BattleView3D as
// camera-facing billboards that REPLACE the old primitive-shape enemy meshes.
//
// Unlike heroArt's cutout path, no background keying is needed — the PNGs already
// ship with a clean alpha channel, so we load them straight into a texture.
// Every archetype is decoded at most once and cached; nothing here runs per frame.

import * as THREE from 'three'
import type { EnemyKind } from '../game/enemies'

const BASE = import.meta.env.BASE_URL + 'concepts/enemies/'

interface EnemyArtDef {
  file: string
  accent: number // signature Greying accent glow (matches manifest.json)
}

// EnemyKind → painted sprite + accent. The manifest ships eight archetypes; the
// sim's eleven kinds map on so every role reads at a glance:
//   armored → armored (steel-blue) · the Fortified rank-and-file, its own kind now
//   grunt   → no painted art (no dedicated asset) · falls back to its primitive
//             shape/colour, which stays visually distinct from armored's plate
//   elite   → elite   (crimson)    · the Warded veteran, its own kind now
//   keeper  → elite   (crimson)    · sub-boss silhouette, differentiated by its
//                                    per-Keeper crown retint + set-piece scale
//   boss    → elite   (crimson)    · the Morose Titan, scaled to fill the arena
// (keeper/boss reusing elite's art is safe — both are always clearly telegraphed
// by name/BOSS banner + huge scale, so there's no read-at-a-glance collision.)
const ENEMY_ART: Partial<Record<EnemyKind, EnemyArtDef>> = {
  runner: { file: 'runner.png', accent: 0x7fe05a },
  brute: { file: 'brute.png', accent: 0xe8a23c },
  flyer: { file: 'flyer.png', accent: 0x63d6e0 },
  shielded: { file: 'shielded.png', accent: 0xb07de0 },
  healer: { file: 'healer.png', accent: 0x4fd6b0 },
  swarm: { file: 'swarm.png', accent: 0xe8d24a },
  armored: { file: 'armored.png', accent: 0x7fa8d6 },
  elite: { file: 'elite.png', accent: 0xe0507d },
  keeper: { file: 'elite.png', accent: 0xe0507d },
  boss: { file: 'elite.png', accent: 0xe0507d },
}

export interface EnemyArt {
  tex: THREE.Texture
  aspect: number // width / height of the source PNG
  accent: number
}

/** Signature accent colour for a kind, available synchronously (no decode). */
export function enemyAccent(kind: EnemyKind): number | null {
  return ENEMY_ART[kind]?.accent ?? null
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('enemy art load failed: ' + url))
    img.src = url
  })
}

const cache = new Map<EnemyKind, Promise<EnemyArt | null>>()
const resolved = new Map<EnemyKind, EnemyArt>() // decoded art for sync consumers (fxDeath)

/** Cached, camera-facing billboard texture for an enemy kind (null → keep mesh). */
export function enemyArt(kind: EnemyKind): Promise<EnemyArt | null> {
  let p = cache.get(kind)
  if (!p) {
    p = build(kind).catch(() => null)
    cache.set(kind, p)
  }
  return p
}

/** Already-decoded art, or null — for FX (death ghost) that can't await. */
export function enemyArtReady(kind: EnemyKind): EnemyArt | null {
  return resolved.get(kind) ?? null
}

async function build(kind: EnemyKind): Promise<EnemyArt | null> {
  const def = ENEMY_ART[kind]
  if (!def) return null
  const img = await loadImage(BASE + def.file)
  const tex = new THREE.Texture(img)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  tex.needsUpdate = true
  const art: EnemyArt = {
    tex,
    aspect: img.naturalWidth / Math.max(1, img.naturalHeight),
    accent: def.accent,
  }
  resolved.set(kind, art)
  return art
}
