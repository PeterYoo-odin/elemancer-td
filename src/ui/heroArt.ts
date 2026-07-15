// heroArt — the painted hero portrait layer (public/concepts/*, Kingdom-Rush
// style on a pale-cream card background). Three consumers:
//   • heroArtUrl(): URL lookups for <img>/CSS portraits (collection cards,
//     party slots, battle HUD chips)
//   • heroCutout(): a cached, background-keyed cutout canvas for the in-battle
//     billboard token — flood-filled from the image borders so cream-ish
//     colours INSIDE the character (owl feathers, halos, flame cores) survive;
//     the painted drop-shadow is keyed with a wider low-chroma tolerance
//   • keyartBackdropUrl(): the title-screen key art with the artist's stray
//     signature mark inpainted out (grassfire fill + local blur), as a blob URL
// Every asset is processed at most once and cached — nothing here runs per frame.

import { artMiss } from './webp'

const BASE = import.meta.env.BASE_URL + 'concepts/'

// hero id (the save/sim key) → painted portrait file. All 8 heroes are painted;
// if a file is ever missing the loaders reject and every caller falls back to
// the element-gradient + glyph placeholder on its own.
const HERO_ART: Record<string, string> = {
  ember: 'hero-01-ashka-fire.jpg',
  glacia: 'hero-02-lumi-frost.jpg',
  zephyra: 'hero-03-galea-storm.jpg',
  sylvan: 'hero-04-thornwick-nature.jpg',
  aurelia: 'hero-05-seraphine-light.jpg',
  vex: 'hero-06-nyx-dark.jpg',
  volt: 'hero-07-fizz-arcane.jpg',
  pyra: 'hero-08-bramble-fire.jpg',
}

export const KEYART_URL = BASE + '00-keyart-v2.jpg'

export function heroArtUrl(heroId: string): string | null {
  const file = HERO_ART[heroId]
  return file ? BASE + file : null
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image load failed: ' + url))
    img.src = url
  })
}

// ---------------------------------------------------------------------------
// Battle-token cutout
// ---------------------------------------------------------------------------

export interface HeroCutout {
  canvas: HTMLCanvasElement
  aspect: number // width / height of the trimmed cutout
}

const CUTOUT_H = 512 // processing/output height — tokens render far smaller
const BG_TOL = 34 // colour distance counted as "the cream background"
// The painted ground shadow is a light, low-chroma wash — key it with a wider
// tolerance. Galea stands on a pale storm cloud that the wide rule would eat,
// so she keeps a conservative one.
const SHADOW_TOL_DEFAULT = 140
const SHADOW_TOL: Record<string, number> = { zephyra: 90 }

const cutoutCache = new Map<string, Promise<HeroCutout | null>>()

export function heroCutout(heroId: string): Promise<HeroCutout | null> {
  let p = cutoutCache.get(heroId)
  if (!p) {
    p = buildCutout(heroId).catch(() => { artMiss('hero art', heroId); return null })
    cutoutCache.set(heroId, p)
  }
  return p
}

async function buildCutout(heroId: string): Promise<HeroCutout | null> {
  const url = heroArtUrl(heroId)
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

  // background reference = average of the four corners (the cream varies a
  // little from painting to painting)
  const corner = (x: number, y: number): number => (y * w + x) * 4
  const cs = [corner(2, 2), corner(w - 3, 2), corner(2, h - 3), corner(w - 3, h - 3)]
  let br = 0, bg = 0, bb = 0
  for (const i of cs) { br += px[i]; bg += px[i + 1]; bb += px[i + 2] }
  br = Math.round(br / 4); bg = Math.round(bg / 4); bb = Math.round(bb / 4)

  const shadowTol = SHADOW_TOL[heroId] ?? SHADOW_TOL_DEFAULT
  const isBg = (i: number): boolean => {
    const r = px[i], gg = px[i + 1], b = px[i + 2]
    const dr = r - br, dg = gg - bg, db = b - bb
    const d2 = dr * dr + dg * dg + db * db
    if (d2 < BG_TOL * BG_TOL) return true
    // soft painted ground shadow: light + low chroma, still near-ish the cream.
    // The dark character outline stops the flood fill, so this stays outside.
    const lum = (r * 3 + gg * 6 + b) / 10
    const chroma = Math.max(r, gg, b) - Math.min(r, gg, b)
    return lum > 140 && chroma < 32 && d2 < shadowTol * shadowTol
  }

  // flood fill inward from every border pixel — only background CONNECTED to
  // the edge is removed, so cream-coloured details inside the character stay
  const removed = new Uint8Array(w * h)
  const stack = new Int32Array(w * h)
  let sp = 0
  const push = (x: number, y: number): void => {
    const i = y * w + x
    if (!removed[i] && isBg(i * 4)) { removed[i] = 1; stack[sp++] = i }
  }
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1) }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y) }
  while (sp > 0) {
    const i = stack[--sp]
    const x = i % w, y = (i / w) | 0
    if (x > 0) push(x - 1, y)
    if (x < w - 1) push(x + 1, y)
    if (y > 0) push(x, y - 1)
    if (y < h - 1) push(x, y + 1)
  }

  // punch out the background, feather the silhouette edge, find the content box
  let kept = 0
  let minX = w, minY = h, maxX = -1, maxY = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (removed[i]) { px[i * 4 + 3] = 0; continue }
      kept++
      const edge =
        (x > 0 && removed[i - 1]) || (x < w - 1 && removed[i + 1]) ||
        (y > 0 && removed[i - w]) || (y < h - 1 && removed[i + w])
      if (edge) px[i * 4 + 3] = 120
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  // sanity gate: a key that ate the character (or nothing) looks worse than
  // the low-poly figure — let the caller keep its fallback
  const frac = kept / (w * h)
  if (frac < 0.12 || frac > 0.8 || maxX < 0) return null

  g.putImageData(data, 0, 0)
  const pad = 2
  const tx = Math.max(0, minX - pad)
  const ty = Math.max(0, minY - pad)
  const tw = Math.min(w, maxX + pad + 1) - tx
  const th = Math.min(h, maxY + pad + 1) - ty
  const out = document.createElement('canvas')
  out.width = tw
  out.height = th
  const og = out.getContext('2d')
  if (!og) return null
  og.drawImage(c, tx, ty, tw, th, 0, 0, tw, th)
  return { canvas: out, aspect: tw / th }
}

