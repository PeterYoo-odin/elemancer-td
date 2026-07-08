// Odin Platforms boot splash — a cinematic DOM/canvas overlay that plays before
// the game: darkness → lightning bolt → white flash + thunderclap → "ODIN"
// ignites in metallic gold → settles → fades into the front page.
//
// Pure HTML/CSS/canvas/WebAudio: no external assets beyond the committed brand
// art in public/brand/. Skippable by tap, honors sound + reduce-motion settings.

import { appSettings } from './settings'
import { unlockAudio, playThunderclap, playShimmer } from './sfx'

export interface SplashOptions {
  /** Show the "TAP TO ENTER" gate first (required on cold load so the browser lets the thunder play). */
  gate?: boolean
  onDone?: () => void
}

const RAVEN_URL = import.meta.env.BASE_URL + 'brand/odin-raven-mark.png'

const CSS = `
.odsp, .odsp * { box-sizing: border-box; margin: 0; -webkit-tap-highlight-color: transparent; user-select: none; }
.odsp {
  position: fixed; inset: 0; z-index: 100; overflow: hidden; cursor: pointer;
  background: radial-gradient(120% 90% at 50% 30%, #0b0b14 0%, #050508 55%, #000 100%);
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  font-family: system-ui, -apple-system, 'Segoe UI', Arial, sans-serif;
  transition: opacity .7s ease;
}
.odsp.odsp-leave { opacity: 0; pointer-events: none; }
.odsp.odsp-leave-fast { transition-duration: .3s; }

.odsp-bolt { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.odsp-flash { position: absolute; inset: 0; background: #fff; opacity: 0; pointer-events: none; }
.odsp.odsp-flash-on .odsp-flash { animation: odspFlash .55s ease-out forwards; }
.odsp.odsp-flash-soft .odsp-flash { animation: odspFlashSoft 1s ease-out forwards; }
@keyframes odspFlash { 0% { opacity: 0; } 7% { opacity: .95; } 20% { opacity: .2; } 30% { opacity: .45; } 45% { opacity: .12; } 100% { opacity: 0; } }
@keyframes odspFlashSoft { 0% { opacity: 0; } 20% { opacity: .18; } 100% { opacity: 0; } }

.odsp-vig { position: absolute; inset: 0; pointer-events: none; opacity: 0;
  background: radial-gradient(80% 60% at 50% 45%, transparent 40%, rgba(212,164,52,.10) 70%, rgba(0,0,0,.5) 100%); }
.odsp.lit .odsp-vig { opacity: 1; transition: opacity 1.2s ease .2s; }

.odsp.odsp-shake .odsp-center { animation: odspShake .38s linear; }
@keyframes odspShake {
  0% { transform: translate3d(0,0,0); } 12% { transform: translate3d(-7px,4px,0); }
  25% { transform: translate3d(6px,-5px,0); } 40% { transform: translate3d(-5px,-3px,0); }
  55% { transform: translate3d(4px,4px,0); } 72% { transform: translate3d(-3px,2px,0); }
  86% { transform: translate3d(2px,-1px,0); } 100% { transform: translate3d(0,0,0); }
}

.odsp-center { position: relative; display: flex; flex-direction: column; align-items: center; gap: clamp(18px, 4vh, 30px); padding: 0 24px; }

.odsp-emblem { position: relative; width: clamp(120px, 32vw, 190px); aspect-ratio: 1; }
.odsp-raven { width: 100%; height: 100%; object-fit: contain; display: block;
  filter: grayscale(1) brightness(.42); transition: filter .5s ease; }
.odsp.lit .odsp-raven { filter: grayscale(0) brightness(1.06) drop-shadow(0 0 22px rgba(255,196,86,.5)) drop-shadow(0 0 60px rgba(255,170,50,.22)); }
.odsp-glint { position: absolute; inset: 0; opacity: 0; pointer-events: none;
  background: linear-gradient(115deg, transparent 32%, rgba(255,252,230,.95) 50%, transparent 68%);
  background-size: 260% 260%; background-position: 120% 120%;
  -webkit-mask-image: url('${RAVEN_URL}'); mask-image: url('${RAVEN_URL}');
  -webkit-mask-size: contain; mask-size: contain;
  -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat;
  -webkit-mask-position: center; mask-position: center; }
.odsp.lit .odsp-glint { animation: odspGlint 1.5s ease-out .25s 1; }
@keyframes odspGlint { 0% { opacity: 0; background-position: 130% 130%; } 25% { opacity: 1; } 100% { opacity: 0; background-position: -30% -30%; } }

.odsp-word { display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center; }
.odsp-odin {
  font-size: clamp(44px, 12vw, 84px); font-weight: 800; line-height: 1;
  letter-spacing: .30em; margin-right: -.30em; /* recenter: tracking pads the right edge */
  color: #3d3d46; transition: color .3s ease;
}
.odsp.lit .odsp-odin {
  color: transparent;
  background: linear-gradient(100deg, #6d4a08 0%, #d9a743 22%, #fff3c4 38%, #ffd76a 50%, #b8860b 66%, #f4d580 84%, #6d4a08 100%);
  background-size: 220% 100%; background-clip: text; -webkit-background-clip: text;
  animation: odspSheen 3.4s linear infinite;
  filter: drop-shadow(0 0 14px rgba(255,205,92,.55)) drop-shadow(0 2px 30px rgba(255,170,40,.28));
}
@keyframes odspSheen { 0% { background-position: 130% 0; } 100% { background-position: -90% 0; } }
.odsp-plat {
  font-size: clamp(15px, 3.6vw, 24px); font-weight: 500; line-height: 1;
  letter-spacing: .62em; margin-right: -.62em;
  color: #4a4a55; transition: color .45s ease, text-shadow .45s ease;
}
.odsp.lit .odsp-plat { color: #d9dde6; text-shadow: 0 0 12px rgba(190,205,230,.35); }

.odsp-tap {
  position: absolute; bottom: clamp(72px, 14vh, 130px); left: 0; right: 0; text-align: center;
  font-size: 14px; font-weight: 600; letter-spacing: .42em; margin-right: -.42em; color: #8b8b98;
  animation: odspPulse 1.6s ease-in-out infinite;
}
.odsp.odsp-armed .odsp-tap { display: none; }
@keyframes odspPulse { 0%, 100% { opacity: .35; } 50% { opacity: .95; } }

.odsp-credit {
  position: absolute; bottom: calc(clamp(22px, 4vh, 40px) + env(safe-area-inset-bottom)); left: 0; right: 0; text-align: center;
  font-size: 11px; letter-spacing: .22em; margin-right: -.22em; color: #55555f;
}
/* short landscape: shrink the centred stack + lift the tap/credit lines so the
   wordmark and "TAP TO ENTER" gate line never overlap (~440px tall) */
@media (orientation: landscape) and (max-height: 500px) {
  .odsp-center { gap: clamp(8px, 2vh, 14px); }
  .odsp-emblem { width: clamp(80px, 16vh, 120px); }
  .odsp-odin { font-size: clamp(36px, 9vh, 60px); }
  .odsp-plat { font-size: clamp(13px, 3vh, 18px); }
  .odsp-tap { bottom: clamp(14px, 5vh, 30px); }
  .odsp-credit { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .odsp.odsp-shake .odsp-center { animation: none; }
}
`

