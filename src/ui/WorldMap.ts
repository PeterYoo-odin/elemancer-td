// WorldMap — the campaign overworld, an HTML/CSS overlay in the FrontPage /
// BattleHud family. One continuous journey climbs from the Emberwaste at the
// bottom of the scroll to The Hollow at the top: each realm is a themed band
// (gradient sky + mountain silhouettes, palette-matched to its element), a
// winding trail threads the level nodes through them, and everything beyond
// the player's reach is drained to grey — the Greying — until clears restore
// its colour. MapScene owns the lifecycle; this file is presentation plus the
// node → levelId wiring (plain DOM buttons, so taps can't miss).

import { LEVELS, REALMS, isLevelUnlocked, realmForLevel, type LevelDef, type RealmDef } from '../game/levels'
import { economy } from '../game/economy'
import { appSettings } from './settings'
import { playUiTick } from './sfx'

export interface WorldMapHandlers {
  onPlay(levelId: string): void
  onBack(): void
}

const KEYART_URL = import.meta.env.BASE_URL + 'concepts/00-keyart-v2.jpg'

// Vertical layout (px inside the scroll track).
const CROWN_H = 300 // key-art world header above The Hollow
const REALM_H = 520 // one themed band per realm
const START_H = 190 // the Haven pad where the journey begins

const REACH_KEY = 'elemancer_map_reach_v1' // realms coloured at last visit
const SEEN_KEY = 'elemancer_realms_seen_v1' // realm banners already shown

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII']

type NodeState = 'locked' | 'avail' | 'done'

interface MapNode {
  lvl: LevelDef
  realm: RealmDef
  realmIdx: number
  x: number // percent across the track
  y: number // px down the track
  state: NodeState
  stars: number
}

// Two silhouette layers per band; variants cycle so ranges differ realm to realm.
const RIDGES: Array<[string, string]> = [
  [
    'polygon(0% 100%, 0% 52%, 13% 70%, 28% 38%, 44% 66%, 60% 34%, 76% 64%, 90% 46%, 100% 58%, 100% 100%)',
    'polygon(0% 100%, 0% 76%, 16% 58%, 33% 82%, 50% 56%, 68% 84%, 84% 62%, 100% 78%, 100% 100%)',
  ],
  [
    'polygon(0% 100%, 0% 60%, 12% 42%, 26% 68%, 42% 36%, 58% 62%, 72% 40%, 88% 66%, 100% 50%, 100% 100%)',
    'polygon(0% 100%, 0% 70%, 14% 84%, 30% 60%, 48% 82%, 64% 58%, 80% 80%, 100% 64%, 100% 100%)',
  ],
  [
    'polygon(0% 100%, 0% 46%, 15% 64%, 32% 40%, 47% 70%, 63% 44%, 80% 60%, 100% 38%, 100% 100%)',
    'polygon(0% 100%, 0% 82%, 18% 62%, 36% 80%, 54% 60%, 72% 82%, 88% 64%, 100% 76%, 100% 100%)',
  ],
]