// ---------------------------------------------------------------------------
// Title-screen key art (stray signature mark removed)
// ---------------------------------------------------------------------------

// the artist's stray signature sits in the top-right sky of 00-keyart-v2.jpg
const MARK = { x0: 0.755, y0: 0.158, x1: 0.925, y1: 0.202 }

let keyartPromise: Promise<string> | null = null

/** URL (blob) of the key art with the signature mark inpainted out. */
export function keyartBackdropUrl(): Promise<string> {
  if (!keyartPromise) keyartPromise = buildKeyart().catch(() => KEYART_URL)
  return keyartPromise
}

async function buildKeyart(): Promise<string> {
  const img = await loadImage(KEYART_URL)
  const w = img.naturalWidth, h = img.naturalHeight
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d', { willReadFrequently: true })
  if (!g) return KEYART_URL
  g.drawImage(img, 0, 0)

  const rx = Math.round(w * MARK.x0), ry = Math.round(h * MARK.y0)
  const rw = Math.round(w * (MARK.x1 - MARK.x0)), rh = Math.round(h * (MARK.y1 - MARK.y0))
  const region = g.getImageData(rx, ry, rw, rh)
  const px = region.data

  // the mark is light lavender handwriting (g ≈ r, blue-leaning) over dusky
  // sky — the cyan flame (g ≫ r) and warm clouds (b < r) stay untouched
  let mask = new Uint8Array(rw * rh)
  for (let i = 0; i < rw * rh; i++) {
    const r = px[i * 4], gg = px[i * 4 + 1], b = px[i * 4 + 2]
    const lum = (r * 3 + gg * 6 + b) / 10
    if (b > 150 && lum > 130 && b >= r - 10 && gg <= r + 25) mask[i] = 1
  }
  // dilate twice to catch the anti-aliased halo around the strokes
  for (let pass = 0; pass < 2; pass++) {
    const nm = new Uint8Array(mask)
    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        const i = y * rw + x
        if (mask[i]) continue
        if ((x > 0 && mask[i - 1]) || (x < rw - 1 && mask[i + 1]) ||
            (y > 0 && mask[i - rw]) || (y < rh - 1 && mask[i + rw])) nm[i] = 1
      }
    }
    mask = nm
  }
  const blurMask = new Uint8Array(mask)

  // grassfire inpaint: peel the mask inward, averaging the settled neighbours
  const N8: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]
  for (let guard = 0; guard < 300; guard++) {
    let changed = 0
    const nm = new Uint8Array(mask)
    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        const i = y * rw + x
        if (!mask[i]) continue
        let ar = 0, ag = 0, ab = 0, n = 0
        for (const [dx, dy] of N8) {
          const xx = x + dx, yy = y + dy
          if (xx < 0 || xx >= rw || yy < 0 || yy >= rh) continue
          const j = yy * rw + xx
          if (mask[j]) continue
          ar += px[j * 4]; ag += px[j * 4 + 1]; ab += px[j * 4 + 2]; n++
        }
        if (n >= 3) {
          px[i * 4] = Math.round(ar / n)
          px[i * 4 + 1] = Math.round(ag / n)
          px[i * 4 + 2] = Math.round(ab / n)
          nm[i] = 0
          changed++
        }
      }
    }
    mask = nm
    if (changed === 0) break
  }

  // soften just the inpainted strokes so they melt into the painterly sky
  const tmp = document.createElement('canvas')
  tmp.width = rw
  tmp.height = rh
  const tg = tmp.getContext('2d', { willReadFrequently: true })
  if (tg) {
    tg.putImageData(region, 0, 0)
    const tmp2 = document.createElement('canvas')
    tmp2.width = rw
    tmp2.height = rh
    const t2 = tmp2.getContext('2d', { willReadFrequently: true })
    if (t2) {
      t2.filter = 'blur(2.5px)'
      t2.drawImage(tmp, 0, 0)
      const blurred = t2.getImageData(0, 0, rw, rh).data
      for (let i = 0; i < rw * rh; i++) {
        if (!blurMask[i]) continue
        px[i * 4] = blurred[i * 4]
        px[i * 4 + 1] = blurred[i * 4 + 1]
        px[i * 4 + 2] = blurred[i * 4 + 2]
      }
    }
  }
  g.putImageData(region, rx, ry)

  const blob = await new Promise<Blob | null>((resolve) => c.toBlob(resolve, 'image/jpeg', 0.88))
  return blob ? URL.createObjectURL(blob) : KEYART_URL
}
