// FrontPage — the title screen / main menu, rebuilt as a polished HTML/CSS
// overlay (like BattleHud) instead of Phaser-drawn text. MenuScene owns its
// lifecycle and supplies navigation handlers; this file is presentation only.
//
// Interim art direction until the painted key-art lands: deep night-indigo
// palette, metallic-gold CHROMANCER wordmark with elemental glints, glassy menu
// buttons, and a light canvas of ambient embers/frost motes.

import { appSettings } from './settings'
import { playUiTick } from './sfx'
import { music } from './music'
import { keyartBackdropUrl } from './heroArt'
import { menuBanner, prestigeTitle, hasFrame, uiDyeAccent } from '../game/skins'
import { economy } from '../game/economy'
import { showReferralPanel } from './ReferralPanel'
import { showWelcomeReward, welcomeUnclaimed } from './WelcomeReward'
import { showInstallCard, canInstall } from './pwa'

export interface FrontPageHandlers {
  onPlay(): void
  onHeroes(): void
  onWorkshop(): void
  onShop(): void
  onEndless(): void
  onDaily(): void
  onReplayIntro(): void
}

const RAVEN_URL = import.meta.env.BASE_URL + 'brand/odin-raven-mark.png'

const ICONS = {
  play: 'M8 5.5v13a1 1 0 0 0 1.5.87l11-6.5a1 1 0 0 0 0-1.74l-11-6.5A1 1 0 0 0 8 5.5z',
  shield: 'M12 2l8 3v6.1c0 4.8-3.4 8.4-8 10.9-4.6-2.5-8-6.1-8-10.9V5z',
  hammer:
    'M13.9 2.6c2.3-.6 4.6.1 6 1.5l1.9 1.9-2.2 2.2-1.1-1.1-1.6 1.6-3.9-3.9 1.6-1.6zM11.6 6.2l3.9 3.9L5.3 20.3a1.6 1.6 0 0 1-2.3 0l-1.6-1.6a1.6 1.6 0 0 1 0-2.3z',
  gem: 'M7 3h10l4 6-9 12L3 9zm2.2 2L6.6 8.9h10.8L14.8 5zM8 10.9l4 8 4-8z',
  infinity:
    'M17.7 7.2c-1.9 0-3.5 1-5.7 3.1C9.8 8.2 8.2 7.2 6.3 7.2A4.7 4.7 0 0 0 1.5 12a4.7 4.7 0 0 0 4.8 4.8c1.9 0 3.5-1 5.7-3.1 2.2 2.1 3.8 3.1 5.7 3.1a4.7 4.7 0 0 0 4.8-4.8 4.7 4.7 0 0 0-4.8-4.8zM6.3 14.6A2.6 2.6 0 0 1 3.7 12a2.6 2.6 0 0 1 2.6-2.6c1.2 0 2.5.9 4.1 2.6-1.6 1.7-2.9 2.6-4.1 2.6zm11.4 0c-1.2 0-2.5-.9-4.1-2.6 1.6-1.7 2.9-2.6 4.1-2.6a2.6 2.6 0 0 1 2.6 2.6 2.6 2.6 0 0 1-2.6 2.6z',
  gear: 'M19.4 13a7.8 7.8 0 0 0 .1-1 7.8 7.8 0 0 0-.1-1l2.1-1.6a.5.5 0 0 0 .1-.7l-2-3.4a.5.5 0 0 0-.6-.2l-2.5 1a7.6 7.6 0 0 0-1.7-1L14.4 2.5a.5.5 0 0 0-.5-.4h-4a.5.5 0 0 0-.5.4L9 5.1a7.6 7.6 0 0 0-1.7 1l-2.5-1a.5.5 0 0 0-.6.2l-2 3.4a.5.5 0 0 0 .1.7L4.5 11a7.8 7.8 0 0 0 0 2l-2.2 1.6a.5.5 0 0 0-.1.7l2 3.4c.1.2.4.3.6.2l2.5-1a7.6 7.6 0 0 0 1.7 1l.4 2.6c0 .2.3.4.5.4h4c.2 0 .5-.2.5-.4l.4-2.6a7.6 7.6 0 0 0 1.7-1l2.5 1c.2.1.5 0 .6-.2l2-3.4a.5.5 0 0 0-.1-.7zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z',
  calendar: 'M7 2a1 1 0 0 1 1 1v1h8V3a1 1 0 1 1 2 0v1h1.5A1.5 1.5 0 0 1 21 5.5v14A1.5 1.5 0 0 1 19.5 21h-15A1.5 1.5 0 0 1 3 19.5v-14A1.5 1.5 0 0 1 4.5 4H6V3a1 1 0 0 1 1-1zM5 10v9h14v-9H5zm3 2h2.2v2.2H8V12z',
}

