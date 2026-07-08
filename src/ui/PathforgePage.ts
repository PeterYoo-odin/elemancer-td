// PathforgePage — the Pathforge build interface (an HTML/CSS overlay, same family
// as DailySeedPage/FrontPage). The player PAINTS the Prism-road maze on an open grid
// between a fixed Portal and the Prism Wellspring, with LIVE validity + a live route
// preview (enemies always take the shortest painted road — the editor teaches it), a
// seed the run is reproducible from, and their local best for that seed. "Begin the
// Defense" commits the shortest route into a seeded endless run on their own maze.
//
// Snappy + mobile-first: pointer paint/erase with drag, big tap targets, one clear
// valid/invalid state. Deterministic + free (no gacha, no paid advantage).

import {
  PF_COLS, PF_ROWS, pfKey, pfCol, pfRow, pathforgeLayout, validateMaze,
  pathforgeBest, savePathforgeMaze, loadPathforgeMaze, defaultPathforgeSeed,
  type PFCell,
} from '../game/pathforge'
import { seedToCode, canonicalSeed } from '../game/seedcode'
import { withRef } from '../game/referral'
import { appSettings } from './settings'
import { playUiTick } from './sfx'

export interface PathforgeHandlers {
  onBack(): void
  // Launch the defense on the committed route (ordered spawn→base cells).
  onPlay(seed: number, route: PFCell[]): void
}

export interface PathforgeOpts {
  initialSeed?: number // deep-link / shared seed to open on (defaults to today's daily)
}