const CSS = `
.ewm, .ewm * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; user-select: none; }
.ewm {
  position: fixed; inset: 0; z-index: 15; overflow: hidden; color: #efe9ff;
  font-family: system-ui, -apple-system, 'Segoe UI', Arial, sans-serif;
  background: #070510; transition: opacity .26s ease;
}
.ewm.ewm-leave { opacity: 0; pointer-events: none; }

.ewm-scroll { position: absolute; inset: 0; overflow-y: auto; overflow-x: hidden;
  -webkit-overflow-scrolling: touch; overscroll-behavior: contain; scrollbar-width: none; }
.ewm-scroll::-webkit-scrollbar { display: none; }
.ewm-track { position: relative; width: 100%; }

/* ---- realm bands ---- */
.ewm-band { position: absolute; left: 0; right: 0; overflow: hidden;
  filter: none; transition: filter 1.5s ease; }
.ewm-band.grey { filter: grayscale(.94) brightness(.62); }
.ewm-sky { position: absolute; inset: 0;
  background:
    radial-gradient(120% 65% at 50% 100%, var(--glow), transparent 62%),
    linear-gradient(180deg, var(--deep) 0%, var(--mid) 68%, var(--deep) 100%); }
.ewm-ridge { position: absolute; left: -2%; right: -2%; bottom: 0; }
.ewm-ridge.far { height: 46%; background: var(--ridgeFar); opacity: .8; }
.ewm-ridge.near { height: 32%; background: var(--ridge); }
.ewm-fog { position: absolute; inset: 0; opacity: 0; transition: opacity 1.5s ease; pointer-events: none;
  background: repeating-linear-gradient(115deg, rgba(200,200,210,.05) 0 26px, transparent 26px 60px),
    radial-gradient(90% 55% at 50% 60%, rgba(160,160,175,.14), transparent 70%); }
.ewm-band.grey .ewm-fog { opacity: 1; }
.ewm-head { position: absolute; left: 0; right: 0; bottom: 14px; display: flex; align-items: center;
  justify-content: center; gap: 12px; }
.ewm-head .rule { width: clamp(30px, 9vw, 70px); height: 1px;
  background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--a) 70%, transparent)); }
.ewm-head .rule.r { transform: scaleX(-1); }
.ewm-hname { display: flex; align-items: center; gap: 8px; font-weight: 800; letter-spacing: .22em;
  margin-right: -.22em; font-size: clamp(13px, 3.6vw, 17px); color: var(--a);
  text-shadow: 0 2px 10px rgba(0,0,0,.8), 0 0 18px color-mix(in srgb, var(--a) 45%, transparent); }
.ewm-hemoji { font-size: 17px; filter: drop-shadow(0 0 8px color-mix(in srgb, var(--a) 60%, transparent)); }
.ewm-hord { position: absolute; left: 0; right: 0; bottom: 44px; text-align: center;
  font-size: 10px; font-weight: 700; letter-spacing: .4em; margin-right: -.4em;
  color: color-mix(in srgb, var(--a) 55%, #8a80aa); }

/* ---- crown (key-art world header) ---- */
.ewm-crown { position: absolute; left: 0; right: 0; top: 0; overflow: hidden;
  display: flex; flex-direction: column; align-items: center; justify-content: flex-end;
  padding-bottom: 26px; gap: 8px; }
.ewm-key { position: absolute; inset: 0; background-image: url('${KEYART_URL}');
  background-size: cover; background-position: center 30%; opacity: .85; }
.ewm-key-shade { position: absolute; inset: 0;
  background: linear-gradient(180deg, rgba(7,5,16,.55) 0%, rgba(7,5,16,.1) 45%, #070510 98%); }
.ewm-crown-title { position: relative; font-family: 'Cinzel', Georgia, serif; font-weight: 900;
  font-size: clamp(30px, 8.5vw, 52px); letter-spacing: .16em; margin-right: -.16em; color: transparent;
  background: linear-gradient(175deg, #fff6d8 8%, #ffd76a 34%, #eda528 55%, #ffdf8a 80%);
  background-clip: text; -webkit-background-clip: text;
  filter: drop-shadow(0 2px 10px rgba(0,0,0,.8)) drop-shadow(0 0 24px rgba(255,190,70,.3)); }
.ewm-crown-sub { position: relative; font-size: 11px; font-weight: 600; letter-spacing: .3em;
  margin-right: -.3em; color: #b6a9dd; text-shadow: 0 2px 8px rgba(0,0,0,.9); text-align: center; }

/* ---- haven (journey start) ---- */
.ewm-start { position: absolute; left: 0; right: 0; bottom: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 6px;
  background: linear-gradient(180deg, transparent, rgba(255,190,90,.05));
}
.ewm-start .h { font-size: 24px; filter: drop-shadow(0 0 12px rgba(255,190,90,.5)); }
.ewm-start .t { font-size: 10px; font-weight: 700; letter-spacing: .34em; margin-right: -.34em; color: #9d8fc5; }

/* ---- trail ---- */
.ewm-path { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.ewm-path path { fill: none; stroke-linecap: round; }
.ewm-seg-grey { stroke: #59526e; stroke-width: 5; stroke-dasharray: 1 14; opacity: .8; }
.ewm-seg-glow { stroke: #ffd76a; stroke-width: 11; opacity: .18; }
.ewm-seg-gold { stroke: #ffd76a; stroke-width: 4; stroke-dasharray: 1 12; opacity: .95; }

/* ---- level nodes ---- */
.ewm-node { position: absolute; transform: translate(-50%, -50%); display: flex; flex-direction: column;
  align-items: center; gap: 5px; background: none; border: 0; color: inherit; font: inherit; cursor: pointer;
  padding: 10px; touch-action: manipulation; }
.ewm-stars { display: flex; gap: 3px; font-size: 15px; line-height: 1; }
.ewm-stars .s { color: #3d3556; text-shadow: 0 1px 2px rgba(0,0,0,.6); }
.ewm-stars .s.on { color: #ffd54a; text-shadow: 0 0 8px rgba(255,213,74,.75), 0 1px 2px rgba(0,0,0,.6); }
.ewm-node.st-locked .ewm-stars, .ewm-node.st-avail .ewm-stars { visibility: hidden; }
.ewm-circle { position: relative; width: 62px; height: 62px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: radial-gradient(circle at 32% 28%, color-mix(in srgb, var(--a) 55%, #fff),
    var(--a) 52%, color-mix(in srgb, var(--a) 45%, #000) 100%);
  border: 3px solid color-mix(in srgb, var(--a) 45%, #fff);
  box-shadow: 0 6px 18px rgba(0,0,0,.55), 0 0 18px color-mix(in srgb, var(--a) 40%, transparent);
  transition: transform .14s ease; }
.ewm-num { font-size: 26px; font-weight: 900; color: #fff; text-shadow: 0 2px 4px rgba(0,0,0,.45); }
.ewm-name { font-size: 12.5px; font-weight: 800; letter-spacing: .06em; color: #ffe8b0;
  text-shadow: 0 2px 6px rgba(0,0,0,.9); white-space: nowrap; }
.ewm-node:active .ewm-circle { transform: scale(.92); }

.ewm-node.st-avail .ewm-circle { animation: ewmPulse 1.6s ease-in-out infinite; }
@keyframes ewmPulse {
  0%, 100% { box-shadow: 0 6px 18px rgba(0,0,0,.55), 0 0 14px color-mix(in srgb, var(--a) 45%, transparent); transform: scale(1); }
  50% { box-shadow: 0 6px 18px rgba(0,0,0,.55), 0 0 30px color-mix(in srgb, var(--a) 85%, transparent); transform: scale(1.06); }
}
.ewm-node.st-locked { cursor: default; }
.ewm-node.st-locked .ewm-circle { background: radial-gradient(circle at 32% 28%, #56506b, #39334e 60%, #241f36 100%);
  border-color: #4a4360; box-shadow: 0 6px 14px rgba(0,0,0,.5); }
.ewm-node.st-locked .ewm-num { display: none; }
.ewm-node.st-locked .ewm-name { color: #7d739c; }
.ewm-lock { position: absolute; font-size: 22px; filter: grayscale(1) brightness(1.15); }
.ewm-node.st-done .ewm-circle::after { content: '✓'; position: absolute; right: -4px; bottom: -4px;
  width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 900; color: #123312; background: linear-gradient(180deg, #b6f7a6, #4fd06a);
  border: 2px solid rgba(255,255,255,.7); box-shadow: 0 2px 6px rgba(0,0,0,.5); }
.ewm-node.shake { animation: ewmShake .4s ease; }
@keyframes ewmShake { 0%,100% { transform: translate(-50%,-50%); } 20% { transform: translate(calc(-50% - 6px),-50%); }
  40% { transform: translate(calc(-50% + 6px),-50%); } 60% { transform: translate(calc(-50% - 4px),-50%); }
  80% { transform: translate(calc(-50% + 4px),-50%); } }

/* ---- you-are-here marker ---- */
.ewm-here { position: absolute; transform: translate(-50%, -50%); pointer-events: none; }
.ewm-ring { position: absolute; left: 50%; top: 50%; width: 76px; height: 76px; border-radius: 50%;
  transform: translate(-50%, -50%); border: 2px solid rgba(255,215,106,.9);
  animation: ewmRing 1.8s ease-out infinite; }
@keyframes ewmRing { 0% { transform: translate(-50%,-50%) scale(.8); opacity: .9; }
  100% { transform: translate(-50%,-50%) scale(1.55); opacity: 0; } }
.ewm-pin { position: absolute; left: 50%; top: -68px; transform: translateX(-50%);
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  animation: ewmBob 1.5s ease-in-out infinite; }
@keyframes ewmBob { 0%, 100% { transform: translate(-50%, 0); } 50% { transform: translate(-50%, -7px); } }
.ewm-pin .d { width: 16px; height: 16px; transform: rotate(45deg); border-radius: 4px;
  background: linear-gradient(135deg, #fff3c4, #ffd76a 55%, #d9930f);
  box-shadow: 0 0 14px rgba(255,213,74,.9), 0 3px 8px rgba(0,0,0,.5); }
.ewm-pin .tip { width: 0; height: 0; border-left: 5px solid transparent; border-right: 5px solid transparent;
  border-top: 8px solid #e7ab26; margin-top: -1px; filter: drop-shadow(0 2px 4px rgba(0,0,0,.5)); }
.ewm.ewm-reduced .ewm-ring, .ewm.ewm-reduced .ewm-pin,
.ewm.ewm-reduced .ewm-node.st-avail .ewm-circle { animation: none; }

/* ---- fixed chrome ---- */
.ewm-top { position: absolute; left: 0; right: 0; top: 0; z-index: 4; display: flex; align-items: center;
  gap: 10px; padding: calc(10px + env(safe-area-inset-top)) 14px 26px;
  background: linear-gradient(180deg, rgba(7,5,16,.92) 30%, transparent); pointer-events: none; }
.ewm-top > * { pointer-events: auto; }
.ewm-back { display: flex; align-items: center; gap: 6px; padding: 9px 16px 9px 12px; border-radius: 999px;
  border: 1px solid rgba(255,255,255,.16); background: linear-gradient(180deg, rgba(255,255,255,.09), rgba(255,255,255,.03));
  color: #efe9ff; font: inherit; font-size: 13px; font-weight: 800; letter-spacing: .1em; cursor: pointer;
  box-shadow: 0 4px 14px rgba(0,0,0,.4); transition: transform .12s ease, border-color .2s ease; }
.ewm-back:active { transform: scale(.94); }
.ewm-title { flex: 1 1 auto; text-align: center; font-weight: 800; font-size: clamp(11px, 3.2vw, 14px);
  letter-spacing: .26em; margin-right: -.26em; color: #cfc2f0; text-shadow: 0 2px 8px rgba(0,0,0,.8);
  white-space: nowrap; overflow: hidden; }
.ewm-starchip { display: flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 999px;
  border: 1px solid rgba(255,213,74,.35); background: linear-gradient(180deg, rgba(255,255,255,.08), rgba(255,255,255,.02));
  font-size: 13px; font-weight: 800; color: #ffe08a; box-shadow: 0 4px 14px rgba(0,0,0,.4); }
.ewm-vig { position: absolute; inset: 0; z-index: 3; pointer-events: none;
  background: radial-gradient(130% 100% at 50% 45%, transparent 60%, rgba(0,0,0,.5) 100%); }

/* ---- toast ---- */
.ewm-toast { position: absolute; left: 50%; bottom: calc(30px + env(safe-area-inset-bottom)); z-index: 6;
  transform: translateX(-50%) translateY(8px); padding: 11px 20px; border-radius: 999px; max-width: 88vw;
  background: rgba(16,10,32,.94); border: 1px solid rgba(255,255,255,.16); box-shadow: 0 10px 30px rgba(0,0,0,.5);
  font-size: 13px; font-weight: 600; letter-spacing: .04em; color: #d9cff5; text-align: center;
  opacity: 0; transition: opacity .25s ease, transform .25s ease; pointer-events: none; }
.ewm-toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }

/* ---- realm banner ---- */
.ewm-banner { position: absolute; inset: 0; z-index: 8; display: flex; align-items: center; justify-content: center;
  padding: 26px; background: rgba(4,2,12,.72); backdrop-filter: blur(5px); -webkit-backdrop-filter: blur(5px);
  animation: ewmFade .3s ease both; cursor: pointer; }
@keyframes ewmFade { from { opacity: 0; } to { opacity: 1; } }
.ewm-banner.hide { opacity: 0; transition: opacity .28s ease; pointer-events: none; }
.ewm-bcard { width: min(420px, 94vw); border-radius: 22px; overflow: hidden; text-align: center;
  background: linear-gradient(180deg, #1d1338 0%, #130c28 100%);
  border: 1px solid color-mix(in srgb, var(--a) 55%, rgba(255,255,255,.1));
  box-shadow: 0 30px 80px rgba(0,0,0,.7), 0 0 40px color-mix(in srgb, var(--a) 22%, transparent);
  animation: ewmCard .45s cubic-bezier(.22,1.4,.36,1) both; }
@keyframes ewmCard { from { opacity: 0; transform: scale(.86) translateY(16px); } to { opacity: 1; transform: none; } }
.ewm.ewm-reduced .ewm-banner, .ewm.ewm-reduced .ewm-bcard { animation: none; }
.ewm-bkey { height: 128px; background-image: url('${KEYART_URL}'); background-size: cover; background-position: center 32%;
  -webkit-mask-image: linear-gradient(180deg, #000 40%, transparent); mask-image: linear-gradient(180deg, #000 40%, transparent); }
.ewm-bbody { padding: 0 24px 22px; margin-top: -34px; position: relative; }
.ewm-bemoji { font-size: 40px; filter: drop-shadow(0 0 16px color-mix(in srgb, var(--a) 70%, transparent)); }
.ewm-bord { margin-top: 10px; font-size: 10px; font-weight: 700; letter-spacing: .42em; margin-right: -.42em;
  color: color-mix(in srgb, var(--a) 60%, #9a8fc0); }
.ewm-bname { margin-top: 6px; font-family: 'Cinzel', Georgia, serif; font-weight: 900;
  font-size: clamp(26px, 7.5vw, 36px); letter-spacing: .08em; color: var(--a);
  text-shadow: 0 0 22px color-mix(in srgb, var(--a) 50%, transparent), 0 3px 10px rgba(0,0,0,.6); }
.ewm-bintro { margin-top: 12px; font-size: 14.5px; line-height: 1.55; color: #d9cff5; font-style: italic; }
.ewm-btap { margin-top: 18px; font-size: 10.5px; font-weight: 800; letter-spacing: .32em; margin-right: -.32em;
  color: #9fe8ff; animation: ewmTapPulse 1.5s ease-in-out infinite; }
@keyframes ewmTapPulse { 0%, 100% { opacity: .35; } 50% { opacity: 1; } }
`