function svg(path: string): string {
  return `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${path}"/></svg>`
}

const CSS = `
.efp, .efp * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; user-select: none; }
.efp {
  position: fixed; inset: 0; z-index: 15; overflow: hidden; color: #efe9ff;
  font-family: system-ui, -apple-system, 'Segoe UI', Arial, sans-serif;
  display: flex; flex-direction: column; align-items: center;
  padding: calc(14px + env(safe-area-inset-top)) 20px calc(14px + env(safe-area-inset-bottom));
  background:
    radial-gradient(95% 60% at 50% -12%, rgba(123,47,247,.30), transparent 62%),
    radial-gradient(70% 48% at 88% 102%, rgba(255,106,60,.13), transparent 62%),
    radial-gradient(58% 44% at 6% 90%, rgba(74,217,255,.11), transparent 62%),
    linear-gradient(180deg, #100b24 0%, #0a0716 58%, #070510 100%);
  transition: opacity .28s ease;
}
.efp.efp-leave { opacity: 0; pointer-events: none; }
/* painted key art behind everything (fades in once decoded + de-marked) */
.efp-keyart { position: absolute; inset: 0; pointer-events: none; background-size: cover;
  background-position: 50% 22%; opacity: 0; transition: opacity .9s ease; }
.efp-keyart.on { opacity: .58; }
.efp-keyart::after { content: ''; position: absolute; inset: 0;
  background: linear-gradient(180deg, rgba(12,8,26,.66) 0%, rgba(12,8,26,.22) 24%, rgba(12,8,26,.30) 52%, rgba(9,6,20,.86) 80%, rgba(7,5,16,.97) 100%); }
.efp-motes { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.efp-vig { position: absolute; inset: 0; pointer-events: none;
  background: radial-gradient(120% 90% at 50% 40%, transparent 55%, rgba(0,0,0,.42) 100%); }
.efp-top, .efp-hero, .efp-menu, .efp-foot { position: relative; }

@keyframes efpIn { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }
.efp-in { animation: efpIn .65s cubic-bezier(.22,1,.36,1) both; }
.efp.efp-reduced .efp-in { animation: none; }
.efp.efp-reduced .efp-logo, .efp.efp-reduced .efp-logo-sheen,
.efp.efp-reduced .efp-spark, .efp.efp-reduced .efp-orb { animation: none !important; }

/* ---- top bar ---- */
.efp-top { width: 100%; max-width: 520px; display: flex; align-items: center; gap: 10px; }
.efp-chip {
  display: flex; align-items: center; gap: 7px; padding: 7px 14px 7px 9px; border-radius: 999px;
  background: linear-gradient(180deg, rgba(255,255,255,.08), rgba(255,255,255,.03));
  border: 1px solid rgba(255,255,255,.12); box-shadow: 0 4px 14px rgba(0,0,0,.35);
  font-weight: 700; font-size: 15px; letter-spacing: .02em;
}
.efp-chip .efp-coin { width: 17px; height: 17px; border-radius: 50%;
  background: radial-gradient(circle at 34% 30%, #fff3bd, #ffd54a 55%, #c98f12); box-shadow: 0 0 8px rgba(255,213,74,.5); }
.efp-chip .efp-dia { width: 15px; height: 15px; transform: rotate(45deg); border-radius: 3px;
  background: linear-gradient(135deg, #eafcff, #7fe3ff 55%, #2aa4d6); box-shadow: 0 0 8px rgba(127,227,255,.55); }
.efp-chip.c-coin { color: #ffe08a; }
.efp-chip.c-dia { color: #c9f2ff; }
.efp-chip.c-prism { color: #e2c9ff; }
.efp-chip[hidden] { display: none; }
/* equipped store cosmetics: banner ribbon + prestige title flourish */
.efp-banner { width: min(300px, 72vw); height: 10px; border-radius: 999px; border: 1px solid rgba(255,255,255,.22);
  box-shadow: 0 0 14px rgba(255,255,255,.12); }
.efp-prestige { font-size: 11px; font-weight: 900; letter-spacing: .34em; margin-right: -.34em; text-transform: uppercase;
  color: transparent; background: linear-gradient(180deg, #fff6d8, #ffd76a 45%, #c08a12); background-clip: text; -webkit-background-clip: text; }
.efp-gear {
  margin-left: auto; width: 42px; height: 42px; border-radius: 50%; border: 1px solid rgba(255,255,255,.14);
  background: linear-gradient(180deg, rgba(255,255,255,.08), rgba(255,255,255,.03));
  color: #cfc6ec; display: flex; align-items: center; justify-content: center; cursor: pointer;
  transition: transform .2s ease, color .2s ease, border-color .2s ease;
}
.efp-gear svg { width: 22px; height: 22px; }
.efp-gear:hover { color: #fff; border-color: rgba(255,255,255,.35); transform: rotate(24deg); }
.efp-gear:active { transform: scale(.92); }

/* ---- hero block ---- */
.efp-hero { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; text-align: center; }
.efp-logo-wrap { position: relative; padding: 6px 10px; }
.efp-logo, .efp-logo-sheen {
  font-family: 'Cinzel', 'Georgia', 'Times New Roman', serif; font-weight: 900;
  font-size: clamp(40px, 11vw, 82px); line-height: 1.04; letter-spacing: .05em; white-space: nowrap;
}
.efp-logo {
  color: transparent;
  background: linear-gradient(175deg, #fff6d8 6%, #ffd76a 28%, #f0a93c 46%, #a3691a 58%, #ffdf8a 76%, #c08a12 96%);
  background-clip: text; -webkit-background-clip: text;
  filter: drop-shadow(0 2px 0 rgba(50,24,0,.6)) drop-shadow(0 6px 18px rgba(0,0,0,.55)) drop-shadow(0 0 26px rgba(255,180,60,.22));
}
.efp-logo-sheen {
  position: absolute; inset: 6px 10px; pointer-events: none; color: transparent;
  background: linear-gradient(100deg, transparent 42%, rgba(255,255,244,.9) 50%, transparent 58%);
  background-size: 260% 100%; background-clip: text; -webkit-background-clip: text;
  animation: efpSheen 5.5s ease-in-out infinite;
}
@keyframes efpSheen { 0%, 55% { background-position: 135% 0; } 90%, 100% { background-position: -60% 0; } }
.efp-spark { position: absolute; font-size: 13px; line-height: 1; pointer-events: none; animation: efpTwinkle 2.6s ease-in-out infinite; }
.efp-spark.s-fire { top: -4px; left: 6%; color: #ffb45c; text-shadow: 0 0 10px #ff7a2e; }
.efp-spark.s-ice { bottom: -6px; right: 20%; color: #9fe8ff; text-shadow: 0 0 10px #4ad9ff; animation-delay: .9s; }
.efp-spark.s-bolt { top: -8px; right: 2%; color: #ffe98a; text-shadow: 0 0 10px #ffd54a; animation-delay: 1.7s; font-size: 16px; }
@keyframes efpTwinkle { 0%, 100% { opacity: .15; transform: scale(.7); } 50% { opacity: 1; transform: scale(1.15); } }

.efp-orbs { display: flex; align-items: center; gap: 14px; }
.efp-rule { width: clamp(48px, 16vw, 110px); height: 1px;
  background: linear-gradient(90deg, transparent, rgba(213,180,110,.65)); }
.efp-rule.r { transform: scaleX(-1); }
.efp-orb { width: 11px; height: 11px; border-radius: 50%; animation: efpOrbPulse 3s ease-in-out infinite; }
.efp-orb.o-fire { background: radial-gradient(circle at 35% 30%, #ffd9ae, #ff6a3c 60%, #a12b0c); box-shadow: 0 0 12px rgba(255,106,60,.8); }
.efp-orb.o-ice { background: radial-gradient(circle at 35% 30%, #eafcff, #4ad9ff 60%, #1272a8); box-shadow: 0 0 12px rgba(74,217,255,.8); animation-delay: 1s; }
.efp-orb.o-bolt { background: radial-gradient(circle at 35% 30%, #fff7cf, #ffd54a 60%, #b57e08); box-shadow: 0 0 12px rgba(255,213,74,.8); animation-delay: 2s; }
@keyframes efpOrbPulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.35); } }

.efp-tag { font-size: clamp(10px, 2.8vw, 13px); font-weight: 600; letter-spacing: .28em; margin-right: -.28em;
  color: #b6a9dd; text-transform: uppercase; line-height: 1.9; }
.efp-tag span { white-space: nowrap; }

/* ---- menu ---- */
.efp-menu { width: 100%; max-width: 420px; display: flex; flex-direction: column; gap: 11px; padding-bottom: 10px; }
.efp-btn {
  --a: #b06bff;
  position: relative; display: flex; align-items: center; gap: 13px; width: 100%;
  padding: 12px 16px; border-radius: 16px; border: 1px solid rgba(255,255,255,.11);
  background: linear-gradient(180deg, rgba(255,255,255,.065), rgba(255,255,255,.025));
  color: #efe9ff; cursor: pointer; text-align: left; font: inherit;
  box-shadow: 0 6px 18px rgba(0,0,0,.35), inset 0 1px 0 rgba(255,255,255,.07);
  transition: transform .16s ease, border-color .2s ease, box-shadow .2s ease, background .2s ease;
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
}
.efp-btn:hover { transform: translateY(-2px); border-color: rgba(255,255,255,.28);
  box-shadow: 0 10px 26px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.1); }
.efp-btn:active { transform: scale(.975); transition-duration: .06s; }
.efp-ic {
  flex: 0 0 auto; width: 42px; height: 42px; border-radius: 12px; display: flex; align-items: center; justify-content: center;
  color: var(--a); background: color-mix(in srgb, var(--a) 16%, transparent);
  border: 1px solid color-mix(in srgb, var(--a) 42%, transparent);
  box-shadow: 0 0 14px color-mix(in srgb, var(--a) 22%, transparent);
  transition: box-shadow .2s ease;
}
.efp-btn:hover .efp-ic { box-shadow: 0 0 22px color-mix(in srgb, var(--a) 45%, transparent); }
.efp-ic svg { width: 22px; height: 22px; }
.efp-btxt { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.efp-blabel { font-size: 17px; font-weight: 800; letter-spacing: .09em; }
.efp-bsub { font-size: 11.5px; font-weight: 500; letter-spacing: .05em; color: #9d92c4; }
.efp-chev { flex: 0 0 auto; color: rgba(255,255,255,.32); font-size: 18px; transition: transform .2s ease, color .2s ease; }
.efp-btn:hover .efp-chev { transform: translateX(3px); color: rgba(255,255,255,.7); }
.efp-pill { flex: 0 0 auto; font-size: 9.5px; font-weight: 800; letter-spacing: .14em; padding: 4px 9px; border-radius: 999px;
  color: #ffcf9e; background: rgba(255,140,60,.14); border: 1px solid rgba(255,150,70,.4); }

.efp-btn.efp-primary {
  --a: #3d2a00; padding: 15px 16px; border: 0;
  background: linear-gradient(180deg, #ffe9a8 0%, #ffcf5c 38%, #eda528 72%, #c8811a 100%);
  color: #35240a; box-shadow: 0 8px 26px rgba(240,166,44,.38), inset 0 1px 0 rgba(255,255,255,.65), inset 0 -2px 0 rgba(120,70,0,.35);
}
.efp-btn.efp-primary:hover { box-shadow: 0 12px 32px rgba(240,166,44,.5), inset 0 1px 0 rgba(255,255,255,.65), inset 0 -2px 0 rgba(120,70,0,.35); }
.efp-btn.efp-primary .efp-ic { color: #6b4404; background: rgba(80,50,0,.14); border-color: rgba(90,55,0,.3); box-shadow: none; }
.efp-btn.efp-primary .efp-blabel { font-size: 20px; letter-spacing: .12em; }
.efp-btn.efp-primary .efp-bsub { color: #7c5a1c; font-weight: 600; }
.efp-btn.efp-primary .efp-chev { color: rgba(70,45,0,.55); }

/* ---- footer ---- */
.efp-foot { display: flex; flex-direction: column; align-items: center; gap: 6px; padding-top: 4px; }
.efp-best { font-size: 12px; font-weight: 700; letter-spacing: .08em; color: #ffb27a; }
.efp-credit { display: flex; align-items: center; gap: 7px; font-size: 10.5px; letter-spacing: .18em; color: #6a5f92; }
.efp-credit img { height: 15px; width: auto; opacity: .85; }

/* ---- modals (settings / rewards) ---- */
.efp-overlay { position: absolute; inset: 0; z-index: 5; display: flex; align-items: center; justify-content: center;
  background: rgba(4,2,12,.68); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);
  animation: efpFade .22s ease both; padding: 24px; }
@keyframes efpFade { from { opacity: 0; } to { opacity: 1; } }
.efp-card { width: min(400px, 92vw); border-radius: 20px; padding: 22px 22px 18px;
  background: linear-gradient(180deg, #201640 0%, #170f30 100%);
  border: 1px solid rgba(255,255,255,.14); box-shadow: 0 24px 70px rgba(0,0,0,.6);
  animation: efpCard .3s cubic-bezier(.22,1.4,.36,1) both; }
.efp.efp-reduced .efp-overlay, .efp.efp-reduced .efp-card { animation: none; }
@keyframes efpCard { from { opacity: 0; transform: scale(.9) translateY(10px); } to { opacity: 1; transform: none; } }
.efp-card.gold { border-color: rgba(255,205,92,.45); box-shadow: 0 24px 70px rgba(0,0,0,.6), 0 0 34px rgba(255,190,70,.14); }
.efp-ctitle { font-size: 17px; font-weight: 800; letter-spacing: .2em; text-align: center; color: #ffd76a; margin-bottom: 14px; }
.efp-clines { display: flex; flex-direction: column; gap: 7px; text-align: center; font-size: 14.5px; color: #ded4f6; margin-bottom: 16px; }
.efp-ctap { text-align: center; font-size: 11px; font-weight: 700; letter-spacing: .3em; color: #9fe8ff; animation: efpPulse 1.5s ease-in-out infinite; }
@keyframes efpPulse { 0%, 100% { opacity: .35; } 50% { opacity: 1; } }

.efp-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 2px;
  border-bottom: 1px solid rgba(255,255,255,.07); font-size: 14px; font-weight: 600; letter-spacing: .06em; color: #ded4f6; }
.efp-row:last-of-type { border-bottom: 0; }
.efp-switch { position: relative; width: 48px; height: 27px; border-radius: 999px; cursor: pointer; flex: 0 0 auto;
  background: rgba(255,255,255,.12); border: 1px solid rgba(255,255,255,.16); transition: background .2s ease; }
.efp-switch::after { content: ''; position: absolute; top: 2px; left: 2px; width: 21px; height: 21px; border-radius: 50%;
  background: #cfc6ec; transition: transform .2s ease, background .2s ease; }
.efp-switch.on { background: linear-gradient(180deg, #ffd76a, #eda528); border-color: rgba(255,220,130,.5); }
.efp-switch.on::after { transform: translateX(21px); background: #3a2604; }
.efp-mbtn { width: 100%; margin-top: 14px; padding: 11px; border-radius: 12px; border: 1px solid rgba(255,255,255,.16);
  background: rgba(255,255,255,.06); color: #efe9ff; font: inherit; font-size: 13px; font-weight: 700; letter-spacing: .14em; cursor: pointer;
  transition: background .2s ease, transform .12s ease; }
.efp-mbtn:hover { background: rgba(255,255,255,.11); }
.efp-mbtn:active { transform: scale(.97); }
.efp-mbtn.ghost { margin-top: 8px; border-color: transparent; background: transparent; color: #9d92c4; }
.efp-vol { width: 132px; accent-color: #ffd76a; cursor: pointer; }
.efp-lic { margin-top: 14px; text-align: center; font-size: 10px; letter-spacing: .06em; line-height: 1.6; color: #8b7fb5; }
.efp-lic a { color: #b3a5e0; }

@media (max-height: 640px) {
  .efp-hero { gap: 8px; }
  .efp-menu { gap: 8px; }
  .efp-btn { padding: 9px 14px; }
  .efp-btn.efp-primary { padding: 11px 14px; }
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
// Ambient motes (embers + frost) on a lightweight 2D canvas
// ---------------------------------------------------------------------------

interface Mote {
  x: number
  y: number
  r: number
  vy: number
  vx: number
  phase: number
  warm: boolean
}

class Motes {
  private raf = 0
  private motes: Mote[] = []
  private g: CanvasRenderingContext2D | null
  private w = 0
  private h = 0
  private onResize = () => this.resize()

  constructor(private canvas: HTMLCanvasElement) {
    this.g = canvas.getContext('2d')
    this.resize()
    window.addEventListener('resize', this.onResize)
    const n = 34
    for (let i = 0; i < n; i++) this.motes.push(this.spawn(true))
    this.raf = requestAnimationFrame((t) => this.tick(t))
  }

  private resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
    this.w = this.canvas.clientWidth
    this.h = this.canvas.clientHeight
    this.canvas.width = Math.round(this.w * dpr)
    this.canvas.height = Math.round(this.h * dpr)
    this.g?.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  private spawn(anywhere: boolean): Mote {
    const warm = Math.random() < 0.55
    return {
      x: Math.random() * this.w,
      y: anywhere ? Math.random() * this.h : this.h + 8,
      r: 0.8 + Math.random() * 1.9,
      vy: warm ? -(6 + Math.random() * 14) : -(2 + Math.random() * 5),
      vx: (Math.random() - 0.5) * 6,
      phase: Math.random() * Math.PI * 2,
      warm,
    }
  }

  private last = 0
  private tick(t: number): void {
    this.raf = requestAnimationFrame((n) => this.tick(n))
    const g = this.g
    if (!g) return
    const dt = this.last ? Math.min(0.05, (t - this.last) / 1000) : 0.016
    this.last = t
    g.clearRect(0, 0, this.w, this.h)
    if (appSettings.reducedMotion()) return
    for (let i = 0; i < this.motes.length; i++) {
      const m = this.motes[i]
      m.y += m.vy * dt
      m.x += (m.vx + Math.sin(t / 900 + m.phase) * 4) * dt
      if (m.y < -10 || m.x < -10 || m.x > this.w + 10) this.motes[i] = this.spawn(false)
      const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t / 500 + m.phase * 3))
      g.beginPath()
      g.arc(m.x, m.y, m.r, 0, Math.PI * 2)
      g.fillStyle = m.warm ? `rgba(255,164,84,${(0.5 * tw).toFixed(3)})` : `rgba(150,220,255,${(0.42 * tw).toFixed(3)})`
      g.shadowColor = m.warm ? 'rgba(255,140,60,.8)' : 'rgba(110,200,255,.8)'
      g.shadowBlur = 6
      g.fill()
      g.shadowBlur = 0
    }
  }

  destroy(): void {
    cancelAnimationFrame(this.raf)
    window.removeEventListener('resize', this.onResize)
  }
}

// ---------------------------------------------------------------------------
// FrontPage
// ---------------------------------------------------------------------------

export class FrontPage {
  private root: HTMLDivElement
  private motes: Motes
  private coinEl: HTMLElement
  private diaEl: HTMLElement
  private bestEl: HTMLElement
  private prismEl!: HTMLElement
  private prismChip!: HTMLElement
  private leaving = false

  constructor(private handlers: FrontPageHandlers) {
    injectCss()
    this.root = document.createElement('div')
    this.root.className = 'efp'
    if (appSettings.reducedMotion()) this.root.classList.add('efp-reduced')

    this.root.innerHTML = `
      <div class="efp-keyart" data-keyart></div>
      <canvas class="efp-motes"></canvas>
      <div class="efp-vig"></div>

      <div class="efp-top efp-in" style="animation-delay:.05s">
        <div class="efp-chip c-coin"><span class="efp-coin"></span><span data-coin>0</span></div>
        <div class="efp-chip c-dia"><span class="efp-dia"></span><span data-dia>0</span></div>
        <div class="efp-chip c-prism" data-prismchip hidden>✦ <span data-prism>0</span></div>
        <button class="efp-gear" data-act="install" data-install aria-label="Install app" title="Install Chromancer" hidden>⬇</button>
        <button class="efp-gear" data-act="invite" aria-label="Invite friends" title="Invite friends — you both win">📣</button>
        <button class="efp-gear" data-act="settings" aria-label="Settings">${svg(ICONS.gear)}</button>
      </div>

      <div class="efp-hero">
        <div class="efp-logo-wrap efp-in" style="animation-delay:.12s">
          <div class="efp-logo">CHROMANCER</div>
          <div class="efp-logo-sheen" aria-hidden="true">CHROMANCER</div>
          <span class="efp-spark s-fire" aria-hidden="true">&#10022;</span>
          <span class="efp-spark s-ice" aria-hidden="true">&#10022;</span>
          <span class="efp-spark s-bolt" aria-hidden="true">&#10022;</span>
        </div>
        <div class="efp-orbs efp-in" style="animation-delay:.22s">
          <div class="efp-rule r"></div>
          <div class="efp-orb o-fire"></div><div class="efp-orb o-bolt"></div><div class="efp-orb o-ice"></div>
          <div class="efp-rule"></div>
        </div>
        <div class="efp-tag efp-in" style="animation-delay:.3s"><span>Paint the world back</span> &middot; <span>Hold the line</span></div>
        <div class="efp-prestige efp-in" data-prestige hidden style="animation-delay:.32s"></div>
        <div class="efp-banner efp-in" data-banner hidden style="animation-delay:.34s"></div>
      </div>

      <div class="efp-menu">
        <button class="efp-btn efp-primary efp-in efp-welcome" style="animation-delay:.34s; --a:#ffd873" data-act="welcome" data-welcome hidden>
          <span class="efp-ic">🎁</span>
          <span class="efp-btxt"><span class="efp-blabel">CLAIM WELCOME BUNDLE</span><span class="efp-bsub">2000💎 + starter skin + a free spin</span></span>
          <span class="efp-chev">&#8250;</span>
        </button>
        <button class="efp-btn efp-primary efp-in" style="animation-delay:.36s" data-act="play">
          <span class="efp-ic">${svg(ICONS.play)}</span>
          <span class="efp-btxt"><span class="efp-blabel">PLAY</span><span class="efp-bsub">Campaign</span></span>
          <span class="efp-chev">&#8250;</span>
        </button>
        <button class="efp-btn efp-in" style="animation-delay:.42s; --a:#ffb43c" data-act="heroes">
          <span class="efp-ic">${svg(ICONS.shield)}</span>
          <span class="efp-btxt"><span class="efp-blabel">HEROES</span><span class="efp-bsub">Collect &amp; level your champions</span></span>
          <span class="efp-chev">&#8250;</span>
        </button>
        <button class="efp-btn efp-in" style="animation-delay:.48s; --a:#5b8dff" data-act="workshop">
          <span class="efp-ic">${svg(ICONS.hammer)}</span>
          <span class="efp-btxt"><span class="efp-blabel">WORKSHOP</span><span class="efp-bsub">Permanent upgrades</span></span>
          <span class="efp-chev">&#8250;</span>
        </button>
        <button class="efp-btn efp-in" style="animation-delay:.54s; --a:#c06bff" data-act="shop">
          <span class="efp-ic">${svg(ICONS.gem)}</span>
          <span class="efp-btxt"><span class="efp-blabel">STORE</span><span class="efp-bsub">Skins &amp; Prism Pass &middot; zero power sold</span></span>
          <span class="efp-chev">&#8250;</span>
        </button>
        <button class="efp-btn efp-in" style="animation-delay:.6s; --a:#ff7a4a" data-act="endless">
          <span class="efp-ic">${svg(ICONS.infinity)}</span>
          <span class="efp-btxt"><span class="efp-blabel">ENDLESS</span><span class="efp-bsub">Fair play &middot; no boosts</span></span>
          <span class="efp-pill">RANKED</span>
        </button>
        <button class="efp-btn efp-in" style="animation-delay:.66s; --a:#ffd54a" data-act="daily">
          <span class="efp-ic">${svg(ICONS.calendar)}</span>
          <span class="efp-btxt"><span class="efp-blabel">DAILY SEED</span><span class="efp-bsub">One shared run &middot; beat your best</span></span>
          <span class="efp-chev">&#8250;</span>
        </button>
      </div>

      <div class="efp-foot efp-in" style="animation-delay:.68s">
        <div class="efp-best" data-best hidden></div>
        <div class="efp-credit"><img src="${RAVEN_URL}" alt="" draggable="false" /><span>CREATED BY ODIN PLATFORMS &middot; v0.4</span></div>
      </div>
    `
    document.body.appendChild(this.root)

    this.motes = new Motes(this.root.querySelector<HTMLCanvasElement>('.efp-motes')!)

    // painted key art fades in behind the UI once decoded (cached after first visit)
    void keyartBackdropUrl().then((url) => {
      const k = this.root.querySelector<HTMLElement>('[data-keyart]')
      if (!url || !k || !this.root.isConnected) return
      k.style.backgroundImage = `url('${url}')`
      requestAnimationFrame(() => k.classList.add('on'))
    })
    this.coinEl = this.root.querySelector<HTMLElement>('[data-coin]')!
    this.diaEl = this.root.querySelector<HTMLElement>('[data-dia]')!
    this.bestEl = this.root.querySelector<HTMLElement>('[data-best]')!
    this.prismEl = this.root.querySelector<HTMLElement>('[data-prism]')!
    this.prismChip = this.root.querySelector<HTMLElement>('[data-prismchip]')!

    // equipped store cosmetics (banner ribbon, prestige title, dye, frame glow)
    const banner = menuBanner()
    const bEl = this.root.querySelector<HTMLElement>('[data-banner]')!
    if (banner) {
      bEl.hidden = false
      bEl.style.background = banner.css
      bEl.title = banner.name
    }
    const title = prestigeTitle()
    const pEl = this.root.querySelector<HTMLElement>('[data-prestige]')!
    if (title) {
      pEl.hidden = false
      pEl.textContent = '✦ ' + title + ' ✦'
    }
    const dye = uiDyeAccent()
    if (dye) for (const r of this.root.querySelectorAll<HTMLElement>('.efp-tag, .efp-bsub')) r.style.color = dye
    if (hasFrame()) {
      const wrap = this.root.querySelector<HTMLElement>('.efp-logo-wrap')!
      wrap.style.border = '1px solid rgba(255,215,106,.45)'
      wrap.style.borderRadius = '18px'
      wrap.style.boxShadow = '0 0 30px rgba(255,190,70,.16), inset 0 0 24px rgba(255,190,70,.07)'
    }

    this.root.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')
      if (!btn || this.leaving) return
      playUiTick()
      const act = btn.dataset.act
      if (act === 'settings') this.openSettings()
      else if (act === 'play') this.leave(() => this.handlers.onPlay())
      else if (act === 'heroes') this.leave(() => this.handlers.onHeroes())
      else if (act === 'workshop') this.leave(() => this.handlers.onWorkshop())
      else if (act === 'shop') this.leave(() => this.handlers.onShop())
      else if (act === 'endless') this.leave(() => this.handlers.onEndless())
      else if (act === 'daily') this.leave(() => this.handlers.onDaily())
      else if (act === 'invite') showReferralPanel()
      else if (act === 'install') showInstallCard({ force: true })
      else if (act === 'welcome') showWelcomeReward(() => this.refreshGrowth())
    })

    this.refreshGrowth()
  }

  // Toggle the growth affordances (unclaimed-welcome banner + install button)
  // and keep the wallet in sync after a claim. Cheap; safe to call repeatedly.
  private refreshGrowth(): void {
    const wEl = this.root.querySelector<HTMLElement>('[data-welcome]')
    if (wEl) wEl.hidden = !welcomeUnclaimed()
    const iEl = this.root.querySelector<HTMLElement>('[data-install]')
    if (iEl) iEl.hidden = !canInstall()
    this.setCurrencies(economy.coins, economy.diamonds, economy.prisms)
  }

  setCurrencies(coins: number, diamonds: number, prisms = 0): void {
    this.coinEl.textContent = String(coins)
    this.diaEl.textContent = String(diamonds)
    this.prismEl.textContent = String(prisms)
    this.prismChip.hidden = prisms <= 0 // event currency: chip appears once earned
  }

  setBestWave(wave: number): void {
    this.bestEl.hidden = wave <= 0
    this.bestEl.textContent = `BEST ENDLESS WAVE: ${wave}`
  }

  /** Reward card (idle earnings / daily bonus). Dismisses on tap. */
  showRewards(title: string, lines: string[]): void {
    const overlay = document.createElement('div')
    overlay.className = 'efp-overlay'
    overlay.innerHTML = `
      <div class="efp-card gold">
        <div class="efp-ctitle">${title}</div>
        <div class="efp-clines">${lines.map((l) => `<div>${l}</div>`).join('')}</div>
        <div class="efp-ctap">TAP TO COLLECT</div>
      </div>
    `
    overlay.addEventListener('click', () => {
      playUiTick()
      overlay.remove()
    })
    this.root.appendChild(overlay)
  }

  private openSettings(): void {
    const overlay = document.createElement('div')
    overlay.className = 'efp-overlay'
    const card = document.createElement('div')
    card.className = 'efp-card'
    card.innerHTML = `
      <div class="efp-ctitle">SETTINGS</div>
      <div class="efp-row"><span>Sound FX</span><div class="efp-switch ${appSettings.data.sound ? 'on' : ''}" data-set="sound" role="switch"></div></div>
      <div class="efp-row"><span>Music</span><div class="efp-switch ${appSettings.data.music ? 'on' : ''}" data-set="music" role="switch"></div></div>
      <div class="efp-row"><span>Music volume</span>
        <input class="efp-vol" type="range" min="0" max="100" value="${Math.round(appSettings.data.musicVol * 100)}" data-vol aria-label="Music volume" /></div>
      <div class="efp-row"><span>Reduce motion</span><div class="efp-switch ${appSettings.data.reduceMotion ? 'on' : ''}" data-set="reduceMotion" role="switch"></div></div>
      <button class="efp-mbtn" data-set="replay">&#9889;&nbsp; REPLAY INTRO</button>
      <button class="efp-mbtn ghost" data-set="close">CLOSE</button>
      <div class="efp-lic">Music: Kevin MacLeod (incompetech.com) &middot; CC BY 4.0</div>
    `
    overlay.appendChild(card)
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove()
    })
    card.querySelector<HTMLInputElement>('[data-vol]')!.addEventListener('input', (e) => {
      const v = Number((e.target as HTMLInputElement).value) / 100
      appSettings.set({ musicVol: v })
      music.refresh(80)
    })
    card.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-set]')
      if (!el) return
      const key = el.dataset.set
      if (key === 'sound' || key === 'music' || key === 'reduceMotion') {
        const next = !appSettings.data[key]
        appSettings.set({ [key]: next })
        el.classList.toggle('on', next)
        this.root.classList.toggle('efp-reduced', appSettings.reducedMotion())
        if (key === 'music') music.refresh(400)
        playUiTick()
      } else if (key === 'replay') {
        playUiTick()
        overlay.remove()
        this.handlers.onReplayIntro()
      } else if (key === 'close') {
        overlay.remove()
      }
    })
    this.root.appendChild(overlay)
  }

  /** Fade the page out, then hand control back (scene switch). */
  private leave(cb: () => void): void {
    this.leaving = true
    this.root.classList.add('efp-leave')
    window.setTimeout(cb, 240)
  }

  destroy(): void {
    this.motes.destroy()
    this.root.remove()
  }
}