const CSS = `
.epf, .epf * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
.epf {
  position: fixed; inset: 0; z-index: 15; display: flex; flex-direction: column; color: #eef8ff;
  font-family: 'Baloo 2','Nunito',system-ui,-apple-system,'Segoe UI',Arial,sans-serif;
  padding-top: env(safe-area-inset-top); user-select: none;
  background:
    radial-gradient(95% 55% at 50% -8%, rgba(107,215,255,.22), transparent 60%),
    radial-gradient(80% 45% at 50% 108%, rgba(201,107,255,.18), transparent 60%),
    linear-gradient(180deg, #0f1230 0%, #0b0a1e 55%, #060510 100%);
  transition: opacity .25s ease;
}
.epf.epf-leave { opacity: 0; pointer-events: none; }
.epf.epf-reduced { transition: none; }

.epf-head { display: flex; align-items: center; gap: 9px; padding: 12px 14px 6px; max-width: 560px; width: 100%; margin: 0 auto; flex: 0 0 auto; }
.epf-back { width: 40px; height: 40px; border-radius: 50%; border: 1px solid rgba(255,255,255,.16); flex: 0 0 auto;
  background: rgba(255,255,255,.06); color: #e6f4ff; font: inherit; font-size: 21px; cursor: pointer; }
.epf-back:active { transform: scale(.92); }
.epf-title { font-size: 20px; font-weight: 900; letter-spacing: .16em; color: #fff; }
.epf-title .p { color: #6bd7ff; }
.epf-seedpill { margin-left: auto; font-size: 11.5px; font-weight: 900; letter-spacing: .06em; color: #bfe9ff;
  border: 1px solid rgba(107,215,255,.34); background: rgba(107,215,255,.1); border-radius: 999px; padding: 6px 11px; cursor: pointer; white-space: nowrap; }
.epf-seedpill:active { transform: scale(.96); }

.epf-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch;
  padding: 2px 14px calc(14px + env(safe-area-inset-bottom)); }
.epf-inner { max-width: 560px; margin: 0 auto; display: flex; flex-direction: column; gap: 11px; }

.epf-intro { border-radius: 14px; padding: 11px 13px; background: rgba(107,215,255,.07); border: 1px solid rgba(107,215,255,.24); }
.epf-intro h3 { font-size: 12px; font-weight: 900; letter-spacing: .14em; color: #bfe9ff; margin-bottom: 5px; }
.epf-intro p { font-size: 12px; color: #b6c8dc; line-height: 1.5; }
.epf-intro b { color: #eaf6ff; }

/* the grid */
.epf-gridwrap { display: flex; justify-content: center; }
.epf-grid { display: grid; gap: 3px; padding: 7px; border-radius: 16px; touch-action: none;
  grid-template-columns: repeat(${PF_COLS}, 1fr); width: 100%; max-width: 396px; aspect-ratio: ${PF_COLS} / ${PF_ROWS};
  background: linear-gradient(180deg, rgba(255,255,255,.05), rgba(255,255,255,.015)); border: 1px solid rgba(255,255,255,.1); }
.epf-cell { border-radius: 6px; position: relative; cursor: pointer; transition: background .08s ease, box-shadow .08s ease;
  background: rgba(255,255,255,.045); box-shadow: inset 0 0 0 1px rgba(255,255,255,.05); }
.epf-cell.road { background: rgba(120,132,150,.5); box-shadow: inset 0 0 0 1px rgba(255,255,255,.08); }
.epf-cell.route { background: linear-gradient(150deg, #6bd7ff, #4aa8ff); box-shadow: 0 0 10px rgba(107,215,255,.5), inset 0 0 0 1px rgba(255,255,255,.35); }
.epf-cell.spawn { background: linear-gradient(150deg, #ffd873, #ff9a4a); box-shadow: 0 0 12px rgba(255,168,74,.6); }
.epf-cell.base { background: linear-gradient(150deg, #c9ff5a, #2ff7c3); box-shadow: 0 0 14px rgba(47,247,195,.65); }
.epf-cell .ec { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 15px; }
.epf.epf-invalid .epf-cell.route { background: linear-gradient(150deg, #94a2b4, #6f7d90); box-shadow: inset 0 0 0 1px rgba(255,255,255,.14); }

/* status + controls */
.epf-status { display: flex; align-items: center; gap: 9px; border-radius: 13px; padding: 10px 13px;
  background: rgba(47,247,195,.09); border: 1px solid rgba(47,247,195,.32); font-size: 13px; font-weight: 800; color: #b7f5e4; }
.epf-status.bad { background: rgba(255,91,122,.1); border-color: rgba(255,91,122,.36); color: #ffc0cd; }
.epf-status .dot { width: 9px; height: 9px; border-radius: 50%; background: #2ff7c3; flex: 0 0 auto; box-shadow: 0 0 8px #2ff7c3; }
.epf-status.bad .dot { background: #ff5b7a; box-shadow: 0 0 8px #ff5b7a; }
.epf-status .len { margin-left: auto; font-weight: 900; color: #eafff9; white-space: nowrap; }
.epf-status.bad .len { display: none; }

.epf-tools { display: flex; gap: 8px; }
.epf-tool { flex: 1 1 0; padding: 11px 8px; border-radius: 12px; font: inherit; font-size: 12.5px; font-weight: 800; letter-spacing: .04em;
  cursor: pointer; background: rgba(255,255,255,.06); color: #d9ecff; border: 1px solid rgba(255,255,255,.16);
  display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
.epf-tool:active { transform: scale(.97); }

.epf-stats { display: flex; gap: 9px; }
.epf-stat { flex: 1 1 0; border-radius: 13px; padding: 10px 8px; text-align: center;
  background: linear-gradient(180deg, rgba(255,255,255,.055), rgba(255,255,255,.02)); border: 1px solid rgba(255,255,255,.11); }
.epf-stat .v { font-size: 20px; font-weight: 900; color: #fff; }
.epf-stat .l { margin-top: 2px; font-size: 9.5px; font-weight: 800; letter-spacing: .12em; color: #93a6bc; }

.epf-play { width: 100%; padding: 15px; border-radius: 15px; border: 0; font: inherit; font-size: 16px; font-weight: 900;
  letter-spacing: .06em; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 9px;
  background: linear-gradient(180deg, #a9f7ff, #34b8f0 82%); color: #062334; box-shadow: 0 10px 26px rgba(52,184,240,.32); }
.epf-play:active { transform: scale(.985); }
.epf-play:disabled { filter: grayscale(.7) brightness(.7); cursor: not-allowed; box-shadow: none; }

.epf-foot { font-size: 11px; color: #7f90a6; text-align: center; line-height: 1.5; padding: 2px 4px; }
`

let cssInjected = false

export class PathforgePage {
  private root: HTMLDivElement
  private handlers: PathforgeHandlers
  private seed: number
  private spawn: PFCell = [0, 0]
  private base: PFCell = [PF_COLS - 1, PF_ROWS - 1]
  private road = new Set<number>()
  private route: PFCell[] | null = null
  private cellEls: HTMLDivElement[] = []
  private painting = false
  private paintAdd = true // drag paints (add) or erases (remove)

  constructor(handlers: PathforgeHandlers, opts: PathforgeOpts = {}) {
    this.handlers = handlers
    this.seed = typeof opts.initialSeed === 'number' ? canonicalSeed(opts.initialSeed) : defaultPathforgeSeed()

    if (!cssInjected) {
      cssInjected = true
      const style = document.createElement('style')
      style.textContent = CSS
      document.head.appendChild(style)
    }

    this.root = document.createElement('div')
    this.root.className = 'epf'
    if (appSettings.reducedMotion()) this.root.classList.add('epf-reduced')
    this.renderShell()
    document.body.appendChild(this.root)
    this.loadSeed(this.seed)
  }

