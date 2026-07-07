// HeroCollection — the CARD collection screen (Rush Royale / Realm Defense style).
// A rich HTML/CSS DOM overlay mounted by HeroesScene: a grid of rarity-framed,
// element-coloured hero cards showing level, star pips, stats, the signature spell,
// a Level-Up button and an add-to-party toggle. Art is a placeholder (element
// gradient + glyph + rarity frame) so the structure already reads like the
// reference games; painted portraits swap into .hc-portrait later untouched.
//
// It owns NO progression logic: it reads + mutates through `economy` (the single
// currency/save authority) and re-renders. Disposed fully by the scene on exit.

import { economy } from '../game/economy'
import { heroArtUrl } from './heroArt'
import { BondPanel } from './BondPanel'
import { HEROES, HERO_ORDER, RARITY_COLOR, MAX_PARTY, type HeroDef, type HeroRarity } from '../game/heroes'
import { heroStats, heroSpellScaled, xpForLevel, shardCostForLevel, MAX_HERO_LEVEL, signatureAwake, SIGNATURE_UNLOCK_LEVEL } from '../game/heroProgress'
import { resonanceInfo } from '../game/resonance'
import { elementIcon, glyphIcon, currencyIcon } from './icons'

function hex(c: number): string {
  return '#' + (c & 0xffffff).toString(16).padStart(6, '0')
}
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

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const RARITY_LABEL: Record<HeroRarity, string> = { common: 'COMMON', rare: 'RARE', epic: 'EPIC' }

