// HERO AWAKENING — the brief cinematic beat when a hero crosses Lv 3 and their
// SIGNATURE wakes. It is the payoff for levelling: the portrait rises out of the
// dark on an element bloom, the signature is named, and the hero speaks their
// arc's awakening line (canon: chromancer-narrative-bible.md). One-tap dismiss,
// auto-closes, and degrades to a still, readable card under reduce-motion.
//
// Pure presentation: overlay + CSS, no sim, no persistence. HeroCollection calls
// playHeroAwakening(heroId) exactly when economy.levelUpHero crosses the threshold.

import { HEROES } from '../game/heroes'
import { heroArc, signatureName } from '../game/heroArcs'
import { heroArtUrl } from './heroArt'
import { appSettings } from './settings'
import { glyphIcon } from './icons'

const CSS = `
.haw { position: fixed; inset: 0; z-index: 70; display: grid; place-items: center;
  background: radial-gradient(120% 90% at 50% 42%, rgba(12,7,26,.72), rgba(5,3,12,.95));
  backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px);
  font-family: 'Baloo 2','Nunito',system-ui,'Segoe UI',Arial,sans-serif; color: #efe9ff;
  cursor: pointer; -webkit-tap-highlight-color: transparent; user-select: none;
  animation: hawIn .4s ease both; }
.haw.haw-out { animation: hawOut .4s ease both; }
@keyframes hawIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes hawOut { from { opacity: 1; } to { opacity: 0; } }
.haw-card { position: relative; width: min(440px, 92vw); text-align: center; padding: 8px; }
.haw-bloom { position: absolute; left: 50%; top: 46%; width: 340px; height: 340px; margin: -170px 0 0 -170px;
  border-radius: 50%; pointer-events: none; opacity: .0;
  background: radial-gradient(circle, var(--hc,#b06bff) 0%, transparent 62%);
  mix-blend-mode: screen; animation: hawBloom 2.4s ease-out both; }
@keyframes hawBloom { 0% { opacity: 0; transform: scale(.4); } 30% { opacity: .85; } 100% { opacity: .5; transform: scale(1.12); } }
.haw-ring { position: absolute; left: 50%; top: 46%; width: 220px; height: 220px; margin: -110px 0 0 -110px;
  border-radius: 50%; border: 2px solid var(--hc,#b06bff); pointer-events: none; opacity: 0;
  box-shadow: 0 0 40px var(--hc,#b06bff); animation: hawRing 1.6s ease-out both; }
@keyframes hawRing { 0% { opacity: .0; transform: scale(.5); } 22% { opacity: .9; } 100% { opacity: 0; transform: scale(1.7); } }
.haw-eyebrow { font-size: 11px; font-weight: 900; letter-spacing: .32em; color: var(--hc,#b06bff);
  text-transform: uppercase; margin-bottom: 10px; text-shadow: 0 0 18px var(--hc,#b06bff); }
.haw-port { position: relative; width: 152px; height: 152px; margin: 0 auto 4px; border-radius: 20px;
  overflow: hidden; border: 2px solid var(--hc,#b06bff); box-shadow: 0 12px 40px rgba(0,0,0,.55), 0 0 46px var(--hc,#b06bff);
  background: linear-gradient(160deg, var(--hc,#b06bff), #120a26); animation: hawRise 1s cubic-bezier(.2,.8,.25,1) both; }
@keyframes hawRise { from { opacity: 0; transform: translateY(26px) scale(.92); } to { opacity: 1; transform: none; } }
.haw-port img { width: 100%; height: 100%; object-fit: cover; object-position: 50% 22%; }
.haw-port .haw-glyph { position: absolute; inset: 0; display: grid; place-items: center; font-size: 68px; }
.haw-name { font-size: clamp(22px, 6vw, 30px); font-weight: 900; margin-top: 12px; letter-spacing: .01em;
  text-shadow: 0 3px 18px rgba(0,0,0,.6); }
.haw-title { font-size: 12px; font-weight: 800; letter-spacing: .18em; color: #c8bce8; text-transform: uppercase; margin-top: 2px; }
.haw-sig { display: inline-flex; align-items: center; gap: 7px; margin-top: 14px; padding: 6px 14px; border-radius: 999px;
  background: rgba(255,255,255,.06); border: 1px solid var(--hc,#b06bff); font-weight: 900; font-size: 13px;
  letter-spacing: .04em; color: #fff; box-shadow: 0 0 22px var(--hc,#b06bff) inset; }
.haw-line { margin: 16px auto 4px; max-width: 400px; font-size: 15px; line-height: 1.42; font-weight: 600; color: #e9e2ff;
  font-style: italic; }
.haw-hint { margin-top: 18px; font-size: 11px; font-weight: 800; letter-spacing: .16em; color: #9a8fc4; text-transform: uppercase; }
@media (prefers-reduced-motion: reduce) {
  .haw, .haw.haw-out { animation: none; }
  .haw-bloom, .haw-ring, .haw-port { animation: none; }
  .haw-bloom { opacity: .5; } .haw-ring { display: none; }
}
`

let cssDone = false

function hex(c: number): string {
  return '#' + (c & 0xffffff).toString(16).padStart(6, '0')
}

/**
 * Play the Lv-3 awakening beat for a hero. Resolves when it closes (tap or
 * timeout). Safe to call with an unknown id (resolves immediately, no-op).
 */
export function playHeroAwakening(heroId: string): Promise<void> {
  const def = HEROES[heroId]
  const arc = heroArc(heroId)
  if (!def) return Promise.resolve()
  if (!cssDone) {
    cssDone = true
    const style = document.createElement('style')
    style.textContent = CSS
    document.head.appendChild(style)
  }
  const reduce = appSettings.reducedMotion()

  const root = document.createElement('div')
  root.className = 'haw'
  root.style.setProperty('--hc', hex(def.color))

  const url = heroArtUrl(heroId)
  const portrait = url
    ? `<div class="haw-port"><img src="${url}" alt="" draggable="false"></div>`
    : `<div class="haw-port"><div class="haw-glyph">${glyphIcon(def.glyph, { size: 60, color: '#fff' })}</div></div>`

  root.innerHTML = `
    <div class="haw-bloom"></div>
    <div class="haw-ring"></div>
    <div class="haw-card">
      <div class="haw-eyebrow">✦ Signature Awakened</div>
      ${portrait}
      <div class="haw-name">${esc(def.name)}</div>
      <div class="haw-title">${esc(def.title)}</div>
      <div class="haw-sig">${glyphIcon(def.signature.glyph, { size: 15, color: '#fff' })} ${esc(signatureName(heroId))}</div>
      <div class="haw-line">“${esc(arc?.awakenLine ?? def.catchphrase)}”</div>
      <div class="haw-hint">Tap to continue</div>
    </div>`

  document.body.appendChild(root)

  return new Promise<void>((resolve) => {
    let closed = false
    const close = (): void => {
      if (closed) return
      closed = true
      window.clearTimeout(timer)
      if (reduce) { root.remove(); resolve(); return }
      root.classList.add('haw-out')
      window.setTimeout(() => { root.remove(); resolve() }, 400)
    }
    root.addEventListener('click', close)
    // long enough to read the line; a tap dismisses sooner
    const timer = window.setTimeout(close, reduce ? 4200 : 6000)
  })
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
}
