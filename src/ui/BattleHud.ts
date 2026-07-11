// BattleHud — a clean, modern HTML/CSS overlay that sits on top of the 3D battle
// canvas. It renders NO game logic: it reads the sim's public state each frame and
// forwards taps back through callbacks. The root is pointer-events:none so board
// taps fall through to the canvas; only real controls opt back in (.pe).

import type { Sim, SimHero } from '../sim'
import { GRID, WHEEL, DAMAGE_TYPES, REACTIONS, type ArmorType, type DamageType, type Element, type ReactionKey, type StatusKind } from '../sim'
import { TOWERS, TOWER_ORDER, type TowerBranch, type TowerKind } from '../game/towers'
import { towerPalette, spellColor, heroDye } from '../game/skins'
import { SPELLS, SPELL_ORDER, type SpellKey } from '../game/spells'
import { ENEMIES, type EnemyKind } from '../game/enemies'
import { RARITY_COLOR } from '../game/heroes'
import { heroArtUrl } from './heroArt'
import { heroStats, heroSpellScaled, signatureAwake, SIGNATURE_UNLOCK_LEVEL } from '../game/heroProgress'
import { resonanceInfo } from '../game/resonance'
import { wyrmBuffsTowers } from '../game/wyrms'
import { glyphIcon, iconMarkup, currencyIcon } from './icons'
import { attachTip, dismissTip, type TipContent, type TipRow } from './tooltip'
import { renderShareCard, shareCard, downloadCard, copyText, type ShareCardOpts } from './ShareCard'
import { playUiTick } from './sfx'
import { appSettings } from './settings'
import { battleSfx } from './battleSfx'
import { ChatFeed } from './ChatFeed'

export interface HudCallbacks {
  onStart(): void
  onPause(): void
  onSpeed(): void
  onResetView(): void // camera "reset view" button in the dock controls
  onTowerButton(kind: TowerKind): void
  onSpellButton(key: SpellKey): void
  onHeroButton(heroId: string): void // deploy a party hero, or cast its spell if fielded
  onSelectDeselect(): void // tap the "close panel" affordance
  // A tap on the upgrade sheet's dead-space (not a button): the sheet floats over
  // the board, so forward the screen point so a tower underneath can be selected
  // directly — swap on the first tap instead of "close panel, then tap tower".
  onBoardTapThrough(clientX: number, clientY: number): void
  onUpgrade(id: number): void
  onBranch(id: number, idx: number): void
  onFuse(id: number, partnerId: number): void // forge a fusion tower with an adjacent max tower
  onTargeting(id: number): void
  onHeroTargeting(slotId: number): void // cycle a fielded hero's focus priority
  onHeroMove(slotId: number): void // arm relocation — next tile tap moves the hero
  onHeroCast(slotId: number): void // cast the selected hero's signature spell
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
function hexA(c: number, a: number): string {
  return `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${a})`
}

// Center-banner priority tiers. Boss beats wave / notifications so a boss moment is
// never overwritten by an incidental banner during the same wave. Reaction callouts
// live on their OWN channel (see reactionCallout) and are not part of this ordering.
export const BANNER_PRIORITY = { wave: 1, notify: 1, boss: 2 } as const

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

/** Like el(), but the content is inline-SVG icon markup (innerHTML, not text). */
function iconEl<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, markup: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  e.className = cls
  e.innerHTML = markup
  return e
}

