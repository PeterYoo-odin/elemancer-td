// Global tooltip engine — the "total information" layer. Hover on desktop,
// LONG-PRESS on touch; every stat, button and chip in the game can explain
// itself. One singleton bubble is shared app-wide (so tooltips can never
// stack), content is provided lazily at show-time (so numbers are always
// live), and a long-press that opened a tooltip swallows the click that
// follows so peeking at a button never accidentally activates it.

export interface TipRow {
  k: string
  v: string
  c?: string // value colour (css)
}

export interface TipContent {
  tag?: string // small kicker line, e.g. "TOWER · PHYSICAL"
  title: string
  accent?: string // css colour for the border/title glow
  body?: string // one or two sentences, plain language
  rows?: TipRow[] // labelled stat rows
  foot?: string // italic footer, e.g. lore or a strategy hint
}

type Provider = () => TipContent | null

const CSS = `
.ctip { position: fixed; z-index: 9999; pointer-events: none; width: max-content;
  max-width: min(320px, 88vw); padding: 11px 13px 10px; border-radius: 14px;
  background: linear-gradient(180deg, rgba(38,27,72,.97), rgba(19,11,38,.985));
  border: 1px solid var(--tipa, rgba(255,255,255,.22));
  box-shadow: 0 16px 44px rgba(0,0,0,.65), 0 0 22px color-mix(in srgb, var(--tipa, #b06bff) 22%, transparent),
    inset 0 1px 0 rgba(255,255,255,.07);
  font-family: 'Baloo 2','Nunito',system-ui,'Segoe UI',Arial,sans-serif; color: #efe9ff;
  opacity: 0; transform: translateY(5px) scale(.97); transition: opacity .14s ease, transform .14s ease; }
.ctip.show { opacity: 1; transform: none; }
.ctip.noanim { transition: none; }
.ctip-tag { font-size: 9.5px; font-weight: 800; letter-spacing: .22em; color: #9d8fc5; margin-bottom: 2px; }
.ctip-title { font-size: 15px; font-weight: 800; line-height: 1.2; color: var(--tipa, #ffe27a);
  text-shadow: 0 0 14px color-mix(in srgb, var(--tipa, #ffe27a) 35%, transparent); }
.ctip-body { margin-top: 5px; font-size: 12.5px; line-height: 1.45; color: #d8d0ff; }
.ctip-rows { margin-top: 7px; display: grid; grid-template-columns: auto 1fr; gap: 3px 12px; }
.ctip-rows .k { font-size: 11px; font-weight: 700; letter-spacing: .06em; color: #9d8fc5; align-self: baseline; }
.ctip-rows .v { font-size: 12px; font-weight: 800; color: #fff; text-align: right;
  font-variant-numeric: tabular-nums; align-self: baseline; }
.ctip-foot { margin-top: 7px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,.09);
  font-size: 11.5px; line-height: 1.4; font-style: italic; color: #b6a9dd; }
.ctip-arrow { position: absolute; width: 12px; height: 12px; transform: rotate(45deg);
  background: inherit; border: 1px solid var(--tipa, rgba(255,255,255,.22)); }
.ctip.below .ctip-arrow { top: -7px; border-right: 0; border-bottom: 0;
  background: rgba(38,27,72,.97); }
.ctip.above .ctip-arrow { bottom: -7px; border-left: 0; border-top: 0;
  background: rgba(19,11,38,.985); }
`

const LONG_PRESS_MS = 330
const HOVER_MS = 120
const MOVE_SLOP = 12 // px of finger travel before a press stops counting

let styleInjected = false
let bubble: HTMLDivElement | null = null
let activeTarget: HTMLElement | null = null
let showTimer = 0
let hideTimer = 0
let suppressNextClick = false

function ensureStyle(): void {
  if (styleInjected) return
  styleInjected = true
  const s = document.createElement('style')
  s.textContent = CSS
  document.head.appendChild(s)
  // A long-press that opened a tooltip must NOT fire the button underneath.
  window.addEventListener(
    'click',
    (e) => {
      if (suppressNextClick) {
        suppressNextClick = false
        e.stopPropagation()
        e.preventDefault()
      }
    },
    true,
  )
  // Any scroll/resize invalidates the anchor position — just dismiss.
  window.addEventListener('scroll', () => dismissTip(), { capture: true, passive: true })
  window.addEventListener('resize', () => dismissTip())
}

function ensureBubble(): HTMLDivElement {
  if (bubble) return bubble
  bubble = document.createElement('div')
  bubble.className = 'ctip'
  document.body.appendChild(bubble)
  return bubble
}

function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

