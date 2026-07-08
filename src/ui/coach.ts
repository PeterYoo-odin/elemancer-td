// COACH — the teach-by-doing layer. One instruction pill + one animated pointer
// + one spotlight ring. The WHOLE layer is pointer-events:none: the coach never
// intercepts a tap, never adds an "OK" button, never blocks play. The player
// completes a step by DOING it; the director (BattleScene) decides when to move on.

import { iconMarkup } from './icons'

const CSS = `
.chr-coach { position: fixed; inset: 0; z-index: 2600; pointer-events: none;
  font-family: 'Baloo 2','Nunito',system-ui,'Segoe UI',Arial,sans-serif; }
.chr-coach-pill { position: absolute; left: 50%; bottom: 316px; transform: translateX(-50%) translateY(8px);
  max-width: min(88vw, 420px); padding: 11px 20px; border-radius: 16px; text-align: center;
  background: linear-gradient(180deg, rgba(48,32,92,.96), rgba(28,17,58,.96));
  border: 1px solid rgba(196,166,255,.55); box-shadow: 0 10px 30px rgba(0,0,0,.55), 0 0 22px rgba(150,100,255,.35);
  color: #fff; opacity: 0; transition: opacity .35s ease, transform .35s ease; }
.chr-coach-pill.show { opacity: 1; transform: translateX(-50%) translateY(0); }
.chr-coach-pill .ct { font-size: 16px; font-weight: 900; letter-spacing: .3px; line-height: 1.25; }
.chr-coach-pill .cs { font-size: 12.5px; font-weight: 700; color: #cbbcff; margin-top: 3px; line-height: 1.3; }
.chr-coach-hand { position: absolute; left: 0; top: 0; font-size: 34px; opacity: 0;
  transition: opacity .3s ease; will-change: transform;
  filter: drop-shadow(0 3px 6px rgba(0,0,0,.6)); }
.chr-coach-hand.show { opacity: 1; animation: chrCoachTap 1.1s ease-in-out infinite; }
@keyframes chrCoachTap { 0%,100% { transform: translate(-50%,-10%) scale(1); }
  50% { transform: translate(-50%,-10%) translateY(-12px) scale(1.12); } }
.chr-coach-ringbox { position: absolute; border-radius: 18px; border: 3px solid #ffe27a; opacity: 0;
  box-shadow: 0 0 18px rgba(255,226,122,.8), inset 0 0 12px rgba(255,226,122,.35);
  transition: opacity .25s ease; will-change: transform; }
.chr-coach-ringbox.show { opacity: 1; animation: chrCoachRing 1.2s ease-in-out infinite; }
@keyframes chrCoachRing { 0%,100% { opacity: .95; transform: scale(1); } 50% { opacity: .55; transform: scale(1.05); } }
@media (prefers-reduced-motion: reduce) {
  .chr-coach-hand.show, .chr-coach-ringbox.show { animation: none; }
}
/* Landscape phones: the dock is a slim bottom rail (~108px), not the tall
   portrait stack — so the "Press START" pill must sit just above it instead of
   at bottom:316px, where on a 390-tall screen it would land in the top strip. */
@media (orientation: landscape) and (max-height: 520px) {
  .chr-coach-pill { bottom: 132px; }
}
`

export class Coach {
  private root: HTMLDivElement
  private style: HTMLStyleElement
  private pill: HTMLDivElement
  private title: HTMLDivElement
  private sub: HTMLDivElement
  private hand: HTMLDivElement
  private ringBox: HTMLDivElement
  private hideT = 0

  constructor() {
    this.style = document.createElement('style')
    this.style.textContent = CSS
    document.head.appendChild(this.style)
    this.root = document.createElement('div')
    this.root.className = 'chr-coach'
    this.pill = document.createElement('div')
    this.pill.className = 'chr-coach-pill'
    this.title = document.createElement('div')
    this.title.className = 'ct'
    this.sub = document.createElement('div')
    this.sub.className = 'cs'
    this.pill.append(this.title, this.sub)
    this.hand = document.createElement('div')
    this.hand.className = 'chr-coach-hand'
    this.hand.innerHTML = iconMarkup('hand', { size: 30, color: '#ffe08a' })
    this.ringBox = document.createElement('div')
    this.ringBox.className = 'chr-coach-ringbox'
    this.root.append(this.ringBox, this.pill, this.hand)
    document.body.appendChild(this.root)
  }

  /** Show (or update) the instruction pill. autoHideMs > 0 → fades on its own. */
  say(text: string, sub?: string, autoHideMs = 0): void {
    window.clearTimeout(this.hideT)
    this.title.textContent = text
    this.sub.textContent = sub ?? ''
    this.sub.style.display = sub ? '' : 'none'
    this.pill.classList.add('show')
    if (autoHideMs > 0) this.hideT = window.setTimeout(() => this.pill.classList.remove('show'), autoHideMs)
  }

  /** Point the animated hand at screen coordinates (call per-frame for moving anchors). */
  pointAt(x: number, y: number): void {
    this.hand.style.left = `${Math.round(x)}px`
    this.hand.style.top = `${Math.round(y)}px`
    this.hand.classList.add('show')
  }

  /** Point at the centre of a DOM element (HUD buttons). */
  pointAtEl(el: HTMLElement | null): void {
    if (!el) {
      this.hidePointer()
      return
    }
    const r = el.getBoundingClientRect()
    this.pointAt(r.left + r.width / 2, r.top + r.height * 0.25)
  }

  hidePointer(): void {
    this.hand.classList.remove('show')
  }

  /** Spotlight-ring a HUD element. A floating overlay box (never touches the
   *  target's DOM — no clipping, no pseudo-element conflicts). Re-call per
   *  frame for anchors that move; pass null to clear. */
  ring(el: HTMLElement | null): void {
    if (!el) {
      this.ringBox.classList.remove('show')
      return
    }
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) {
      this.ringBox.classList.remove('show')
      return
    }
    this.ringBox.style.left = `${Math.round(r.left - 6)}px`
    this.ringBox.style.top = `${Math.round(r.top - 6)}px`
    this.ringBox.style.width = `${Math.round(r.width + 12)}px`
    this.ringBox.style.height = `${Math.round(r.height + 12)}px`
    this.ringBox.style.borderRadius = `${Math.min(24, Math.round(Math.min(r.width, r.height) * 0.3) + 8)}px`
    this.ringBox.classList.add('show')
  }

  /** Clear everything visible but keep the layer alive for the next step. */
  clear(): void {
    window.clearTimeout(this.hideT)
    this.pill.classList.remove('show')
    this.hidePointer()
    this.ring(null)
  }

  dispose(): void {
    this.clear()
    this.root.remove()
    this.style.remove()
  }
}