const CSS = `
.hc-root, .hc-root * { box-sizing:border-box; -webkit-tap-highlight-color:transparent; font-family:'Baloo 2','Nunito',system-ui,'Segoe UI',Arial,sans-serif; }
.hc-root { position:fixed; inset:0; z-index:40; color:#fff; user-select:none; overflow:hidden;
  background:radial-gradient(120% 90% at 50% -10%, #2a1a5c 0%, #170e33 55%, #0e0822 100%); }
.hc-scroll { position:absolute; inset:0; overflow-y:auto; -webkit-overflow-scrolling:touch; padding: calc(env(safe-area-inset-top,0px) + 8px) 12px calc(env(safe-area-inset-bottom,0px) + 24px); }

/* header */
.hc-head { display:flex; align-items:center; gap:10px; margin-bottom:8px; }
.hc-back { pointer-events:auto; padding:9px 16px; border:0; border-radius:14px; font:inherit; font-weight:900; font-size:16px; color:#fff; cursor:pointer;
  background:linear-gradient(180deg,#7b52d8,#4a2f9a); box-shadow:0 5px 14px rgba(0,0,0,.4); }
.hc-back:active { transform:scale(.94); }
.hc-title { font-size:26px; font-weight:900; letter-spacing:.5px; text-shadow:0 3px 0 rgba(0,0,0,.4); color:#ffd54a; -webkit-text-stroke:1px #7b2ff7; }
.hc-wallet { margin-left:auto; display:flex; gap:8px; }
.hc-cur { display:flex; align-items:center; gap:5px; background:linear-gradient(180deg,#2f2258,#241a44); border:1px solid rgba(255,255,255,.14);
  border-radius:13px; padding:6px 11px; font-weight:900; font-size:15px; box-shadow:0 3px 10px rgba(0,0,0,.35); font-variant-numeric:tabular-nums; }
.hc-cur .ci { font-size:15px; }

/* party strip */
.hc-party-bar { display:flex; align-items:center; gap:10px; background:linear-gradient(180deg,rgba(46,32,92,.9),rgba(28,18,58,.9));
  border:1px solid rgba(255,255,255,.12); border-radius:16px; padding:10px 12px; margin-bottom:12px; box-shadow:0 4px 14px rgba(0,0,0,.35); }
.hc-party-lbl { font-size:13px; font-weight:900; letter-spacing:1px; color:#c9b6ff; }
.hc-party-slots { display:flex; gap:8px; }
.hc-slot { width:44px; height:44px; border-radius:50%; display:grid; place-items:center; font-size:20px;
  border:2px dashed rgba(255,255,255,.25); background:rgba(0,0,0,.2); color:#6a5da0; }
.hc-slot.filled { border-style:solid; box-shadow:0 0 12px currentColor, inset 0 2px 5px rgba(255,255,255,.3); }
.hc-party-hint { margin-left:auto; font-size:12px; font-weight:700; color:#9f90d0; }
.hc-lo { padding:7px 13px; border-radius:999px; border:1px solid rgba(255,255,255,.18); background:rgba(255,255,255,.06);
  color:#b9adde; font:inherit; font-size:11px; font-weight:900; letter-spacing:.08em; cursor:pointer; }
.hc-lo.on { background:linear-gradient(180deg,#3ad07a,#1f9a54); color:#fff; border-color:rgba(120,255,180,.5); }

/* grid */
.hc-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(168px, 1fr)); gap:12px; max-width:760px; margin:0 auto; }

/* card */
.hc-card { position:relative; border-radius:18px; padding:3px; box-shadow:0 8px 22px rgba(0,0,0,.5);
  background:linear-gradient(160deg, var(--rar), rgba(0,0,0,.25));
  animation: hcin .4s cubic-bezier(.2,1.3,.4,1) both; transition: transform .18s ease, box-shadow .18s ease; }
@keyframes hcin { from { opacity:0; transform:translateY(18px) scale(.92); } to { opacity:1; transform:none; } }
.hc-card.inparty { box-shadow:0 0 0 3px var(--rar), 0 8px 24px rgba(0,0,0,.55); }
/* rarity-frame glow: rare/epic frames breathe their colour */
.hc-card.r-rare { animation: hcin .4s cubic-bezier(.2,1.3,.4,1) both, hcglow 2.6s ease-in-out .4s infinite; }
.hc-card.r-epic { animation: hcin .4s cubic-bezier(.2,1.3,.4,1) both, hcglow 1.9s ease-in-out .4s infinite; }
@keyframes hcglow { 0%,100% { box-shadow:0 8px 22px rgba(0,0,0,.5), 0 0 6px 0 var(--rar); }
  50% { box-shadow:0 8px 22px rgba(0,0,0,.5), 0 0 20px 2px var(--rar); } }
/* hover tilt + lift (pointer devices) */
@media (hover:hover) {
  .hc-card:hover { transform: perspective(700px) rotateX(4deg) rotateY(-4deg) translateY(-5px) scale(1.02); z-index:2; }
  .hc-card:hover .hc-portrait::after { animation: hcshine .8s ease-out; }
}
/* portrait shine sweep */
.hc-portrait::after { content:''; position:absolute; inset:0; border-radius:12px; pointer-events:none;
  background:linear-gradient(115deg, transparent 30%, rgba(255,255,255,.45) 48%, transparent 62%);
  background-size:260% 100%; background-position:130% 0; }
@keyframes hcshine { from { background-position:130% 0; } to { background-position:-130% 0; } }
/* element badge shimmer */
.hc-elem { position:relative; overflow:hidden; }
.hc-elem::after { content:''; position:absolute; top:0; bottom:0; left:-60%; width:40%;
  background:linear-gradient(105deg, transparent, rgba(255,255,255,.55), transparent);
  animation: hcbadge 3.2s ease-in-out infinite; }
@keyframes hcbadge { 0%,70% { left:-60%; } 100% { left:130%; } }
/* level-up burst: expanding ring + flash + punch */
.hc-card.burst { animation: hcburstcard .5s cubic-bezier(.2,1.6,.4,1); }
@keyframes hcburstcard { 0% { transform:scale(1); } 35% { transform:scale(1.07); } 100% { transform:scale(1); } }
.hc-card.burst::after { content:''; position:absolute; inset:-4px; border-radius:20px; pointer-events:none;
  border:3px solid var(--elem); box-shadow:0 0 24px var(--elem); animation: hcburstring .65s ease-out forwards; }
@keyframes hcburstring { 0% { opacity:1; transform:scale(.96); } 100% { opacity:0; transform:scale(1.22); } }
.hc-frame { position:relative; border-radius:16px; padding:10px 10px 12px; background:linear-gradient(180deg,#241743,#150b2c);
  display:flex; flex-direction:column; gap:6px; overflow:hidden; }
.hc-frame::before { content:''; position:absolute; inset:0; background:radial-gradient(80% 55% at 50% 0%, var(--elem) 0%, transparent 60%); opacity:.22; pointer-events:none; }
.hc-top { display:flex; justify-content:space-between; align-items:center; position:relative; z-index:1; }
.hc-rarity { font-size:10px; font-weight:900; letter-spacing:1.5px; color:var(--rar); }
.hc-elem { font-size:10px; font-weight:900; letter-spacing:.5px; padding:2px 7px; border-radius:9px; color:#fff; background:var(--elem); box-shadow:0 1px 4px rgba(0,0,0,.4); }
.hc-portrait { position:relative; height:118px; border-radius:12px; display:grid; place-items:center; overflow:hidden;
  background:linear-gradient(160deg, var(--elem), var(--accent)); box-shadow:inset 0 3px 10px rgba(255,255,255,.28), inset 0 -6px 14px rgba(0,0,0,.4); z-index:1; }
.hc-glyph { font-size:52px; filter:drop-shadow(0 3px 4px rgba(0,0,0,.5)); }
/* painted portrait (cream card background reads fine inside the frame) */
.hc-art { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; object-position:50% 16%; }
.hc-lvl { position:absolute; bottom:6px; right:6px; background:rgba(10,6,22,.85); border:1px solid rgba(255,255,255,.3);
  border-radius:9px; font-size:12px; font-weight:900; padding:2px 8px; color:#ffe27a; }
.hc-name { font-size:19px; font-weight:900; line-height:1; z-index:1; }
.hc-title { font-size:11px; font-weight:700; color:#c9b6ff; margin-top:-3px; z-index:1; }
.hc-pips { font-size:14px; letter-spacing:2px; color:#ffd54a; z-index:1; }
.hc-role { font-size:11px; font-weight:800; color:#a8e9ff; z-index:1; }
.hc-stats { font-size:12px; font-weight:800; color:#e6dcff; z-index:1; }
.hc-stats .delta { color:#8dff4a; }
.hc-xp { position:relative; height:14px; border-radius:8px; background:rgba(0,0,0,.4); overflow:hidden; z-index:1; }
.hc-xpfill { position:absolute; inset:0; width:0%; background:linear-gradient(90deg,#4fb4ff,#8dff4a); border-radius:8px; transition:width .3s; }
.hc-xptxt { position:absolute; inset:0; display:grid; place-items:center; font-size:10px; font-weight:900; text-shadow:0 1px 2px #000; }
.hc-spell { display:flex; align-items:center; gap:8px; background:rgba(0,0,0,.28); border-radius:10px; padding:6px 8px; z-index:1; }
.hc-sglyph { width:30px; height:30px; flex:0 0 auto; border-radius:8px; display:grid; place-items:center; font-size:17px; background:var(--elem); box-shadow:0 0 8px var(--elem); }
.hc-sinfo { line-height:1.2; }
.hc-sname { font-size:13px; font-weight:900; }
.hc-sblurb { font-size:10px; color:#c9b6ff; }
.hc-actions { display:flex; gap:6px; margin-top:2px; z-index:1; }
.hc-btn { flex:1; pointer-events:auto; border:0; border-radius:11px; font:inherit; font-weight:900; font-size:12px; padding:9px 4px; color:#fff; cursor:pointer;
  box-shadow:0 3px 9px rgba(0,0,0,.4); line-height:1.1; }
.hc-btn:active { transform:scale(.95); }
.hc-lvlup { background:linear-gradient(180deg,#3ad07a,#1f9a54); }
.hc-lvlup.free { background:linear-gradient(180deg,#ffd54a,#e0a020); color:#5a3d00; }
.hc-lvlup.no { background:#4a4470; color:#b9b1d8; }
.hc-lvlup.max { background:#3a2f66; color:#ffd54a; }
.hc-party-btn { flex:0 0 auto; min-width:48px; background:linear-gradient(180deg,#4a7bff,#2a4fb0); }
.hc-party-btn.in { background:linear-gradient(180deg,#3ad07a,#1f9a54); }
.hc-party-btn.no { background:#4a4470; color:#b9b1d8; }

/* locked overlay */
.hc-lock { position:absolute; inset:3px; border-radius:16px; background:rgba(8,5,18,.74); backdrop-filter:blur(2px);
  display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; z-index:3; }
.hc-lock .lk { font-size:40px; opacity:.9; }
.hc-lock .lname { font-size:16px; font-weight:900; }
.hc-unlock { pointer-events:auto; border:0; border-radius:12px; font:inherit; font-weight:900; font-size:14px; padding:10px 16px; cursor:pointer; color:#fff;
  background:linear-gradient(180deg,#c06bff,#7b2ff7); box-shadow:0 4px 12px rgba(0,0,0,.45); }
.hc-unlock.no { background:#4a4470; color:#b9b1d8; }
.hc-unlock:active { transform:scale(.95); }

/* signature row (the hero's one-of-a-kind mechanic) */
.hc-sig { display:flex; align-items:center; gap:8px; border-radius:10px; padding:6px 8px; z-index:1;
  background:linear-gradient(90deg, rgba(255,255,255,.07), rgba(0,0,0,.28)); border:1px dashed rgba(255,255,255,.18); }
.hc-sig.awake { border-style:solid; border-color:var(--elem); box-shadow:0 0 10px -2px var(--elem); }
.hc-sig .sg { width:30px; height:30px; flex:0 0 auto; border-radius:8px; display:grid; place-items:center; font-size:16px;
  background:rgba(0,0,0,.35); border:1px solid var(--elem); }
.hc-sig.awake .sg { background:var(--elem); box-shadow:0 0 8px var(--elem); }
.hc-sig .sn2 { font-size:12px; font-weight:900; }
.hc-sig .sb2 { font-size:10px; color:#c9b6ff; }
.hc-sig .slock { margin-left:auto; font-size:9px; font-weight:900; color:#9d8fc5; white-space:nowrap; }
.hc-sig.awake .slock { color:#8dff4a; }

/* detail modal — the hero's full page: story, signature, spell, resonance, stats */
.hcd-veil { position:fixed; inset:0; z-index:60; background:rgba(8,5,18,.72); backdrop-filter:blur(4px);
  display:grid; place-items:center; padding:14px; animation:hcdfade .22s ease-out; }
@keyframes hcdfade { from { opacity:0; } to { opacity:1; } }
.hcd { position:relative; width:min(420px, 96vw); max-height:min(86vh, 780px); overflow-y:auto; -webkit-overflow-scrolling:touch;
  border-radius:20px; padding:3px; background:linear-gradient(160deg, var(--rar), rgba(0,0,0,.3));
  box-shadow:0 18px 50px rgba(0,0,0,.65), 0 0 30px -6px var(--elem); animation:hcdin .3s cubic-bezier(.2,1.4,.4,1); }
@keyframes hcdin { from { opacity:0; transform:translateY(26px) scale(.94); } to { opacity:1; transform:none; } }
.hcd-frame { border-radius:17px; background:linear-gradient(180deg,#241743,#130a28); padding:14px 14px 16px; display:flex; flex-direction:column; gap:10px; position:relative; overflow:hidden; }
.hcd-frame::before { content:''; position:absolute; inset:0; background:radial-gradient(90% 40% at 50% 0%, var(--elem) 0%, transparent 62%); opacity:.25; pointer-events:none; }
.hcd-x { position:absolute; top:10px; right:10px; z-index:5; width:34px; height:34px; border:0; border-radius:50%; font:inherit; font-weight:900; font-size:16px;
  color:#fff; background:rgba(0,0,0,.45); border:1px solid rgba(255,255,255,.25); cursor:pointer; }
.hcd-x:active { transform:scale(.9); }
.hcd-head { display:flex; gap:12px; align-items:center; z-index:1; }
.hcd-port { position:relative; width:96px; height:96px; flex:0 0 auto; border-radius:16px; display:grid; place-items:center; font-size:44px; overflow:hidden;
  border:2px solid var(--rar);
  background:linear-gradient(160deg, var(--elem), var(--accent)); box-shadow:inset 0 3px 10px rgba(255,255,255,.28), inset 0 -6px 14px rgba(0,0,0,.4), 0 0 16px -4px var(--elem); }
.hcd-art { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; object-position:50% 12%; }
.hcd-hn { font-size:24px; font-weight:900; line-height:1.05; }
.hcd-ht { font-size:12px; font-weight:700; color:#c9b6ff; }
.hcd-tags { display:flex; gap:5px; flex-wrap:wrap; margin-top:5px; }
.hcd-tag { font-size:9px; font-weight:900; letter-spacing:.6px; padding:2px 7px; border-radius:8px; background:rgba(0,0,0,.35); border:1px solid rgba(255,255,255,.2); }
.hcd-quote { z-index:1; font-size:13px; font-style:italic; color:#ffe27a; text-align:center; padding:2px 6px; }
.hcd-story { z-index:1; font-size:12.5px; line-height:1.5; color:#e6dcff; background:rgba(0,0,0,.24); border-radius:12px; padding:10px 12px; }
.hcd-sec { z-index:1; display:flex; flex-direction:column; gap:4px; background:rgba(0,0,0,.24); border-radius:12px; padding:9px 11px; border-left:3px solid var(--elem); }
.hcd-sec .h { font-size:10px; font-weight:900; letter-spacing:1.2px; color:#9d8fc5; }
.hcd-sec .t { font-size:14px; font-weight:900; }
.hcd-sec .d { font-size:11.5px; line-height:1.45; color:#cfc2f2; }
.hcd-sec .lock { font-size:10px; font-weight:900; color:#ffd54a; }
.hcd-stats { z-index:1; display:grid; grid-template-columns:repeat(4, 1fr); gap:6px; }
.hcd-stat { background:rgba(0,0,0,.3); border-radius:10px; padding:7px 4px; text-align:center; }
.hcd-stat .v { font-size:15px; font-weight:900; font-variant-numeric:tabular-nums; }
.hcd-stat .v .delta { font-size:10px; color:#8dff4a; }
.hcd-stat .k { font-size:9px; font-weight:900; letter-spacing:.8px; color:#9d8fc5; }
.hcd-actions { z-index:1; display:flex; gap:8px; }
.hcd-actions .hc-btn { font-size:14px; padding:12px 6px; }

/* toast */
.hc-toast { position:fixed; left:50%; bottom:14%; transform:translateX(-50%); z-index:50; padding:12px 22px; border-radius:14px;
  font-weight:900; font-size:17px; color:#fff; background:linear-gradient(180deg,#2f2258,#1a1030); border:2px solid; box-shadow:0 8px 22px rgba(0,0,0,.55);
  animation:hctoast 1.6s ease-out forwards; white-space:nowrap; }
@keyframes hctoast { 0%{ opacity:0; transform:translateX(-50%) translateY(14px) scale(.8);} 15%{ opacity:1; transform:translateX(-50%) translateY(0) scale(1);} 80%{ opacity:1;} 100%{ opacity:0; } }
`

