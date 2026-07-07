// BattleHud — a clean, modern HTML/CSS overlay that sits on top of the 3D battle
// canvas. It renders NO game logic: it reads the sim's public state each frame and
// forwards taps back through callbacks. The root is pointer-events:none so board
// taps fall through to the canvas; only real controls opt back in (.pe).

import type { Sim, SimHero } from '../sim'
import { GRID, WHEEL, DAMAGE_TYPES, REACTIONS, type ArmorType, type DamageType, type Element, type ReactionKey } from '../sim'
import { TOWERS, TOWER_ORDER, type TowerBranch, type TowerKind } from '../game/towers'
import { SPELLS, SPELL_ORDER, type SpellKey } from '../game/spells'
import { ENEMIES, type EnemyKind } from '../game/enemies'
import { RARITY_COLOR } from '../game/heroes'
import { heroStats, heroSpellScaled, signatureAwake, SIGNATURE_UNLOCK_LEVEL } from '../game/heroProgress'
import { resonanceInfo } from '../game/resonance'
import { attachTip, dismissTip, type TipContent, type TipRow } from './tooltip'
import { renderShareCard, shareCard, downloadCard, copyText, type ShareCardOpts } from './ShareCard'
import { playUiTick } from './sfx'
import { battleSfx } from './battleSfx'

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
  onFuse(id: number, partnerId: number): void // forge a fusion tower with an adjacent max tower
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
.eld-hud, .eld-hud * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; -webkit-touch-callout: none;
  font-family: 'Baloo 2','Nunito',system-ui,'Segoe UI',Arial,sans-serif; }
