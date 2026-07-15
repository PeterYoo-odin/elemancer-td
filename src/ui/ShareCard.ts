// PROVE-IT SHARE CARD — client-side canvas render of a run's receipt: painted
// frame, seed code, score, wave, hero, combo highlight, and the challenge line.
// One-tap Web Share where available, download + copy-link fallbacks everywhere.
// A gold "VERIFIED FAIR" seal is RESERVED for server-verified replays (backend
// later): pass verified=true and the seal renders; until then it never shows.

export interface ShareCardOpts {
  code: string // seed code (EMBER-FOX-42)
  link: string // full deep link
  headline: string // "EMBER VALE RESTORED" / "FELL AT WAVE 7"
  levelName: string
  heroName: string
  score: number
  wave: number // waves survived/cleared
  totalWaves: number // Infinity for endless
  comboHighlight: string // "SHATTER ×53 · combo ×61"
  accent: string // css color — realm accent
  accent2: string // css color — secondary
  win: boolean
  verified?: boolean // reserved: gold seal for server-verified runs
}

const W = 1200
const H = 630

// deterministic tiny PRNG so the painted strokes are stable per seed code
function strokeRng(seed: string): () => number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return () => {
    h ^= h << 13; h ^= h >>> 17; h ^= h << 5
    return ((h >>> 0) % 10000) / 10000
  }
}

export function renderShareCard(o: ShareCardOpts): HTMLCanvasElement {
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const ctx = cv.getContext('2d')!
  const rnd = strokeRng(o.code)

  // ---- background: deep night sinking into the realm accent ----
  const bg = ctx.createLinearGradient(0, 0, 0, H)
  bg.addColorStop(0, '#150b2e')
  bg.addColorStop(0.55, '#0d0720')
  bg.addColorStop(1, '#0a0616')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)

  // soft accent glow behind the right-side bloom motif
  const glow = ctx.createRadialGradient(W - 260, H / 2, 40, W - 260, H / 2, 360)
  glow.addColorStop(0, hexA(o.accent, 0.33))
  glow.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, H)

  // ---- the bloom motif: grey half-arc → colour half-arc (the game's promise) ----
  const cx = W - 260
  const cy = H / 2
  const hues = [o.accent, o.accent2, '#4ad9ff', '#8dff4a', '#ffd54a', '#c06bff']
  for (let ring = 0; ring < 6; ring++) {
    const r = 70 + ring * 42
    // grey side (left half): the Greying
    ctx.beginPath()
    ctx.arc(cx, cy, r, Math.PI * 0.5, Math.PI * 1.5)
    ctx.strokeStyle = `rgba(150,145,160,${0.16 - ring * 0.015})`
    ctx.lineWidth = 20 - ring * 2
    ctx.stroke()
    // colour side (right half): the restoration
    ctx.beginPath()
    ctx.arc(cx, cy, r, Math.PI * 1.5, Math.PI * 2.5)
    ctx.strokeStyle = hexA(hues[ring % hues.length], 0.6 - ring * 0.06)
    ctx.lineWidth = 20 - ring * 2
    ctx.stroke()
  }

  // ---- painted frame: rough double brush-stroke border ----
  paintFrame(ctx, rnd, o.accent, o.accent2)

  // ---- text column ----
  const L = 76
  ctx.textBaseline = 'alphabetic'

  ctx.font = '800 30px system-ui, sans-serif'
  ctx.fillStyle = '#b9a8e8'
  ctx.fillText('C H R O M A N C E R', L, 96)
  ctx.font = '600 21px system-ui, sans-serif'
  ctx.fillStyle = '#8f7fc0'
  ctx.fillText('PROVE-IT RUN · ' + o.levelName.toUpperCase(), L, 130)

  ctx.font = '900 62px system-ui, sans-serif'
  ctx.fillStyle = o.win ? '#ffffff' : '#ffb7c6'
  ctx.fillText(o.headline, L, 212)

  // seed pill
  ctx.font = '800 44px ui-monospace, Menlo, monospace'
  const codeW = ctx.measureText(o.code).width
  rounded(ctx, L, 244, codeW + 56, 74, 18)
  ctx.fillStyle = 'rgba(255,255,255,0.07)'
  ctx.fill()
  ctx.strokeStyle = hexA(o.accent, 0.9)
  ctx.lineWidth = 3
  ctx.stroke()
  ctx.fillStyle = '#ffe9a8'
  ctx.fillText(o.code, L + 28, 296)

  // stats row
  const waveTxt = Number.isFinite(o.totalWaves) ? `WAVE ${o.wave}/${o.totalWaves}` : `WAVE ${o.wave}`
  const stats = [`SCORE ${o.score.toLocaleString('en-US')}`, waveTxt, `HERO ${o.heroName.toUpperCase()}`]
  ctx.font = '800 27px system-ui, sans-serif'
  let sx = L
  for (const s of stats) {
    ctx.fillStyle = '#e8ddff'
    ctx.fillText(s, sx, 384)
    sx += ctx.measureText(s).width + 44
  }

  // combo highlight
  ctx.font = '700 25px system-ui, sans-serif'
  ctx.fillStyle = hexA(o.accent, 1)
  {
    // draw the storm-bolt as a VECTOR (the icons.ts 'storm' path) — a canvas
    // fillText emoji renders per-OS in the shared PNG, this stays on-brand
    const bolt = new Path2D('M13 2 4 13.5h6L9 22l9-12.5h-6L13 2Z')
    ctx.save()
    ctx.translate(L, 432 - 15)
    ctx.scale(0.8, 0.8)
    ctx.fill(bolt)
    ctx.restore()
    ctx.fillText(o.comboHighlight, L + 24, 432)
  }

  // challenge footer
  ctx.font = '900 34px system-ui, sans-serif'
  ctx.fillStyle = '#ffffff'
  ctx.fillText('Beat this run', L, 514)
  ctx.font = '700 27px system-ui, sans-serif'
  ctx.fillStyle = '#9ee8ff'
  ctx.fillText('chromancer.io  ·  ?seed=' + o.code, L, 552)

  ctx.font = '600 19px system-ui, sans-serif'
  ctx.fillStyle = '#7a6fa8'
  ctx.fillText('Same seed · same waves · same drafts. No excuses.', L, 586)

  // reserved gold seal — server-verified replays only (backend later)
  if (o.verified) {
    const sxc = W - 118
    const syc = H - 112
    ctx.beginPath()
    ctx.arc(sxc, syc, 62, 0, Math.PI * 2)
    const gold = ctx.createRadialGradient(sxc - 14, syc - 16, 8, sxc, syc, 64)
    gold.addColorStop(0, '#ffe9a0')
    gold.addColorStop(1, '#c99416')
    ctx.fillStyle = gold
    ctx.fill()
    ctx.strokeStyle = '#fff3c4'
    ctx.lineWidth = 4
    ctx.stroke()
    ctx.fillStyle = '#3a2a05'
    ctx.font = '900 17px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('VERIFIED', sxc, syc - 4)
    ctx.fillText('FAIR ✓', sxc, syc + 18)
    ctx.textAlign = 'left'
  }

  return cv
}