let cssInjected = false
function injectCss(): void {
  if (cssInjected) return
  cssInjected = true
  const style = document.createElement('style')
  style.textContent = CSS
  document.head.appendChild(style)
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // private mode — the map just re-plays its reveal next time
  }
}

export class WorldMap {
  private root: HTMLDivElement
  private scroll: HTMLDivElement
  private nodes: MapNode[] = []
  private currentIdx = 0
  private trackH: number
  private leaving = false
  private timers: number[] = []

  constructor(private handlers: WorldMapHandlers) {
    injectCss()
    this.trackH = CROWN_H + REALMS.length * REALM_H + START_H
    this.buildNodes()

    this.root = document.createElement('div')
    this.root.className = 'ewm'
    if (appSettings.reducedMotion()) this.root.classList.add('ewm-reduced')
    this.root.innerHTML = `
      <div class="ewm-scroll">
        <div class="ewm-track" style="height:${this.trackH}px">
          ${this.bandsHtml()}
          ${this.crownHtml()}
          ${this.startHtml()}
          ${this.trailSvg()}
          ${this.nodesHtml()}
          ${this.markerHtml()}
        </div>
      </div>
      <div class="ewm-vig"></div>
      <div class="ewm-top">
        <button class="ewm-back" data-nav="menu">‹ MENU</button>
        <div class="ewm-title">WORLD MAP</div>
        <div class="ewm-starchip">★ ${economy.totalStars()}/${LEVELS.length * 3}</div>
      </div>
      <div class="ewm-toast" data-toast></div>
    `
    document.body.appendChild(this.root)
    this.scroll = this.root.querySelector<HTMLDivElement>('.ewm-scroll')!

    this.root.addEventListener('click', (e) => {
      if (this.leaving) return
      const target = e.target as HTMLElement
      if (target.closest('[data-nav]')) {
        playUiTick()
        this.leave(() => this.handlers.onBack())
        return
      }
      const nodeEl = target.closest<HTMLElement>('.ewm-node')
      if (nodeEl) this.onNodeTap(nodeEl)
    })

    this.reveal()
  }