/** Escape text before it goes next to inline-SVG markup in an innerHTML string. */
function escHud(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
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
.eld-life .ico { background: radial-gradient(circle at 35% 30%, #cdefff, #37c9c1); color:#04323a; }
.eld-life .val { color:#d6f6ff; font-size:18px; }
/* THE PRISM WELLSPRING HP BAR — fill scales with base integrity; hue warms as it fails.
   width clamps with the viewport so the gold+life+wave chips never overflow a 320px
   phone (iPhone SE): caps at 104px on roomy screens, shrinks to 60px when narrow. */
.eld-hpbar { position:relative; width:clamp(60px, 20vw, 104px); height:13px; border-radius:8px; overflow:hidden; flex:0 0 auto;
  background: rgba(8,12,18,.72); border:1px solid rgba(255,255,255,.10); box-shadow: inset 0 1px 3px rgba(0,0,0,.6); }
.eld-hpbar .fill { position:absolute; inset:0; transform-origin:left center; transform:scaleX(1);
  background: linear-gradient(90deg,#2fe0c8,#6fe8ff); box-shadow:0 0 10px #2fe0c8aa;
  transition: transform .35s cubic-bezier(.3,1,.4,1), background .5s ease, box-shadow .5s ease; }
.eld-life.warn .eld-hpbar .fill { background: linear-gradient(90deg,#ffcf4a,#ff9b3c); box-shadow:0 0 10px #ffb347aa; }
.eld-life.crit .eld-hpbar .fill { background: linear-gradient(90deg,#ff5b7a,#ff3b6b); box-shadow:0 0 13px #ff3b6bcc;
  animation: hpcritpulse .9s ease-in-out infinite; }
@keyframes hpcritpulse { 0%,100%{opacity:1} 50%{opacity:.5} }
.eld-wave { margin-left:auto; }
.eld-wave .val { color:#a8e9ff; font-size:18px; }
/* Narrow phones (iPhone SE / small Android): compress the stat chips so the
   gold + life-bar + wave row fits on one line instead of clipping the wave chip. */
@media (max-width: 400px) {
  .eld-top { gap:6px; padding-left:8px; padding-right:8px; }
  .eld-stat { padding:6px 10px; gap:6px; }
  .eld-stat .val { font-size:18px; }
  .eld-life .val { font-size:15px; }
  .eld-wave .val { font-size:15px; }
}
.eld-levelname { position:absolute; top: calc(env(safe-area-inset-top,0px) + 62px); left:14px; font-size:12px; font-weight:700; color:#c9b6ff; opacity:.85; letter-spacing:1px; }

/* combo readout lives IN the top bar (a stat chip) so it can never overlap
   the boss bar / telegraph / anything floating over the board */
.eld-combo { display:none; align-items:center; background:linear-gradient(180deg,var(--panel2),var(--panel));
  border:1px solid var(--stroke); border-radius:16px; padding:8px 12px; font-weight:900; font-size:15px;
  line-height:1; white-space:nowrap; box-shadow:0 4px 14px rgba(0,0,0,.35); font-variant-numeric:tabular-nums;
  /* GROW + GLOW with the multiplier (scale/glow set inline, capped so it never
     overruns the top bar); transition makes the climb read as a living swell */
  transform:scale(var(--cs,1)); transform-origin:center;
  transition:transform .22s cubic-bezier(.2,1.5,.35,1), box-shadow .3s ease, border-color .3s ease; }
.eld-combo.show { display:flex; }
/* milestone pop: a quick punch on the chip every 10 kills, then it settles back —
   the "juice" without a giant repeating center banner */
.eld-combo.pop { animation:eldstatpop .34s cubic-bezier(.2,1.6,.4,1); }

/* telegraph pill — docked in the bottom bar's prep row (never over the board) */
.eld-telegraph { flex:1 1 140px; min-width:0; overflow:hidden; text-overflow:ellipsis;
  background:rgba(20,12,40,.82); border:1px solid var(--stroke); border-radius:12px; padding:8px 14px;
  font-size:13px; font-weight:800; letter-spacing:.5px; white-space:nowrap; box-shadow:0 4px 12px rgba(0,0,0,.4); }
.eld-telegraph.hidden { display:none; }

/* ---- dock control cluster (pause / speed / reset view) ---- */
.eld-rc { display:flex; gap:6px; flex:0 0 auto; }
.eld-rc button { width:44px; height:44px; border-radius:12px; background:linear-gradient(180deg,var(--panel2),var(--panel));
  border:1px solid var(--stroke); font-size:18px; font-weight:800; box-shadow:0 4px 12px rgba(0,0,0,.35); display:grid; place-items:center; }
.eld-rc button:active { transform:scale(.92); }

/* ---- start button (docked in the bottom bar's prep row) ---- */
.eld-start { flex:0 0 auto; margin-left:auto;
  padding:10px 26px; border-radius:16px; font-size:20px; font-weight:900; letter-spacing:1px;
  background:linear-gradient(180deg,#3ad07a,#1f9a54); border:1px solid rgba(255,255,255,.25);
  box-shadow:0 6px 18px rgba(31,154,84,.5), inset 0 1px 0 rgba(255,255,255,.3); animation:eldpulse 1.4s ease-in-out infinite; }
.eld-start:active { transform:scale(.94); }
.eld-start.hidden { display:none; }
@keyframes eldpulse { 0%,100%{ transform:scale(1);} 50%{ transform:scale(1.04);} }

/* ---- bottom dock: FIXED action-bar zone. The container itself stays
   pointer-transparent (board taps pass through the gradient); only the
   buttons opt back in. Rows never overlap anything by construction. ---- */
.eld-dock { position:absolute; left:0; right:0; bottom:0; padding: 10px 10px calc(env(safe-area-inset-bottom,0px) + 12px);
  background:linear-gradient(0deg, rgba(18,10,36,.96), rgba(18,10,36,.7) 70%, rgba(18,10,36,0));
  display:flex; flex-direction:column; gap:8px; }
.eld-dockbar { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.eld-dockbar.hidden { display:none; }
.eld-spellrow { display:flex; align-items:center; gap:8px; }
.eld-spells { display:flex; gap:10px; justify-content:center; flex:1 1 auto; }
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

/* ---- upgrade panel: an EDGE-DOCKED contextual panel, never over the board
   centre. Mobile/portrait: a bottom sheet flush above the action dock (rides
   --dock-h). Wide screens: docked to the right edge below the top bar. ---- */
.eld-upg { position:absolute; left:62px; right:8px; bottom: calc(var(--dock-h, 240px) + 8px); width:auto;
  /* left:62px clears the chat tab's column — the tab stays tappable with the sheet open */
  max-height:38vh; overflow-y:auto; overscroll-behavior:contain; scrollbar-width:thin; z-index:25;
  background:linear-gradient(180deg,#221743,#1a1030); border-radius:18px; padding:12px 14px;
  box-shadow:0 12px 34px rgba(0,0,0,.55); border:2px solid; }
@media (min-width:900px) {
  .eld-upg { left:auto; right:12px; bottom:auto; top: calc(env(safe-area-inset-top,0px) + 78px);
    width:330px; max-height:min(64vh, 540px); }
}
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

/* ---- overlays (draft / result / pause): the MODAL layer. Dim backdrop,
   centered content, sits above every panel and blocks board input. ---- */
/* justify-content uses the "safe" keyword — with overflow-y:auto (added below),
   plain center would push tall content (victory: title + stars + rewards + share
   card + buttons) above scroll-origin on short landscape, clipping the top
   unreachably. safe falls back to flex-start when overflowing so it stays scrollable. */
.eld-ov { position:absolute; inset:0; z-index:40; background:rgba(10,6,22,.72); backdrop-filter:blur(3px);
  display:flex; flex-direction:column; align-items:center; justify-content:safe center; gap:16px;
  padding: calc(env(safe-area-inset-top,0px) + 24px) 24px calc(env(safe-area-inset-bottom,0px) + 24px); text-align:center; }
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
/* generic notify banner → a COMPACT top-center toast in a RESERVED band that clears
   the top bar + boss bar (top ~128px) and never covers the board/heroes/center. */
.eld-banner { position:absolute; left:50%; top: calc(env(safe-area-inset-top,0px) + 128px); transform:translateX(-50%);
  font-size:18px; font-weight:900; letter-spacing:.4px; line-height:1.2; text-align:center;
  max-width:min(90vw,430px); padding:8px 18px; border-radius:13px;
  background:rgba(14,9,30,.9); border:1px solid rgba(255,255,255,.18); box-shadow:0 6px 20px rgba(0,0,0,.5);
  text-shadow:0 2px 4px rgba(0,0,0,.7); animation:eldbanner 1.2s ease-out forwards; }
@keyframes eldbanner { 0%{ opacity:0; transform:translateX(-50%) translateY(-8px) scale(.9);}
  14%{ opacity:1; transform:translateX(-50%) translateY(0) scale(1);}
  82%{ opacity:1;} 100%{ opacity:0; transform:translateX(-50%) translateY(-14px) scale(.98);} }
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
/* bonded Chromatic Wyrm sigil (corner of the hero portrait) */
.eld-hero .hwyrm { position:absolute; bottom:-4px; right:-5px; z-index:3; width:19px; height:19px; border-radius:50%;
  display:grid; place-items:center; font-size:11px; line-height:1; background:#160c2e; border:1.5px solid #fff;
  box-shadow:0 1px 3px rgba(0,0,0,.5); }
.eld-hero .hwyrm.perfect { box-shadow:0 0 6px 1px var(--wc, #fff), 0 1px 3px rgba(0,0,0,.5); }

/* ---- synergy RAIL (active element team bonuses) ----
   A compact rail of buff ICONS docked to the very LEFT edge — it never overlaps
   the board. Collapsed to a small "⚡ N" tab during combat; tap the tab to reveal
   the icons, tap an icon for its full description. Frees the left half of the board. */
.eld-syn { position:absolute; left:0; top: calc(env(safe-area-inset-top,0px) + 100px); display:flex; flex-direction:column;
  gap:4px; z-index:21; align-items:flex-start; max-width:64px; }
.eld-syn.hidden { display:none; }
.eld-syn .syn-tog { display:inline-flex; align-items:center; gap:4px; font-size:10.5px; font-weight:900; letter-spacing:.5px;
  color:#c9b6ff; background:linear-gradient(180deg, rgba(42,30,84,.94), rgba(22,14,46,.94));
  border:1px solid rgba(201,182,255,.42); border-left:none; border-radius:0 11px 11px 0; padding:4px 9px 4px 6px;
  box-shadow:0 2px 9px rgba(0,0,0,.45); cursor:pointer; white-space:nowrap; text-shadow:0 1px 2px #000; }
.eld-syn .syn-tog .cv { font-size:8px; opacity:.8; transition:transform .18s ease; }
.eld-syn.collapsed .syn-tog .cv { transform:rotate(-90deg); }
.eld-syn .syn-rail { display:flex; flex-direction:column; gap:4px; align-items:flex-start; }
.eld-syn.collapsed .syn-rail { display:none; }
.eld-syn .syn-pill { display:flex; align-items:center; gap:3px; border:1px solid; border-left:none; border-radius:0 11px 11px 0;
  padding:3px 7px 3px 5px; background:linear-gradient(180deg, rgba(42,30,84,.94), rgba(22,14,46,.94));
  box-shadow:0 2px 9px rgba(0,0,0,.4); animation:eldsynin .3s cubic-bezier(.2,1.3,.5,1); cursor:pointer; }
.eld-syn .syn-pill .si { font-size:15px; line-height:1; }
.eld-syn .syn-pill .sv { font-size:9px; font-weight:900; line-height:1; opacity:.92; }
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
@keyframes eldpanelin { from { opacity:0; transform:translateY(22px) scale(.96);} to { opacity:1; transform:translateY(0) scale(1);} }
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
/* READY FLASH: the button itself flares bright the instant a spell comes off cooldown —
   an at-a-glance "you can cast NOW" read to match the red-cost unaffordable tell. */
.eld-spell.ping { animation: eldreadyflash .55s ease-out; }
@keyframes eldreadyflash {
  0%   { box-shadow:0 0 0 2px currentColor, 0 0 24px 7px currentColor; filter:brightness(1.75) saturate(1.2); }
  45%  { filter:brightness(1.3) saturate(1.1); }
  100% { box-shadow:0 4px 12px rgba(0,0,0,.4); filter:none; }
}
.eld-hud.reduced .eld-spell.ping { animation:none; }

/* AFFORDABLE tell for the selected-tower panel: the moment your gold meets an
   upgrade / branch / fusion cost the control flares once, then settles into a
   gentle pulsing glow — the exact counterpart to the spell "ready" pulse, so
   "you can act NOW" reads the same everywhere. Re-evaluated every frame, never
   stale. */
.eld-upg .up.can, .eld-upg .br.can { animation: eldaffordpulse 1.5s ease-in-out infinite; }
@keyframes eldaffordpulse {
  0%,100% { box-shadow:0 0 0 1px rgba(255,255,255,.3), 0 0 5px rgba(120,255,170,.4); }
  50%     { box-shadow:0 0 0 1px rgba(255,255,255,.45), 0 0 17px 2px rgba(120,255,170,.78); }
}
.eld-upg .up.affordflash, .eld-upg .br.affordflash { animation: eldaffordflash .58s ease-out; }
@keyframes eldaffordflash {
  0%   { box-shadow:0 0 0 2px #baffcf, 0 0 26px 8px rgba(120,255,170,.95); filter:brightness(1.7) saturate(1.15); }
  45%  { filter:brightness(1.3) saturate(1.08); }
  100% { box-shadow:0 0 0 1px rgba(255,255,255,.3); filter:none; }
}
.eld-hud.reduced .eld-upg .up.can, .eld-hud.reduced .eld-upg .br.can,
.eld-hud.reduced .eld-upg .up.affordflash, .eld-hud.reduced .eld-upg .br.affordflash { animation:none; }

/* wave-clear toast: shares the reserved top-center band with the notify toast
   (the banner queue guarantees only ONE shows at a time). Brief (~1s), never
   parked over the board. */
.eld-wavebanner { position:absolute; left:50%; top: calc(env(safe-area-inset-top,0px) + 128px); transform:translateX(-50%);
  font-size:23px; font-weight:900; letter-spacing:4px; white-space:nowrap; color:#fff; padding:9px 22px; border-radius:14px;
  background:rgba(14,9,30,.9); border:1px solid rgba(176,107,255,.5);
  text-shadow:0 2px 6px rgba(0,0,0,.6), 0 0 18px rgba(176,107,255,.75);
  box-shadow:0 6px 22px rgba(0,0,0,.5), 0 0 18px rgba(176,107,255,.25);
  animation: eldwaveb 1.15s cubic-bezier(.2,1.2,.4,1) forwards; }
@keyframes eldwaveb { 0%{ opacity:0; transform:translateX(-50%) translateY(-8px) scale(.86); letter-spacing:10px; }
  20%{ opacity:1; transform:translateX(-50%) translateY(0) scale(1); letter-spacing:4px; }
  80%{ opacity:1; } 100%{ opacity:0; transform:translateX(-50%) translateY(-16px) scale(.97); } }

/* one-time "the UI can explain itself" hint (first battle only) */
.eld-hint { position:absolute; top: calc(env(safe-area-inset-top,0px) + 66px); left:50%; transform:translateX(-50%) translateY(-6px);
  padding:8px 18px; border-radius:999px; background:rgba(16,10,32,.92); border:1px solid rgba(255,255,255,.18);
  box-shadow:0 8px 22px rgba(0,0,0,.5); font-size:12.5px; font-weight:700; letter-spacing:.04em; color:#d9cff5;
  white-space:nowrap; opacity:0; transition:opacity .5s ease, transform .5s ease; pointer-events:none; z-index:22; }
.eld-hint.show { opacity:1; transform:translateX(-50%) translateY(0); }

/* ---- KEEPER BOSS BAR: name, phase pips, HP + shield, cast telegraph pulse ---- */
.eld-boss { position:absolute; top: calc(env(safe-area-inset-top,0px) + 64px); left:50%; transform:translateX(-50%); z-index:21; width:min(430px, 86vw);
  padding:7px 12px 9px; border-radius:14px; background:linear-gradient(180deg, rgba(24,16,44,.92), rgba(14,8,30,.92));
  border:1px solid var(--bossc, #c9b6ff); box-shadow:0 6px 22px rgba(0,0,0,.5), 0 0 16px color-mix(in srgb, var(--bossc, #c9b6ff) 22%, transparent);
  opacity:0; transition:opacity .35s ease, transform .35s ease;
  pointer-events:none; /* hidden = untouchable — never an invisible click-eater */ }
.eld-boss.show { opacity:1; pointer-events:auto; }
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
  font-size: clamp(30px, 8.5vw, 58px); letter-spacing:3px; white-space:nowrap; text-align:center;
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

/* SHORT viewports (landscape phones): the dock is tall, so pull the reserved
   top-center toast band up under the stat bar and shrink the center reaction so
   these brief punches never reach down onto the heroes / dock. */
@media (max-height: 520px) {
  .eld-banner, .eld-wavebanner { top: calc(env(safe-area-inset-top,0px) + 56px); }
  .eld-wavebanner { font-size:19px; letter-spacing:3px; padding:6px 16px; }
  .eld-banner { font-size:15px; padding:6px 14px; }
  .eld-react { top:24%; font-size: clamp(24px, 5.5vw, 40px); letter-spacing:2px; }
  .eld-react .rx-sub { font-size:10px; letter-spacing:4px; }
}

/* ===== LANDSCAPE PHONES (short height, ample width) =================
   The BOARD is the dominant element and must stay fully visible in BOTH the
   build/selection phase AND combat. So the dock stops being a tall vertical
   stack (which occluded the play plane and inflated --dock-h, shoving the
   upgrade sheet into the top bar) and becomes a SLIM, edge-docked HORIZONTAL
   rail: prep row on top, all action tiles on one short line below, tiles
   scaled down to fit the tightest landscape phone (iPhone SE, 667px) with
   the full loadout (3 spells + 3 controls + 3 heroes + 5 towers) on one line. */
@media (orientation: landscape) and (max-height: 520px) {
  .eld-dock {
    flex-flow: row wrap; align-items: flex-end; justify-content: center;
    gap: 4px 10px; padding: 5px 8px calc(env(safe-area-inset-bottom,0px) + 5px);
    max-width: none; left: 0; right: 0; transform: none; border-radius: 0;
    background: linear-gradient(0deg, rgba(18,10,36,.96), rgba(18,10,36,.4) 84%, rgba(18,10,36,0));
  }
  /* prep row (incoming telegraph + START) keeps its own full-width top line */
  .eld-dockbar { flex: 1 1 100%; order: -1; gap: 6px; }
  /* action groups share one centered line, sized to fit — never grow-to-fill */
  .eld-spellrow, .eld-heroes, .eld-towers { flex: 0 0 auto; }
  .eld-spells { flex: 0 0 auto; gap: 6px; }
  .eld-spell { width: 40px; height: 40px; font-size: 18px; }
  .eld-spell .cdtxt { font-size: 12px; }
  .eld-heroes { gap: 6px; }
  .eld-hero { width: 42px; }
  .eld-hero .hport { width: 40px; height: 40px; font-size: 17px; }
  .eld-hero .hname { font-size: 9px; }
  .eld-hero .hlvl { font-size: 9px; padding: 1px 3px; }
  .eld-towers { gap: 5px; }
  .eld-tower { flex: 0 0 auto; width: 44px; max-width: 44px; padding: 4px 2px 3px;
    border-radius: 11px; gap: 1px; }
  .eld-tower .gem { width: 22px; height: 22px; border-radius: 7px; margin-top: 1px; }
  .eld-tower .tn { font-size: 10px; }
  .eld-tower .tc { font-size: 11px; }
  .eld-tower .tt { font-size: 7px; letter-spacing: .2px; }
  .eld-rc { gap: 5px; }
  .eld-rc button { width: 32px; height: 32px; border-radius: 10px; font-size: 15px; }
  .eld-start { padding: 7px 18px; font-size: 16px; }
  .eld-telegraph { flex: 1 1 120px; font-size: 12px; padding: 6px 12px; }

  /* upgrade sheet: right half only, anchored above the slim dock and height-
     capped to the gap under the top bar, so it never climbs into the top strip
     and the left board stays readable. */
  .eld-upg { left: auto; right: 8px; bottom: calc(var(--dock-h, 108px) + 8px); top: auto;
    width: min(340px, 50vw);
    max-height: calc(100vh - var(--dock-h, 108px) - 84px); padding: 10px 12px; }
}
`

// Growth-infra additions: attract-mode chrome hiding + the prove-it share card.
const CSS_SHARE = `
/* ATTRACT / DEMO REEL: hide every interactive control; keep the juice
   (fx layer, banners, reaction callouts, barks live outside these). */
.eld-hud.attract .eld-top, .eld-hud.attract .eld-levelname, .eld-hud.attract .eld-rc,
.eld-hud.attract .eld-start, .eld-hud.attract .eld-dock, .eld-hud.attract .eld-syn,
.eld-hud.attract .eld-telegraph, .eld-hud.attract .eld-hint, .eld-hud.attract .eld-combo,
.eld-hud.attract .eld-chat, .eld-hud.attract .eld-upg {
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
  private livesFill!: HTMLElement
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
  private synTog!: HTMLElement
  private synList: HTMLElement
  private lastSynKey = ''
  private synUserToggled = false
  private lastComboCount = 0
  // board bounds (px) so floating numbers can't fly into the top bar or under the dock
  private fxTop = 110
  private fxBottom = 9999

  // panels
  private upgradeEl: HTMLElement | null = null
  private overlayEl: HTMLElement | null = null
  // affordability-gated controls in the OPEN selected-tower panel (upgrade tier,
  // branch picks, fusion). Re-evaluated every frame off live gold so the button
  // flips to enabled+glow the instant gold >= cost — with zero re-selection.
  private upgAfford: { el: HTMLElement; cost: number; afford: boolean }[] = []

  // chat/log feed (barks + event lines) + dock-height tracking for the
  // edge-anchored panels that must clear the action bar exactly
  private chat: ChatFeed
  private dockEl: HTMLElement
  private dockBar: HTMLElement
  private dockRO: ResizeObserver | null = null

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
  // Last badge STATE token per hero, so the inline-SVG glyph is re-parsed only on
  // a state change (cooldown ↔ ready ↔ $cost) — never every frame (perf on mobile).
  private heroBadgeState = new Map<string, string>()

  constructor(cb: HudCallbacks) {
    this.cb = cb
    this.styleEl = el('style')
    this.styleEl.textContent = CSS + CSS_SHARE
    document.head.appendChild(this.styleEl)

    this.root = el('div', 'eld-hud')
    // Honour reduce-motion (OS pref OR the in-app toggle) so CSS can soften the
    // flashier flourishes (ready-flash, etc). Set once at build like FrontPage does.
    if (appSettings.reducedMotion()) this.root.classList.add('reduced')

    // top bar
    const top = el('div', 'eld-top')
    const gold = el('div', 'eld-stat eld-gold pe')
    gold.append(this.iconDiv('$'), (this.goldVal = el('span', 'val', '0')))
    // THE PRISM WELLSPRING — the base you defend, shown as a real HP bar (not hearts)
    const life = el('div', 'eld-stat eld-life pe')
    const hpbar = el('div', 'eld-hpbar')
    this.livesFill = el('div', 'fill')
    hpbar.append(this.livesFill)
    life.append(this.iconDiv('◈'), hpbar, (this.livesVal = el('span', 'val', '0')))
    const wave = el('div', 'eld-stat eld-wave pe')
    wave.append((this.waveVal = el('span', 'val', 'WAVE 1')))
    this.comboEl = el('div', 'eld-combo') // combo chip: lives in the bar, in flow
    top.append(gold, life, this.comboEl, wave)
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
      tag: 'THE BASE',
      title: 'The Prism Wellspring',
      accent: '#6fe8ff',
      body: 'The fount of colour you defend. Every enemy that reaches it drains Wellspring HP — weak runners chip, brutes bite, bosses gut it. At 0 the Greying takes the Wellspring and the level is lost.',
      rows: this.simRef ? [{ k: 'Integrity', v: `${this.simRef.baseHp} / ${this.simRef.baseMaxHp}` }] : undefined,
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

    // telegraph pill — docked into the bottom bar's prep row (built below)
    this.telegraphEl = el('div', 'eld-telegraph hidden pe')
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

    // controls cluster (pause / speed / reset view) — docked in the bottom bar
    const rc = el('div', 'eld-rc')
    this.pauseBtn = el('button', 'pe', '❚❚')
    this.pauseBtn.onclick = () => { playUiTick(); this.cb.onPause() }
    this.speedBtn = el('button', 'pe', '1×')
    this.speedBtn.onclick = () => { playUiTick(); this.cb.onSpeed() }
    const resetBtn = iconEl('button', 'pe', iconMarkup('target', { size: 18, color: '#e6ddff' }))
    resetBtn.onclick = () => { playUiTick(); this.cb.onResetView() }
    rc.append(this.pauseBtn, this.speedBtn, resetBtn)
    attachTip(this.pauseBtn, () => ({
      tag: 'CONTROL', title: 'Pause', accent: '#c9b6ff',
      body: 'Freeze the battle and take a breath. Nothing moves until you resume.',
    }))
    attachTip(this.speedBtn, () => ({
      tag: 'CONTROL', title: 'Battle speed', accent: '#c9b6ff',
      body: 'Cycle 1× → 2× → 4×. The simulation stays exact at every speed — only time flows faster.',
    }))
    attachTip(resetBtn, () => ({
      tag: 'CONTROL', title: 'Reset view', accent: '#c9b6ff',
      body: 'Glide the camera back to the default framing. Drag to pan, pinch or scroll to zoom, two fingers (or right-drag) to rotate.',
    }))

    // start (docked in the bottom bar's prep row, beside the telegraph)
    this.startBtn = el('button', 'eld-start pe', 'START ▶')
    this.startBtn.onclick = () => { playUiTick(); this.cb.onStart() }
    attachTip(this.startBtn, () => ({
      tag: 'PREP PHASE', title: 'Start the wave', accent: '#3ad07a',
      body: 'Send the wave in early and pocket +2 gold for every second left on the clock. Build first, then cash in the courage.',
    }))

    // one-time discoverability hint (the tooltip layer IS the manual)
    this.hintEl = el('div', 'eld-hint')
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
    this.hintEl.innerHTML = `${iconMarkup('sparkle', { size: 13, color: '#ffe08a' })} ${coarse ? 'Long-press anything to inspect it' : 'Hover anything to inspect it'}`
    this.root.append(this.hintEl)
    try { this.hintDone = localStorage.getItem('chromancer_tip_hint_v1') === '1' } catch { this.hintDone = true }

    // dock (spells + towers). The dock itself is pointer-transparent so board taps
    // behind the gradient still reach the canvas; only the buttons opt back in.
    const dock = el('div', 'eld-dock')
    const spells = el('div', 'eld-spells')
    for (const key of SPELL_ORDER) {
      const def = SPELLS[key]
      const c = spellColor(key, def.color) // equipped VFX recolor
      const b = el('div', 'eld-spell ready pe')
      b.style.borderColor = hex(c)
      b.style.color = hex(c)
      const glyph = key === 'meteor' ? '☄' : key === 'freeze' ? '❄' : '💰'
      b.append(iconEl('span', '', glyphIcon(glyph, { size: 20, color: hex(c) })))
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
      const pal = towerPalette(kind) // equipped skin palette (or stock)
      const b = el('div', 'eld-tower pe')
      const gem = el('div', 'gem')
      gem.style.background = `linear-gradient(160deg, ${hex(pal.color)}, ${hex(pal.accent)})`
      gem.style.color = hex(pal.color)
      const nm = el('div', 'tn', def.name)
      const cost = el('div', 'tc', '$0')
      const tt = el('div', 'tt', def.damageType.slice(0, 4).toUpperCase() + (def.element ? ' · ' + def.element[0] : ''))
      const lock = iconEl('div', 'lock', iconMarkup('lock', { size: 16, color: '#efe9ff' }))
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
    // prep row (telegraph + START) and the spells+controls row assemble the
    // fixed bottom action-bar zone: nothing in it can overlap anything else.
    this.dockBar = el('div', 'eld-dockbar hidden')
    this.dockBar.append(this.telegraphEl, this.startBtn)
    const spellRow = el('div', 'eld-spellrow')
    spellRow.append(spells, rc)
    dock.append(this.dockBar, spellRow, this.heroRow, towers)
    this.root.append(dock)
    this.dockEl = dock

    // synergy rail (element team bonuses) — a compact left-edge icon rail, hidden
    // until a synergy is active, collapsed to a "⚡ N" tab during combat.
    this.synPanel = el('div', 'eld-syn hidden collapsed')
    this.synTog = el('div', 'syn-tog pe')
    this.synTog.addEventListener('click', () => {
      this.synUserToggled = true
      this.synPanel.classList.toggle('collapsed')
    })
    attachTip(this.synTog, () => ({
      tag: 'TEAM BONUS', title: 'Element synergies', accent: '#c9b6ff',
      body: 'Field heroes and towers that share an element to awaken team-wide bonuses. They stay active while the element stays on the board.',
      foot: 'Tap a buff icon for its full effect.',
    }))
    this.synPanel.append(this.synTog)
    this.synList = el('div', 'syn-rail')
    this.synPanel.append(this.synList)
    this.root.append(this.synPanel)

    // chat/log feed — the docked home for every conversational line
    this.chat = new ChatFeed(() => this.cb.onSelectDeselect())
    this.root.append(this.chat.root)

    // fx layer
    this.fxLayer = el('div', 'eld-fx')
    this.root.append(this.fxLayer)

    document.body.appendChild(this.root)

    // publish the dock's live height as --dock-h so the upgrade sheet and chat
    // feed anchor EXACTLY above the action bar, whatever rows it shows
    this.dockRO = new ResizeObserver(() => this.updateDockH())
    this.dockRO.observe(this.dockEl)
    this.updateDockH()
  }

  private updateDockH(): void {
    const r = this.dockEl.getBoundingClientRect()
    const h = Math.ceil(r.height)
    if (h > 0) this.root.style.setProperty('--dock-h', `${h}px`)
    // keep floating numbers in the board band: bottom above the dock (heroes live
    // in it), top below the stat bar. On short/landscape viewports the dock is
    // tall, so we lower the TOP rather than push the bottom over the dock/heroes.
    this.fxBottom = Math.max(70, (r.top || window.innerHeight) - 14)
    this.fxTop = Math.min(110, this.fxBottom - 30)
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
    // Wellspring HP: shake + flash when the base takes a hit; the fill bar tracks
    // integrity and the whole chip warms warn→crit as the colour bleeds out.
    if (this.lastLives >= 0 && sim.lives < this.lastLives) this.popClass(this.lifeStat, 'hurt', 450)
    this.lastLives = sim.lives
    this.livesVal.textContent = String(sim.baseHp)
    const frac = sim.baseIntegrity
    this.livesFill.style.transform = `scaleX(${frac.toFixed(3)})`
    this.lifeStat.classList.toggle('warn', frac > 0.25 && frac <= 0.5)
    this.lifeStat.classList.toggle('crit', frac > 0 && frac <= 0.25)
    this.waveVal.textContent = ctx.endless
      ? `WAVE ${sim.waveIndex + 1} ∞`
      : `WAVE ${Math.min(sim.waveIndex + 1, ctx.totalWaves)}/${ctx.totalWaves}`

    // combo readout — a compact persistent chip in the top bar, with a brief pop
    // on each 10-kill milestone (never a repeating center banner)
    if (sim.comboCount >= 2) {
      const cc = sim.comboCount
      const col = comboColor(cc)
      this.comboEl.textContent = `COMBO ×${cc}  ·  ${sim.comboMult.toFixed(2)}×`
      this.comboEl.style.color = hex(col)
      // grow + glow with the streak — capped so the chip never overruns the bar
      this.comboEl.style.setProperty('--cs', (1 + Math.min(0.2, cc * 0.006)).toFixed(3))
      this.comboEl.style.boxShadow = `0 4px 14px rgba(0,0,0,.35), 0 0 ${Math.round(6 + Math.min(30, cc) * 0.8)}px ${hexA(col, Math.min(0.8, 0.14 + cc * 0.028))}`
      this.comboEl.style.borderColor = hexA(col, Math.min(0.9, 0.3 + cc * 0.028))
      this.comboEl.classList.add('show')
      if (Math.floor(cc / 10) > Math.floor(this.lastComboCount / 10)) this.popClass(this.comboEl, 'pop', 360)
    } else {
      this.comboEl.classList.remove('show')
      this.comboEl.style.setProperty('--cs', '1')
      this.comboEl.style.boxShadow = ''
      this.comboEl.style.borderColor = ''
    }
    this.lastComboCount = sim.comboCount

    // start button + telegraph (prep only)
    if (sim.state === 'prep') {
      const secs = Math.max(0, Math.ceil(sim.prepTimer))
      this.startBtn.textContent = `START ▶  (${secs})`
      this.startBtn.classList.remove('hidden')
      const tg = sim.waveTelegraph()
      const elemPart = tg.element ? ` · ${tg.element}` : ''
      const skull = iconMarkup('skull', { size: 12, color: 'currentColor' })
      this.telegraphEl.innerHTML = tg.keeperName
        ? `${skull} ${escHud(tg.keeperName)}`
        : `${tg.boss ? skull + ' BOSS · ' : 'INCOMING: '}${escHud(tg.armor)}${elemPart}`
      this.telegraphEl.classList.remove('hidden')
      this.dockBar.classList.remove('hidden')
    } else {
      this.startBtn.classList.add('hidden')
      this.telegraphEl.classList.add('hidden')
      this.dockBar.classList.add('hidden')
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
      ref.root.style.borderColor = ctx.buildKind === kind ? hex(towerPalette(kind).color) : '#444'
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

    this.refreshUpgradeAfford(sim)
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
      this.bossAblEl.innerHTML = `${iconMarkup('warn', { size: 13, color: hex(bs.accent) })} ${escHud(bs.abilityName)}`
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
        { k: 'Wellspring leak', v: `−${bs.leakDmg} HP`, c: '#ff6b8a' },
      ],
      foot: 'Keepers are not slain — break the grey and they come home in colour. Let one reach the Wellspring and it guts the base.',
    }
  }

  // ------------------------------------------------------------- hero bar + synergy
  private buildHeroBar(sim: Sim): void {
    for (const entry of sim.partyLoadout()) {
      const def = entry.def
      const b = el('div', 'eld-hero pe')
      const lvl = el('div', 'hlvl', 'L' + entry.level)
      const port = el('div', 'hport')
      const art = heroArtUrl(entry.heroId)
      if (art) {
        // painted portrait, zoomed to the face (the chip is only 50px)
        port.style.background = `url('${art}') 50% 12% / 210% auto no-repeat, linear-gradient(160deg, ${hex(def.color)}, ${hex(def.accent)})`
        const dye = heroDye(entry.heroId) // equipped hero-skin recolor
        if (dye) port.style.filter = dye.css
      } else {
        port.style.background = `linear-gradient(160deg, ${hex(def.color)}, ${hex(def.accent)})`
        port.append(iconEl('span', 'hglyph', glyphIcon(def.glyph, { size: 24, color: '#fff' })))
      }
      port.style.borderColor = hex(RARITY_COLOR[def.rarity])
      port.style.color = hex(def.color)
      const mask = el('div', 'hcd')
      const cdtxt = el('div', 'hcdtxt', '')
      port.append(mask, cdtxt)
      const badge = el('div', 'hbadge', `$${entry.cost}`)
      badge.style.color = '#ffe27a'
      // bonded Chromatic Wyrm sigil — tinted by tier (Attunement glows).
      if (entry.wyrm) {
        const w = entry.wyrm
        const sig = el('div', 'hwyrm' + (w.tier === 'perfect' ? ' perfect' : ''), w.wyrm.emoji)
        sig.style.setProperty('--wc', hex(w.wyrm.color))
        sig.style.borderColor = hex(w.wyrm.color)
        port.append(sig)
      }
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
          // glyph never changes frame-to-frame — only re-parse the SVG on transition
          if (this.heroBadgeState.get(entry.heroId) !== 'cd') {
            ref.badge.innerHTML = glyphIcon(h.spell.glyph, { size: 16, color: hex(entry.def.color) })
            this.heroBadgeState.set(entry.heroId, 'cd')
          }
          this.heroWasReady.set(entry.heroId, false)
        } else {
          ref.mask.style.background = 'transparent'
          ref.cdtxt.textContent = ''
          ref.root.classList.add('ready')
          if (this.heroWasReady.get(entry.heroId) === false) this.popClass(ref.root, 'ping', 550)
          this.heroWasReady.set(entry.heroId, true)
          if (this.heroBadgeState.get(entry.heroId) !== 'ready') {
            ref.badge.innerHTML = `${glyphIcon(h.spell.glyph, { size: 16, color: hex(entry.def.color) })} CAST`
            this.heroBadgeState.set(entry.heroId, 'ready')
          }
        }
        ref.badge.style.color = hex(entry.def.color)
        ref.port.style.borderColor = hex(entry.def.color)
        ref.root.classList.remove('dim', 'sel')
      } else {
        ref.mask.style.background = 'transparent'
        ref.cdtxt.textContent = ''
        ref.root.classList.remove('ready')
        const costTok = `cost:${entry.cost}`
        if (this.heroBadgeState.get(entry.heroId) !== costTok) {
          ref.badge.textContent = `$${entry.cost}`
          this.heroBadgeState.set(entry.heroId, costTok)
        }
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
    if (key !== this.lastSynKey) {
      this.lastSynKey = key
      this.synList.innerHTML = ''
      const n = bonuses.length + resonances.length
      if (n === 0) {
        this.synPanel.classList.add('hidden')
      } else {
        this.synPanel.classList.remove('hidden')
        this.synTog.textContent = ''
        this.synTog.append(document.createTextNode(`⚡ ${n} `), el('span', 'cv', '▾'))
        for (const b of bonuses) {
          const pill = el('div', 'syn-pill pe')
          pill.style.borderColor = hex(b.color)
          pill.style.color = hex(b.color)
          pill.append(el('span', 'si', b.icon))
          this.synList.append(pill)
          attachTip(pill, () => ({
            tag: 'ACTIVE SYNERGY', title: b.name, accent: hex(b.color), body: b.desc,
            foot: 'Awakened by fielding allies that share an element. It fades if they leave the board.',
          }))
        }
        // ELEMENT RESONANCE pills (hero ↔ tower bonds) — tiny tier/count badge
        for (const r of resonances) {
          const pill = el('div', 'syn-pill pe')
          pill.style.borderColor = hex(r.color)
          pill.style.color = hex(r.color)
          pill.append(el('span', 'si', r.icon), el('span', 'sv', r.tier === 2 ? 'II' : `×${r.count}`))
          this.synList.append(pill)
          attachTip(pill, () => ({
            tag: 'ELEMENT RESONANCE', title: r.name, accent: hex(r.color),
            body: `${r.heroNames.join(' & ')} resonates with your ${r.count} ${r.towerName} towers — ${r.desc}.`,
            foot: r.tier === 1 ? `Build ${4 - r.count} more ${r.towerName} tower${4 - r.count === 1 ? '' : 's'} for tier II.` : 'Tier II — fully resonant.',
          }))
        }
      }
    }
    // collapse to the tab in combat, expand during prep — unless the player has
    // manually toggled it this battle (then respect their choice).
    if (!this.synUserToggled) this.synPanel.classList.toggle('collapsed', sim.state !== 'prep')
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
      k: sig.name,
      v: awake ? sig.blurb : `dormant — awakens at Lv ${SIGNATURE_UNLOCK_LEVEL}`,
      c: awake ? hex(def.color) : '#9d8fc5',
    })
    // CHROMATIC WYRM — the bonded companion (breath + aura + attunement)
    if (entry.wyrm) {
      const w = entry.wyrm
      rows.push({ k: `${w.wyrm.emoji} ${w.wyrm.name}`, v: `${w.tierLabel} (${w.tier.toUpperCase()}) · ${w.stageLabel} Lv ${w.level}`, c: hex(w.wyrm.color) })
      rows.push({ k: 'Breath', v: `${Math.round(w.breathDamage)} ${w.wyrm.element} · ${w.breathRadiusTiles.toFixed(1)} tiles / ${w.breathCd.toFixed(1)}s`, c: hex(w.wyrm.color) })
      rows.push({ k: 'Bond aura', v: wyrmBuffsTowers(w.wyrm.element)
        ? `+${Math.round((w.heroAmp - 1) * 100)}% hero dmg · +${Math.round(w.towerBuff * 100)}% ${w.wyrm.element} towers`
        : `+${Math.round((w.heroAmp - 1) * 100)}% hero dmg (hero-only — no ${w.wyrm.element} tower)`, c: '#c9b6ff' })
      if (w.ult) rows.push({ k: `★ ${w.ult.name}`, v: w.ult.blurb, c: hex(w.wyrm.color) })
    }
    // RESONANCE — hero + 2/4+ towers of their resonant kind
    const res = sim.activeResonances().find((r) => r.heroIds.includes(heroId))
    const rInfo = resonanceInfo(def.resonantTower)
    rows.push(
      res
        ? { k: 'Resonance', v: `${res.name} · ${res.desc}`, c: '#8dff4a' }
        : { k: 'Resonance', v: awake ? `build 2+ ${rInfo.towerName} towers to awaken` : `needs Lv ${SIGNATURE_UNLOCK_LEVEL} + 2 ${rInfo.towerName} towers`, c: '#9d8fc5' },
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
    // WELLSPRING STAKES — how much base HP each of these foes drains if it breaks through.
    for (const l of tg.leaks) {
      rows.push({ k: `${l.name} leak`, v: `−${l.dmg} HP`, c: l.dmg >= 6 ? '#ff6b8a' : l.dmg >= 3 ? '#ffb14a' : '#9fe6ff' })
    }
    let foot: string | undefined
    if (tg.element) {
      const counters = (Object.keys(WHEEL) as Element[]).filter((e) => WHEEL[e].strong.includes(tg.element!))
      foot = `${tg.element} foes take 1.5× from ${counters.join(' & ')} attacks — and 0.75× from what they resist.`
    }
    const leakFoot = `Each breach drains the Wellspring by its leak value${tg.worstLeak >= 6 ? ' — this wave can gut it.' : '.'}`
    return {
      tag: tg.boss ? 'INCOMING · BOSS WAVE' : 'INCOMING WAVE',
      title: `${tg.armor} armor${tg.element ? ' · ' + tg.element : ''}`,
      accent: tg.boss ? '#ff8fa5' : '#a8e9ff',
      body: 'Damage-type multipliers against this wave, then the Wellspring HP each foe drains on a breach. Build toward the green.',
      rows,
      foot: foot ? `${foot} ${leakFoot}` : leakFoot,
    }
  }

  // ------------------------------------------------------------- upgrade panel
  showUpgrade(sim: Sim, id: number): void {
    this.hideUpgrade()
    this.chat.collapse() // one contextual panel at a time (portrait drawer yields)
    const t = sim.towerById(id)
    if (!t) return
    const def = t.def
    const wrap = el('div', 'eld-upg pe')
    wrap.style.borderColor = hex(def.color)
    wrap.style.boxShadow = `0 12px 34px rgba(0,0,0,.55), 0 0 22px ${hex(def.color)}55`

    const row1 = el('div', 'row1')
    const tierName = t.fusedElem !== '' ? t.fusionName : sim.isMax(t) ? def.branches[t.branch].name : `Lv ${t.level + 1}`
    const ttEl = t.fusedElem !== ''
      ? iconEl('div', 'tt', `${escHud(def.name)} · ${iconMarkup('atom', { size: 13, color: hex(def.color) })} ${escHud(tierName)}`)
      : el('div', 'tt', `${def.name} · ${tierName}`)
    row1.append(ttEl, el('div', 'stars', starStr(sim.powerTier(t))))
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
    const tgt = iconEl('button', 'tgt pe', `${iconMarkup('target', { size: 13, color: '#e6ddff' })} ${t.targeting}`)
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
      this.registerAfford(up, cost, afford)
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
        this.registerAfford(btn, cost, afford)
        btn.style.background = `linear-gradient(180deg, ${hex(def.color)}, ${hex(def.accent)})`
        btn.append(el('span', undefined, b.name), el('span', 'bb', b.blurb), el('span', 'bc', `$${cost}`))
        btn.onclick = () => this.cb.onBranch(t.id, idx)
        attachTip(btn, () => branchTip(def.name, b, cost, hex(def.color), def.status))
        br.append(btn)
      })
      ctl.append(br)
    } else if (t.fusedElem !== '') {
      const fused = iconEl('div', 'maxlbl pe', `${iconMarkup('atom', { size: 15, color: hex(t.fusedColor) })} ${escHud(t.fusionName.toUpperCase())}`)
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
          this.registerAfford(btn, o.cost, afford)
          btn.style.background = `linear-gradient(180deg, ${hex(o.color)}, ${hex(o.color2)}66), linear-gradient(180deg, ${hex(def.color)}, ${hex(def.accent)})`
          btn.append(
            iconEl('span', '', `${iconMarkup('atom', { size: 13, color: '#fff' })} FUSE → ${escHud(o.name)}`),
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
          body: 'Build ANOTHER max-tier tower of a reactive element on an adjacent tile and a FUSE option appears here.',
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
    // Board-tap passthrough: a click on the sheet that ISN'T a control forwards to
    // the board, so a tower hidden under the open sheet swaps in on one tap. Buttons
    // handle their own clicks (skip them); a long-press for a tooltip suppresses the
    // click, so tips never misfire a passthrough. Scroll drags fire no click.
    wrap.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button')) return
      this.cb.onBoardTapThrough(e.clientX, e.clientY)
    })
    this.root.append(wrap)
    this.upgradeEl = wrap
  }

  // A fielded HERO's control sheet — the counterpart to the tower upgrade sheet.
  // Reuses the same floating container (so hideUpgrade closes it) but surfaces the
  // hero levers that make placement a live skill: RELOCATE, retarget priority, and
  // the signature ULT with its live cooldown. Selected by tapping the hero on board.
  showHeroPanel(sim: Sim, slotId: number): void {
    this.hideUpgrade()
    this.chat.collapse()
    const h = sim.heroBySlot(slotId)
    if (!h) return
    const def = h.def
    const color = def.color
    const wrap = el('div', 'eld-upg pe')
    wrap.style.borderColor = hex(color)
    wrap.style.boxShadow = `0 12px 34px rgba(0,0,0,.55), 0 0 22px ${hex(color)}55`

    const row1 = el('div', 'row1')
    row1.append(el('div', 'tt', `${def.glyph} ${def.name} · Lv ${h.level}`), el('div', 'stars', def.role.toUpperCase()))
    const roleEl = row1.querySelector('.stars') as HTMLElement
    roleEl.style.color = hex(color)

    const focusHint = h.focusId !== 0 ? ' · 🎯 FOCUSED' : ''
    const stat = el('div', 'stat pe', `DPS ${Math.round(sim.heroDps(h))}   ·   RNG ${(sim.heroRange(h) / 80).toFixed(1)}   ·   ${def.element}${focusHint}`)

    const ressForHero = sim.activeResonances().filter((r) => r.heroIds.includes(h.heroId))
    const bondLine = h.wyrm ? `${h.wyrm.wyrm.emoji} ${h.wyrm.wyrm.name} bond · ${h.wyrm.tierLabel}` : ''
    const resLine = ressForHero.length ? `🔗 ${ressForHero.map((r) => r.name).join(' · ')}` : ''
    const investTxt = [resLine, bondLine].filter(Boolean).join('   ·   ') || 'Tap an enemy to FOCUS · tap a tile after MOVE to relocate'
    const evs = el('div', 'evs pe', investTxt)
    evs.style.color = ressForHero.length || h.wyrm ? '#ffe27a' : '#b8b0d8'

    const close = el('button', 'close pe', '✕')
    close.onclick = () => this.cb.onSelectDeselect()

    const ctl = el('div', 'ctl')
    const tgt = iconEl('button', 'tgt pe', `${iconMarkup('target', { size: 13, color: '#e6ddff' })} ${h.targeting}`)
    tgt.onclick = () => { this.cb.onHeroTargeting(slotId); this.showHeroPanel(sim, slotId) }
    attachTip(tgt, () => {
      const hh = this.simRef?.heroBySlot(slotId)
      const mode = hh?.targeting ?? h.targeting
      return {
        tag: 'TARGETING', title: `Priority: ${mode}`, accent: '#a8e9ff',
        rows: [
          { k: 'First', v: 'furthest along the path', c: mode === 'First' ? '#8dff4a' : undefined },
          { k: 'Strong', v: 'highest health — lock the boss/elite', c: mode === 'Strong' ? '#8dff4a' : undefined },
          { k: 'Weak', v: 'lowest health — finish kills', c: mode === 'Weak' ? '#8dff4a' : undefined },
          { k: 'Close', v: 'nearest the hero', c: mode === 'Close' ? '#8dff4a' : undefined },
          { k: 'Primed', v: 'primed for a reaction with this hero', c: mode === 'Primed' ? '#8dff4a' : undefined },
        ],
        foot: 'Tap to cycle. Or tap an enemy on the board to hard-FOCUS it.',
      }
    })
    ctl.append(tgt)

    const move = el('button', 'up pe', '⤢ MOVE')
    move.onclick = () => this.cb.onHeroMove(slotId)
    attachTip(move, () => ({
      tag: 'REPOSITION', title: 'Relocate the hero', accent: hex(color),
      body: 'Move the hero to any open build tile — meet the threat, chase the boss, or slot beside a support. Free; a brief settle after the blink.',
    }))
    ctl.append(move)

    const ready = h.spellCd <= 0
    const cd = Math.ceil(h.spellCd)
    const cast = el('button', 'up pe' + (ready ? '' : ' no'), ready ? `✦ ${h.spell.name}` : `✦ ${cd}s`)
    if (ready) cast.onclick = () => this.cb.onHeroCast(slotId)
    attachTip(cast, () => {
      const hh = this.simRef?.heroBySlot(slotId)
      return {
        tag: 'SIGNATURE ULT', title: hh?.spell.name ?? h.spell.name, accent: hex(color),
        body: h.spell.blurb + ' — grows with hero level, element resonance and the dragon bond. Save it for a boss or a swarm.',
        rows: [{ k: 'Cooldown', v: `${Math.round(h.spellMaxCd)}s`, c: '#ffe27a' }],
      }
    })
    ctl.append(cast)

    wrap.append(close, row1, stat, evs, ctl)
    wrap.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button')) return
      this.cb.onBoardTapThrough(e.clientX, e.clientY)
    })
    this.root.append(wrap)
    this.upgradeEl = wrap
  }

  hideUpgrade(): void {
    if (this.upgradeEl) dismissTip() // the tooltip's anchor is about to vanish
    this.upgradeEl?.remove()
    this.upgradeEl = null
    this.upgAfford = []
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
    onNext?: () => void // campaign win: hop straight to the next (unlocked) level
    nextLabel?: string
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
      box.append(iconEl('div', 'li', iconMarkup('brush', { size: 22, color: '#c9b6ff' })), lt)
      ov.append(box)
    }
    const rewards = el('div', 'eld-rewards')
    const lines: string[] = []
    if (opts.coins > 0) lines.push(`+${opts.coins} ${currencyIcon('coin', { size: 15 })}`)
    if (opts.diamonds > 0) lines.push(`+${opts.diamonds} ${currencyIcon('diamond', { size: 15 })}`)
    if (opts.shards && opts.shards > 0) lines.push(`+${opts.shards} ${currencyIcon('shard', { size: 15 })}`)
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
      const sh = iconEl('button', 'eld-btn blue slim', `${iconMarkup('link', { size: 15, color: '#cfe0ff' })} SHARE`)
      sh.onclick = async () => {
        if (!(await shareCard(canvas, share))) {
          downloadCard(canvas, share.code)
          this.banner('CARD SAVED — paste it anywhere', 0x9ee8ff)
        }
      }
      const cp = iconEl('button', 'eld-btn purple slim', `${iconMarkup('link', { size: 14, color: '#e0ccff' })} COPY SEED LINK`)
      cp.onclick = async () => {
        const ok = await copyText(share.link)
        cp.textContent = ok ? '✓ LINK COPIED' : '✗ COPY FAILED'
        window.setTimeout(() => { cp.innerHTML = `${iconMarkup('link', { size: 14, color: '#e0ccff' })} COPY SEED LINK` }, 1600)
      }
      const dl = el('button', 'eld-btn purple slim', '↓')
      dl.title = 'Download the card'
      dl.onclick = () => downloadCard(canvas, share.code)
      srow.append(sh, cp, dl)
      ov.append(srow)
    }
    if (!opts.win) ov.append(el('div', 'eld-retrynote', 'Retry replays the SAME waves — same seed, no surprises.'))
    const row = el('div', 'eld-btnrow')
    // NEXT LEVEL is the primary CTA on a campaign win — lead with it, keep the
    // ride going. REPLAY + WORLD MAP become the secondary options beside it.
    if (opts.onNext) {
      const next = el('button', 'eld-btn green', opts.nextLabel ?? 'NEXT LEVEL →')
      next.onclick = () => opts.onNext?.()
      row.append(next)
    }
    const replay = el('button', opts.onNext ? 'eld-btn purple slim' : 'eld-btn purple', opts.win ? '↻ REPLAY' : '↻ RETRY')
    replay.onclick = () => this.cb.onReplay()
    row.append(replay)
    if (opts.onContinue) {
      const cont = el('button', 'eld-btn green', opts.continueLabel ?? 'CONTINUE →')
      cont.onclick = () => opts.onContinue?.()
      row.append(cont)
    } else {
      // downgrade WORLD MAP to a secondary look when NEXT LEVEL owns the primary slot
      const back = el('button', opts.onNext ? 'eld-btn blue slim' : 'eld-btn green', opts.endless ? 'MENU' : 'WORLD MAP')
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
      const cp = iconEl('button', 'eld-btn purple slim', `${iconMarkup('link', { size: 14, color: '#e0ccff' })} COPY SEED LINK`)
      cp.onclick = async () => {
        const ok = await copyText(share.link)
        cp.textContent = ok ? '✓ LINK COPIED' : '✗ COPY FAILED'
        window.setTimeout(() => { cp.innerHTML = `${iconMarkup('link', { size: 14, color: '#e0ccff' })} COPY SEED LINK` }, 1600)
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
  // Register an affordability-gated control from the open tower panel so the
  // per-frame refresh can flip its enabled/glow state live. `afford` is its
  // state at build time (so we don't flash a control that was already affordable
  // when the panel opened).
  private registerAfford(btn: HTMLElement, cost: number, afford: boolean): void {
    if (afford) btn.classList.add('can')
    this.upgAfford.push({ el: btn, cost, afford })
  }

  // Re-evaluate the open selected-tower panel's affordability against live gold.
  // Called every frame from update(): the instant gold crosses a control's cost
  // it enables + flares + glows; the instant it drops below it dims back to the
  // red-cost state. No stale state that only refreshes on tap/re-select.
  private refreshUpgradeAfford(sim: Sim): void {
    if (!this.upgradeEl || this.upgAfford.length === 0) return
    for (const c of this.upgAfford) {
      const afford = sim.gold >= c.cost
      if (afford === c.afford) continue
      c.afford = afford
      c.el.classList.toggle('no', !afford)
      c.el.classList.toggle('can', afford)
      if (afford) this.popClass(c.el, 'affordflash', 600)
    }
  }

  private popClass(target: HTMLElement, cls: string, ms: number): void {
    target.classList.remove(cls)
    void target.offsetWidth
    target.classList.add(cls)
    window.setTimeout(() => target.classList.remove(cls), ms)
  }

  // Live count of on-screen floaters so a big AoE can't spawn hundreds of DOM
  // nodes at once (perf) — new ones past the cap are simply dropped. CHROMANCER
  // #55: the cap dropped from 22→6 (8→4 reduced-motion) — at peak reaction
  // density the caller (BattleScene) also MERGES same-target hits into one
  // rolling number before ever calling this, so the cap now bounds genuinely
  // distinct targets rather than a pile of one-per-tick numbers.
  private floatCount = 0
  readonly FLOAT_CAP = 6
  readonly FLOAT_CAP_REDUCED = 4
  /** Current on-screen floater count — callers use this to decide whether the
   * board is already busy enough to suppress a merely-small hit number. */
  get floatersActive(): number { return this.floatCount }
  floatText(x: number, y: number, msg: string, color: number, size: number, style: 'norm' | 'combo' | 'crit' = 'norm'): void {
    const reduced = appSettings.reducedMotion()
    // reduce-motion: keep only the meaningful hits (crit / combo). Plain damage
    // numbers arc and fly the most, so they're the ones we suppress — "fewer/none".
    if (reduced && style === 'norm') return
    if (this.floatCount >= (reduced ? this.FLOAT_CAP_REDUCED : this.FLOAT_CAP)) return
    this.floatCount++
    // clamp the spawn into the board band so numbers arc off the target without
    // flying up into the top bar / combo chip or landing under the dock + HUD.
    x = Math.max(24, Math.min(window.innerWidth - 24, x))
    y = Math.max(this.fxTop, Math.min(this.fxBottom, y))
    // shrunk + faster-fading than pre-#55 so a busy wave reads as quick, small
    // callouts rather than lingering numbers stacking over the enemies/lane.
    const shrink = style === 'norm' ? 0.78 : 0.88
    const d = el('div', 'eld-float' + (style === 'crit' ? ' crit' : ''), msg)
    d.style.left = `${x}px`
    d.style.top = `${y}px`
    d.style.fontSize = `${Math.round(size * shrink)}px`
    d.style.color = hex(color)
    d.style.setProperty('--dx', `${Math.round((Math.random() - 0.5) * 56)}px`)
    const anim = style === 'combo' ? 'eldcombo' : style === 'crit' ? 'eldcrit' : 'eldfloat'
    const dur = style === 'norm' ? 0.6 : 0.68
    d.style.animation = `${anim} ${dur}s ease-out forwards`
    this.fxLayer.append(d)
    window.setTimeout(() => { d.remove(); this.floatCount-- }, dur * 1000 + 60)
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

  waveBanner(msg: string, priority: number = BANNER_PRIORITY.wave): void {
    this.chat.add(null, msg, 'event') // record FIRST — the queue may defer/drop the visual
    this.enqueueBanner({ cls: 'eld-wavebanner', msg, priority, dur: 1150 })
  }

  // ------------------------------------------------------------- chat feed
  /** Route a conversational line (hero bark / Morose taunt) to the docked feed. */
  chatBark(speaker: string, text: string): void {
    this.chat.add(speaker, text)
  }

  /** A plain event line in the feed (no speaker). */
  chatEvent(text: string): void {
    this.chat.add(null, text, 'event')
  }

  // ELEMENTAL REACTION slam — its own channel, independent of the center-banner
  // queue (reactions are frequent + fast). Up to TWO can coexist, the second nudged
  // up ~8% so a boss-wave combo can slam two reactions ~0.4s apart without one
  // erasing the other; a third rolls the oldest off. Peak-density readability
  // (CHROMANCER #55): a repeat of the SAME name while it's still on screen does
  // NOT stack a second banner — it bumps a "×N" suffix on the existing one and
  // resets its timer, so a chain of five SHATTERs reads as one "SHATTER ×5"
  // instead of five overlapping words walling off the lane.
  private reactEls: Array<{ root: HTMLElement; nameEl: HTMLElement; name: string; count: number; timer: number }> = []
  reactionCallout(name: string, color: number, sub = 'ELEMENTAL REACTION'): void {
    const top = this.reactEls[this.reactEls.length - 1]
    if (top && top.name === name) {
      top.count++
      top.nameEl.textContent = `${name} ×${top.count}`
      window.clearTimeout(top.timer)
      top.timer = window.setTimeout(() => this.removeReact(top), 1050)
      return
    }
    if (this.reactEls.length >= 2) this.removeReact(this.reactEls[0])
    const d = el('div', 'eld-react')
    const nameEl = el('span', '', name)
    d.style.color = hex(color)
    if (this.reactEls.length === 1) d.style.top = '19%' // second slot sits above the first
    d.append(nameEl, el('span', 'rx-sub', sub))
    this.fxLayer.append(d)
    const entry = { root: d, nameEl, name, count: 1, timer: 0 }
    entry.timer = window.setTimeout(() => this.removeReact(entry), 1050)
    this.reactEls.push(entry)
  }

  private removeReact(entry: { root: HTMLElement }): void {
    const i = this.reactEls.findIndex((r) => r === entry)
    if (i >= 0) this.reactEls.splice(i, 1)
    entry.root.remove()
  }

  // -------- center-banner queue (wave banners + generic notifications) --------
  // One banner shows at a time in the shared ~30-34% band. A strictly-higher
  // priority banner (boss) preempts a lower one; equal/lower ones queue (highest
  // priority first) behind it. The queue is capped so a burst can't pile up or
  // strand a banner on screen.
  private activeBanner: { el: HTMLElement; priority: number; timer: number } | null = null
  private bannerQueue: { cls: string; msg: string; color?: number; priority: number; dur: number }[] = []

  private showCenterBanner(item: { cls: string; msg: string; color?: number; priority: number; dur: number }): void {
    const d = el('div', item.cls, item.msg)
    if (item.color !== undefined) d.style.color = hex(item.color)
    this.fxLayer.append(d)
    const timer = window.setTimeout(() => {
      d.remove()
      this.activeBanner = null
      this.nextBanner()
    }, item.dur)
    this.activeBanner = { el: d, priority: item.priority, timer }
  }

  private nextBanner(): void {
    if (this.activeBanner || this.bannerQueue.length === 0) return
    let bi = 0 // highest priority first; FIFO within a tier (queue order preserved)
    for (let i = 1; i < this.bannerQueue.length; i++) if (this.bannerQueue[i].priority > this.bannerQueue[bi].priority) bi = i
    this.showCenterBanner(this.bannerQueue.splice(bi, 1)[0])
  }

  private enqueueBanner(item: { cls: string; msg: string; color?: number; priority: number; dur: number }): void {
    if (!this.activeBanner) { this.showCenterBanner(item); return }
    if (item.priority > this.activeBanner.priority) {
      window.clearTimeout(this.activeBanner.timer) // preempt: a boss beat wins the band now
      this.activeBanner.el.remove()
      this.activeBanner = null
      this.showCenterBanner(item)
      return
    }
    this.bannerQueue.push(item)
    if (this.bannerQueue.length > 3) {
      let wi = 0 // overflow: drop the lowest-priority (oldest at that tier) so nothing strands
      for (let i = 1; i < this.bannerQueue.length; i++) if (this.bannerQueue[i].priority < this.bannerQueue[wi].priority) wi = i
      this.bannerQueue.splice(wi, 1)
    }
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
    // its own class (not '.eld-float' — that's the damage-number floaters' cap-
    // counted selector; this full-screen tint used to share the name, which made
    // it invisible to floatCount but ALSO polluted any '.eld-float' query/telemetry)
    const d = el('div', 'eld-flash')
    d.style.cssText = `position:absolute;inset:0;transform:none;background:${hex(color)};opacity:${alpha};transition:opacity ${dur}ms ease-out;`
    this.fxLayer.append(d)
    // next frame → fade to 0
    requestAnimationFrame(() => { d.style.opacity = '0' })
    window.setTimeout(() => d.remove(), dur + 60)
  }

  banner(msg: string, color: number, priority: number = BANNER_PRIORITY.notify): void {
    this.chat.add(null, msg, 'event') // record FIRST — the pop may be queued/dropped, the feed remembers
    this.enqueueBanner({ cls: 'eld-banner', msg, color, priority, dur: 1200 })
  }

  dispose(): void {
    dismissTip()
    this.hideUpgrade()
    this.clearOverlay()
    this.dockRO?.disconnect()
    this.dockRO = null
    this.root.remove()
    this.styleEl.remove()
  }
}

// ---- helpers (view-only) ----
// Aura each tower paints (mirror of the sim's TOWER_AURA, labels for the panel).
const TOWER_AURA_LABEL: Partial<Record<TowerKind, string>> = {
  flame: 'Fire', frost: 'Water', storm: 'Storm', arcane: 'Arcane',
  bloom: 'Nature', radiant: 'Light', shade: 'Dark',
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
function branchTip(towerName: string, b: TowerBranch, cost: number, accent: string, status?: StatusKind): TipContent {
  const rows: TipRow[] = [
    { k: 'Damage', v: String(b.damage) },
    { k: 'Rate', v: rateStr(b.cooldown) },
    { k: 'Range', v: `${b.range} tiles` },
  ]
  if (b.damageType) rows.push({ k: 'Becomes', v: `${b.damageType} damage`, c: '#a8e9ff' })
  if (b.splash) rows.push({ k: 'Splash', v: `${b.splash} tiles`, c: '#ff9a5c' })
  if (b.stunDuration) rows.push({ k: 'Stun', v: `${b.stunDuration}s`, c: '#6bd6ff' })
  if (b.slowFactor !== undefined) rows.push({ k: 'Slow', v: `to ${Math.round(b.slowFactor * 100)}% speed`, c: '#6bd6ff' })
  if (b.burnDps) rows.push({ k: status === 'poison' ? 'Poison' : 'Burn', v: `${b.burnDps}/s`, c: '#ff9a5c' })
  if (b.zoneDps) rows.push({ k: status === 'poison' ? 'Toxic ground' : 'Ground fire', v: `${b.zoneDps}/s · ${b.zoneDuration}s`, c: '#ff9a5c' })
  if (b.armorTear) rows.push({ k: 'Armor shred', v: `-${b.armorTear} armor · ${b.armorTearDuration ?? 3}s`, c: '#c06bff' })
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