export class HeroCollection {
  readonly root: HTMLDivElement
  private styleEl: HTMLStyleElement
  private scroll: HTMLDivElement
  private grid: HTMLDivElement
  private walletEl: HTMLDivElement
  private partySlots: HTMLDivElement
  private partyHint: HTMLElement
  private onBack: () => void
  private rebuildLoadoutBar: (() => void) | null = null
  private bondPanel: BondPanel | null = null

  constructor(onBack: () => void) {
    this.onBack = onBack
    this.styleEl = el('style')
    this.styleEl.textContent = CSS
    document.head.appendChild(this.styleEl)

    this.root = el('div', 'hc-root')
    this.scroll = el('div', 'hc-scroll')
    this.root.append(this.scroll)

    // header
    const head = el('div', 'hc-head')
    const back = el('button', 'hc-back', '‹ BACK')
    back.onclick = () => this.onBack()
    head.append(back, el('div', 'hc-title', 'HEROES'))
    const bonds = el('button', 'hc-back', '🐉 BONDS')
    bonds.onclick = () => this.openBonds()
    head.append(bonds)
    this.walletEl = el('div', 'hc-wallet')
    head.append(this.walletEl)
    this.scroll.append(head)

    // party strip
    const pbar = el('div', 'hc-party-bar')
    pbar.append(el('div', 'hc-party-lbl', 'PARTY'))
    this.partySlots = el('div', 'hc-party-slots')
    pbar.append(this.partySlots)
    this.partyHint = el('div', 'hc-party-hint', '')
    pbar.append(this.partyHint)
    this.scroll.append(pbar)

    // loadout slots (store convenience, casual only — Ranked always uses Slot 1)
    if (economy.loadoutSlots() > 1) {
      const lb = el('div', 'hc-party-bar')
      lb.append(el('div', 'hc-party-lbl', 'LOADOUT'))
      const chips = el('div', 'hc-party-slots')
      for (let i = 0; i < economy.loadoutSlots(); i++) {
        const chip = el('button', 'hc-lo' + (economy.activeLoadout() === i ? ' on' : ''), `SLOT ${i + 1}`)
        chip.onclick = () => {
          economy.setActiveLoadout(i)
          this.rebuildLoadoutBar?.()
          this.render()
        }
        chips.append(chip)
      }
      lb.append(chips, el('div', 'hc-party-hint', 'Ranked always uses Slot 1'))
      this.scroll.append(lb)
      this.rebuildLoadoutBar = () => {
        const btns = lb.querySelectorAll<HTMLButtonElement>('.hc-lo')
        btns.forEach((b, i) => b.classList.toggle('on', economy.activeLoadout() === i))
      }
    }

    // grid
    this.grid = el('div', 'hc-grid')
    this.scroll.append(this.grid)

    document.body.appendChild(this.root)
    this.render()
  }