  // ---- model -------------------------------------------------------------

  private buildNodes(): void {
    let idx = 0
    for (let ri = 0; ri < REALMS.length; ri++) {
      const realm = REALMS[ri]
      const bandTop = CROWN_H + (REALMS.length - 1 - ri) * REALM_H
      const n = realm.levelIds.length
      for (let j = 0; j < n; j++) {
        const lvl = LEVELS.find((l) => l.id === realm.levelIds[j])
        if (!lvl) continue
        const stars = economy.starsFor(lvl.id)
        const unlocked = isLevelUnlocked(lvl.index, economy.data.stars)
        this.nodes.push({
          lvl,
          realm,
          realmIdx: ri,
          x: idx % 2 === 0 ? 33 : 67,
          y: bandTop + REALM_H - (REALM_H * (j + 1)) / (n + 1),
          state: !unlocked ? 'locked' : stars >= 1 ? 'done' : 'avail',
          stars,
        })
        idx++
      }
    }
    const firstOpen = this.nodes.findIndex((n) => n.state === 'avail')
    this.currentIdx = firstOpen >= 0 ? firstOpen : this.nodes.length - 1
  }

  private coloredRealms(): number {
    return this.nodes[this.currentIdx].realmIdx + 1
  }

  // ---- static markup -----------------------------------------------------

