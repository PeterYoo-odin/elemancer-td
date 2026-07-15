// wyrmArt — the painted Chromatic Wyrm sprite layer (public/concepts/dragons/*).
// Two consumers: URL lookups for DOM cards (Bond screen / codex) and a cached,
// transparent-background billboard <canvas> for the in-battle flying companion
// token. Every asset is processed at most once and cached; nothing runs per
// frame. A missing file degrades gracefully (callers fall back to a glyph).

import { WYRMS, wyrmById } from '../game/wyrms'
import { artUrl, artMiss } from './webp'

const BASE = import.meta.env.BASE_URL + 'concepts/dragons/'

export function wyrmArtUrl(wyrmId: string): string | null {
  const w = wyrmById(wyrmId)
  return w ? BASE + w.file : null
}

function loadOne(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image load failed: ' + url))
    img.src = url
  })
}

/** WebP-first (≈93% smaller), falling back to the original PNG on a miss. */
function loadImage(pngUrl: string): Promise<HTMLImageElement> {
  const preferred = artUrl(pngUrl)
  return preferred === pngUrl ? loadOne(pngUrl) : loadOne(preferred).catch(() => loadOne(pngUrl))
}

export interface WyrmCutout {
  canvas: HTMLCanvasElement
  aspect: number // width / height of the trimmed cutout
}

const CUTOUT_H = 512
const BG_TOL = 40 // colour distance counted as the flat sprite background

const cutoutCache = new Map<string, Promise<WyrmCutout | null>>()

/** Cached, background-keyed cutout canvas for the flying-Wyrm billboard token. */
export function wyrmCutout(wyrmId: string): Promise<WyrmCutout | null> {
  let p = cutoutCache.get(wyrmId)
  if (!p) {
    p = buildCutout(wyrmId).catch(() => { artMiss('wyrm art', wyrmId); return null })
    cutoutCache.set(wyrmId, p)
  }
  return p
}

async function buildCutout(wyrmId: string): Promise<WyrmCutout | null> {
  const url = wyrmArtUrl(wyrmId)
  if (!url) return null
  const img = await loadImage(url)
  const scale = Math.min(1, CUTOUT_H / img.naturalHeight)
  const w = Math.max(1, Math.round(img.naturalWidth * scale))
  const h = Math.max(1, Math.round(img.naturalHeight * scale))
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d', { willReadFrequently: true })
  if (!g) return null
  g.drawImage(img, 0, 0, w, h)
  const data = g.getImageData(0, 0, w, h)
  const px = data.data

  // The dragon PNGs may already be transparent (alpha) OR ship on a flat plate.
  // Reference the four corners; if they are near-transparent we trust the alpha,
  // otherwise flood a background key from the borders.
  const corner = (x: number, y: number): number => (y * w + x) * 4
  const corners = [corner(0, 0), corner(w - 1, 0), corner(0, h - 1), corner(w - 1, h - 1)]
  const cornerAlpha = corners.reduce((s, i) => s + px[i + 3], 0) / corners.length
  if (cornerAlpha > 24) {
    // flat plate → key out the border colour with a border flood fill
    let br = 0, bg = 0, bb = 0
    for (const i of corners) { br += px[i]; bg += px[i + 1]; bb += px[i + 2] }
    br /= 4; bg /= 4; bb /= 4
    const stack: number[] = []
    const seen = new Uint8Array(w * h)
    const pushIf = (x: number, y: number): void => {
      if (x < 0 || y < 0 || x >= w || y >= h) return
      const idx = y * w + x
      if (seen[idx]) return
      seen[idx] = 1
      const i = idx * 4
      const d = Math.abs(px[i] - br) + Math.abs(px[i + 1] - bg) + Math.abs(px[i + 2] - bb)
      if (d <= BG_TOL * 3) { px[i + 3] = 0; stack.push(x, y) }
    }
    for (let x = 0; x < w; x++) { pushIf(x, 0); pushIf(x, h - 1) }
    for (let y = 0; y < h; y++) { pushIf(0, y); pushIf(w - 1, y) }
    while (stack.length) {
      const y = stack.pop() as number
      const x = stack.pop() as number
      pushIf(x + 1, y); pushIf(x - 1, y); pushIf(x, y + 1); pushIf(x, y - 1)
    }
    g.putImageData(data, 0, 0)
  }

  // trim to the opaque bounds
  let minX = w, minY = h, maxX = 0, maxY = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (px[(y * w + x) * 4 + 3] > 16) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < minX || maxY < minY) return { canvas: c, aspect: w / h }
  const tw = maxX - minX + 1
  const th = maxY - minY + 1
  const trimmed = document.createElement('canvas')
  trimmed.width = tw
  trimmed.height = th
  const tg = trimmed.getContext('2d')
  if (!tg) return { canvas: c, aspect: w / h }
  tg.drawImage(c, minX, minY, tw, th, 0, 0, tw, th)
  return { canvas: trimmed, aspect: tw / th }
}

// eslint hint: WYRMS is referenced so a missing manifest is a hard compile error
void WYRMS