  private burstHeroId: string | null = null // card that just levelled → play burst

  private render(): void {
    this.renderWallet()
    this.renderParty()
    this.grid.innerHTML = ''
    let i = 0
    for (const id of HERO_ORDER) {
      const def = HEROES[id]
      if (def) {
        const card = this.buildCard(def)
        card.style.animationDelay = `${Math.min(0.36, i * 0.045)}s`
        this.grid.append(card)
        i++
      }
    }
    this.burstHeroId = null
  }

  private renderWallet(): void {
    this.walletEl.innerHTML = ''
    const shards = el('div', 'hc-cur')
    shards.append(iconEl('span', 'ci', currencyIcon('shard', { size: 15 })), el('span', undefined, String(economy.heroShards)))
    const coins = el('div', 'hc-cur')
    coins.append(iconEl('span', 'ci', currencyIcon('coin', { size: 15 })), el('span', undefined, String(economy.coins)))
    this.walletEl.append(shards, coins)
  }

  private renderParty(): void {
    this.partySlots.innerHTML = ''
    const party = economy.party()
    for (let i = 0; i < MAX_PARTY; i++) {
      const id = party[i]
      const slot = el('div', 'hc-slot')
      if (id && HEROES[id]) {
        const def = HEROES[id]
        slot.classList.add('filled')
        const art = heroArtUrl(id)
        if (art) {
          // zoomed face crop of the painted portrait
          slot.style.background = `url('${art}') 50% 12% / 210% auto no-repeat`
        } else {
          slot.innerHTML = elementIcon(def.element, { size: 34, color: '#fff' })
          slot.style.background = `linear-gradient(160deg, ${hex(def.color)}, ${hex(def.accent)})`
        }
        slot.style.borderColor = hex(def.color)
        slot.style.color = hex(def.color)
      } else {
        slot.textContent = '+'
      }
      this.partySlots.append(slot)
    }
    this.partyHint.textContent = `${party.length}/${MAX_PARTY} · pick up to ${MAX_PARTY}`
  }