  private bandsHtml(): string {
    return REALMS.map((r, ri) => {
      const top = CROWN_H + (REALMS.length - 1 - ri) * REALM_H
      const [far, near] = RIDGES[ri % RIDGES.length]
      const vars = `--a:${r.ui.accent};--deep:${r.ui.deep};--mid:${r.ui.mid};--glow:${r.ui.glow};--ridge:${r.ui.ridge};--ridgeFar:${r.ui.ridgeFar}`
      return `
        <section class="ewm-band" data-realm="${ri}" style="top:${top}px;height:${REALM_H}px;${vars}">
          <div class="ewm-sky"></div>
          <div class="ewm-ridge far" style="clip-path:${far}"></div>
          <div class="ewm-ridge near" style="clip-path:${near}"></div>
          <div class="ewm-fog"></div>
          <div class="ewm-hord">REALM ${ROMAN[ri]} · ${r.element.toUpperCase()}</div>
          <div class="ewm-head">
            <span class="rule r"></span>
            <span class="ewm-hname"><span class="ewm-hemoji">${r.emoji}</span>${r.name.toUpperCase()}</span>
            <span class="rule"></span>
          </div>
        </section>`
    }).join('')
  }

  private crownHtml(): string {
    return `
      <header class="ewm-crown" style="height:${CROWN_H}px">
        <div class="ewm-key"></div>
        <div class="ewm-key-shade"></div>
        <div class="ewm-crown-title">AETHERIA</div>
        <div class="ewm-crown-sub">SIX REALMS · DRIVE OUT THE GREYING</div>
      </header>`
  }

