// BattleHud — a clean, modern HTML/CSS overlay that sits on top of the 3D battle
// canvas. It renders NO game logic: it reads the sim's public state each frame and
// forwards taps back through callbacks. The root is pointer-events:none so board
// taps fall through to the canvas; only real controls opt back in (.pe).

import type { Sim, SimHero } from '../sim'
import { TOWERS, TOWER_ORDER, type TowerKind } from '../game/towers'
import { SPELLS, SPELL_ORDER, type SpellKey } from '../game/spells'
import { ENEMIES, type EnemyKind } from '../game/enemies'
import { RARITY_COLOR } from '../game/heroes'

export interface HudCallbacks {
  onStart(): void
  onPause(): void
  onSpeed(): void
  onTowerButton(kind: TowerKind): void
  onSpellButton(key: SpellKey): void
  onHeroButton(heroId: string): void // deploy a party hero, or cast its spell if fielded
  onSelectDeselect(): void // tap the "close panel" affordance
  onUpgrade(id: number): void
  onBranch(id: number, idx: number): void
  onTargeting(id: number): void
  onDraft(index: number): void
  onQuit(): void
  onReplay(): void
  onBack(): void
}

export interface HudContext {
  endless: boolean
  levelName: string
  totalWaves: number
  towerUnlocked(kind: TowerKind): boolean
  buildKind: TowerKind | null
  buildHeroId: string | null
  selectedId: number | null
}