function render(c: TipContent): HTMLDivElement {
  const b = ensureBubble()
  b.innerHTML = ''
  b.style.setProperty('--tipa', c.accent ?? '#ffe27a')
  if (c.tag) {
    const t = document.createElement('div')
    t.className = 'ctip-tag'
    t.textContent = c.tag
    b.appendChild(t)
  }
  const title = document.createElement('div')
  title.className = 'ctip-title'
  title.textContent = c.title
  b.appendChild(title)
  if (c.body) {
    const body = document.createElement('div')
    body.className = 'ctip-body'
    body.textContent = c.body
    b.appendChild(body)
  }
  if (c.rows && c.rows.length) {
    const rows = document.createElement('div')
    rows.className = 'ctip-rows'
    for (const r of c.rows) {
      const k = document.createElement('div')
      k.className = 'k'
      k.textContent = r.k
      const v = document.createElement('div')
      v.className = 'v'
      v.textContent = r.v
      if (r.c) v.style.color = r.c
      rows.append(k, v)
    }
    b.appendChild(rows)
  }
  if (c.foot) {
    const f = document.createElement('div')
    f.className = 'ctip-foot'
    f.textContent = c.foot
    b.appendChild(f)
  }
  const arrow = document.createElement('div')
  arrow.className = 'ctip-arrow'
  b.appendChild(arrow)
  return b
}

function place(target: HTMLElement): void {
  const b = ensureBubble()
  const r = target.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight
  // measure
  b.style.left = '0px'
  b.style.top = '0px'
  const bw = b.offsetWidth
  const bh = b.offsetHeight
  const cx = r.left + r.width / 2
  const margin = 8
  let left = Math.round(Math.min(Math.max(cx - bw / 2, margin), vw - bw - margin))
  const above = r.top - bh - 12
  let top: number
  if (above >= margin) {
    top = Math.round(above)
    b.classList.add('above')
    b.classList.remove('below')
  } else {
    top = Math.round(Math.min(r.bottom + 12, vh - bh - margin))
    b.classList.add('below')
    b.classList.remove('above')
  }
  b.style.left = `${left}px`
  b.style.top = `${top}px`
  const arrow = b.querySelector<HTMLElement>('.ctip-arrow')
  if (arrow) arrow.style.left = `${Math.round(Math.min(Math.max(cx - left - 6, 10), bw - 22))}px`
}

function show(target: HTMLElement, provide: Provider): void {
  const content = provide()
  if (!content) return
  window.clearTimeout(hideTimer)
  const b = render(content)
  b.classList.toggle('noanim', reducedMotion())
  activeTarget = target
  place(target)
  // force layout so the entrance transition runs even on a same-frame re-show
  void b.offsetWidth
  b.classList.add('show')
}

/** Hide the tooltip immediately (scene teardown, scrolls, overlay swaps). */
export function dismissTip(): void {
  window.clearTimeout(showTimer)
  activeTarget = null
  if (!bubble) return
  bubble.classList.remove('show')
}

/**
 * Attach a tooltip to an element. Desktop: shows on hover. Touch: shows on
 * long-press (and swallows the click that would otherwise fire on release).
 * The provider runs at show-time, so it can read live sim state.
 */
export function attachTip(el: HTMLElement, provide: Provider): void {
  ensureStyle()
  let pressX = 0
  let pressY = 0
  let pressed = false
  let longFired = false

  const cancelPress = (): void => {
    pressed = false
    window.clearTimeout(showTimer)
    if (longFired) {
      // the click (if any) fires right after pointerup; if none arrives —
      // finger slid off the button — don't let the stale flag eat a later tap
      window.setTimeout(() => { suppressNextClick = false }, 300)
    }
    if (activeTarget === el) {
      window.clearTimeout(hideTimer)
      hideTimer = window.setTimeout(() => { if (activeTarget === el) dismissTip() }, 80)
    }
  }

  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return
    pressed = true
    longFired = false
    pressX = e.clientX
    pressY = e.clientY
    window.clearTimeout(showTimer)
    showTimer = window.setTimeout(() => {
      if (!pressed) return
      longFired = true
      suppressNextClick = true
      show(el, provide)
    }, LONG_PRESS_MS)
  })
  el.addEventListener('pointermove', (e) => {
    if (!pressed || longFired) return
    const dx = e.clientX - pressX
    const dy = e.clientY - pressY
    if (dx * dx + dy * dy > MOVE_SLOP * MOVE_SLOP) cancelPress()
  })
  el.addEventListener('pointerup', cancelPress)
  el.addEventListener('pointercancel', () => {
    // finger became a scroll — make sure the stale suppress flag can't eat a future tap
    if (!longFired) suppressNextClick = false
    cancelPress()
  })
  el.addEventListener('contextmenu', (e) => e.preventDefault())

  el.addEventListener('pointerenter', (e) => {
    if (e.pointerType !== 'mouse') return
    window.clearTimeout(showTimer)
    showTimer = window.setTimeout(() => show(el, provide), HOVER_MS)
  })
  el.addEventListener('pointerleave', (e) => {
    if (e.pointerType !== 'mouse') return
    window.clearTimeout(showTimer)
    if (activeTarget === el) dismissTip()
  })
}