.eld-hud .pe { touch-action: manipulation; }
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
.eld-tower .tc.no { color:#ff8a8a; }
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
.eld-upg .br .bb { font-size:10px; font-weight:700; opacity:.85; }
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
/* CRIT (strong-hit) numbers: leap higher, land bigger, glow in their own colour */
.eld-float.crit { text-shadow:0 2px 3px rgba(0,0,0,.7), 0 0 16px currentColor; }
@keyframes eldcrit { 0%{ transform:translate(-50%,-50%) scale(.2) rotate(-5deg);}
  16%{ transform:translate(-50%,-128%) scale(1.55) rotate(3deg);}
  32%{ transform:translate(-50%,-108%) scale(1.1) rotate(0deg);}
  100%{ transform:translate(calc(-50% + var(--dx)),-215%) scale(1); opacity:0; } }
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

/* one-time "the UI can explain itself" hint (first battle only) */
.eld-hint { position:absolute; top:150px; left:50%; transform:translateX(-50%) translateY(-6px);
  padding:8px 18px; border-radius:999px; background:rgba(16,10,32,.92); border:1px solid rgba(255,255,255,.18);
  box-shadow:0 8px 22px rgba(0,0,0,.5); font-size:12.5px; font-weight:700; letter-spacing:.04em; color:#d9cff5;
  white-space:nowrap; opacity:0; transition:opacity .5s ease, transform .5s ease; pointer-events:none; z-index:22; }
.eld-hint.show { opacity:1; transform:translateX(-50%) translateY(0); }

/* ---- KEEPER BOSS BAR: name, phase pips, HP + shield, cast telegraph pulse ---- */
.eld-boss { position:absolute; top:44px; left:50%; transform:translateX(-50%); z-index:21; width:min(430px, 86vw);
  padding:7px 12px 9px; border-radius:14px; background:linear-gradient(180deg, rgba(24,16,44,.92), rgba(14,8,30,.92));
  border:1px solid var(--bossc, #c9b6ff); box-shadow:0 6px 22px rgba(0,0,0,.5), 0 0 16px color-mix(in srgb, var(--bossc, #c9b6ff) 22%, transparent);
  opacity:0; transition:opacity .35s ease, transform .35s ease; pointer-events:auto; }
.eld-boss.show { opacity:1; }
.eld-boss.echo { border-style:dashed; filter:saturate(.55); }
.eld-boss .bn { display:flex; align-items:baseline; gap:8px; }
.eld-boss .bname { flex:1 1 auto; font-size:12.5px; font-weight:900; letter-spacing:.14em; color:var(--bossc, #c9b6ff);
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; text-shadow:0 1px 2px rgba(0,0,0,.6); }
.eld-boss .bphase { flex:0 0 auto; display:flex; gap:4px; }
.eld-boss .bphase i { width:8px; height:8px; border-radius:50%; background:rgba(255,255,255,.16); border:1px solid rgba(255,255,255,.3); }
.eld-boss .bphase i.on { background:var(--bossacc, #ffe14a); box-shadow:0 0 6px var(--bossacc, #ffe14a); border-color:transparent; }
.eld-boss .bbar { position:relative; margin-top:5px; height:12px; border-radius:7px; overflow:hidden;
  background:rgba(255,255,255,.09); border:1px solid rgba(0,0,0,.5); }
.eld-boss .bhp { position:absolute; inset:0; transform-origin:left; background:linear-gradient(180deg, #ff7a9c, #d92a58);
  transition:transform .18s ease-out; }
.eld-boss .bsh { position:absolute; inset:0; transform-origin:left; background:linear-gradient(180deg, rgba(159,220,255,.85), rgba(90,150,220,.85));
  transition:transform .18s ease-out; }
.eld-boss .babl { margin-top:4px; display:flex; align-items:center; gap:7px; font-size:10.5px; font-weight:800;
  letter-spacing:.1em; color:#bdaede; }
.eld-boss .bcast { flex:1 1 auto; height:5px; border-radius:3px; overflow:hidden; background:rgba(255,255,255,.09); }
.eld-boss .bcast i { display:block; height:100%; transform-origin:left; background:var(--bossacc, #ffe14a); }
.eld-boss.warn { animation: eldbosswarn .6s ease-in-out infinite; }
@keyframes eldbosswarn { 0%,100%{ box-shadow:0 6px 22px rgba(0,0,0,.5), 0 0 14px color-mix(in srgb, var(--bossacc, #ffe14a) 30%, transparent); }
  50%{ box-shadow:0 6px 22px rgba(0,0,0,.5), 0 0 30px color-mix(in srgb, var(--bossacc, #ffe14a) 75%, transparent); } }
.eld-hud.attract .eld-boss { display:none !important; }

/* Morose intrusion veil: the world's edges drain grey for a beat */
.eld-morose { position:absolute; inset:0; pointer-events:none; z-index:29; opacity:0;
  background: radial-gradient(115% 95% at 50% 45%, transparent 42%, rgba(128,124,146,.52) 100%);
  transition: opacity .5s ease; }
.eld-morose.on { opacity:1; }

/* flying coins (world kill → gold counter) */
.eld-coin { position:absolute; width:16px; height:16px; border-radius:50%; z-index:31; pointer-events:none;
  background:radial-gradient(circle at 35% 30%, #fff2b0, #ffd54a 60%, #c89600); box-shadow:0 0 8px rgba(255,213,74,.9); }

/* ELEMENTAL REACTION callout: Balatro-style slam — huge, overshoots in, wobbles, punches out */
.eld-react { position:absolute; left:50%; top:27%; z-index:32; pointer-events:none; font-weight:900;
  font-size: clamp(36px, 10vw, 62px); letter-spacing:3px; white-space:nowrap; text-align:center;
  transform:translate(-50%,-50%);
  text-shadow: 0 4px 0 rgba(0,0,0,.5), 0 0 34px currentColor, 0 0 10px currentColor;
  animation: eldreact 1s cubic-bezier(.16,1.5,.3,1) forwards; }
.eld-react .rx-sub { display:block; font-size:13px; letter-spacing:7px; margin-top:2px; color:#fff;
  opacity:.85; text-shadow:0 2px 4px rgba(0,0,0,.6); }
@keyframes eldreact {
  0%   { opacity:0; transform:translate(-50%,-50%) scale(2.8) rotate(-7deg); }
  16%  { opacity:1; transform:translate(-50%,-50%) scale(.94) rotate(2.5deg); }
  28%  { transform:translate(-50%,-50%) scale(1.14) rotate(-1.5deg); }
  40%  { transform:translate(-50%,-50%) scale(1) rotate(0deg); }
  80%  { opacity:1; }
  100% { opacity:0; transform:translate(-50%,-58%) scale(.9); }
}
`

// Growth-infra additions: attract-mode chrome hiding + the prove-it share card.
const CSS_SHARE = `
/* ATTRACT / DEMO REEL: hide every interactive control; keep the juice
   (fx layer, banners, reaction callouts, barks live outside these). */
.eld-hud.attract .eld-top, .eld-hud.attract .eld-levelname, .eld-hud.attract .eld-rc,
.eld-hud.attract .eld-start, .eld-hud.attract .eld-dock, .eld-hud.attract .eld-syn,
.eld-hud.attract .eld-telegraph, .eld-hud.attract .eld-hint, .eld-hud.attract .eld-combo {
  display: none !important;
}
.eld-ov { overflow-y: auto; }
.eld-sharecard { width: min(88vw, 430px); height: auto; border-radius: 14px;
  box-shadow: 0 10px 40px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.1); }
.eld-btn.blue { background: linear-gradient(180deg,#3f9be8,#1d62b8); }
.eld-btn.slim { padding: 10px 22px; font-size: 16px; }

/* DEATH TEACHES: one specific, actionable lesson on the defeat screen */
.eld-lesson { max-width: min(88vw, 430px); padding: 12px 18px; border-radius: 14px; text-align: left;
  background: linear-gradient(180deg, rgba(52,36,96,.95), rgba(30,18,60,.95));
  border: 1px solid rgba(196,166,255,.5); box-shadow: 0 8px 24px rgba(0,0,0,.45);
  display: flex; gap: 10px; align-items: flex-start; }
.eld-lesson .li { font-size: 22px; flex: 0 0 auto; }
.eld-lesson .lt { display: flex; flex-direction: column; gap: 2px; }
.eld-lesson .lh { font-size: 11px; font-weight: 900; letter-spacing: 2px; color: #c9b6ff; }
.eld-lesson .lb { font-size: 14.5px; font-weight: 700; line-height: 1.35; color: #f0eaff; }
.eld-retrynote { font-size: 12.5px; font-weight: 700; color: #9d8fc5; margin-top: -6px; }
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
  // Keeper boss bar (name · phase pips · HP+shield · next-cast meter)
  private bossEl!: HTMLElement
  private bossNameEl!: HTMLElement
  private bossPips: HTMLElement[] = []
  private bossHpEl!: HTMLElement
  private bossShEl!: HTMLElement
  private bossAblEl!: HTMLElement
  private bossCastEl!: HTMLElement
  private bossShown = false
  private bossKey = ''
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

  // live refs so tooltip providers always read current numbers
  private simRef: Sim | null = null
  private ctxRef: HudContext | null = null
  private hintEl: HTMLElement
  private hintDone = false

  // motion-pass state: detect transitions so we ping/pop exactly once
  private goldStat!: HTMLElement
  private lifeStat!: HTMLElement
  private lastLives = -1
  private spellWasReady = new Map<SpellKey, boolean>()
  private heroWasReady = new Map<string, boolean>()

  constructor(cb: HudCallbacks) {
    this.cb = cb
    this.styleEl = el('style')
    this.styleEl.textContent = CSS + CSS_SHARE
    document.head.appendChild(this.styleEl)

    this.root = el('div', 'eld-hud')

    // top bar
    const top = el('div', 'eld-top')
    const gold = el('div', 'eld-stat eld-gold pe')
    gold.append(this.iconDiv('$'), (this.goldVal = el('span', 'val', '0')))
    const life = el('div', 'eld-stat eld-life pe')
    life.append(this.iconDiv('♥'), (this.livesVal = el('span', 'val', '0')))
    const wave = el('div', 'eld-stat eld-wave pe')
    wave.append((this.waveVal = el('span', 'val', 'WAVE 1')))
    top.append(gold, life, wave)
    this.goldStat = gold
    this.lifeStat = life
    this.root.append(top)
    attachTip(gold, () => ({
      tag: 'RESOURCE',
      title: 'Battle Gold',
      accent: '#ffe27a',
      body: 'Earned from kills, wave clears and early starts. Spend it on towers, upgrades and hero deploys — it resets every battle.',
      foot: 'Fast kill streaks raise a combo multiplier that pays bonus gold.',
    }))
    attachTip(life, () => ({
      tag: 'RESOURCE',
      title: 'Lives',
      accent: '#ff8fa5',
      body: 'Every enemy that slips through steals a life. Lose them all and the level falls to the Greying.',
      rows: this.simRef ? [{ k: 'Remaining', v: String(this.simRef.lives) }] : undefined,
    }))
    attachTip(wave, () => {
      const sim = this.simRef
      const ctx = this.ctxRef
      if (!sim || !ctx) return { title: 'Waves', accent: '#a8e9ff' }
      return {
        tag: ctx.endless ? 'ENDLESS' : 'CAMPAIGN',
        title: ctx.endless ? `Wave ${sim.waveIndex + 1} — no end in sight` : `Wave ${Math.min(sim.waveIndex + 1, ctx.totalWaves)} of ${ctx.totalWaves}`,
        accent: '#a8e9ff',
        body: ctx.endless
          ? 'Survive as long as you can. Waves scale forever; banked rewards grow with every clear.'
          : 'Clear every wave to reclaim this level. During prep, the incoming banner tells you what to build against.',
      }
    })

    const levelName = el('div', 'eld-levelname')
    levelName.id = 'eld-levelname'
    this.root.append(levelName)

    this.comboEl = el('div', 'eld-combo')
    this.telegraphEl = el('div', 'eld-telegraph hidden pe')
    this.root.append(this.comboEl, this.telegraphEl)
    attachTip(this.telegraphEl, () => this.telegraphTip())

    // Keeper boss bar — hidden until a Corrupted Keeper takes the field
    this.bossEl = el('div', 'eld-boss')
    const bossTop = el('div', 'bn')
    this.bossNameEl = el('div', 'bname')
    const bossPhase = el('div', 'bphase')
    for (let i = 0; i < 3; i++) {
      const pip = document.createElement('i')
      bossPhase.append(pip)
      this.bossPips.push(pip)
    }
    bossTop.append(this.bossNameEl, bossPhase)
    const bossBar = el('div', 'bbar')
    this.bossShEl = el('div', 'bsh')
    this.bossHpEl = el('div', 'bhp')
    bossBar.append(this.bossHpEl, this.bossShEl)
    const bossAbl = el('div', 'babl')
    this.bossAblEl = el('div')
    const bossCast = el('div', 'bcast')
    this.bossCastEl = document.createElement('i')
    bossCast.append(this.bossCastEl)
    bossAbl.append(this.bossAblEl, bossCast)
    this.bossEl.append(bossTop, bossBar, bossAbl)
    this.root.append(this.bossEl)
    attachTip(this.bossEl, () => this.bossTip())

    // right controls
    const rc = el('div', 'eld-rc')
    this.pauseBtn = el('button', 'pe', '❚❚')
    this.pauseBtn.onclick = () => { playUiTick(); this.cb.onPause() }
    this.speedBtn = el('button', 'pe', '1×')
    this.speedBtn.onclick = () => { playUiTick(); this.cb.onSpeed() }
    rc.append(this.pauseBtn, this.speedBtn)
    this.root.append(rc)
    attachTip(this.pauseBtn, () => ({
      tag: 'CONTROL', title: 'Pause', accent: '#c9b6ff',
      body: 'Freeze the battle and take a breath. Nothing moves until you resume.',
    }))
    attachTip(this.speedBtn, () => ({
      tag: 'CONTROL', title: 'Battle speed', accent: '#c9b6ff',
      body: 'Toggle between 1× and 2×. The simulation stays exact at both speeds — only time flows faster.',
    }))

    // start
    this.startBtn = el('button', 'eld-start pe', 'START ▶')
    this.startBtn.onclick = () => { playUiTick(); this.cb.onStart() }
    this.root.append(this.startBtn)
    attachTip(this.startBtn, () => ({
      tag: 'PREP PHASE', title: 'Start the wave', accent: '#3ad07a',
      body: 'Send the wave in early and pocket +2 gold for every second left on the clock. Build first, then cash in the courage.',
    }))

    // one-time discoverability hint (the tooltip layer IS the manual)
    this.hintEl = el('div', 'eld-hint')
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
    this.hintEl.textContent = coarse ? '💡 Long-press anything to inspect it' : '💡 Hover anything to inspect it'
    this.root.append(this.hintEl)
    try { this.hintDone = localStorage.getItem('chromancer_tip_hint_v1') === '1' } catch { this.hintDone = true }

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
      b.onclick = () => { playUiTick(); this.cb.onSpellButton(key) }
      spells.append(b)
      this.spellBtns.set(key, { root: b, mask, txt })
      attachTip(b, () => this.spellTip(key))
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
      b.onclick = () => { playUiTick(); this.cb.onTowerButton(kind) }
      towers.append(b)
      this.towerBtns.set(kind, { root: b, cost, lock })
      attachTip(b, () => this.towerTip(kind))
    }
    // hero bar sits between the global spells and the towers (built lazily once the
    // party is known). Empty → CSS hides it, so a no-hero run looks unchanged.
    this.heroRow = el('div', 'eld-heroes pe')
    dock.append(spells, this.heroRow, towers)
    this.root.append(dock)

    // synergy panel (element team bonuses) — hidden until a synergy is active
    this.synPanel = el('div', 'eld-syn hidden')
    const synHead = el('div', 'syn-h pe', 'SYNERGIES')
    attachTip(synHead, () => ({
      tag: 'TEAM BONUS', title: 'Element synergies', accent: '#c9b6ff',
      body: 'Field heroes and towers that share an element to awaken team-wide bonuses. They stay active while the element stays on the board.',
    }))
    this.synPanel.append(synHead)
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

  // ---- coach anchors (onboarding points/rings these; view-only, never logic) ----
  towerButtonEl(kind: TowerKind): HTMLElement | null {
    return this.towerBtns.get(kind)?.root ?? null
  }
  startButtonEl(): HTMLElement {
    return this.startBtn
  }
  heroButtonEl(heroId: string): HTMLElement | null {
    return this.heroBtns.get(heroId)?.root ?? null
  }
  upgradePanelEl(): HTMLElement | null {
    return this.upgradeEl
  }

  // ------------------------------------------------------------- per-frame
  update(sim: Sim, ctx: HudContext): void {
    this.simRef = sim
    this.ctxRef = ctx
    // first battle only: point at the tooltip layer once, then never nag again
    if (!this.hintDone && sim.state === 'prep' && sim.waveIndex === 0) {
      this.hintDone = true
      try { localStorage.setItem('chromancer_tip_hint_v1', '1') } catch { /* private mode */ }
      window.setTimeout(() => this.hintEl.classList.add('show'), 1600)
      window.setTimeout(() => this.hintEl.classList.remove('show'), 8200)
    }
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
      this.telegraphEl.textContent = tg.keeperName
        ? `☠ ${tg.keeperName}`
        : `${tg.boss ? '☠ BOSS · ' : 'INCOMING: '}${tg.armor}${elemPart}`
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
      ref.cost.classList.toggle('no', unlocked && !afford)
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
    this.updateBossBar(sim)
  }

  // ---- Keeper boss bar --------------------------------------------------
  private updateBossBar(sim: Sim): void {
    const bs = sim.bossStatus()
    if (!bs) {
      if (this.bossShown) {
        this.bossShown = false
        this.bossKey = ''
        this.bossEl.classList.remove('show', 'warn')
      }
      return
    }
    if (!this.bossShown) {
      this.bossShown = true
      this.bossEl.classList.add('show')
    }
    const key = bs.keeperId + (bs.echo ? ':echo' : '')
    if (this.bossKey !== key) {
      this.bossKey = key
      this.bossNameEl.textContent = bs.name
      this.bossAblEl.textContent = `⚠ ${bs.abilityName}`
      this.bossEl.style.setProperty('--bossc', hex(bs.accent))
      this.bossEl.style.setProperty('--bossacc', hex(bs.accent))
      this.bossEl.classList.toggle('echo', bs.echo)
    }
    for (let i = 0; i < this.bossPips.length; i++) this.bossPips[i].classList.toggle('on', i < bs.phase)
    const hpFrac = Math.max(0, Math.min(1, bs.hp / Math.max(1, bs.maxHp)))
    const shFrac = Math.max(0, Math.min(1, bs.shield / Math.max(1, bs.maxHp)))
    this.bossHpEl.style.transform = `scaleX(${hpFrac.toFixed(4)})`
    this.bossShEl.style.transform = `scaleX(${shFrac.toFixed(4)})`
    const castFrac = Math.max(0, Math.min(1, 1 - bs.castIn / Math.max(0.1, bs.castEvery)))
    this.bossCastEl.style.transform = `scaleX(${castFrac.toFixed(4)})`
    this.bossEl.classList.toggle('warn', bs.telegraphing)
  }

  private bossTip(): TipContent | null {
    const bs = this.simRef?.bossStatus()
    if (!bs) return null
    return {
      tag: bs.echo ? 'FINAL GAUNTLET · ECHO' : 'CORRUPTED KEEPER',
      title: bs.name,
      accent: hex(bs.accent),
      body: bs.twist,
      rows: [
        { k: 'Phase', v: `${bs.phase} / ${bs.phases}`, c: '#ffe14a' },
        { k: 'Next cast', v: `${Math.ceil(bs.castIn)}s · ${bs.abilityName}`, c: '#ff8fa5' },
      ],
      foot: 'Keepers are not slain — break the grey and they come home in colour.',
    }
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
      b.onclick = () => { playUiTick(); this.cb.onHeroButton(entry.heroId) }
      this.heroRow.append(b)
      this.heroBtns.set(entry.heroId, { root: b, port, lvl, mask, cdtxt, badge })
      attachTip(b, () => this.heroTip(entry.heroId))
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
    const resonances = sim.activeResonances()
    const key = bonuses.map((b) => b.id).join(',') + '|' + resonances.map((r) => r.id + r.count).join(',')
    if (key === this.lastSynKey) return
    this.lastSynKey = key
    this.synList.innerHTML = ''
    if (bonuses.length === 0 && resonances.length === 0) { this.synPanel.classList.add('hidden'); return }
    this.synPanel.classList.remove('hidden')
    for (const b of bonuses) {
      const chip = el('div', 'syn-chip pe')
      chip.style.borderColor = hex(b.color)
      chip.style.color = hex(b.color)
      chip.append(el('span', 'si', b.icon))
      const st = el('div', 'st')
      st.append(el('div', 'sn', b.name), el('div', 'sd', b.desc))
      chip.append(st)
      this.synList.append(chip)
      attachTip(chip, () => ({
        tag: 'ACTIVE SYNERGY', title: b.name, accent: hex(b.color), body: b.desc,
        foot: 'Awakened by fielding allies that share an element. It fades if they leave the board.',
      }))
    }
    // ELEMENT RESONANCE chips (hero ↔ tower bonds)
    for (const r of resonances) {
      const chip = el('div', 'syn-chip pe')
      chip.style.borderColor = hex(r.color)
      chip.style.color = hex(r.color)
      chip.append(el('span', 'si', r.icon))
      const st = el('div', 'st')
      st.append(el('div', 'sn', r.name), el('div', 'sd', r.desc))
      chip.append(st)
      this.synList.append(chip)
      attachTip(chip, () => ({
        tag: 'ELEMENT RESONANCE', title: r.name, accent: hex(r.color),
        body: `${r.heroNames.join(' & ')} resonates with your ${r.count} ${r.towerName} towers — ${r.desc}.`,
        foot: r.tier === 1 ? `Build ${4 - r.count} more ${r.towerName} tower${4 - r.count === 1 ? '' : 's'} for tier II.` : 'Tier II — fully resonant.',
      }))
    }
  }

  // ------------------------------------------------------------- tooltip content
  // Providers run at show-time and read simRef, so every number is live.

  private towerTip(kind: TowerKind): TipContent {
    const def = TOWERS[kind]
    const unlocked = this.ctxRef?.towerUnlocked(kind) ?? true
    const cost = this.simRef ? this.simRef.placeCost(kind) : def.cost
    const l0 = def.levels[0]
    const rows: TipRow[] = []
    if (def.support) rows.push({ k: 'Aura', v: `+${Math.round((l0.buffDamage ?? 0) * 100)}% dmg to neighbours`, c: '#c9b6ff' })
    rows.push(
      { k: 'Damage', v: String(l0.damage) },
      { k: 'Rate', v: rateStr(l0.cooldown) },
      { k: 'Range', v: `${l0.range} tiles` },
      { k: 'DPS', v: `~${Math.round(l0.damage / l0.cooldown)}` },
    )
    const sw = gridCounters(def.damageType)
    rows.push({ k: 'Strong vs', v: sw.strong.join(', ') || '—', c: '#8dff4a' })
    rows.push({ k: 'Weak vs', v: sw.weak.join(', ') || '—', c: '#ff8a8a' })
    if (def.antiAir) rows.push({ k: 'Air', v: 'hits flyers', c: '#9ad0ff' })
    if (def.status) rows.push({ k: 'Applies', v: def.status.toUpperCase(), c: '#4ad9ff' })
    return {
      tag: `TOWER · ${def.damageType.toUpperCase()}${def.element ? ' · ' + def.element.toUpperCase() : ''}`,
      title: unlocked ? `${def.name} — $${cost}` : `${def.name} — locked`,
      accent: hex(def.color),
      body: unlocked ? def.blurb : 'Sealed for now. Clear more of the campaign to unlock it.',
      rows,
      foot: `At Lv3 it chooses a path: ${def.branches[0].name} (${def.branches[0].blurb.toLowerCase()}) or ${def.branches[1].name} (${def.branches[1].blurb.toLowerCase()}).`,
    }
  }

  private spellTip(key: SpellKey): TipContent {
    const def = SPELLS[key]
    const sim = this.simRef
    const rows: TipRow[] = []
    if (def.damage) rows.push({ k: 'Damage', v: String(def.damage) })
    if (def.radius) rows.push({ k: 'Radius', v: `${def.radius} tiles` })
    if (def.burnDps) rows.push({ k: 'Burn', v: `${def.burnDps}/s · ${def.burnDuration}s`, c: '#ff9a5c' })
    if (def.stunDuration) rows.push({ k: 'Stun', v: `${def.stunDuration}s all enemies`, c: '#6bd6ff' })
    if (def.gold) rows.push({ k: 'Gold', v: `+${def.gold} instantly`, c: '#ffe27a' })
    rows.push({ k: 'Cooldown', v: `${Math.round(sim ? sim.spellMaxCd[key] : def.cooldown)}s` })
    const left = sim ? sim.spellCd[key] : 0
    if (left > 0) rows.push({ k: 'Ready in', v: `${Math.ceil(left)}s`, c: '#9d8fc5' })
    return {
      tag: def.targeted ? 'SPELL · TAP TO AIM' : 'SPELL · INSTANT',
      title: def.name,
      accent: hex(def.color),
      body: def.blurb,
      rows,
    }
  }

  private heroTip(heroId: string): TipContent | null {
    const sim = this.simRef
    if (!sim) return null
    const entry = sim.partyLoadout().find((e) => e.heroId === heroId)
    if (!entry) return null
    const def = entry.def
    const st = heroStats(def, entry.level)
    const sp = heroSpellScaled(def.spell, entry.level)
    const fielded = sim.deployedHeroes().find((h) => h.heroId === heroId)
    const rows: TipRow[] = [
      { k: 'Damage', v: String(Math.round(st.damage)) },
      { k: 'Rate', v: rateStr(st.cooldown) },
      { k: 'Range', v: `${def.range} tiles` },
    ]
    if (st.buffDamage > 0) rows.push({ k: 'Aura', v: `+${Math.round(st.buffDamage * 100)}% dmg nearby`, c: '#c9b6ff' })
    if (def.slowFactor) rows.push({ k: 'Chill', v: `${Math.round((1 - def.slowFactor) * 100)}% slow · ${def.slowDuration ?? 0}s`, c: '#6bd6ff' })
    const bits: string[] = []
    if (sp.damage) bits.push(`${Math.round(sp.damage)} dmg`)
    if (sp.radius) bits.push(`${sp.radius} tiles`)
    if (sp.stunDuration) bits.push(`${sp.stunDuration}s stun`)
    if (sp.burnDps) bits.push(`${Math.round(sp.burnDps)}/s burn`)
    if (sp.heal) bits.push(`+${sp.heal} lives`)
    if (sp.chainCount) bits.push(`chains ×${sp.chainCount}`)
    if (sp.buffMult) bits.push(`×${sp.buffMult} hero dmg`)
    if (sp.executeMult) bits.push(`×${sp.executeMult} vs weakened`)
    rows.push({ k: `✦ ${sp.name}`, v: bits.join(' · ') || sp.blurb, c: hex(def.color) })
    // SIGNATURE — the hero's one-of-a-kind mechanic (awakens at Lv 3)
    const sig = def.signature
    const awake = signatureAwake(entry.level)
    rows.push({
      k: `${sig.glyph} ${sig.name}`,
      v: awake ? sig.blurb : `dormant — awakens at Lv ${SIGNATURE_UNLOCK_LEVEL}`,
      c: awake ? hex(def.color) : '#9d8fc5',
    })
    // RESONANCE — hero + 2/4+ towers of their resonant kind
    const res = sim.activeResonances().find((r) => r.heroIds.includes(heroId))
    const rInfo = resonanceInfo(def.resonantTower)
    rows.push(
      res
        ? { k: '🔗 Resonance', v: `${res.name} · ${res.desc}`, c: '#8dff4a' }
        : { k: '🔗 Resonance', v: awake ? `build 2+ ${rInfo.towerName} towers to awaken` : `needs Lv ${SIGNATURE_UNLOCK_LEVEL} + 2 ${rInfo.towerName} towers`, c: '#9d8fc5' },
    )
    rows.push(
      fielded
        ? fielded.spellCd > 0
          ? { k: 'Status', v: `fielded · spell in ${Math.ceil(fielded.spellCd)}s`, c: '#9d8fc5' }
          : { k: 'Status', v: 'spell READY — tap to cast', c: '#8dff4a' }
        : { k: 'Deploy', v: `$${entry.cost} · tap, then tap a tile`, c: '#ffe27a' },
    )
    return {
      tag: `HERO · ${def.element.toUpperCase()} · ${def.role.toUpperCase()} · ${def.rarity.toUpperCase()}`,
      title: `${def.name} ${def.title} · L${entry.level}`,
      accent: hex(def.color),
      body: def.blurb,
      rows,
      foot: awake ? sig.detail : sp.blurb,
    }
  }

  private telegraphTip(): TipContent | null {
    const sim = this.simRef
    if (!sim || sim.state !== 'prep') return null
    const tg = sim.waveTelegraph()
    const armor = tg.armor as ArmorType
    const rows: TipRow[] = DAMAGE_TYPES.map((dt) => {
      const m = GRID[dt]?.[armor] ?? 1
      return { k: dt, v: `×${m}`, c: m >= 1.25 ? '#8dff4a' : m <= 0.75 ? '#ff8a8a' : '#d8d0ff' }
    })
    let foot: string | undefined
    if (tg.element) {
      const counters = (Object.keys(WHEEL) as Element[]).filter((e) => WHEEL[e].strong.includes(tg.element!))
      foot = `${tg.element} foes take 1.5× from ${counters.join(' & ')} attacks — and 0.75× from what they resist.`
    }
    return {
      tag: tg.boss ? 'INCOMING · ☠ BOSS WAVE' : 'INCOMING WAVE',
      title: `${tg.armor} armor${tg.element ? ' · ' + tg.element : ''}`,
      accent: tg.boss ? '#ff8fa5' : '#a8e9ff',
      body: 'Damage-type multipliers against this wave. Build toward the green.',
      rows,
      foot,
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
    const tierName = t.fusedElem !== '' ? `⚛ ${t.fusionName}` : sim.isMax(t) ? def.branches[t.branch].name : `Lv ${t.level + 1}`
    row1.append(el('div', 'tt', `${def.name} · ${tierName}`), el('div', 'stars', starStr(sim.powerTier(t))))
    const stars = row1.querySelector('.stars') as HTMLElement
    stars.classList.add('pe')
    attachTip(stars, () => {
      const tt = this.simRef?.towerById(id)
      if (!tt || !this.simRef) return null
      return {
        tag: 'POWER TIER', title: `${starStr(this.simRef.powerTier(tt))}`, accent: '#ffd54a',
        body: 'A rough strength rating from this tower’s live DPS, buffs included. More stars, more hurt.',
        rows: [{ k: 'Live DPS', v: String(Math.round(this.simRef.effDps(tt))) }],
      }
    })
    const cur = sim.stats(t)
    const typeLine = t.fusedElem !== ''
      ? `${def.damageType} · ${TOWER_AURA_LABEL[t.kind] ?? def.element ?? ''}+${t.fusedElem}`
      : `${def.damageType}${def.element ? ' · ' + def.element : ''}`
    const dpsLine = def.support ? `BUFF +${Math.round(((cur as { buffDamage?: number }).buffDamage ?? 0) * 100)}%` : `DPS ${Math.round(sim.effDps(t))}`
    const stat = el('div', 'stat pe', `${dpsLine}   ·   RNG ${(sim.effRange(t) / 80).toFixed(1)}   ·   ${typeLine}`)
    attachTip(stat, () => {
      const tt = this.simRef?.towerById(id)
      if (!tt || !this.simRef) return null
      const s = this.simRef.stats(tt)
      const sw = gridCounters(s.damageType ?? def.damageType)
      return {
        tag: 'LIVE STATS', title: `${def.name} right now`, accent: hex(def.color),
        body: def.support
          ? 'This is a support tower: its aura multiplies the damage of every neighbouring tower and hero.'
          : 'Effective numbers after upgrades, Arcane auras and run powers.',
        rows: [
          { k: 'DPS', v: String(Math.round(this.simRef.effDps(tt))) },
          { k: 'Range', v: `${(this.simRef.effRange(tt) / 80).toFixed(1)} tiles` },
          { k: 'Rate', v: rateStr(s.cooldown) },
          { k: 'Strong vs', v: sw.strong.join(', ') || '—', c: '#8dff4a' },
          { k: 'Weak vs', v: sw.weak.join(', ') || '—', c: '#ff8a8a' },
        ],
      }
    })

    const domKind = dominantWaveKind(sim)
    const evsm = sim.effectivenessVs(t, domKind)
    const arrow = evsm.eff === 'strong' ? '↑↑' : evsm.eff === 'weak' ? '↓↓' : '→'
    const evColor = evsm.eff === 'strong' ? '#8dff4a' : evsm.eff === 'weak' ? '#ff8a8a' : '#d8d0ff'
    const evs = el('div', 'evs pe', `vs ${ENEMIES[domKind].name} (${evsm.eff}): ${arrow} ${evsm.mult.toFixed(2)}×`)
    evs.style.color = evColor
    attachTip(evs, () => ({
      tag: 'COUNTER FORECAST', title: `vs ${ENEMIES[domKind].name}`, accent: evColor,
      body: 'Your damage multiplier against the most common enemy in the incoming wave: damage type vs armor, times the element wheel.',
      foot: 'There is no immunity — even a weak matchup always deals at least half damage.',
    }))

    const close = el('button', 'close pe', '✕')
    close.onclick = () => this.cb.onSelectDeselect()

    const ctl = el('div', 'ctl')
    const tgt = el('button', 'tgt pe', `🎯 ${t.targeting}`)
    tgt.onclick = () => { this.cb.onTargeting(t.id); this.showUpgrade(sim, id) }
    attachTip(tgt, () => {
      const tt = this.simRef?.towerById(id)
      const mode = tt?.targeting ?? t.targeting
      return {
        tag: 'TARGETING', title: `Priority: ${mode}`, accent: '#a8e9ff',
        rows: [
          { k: 'First', v: 'furthest along the path', c: mode === 'First' ? '#8dff4a' : undefined },
          { k: 'Last', v: 'newest arrival', c: mode === 'Last' ? '#8dff4a' : undefined },
          { k: 'Close', v: 'nearest to this tower', c: mode === 'Close' ? '#8dff4a' : undefined },
          { k: 'Strong', v: 'highest health', c: mode === 'Strong' ? '#8dff4a' : undefined },
          { k: 'Weak', v: 'lowest health — finishes kills', c: mode === 'Weak' ? '#8dff4a' : undefined },
          { k: 'Primed', v: 'primed for a reaction with THIS tower', c: mode === 'Primed' ? '#8dff4a' : undefined },
        ],
        foot: 'Tap to cycle. Snipers love Strong; slows love First; reaction builds live on Primed.',
      }
    })
    ctl.append(tgt)

    if (t.level < 2) {
      const cost = sim.upgradeCostFor(t) ?? 0
      const afford = sim.gold >= cost
      const up = el('button', 'up pe' + (afford ? '' : ' no'), `UPGRADE  $${cost}`)
      up.onclick = () => this.cb.onUpgrade(t.id)
      attachTip(up, () => {
        const tt = this.simRef?.towerById(id)
        if (!tt || tt.level >= 2) return null
        const a = def.levels[tt.level]
        const b = def.levels[tt.level + 1]
        return {
          tag: 'UPGRADE PREVIEW', title: `Lv ${tt.level + 1} → Lv ${tt.level + 2}`, accent: hex(def.color),
          rows: [
            { k: 'Damage', v: `${a.damage} → ${b.damage}`, c: '#8dff4a' },
            { k: 'Range', v: `${a.range} → ${b.range} tiles` },
            { k: 'Rate', v: `${rateStr(a.cooldown)} → ${rateStr(b.cooldown)}` },
            { k: 'Cost', v: `$${this.simRef?.upgradeCostFor(tt) ?? b.upgradeCost}`, c: '#ffe27a' },
          ],
        }
      })
      ctl.append(up)
    } else if (t.level === 2) {
      const br = el('div', 'branches')
      def.branches.forEach((b, idx) => {
        const cost = sim.branchCostFor(t, idx) ?? 0
        const afford = sim.gold >= cost
        const btn = el('button', 'br pe' + (afford ? '' : ' no'))
        btn.style.background = `linear-gradient(180deg, ${hex(def.color)}, ${hex(def.accent)})`
        btn.append(el('span', undefined, b.name), el('span', 'bb', b.blurb), el('span', 'bc', `$${cost}`))
        btn.onclick = () => this.cb.onBranch(t.id, idx)
        attachTip(btn, () => branchTip(def.name, b, cost, hex(def.color)))
        br.append(btn)
      })
      ctl.append(br)
    } else if (t.fusedElem !== '') {
      const fused = el('div', 'maxlbl pe', `⚛ ${t.fusionName.toUpperCase()}`)
      fused.style.color = hex(t.fusedColor)
      attachTip(fused, () => {
        const tt = this.simRef?.towerById(id)
        if (!tt || tt.fusedElem === '') return null
        const r = this.simRef?.fusionReaction(tt)
        return {
          tag: 'FUSION TOWER', title: tt.fusionName, accent: hex(tt.fusedColor),
          body: `Two towers forged into one. Every volley alternates elements (${TOWER_AURA_LABEL[tt.kind] ?? '?'} ⇄ ${tt.fusedElem}), so it primes AND detonates ${r?.name ?? 'its reaction'} entirely on its own.`,
          rows: [
            { k: 'Reaction', v: r?.name ?? '—', c: r ? hex(r.color) : undefined },
            { k: 'Effect', v: FUSE_EFFECT[tt.fusionKey as ReactionKey] ?? '', c: '#8dff4a' },
            { k: 'Power', v: '+75% damage · +15% range', c: '#ffd54a' },
          ],
          foot: 'The absorbed tower\'s tile was freed — fusion consolidates your board.',
        }
      })
      ctl.append(fused)
    } else {
      const opts = sim.fusionOptions(t)
      if (opts.length > 0) {
        const br = el('div', 'branches')
        for (const o of opts.slice(0, 2)) {
          const afford = sim.gold >= o.cost
          const btn = el('button', 'br pe' + (afford ? '' : ' no'))
          btn.style.background = `linear-gradient(180deg, ${hex(o.color)}, ${hex(o.color2)}66), linear-gradient(180deg, ${hex(def.color)}, ${hex(def.accent)})`
          btn.append(
            el('span', undefined, `⚛ FUSE → ${o.name}`),
            el('span', 'bb', `absorb ${o.partner.def.name} · solo ${REACTIONS[o.key].name}`),
            el('span', 'bc', `$${o.cost}`),
          )
          const pid = o.partner.id
          btn.onclick = () => this.cb.onFuse(t.id, pid)
          attachTip(btn, () => ({
            tag: 'FORGE A FUSION TOWER', title: o.name, accent: hex(o.color),
            body: `Absorbs the adjacent ${o.partner.def.name} (its tile is FREED). This tower keeps its ${sim.isMax(t) ? def.branches[t.branch].name : def.name} behaviour, hits +75% harder, sees +15% further — and alternates both elements every volley, detonating ${REACTIONS[o.key].name} all by itself.`,
            rows: [
              { k: 'Reaction', v: REACTIONS[o.key].name, c: hex(o.color) },
              { k: 'Effect', v: FUSE_EFFECT[o.key], c: '#8dff4a' },
              { k: 'Cost', v: `$${o.cost}`, c: '#ffe27a' },
            ],
            foot: 'Choose the host wisely — the fused tower keeps the HOST\'s attack style.',
          }))
          br.append(btn)
        }
        ctl.append(br)
      } else {
        const max = el('div', 'maxlbl pe', 'MAX ★')
        attachTip(max, () => ({
          tag: 'FULLY UPGRADED', title: 'MAX — but not the end', accent: '#ffd54a',
          body: 'Build ANOTHER max-tier tower of a reactive element on an adjacent tile and a ⚛ FUSE option appears here.',
          rows: [
            { k: 'Flame + Frost', v: 'Thermal Core', c: '#ffb15c' },
            { k: 'Frost + Storm', v: 'Shatterspire', c: '#9fdcff' },
            { k: 'Flame + Storm', v: 'Flashover Crown', c: '#ff6a3c' },
            { k: 'Arcane + any', v: 'Prism Nexus', c: '#d6a6ff' },
          ],
          foot: 'A fusion tower detonates its elemental reaction entirely on its own.',
        }))
        ctl.append(max)
      }
    }

    wrap.append(close, row1, stat, evs, ctl)
    this.root.append(wrap)
    this.upgradeEl = wrap
  }

  hideUpgrade(): void {
    if (this.upgradeEl) dismissTip() // the tooltip's anchor is about to vanish
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
      attachTip(c, () => ({
        tag: `${card.rarity.toUpperCase()} POWER`,
        title: card.title,
        accent: hex(card.color),
        body: card.desc,
        foot: 'Drafted powers last the whole run and stack with everything else. Rarer means stronger.',
      }))
      cards.append(c)
    })
    ov.append(cards)
    this.root.append(ov)
    this.overlayEl = ov
  }

  hideDraft(): void { this.clearOverlay() }

  /** Attract/demo-reel mode: hide all interactive chrome (fx + overlays stay). */
  setAttract(on: boolean): void {
    this.root.classList.toggle('attract', on)
  }

  // ------------------------------------------------------------- result
  showResult(opts: {
    win: boolean; title: string; color: number; stars: number; coins: number; diamonds: number;
    shards?: number; unlocked: string | null; sub?: string; endless: boolean;
    share?: ShareCardOpts // prove-it card + seed-link buttons
    lesson?: string // death-teaches: one actionable line, defeat screens only
    continueLabel?: string // demo: "CONTINUE INTO THE FULL GAME"
    onContinue?: () => void
  }): void {
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
    // DEATH TEACHES — Maddervane turns the loss into one concrete move
    if (opts.lesson) {
      const box = el('div', 'eld-lesson')
      const lt = el('div', 'lt')
      lt.append(el('div', 'lh', "MADDERVANE'S LESSON"), el('div', 'lb', opts.lesson))
      box.append(el('div', 'li', '🖌️'), lt)
      ov.append(box)
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
    // PROVE-IT share card: the run's receipt, rendered client-side, one tap to share
    if (opts.share) {
      const share = opts.share
      const canvas = renderShareCard(share)
      canvas.className = 'eld-sharecard'
      ov.append(canvas)
      const srow = el('div', 'eld-btnrow')
      const sh = el('button', 'eld-btn blue slim', '📤 SHARE')
      sh.onclick = async () => {
        if (!(await shareCard(canvas, share))) {
          downloadCard(canvas, share.code)
          this.banner('CARD SAVED — paste it anywhere', 0x9ee8ff)
        }
      }
      const cp = el('button', 'eld-btn purple slim', '🔗 COPY SEED LINK')
      cp.onclick = async () => {
        const ok = await copyText(share.link)
        cp.textContent = ok ? '✓ LINK COPIED' : '✗ COPY FAILED'
        window.setTimeout(() => { cp.textContent = '🔗 COPY SEED LINK' }, 1600)
      }
      const dl = el('button', 'eld-btn purple slim', '⬇')
      dl.title = 'Download the card'
      dl.onclick = () => downloadCard(canvas, share.code)
      srow.append(sh, cp, dl)
      ov.append(srow)
    }
    if (!opts.win) ov.append(el('div', 'eld-retrynote', 'Retry replays the SAME waves — same seed, no surprises.'))
    const row = el('div', 'eld-btnrow')
    const replay = el('button', 'eld-btn purple', opts.win ? 'REPLAY' : '↻ RETRY')
    replay.onclick = () => this.cb.onReplay()
    row.append(replay)
    if (opts.onContinue) {
      const cont = el('button', 'eld-btn green', opts.continueLabel ?? 'CONTINUE →')
      cont.onclick = () => opts.onContinue?.()
      row.append(cont)
    } else {
      const back = el('button', 'eld-btn green', opts.endless ? 'MENU' : 'WORLD MAP')
      back.onclick = () => this.cb.onBack()
      row.append(back)
    }
    ov.append(row)
    this.root.append(ov)
    this.overlayEl = ov
  }

  // ------------------------------------------------------------- pause
  showPause(endless: boolean, share?: { code: string; link: string }): void {
    this.clearOverlay()
    const ov = el('div', 'eld-ov pe')
    ov.append(el('h1', undefined, 'PAUSED'))
    if (share) {
      const sub = el('div', 'sub', `Seed ${share.code} — every run is replayable`)
      ov.append(sub)
    }
    const resume = el('button', 'eld-btn green', 'RESUME')
    resume.onclick = () => this.cb.onPause()
    const quit = el('button', 'eld-btn red', endless ? 'RETIRE & BANK' : 'QUIT TO MAP')
    quit.onclick = () => this.cb.onQuit()
    const row = el('div', 'eld-btnrow')
    row.append(resume, quit)
    ov.append(row)
    if (share) {
      const srow = el('div', 'eld-btnrow')
      const cp = el('button', 'eld-btn purple slim', '🔗 COPY SEED LINK')
      cp.onclick = async () => {
        const ok = await copyText(share.link)
        cp.textContent = ok ? '✓ LINK COPIED' : '✗ COPY FAILED'
        window.setTimeout(() => { cp.textContent = '🔗 COPY SEED LINK' }, 1600)
      }
      srow.append(cp)
      ov.append(srow)
    }
    this.root.append(ov)
    this.overlayEl = ov
  }

  hidePause(): void { this.clearOverlay() }
  private clearOverlay(): void {
    if (this.overlayEl) dismissTip()
    this.overlayEl?.remove()
    this.overlayEl = null
  }

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

  floatText(x: number, y: number, msg: string, color: number, size: number, style: 'norm' | 'combo' | 'crit' = 'norm'): void {
    const d = el('div', 'eld-float' + (style === 'crit' ? ' crit' : ''), msg)
    d.style.left = `${x}px`
    d.style.top = `${y}px`
    d.style.fontSize = `${size}px`
    d.style.color = hex(color)
    d.style.setProperty('--dx', `${Math.round((Math.random() - 0.5) * 56)}px`)
    const anim = style === 'combo' ? 'eldcombo' : style === 'crit' ? 'eldcrit' : 'eldfloat'
    const dur = style === 'norm' ? 0.9 : 1
    d.style.animation = `${anim} ${dur}s ease-out forwards`
    this.fxLayer.append(d)
    window.setTimeout(() => d.remove(), dur * 1000 + 60)
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
        battleSfx.coin(i) // staggered finishes → a natural rising arpeggio
      }
    }
  }

  waveBanner(msg: string): void {
    const d = el('div', 'eld-wavebanner', msg)
    this.fxLayer.append(d)
    window.setTimeout(() => d.remove(), 1750)
  }

  // ELEMENTAL REACTION slam. Single element reused so back-to-back reactions
  // replace (restart) the callout instead of stacking a wall of text.
  private reactEl: HTMLElement | null = null
  reactionCallout(name: string, color: number): void {
    this.reactEl?.remove()
    const d = el('div', 'eld-react', name)
    d.style.color = hex(color)
    d.append(el('span', 'rx-sub', 'ELEMENTAL REACTION'))
    this.fxLayer.append(d)
    this.reactEl = d
    window.setTimeout(() => { if (this.reactEl === d) this.reactEl = null; d.remove() }, 1050)
  }

  // Morose intrusion: a grey vignette breathes in and back out (telegraph + landing)
  private moroseEl: HTMLElement | null = null
  moroseVeil(seconds: number): void {
    if (!this.moroseEl) {
      this.moroseEl = el('div', 'eld-morose')
      this.fxLayer.append(this.moroseEl)
    }
    const d = this.moroseEl
    d.classList.remove('on')
    void d.offsetWidth
    d.classList.add('on')
    window.setTimeout(() => d.classList.remove('on'), Math.max(400, seconds * 1000))
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
    dismissTip()
    this.hideUpgrade()
    this.clearOverlay()
    this.root.remove()
    this.styleEl.remove()
  }
}

// ---- helpers (view-only) ----
// Aura each tower paints (mirror of the sim's TOWER_AURA, labels for the panel).
const TOWER_AURA_LABEL: Partial<Record<TowerKind, string>> = {
  flame: 'Fire', frost: 'Water', storm: 'Storm', arcane: 'Arcane',
}
// One-line effect summary per reaction (fusion panel legibility).
const FUSE_EFFECT: Record<ReactionKey, string> = {
  thermal: 'armor break + burst',
  shatter: 'burst · ×2 vs armored',
  flashover: 'AoE explosion',
  wildfire: 'burn spreads to the pack',
  overgrow: 'heavy area root',
  eclipse: 'brief area stun',
  conduct: 'bonus chain arcs',
  blight: 'poison DoT area',
  amplify: '+25% damage taken mark',
}
function starStr(n: number): string { return '★'.repeat(n) + '☆'.repeat(5 - n) }
function rateStr(cooldown: number): string {
  return `${(1 / Math.max(0.05, cooldown)).toFixed(1)}/s`
}
// Which armor types a damage type counters / struggles against (from the grid).
function gridCounters(dt: DamageType): { strong: string[]; weak: string[] } {
  const row = GRID[dt]
  const strong: string[] = []
  const weak: string[] = []
  for (const [armor, mult] of Object.entries(row)) {
    if (mult >= 1.25) strong.push(armor)
    else if (mult <= 0.75) weak.push(armor)
  }
  return { strong, weak }
}
function branchTip(towerName: string, b: TowerBranch, cost: number, accent: string): TipContent {
  const rows: TipRow[] = [
    { k: 'Damage', v: String(b.damage) },
    { k: 'Rate', v: rateStr(b.cooldown) },
    { k: 'Range', v: `${b.range} tiles` },
  ]
  if (b.damageType) rows.push({ k: 'Becomes', v: `${b.damageType} damage`, c: '#a8e9ff' })
  if (b.splash) rows.push({ k: 'Splash', v: `${b.splash} tiles`, c: '#ff9a5c' })
  if (b.stunDuration) rows.push({ k: 'Stun', v: `${b.stunDuration}s`, c: '#6bd6ff' })
  if (b.slowFactor !== undefined) rows.push({ k: 'Slow', v: `to ${Math.round(b.slowFactor * 100)}% speed`, c: '#6bd6ff' })
  if (b.burnDps) rows.push({ k: 'Burn', v: `${b.burnDps}/s`, c: '#ff9a5c' })
  if (b.zoneDps) rows.push({ k: 'Ground fire', v: `${b.zoneDps}/s · ${b.zoneDuration}s`, c: '#ff9a5c' })
  if (b.seeking) rows.push({ k: 'Shots', v: 'homing — never miss', c: '#ff9a5c' })
  if (b.chainCount !== undefined) rows.push({ k: 'Chains', v: b.chainCount === 0 ? 'no — one huge bolt' : `×${b.chainCount} jumps`, c: '#ffe14a' })
  if (b.buffDamage) rows.push({ k: 'Aura', v: `+${Math.round(b.buffDamage * 100)}% dmg${b.buffReach ? ` · ${b.buffReach}-tile reach` : ''}`, c: '#c9b6ff' })
  if (b.dealsDamage) rows.push({ k: 'Beam', v: 'also attacks while buffing', c: '#c9b6ff' })
  if (b.armorPen) rows.push({ k: 'Armor pen', v: String(b.armorPen), c: '#a8e9ff' })
  rows.push({ k: 'Cost', v: `$${cost}`, c: '#ffe27a' })
  return {
    tag: `${towerName.toUpperCase()} · FINAL FORM`,
    title: b.name,
    accent,
    body: b.blurb,
    rows,
    foot: 'Permanent choice — the other path is sealed for this tower.',
  }
}
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