  private buildCard(def: HeroDef): HTMLElement {
    const st = economy.heroState(def.id)
    const card = el('div', 'hc-card')
    card.style.setProperty('--elem', hex(def.color))
    card.style.setProperty('--accent', hex(def.accent))
    card.style.setProperty('--rar', hex(RARITY_COLOR[def.rarity]))
    const inParty = economy.party().includes(def.id)
    if (inParty) card.classList.add('inparty')
    card.classList.add('r-' + def.rarity)
    if (this.burstHeroId === def.id) {
      card.classList.add('burst')
      window.setTimeout(() => card.classList.remove('burst'), 700)
    }

    const frame = el('div', 'hc-frame')

    const top = el('div', 'hc-top')
    top.append(el('div', 'hc-rarity', RARITY_LABEL[def.rarity]))
    const elem = iconEl('div', 'hc-elem', `${elementIcon(def.element, { size: 12, color: '#fff' })} ${def.element}`)
    elem.style.background = hex(def.color)
    top.append(elem)
    frame.append(top)

    const portrait = el('div', 'hc-portrait')
    const art = heroArtUrl(def.id)
    if (art) {
      const img = el('img', 'hc-art')
      img.src = art
      img.alt = def.name
      img.draggable = false
      img.loading = 'lazy'
      portrait.append(img)
    } else {
      portrait.append(iconEl('div', 'hc-glyph', elementIcon(def.element, { size: 44 })))
    }
    portrait.append(el('div', 'hc-lvl', `Lv ${st.level}`))
    portrait.style.cursor = 'pointer'
    portrait.onclick = () => this.openDetail(def)
    frame.append(portrait)

    frame.append(el('div', 'hc-name', def.name))
    frame.append(el('div', 'hc-title', def.title))

    const pips = Math.max(1, Math.min(5, Math.ceil(st.level / 4)))
    frame.append(el('div', 'hc-pips', '★'.repeat(pips) + '☆'.repeat(5 - pips)))
    frame.append(el('div', 'hc-role', `${def.role} · ${def.damageType}`))

    // stats with next-level delta
    const cur = heroStats(def, st.level)
    const stats = el('div', 'hc-stats')
    if (st.level < MAX_HERO_LEVEL) {
      const nxt = heroStats(def, st.level + 1)
      const dd = Math.round(nxt.damage - cur.damage)
      stats.innerHTML = `DMG ${Math.round(cur.damage)} <span class="delta">▲${dd}</span> · RNG ${cur.range.toFixed(1)} · ${cur.cooldown.toFixed(2)}s`
    } else {
      stats.textContent = `DMG ${Math.round(cur.damage)} · RNG ${cur.range.toFixed(1)} · ${cur.cooldown.toFixed(2)}s`
    }
    frame.append(stats)

    // XP bar
    const xpWrap = el('div', 'hc-xp')
    const fill = el('div', 'hc-xpfill')
    const need = xpForLevel(st.level)
    const frac = st.level >= MAX_HERO_LEVEL ? 1 : Math.max(0, Math.min(1, st.xp / need))
    fill.style.width = `${Math.round(frac * 100)}%`
    xpWrap.append(fill)
    xpWrap.append(el('div', 'hc-xptxt', st.level >= MAX_HERO_LEVEL ? 'MAX LEVEL' : `XP ${st.xp}/${need}`))
    frame.append(xpWrap)

    // spell
    const spell = heroSpellScaled(def.spell, st.level)
    const spellEl = el('div', 'hc-spell')
    const sg = iconEl('div', 'hc-sglyph', glyphIcon(def.spell.glyph, { size: 20, color: '#fff' }))
    sg.style.background = hex(def.color)
    const sinfo = el('div', 'hc-sinfo')
    const dmgTxt = spell.damage ? ` (${Math.round(spell.damage)})` : ''
    sinfo.append(el('div', 'hc-sname', def.spell.name + dmgTxt), el('div', 'hc-sblurb', def.spell.blurb))
    spellEl.append(sg, sinfo)
    frame.append(spellEl)

    // SIGNATURE — the one mechanic nobody else has (awakens at Lv 3)
    const awake = signatureAwake(st.level)
    const sigEl = el('div', `hc-sig${awake ? ' awake' : ''}`)
    sigEl.append(iconEl('div', 'sg', glyphIcon(def.signature.glyph, { size: 20, color: hex(def.color) })))
    const siginfo = el('div')
    siginfo.append(el('div', 'sn2', def.signature.name), el('div', 'sb2', def.signature.blurb))
    sigEl.append(siginfo)
    sigEl.append(el('div', 'slock', awake ? 'AWAKE' : `Lv ${SIGNATURE_UNLOCK_LEVEL}`))
    frame.append(sigEl)

    // actions
    const actions = el('div', 'hc-actions')
    actions.append(this.levelUpButton(def, st.level, st.xp))
    actions.append(this.partyButton(def, inParty))
    frame.append(actions)

    card.append(frame)

    // locked overlay
    if (!st.unlocked) card.append(this.lockOverlay(def))
    return card
  }