function hex(c: number): string {
  return '#' + (c & 0xffffff).toString(16).padStart(6, '0')
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

const CSS = `
.eld-hud, .eld-hud * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; font-family: 'Baloo 2','Nunito',system-ui,'Segoe UI',Arial,sans-serif; }
.eld-hud {
  position: fixed; inset: 0; z-index: 20; pointer-events: none;
  color: #fff; user-select: none; overflow: hidden;
  --panel: #241a44; --panel2: #2f2258; --stroke: rgba(255,255,255,.14);
  --gold: #ffd54a; --life: #ff5b7a; --good: #46e08a; --accent: #b06bff;
}
.eld-hud .pe { pointer-events: auto; }
.eld-hud button { font: inherit; color: #fff; border: 0; background: none; cursor: pointer; }

/* ---- top bar ---- */
.eld-top { position:absolute; top:0; left:0; right:0; display:flex; gap:8px; align-items:center;
  padding: calc(env(safe-area-inset-top,0px) + 10px) 12px 12px; }
.eld-stat { display:flex; align-items:center; gap:8px; background: linear-gradient(180deg,var(--panel2),var(--panel));
  border:1px solid var(--stroke); border-radius:16px; padding:8px 14px; box-shadow:0 4px 14px rgba(0,0,0,.35), inset 0 1px 0 rgba(255,255,255,.08); }
.eld-stat .ico { width:24px; height:24px; border-radius:50%; display:grid; place-items:center; font-weight:800; font-size:15px; flex:0 0 auto; }
.eld-stat .val { font-weight:800; font-size:22px; line-height:1; letter-spacing:.5px; font-variant-numeric: tabular-nums; }
.eld-gold .ico { background: radial-gradient(circle at 35% 30%, #fff2b0, var(--gold)); color:#7a5600; }
.eld-gold .val { color:#ffe27a; }
.eld-life .ico { background: radial-gradient(circle at 35% 30%, #ffc3cf, var(--life)); color:#7a1024; }
.eld-life .val { color:#ffd0da; }
.eld-wave { margin-left:auto; }
.eld-wave .val { color:#a8e9ff; font-size:18px; }
.eld-levelname { position:absolute; top: calc(env(safe-area-inset-top,0px) + 58px); right:14px; font-size:12px; font-weight:700; color:#c9b6ff; opacity:.85; letter-spacing:1px; }

/* combo + telegraph, centered under the top bar */
.eld-combo { position:absolute; top:80px; left:50%; transform:translateX(-50%); font-weight:900; font-size:22px;
  text-shadow:0 2px 0 rgba(0,0,0,.5); opacity:0; transition:opacity .2s; white-space:nowrap; }
.eld-combo.show { opacity:1; }
.eld-telegraph { position:absolute; top:112px; left:50%; transform:translateX(-50%);
  background:rgba(20,12,40,.82); border:1px solid var(--stroke); border-radius:12px; padding:6px 16px;
  font-size:14px; font-weight:800; letter-spacing:.5px; white-space:nowrap; box-shadow:0 4px 12px rgba(0,0,0,.4); }
.eld-telegraph.hidden { display:none; }

/* ---- right controls (pause/speed) ---- */
.eld-rc { position:absolute; top: calc(env(safe-area-inset-top,0px) + 66px); right:12px; display:flex; gap:8px; }
.eld-rc button { width:52px; height:52px; border-radius:14px; background:linear-gradient(180deg,var(--panel2),var(--panel));
  border:1px solid var(--stroke); font-size:22px; font-weight:800; box-shadow:0 4px 12px rgba(0,0,0,.35); display:grid; place-items:center; }
.eld-rc button:active { transform:scale(.92); }

/* ---- start button ---- */
.eld-start { position:absolute; left:50%; bottom:210px; transform:translateX(-50%);
  padding:16px 42px; border-radius:20px; font-size:26px; font-weight:900; letter-spacing:1px;
  background:linear-gradient(180deg,#3ad07a,#1f9a54); border:1px solid rgba(255,255,255,.25);
  box-shadow:0 8px 22px rgba(31,154,84,.5), inset 0 1px 0 rgba(255,255,255,.3); animation:eldpulse 1.4s ease-in-out infinite; }
.eld-start:active { transform:translateX(-50%) scale(.94); }
.eld-start.hidden { display:none; }
@keyframes eldpulse { 0%,100%{ transform:translateX(-50%) scale(1);} 50%{ transform:translateX(-50%) scale(1.05);} }

/* ---- bottom dock ---- */
.eld-dock { position:absolute; left:0; right:0; bottom:0; padding: 10px 10px calc(env(safe-area-inset-bottom,0px) + 12px);
  background:linear-gradient(0deg, rgba(18,10,36,.96), rgba(18,10,36,.7) 70%, rgba(18,10,36,0));
  display:flex; flex-direction:column; gap:8px; }
.eld-spells { display:flex; gap:10px; justify-content:center; }
.eld-spell { position:relative; width:58px; height:58px; border-radius:50%; display:grid; place-items:center;
  background:radial-gradient(circle at 40% 35%, #2c2050, #1a1030); border:2px solid #555; font-size:24px;
  box-shadow:0 4px 12px rgba(0,0,0,.4); }
.eld-spell:active { transform:scale(.92); }
.eld-spell .cdmask { position:absolute; inset:-2px; border-radius:50%; pointer-events:none; }
.eld-spell .cdtxt { position:absolute; font-size:16px; font-weight:900; text-shadow:0 1px 2px #000; }
.eld-spell.ready .cdtxt { display:none; }
.eld-towers { display:flex; gap:8px; justify-content:center; }
.eld-tower { position:relative; flex:1 1 0; max-width:118px; border-radius:16px; padding:8px 4px 6px;
  background:linear-gradient(180deg,var(--panel2),var(--panel)); border:2px solid #444;
  display:flex; flex-direction:column; align-items:center; gap:2px; box-shadow:0 4px 12px rgba(0,0,0,.35); transition:transform .08s; }
.eld-tower:active { transform:scale(.95); }
.eld-tower.sel { background:linear-gradient(180deg, rgba(255,255,255,.12), rgba(0,0,0,.1)); }
.eld-tower.dim { opacity:.5; }
.eld-tower .gem { width:34px; height:34px; border-radius:10px; margin-top:2px;
  box-shadow:0 0 12px currentColor, inset 0 2px 4px rgba(255,255,255,.4); }
.eld-tower .tn { font-size:14px; font-weight:800; }
.eld-tower .tc { font-size:14px; font-weight:800; color:#ffe27a; }
.eld-tower .tt { font-size:10px; color:#c9b6ff; letter-spacing:.5px; }
.eld-tower .lock { position:absolute; inset:0; display:grid; place-items:center; font-size:26px; background:rgba(10,6,20,.55); border-radius:14px; }

/* ---- upgrade panel ---- */
.eld-upg { position:absolute; left:50%; bottom:308px; transform:translateX(-50%); width:min(94vw,440px);
  background:linear-gradient(180deg,#221743,#1a1030); border-radius:20px; padding:14px 16px;
  box-shadow:0 12px 34px rgba(0,0,0,.55); border:2px solid; }
.eld-upg .row1 { display:flex; align-items:baseline; justify-content:space-between; }
.eld-upg .tt { font-size:20px; font-weight:900; }
.eld-upg .stars { font-size:16px; color:var(--gold); }
.eld-upg .stat { margin-top:6px; font-size:14px; color:#a8e9ff; font-weight:700; }
.eld-upg .evs { margin-top:4px; font-size:13px; font-weight:800; }
.eld-upg .ctl { display:flex; gap:8px; margin-top:12px; align-items:stretch; }
.eld-upg .tgt { flex:0 0 auto; padding:10px 12px; border-radius:12px; background:#33245e; border:1px solid var(--stroke); font-weight:800; font-size:14px; }
.eld-upg .up { flex:1 1 auto; padding:10px; border-radius:12px; font-weight:900; font-size:17px;
  background:linear-gradient(180deg,#3ad07a,#1f9a54); border:1px solid rgba(255,255,255,.25); }
.eld-upg .up.no { background:#4a4470; }
.eld-upg .branches { display:flex; gap:8px; flex:1 1 auto; }
.eld-upg .br { flex:1; padding:8px 6px; border-radius:12px; font-weight:800; border:1px solid rgba(255,255,255,.25);
  display:flex; flex-direction:column; align-items:center; line-height:1.15; }
.eld-upg .br .bc { font-size:12px; opacity:.9; }
.eld-upg .br.no { opacity:.55; }
.eld-upg .maxlbl { flex:1 1 auto; text-align:center; padding:10px; font-weight:900; color:var(--gold); font-size:18px; }
.eld-upg .close { position:absolute; top:8px; right:12px; font-size:20px; opacity:.7; padding:4px 8px; }

/* ---- overlays (draft / result / pause) ---- */
.eld-ov { position:absolute; inset:0; background:rgba(10,6,22,.72); backdrop-filter:blur(3px);
  display:flex; flex-direction:column; align-items:center; justify-content:center; gap:16px; padding:24px; text-align:center; }
.eld-ov h1 { font-size:44px; font-weight:900; margin:0; text-shadow:0 4px 0 rgba(0,0,0,.5); }
.eld-ov .sub { font-size:18px; color:#d8d0ff; margin:-6px 0 2px; }
.eld-cards { display:flex; gap:14px; flex-wrap:wrap; justify-content:center; max-width:640px; }
.eld-card { width:170px; border-radius:20px; padding:18px 14px; background:linear-gradient(180deg,#241743,#160c2e);
  border:3px solid; display:flex; flex-direction:column; align-items:center; gap:8px; box-shadow:0 10px 28px rgba(0,0,0,.5);
  transform:scale(.6); opacity:0; animation:eldpop .35s cubic-bezier(.2,1.3,.5,1) forwards; }
.eld-card:active { transform:scale(.96); }
.eld-card .gem { width:56px; height:56px; border-radius:16px; box-shadow:0 0 22px currentColor, inset 0 3px 6px rgba(255,255,255,.5); animation:eldspin 6s linear infinite; }
.eld-card .rar { font-size:12px; font-weight:900; letter-spacing:1.5px; }
.eld-card .nm { font-size:19px; font-weight:900; }
.eld-card .ds { font-size:14px; color:#d8d0ff; }
.eld-card .pk { margin-top:4px; font-weight:900; font-size:16px; }
@keyframes eldpop { to { transform:scale(1); opacity:1; } }
@keyframes eldspin { to { transform:rotate(360deg); } }
.eld-btn { padding:14px 34px; border-radius:16px; font-size:20px; font-weight:900; border:1px solid rgba(255,255,255,.25);
  box-shadow:0 6px 18px rgba(0,0,0,.4); }
.eld-btn.green { background:linear-gradient(180deg,#3ad07a,#1f9a54); }
.eld-btn.purple { background:linear-gradient(180deg,#7b52d8,#4a2f9a); }
.eld-btn.red { background:linear-gradient(180deg,#ff7a5c,#d0402c); }
.eld-btnrow { display:flex; gap:12px; flex-wrap:wrap; justify-content:center; }
.eld-stars { font-size:52px; letter-spacing:8px; }
.eld-rewards { font-size:22px; font-weight:800; line-height:1.5; }

/* ---- floating fx text ---- */
.eld-fx { position:absolute; inset:0; pointer-events:none; z-index:30; overflow:hidden; }
.eld-float { position:absolute; font-weight:900; transform:translate(-50%,-50%); white-space:nowrap;
  text-shadow:0 2px 3px rgba(0,0,0,.7); will-change:transform,opacity; }
.eld-float { --dx: 0px; }
@keyframes eldfloat { 0%{ transform:translate(-50%,-50%) scale(.3);} 22%{ transform:translate(calc(-50% + var(--dx)*.5),-95%) scale(1.18);}
  40%{ transform:translate(calc(-50% + var(--dx)*.7),-110%) scale(1);}
  100%{ transform:translate(calc(-50% + var(--dx)),-185%) scale(.92); opacity:0; } }
@keyframes eldcombo { 0%{ transform:translate(-50%,-50%) scale(.2) rotate(-8deg);} 28%{ transform:translate(-50%,-78%) scale(1.35) rotate(4deg);}
  46%{ transform:translate(-50%,-88%) scale(1.05) rotate(-1deg);}
  100%{ transform:translate(calc(-50% + var(--dx)),-165%) scale(1) rotate(0); opacity:0; } }
.eld-banner { position:absolute; left:50%; top:34%; transform:translateX(-50%); font-size:40px; font-weight:900;
  text-shadow:0 3px 0 rgba(0,0,0,.55); animation:eldbanner 1.6s ease-out forwards; white-space:nowrap; }
@keyframes eldbanner { 0%{ opacity:0; transform:translateX(-50%) scale(.6);} 15%{ opacity:1; transform:translateX(-50%) scale(1);}
  80%{ opacity:1;} 100%{ opacity:0; transform:translateX(-50%) scale(1) translateY(-30px);} }
@media (min-width:900px){ .eld-dock{ max-width:560px; left:50%; transform:translateX(-50%); border-radius:20px 20px 0 0;} }

/* ---- hero bar (deploy party heroes / cast their spells) ---- */
.eld-heroes { display:flex; gap:10px; justify-content:center; align-items:flex-end; min-height:0; }
.eld-heroes:empty { display:none; }
.eld-hero { position:relative; width:60px; display:flex; flex-direction:column; align-items:center; gap:3px; transition:transform .08s; }
.eld-hero:active { transform:scale(.93); }
.eld-hero.dim { opacity:.45; }
.eld-hero .hport { position:relative; width:50px; height:50px; border-radius:50%; display:grid; place-items:center;
  font-size:23px; border:3px solid; box-shadow:0 3px 10px rgba(0,0,0,.45), inset 0 2px 6px rgba(255,255,255,.28); }
.eld-hero.sel .hport { box-shadow:0 0 0 3px rgba(255,255,255,.5), 0 4px 14px rgba(0,0,0,.5); }
.eld-hero.ready .hport { animation:eldheropulse 1.3s ease-in-out infinite; }
@keyframes eldheropulse { 0%,100%{ box-shadow:0 3px 10px rgba(0,0,0,.45), inset 0 2px 6px rgba(255,255,255,.28), 0 0 4px currentColor; }
  50%{ box-shadow:0 3px 10px rgba(0,0,0,.45), inset 0 2px 6px rgba(255,255,255,.28), 0 0 16px currentColor; } }
.eld-hero .hlvl { position:absolute; top:-5px; left:-5px; background:#160c2e; border:1px solid rgba(255,255,255,.35);
  border-radius:9px; font-size:10px; font-weight:900; line-height:1; padding:2px 4px; color:#ffe27a; z-index:2; }
.eld-hero .hcd { position:absolute; inset:-3px; border-radius:50%; pointer-events:none; }
.eld-hero .hcdtxt { position:absolute; inset:0; display:grid; place-items:center; font-size:15px; font-weight:900; text-shadow:0 1px 2px #000; pointer-events:none; }
.eld-hero .hbadge { font-size:11px; font-weight:900; line-height:1; }
.eld-hero .hname { font-size:10px; font-weight:800; color:#e6dcff; letter-spacing:.3px; }

/* ---- synergy panel (active element team bonuses) ---- */
.eld-syn { position:absolute; left:10px; top:132px; display:flex; flex-direction:column; gap:5px; max-width:190px; z-index:21; }
.eld-syn.hidden { display:none; }
.eld-syn .syn-h { font-size:11px; font-weight:900; letter-spacing:1.5px; color:#c9b6ff; opacity:.9; text-shadow:0 1px 2px #000; }
.eld-syn .syn-chip { display:flex; align-items:center; gap:6px; border:1px solid; border-radius:11px; padding:4px 9px 4px 7px;
  background:linear-gradient(180deg, rgba(42,30,84,.94), rgba(22,14,46,.94)); box-shadow:0 3px 10px rgba(0,0,0,.4);
  animation:eldsynin .3s cubic-bezier(.2,1.3,.5,1); }
.eld-syn .syn-chip .si { font-size:15px; }
.eld-syn .syn-chip .st { display:flex; flex-direction:column; line-height:1.15; }
.eld-syn .syn-chip .sn { font-size:12px; font-weight:900; }
.eld-syn .syn-chip .sd { font-size:10px; font-weight:700; color:#d8d0ff; opacity:.9; }
@keyframes eldsynin { from { transform:translateX(-14px); opacity:0; } to { transform:translateX(0); opacity:1; } }

/* ---- motion pass: scene entrance, counter pops, pings, banners, coins ---- */
.battle3d-canvas { animation: eldscenein .6s ease-out both; }
.eld-hud { animation: eldhudin .5s ease-out both; }
@keyframes eldscenein { from { opacity:0; } to { opacity:1; } }
@keyframes eldhudin { from { opacity:0; transform:translateY(8px);} to { opacity:1; transform:none;} }

.eld-stat { transition: transform .12s; }
.eld-stat.pop { animation: eldstatpop .3s cubic-bezier(.2,1.6,.4,1); }
@keyframes eldstatpop { 0%{ transform:scale(1);} 40%{ transform:scale(1.13);} 100%{ transform:scale(1);} }
.eld-life.hurt { animation: eldhurt .4s ease-out; }
@keyframes eldhurt { 0%,60%{ background:linear-gradient(180deg,#8a2038,#5a1024); transform:translateX(0) scale(1.08);}
  15%{ transform:translateX(-4px);} 30%{ transform:translateX(4px);} 45%{ transform:translateX(-3px);} 100%{ transform:none;} }

@media (hover:hover) {
  .eld-tower:hover:not(.dim) { transform:translateY(-3px); border-color:#777; }
  .eld-spell:hover, .eld-hero:hover .hport { filter:brightness(1.15); }
  .eld-rc button:hover, .eld-btn:hover { filter:brightness(1.12); }
}
.eld-start { position:relative; overflow:hidden; }
.eld-start::after { content:''; position:absolute; top:0; bottom:0; left:-70%; width:44%;
  background:linear-gradient(105deg, transparent, rgba(255,255,255,.4), transparent);
  animation: eldsheen 2.4s ease-in-out infinite; }
@keyframes eldsheen { 0%,55%{ left:-70%; } 100%{ left:130%; } }

.eld-upg { animation: eldpanelin .28s cubic-bezier(.2,1.4,.4,1) both; }
@keyframes eldpanelin { from { opacity:0; transform:translateX(-50%) translateY(26px) scale(.94);} to { opacity:1; transform:translateX(-50%) translateY(0) scale(1);} }
.eld-ov { animation: eldovin .3s ease-out both; }
@keyframes eldovin { from { opacity:0; } to { opacity:1; } }
.eld-ov h1 { animation: eldtitlein .55s cubic-bezier(.2,1.5,.4,1) both; }
@keyframes eldtitlein { 0%{ opacity:0; transform:scale(.35) rotate(-4deg);} 60%{ opacity:1; transform:scale(1.12) rotate(1.5deg);} 100%{ transform:scale(1) rotate(0);} }
.eld-stars .st { display:inline-block; animation: eldstarpop .5s cubic-bezier(.2,1.6,.4,1) both; }
@keyframes eldstarpop { 0%{ opacity:0; transform:scale(0) rotate(-40deg);} 60%{ opacity:1; transform:scale(1.4) rotate(8deg);} 100%{ transform:scale(1) rotate(0);} }
.eld-rewards { animation: eldpanelfade .4s ease-out .5s both; }
.eld-btnrow { animation: eldpanelfade .4s ease-out .7s both; }
@keyframes eldpanelfade { from { opacity:0; transform:translateY(12px);} to { opacity:1; transform:none;} }

/* cooldown-complete ping: a bright ring bursts off the button */
.eld-spell.ping::before, .eld-hero.ping .hport::before { content:''; position:absolute; inset:-3px; border-radius:50%;
  border:3px solid currentColor; animation: eldping .5s ease-out forwards; pointer-events:none; }
@keyframes eldping { 0%{ opacity:1; transform:scale(1);} 100%{ opacity:0; transform:scale(1.7);} }

/* wave banner: bigger, sweeping, letter-spaced */
.eld-wavebanner { position:absolute; left:50%; top:30%; transform:translateX(-50%); font-size:54px; font-weight:900;
  letter-spacing:6px; white-space:nowrap; color:#fff;
  text-shadow:0 4px 0 rgba(0,0,0,.5), 0 0 26px rgba(176,107,255,.9);
  animation: eldwaveb 1.7s cubic-bezier(.2,1.2,.4,1) forwards; }
@keyframes eldwaveb { 0%{ opacity:0; transform:translateX(-50%) scale(1.9); letter-spacing:18px; }
  22%{ opacity:1; transform:translateX(-50%) scale(1); letter-spacing:6px; }
  78%{ opacity:1; } 100%{ opacity:0; transform:translateX(-50%) translateY(-24px) scale(.96); } }

/* flying coins (world kill → gold counter) */
.eld-coin { position:absolute; width:16px; height:16px; border-radius:50%; z-index:31; pointer-events:none;
  background:radial-gradient(circle at 35% 30%, #fff2b0, #ffd54a 60%, #c89600); box-shadow:0 0 8px rgba(255,213,74,.9); }
`

export class BattleHud {
  readonly root: HTMLDivElement
  private fxLayer: HTMLDivElement
  private styleEl: HTMLStyleElement
  private cb: HudCallbacks

  // top
  private goldVal: HTMLElement
  private livesVal: HTMLElement
  private waveVal: HTMLElement
  private comboEl: HTMLElement
  private telegraphEl: HTMLElement
  private startBtn: HTMLButtonElement
  private pauseBtn: HTMLButtonElement
  private speedBtn: HTMLButtonElement

  // dock
  private towerBtns = new Map<TowerKind, { root: HTMLElement; cost: HTMLElement; lock: HTMLElement }>()
  private spellBtns = new Map<SpellKey, { root: HTMLElement; mask: HTMLElement; txt: HTMLElement }>()
  private heroRow: HTMLElement
  private heroBtns = new Map<string, { root: HTMLElement; port: HTMLElement; lvl: HTMLElement; mask: HTMLElement; cdtxt: HTMLElement; badge: HTMLElement }>()
  private heroBarBuilt = false
  private synPanel: HTMLElement
  private synList: HTMLElement
  private lastSynKey = ''

  // panels
  private upgradeEl: HTMLElement | null = null
  private overlayEl: HTMLElement | null = null

  private displayGold = 0
  private lastGoldTarget = -1
  private lastAfford = new Map<TowerKind, boolean>()

  // motion-pass state: detect transitions so we ping/pop exactly once
  private goldStat!: HTMLElement
  private lifeStat!: HTMLElement
  private lastLives = -1
  private spellWasReady = new Map<SpellKey, boolean>()
  private heroWasReady = new Map<string, boolean>()

  constructor(cb: HudCallbacks) {
    this.cb = cb
    this.styleEl = el('style')
    this.styleEl.textContent = CSS
    document.head.appendChild(this.styleEl)

    this.root = el('div', 'eld-hud')

    // top bar
    const top = el('div', 'eld-top')
    const gold = el('div', 'eld-stat eld-gold')
    gold.append(this.iconDiv('$'), (this.goldVal = el('span', 'val', '0')))
    const life = el('div', 'eld-stat eld-life')
    life.append(this.iconDiv('♥'), (this.livesVal = el('span', 'val', '0')))
    const wave = el('div', 'eld-stat eld-wave')
    wave.append((this.waveVal = el('span', 'val', 'WAVE 1')))
    top.append(gold, life, wave)
    this.goldStat = gold
    this.lifeStat = life
    this.root.append(top)

    const levelName = el('div', 'eld-levelname')
    levelName.id = 'eld-levelname'
    this.root.append(levelName)

    this.comboEl = el('div', 'eld-combo')
    this.telegraphEl = el('div', 'eld-telegraph hidden')
    this.root.append(this.comboEl, this.telegraphEl)

    // right controls
    const rc = el('div', 'eld-rc')
    this.pauseBtn = el('button', 'pe', '❚❚')
    this.pauseBtn.onclick = () => this.cb.onPause()
    this.speedBtn = el('button', 'pe', '1×')
    this.speedBtn.onclick = () => this.cb.onSpeed()
    rc.append(this.pauseBtn, this.speedBtn)
    this.root.append(rc)

    // start
    this.startBtn = el('button', 'eld-start pe', 'START ▶')
    this.startBtn.onclick = () => this.cb.onStart()
    this.root.append(this.startBtn)

    // dock (spells + towers). The dock itself is pointer-transparent so board taps
    // behind the gradient still reach the canvas; only the buttons opt back in.
    const dock = el('div', 'eld-dock')
    const spells = el('div', 'eld-spells')
    for (const key of SPELL_ORDER) {
      const def = SPELLS[key]
      const b = el('div', 'eld-spell ready pe')
      b.style.borderColor = hex(def.color)
      b.style.color = hex(def.color)
      const glyph = key === 'meteor' ? '☄' : key === 'freeze' ? '❄' : '💰'
      b.append(el('span', undefined, glyph))
      const mask = el('div', 'cdmask')
      const txt = el('div', 'cdtxt', '')
      b.append(mask, txt)
      b.onclick = () => this.cb.onSpellButton(key)
      spells.append(b)
      this.spellBtns.set(key, { root: b, mask, txt })
    }
    const towers = el('div', 'eld-towers')
    for (const kind of TOWER_ORDER) {
      const def = TOWERS[kind]
      const b = el('div', 'eld-tower pe')
      const gem = el('div', 'gem')
      gem.style.background = `linear-gradient(160deg, ${hex(def.color)}, ${hex(def.accent)})`
      gem.style.color = hex(def.color)
      const nm = el('div', 'tn', def.name)
      const cost = el('div', 'tc', '$0')
      const tt = el('div', 'tt', def.damageType.slice(0, 4).toUpperCase() + (def.element ? ' · ' + def.element[0] : ''))
      const lock = el('div', 'lock', '🔒')
      lock.style.display = 'none'
      b.append(gem, nm, cost, tt, lock)
      b.onclick = () => this.cb.onTowerButton(kind)
      towers.append(b)
      this.towerBtns.set(kind, { root: b, cost, lock })
    }
    // hero bar sits between the global spells and the towers (built lazily once the
    // party is known). Empty → CSS hides it, so a no-hero run looks unchanged.
    this.heroRow = el('div', 'eld-heroes pe')
    dock.append(spells, this.heroRow, towers)
    this.root.append(dock)

    // synergy panel (element team bonuses) — hidden until a synergy is active
    this.synPanel = el('div', 'eld-syn hidden')
    this.synPanel.append(el('div', 'syn-h', 'SYNERGIES'))
    this.synList = el('div', 'syn-list')
    this.synPanel.append(this.synList)
    this.root.append(this.synPanel)

    // fx layer
    this.fxLayer = el('div', 'eld-fx')
    this.root.append(this.fxLayer)

    document.body.appendChild(this.root)
  }

  private iconDiv(t: string): HTMLElement {
    const d = el('span', 'ico', t)
    return d
  }

  setLevelName(name: string): void {
    const l = this.root.querySelector('#eld-levelname')
    if (l) l.textContent = name.toUpperCase()
  }

  // ------------------------------------------------------------- per-frame
  update(sim: Sim, ctx: HudContext): void {
    // animated gold counter (+ a pop when a meaningful chunk lands)
    if (sim.gold !== this.lastGoldTarget) {
      if (sim.gold >= this.lastGoldTarget + 8 && this.lastGoldTarget >= 0) this.popClass(this.goldStat, 'pop', 320)
      this.lastGoldTarget = sim.gold
    }
    this.displayGold += (sim.gold - this.displayGold) * 0.25
    if (Math.abs(this.displayGold - sim.gold) < 0.6) this.displayGold = sim.gold
    this.goldVal.textContent = String(Math.round(this.displayGold))
    // lives: shake + flash red when the base takes a hit
    if (this.lastLives >= 0 && sim.lives < this.lastLives) this.popClass(this.lifeStat, 'hurt', 450)
    this.lastLives = sim.lives
    this.livesVal.textContent = String(sim.lives)
    this.waveVal.textContent = ctx.endless
      ? `WAVE ${sim.waveIndex + 1} ∞`
      : `WAVE ${Math.min(sim.waveIndex + 1, ctx.totalWaves)}/${ctx.totalWaves}`

    // combo readout
    if (sim.comboCount >= 2) {
      this.comboEl.textContent = `COMBO ×${sim.comboCount}  ·  ${sim.comboMult.toFixed(2)}×`
      this.comboEl.style.color = hex(comboColor(sim.comboCount))
      this.comboEl.classList.add('show')
    } else {
      this.comboEl.classList.remove('show')
    }

    // start button + telegraph (prep only)
    if (sim.state === 'prep') {
      const secs = Math.max(0, Math.ceil(sim.prepTimer))
      this.startBtn.textContent = `START ▶  (${secs})`
      this.startBtn.classList.remove('hidden')
      const tg = sim.waveTelegraph()
      const elemPart = tg.element ? ` · ${tg.element}` : ''
      this.telegraphEl.textContent = `${tg.boss ? '☠ BOSS · ' : 'INCOMING: '}${tg.armor}${elemPart}`
      this.telegraphEl.classList.remove('hidden')
    } else {
      this.startBtn.classList.add('hidden')
      this.telegraphEl.classList.add('hidden')
    }

    // tower buttons
    for (const kind of TOWER_ORDER) {
      const ref = this.towerBtns.get(kind)!
      const unlocked = ctx.towerUnlocked(kind)
      const cost = sim.placeCost(kind)
      const afford = sim.gold >= cost
      ref.cost.textContent = unlocked ? `$${cost}` : ''
      ref.lock.style.display = unlocked ? 'none' : 'grid'
      const def = TOWERS[kind]
      ref.root.style.borderColor = ctx.buildKind === kind ? hex(def.color) : '#444'
      ref.root.classList.toggle('sel', ctx.buildKind === kind)
      const dim = !unlocked || !afford
      if (this.lastAfford.get(kind) !== !dim) {
        ref.root.classList.toggle('dim', dim)
        this.lastAfford.set(kind, !dim)
      }
    }

    // spell cooldown rings
    for (const key of SPELL_ORDER) {
      const ref = this.spellBtns.get(key)!
      const cd = sim.spellCd[key]
      const maxCd = sim.spellMaxCd[key]
      if (cd > 0 && maxCd > 0) {
        const frac = Math.max(0, Math.min(1, cd / maxCd))
        const deg = frac * 360
        ref.mask.style.background = `conic-gradient(rgba(6,4,16,.78) ${deg}deg, transparent ${deg}deg)`
        ref.txt.textContent = String(Math.ceil(cd))
        ref.root.classList.remove('ready')
        this.spellWasReady.set(key, false)
      } else {
        ref.mask.style.background = 'transparent'
        ref.root.classList.add('ready')
        if (this.spellWasReady.get(key) === false) this.popClass(ref.root, 'ping', 550)
        this.spellWasReady.set(key, true)
      }
    }

    this.updateHeroBar(sim, ctx)
    this.updateSynergy(sim)
  }

  // ------------------------------------------------------------- hero bar + synergy
  private buildHeroBar(sim: Sim): void {
    for (const entry of sim.partyLoadout()) {
      const def = entry.def
      const b = el('div', 'eld-hero pe')
      const lvl = el('div', 'hlvl', 'L' + entry.level)
      const port = el('div', 'hport')
      port.style.background = `linear-gradient(160deg, ${hex(def.color)}, ${hex(def.accent)})`
      port.style.borderColor = hex(RARITY_COLOR[def.rarity])
      port.style.color = hex(def.color)
      port.append(el('span', 'hglyph', def.glyph))
      const mask = el('div', 'hcd')
      const cdtxt = el('div', 'hcdtxt', '')
      port.append(mask, cdtxt)
      const badge = el('div', 'hbadge', `$${entry.cost}`)
      badge.style.color = '#ffe27a'
      const name = el('div', 'hname', def.name)
      b.append(lvl, port, badge, name)
      b.onclick = () => this.cb.onHeroButton(entry.heroId)
      this.heroRow.append(b)
      this.heroBtns.set(entry.heroId, { root: b, port, lvl, mask, cdtxt, badge })
    }
    this.heroBarBuilt = true
  }

  private updateHeroBar(sim: Sim, ctx: HudContext): void {
    if (!this.heroBarBuilt) this.buildHeroBar(sim)
    if (this.heroBtns.size === 0) return
    const deployed = new Map<string, SimHero>()
    for (const h of sim.deployedHeroes()) deployed.set(h.heroId, h)
    for (const entry of sim.partyLoadout()) {
      const ref = this.heroBtns.get(entry.heroId)
      if (!ref) continue
      const h = deployed.get(entry.heroId)
      if (h) {
        // fielded → the button becomes an ability icon with a cooldown ring
        const cd = h.spellCd
        const maxCd = h.spellMaxCd
        if (cd > 0 && maxCd > 0) {
          const deg = Math.max(0, Math.min(1, cd / maxCd)) * 360
          ref.mask.style.background = `conic-gradient(rgba(6,4,16,.8) ${deg}deg, transparent ${deg}deg)`
          ref.cdtxt.textContent = String(Math.ceil(cd))
          ref.root.classList.remove('ready')
          ref.badge.textContent = h.spell.glyph
          this.heroWasReady.set(entry.heroId, false)
        } else {
          ref.mask.style.background = 'transparent'
          ref.cdtxt.textContent = ''
          ref.root.classList.add('ready')
          if (this.heroWasReady.get(entry.heroId) === false) this.popClass(ref.root, 'ping', 550)
          this.heroWasReady.set(entry.heroId, true)
          ref.badge.textContent = `${h.spell.glyph} CAST`
        }
        ref.badge.style.color = hex(entry.def.color)
        ref.port.style.borderColor = hex(entry.def.color)
        ref.root.classList.remove('dim', 'sel')
      } else {
        ref.mask.style.background = 'transparent'
        ref.cdtxt.textContent = ''
        ref.root.classList.remove('ready')
        ref.badge.textContent = `$${entry.cost}`
        ref.badge.style.color = '#ffe27a'
        ref.port.style.borderColor = hex(RARITY_COLOR[entry.def.rarity])
        ref.root.classList.toggle('dim', sim.gold < entry.cost)
        ref.root.classList.toggle('sel', ctx.buildHeroId === entry.heroId)
      }
    }
  }

  private updateSynergy(sim: Sim): void {
    const bonuses = sim.activeSynergies()
    const key = bonuses.map((b) => b.id).join(',')
    if (key === this.lastSynKey) return
    this.lastSynKey = key
    this.synList.innerHTML = ''
    if (bonuses.length === 0) { this.synPanel.classList.add('hidden'); return }
    this.synPanel.classList.remove('hidden')
    for (const b of bonuses) {
      const chip = el('div', 'syn-chip')
      chip.style.borderColor = hex(b.color)
      chip.style.color = hex(b.color)
      chip.append(el('span', 'si', b.icon))
      const st = el('div', 'st')
      st.append(el('div', 'sn', b.name), el('div', 'sd', b.desc))
      chip.append(st)
      this.synList.append(chip)
    }
  }

  // ------------------------------------------------------------- upgrade panel
  showUpgrade(sim: Sim, id: number): void {
    this.hideUpgrade()
    const t = sim.towerById(id)
    if (!t) return
    const def = t.def
    const wrap = el('div', 'eld-upg pe')
    wrap.style.borderColor = hex(def.color)
    wrap.style.boxShadow = `0 12px 34px rgba(0,0,0,.55), 0 0 22px ${hex(def.color)}55`

    const row1 = el('div', 'row1')
    const tierName = sim.isMax(t) ? def.branches[t.branch].name : `Lv ${t.level + 1}`
    row1.append(el('div', 'tt', `${def.name} · ${tierName}`), el('div', 'stars', starStr(sim.powerTier(t))))
    const cur = sim.stats(t)
    const typeLine = `${def.damageType}${def.element ? ' · ' + def.element : ''}`
    const dpsLine = def.support ? `BUFF +${Math.round(((cur as { buffDamage?: number }).buffDamage ?? 0) * 100)}%` : `DPS ${Math.round(sim.effDps(t))}`
    const stat = el('div', 'stat', `${dpsLine}   ·   RNG ${(sim.effRange(t) / 80).toFixed(1)}   ·   ${typeLine}`)

    const domKind = dominantWaveKind(sim)
    const evsm = sim.effectivenessVs(t, domKind)
    const arrow = evsm.eff === 'strong' ? '↑↑' : evsm.eff === 'weak' ? '↓↓' : '→'
    const evColor = evsm.eff === 'strong' ? '#8dff4a' : evsm.eff === 'weak' ? '#ff8a8a' : '#d8d0ff'
    const evs = el('div', 'evs', `vs ${ENEMIES[domKind].name} (${evsm.eff}): ${arrow} ${evsm.mult.toFixed(2)}×`)
    evs.style.color = evColor

    const close = el('button', 'close pe', '✕')
    close.onclick = () => this.cb.onSelectDeselect()

    const ctl = el('div', 'ctl')
    const tgt = el('button', 'tgt pe', `🎯 ${t.targeting}`)
    tgt.onclick = () => { this.cb.onTargeting(t.id); this.showUpgrade(sim, id) }
    ctl.append(tgt)

    if (t.level < 2) {
      const cost = sim.upgradeCostFor(t) ?? 0
      const afford = sim.gold >= cost
      const up = el('button', 'up pe' + (afford ? '' : ' no'), `UPGRADE  $${cost}`)
      up.onclick = () => this.cb.onUpgrade(t.id)
      ctl.append(up)
    } else if (t.level === 2) {
      const br = el('div', 'branches')
      def.branches.forEach((b, idx) => {
        const cost = sim.branchCostFor(t, idx) ?? 0
        const afford = sim.gold >= cost
        const btn = el('button', 'br pe' + (afford ? '' : ' no'))
        btn.style.background = `linear-gradient(180deg, ${hex(def.color)}, ${hex(def.accent)})`
        btn.append(el('span', undefined, b.name), el('span', 'bc', `$${cost}`))
        btn.onclick = () => this.cb.onBranch(t.id, idx)
        br.append(btn)
      })
      ctl.append(br)
    } else {
      ctl.append(el('div', 'maxlbl', 'MAX ★'))
    }

    wrap.append(close, row1, stat, evs, ctl)
    this.root.append(wrap)
    this.upgradeEl = wrap
  }

  hideUpgrade(): void {
    this.upgradeEl?.remove()
    this.upgradeEl = null
  }

  // ------------------------------------------------------------- draft
  showDraft(sim: Sim): void {
    this.clearOverlay()
    const ov = el('div', 'eld-ov pe')
    ov.append(el('h1', undefined, 'CHOOSE A POWER'))
    const h1 = ov.querySelector('h1') as HTMLElement
    h1.style.color = '#c06bff'
    ov.append(el('div', 'sub', 'Pick 1 of 3 — lasts the whole run'))
    const cards = el('div', 'eld-cards')
    sim.draftOffer.forEach((card, i) => {
      const c = el('div', 'eld-card')
      c.style.borderColor = hex(card.color)
      c.style.animationDelay = `${i * 0.08}s`
      const gem = el('div', 'gem')
      gem.style.background = `radial-gradient(circle at 38% 32%, #fff, ${hex(card.color)})`
      gem.style.color = hex(card.color)
      const rar = el('div', 'rar', card.rarity.toUpperCase())
      rar.style.color = card.rarity === 'relic' ? '#ff8aff' : card.rarity === 'rare' ? '#8fe9ff' : '#c9b6ff'
      c.append(gem, rar, el('div', 'nm', card.title), el('div', 'ds', card.desc))
      const pk = el('div', 'pk', 'PICK')
      pk.style.color = hex(card.color)
      c.append(pk)
      c.onclick = () => this.cb.onDraft(i)
      cards.append(c)
    })
    ov.append(cards)
    this.root.append(ov)
    this.overlayEl = ov
  }

  hideDraft(): void { this.clearOverlay() }

  // ------------------------------------------------------------- result
  showResult(opts: { win: boolean; title: string; color: number; stars: number; coins: number; diamonds: number; shards?: number; unlocked: string | null; sub?: string; endless: boolean }): void {
    this.clearOverlay()
    this.startBtn.classList.add('hidden')
    const ov = el('div', 'eld-ov pe')
    const h1 = el('h1', undefined, opts.title)
    h1.style.color = hex(opts.color)
    ov.append(h1)
    if (opts.win && !opts.endless) {
      const s = el('div', 'eld-stars')
      for (let i = 0; i < 3; i++) {
        const star = el('span', 'st', i < opts.stars ? '★' : '☆')
        star.style.animationDelay = `${0.35 + i * 0.22}s`
        if (i >= opts.stars) star.style.color = '#6a5da0'
        s.append(star)
      }
      s.style.color = '#ffd54a'
      ov.append(s)
    } else if (opts.sub) {
      ov.append(el('div', 'sub', opts.sub))
    }
    const rewards = el('div', 'eld-rewards')
    const lines: string[] = []
    if (opts.coins > 0) lines.push(`+${opts.coins} 🪙`)
    if (opts.diamonds > 0) lines.push(`+${opts.diamonds} 💎`)
    if (opts.shards && opts.shards > 0) lines.push(`+${opts.shards} 🔹`)
    rewards.innerHTML = lines.join('<br>')
    if (lines.length) ov.append(rewards)
    if (opts.unlocked) {
      const u = el('div', 'sub', `NEW TOWER: ${opts.unlocked}!`)
      u.style.color = '#c06bff'
      u.style.fontWeight = '900'
      ov.append(u)
    }
    const row = el('div', 'eld-btnrow')
    const replay = el('button', 'eld-btn purple', 'REPLAY')
    replay.onclick = () => this.cb.onReplay()
    const back = el('button', 'eld-btn green', opts.endless ? 'MENU' : 'WORLD MAP')
    back.onclick = () => this.cb.onBack()
    row.append(replay, back)
    ov.append(row)
    this.root.append(ov)
    this.overlayEl = ov
  }

  // ------------------------------------------------------------- pause
  showPause(endless: boolean): void {
    this.clearOverlay()
    const ov = el('div', 'eld-ov pe')
    ov.append(el('h1', undefined, 'PAUSED'))
    const resume = el('button', 'eld-btn green', 'RESUME')
    resume.onclick = () => this.cb.onPause()
    const quit = el('button', 'eld-btn red', endless ? 'RETIRE & BANK' : 'QUIT TO MAP')
    quit.onclick = () => this.cb.onQuit()
    const row = el('div', 'eld-btnrow')
    row.append(resume, quit)
    ov.append(row)
    this.root.append(ov)
    this.overlayEl = ov
  }

  hidePause(): void { this.clearOverlay() }
  private clearOverlay(): void { this.overlayEl?.remove(); this.overlayEl = null }

  setPauseIcon(paused: boolean): void { this.pauseBtn.textContent = paused ? '▶' : '❚❚' }
  setSpeed(speed: number): void { this.speedBtn.textContent = `${speed}×` }

  // ------------------------------------------------------------- floating fx
  // restartable one-shot CSS animation (reflow flush re-arms the keyframes)
  private popClass(target: HTMLElement, cls: string, ms: number): void {
    target.classList.remove(cls)
    void target.offsetWidth
    target.classList.add(cls)
    window.setTimeout(() => target.classList.remove(cls), ms)
  }

  floatText(x: number, y: number, msg: string, color: number, size: number, combo = false): void {
    const d = el('div', 'eld-float', msg)
    d.style.left = `${x}px`
    d.style.top = `${y}px`
    d.style.fontSize = `${size}px`
    d.style.color = hex(color)
    d.style.setProperty('--dx', `${Math.round((Math.random() - 0.5) * 56)}px`)
    d.style.animation = `${combo ? 'eldcombo' : 'eldfloat'} ${combo ? 1 : 0.9}s ease-out forwards`
    this.fxLayer.append(d)
    window.setTimeout(() => d.remove(), combo ? 1050 : 950)
  }

  // coins burst from a kill and arc into the gold counter, popping it on arrival
  coinBurst(x: number, y: number, amount: number): void {
    const n = Math.max(2, Math.min(6, 2 + Math.floor(amount / 6)))
    const rect = this.goldStat.getBoundingClientRect()
    const tx = rect.left + rect.width * 0.5
    const ty = rect.top + rect.height * 0.5
    for (let i = 0; i < n; i++) {
      const c = el('div', 'eld-coin')
      c.style.left = '0'
      c.style.top = '0'
      this.fxLayer.append(c)
      const midX = x + (Math.random() - 0.5) * 110
      const midY = y - 46 - Math.random() * 60
      const anim = c.animate(
        [
          { transform: `translate(${x - 8}px, ${y - 8}px) scale(.3)`, opacity: '1' },
          { transform: `translate(${midX - 8}px, ${midY - 8}px) scale(1)`, opacity: '1', offset: 0.32 },
          { transform: `translate(${tx - 8}px, ${ty - 8}px) scale(.45)`, opacity: '.95' },
        ],
        { duration: 480 + i * 65 + Math.random() * 90, easing: 'cubic-bezier(.45,.05,.55,.95)', fill: 'forwards' },
      )
      anim.onfinish = () => {
        c.remove()
        this.popClass(this.goldStat, 'pop', 320)
      }
    }
  }

  waveBanner(msg: string): void {
    const d = el('div', 'eld-wavebanner', msg)
    this.fxLayer.append(d)
    window.setTimeout(() => d.remove(), 1750)
  }

  flash(color: number, alpha = 0.45, dur = 240): void {
    const d = el('div', 'eld-float')
    d.style.cssText = `position:absolute;inset:0;transform:none;background:${hex(color)};opacity:${alpha};transition:opacity ${dur}ms ease-out;`
    this.fxLayer.append(d)
    // next frame → fade to 0
    requestAnimationFrame(() => { d.style.opacity = '0' })
    window.setTimeout(() => d.remove(), dur + 60)
  }

  banner(msg: string, color: number): void {
    const d = el('div', 'eld-banner', msg)
    d.style.color = hex(color)
    this.fxLayer.append(d)
    window.setTimeout(() => d.remove(), 1650)
  }

  dispose(): void {
    this.hideUpgrade()
    this.clearOverlay()
    this.root.remove()
    this.styleEl.remove()
  }
}

// ---- helpers (view-only) ----
function starStr(n: number): string { return '★'.repeat(n) + '☆'.repeat(5 - n) }
function comboColor(count: number): number {
  const t = Math.min(1, count * 0.08)
  // gold → magenta ramp
  const r = 255
  const g = Math.round(213 - t * 120)
  const b = Math.round(74 + t * 160)
  return (r << 16) | (g << 8) | b
}
function dominantWaveKind(sim: Sim): EnemyKind {
  const wave = sim.currentWave()
  let best: EnemyKind = 'runner'
  let max = -1
  for (const entry of wave.entries) if (entry.count > max) { max = entry.count; best = entry.kind }
  return best
}