  private renderShell(): void {
    this.root.innerHTML = `
      <div class="epf-head">
        <button class="epf-back" data-back aria-label="Back">‹</button>
        <div class="epf-title"><span class="p">PATH</span>FORGE</div>
        <button class="epf-seedpill" data-seed title="Tap for a new seed">SEED ·&nbsp;<b data-seedcode>—</b></button>
      </div>
      <div class="epf-body">
        <div class="epf-inner">
          <div class="epf-intro">
            <h3>PAINT THE ROAD OF COLOR BACK</h3>
            <p>Lay <b>Prism-road</b> from the <b style="color:#ffb86b">Portal</b> to the <b style="color:#66f7c9">Wellspring</b>. Enemies walk the <b>shortest road</b> you paint — so build it <b>long and winding</b> to keep them in your towers' fire. Towers go on every off-road tile. Same seed, open grid: pure maze skill. The road <b>locks when the defense begins</b>.</p>
          </div>

          <div class="epf-gridwrap"><div class="epf-grid" data-grid></div></div>

          <div class="epf-status" data-status><span class="dot"></span><span data-statustext>Draw your maze.</span><span class="len" data-len></span></div>

          <div class="epf-tools">
            <button class="epf-tool" data-clear>✕ CLEAR</button>
            <button class="epf-tool" data-daily>◎ TODAY'S SEED</button>
            <button class="epf-tool" data-copy>⧉ <span data-copylabel>COPY SEED</span></button>
          </div>

          <div class="epf-stats">
            <div class="epf-stat"><div class="v" data-best>—</div><div class="l">YOUR BEST · THIS SEED</div></div>
            <div class="epf-stat"><div class="v" data-tiles>0</div><div class="l">ROAD TILES</div></div>
          </div>

          <button class="epf-play" data-play disabled>⚔ BEGIN THE DEFENSE</button>
          <div class="epf-foot">Waves are seeded &amp; scale endlessly. Score = waves survived. Best is saved on this device.</div>
        </div>
      </div>`

    // Build the grid cells once; classes are toggled on edit for smooth dragging.
    const grid = this.root.querySelector<HTMLDivElement>('[data-grid]')!
    this.cellEls = []
    for (let i = 0; i < PF_COLS * PF_ROWS; i++) {
      const cell = document.createElement('div')
      cell.className = 'epf-cell'
      cell.dataset.idx = String(i)
      cell.innerHTML = '<span class="ec"></span>'
      grid.appendChild(cell)
      this.cellEls.push(cell)
    }

    // Pointer paint/erase with drag. elementFromPoint keeps drags smooth on touch.
    grid.addEventListener('pointerdown', (e) => this.onPointerDown(e))
    grid.addEventListener('pointermove', (e) => this.onPointerMove(e))
    const end = (): void => { this.painting = false }
    grid.addEventListener('pointerup', end)
    grid.addEventListener('pointercancel', end)
    grid.addEventListener('pointerleave', end)

    this.root.querySelector('[data-back]')!.addEventListener('click', () => this.leave())
    this.root.querySelector('[data-seed]')!.addEventListener('click', () => { playUiTick(); this.loadSeed(this.rollSeed()) })
    this.root.querySelector('[data-daily]')!.addEventListener('click', () => { playUiTick(); this.loadSeed(defaultPathforgeSeed()) })
    this.root.querySelector('[data-clear]')!.addEventListener('click', () => { playUiTick(); this.clearRoad() })
    this.root.querySelector('[data-copy]')!.addEventListener('click', () => this.copySeed())
    this.root.querySelector('[data-play]')!.addEventListener('click', () => this.begin())
  }

  private rollSeed(): number {
    // UI-only randomness (app code, not the sim) — a fresh puzzle in the shared space.
    return canonicalSeed(Math.floor(Math.random() * 0x7fffffff) >>> 0)
  }

  private loadSeed(seed: number): void {
    this.seed = canonicalSeed(seed)
    const layout = pathforgeLayout(this.seed)
    this.spawn = layout.spawn
    this.base = layout.base
    // Reload the saved design for this seed (endpoints are always road).
    const saved = loadPathforgeMaze(this.seed)
    this.road = new Set<number>(saved ?? [])
    this.road.add(pfKey(this.spawn[0], this.spawn[1]))
    this.road.add(pfKey(this.base[0], this.base[1]))
    this.root.querySelector('[data-seedcode]')!.textContent = seedToCode(this.seed)
    const best = pathforgeBest(this.seed)
    this.root.querySelector('[data-best]')!.textContent = best > 0 ? String(best) : '—'
    this.refresh()
  }

  private idxFromEvent(e: PointerEvent): number | null {
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
    const cell = el?.closest<HTMLElement>('.epf-cell')
    if (!cell || cell.dataset.idx === undefined) return null
    return Number(cell.dataset.idx)
  }