  private levelUpButton(def: HeroDef, level: number, xp: number): HTMLButtonElement {
    if (level >= MAX_HERO_LEVEL) {
      const b = el('button', 'hc-btn hc-lvlup max', 'MAX')
      b.disabled = true
      return b
    }
    const free = xp >= xpForLevel(level)
    const cost = shardCostForLevel(level)
    const afford = free || economy.heroShards >= cost
    const b = el('button', `hc-btn hc-lvlup ${free ? 'free' : afford ? '' : 'no'}`)
    b.innerHTML = free ? 'LEVEL UP<br>FREE ★' : `LEVEL UP<br>${cost} 🔹`
    b.onclick = () => {
      const res = economy.levelUpHero(def.id)
      if (res) {
        this.burstHeroId = def.id
        const newLevel = economy.heroState(def.id).level
        // crossing the awaken threshold is a MOMENT — celebrate the signature
        if (newLevel === SIGNATURE_UNLOCK_LEVEL) this.toast(`${def.signature.name.toUpperCase()} AWAKENED!`, def.color)
        else this.toast(`${def.name} → Lv ${newLevel}!`, def.color)
        this.render()
      } else this.toast('Not enough shards', 0xff5b7a)
    }
    return b
  }

  private partyButton(def: HeroDef, inParty: boolean): HTMLButtonElement {
    const full = economy.party().length >= MAX_PARTY && !inParty
    const b = el('button', `hc-btn hc-party-btn ${inParty ? 'in' : full ? 'no' : ''}`)
    b.textContent = inParty ? '✓' : full ? 'FULL' : '＋'
    b.onclick = () => {
      if (!inParty && full) { this.toast(`Party is full (${MAX_PARTY})`, 0xff5b7a); return }
      economy.toggleParty(def.id)
      this.render()
    }
    return b
  }

