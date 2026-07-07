// ============================================================================
//  CUTSCENE — the motion-comic delivery layer. A lightweight, performant DOM
//  overlay that plays a sequence of painted "panels": a parallax key-art / procedural
//  sky, a drifting camera, typed-text dialogue, and a chapter card — then hands
//  control back. NO video, NO heavy assets: painted key art where we have it
//  (public/concepts), CSS/SVG painterly gradients everywhere else.
//
//  Every cutscene is SKIPPABLE (button + any tap advances) and REDUCE-MOTION
//  aware (no parallax, no typing, static panels you tap through). It sits above
//  Phaser as its own overlay, exactly like BattleHud / WorldMap — so it can be
//  played from any scene, and it never touches the sim (narrative-inert).
// ============================================================================

import { REALMS } from '../game/levels'
import { appSettings } from './settings'
import { speakerInfo } from './barkUi'
import { glyphIcon } from './icons'
import { playUiTick } from './sfx'
import type { Cutscene, CutsceneBeat } from '../game/cutscenes'
import { markCutsceneSeen, getCutscene, isCutsceneSeen } from '../game/cutscenes'

const CSS = `
.ecs { position: fixed; inset: 0; z-index: 60; overflow: hidden; background: #05030e;
  font-family: 'Baloo 2','Nunito',system-ui,'Segoe UI',Arial,sans-serif; color: #efe9ff;
  -webkit-tap-highlight-color: transparent; user-select: none; cursor: pointer;
  animation: ecsIn .5s ease both; }
@keyframes ecsIn { from { opacity: 0; } to { opacity: 1; } }
.ecs.ecs-out { opacity: 0; transition: opacity .45s ease; pointer-events: none; }

/* ART STAGE — the parallax panel. Layers translate at different rates for depth. */
.ecs-stage { position: absolute; inset: -6%; transition: transform 7s linear; will-change: transform; }
.ecs-layer { position: absolute; inset: 0; background-size: cover; background-position: center;
  transition: transform 7s linear, opacity .8s ease; will-change: transform, opacity; }
.ecs-sky { }
.ecs-glow { mix-blend-mode: screen; opacity: .9; }
.ecs-ridgefar { background-repeat: no-repeat; background-position: bottom center; background-size: 140% auto; }
.ecs-ridgenear { background-repeat: no-repeat; background-position: bottom center; background-size: 130% auto; }
.ecs-key { background-size: cover; background-position: center; opacity: 0; transition: opacity .8s ease, transform 7s linear; }
.ecs-key.on { opacity: 1; }
.ecs-vig { position: absolute; inset: 0; pointer-events: none;
  background: radial-gradient(120% 90% at 50% 42%, transparent 40%, rgba(5,3,14,.5) 78%, rgba(5,3,14,.92) 100%); }
.ecs-grade { position: absolute; inset: 0; pointer-events: none; transition: opacity .8s ease, backdrop-filter .8s ease; }
.ecs-grade.grey { backdrop-filter: grayscale(1) contrast(.92) brightness(.96); -webkit-backdrop-filter: grayscale(1) contrast(.92) brightness(.96);
  background: rgba(120,118,132,.14); }
.ecs-grade.bloom { background: radial-gradient(90% 70% at 50% 55%, rgba(255,240,210,.14), transparent 70%); }
.ecs-grade.dusk { background: linear-gradient(180deg, rgba(30,16,60,.28), rgba(8,5,20,.5)); }

/* drifting motes / ash / snow — pure CSS, cheap, disabled under reduce-motion */
.ecs-fx { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.ecs-mote { position: absolute; border-radius: 50%; opacity: 0; animation: ecsDrift linear infinite; }
@keyframes ecsDrift {
  0% { transform: translateY(20px); opacity: 0; }
  12% { opacity: .8; }
  88% { opacity: .7; }
  100% { transform: translateY(-115vh); opacity: 0; }
}

/* CHAPTER heading — big centred title that breathes in */
.ecs-heading { position: absolute; left: 0; right: 0; top: 34%; text-align: center; padding: 0 30px;
  transform: translateY(10px); opacity: 0; transition: opacity 1s ease, transform 1s ease; }
.ecs-heading.on { opacity: 1; transform: translateY(0); }
.ecs-heading .h1 { font-size: clamp(26px, 8vw, 46px); font-weight: 900; letter-spacing: .04em; line-height: 1.08;
  text-shadow: 0 4px 24px rgba(0,0,0,.7), 0 0 40px var(--hg, rgba(176,107,255,.4)); }
.ecs-heading .h2 { margin-top: 10px; font-size: 13px; font-weight: 800; letter-spacing: .32em; color: #b8a5e8; }

/* DIALOGUE card — the typed line, speaker portrait glyph + name */
.ecs-cap { position: absolute; left: 50%; bottom: calc(46px + env(safe-area-inset-bottom)); transform: translateX(-50%) translateY(14px);
  width: min(560px, 92vw); opacity: 0; transition: opacity .4s ease, transform .4s ease; }
.ecs-cap.on { opacity: 1; transform: translateX(-50%) translateY(0); }
.ecs-cap.narrate { text-align: center; }
.ecs-cn { display: flex; align-items: center; gap: 8px; font-size: 11px; font-weight: 900; letter-spacing: .14em; margin-bottom: 6px; }
.ecs-cap.narrate .ecs-cn { display: none; }
.ecs-ct { font-size: 17px; line-height: 1.45; font-weight: 600; min-height: 1.4em;
  padding: 13px 16px; border-radius: 16px;
  background: linear-gradient(180deg, rgba(20,13,38,.86), rgba(12,8,26,.9));
  border: 1px solid rgba(255,255,255,.12); box-shadow: 0 12px 34px rgba(0,0,0,.5); }
.ecs-cap.narrate .ecs-ct { background: transparent; border: 0; box-shadow: none; font-style: italic; font-size: 18px; color: #e9e2ff;
  text-shadow: 0 2px 14px rgba(0,0,0,.9); }
.ecs-cap.morose .ecs-ct { font-style: italic; color: #cfcbdd; background: linear-gradient(180deg, rgba(36,36,44,.9), rgba(16,16,22,.92)); }
.ecs-caret { display: inline-block; width: 2px; height: 1em; margin-left: 1px; vertical-align: -2px; background: currentColor;
  opacity: .0; animation: ecsCaret 1s steps(2) infinite; }
@keyframes ecsCaret { 50% { opacity: .8; } }

/* controls */
.ecs-skip { position: absolute; top: calc(14px + env(safe-area-inset-top)); right: 14px; z-index: 3;
  padding: 8px 15px; border-radius: 999px; font: inherit; font-size: 12px; font-weight: 800; letter-spacing: .1em;
  color: #d9cff5; background: rgba(20,13,38,.6); border: 1px solid rgba(255,255,255,.18); cursor: pointer; }
.ecs-skip:active { transform: scale(.94); }
.ecs-dots { position: absolute; bottom: calc(20px + env(safe-area-inset-bottom)); left: 50%; transform: translateX(-50%);
  display: flex; gap: 6px; z-index: 3; }
.ecs-dot { width: 6px; height: 6px; border-radius: 50%; background: rgba(255,255,255,.24); transition: background .3s, width .3s; }
.ecs-dot.on { background: #ffe1a6; width: 16px; border-radius: 3px; }
.ecs-hint { position: absolute; bottom: calc(20px + env(safe-area-inset-bottom)); right: 16px; z-index: 3;
  font-size: 10px; font-weight: 800; letter-spacing: .18em; color: rgba(217,207,245,.5); }
@media (max-width: 520px) { .ecs-hint { display: none; } }
`