  private onPointerDown(e: PointerEvent): void {
    const idx = this.idxFromEvent(e)
    if (idx === null) return
    e.preventDefault()
    // Endpoints are permanent road — starting on one is a no-op paint (add) drag.
    const isEndpoint = idx === pfKey(this.spawn[0], this.spawn[1]) || idx === pfKey(this.base[0], this.base[1])
    this.paintAdd = isEndpoint ? true : !this.road.has(idx)
    this.painting = true
    try { (e.target as HTMLElement).setPointerCapture?.(e.pointerId) } catch { /* ignore */ }
    this.applyPaint(idx)
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.painting) return
    const idx = this.idxFromEvent(e)
    if (idx !== null) this.applyPaint(idx)
  }

  private applyPaint(idx: number): void {
    // Never erase the two endpoints — a valid route always needs them.
    if (idx === pfKey(this.spawn[0], this.spawn[1]) || idx === pfKey(this.base[0], this.base[1])) return
    const has = this.road.has(idx)
    if (this.paintAdd && !has) this.road.add(idx)
    else if (!this.paintAdd && has) this.road.delete(idx)
    else return
    this.refresh()
  }

  private clearRoad(): void {
    this.road = new Set<number>([pfKey(this.spawn[0], this.spawn[1]), pfKey(this.base[0], this.base[1])])
    this.refresh()
  }

  // Recompute validity + route, repaint cell classes, update status/controls.
  private refresh(): void {
    const v = validateMaze(this.road, this.spawn, this.base)
    this.route = v.route
    const onRoute = new Set<number>()
    if (v.route) for (const [c, r] of v.route) onRoute.add(pfKey(c, r))
    const spawnK = pfKey(this.spawn[0], this.spawn[1])
    const baseK = pfKey(this.base[0], this.base[1])

    for (let i = 0; i < this.cellEls.length; i++) {
      const el = this.cellEls[i]
      const glyph = el.querySelector<HTMLElement>('.ec')!
      let cls = 'epf-cell'
      let g = ''
      if (i === spawnK) { cls += ' spawn'; g = '⟳' }
      else if (i === baseK) { cls += ' base'; g = '✦' }
      else if (onRoute.has(i)) cls += ' route'
      else if (this.road.has(i)) cls += ' road'
      el.className = cls
      if (glyph.textContent !== g) glyph.textContent = g
    }

    this.root.classList.toggle('epf-invalid', !v.ok)
    const status = this.root.querySelector<HTMLElement>('[data-status]')!
    const text = this.root.querySelector<HTMLElement>('[data-statustext]')!
    const len = this.root.querySelector<HTMLElement>('[data-len]')!
    const tiles = this.root.querySelector<HTMLElement>('[data-tiles]')!
    const play = this.root.querySelector<HTMLButtonElement>('[data-play]')!
    tiles.textContent = String(this.road.size)
    if (v.ok && v.route) {
      status.classList.remove('bad')
      const n = v.route.length
      text.textContent = n <= 9 ? 'Valid — but short. Wind it longer!' : 'Valid maze — enemies take this route.'
      len.textContent = `${n} tiles of fire`
      play.disabled = false
    } else {
      status.classList.add('bad')
      text.textContent = v.reason
      len.textContent = ''
      play.disabled = true
    }
  }

  private begin(): void {
    const v = validateMaze(this.road, this.spawn, this.base)
    if (!v.ok || !v.route) { this.refresh(); return }
    playUiTick()
    // Persist the design for this seed so it reloads next visit.
    savePathforgeMaze(this.seed, Array.from(this.road))
    const seed = this.seed
    const route = v.route
    this.root.classList.add('epf-leave')
    window.setTimeout(() => this.handlers.onPlay(seed, route), appSettings.reducedMotion() ? 0 : 200)
  }

  private copySeed(): void {
    playUiTick()
    const label = this.root.querySelector('[data-copylabel]')
    let base = 'https://chromancer.io/'
    try {
      if (typeof location !== 'undefined' && /^https?:$/.test(location.protocol)) base = location.origin + location.pathname
    } catch { /* non-browser */ }
    const link = withRef(`${base}?pathforge=${encodeURIComponent(seedToCode(this.seed))}`)
    const done = (): void => {
      if (!label) return
      const prev = label.textContent
      label.textContent = 'COPIED!'
      window.setTimeout(() => { if (label) label.textContent = prev }, 1400)
    }
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(link).then(done, done)
    else done()
  }

  private leave(): void {
    playUiTick()
    this.root.classList.add('epf-leave')
    window.setTimeout(() => this.handlers.onBack(), appSettings.reducedMotion() ? 0 : 240)
  }

  destroy(): void {
    this.root.remove()
  }
}