// rough painted double-border: wobbly strokes with dabs, seeded by the code
function paintFrame(ctx: CanvasRenderingContext2D, rnd: () => number, accent: string, accent2: string): void {
  const inset = 26
  for (let pass = 0; pass < 2; pass++) {
    const pad = inset + pass * 12
    ctx.beginPath()
    const pts: Array<[number, number]> = []
    const step = 60
    for (let x = pad; x <= W - pad; x += step) pts.push([x, pad + (rnd() - 0.5) * 7])
    for (let y = pad; y <= H - pad; y += step) pts.push([W - pad + (rnd() - 0.5) * 7, y])
    for (let x = W - pad; x >= pad; x -= step) pts.push([x, H - pad + (rnd() - 0.5) * 7])
    for (let y = H - pad; y >= pad; y -= step) pts.push([pad + (rnd() - 0.5) * 7, y])
    ctx.moveTo(pts[0][0], pts[0][1])
    for (let i = 1; i < pts.length; i++) {
      const [px, py] = pts[i - 1]
      const [nx, ny] = pts[i]
      ctx.quadraticCurveTo(px, py, (px + nx) / 2, (py + ny) / 2)
    }
    ctx.closePath()
    ctx.strokeStyle = hexA(pass === 0 ? accent : accent2, pass === 0 ? 0.85 : 0.4)
    ctx.lineWidth = pass === 0 ? 6 : 3
    ctx.stroke()
  }
  // corner paint dabs
  const corners: Array<[number, number]> = [[inset, inset], [W - inset, inset], [inset, H - inset], [W - inset, H - inset]]
  for (const [cx, cy] of corners) {
    for (let i = 0; i < 5; i++) {
      ctx.beginPath()
      ctx.arc(cx + (rnd() - 0.5) * 26, cy + (rnd() - 0.5) * 26, 3 + rnd() * 6, 0, Math.PI * 2)
      ctx.fillStyle = hexA(i % 2 ? accent : accent2, 0.35 + rnd() * 0.4)
      ctx.fill()
    }
  }
}

function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function hexA(hex: string, a: number): string {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

// ---------------------------------------------------------------------------
//  Actions
// ---------------------------------------------------------------------------

function cardBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'))
}

/** One-tap share: Web Share API with the image attached when supported,
 *  text+URL share otherwise. Returns false if share was unavailable/cancelled
 *  (caller should fall back to download/copy). */
export async function shareCard(canvas: HTMLCanvasElement, o: ShareCardOpts): Promise<boolean> {
  const text = `I ${o.win ? 'restored' : 'fell in'} ${o.levelName} — score ${o.score.toLocaleString('en-US')} on seed ${o.code}. Beat this run:`
  try {
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
    if (typeof nav.share === 'function') {
      const blob = await cardBlob(canvas)
      if (blob && nav.canShare?.({ files: [new File([blob], `chromancer-${o.code}.png`, { type: 'image/png' })] })) {
        await nav.share({
          files: [new File([blob], `chromancer-${o.code}.png`, { type: 'image/png' })],
          text,
          url: o.link,
        })
        return true
      }
      await nav.share({ text, url: o.link })
      return true
    }
  } catch { /* cancelled or unsupported — fall through */ }
  return false
}

/** Download fallback: saves the PNG locally. */
export function downloadCard(canvas: HTMLCanvasElement, code: string): void {
  try {
    const a = document.createElement('a')
    a.href = canvas.toDataURL('image/png')
    a.download = `chromancer-${code}.png`
    document.body.appendChild(a)
    a.click()
    a.remove()
  } catch { /* canvas tainted or blocked — nothing sane to do */ }
}

/** Clipboard copy with a legacy fallback. Returns success. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.cssText = 'position:fixed;opacity:0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      return ok
    } catch {
      return false
    }
  }
}
