// One-shot PWA icon generator — run manually (`node scripts/gen-icons.mjs`);
// NOT wired into `npm run build` (keeps the gate as tsc+vite only). Produces the
// CHROMANCER app icons into public/icons as real PNGs using only Node built-ins
// (zlib), so there is no image-library dependency. Re-run to regenerate.
//
// Design: the game's promise in one glyph — a bloom disc whose left half is the
// Greying (desaturated) and right half floods to colour, on a deep-violet field.
// Maskable variant keeps the motif inside the 80% safe zone.

import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons')
mkdirSync(OUT, { recursive: true })

// ---- minimal PNG (RGBA, 8-bit) encoder ----
function crc32(buf) {
  let c = ~0 >>> 0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
  }
  return (~c) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0)
  const t = Buffer.from(type, 'ascii')
  const body = Buffer.concat([t, data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}
function encodePng(w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  // raw scanlines with filter byte 0
  const stride = w * 4
  const raw = Buffer.alloc((stride + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
  }
  const idat = deflateSync(raw, { level: 9 })
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

const lerp = (a, b, t) => a + (b - a) * t
function mix(c1, c2, t) {
  return [Math.round(lerp(c1[0], c2[0], t)), Math.round(lerp(c1[1], c2[1], t)), Math.round(lerp(c1[2], c2[2], t))]
}

function paint(size, safe) {
  const rgba = Buffer.alloc(size * size * 4)
  const cx = size / 2, cy = size / 2
  const R = size * (safe ? 0.34 : 0.40) // bloom disc radius
  const ring = size * (safe ? 0.30 : 0.35)
  // colour half hues sweeping top→bottom on the right
  const hues = [[255, 120, 60], [255, 210, 90], [120, 230, 140], [90, 200, 255], [180, 120, 255]]
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      // background: deep-violet radial field
      const dxb = (x - cx) / size, dyb = (y - cy) / size
      const rb = Math.sqrt(dxb * dxb + dyb * dyb)
      let col = mix([28, 14, 46], [8, 5, 18], Math.min(1, rb * 1.7))
      // the bloom disc
      const dx = x - cx, dy = y - cy
      const d = Math.sqrt(dx * dx + dy * dy)
      if (d <= R) {
        const rightSide = dx >= 0
        const vert = (y / size) // 0..1
        if (rightSide) {
          // colour flood: pick a hue band by vertical position, brighten to centre
          const band = Math.min(hues.length - 1, Math.floor(vert * hues.length))
          const hue = hues[band]
          const glow = 1 - d / R
          col = mix(mix([40, 20, 60], hue, 0.85), [255, 255, 255], glow * 0.35)
        } else {
          // the Greying: desaturated stone, slightly darker toward the seam
          const g = Math.round(lerp(120, 150, 1 - d / R))
          col = [g - 10, g - 6, g + 4]
        }
        // seam highlight
        if (Math.abs(dx) < size * 0.012) col = [245, 240, 255]
      } else if (d <= ring + size * 0.02 && d >= ring - size * 0.02) {
        // thin painted ring around the disc
        col = mix(col, [255, 220, 130], 0.5)
      }
      rgba[i] = col[0]; rgba[i + 1] = col[1]; rgba[i + 2] = col[2]; rgba[i + 3] = 255
    }
  }
  return encodePng(size, size, rgba)
}

const targets = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-192.png', 192, true],
  ['icon-maskable-512.png', 512, true],
  ['apple-touch-180.png', 180, true],
]
for (const [name, size, safe] of targets) {
  writeFileSync(join(OUT, name), paint(size, safe))
  console.log('wrote', name, size + 'x' + size)
}