let cssInjected = false
function injectCss(): void {
  if (cssInjected) return
  cssInjected = true
  const style = document.createElement('style')
  style.textContent = CSS
  document.head.appendChild(style)
}

// ---------------------------------------------------------------------------
// Lightning bolt rendering (2D canvas, one-shot animation)
// ---------------------------------------------------------------------------

type Pt = { x: number; y: number }

function makeBoltPath(x0: number, x1: number, y1: number): Pt[] {
  // Jagged main channel from just above the viewport down to the strike point:
  // a downward random walk pulled ever harder toward the target, so it reads
  // as one stroke with kinks rather than a scribble.
  const pts: Pt[] = [{ x: x0, y: -12 }]
  const steps = 20
  let x = x0
  for (let i = 1; i < steps; i++) {
    const f = i / steps
    x += (x1 - x) * f * f + (Math.random() * 2 - 1) * 26 * (1 - f * 0.5)
    pts.push({ x, y: -12 + (y1 + 12) * f })
  }
  pts.push({ x: x1, y: y1 })
  return pts
}

function makeBranch(from: Pt, dir: number): Pt[] {
  const pts: Pt[] = [from]
  let { x, y } = from
  const n = 3 + Math.floor(Math.random() * 3)
  for (let i = 0; i < n; i++) {
    x += dir * (14 + Math.random() * 26)
    y += 16 + Math.random() * 30
    pts.push({ x, y })
  }
  return pts
}

function strokePath(g: CanvasRenderingContext2D, pts: Pt[], upto: number): void {
  const n = Math.max(2, Math.min(pts.length, Math.ceil(pts.length * upto)))
  g.beginPath()
  g.moveTo(pts[0].x, pts[0].y)
  for (let i = 1; i < n; i++) g.lineTo(pts[i].x, pts[i].y)
  g.stroke()
}