let cssInjected = false

function hexNum(c: number): string { return '#' + (c & 0xffffff).toString(16).padStart(6, '0') }

/** A ridge silhouette as an inline SVG data-URL, jagged + palette-tinted. */
function ridgeSvg(color: string, seed: number, tall: number): string {
  const pts: string[] = ['0,100']
  let x = 0
  let r = seed >>> 0
  const rnd = (): number => { r = (r * 1103515245 + 12345) & 0x7fffffff; return r / 0x7fffffff }
  while (x < 100) {
    const h = 100 - tall - rnd() * tall * 0.8
    pts.push(`${x.toFixed(1)},${h.toFixed(1)}`)
    x += 6 + rnd() * 12
  }
  pts.push('100,100')
  const poly = pts.join(' ')
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' preserveAspectRatio='none'><polygon points='${poly}' fill='${color}'/></svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

export class CutscenePlayer {
  private root: HTMLDivElement
  private stage: HTMLDivElement
  private sky: HTMLDivElement
  private glow: HTMLDivElement
  private ridgeFar: HTMLDivElement
  private ridgeNear: HTMLDivElement
  private key: HTMLDivElement
  private grade: HTMLDivElement
  private fxLayer: HTMLDivElement
  private heading: HTMLDivElement
  private cap: HTMLDivElement
  private capName: HTMLDivElement
  private capText: HTMLDivElement
  private dots: HTMLDivElement

  private i = -1
  private timers: number[] = []
  private typeTimer = 0
  private typing = false
  private fullText = ''
  private done = false
  private reduce = appSettings.reducedMotion()

  constructor(private scene: Cutscene, private onDone: () => void) {
    if (!cssInjected) {
      cssInjected = true
      const style = document.createElement('style')
      style.textContent = CSS
      document.head.appendChild(style)
    }

    this.root = document.createElement('div')
    this.root.className = 'ecs'
    this.root.innerHTML = `
      <div class="ecs-stage">
        <div class="ecs-layer ecs-sky"></div>
        <div class="ecs-layer ecs-glow"></div>
        <div class="ecs-layer ecs-ridgefar"></div>
        <div class="ecs-layer ecs-ridgenear"></div>
        <div class="ecs-layer ecs-key"></div>
      </div>
      <div class="ecs-grade"></div>
      <div class="ecs-fx"></div>
      <div class="ecs-vig"></div>
      <div class="ecs-heading"><div class="h1"></div><div class="h2"></div></div>
      <div class="ecs-cap"><div class="ecs-cn"></div><div class="ecs-ct"></div></div>
      <button class="ecs-skip" data-skip>SKIP ✕</button>
      <div class="ecs-dots"></div>
      <div class="ecs-hint">TAP TO CONTINUE</div>`

    this.stage = this.q('.ecs-stage')
    this.sky = this.q('.ecs-sky')
    this.glow = this.q('.ecs-glow')
    this.ridgeFar = this.q('.ecs-ridgefar')
    this.ridgeNear = this.q('.ecs-ridgenear')
    this.key = this.q('.ecs-key')
    this.grade = this.q('.ecs-grade')
    this.fxLayer = this.q('.ecs-fx')
    this.heading = this.q('.ecs-heading')
    this.cap = this.q('.ecs-cap')
    this.capName = this.q('.ecs-cn')
    this.capText = this.q('.ecs-ct')
    this.dots = this.q('.ecs-dots')

    // progress dots
    this.dots.innerHTML = scene.beats.map(() => '<span class="ecs-dot"></span>').join('')

    this.root.addEventListener('click', (e) => {
      const t = e.target as HTMLElement
      if (t.closest('[data-skip]')) { playUiTick(); this.finish(); return }
      this.onTap()
    })

    document.body.appendChild(this.root)
    this.next()
  }

  private q<T extends HTMLElement = HTMLDivElement>(sel: string): T {
    return this.root.querySelector(sel) as T
  }

  // ---- panel rendering ------------------------------------------------------
  private renderBackground(b: CutsceneBeat): void {
    // painterly procedural sky from a realm palette, or a supplied bg
    let deep = '#120a24', mid = '#2a1150', glow = 'rgba(176,107,255,.28)', ridge = '#190b34', ridgeFar = '#2c165a'
    const realm = b.realm ? REALMS.find((r) => r.id === b.realm) : undefined
    if (realm) { deep = realm.ui.deep; mid = realm.ui.mid; glow = realm.ui.glow; ridge = realm.ui.ridge; ridgeFar = realm.ui.ridgeFar }

    this.sky.style.background = b.bg ?? `linear-gradient(180deg, ${mid} 0%, ${deep} 68%, #05030e 100%)`
    this.glow.style.background = `radial-gradient(80% 60% at 50% 30%, ${glow}, transparent 62%)`
    // two ridge silhouettes, seeded per beat index so panels differ
    const seed = (this.i + 1) * 2654435761
    this.ridgeFar.style.backgroundImage = ridgeSvg(ridgeFar, seed, 34)
    this.ridgeNear.style.backgroundImage = ridgeSvg(ridge, seed ^ 0x9e3779b9, 22)

    // painted key art on top, if provided
    if (b.art) {
      this.key.style.backgroundImage = `url("${import.meta.env.BASE_URL}${b.art}")`
      this.key.classList.add('on')
    } else {
      this.key.classList.remove('on')
      this.key.style.backgroundImage = 'none'
    }

    // colour grade / tone
    this.grade.className = 'ecs-grade' + (b.tone ? ' ' + b.tone : '')

    this.renderFx(b)
  }

  private renderFx(b: CutsceneBeat): void {
    this.fxLayer.innerHTML = ''
    if (this.reduce || !b.fx || b.fx === 'none') return
    const conf =
      b.fx === 'snow' ? { n: 26, c: '#dff2ff', min: 2, max: 5, dur: [9, 16] as const } :
      b.fx === 'ash' ? { n: 20, c: '#c9b9a8', min: 1, max: 3, dur: [7, 13] as const } :
      { n: 22, c: '#ffe1a6', min: 1.5, max: 3.5, dur: [8, 15] as const } // motes
    let html = ''
    for (let k = 0; k < conf.n; k++) {
      const s = conf.min + ((k * 37) % 100) / 100 * (conf.max - conf.min)
      const left = ((k * 61) % 100)
      const delay = ((k * 29) % 100) / 100 * 8
      const dur = conf.dur[0] + ((k * 53) % 100) / 100 * (conf.dur[1] - conf.dur[0])
      html += `<span class="ecs-mote" style="left:${left}%;bottom:-10px;width:${s}px;height:${s}px;background:${conf.c};animation-duration:${dur}s;animation-delay:-${delay}s;box-shadow:0 0 ${s * 2}px ${conf.c}"></span>`
    }
    this.fxLayer.innerHTML = html
  }

  private applyPan(b: CutsceneBeat): void {
    // reset then, next frame, glide to the pan pose (CSS transition on transform)
    const from = this.panPose(b.pan, 0)
    const to = this.panPose(b.pan, 1)
    this.stage.style.transition = 'none'
    this.setStageTransform(from)
    if (this.reduce) { this.setStageTransform(this.panPose(b.pan, 0.5)); return }
    // force reflow so the from-pose sticks before we transition to the to-pose
    void this.stage.offsetWidth
    this.stage.style.transition = ''
    requestAnimationFrame(() => this.setStageTransform(to))
  }

  private setStageTransform(p: { x: number; y: number; s: number }): void {
    const t = `translate(${p.x}%, ${p.y}%) scale(${p.s})`
    this.stage.style.transform = t
    // key art drifts a touch more than the stage for a shallow-parallax feel
    this.key.style.transform = `scale(${p.s})`
  }

  private panPose(pan: CutsceneBeat['pan'], u: number): { x: number; y: number; s: number } {
    const d = 4 // percent of travel
    switch (pan) {
      case 'in': return { x: 0, y: 0, s: 1.04 + u * 0.09 }
      case 'out': return { x: 0, y: 0, s: 1.16 - u * 0.1 }
      case 'left': return { x: -d + u * d * 2, y: 0, s: 1.08 }
      case 'right': return { x: d - u * d * 2, y: 0, s: 1.08 }
      case 'up': return { x: 0, y: d - u * d * 2, s: 1.08 }
      case 'down': return { x: 0, y: -d + u * d * 2, s: 1.08 }
      default: return { x: 0, y: 0, s: 1.06 }
    }
  }

  // ---- flow -----------------------------------------------------------------
  private next(): void {
    this.i++
    if (this.i >= this.scene.beats.length) { this.finish(); return }
    const b = this.scene.beats[this.i]
    this.updateDots()
    this.renderBackground(b)
    this.applyPan(b)

    // chapter heading
    if (b.heading) {
      this.heading.querySelector('.h1')!.textContent = b.heading
      // subtitle = the chapter title, but never a redundant echo of the heading
      const sub = this.scene.title && this.scene.title !== b.heading ? this.scene.title : ''
      this.heading.querySelector('.h2')!.textContent = sub
      const hg = b.realm ? (REALMS.find((r) => r.id === b.realm)?.ui.glow ?? 'rgba(176,107,255,.4)') : 'rgba(176,107,255,.4)'
      this.heading.style.setProperty('--hg', hg)
      requestAnimationFrame(() => this.heading.classList.add('on'))
    } else {
      this.heading.classList.remove('on')
    }

    // dialogue
    if (b.text) {
      const narrate = !b.speaker
      this.cap.className = 'ecs-cap' + (narrate ? ' narrate' : '') + (b.speaker === 'morose' ? ' morose' : '')
      if (!narrate && b.speaker) {
        const s = speakerInfo(b.speaker)
        this.capName.innerHTML = `${glyphIcon(s.glyph, { size: 14, color: s.color })}<span style="color:${s.color}">${s.name}</span>`
        this.capText.style.color = ''
      }
      requestAnimationFrame(() => this.cap.classList.add('on'))
      this.typeText(b.text)
    } else {
      this.cap.classList.remove('on')
      this.capText.textContent = ''
      // pure-visual beat: auto-advance after the hold (or a default breath)
      this.armAutoAdvance(b.hold ?? 2600)
    }
  }

  private typeText(text: string): void {
    this.fullText = text
    this.done = false
    window.clearInterval(this.typeTimer)
    if (this.reduce) { this.capText.textContent = text; this.onLineDone(); return }
    this.typing = true
    let n = 0
    const step = Math.max(14, Math.min(34, 900 / Math.max(12, text.length)))
    this.capText.innerHTML = '<span class="ecs-caret"></span>'
    this.typeTimer = window.setInterval(() => {
      n++
      this.capText.innerHTML = this.esc(text.slice(0, n)) + (n < text.length ? '<span class="ecs-caret"></span>' : '')
      if (n >= text.length) { window.clearInterval(this.typeTimer); this.typing = false; this.onLineDone() }
    }, step)
  }

  private onLineDone(): void {
    this.done = true
    const b = this.scene.beats[this.i]
    if (b && b.hold && b.hold > 0) this.armAutoAdvance(b.hold)
  }

  private armAutoAdvance(ms: number): void {
    this.timers.push(window.setTimeout(() => this.next(), ms))
  }

  private clearTimers(): void {
    for (const t of this.timers) window.clearTimeout(t)
    this.timers = []
  }

  private onTap(): void {
    if (this.typing) {
      // first tap completes the current line…
      window.clearInterval(this.typeTimer)
      this.typing = false
      this.capText.textContent = this.fullText
      this.onLineDone()
      return
    }
    // …a tap on a finished line advances
    this.clearTimers()
    this.next()
  }

  private updateDots(): void {
    const nodes = this.dots.querySelectorAll('.ecs-dot')
    nodes.forEach((d, k) => d.classList.toggle('on', k === this.i))
  }

  private finish(): void {
    window.clearInterval(this.typeTimer)
    this.clearTimers()
    markCutsceneSeen(this.scene.id)
    this.root.classList.add('ecs-out')
    window.setTimeout(() => {
      this.root.remove()
      this.onDone()
    }, 460)
  }

  private esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }
}

let active: CutscenePlayer | null = null

/**
 * Play a cutscene by id (or Cutscene object) as a full-screen overlay, then call
 * onDone. Safe no-op (fires onDone next tick) if the id is unknown, so callers can
 * always chain their navigation. One cutscene at a time.
 */
export function playCutscene(idOrScene: string | Cutscene, onDone: () => void = () => {}): void {
  const scene = typeof idOrScene === 'string' ? getCutscene(idOrScene) : idOrScene
  if (!scene || active) { window.setTimeout(onDone, 0); return }
  active = new CutscenePlayer(scene, () => { active = null; onDone() })
}

/** Play a cutscene only if it hasn't been seen; otherwise run onDone immediately. */
export function playCutsceneOnce(id: string, onDone: () => void = () => {}): void {
  if (isCutsceneSeen(id)) { onDone(); return }
  playCutscene(id, onDone)
}