  private startHtml(): string {
    return `
      <div class="ewm-start" style="height:${START_H}px">
        <div class="h">⌂</div>
        <div class="t">HAVEN · THE JOURNEY BEGINS</div>
      </div>`
  }

  private trailSvg(): string {
    const pts = [
      { x: 50, y: this.trackH - START_H * 0.55 }, // Haven
      ...this.nodes.map((n) => ({ x: n.x, y: n.y })),
    ]
    const segs: string[] = []
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]
      const b = pts[i + 1]
      const dy = (a.y - b.y) * 0.45
      const d = `M ${a.x} ${a.y} C ${a.x} ${a.y - dy}, ${b.x} ${b.y + dy}, ${b.x} ${b.y}`
      // segment 0 leaves the Haven (always travelled); segment i>0 leaves node i-1
      const reached = i === 0 || this.nodes[i - 1].stars >= 1
      if (reached) {
        segs.push(`<path class="ewm-seg-glow" vector-effect="non-scaling-stroke" d="${d}"/>`)
        segs.push(`<path class="ewm-seg-gold" vector-effect="non-scaling-stroke" d="${d}"/>`)
      } else {
        segs.push(`<path class="ewm-seg-grey" vector-effect="non-scaling-stroke" d="${d}"/>`)
      }
    }
    return `<svg class="ewm-path" viewBox="0 0 100 ${this.trackH}" preserveAspectRatio="none" aria-hidden="true">${segs.join('')}</svg>`
  }

  private nodesHtml(): string {
    return this.nodes
      .map((n) => {
        const stars = [0, 1, 2].map((i) => `<span class="s ${i < n.stars ? 'on' : ''}">★</span>`).join('')
        const label = n.state === 'locked' ? '???' : n.lvl.name
        const lock = n.state === 'locked' ? '<span class="ewm-lock">🔒</span>' : ''
        return `
        <button class="ewm-node st-${n.state}" data-level="${n.lvl.id}" data-state="${n.state}"
          style="left:${n.x}%;top:${n.y}px;--a:${n.realm.ui.accent}"
          aria-label="Level ${n.lvl.index + 1}: ${label}">
          <span class="ewm-stars">${stars}</span>
          <span class="ewm-circle"><span class="ewm-num">${n.lvl.index + 1}</span>${lock}</span>
          <span class="ewm-name">${label}</span>
        </button>`
      })
      .join('')
  }

  private markerHtml(): string {
    const cur = this.nodes[this.currentIdx]
    return `
      <div class="ewm-here" style="left:${cur.x}%;top:${cur.y}px">
        <div class="ewm-ring"></div>
        <div class="ewm-pin"><span class="d"></span><span class="tip"></span></div>
      </div>`
  }

  // ---- reveal: centering, the recolor moment, realm banner ----------------

  private at(ms: number, fn: () => void): void {
    this.timers.push(window.setTimeout(fn, ms))
  }

  private centerOn(y: number, smooth: boolean): void {
    const top = Math.max(0, Math.min(this.trackH - this.scroll.clientHeight, y - this.scroll.clientHeight * 0.55))
    if (smooth && !appSettings.reducedMotion()) this.scroll.scrollTo({ top, behavior: 'smooth' })
    else this.scroll.scrollTop = top
  }

  private reveal(): void {
    const colored = this.coloredRealms()
    const prev = readJson<number | null>(REACH_KEY, null)
    writeJson(REACH_KEY, colored)

    // The Greying: realms beyond the player's reach stay drained.
    const bands = Array.from(this.root.querySelectorAll<HTMLElement>('.ewm-band'))
    for (const b of bands) {
      const ri = Number(b.dataset.realm)
      const isColored = ri < colored
      // Newly reclaimed realms start grey and bloom back to colour on entry.
      const bloom = isColored && prev !== null && ri >= prev
      if (!isColored || bloom) b.classList.add('grey')
      if (bloom) this.at(600, () => b.classList.remove('grey'))
    }

    const cur = this.nodes[this.currentIdx]
    const bloomed = prev !== null && colored > prev
    if (bloomed && this.currentIdx > 0) {
      // Arrive at the node just cleared, watch the colour return, then travel on.
      this.centerOn(this.nodes[this.currentIdx - 1].y, false)
      this.at(900, () => this.centerOn(cur.y, true))
    } else {
      this.centerOn(cur.y, false)
    }

    // First visit to a realm → its story banner (skippable flavor).
    const seen = readJson<string[]>(SEEN_KEY, [])
    if (!seen.includes(cur.realm.id)) {
      this.at(bloomed ? 1900 : 450, () => this.showBanner(cur.realm, cur.realmIdx))
    }
  }

  private showBanner(realm: RealmDef, realmIdx: number): void {
    if (this.leaving) return
    const el = document.createElement('div')
    el.className = 'ewm-banner'
    el.style.setProperty('--a', realm.ui.accent)
    el.innerHTML = `
      <div class="ewm-bcard" style="--a:${realm.ui.accent}">
        <div class="ewm-bkey"></div>
        <div class="ewm-bbody">
          <div class="ewm-bemoji">${realm.emoji}</div>
          <div class="ewm-bord">REALM ${ROMAN[realmIdx]} · ${realm.element.toUpperCase()}</div>
          <div class="ewm-bname">${realm.name}</div>
          <div class="ewm-bintro">“${realm.intro}”</div>
          <div class="ewm-btap">TAP TO CONTINUE</div>
        </div>
      </div>`
    el.addEventListener('click', (e) => {
      e.stopPropagation()
      playUiTick()
      const seen = readJson<string[]>(SEEN_KEY, [])
      if (!seen.includes(realm.id)) writeJson(SEEN_KEY, [...seen, realm.id])
      el.classList.add('hide')
      window.setTimeout(() => el.remove(), 300)
    })
    this.root.appendChild(el)
  }

  // ---- input ---------------------------------------------------------------

  private onNodeTap(el: HTMLElement): void {
    const levelId = el.dataset.level
    const state = el.dataset.state as NodeState | undefined
    if (!levelId || !state) return
    if (state === 'locked') {
      el.classList.remove('shake')
      void el.offsetWidth // restart the animation
      el.classList.add('shake')
      this.toast('Sealed by the Greying — clear the previous level first')
      return
    }
    playUiTick()
    this.leave(() => this.handlers.onPlay(levelId))
  }

  private toastTimer = 0
  private toast(msg: string): void {
    const el = this.root.querySelector<HTMLElement>('[data-toast]')!
    el.textContent = msg
    el.classList.add('show')
    window.clearTimeout(this.toastTimer)
    this.toastTimer = window.setTimeout(() => el.classList.remove('show'), 2200)
  }

  /** Fade out, then hand control back (scene switch). */
  private leave(cb: () => void): void {
    if (this.leaving) return
    this.leaving = true
    this.root.classList.add('ewm-leave')
    window.setTimeout(cb, 230)
  }

  destroy(): void {
    for (const id of this.timers) window.clearTimeout(id)
    window.clearTimeout(this.toastTimer)
    this.root.remove()
  }
}