/** Draw + animate the bolt; resolves when it has flickered out. */
function animateBolt(canvas: HTMLCanvasElement, target: { x: number; y: number }): () => void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  canvas.width = Math.round(w * dpr)
  canvas.height = Math.round(h * dpr)
  const g = canvas.getContext('2d')
  if (!g) return () => {}
  g.scale(dpr, dpr)

  const main = makeBoltPath(target.x + (Math.random() * 2 - 1) * w * 0.12, target.x, target.y)
  const branches: Pt[][] = []
  for (const idx of [6, 11, 15]) {
    if (Math.random() < 0.85) branches.push(makeBranch(main[idx], Math.random() < 0.5 ? -1 : 1))
  }

  let raf = 0
  let start = 0
  const DURATION = 950
  const draw = (now: number) => {
    if (!start) start = now
    const t = now - start
    g.clearRect(0, 0, w, h)
    if (t >= DURATION) return

    // 0–130ms: the channel races down. After: it flickers and decays.
    const reveal = Math.min(1, t / 130)
    let alpha: number
    if (t < 130) alpha = 1
    else {
      const decay = 1 - (t - 130) / (DURATION - 130)
      alpha = decay * (0.45 + 0.55 * Math.abs(Math.sin(t * 0.09)))
    }

    g.lineCap = 'round'
    g.lineJoin = 'round'
    // Glow pass
    g.shadowColor = 'rgba(160,190,255,.9)'
    g.shadowBlur = 26
    g.strokeStyle = `rgba(150,185,255,${(alpha * 0.45).toFixed(3)})`
    g.lineWidth = 9
    strokePath(g, main, reveal)
    g.lineWidth = 5
    for (const b of branches) strokePath(g, b, Math.max(0, reveal * 1.4 - 0.4))
    // White-hot core
    g.shadowBlur = 10
    g.strokeStyle = `rgba(255,255,255,${alpha.toFixed(3)})`
    g.lineWidth = 2.5
    strokePath(g, main, reveal)
    g.lineWidth = 1.4
    for (const b of branches) strokePath(g, b, Math.max(0, reveal * 1.4 - 0.4))

    raf = requestAnimationFrame(draw)
  }
  raf = requestAnimationFrame(draw)
  return () => {
    cancelAnimationFrame(raf)
    g.clearRect(0, 0, w, h)
  }
}

// ---------------------------------------------------------------------------
// The splash itself
// ---------------------------------------------------------------------------

export function showOdinSplash(opts: SplashOptions = {}): void {
  injectCss()

  const root = document.createElement('div')
  root.className = 'odsp'
  root.innerHTML = `
    <canvas class="odsp-bolt"></canvas>
    <div class="odsp-center">
      <div class="odsp-emblem">
        <img class="odsp-raven" src="${RAVEN_URL}" alt="Odin Platforms" draggable="false" />
        <div class="odsp-glint"></div>
      </div>
      <div class="odsp-word">
        <div class="odsp-odin">ODIN</div>
        <div class="odsp-plat">PLATFORMS</div>
      </div>
    </div>
    <div class="odsp-vig"></div>
    <div class="odsp-flash"></div>
    <div class="odsp-tap">TAP TO ENTER</div>
    <div class="odsp-credit">CREATED BY ODIN PLATFORMS</div>
  `
  document.body.appendChild(root)

  const boltCanvas = root.querySelector<HTMLCanvasElement>('.odsp-bolt')!
  const emblem = root.querySelector<HTMLElement>('.odsp-emblem')!

  const timers: number[] = []
  let stopBolt: (() => void) | null = null
  let playing = false
  let finished = false

  const at = (ms: number, fn: () => void) => {
    timers.push(window.setTimeout(fn, ms))
  }

  const leave = (fast: boolean) => {
    if (finished) return
    finished = true
    for (const id of timers) clearTimeout(id)
    stopBolt?.()
    root.classList.add('lit')
    root.classList.remove('odsp-shake')
    if (fast) root.classList.add('odsp-leave-fast')
    root.classList.add('odsp-leave')
    opts.onDone?.()
    window.setTimeout(() => root.remove(), fast ? 350 : 800)
  }

  const play = () => {
    if (playing) return
    playing = true
    root.classList.add('odsp-armed')
    const reduced = appSettings.reducedMotion()

    if (reduced) {
      // Graceful variant: no bolt, no shake, gentle glow-up on a soft flash.
      at(250, () => {
        root.classList.add('odsp-flash-soft', 'lit')
        playThunderclap()
      })
      at(750, () => playShimmer())
      at(2400, () => leave(false))
      return
    }

    // Distant pre-flicker in the dark.
    at(120, () => root.classList.add('odsp-flash-soft'))
    at(400, () => root.classList.remove('odsp-flash-soft'))

    // The strike.
    at(430, () => {
      const r = emblem.getBoundingClientRect()
      stopBolt = animateBolt(boltCanvas, { x: r.left + r.width / 2, y: r.top + r.height * 0.42 })
      playThunderclap()
    })
    at(520, () => {
      root.classList.add('odsp-flash-on', 'odsp-shake', 'lit')
    })
    at(950, () => playShimmer())
    at(2650, () => leave(false))
  }

  const onTap = () => {
    if (finished) return
    if (!playing) {
      unlockAudio()
      play()
    } else {
      leave(true) // skip
    }
  }
  root.addEventListener('pointerdown', onTap)

  if (!opts.gate) {
    // Replays (e.g. from settings): the user has already interacted, run now.
    root.classList.add('odsp-armed')
    play()
  }
}
