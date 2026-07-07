// barkUi — the one bark bubble. A small DOM speech card (portrait glyph + name
// + ≤3-line text) that slides up, lingers, and fades. Non-modal: everything
// around it stays tappable; tapping the bubble itself dismisses it (skippable).
// A new bark replaces the current one — there is never a queue to wait through.

import { HEROES } from '../game/heroes'
import { NARRATOR_SPEAKERS, type Bark } from '../game/barks'

const CSS = `
.ebk { position: fixed; left: 50%; bottom: calc(216px + env(safe-area-inset-bottom)); z-index: 44;
  transform: translateX(-50%) translateY(14px); opacity: 0; width: min(430px, 92vw);
  display: flex; align-items: flex-start; gap: 10px; padding: 10px 14px 11px 10px; border-radius: 16px;
  background: linear-gradient(180deg, rgba(34,24,66,.96), rgba(20,12,40,.96));
  border: 1px solid var(--bk, #b06bff); box-shadow: 0 10px 30px rgba(0,0,0,.55), 0 0 18px color-mix(in srgb, var(--bk, #b06bff) 25%, transparent);
  font-family: 'Baloo 2','Nunito',system-ui,'Segoe UI',Arial,sans-serif; color: #efe9ff;
  transition: opacity .22s ease, transform .22s ease; cursor: pointer; user-select: none;
  -webkit-tap-highlight-color: transparent; pointer-events: auto; }
.ebk.show { opacity: 1; transform: translateX(-50%) translateY(0); }
.ebk.map { bottom: calc(88px + env(safe-area-inset-bottom)); z-index: 24; }
.ebk .p { flex: 0 0 auto; width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center;
  font-size: 20px; background: radial-gradient(circle at 35% 30%, color-mix(in srgb, var(--bk) 55%, #fff), color-mix(in srgb, var(--bk) 70%, #000));
  border: 2px solid color-mix(in srgb, var(--bk) 60%, #fff); box-shadow: 0 2px 8px rgba(0,0,0,.5); }
.ebk .b { flex: 1 1 auto; min-width: 0; }
.ebk .n { font-size: 11px; font-weight: 900; letter-spacing: .12em; color: var(--bk); text-shadow: 0 1px 2px rgba(0,0,0,.6); }
.ebk .t { margin-top: 2px; font-size: 14.5px; line-height: 1.32; font-weight: 600;
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.ebk.morose { background: linear-gradient(180deg, rgba(38,38,46,.97), rgba(18,18,24,.97)); }
.ebk.morose .t { font-style: italic; color: #cfcbdd; }
`

function hex(c: number): string {
  return '#' + (c & 0xffffff).toString(16).padStart(6, '0')
}

let cssInjected = false
let current: HTMLDivElement | null = null
let hideTimer = 0
let removeTimer = 0

/** name/colour/glyph for any speaker key (hero id or narrator) — shared with map cards */
export function speakerInfo(key: string): { name: string; color: string; glyph: string } {
  const hero = HEROES[key]
  if (hero) return { name: hero.name.toUpperCase(), color: hex(hero.color), glyph: hero.glyph }
  const n = NARRATOR_SPEAKERS[key]
  if (n) return { name: n.name.toUpperCase(), color: hex(n.color), glyph: n.glyph }
  return { name: key.toUpperCase(), color: '#b06bff', glyph: '✦' }
}

export interface BarkShowOptions {
  /** 'map' anchors lower (world map has no battle dock) */
  layout?: 'battle' | 'map'
  /** seconds on screen (default scales with text length) */
  duration?: number
}

/** Show a bark line (speaker key + text). Replaces any bark on screen. */
export function showBarkLine(speaker: string, text: string, opts: BarkShowOptions = {}): void {
  if (!cssInjected) {
    cssInjected = true
    const style = document.createElement('style')
    style.textContent = CSS
    document.head.appendChild(style)
  }
  dismissBark()

  const s = speakerInfo(speaker)
  const d = document.createElement('div')
  d.className = 'ebk' + (opts.layout === 'map' ? ' map' : '') + (speaker === 'morose' ? ' morose' : '')
  d.style.setProperty('--bk', s.color)
  d.innerHTML = `<div class="p">${s.glyph}</div><div class="b"><div class="n"></div><div class="t"></div></div>`
  d.querySelector('.n')!.textContent = s.name
  d.querySelector('.t')!.textContent = text
  d.addEventListener('pointerdown', (e) => {
    e.stopPropagation()
    dismissBark()
  })
  document.body.appendChild(d)
  current = d
  requestAnimationFrame(() => d.classList.add('show'))

  const secs = opts.duration ?? Math.min(6, 2.6 + text.length * 0.03)
  hideTimer = window.setTimeout(() => dismissBark(), secs * 1000)
}

export function showBark(bark: Bark, opts: BarkShowOptions = {}): void {
  showBarkLine(bark.speaker, bark.text, opts)
}

/** Instantly fade out whatever bark is showing (safe to call any time). */
export function dismissBark(): void {
  window.clearTimeout(hideTimer)
  window.clearTimeout(removeTimer)
  const d = current
  current = null
  if (!d) return
  d.classList.remove('show')
  d.style.pointerEvents = 'none'
  removeTimer = window.setTimeout(() => d.remove(), 240)
}