  private lockOverlay(def: HeroDef): HTMLElement {
    const ov = el('div', 'hc-lock')
    ov.append(el('div', 'lk', '🔒'), el('div', 'lname', def.name))
    const afford = economy.heroShards >= def.unlockShards
    const btn = el('button', `hc-unlock ${afford ? '' : 'no'}`, `UNLOCK · ${def.unlockShards} 🔹`)
    btn.onclick = () => {
      if (economy.unlockHero(def.id)) { this.toast(`${def.name} unlocked!`, def.color); this.render() }
      else this.toast('Not enough shards', 0xff5b7a)
    }
    ov.append(btn)
    return ov
  }

  // ------------------------------------------------------------- hero detail
  // The hero's full page: story, catchphrase, signature, spell, resonance and a
  // level-up path — the collection card answers "what", this answers "who & why".
  private openDetail(def: HeroDef): void {
    this.closeDetail()
    const st = economy.heroState(def.id)
    const awake = signatureAwake(st.level)

    const veil = el('div', 'hcd-veil')
    veil.onclick = (ev) => { if (ev.target === veil) this.closeDetail() }
    const box = el('div', 'hcd')
    box.style.setProperty('--elem', hex(def.color))
    box.style.setProperty('--accent', hex(def.accent))
    box.style.setProperty('--rar', hex(RARITY_COLOR[def.rarity]))
    const frame = el('div', 'hcd-frame')

    const x = el('button', 'hcd-x', '✕')
    x.onclick = () => this.closeDetail()
    frame.append(x)

    // header
    const head = el('div', 'hcd-head')
    const port = el('div', 'hcd-port')
    const artUrl = heroArtUrl(def.id)
    if (artUrl) {
      const img = el('img', 'hcd-art')
      img.src = artUrl
      img.alt = def.name
      img.draggable = false
      port.append(img)
    } else {
      port.innerHTML = elementIcon(def.element, { size: 52 })
    }
    const hh = el('div')
    hh.append(el('div', 'hcd-hn', def.name), el('div', 'hcd-ht', `${def.title} · Lv ${st.level}`))
    const tags = el('div', 'hcd-tags')
    for (const t of [def.element, def.role, def.damageType, RARITY_LABEL[def.rarity]]) {
      const tag = t === def.element
        ? iconEl('div', 'hcd-tag', `${elementIcon(def.element, { size: 12, color: hex(def.color) })} ${def.element}`)
        : el('div', 'hcd-tag', String(t))
      tag.style.color = hex(def.color)
      tags.append(tag)
    }
    hh.append(tags)
    head.append(port, hh)
    frame.append(head)

    frame.append(el('div', 'hcd-quote', `“${def.catchphrase}”`))
    frame.append(el('div', 'hcd-story', def.story))

    // signature
    const sig = el('div', 'hcd-sec')
    sig.append(el('div', 'h', 'SIGNATURE'))
    sig.append(iconEl('div', 't', `${glyphIcon(def.signature.glyph, { size: 15, color: hex(def.color) })} ${esc(def.signature.name)}`))
    sig.append(el('div', 'd', def.signature.detail))
    if (!awake) sig.append(iconEl('div', 'lock', `${glyphIcon('🔒', { size: 13 })} Dormant — awakens at Lv ${SIGNATURE_UNLOCK_LEVEL}. Level ${esc(def.name)} up to unleash it.`))
    frame.append(sig)

    // spell (level-scaled)
    const sp = heroSpellScaled(def.spell, st.level)
    const spellSec = el('div', 'hcd-sec')
    spellSec.append(el('div', 'h', 'ACTIVE SPELL'))
    spellSec.append(iconEl('div', 't', `${glyphIcon(def.spell.glyph, { size: 15, color: hex(def.color) })} ${esc(sp.name)}`))
    const bits: string[] = []
    if (sp.damage) bits.push(`${Math.round(sp.damage)} dmg`)
    if (sp.radius) bits.push(`${sp.radius} tile radius`)
    if (sp.stunDuration) bits.push(`${sp.stunDuration}s freeze`)
    if (sp.burnDps) bits.push(`${Math.round(sp.burnDps)}/s burn`)
    if (sp.heal) bits.push(`restores ${sp.heal} lives`)
    if (sp.chainCount) bits.push(`arcs ×${sp.chainCount}`)
    if (sp.buffMult) bits.push(`×${sp.buffMult} team damage`)
    if (sp.executeMult) bits.push(`×${sp.executeMult} vs weakened foes`)
    spellSec.append(el('div', 'd', `${sp.blurb} — ${bits.join(' · ')} · ${sp.cooldown}s cooldown.`))
    frame.append(spellSec)

    // resonance
    const rInfo = resonanceInfo(def.resonantTower)
    const pc = (m: number): string => `+${Math.round((m - 1) * 100)}%`
    const resSec = el('div', 'hcd-sec')
    resSec.append(el('div', 'h', 'ELEMENT RESONANCE'))
    resSec.append(iconEl('div', 't', `${glyphIcon('🔗', { size: 15, color: hex(def.color) })} ${esc(rInfo.towerName)} Resonance`))
    resSec.append(el('div', 'd',
      `Field ${def.name} beside 2+ ${rInfo.towerName} towers: ${pc(rInfo.t1Tower)} tower damage & ${pc(rInfo.t1Hero)} hero damage. ` +
      `At ${rInfo.t2Count}+ towers it deepens to ${pc(rInfo.t2Tower)} / ${pc(rInfo.t2Hero)}.`))
    if (!awake) resSec.append(iconEl('div', 'lock', `${glyphIcon('🔒', { size: 13 })} Requires the signature awake (Lv ${SIGNATURE_UNLOCK_LEVEL}).`))
    frame.append(resSec)

    // stats grid (current → next level delta)
    const cur = heroStats(def, st.level)
    const nxt = st.level < MAX_HERO_LEVEL ? heroStats(def, st.level + 1) : null
    const stats = el('div', 'hcd-stats')
    const stat = (k: string, v: string, delta?: string): void => {
      const s = el('div', 'hcd-stat')
      const vv = el('div', 'v', v)
      if (delta) {
        const d = el('span', 'delta', ` ${delta}`)
        vv.append(d)
      }
      s.append(vv, el('div', 'k', k))
      stats.append(s)
    }
    stat('DAMAGE', String(Math.round(cur.damage)), nxt ? `▲${Math.round(nxt.damage - cur.damage)}` : undefined)
    stat('DPS', String(Math.round(cur.dps)), nxt ? `▲${Math.round(nxt.dps - cur.dps)}` : undefined)
    stat('RANGE', cur.range.toFixed(1), undefined)
    stat('RATE', `${cur.cooldown.toFixed(2)}s`, undefined)
    frame.append(stats)

    // actions
    const actions = el('div', 'hcd-actions')
    if (st.unlocked) {
      const lvlBtn = this.levelUpButton(def, st.level, st.xp)
      const prevClick = lvlBtn.onclick
      lvlBtn.onclick = (ev) => {
        prevClick?.call(lvlBtn, ev)
        // re-open on the fresh state so numbers/awaken state update live
        if (document.querySelector('.hcd-veil')) this.openDetail(def)
      }
      actions.append(lvlBtn)
    }
    frame.append(actions)

    box.append(frame)
    veil.append(box)
    document.body.appendChild(veil)
  }

  private closeDetail(): void {
    document.querySelectorAll('.hcd-veil').forEach((n) => n.remove())
  }

  private toast(msg: string, color: number): void {
    const t = el('div', 'hc-toast', msg)
    t.style.borderColor = hex(color)
    t.style.color = color === 0xff5b7a ? '#ffd0da' : '#fff'
    document.body.appendChild(t)
    window.setTimeout(() => t.remove(), 1650)
  }

  // The Wyrmroost — assign a Wyrm to a hero + preview the Attunement bonus.
  private openBonds(): void {
    if (this.bondPanel) return
    this.bondPanel = new BondPanel(() => {
      this.bondPanel = null
      this.render() // reflect any new bonds on the hero cards' sigils
    })
  }

  dispose(): void {
    this.closeDetail()
    this.bondPanel?.destroy()
    this.bondPanel = null
    this.root.remove()
    this.styleEl.remove()
    document.querySelectorAll('.hc-toast').forEach((n) => n.remove())
  }
}
