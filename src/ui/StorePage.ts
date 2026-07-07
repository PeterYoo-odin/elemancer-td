// StorePage — the F2P store as a polished HTML/CSS overlay (like FrontPage /
// BattleHud). ShopScene owns its lifecycle; this file is presentation + the
// thin calls into economy (the single wallet authority).
//
// Spend-positive by design: every card says exactly what you get, every card
// carries "Ranked effect: NONE", rotation is a rotation (not extortion), and
// money UI (packs / Plus / ads / starter kit) is MOCK — nothing charges here.

import { economy } from '../game/economy'
import {
  CATALOG,
  shelfSkus,
  skuById,
  rotationFor,
  DIAMOND_PACKS,
  STARTER_KIT,
  PLUS_SUB,
  REWARDED_ADS,
  THANKYOU_LINES,
  RESTORERS_WALL_STUB,
  PASS_SEASON_NAME,
  PASS_TIERS,
  PASS_TIER_XP,
  PASS_TRACK,
  PASS_DUTIES,
  PASS_PREMIUM_DIAMONDS,
  PASS_PREMIUM_USD,
  type Sku,
  type PassReward,
} from '../game/cosmetics'
import { uiDyeAccent } from '../game/skins'
import { heroArtUrl } from './heroArt'
import { playUiTick } from './sfx'

export interface StorePageHandlers {
  onBack(): void
}

type Tab = 'featured' | 'skins' | 'utility' | 'pass' | 'diamonds' | 'ledger'

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'featured', label: 'FEATURED' },
  { id: 'skins', label: 'SKINS' },
  { id: 'utility', label: 'UTILITY' },
  { id: 'pass', label: 'PRISM PASS' },
  { id: 'diamonds', label: 'DIAMONDS' },
  { id: 'ledger', label: 'FAIR LEDGER' },
]

const CSS = `
.est, .est * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; user-select: none; }
.est {
  --acc: #c06bff;
  position: fixed; inset: 0; z-index: 15; display: flex; flex-direction: column; color: #efe9ff;
  font-family: system-ui, -apple-system, 'Segoe UI', Arial, sans-serif;
  padding-top: env(safe-area-inset-top);
  background:
    radial-gradient(90% 50% at 50% -10%, rgba(123,47,247,.28), transparent 60%),
    linear-gradient(180deg, #120b28 0%, #0a0716 60%, #070510 100%);
  transition: opacity .25s ease;
}
.est.est-leave { opacity: 0; pointer-events: none; }

/* header */
.est-head { display: flex; align-items: center; gap: 9px; padding: 12px 14px 8px; max-width: 620px; width: 100%; margin: 0 auto; }
.est-back { width: 40px; height: 40px; border-radius: 50%; border: 1px solid rgba(255,255,255,.16); flex: 0 0 auto;
  background: rgba(255,255,255,.06); color: #e6ddff; font-size: 21px; cursor: pointer; }
.est-title { font-size: 21px; font-weight: 900; letter-spacing: .18em; color: #fff; margin-right: auto; }
.est-chip { display: flex; align-items: center; gap: 5px; padding: 6px 11px 6px 8px; border-radius: 999px; flex: 0 0 auto;
  background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.13); font-weight: 800; font-size: 13.5px; }
.est-chip.c1 { color: #ffe08a; } .est-chip.c2 { color: #c9f2ff; } .est-chip.c3 { color: #e2c9ff; }

/* constitution ribbon */
.est-ribbon { max-width: 620px; width: calc(100% - 28px); margin: 2px auto 8px; padding: 8px 12px; border-radius: 12px;
  background: rgba(46,160,67,.12); border: 1px solid rgba(70,220,110,.35); color: #b8f5c9;
  font-size: 12px; font-weight: 700; letter-spacing: .04em; text-align: center; line-height: 1.5; }
.est-ribbon b { color: #7dffb0; }

/* tabs */
.est-tabs { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; padding: 0 14px 10px; max-width: 620px; width: 100%; margin: 0 auto; }
.est-tabs::-webkit-scrollbar { display: none; }
.est-tab { flex: 0 0 auto; padding: 8px 13px; border-radius: 999px; border: 1px solid rgba(255,255,255,.14);
  background: rgba(255,255,255,.05); color: #b6a9dd; font: inherit; font-size: 12px; font-weight: 800; letter-spacing: .1em; cursor: pointer;
  transition: background .18s ease, color .18s ease, border-color .18s ease; }
.est-tab.on { background: color-mix(in srgb, var(--acc) 26%, transparent); color: #fff; border-color: color-mix(in srgb, var(--acc) 65%, transparent); }

/* scroll body */
.est-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch;
  padding: 2px 14px calc(22px + env(safe-area-inset-bottom)); }
.est-inner { max-width: 620px; margin: 0 auto; display: flex; flex-direction: column; gap: 12px; }
.est-h2 { font-size: 13px; font-weight: 900; letter-spacing: .2em; color: #b6a9dd; margin: 10px 2px 0; }
.est-note { font-size: 12px; color: #9d92c4; line-height: 1.6; padding: 0 2px; }
.est-note b { color: #d9ceff; }

/* item card */
.est-card { display: flex; align-items: center; gap: 12px; padding: 11px 12px; border-radius: 16px;
  background: linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.025));
  border: 1px solid rgba(255,255,255,.11); }
.est-card.gated { opacity: .82; }
.est-sw { flex: 0 0 auto; width: 52px; height: 52px; border-radius: 13px; border: 1px solid rgba(255,255,255,.2);
  display: flex; align-items: center; justify-content: center; font-size: 24px; overflow: hidden;
  background: rgba(255,255,255,.05); background-size: cover; background-position: 50% 14%; }
.est-sw .swb { width: 100%; height: 100%; }
.est-tx { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.est-nm { font-size: 14.5px; font-weight: 800; letter-spacing: .03em; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.est-ds { font-size: 11.5px; color: #a99dd1; line-height: 1.45; }
.est-rk { font-size: 9px; font-weight: 900; letter-spacing: .1em; color: #7dffb0; border: 1px solid rgba(70,220,110,.4);
  border-radius: 999px; padding: 2px 6px; background: rgba(46,160,67,.12); flex: 0 0 auto; }
.est-cas { font-size: 9px; font-weight: 900; letter-spacing: .1em; color: #ffc98a; border: 1px solid rgba(255,170,80,.45);
  border-radius: 999px; padding: 2px 6px; background: rgba(255,140,40,.12); flex: 0 0 auto; }
.est-gate { font-size: 10.5px; color: #ff9db0; font-weight: 700; }
.est-act { flex: 0 0 auto; display: flex; flex-direction: column; gap: 5px; align-items: stretch; min-width: 92px; }
.est-buy { padding: 8px 10px; border-radius: 11px; border: 0; font: inherit; font-size: 12.5px; font-weight: 900; letter-spacing: .05em;
  cursor: pointer; background: linear-gradient(180deg, #ffe9a8, #eda528 80%); color: #3a2604; white-space: nowrap; }
.est-buy.pri2 { background: linear-gradient(180deg, #e8d2ff, #a86bf0 85%); color: #2a0a4a; }
.est-buy.confirm { background: linear-gradient(180deg, #b8ffd2, #2ea043 85%); color: #04310f; }
.est-buy.poor { opacity: .45; cursor: default; }
.est-buy.mock { background: rgba(255,255,255,.09); color: #b9adde; border: 1px solid rgba(255,255,255,.18); }
.est-eq { padding: 7px 10px; border-radius: 11px; font: inherit; font-size: 11.5px; font-weight: 800; letter-spacing: .06em; cursor: pointer;
  background: rgba(255,255,255,.07); color: #d9ceff; border: 1px solid rgba(255,255,255,.2); white-space: nowrap; }
.est-eq.on { background: rgba(46,160,67,.2); border-color: rgba(70,220,110,.5); color: #9dffbe; }

/* rotation strip */
.est-rot { font-size: 11px; color: #8f84b8; letter-spacing: .05em; padding: 0 2px; }

/* pass */
.est-pass-head { border-radius: 18px; padding: 14px; border: 1px solid rgba(255,190,80,.4);
  background: linear-gradient(160deg, rgba(90,30,6,.55), rgba(40,12,40,.5)); display: flex; flex-direction: column; gap: 8px; }
.est-pass-season { font-size: 15px; font-weight: 900; letter-spacing: .12em; color: #ffce7a; }
.est-pass-sub { font-size: 11.5px; color: #e8d5bd; line-height: 1.5; }
.est-bar { height: 12px; border-radius: 999px; background: rgba(0,0,0,.4); overflow: hidden; border: 1px solid rgba(255,255,255,.14); }
.est-bar > div { height: 100%; border-radius: 999px; background: linear-gradient(90deg, #ffb24c, #ffd76a); transition: width .4s ease; }
.est-pass-xp { font-size: 11px; font-weight: 800; color: #ffe2ad; letter-spacing: .06em; }
.est-tier { display: grid; grid-template-columns: 44px 1fr 1fr; gap: 8px; align-items: center; padding: 8px 10px;
  border-radius: 12px; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08); }
.est-tier.reached { border-color: rgba(255,205,110,.4); }
.est-tn2 { font-size: 13px; font-weight: 900; color: #cfc2f2; text-align: center; }
.est-tr { font-size: 11px; line-height: 1.35; color: #cbc0ea; }
.est-tr.locked { color: #6d6394; }
.est-tr b { color: #ffe2ad; }
.est-tr .exl { color: #e2c9ff; font-weight: 800; }
.est-duty { font-size: 11.5px; color: #b8ffd0; line-height: 1.7; }

/* ledger table */
.est-led { width: 100%; border-collapse: collapse; font-size: 10.5px; }
.est-led th { text-align: left; padding: 6px 6px; color: #b6a9dd; font-size: 9px; letter-spacing: .12em; border-bottom: 1px solid rgba(255,255,255,.18); }
.est-led td { padding: 6px 6px; border-bottom: 1px solid rgba(255,255,255,.06); color: #cfc4ee; vertical-align: top; line-height: 1.4; }
.est-led td.ok { color: #7dffb0; font-weight: 900; white-space: nowrap; }
.est-wall { border-radius: 16px; padding: 14px; text-align: center; border: 1px dashed rgba(255,215,106,.4);
  background: rgba(255,190,80,.06); color: #ffe2ad; font-size: 12px; line-height: 1.8; }

/* modal + bloom */
.est-overlay { position: fixed; inset: 0; z-index: 30; display: flex; align-items: center; justify-content: center;
  background: rgba(4,2,12,.7); backdrop-filter: blur(4px); padding: 24px; animation: estFade .2s ease both; }
@keyframes estFade { from { opacity: 0; } to { opacity: 1; } }
.est-modal { width: min(380px, 92vw); border-radius: 20px; padding: 20px; text-align: center;
  background: linear-gradient(180deg, #201640, #170f30); border: 1px solid rgba(255,255,255,.16);
  display: flex; flex-direction: column; gap: 12px; }
.est-mt { font-size: 15px; font-weight: 900; letter-spacing: .12em; color: #ffd76a; }
.est-mb { font-size: 13px; color: #ded4f6; line-height: 1.6; }
.est-mbtn { padding: 10px; border-radius: 12px; border: 1px solid rgba(255,255,255,.16); background: rgba(255,255,255,.07);
  color: #efe9ff; font: inherit; font-size: 13px; font-weight: 800; letter-spacing: .1em; cursor: pointer; }

.est-bloom { position: fixed; inset: 0; z-index: 40; pointer-events: none; display: flex; align-items: center; justify-content: center; }
.est-bloom .wave { position: absolute; left: 50%; top: 50%; width: 40px; height: 40px; border-radius: 50%;
  transform: translate(-50%,-50%); opacity: .9;
  background: radial-gradient(circle, rgba(255,220,140,.85), rgba(255,120,180,.5) 40%, rgba(120,80,255,.35) 65%, transparent 72%);
  animation: estBloom 1.5s cubic-bezier(.16,.84,.3,1) forwards; }
@keyframes estBloom { to { width: 260vmax; height: 260vmax; opacity: 0; } }
.est-bloom .msg { position: relative; max-width: 82vw; text-align: center; font-size: 16px; font-weight: 800; color: #fff;
  text-shadow: 0 2px 14px rgba(0,0,0,.7); line-height: 1.6; animation: estMsg 2.6s ease forwards; }
@keyframes estMsg { 0% { opacity: 0; transform: translateY(10px); } 12% { opacity: 1; transform: none; } 82% { opacity: 1; } 100% { opacity: 0; } }
`

let cssInjected = false
function injectCss(): void {
  if (cssInjected) return
  cssInjected = true
  const style = document.createElement('style')
  style.textContent = CSS
  document.head.appendChild(style)
}

const DIA = '\u{1F48E}'
const PRISM = '✦'

function priceLabel(sku: Sku): string {
  return sku.currency === 'prisms' ? `${sku.price} ${PRISM}` : `${sku.price} ${DIA}`
}

function rewardLabel(r: PassReward): string {
  const bits: string[] = []
  if (r.coins) bits.push(`${r.coins} 🪙`)
  if (r.diamonds) bits.push(`<b>${r.diamonds} ${DIA}</b>`)
  if (r.prisms) bits.push(`${r.prisms} ${PRISM}`)
  if (r.sku) bits.push(`<span class="exl">${skuById(r.sku)?.name ?? r.sku}</span>`)
  return bits.join(' · ') || '—'
}

export class StorePage {
  private root: HTMLDivElement
  private body: HTMLElement
  private tab: Tab = 'featured'
  private confirmId: string | null = null
  private confirmTimer = 0
  private thanksIdx = 0
  private leaving = false

  constructor(private handlers: StorePageHandlers) {
    injectCss()
    this.root = document.createElement('div')
    this.root.className = 'est'
    const dye = uiDyeAccent()
    if (dye) this.root.style.setProperty('--acc', dye)

    this.root.innerHTML = `
      <div class="est-head">
        <button class="est-back" data-act="back" aria-label="Back">‹</button>
        <div class="est-title">STORE</div>
        <div class="est-chip c1">🪙 <span data-coins>0</span></div>
        <div class="est-chip c2">${DIA} <span data-dia>0</span></div>
        <div class="est-chip c3">${PRISM} <span data-prism>0</span></div>
      </div>
      <div class="est-ribbon"><b>Nothing you can buy works in Ranked. Ever.</b><br/>
        Skins are paint. Convenience is casual-only. Diamonds drip free from play. No loot boxes — every item shows exactly what you get.</div>
      <div class="est-tabs">${TABS.map((t) => `<button class="est-tab${t.id === 'featured' ? ' on' : ''}" data-tab="${t.id}">${t.label}</button>`).join('')}</div>
      <div class="est-body"><div class="est-inner" data-body></div></div>
    `
    document.body.appendChild(this.root)
    this.body = this.root.querySelector<HTMLElement>('[data-body]')!

    this.root.addEventListener('click', (e) => this.onClick(e))
    this.refreshChips()
    this.render()
  }

  // ------------------------------------------------------------- interaction
  private onClick(e: MouseEvent): void {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act],[data-tab]')
    if (!t || this.leaving) return
    playUiTick()
    const tabId = t.dataset.tab as Tab | undefined
    if (tabId) {
      this.tab = tabId
      this.confirmId = null
      for (const b of this.root.querySelectorAll('.est-tab')) b.classList.toggle('on', (b as HTMLElement).dataset.tab === tabId)
      this.render()
      this.root.querySelector('.est-body')!.scrollTop = 0
      return
    }
    const act = t.dataset.act!
    const id = t.dataset.id ?? ''
    if (act === 'back') {
      this.leaving = true
      this.root.classList.add('est-leave')
      window.setTimeout(() => this.handlers.onBack(), 220)
    } else if (act === 'buy') this.tryBuy(id, t)
    else if (act === 'equip') this.toggleEquip(id)
    else if (act === 'mock') this.mockModal(t.dataset.title ?? 'COMING SOON', t.dataset.msg ?? '')
    else if (act === 'pass-premium') this.buyPassPremium()
    else if (act === 'pass-premium-usd') this.mockModal('PRISM PASS PREMIUM', `${PASS_PREMIUM_USD} checkout arrives with the web launch — nothing charges in this build. You can unlock it right now with ${PASS_PREMIUM_DIAMONDS} ${DIA}, and diamonds are earnable free.`)
    else if (act === 'pass-claim') this.claimPass()
  }

  /** Two-tap confirm: first tap arms the button, second tap (3s window) buys. */
  private tryBuy(id: string, btn: HTMLElement): void {
    const sku = skuById(id)
    if (!sku) return
    if (!economy.skuGateOpen(sku)) return
    const wallet = sku.currency === 'prisms' ? economy.prisms : economy.diamonds
    if (wallet < sku.price) {
      this.mockModal('NOT YET', sku.currency === 'prisms'
        ? `Prisms ${PRISM} are earned from the Prism Pass by playing — they are never sold.`
        : `Diamonds ${DIA} drip free from play (~5–15/day): first clears, new stars and the daily bonus. This will still be here when you have enough — rotation, not extortion.`)
      return
    }
    if (this.confirmId !== id) {
      this.confirmId = id
      btn.classList.add('confirm')
      btn.textContent = `SURE? ${priceLabel(sku)}`
      window.clearTimeout(this.confirmTimer)
      this.confirmTimer = window.setTimeout(() => {
        this.confirmId = null
        this.render()
      }, 3000)
      return
    }
    window.clearTimeout(this.confirmTimer)
    this.confirmId = null
    if (economy.buySku(id)) {
      this.refreshChips()
      this.render()
      this.bloom()
    }
  }

  private toggleEquip(id: string): void {
    const sku = skuById(id)
    if (!sku?.slot) return
    if (economy.isEquipped(id)) economy.unequipSlot(sku.slot)
    else economy.equipSku(id)
    this.render()
  }

  private buyPassPremium(): void {
    if (economy.diamonds < PASS_PREMIUM_DIAMONDS) {
      this.mockModal('NOT YET', `Premium costs ${PASS_PREMIUM_DIAMONDS} ${DIA}. Diamonds drip free from play — or ${PASS_PREMIUM_USD} once real purchases launch. The pass keeps counting your XP either way; unlock late and claim everything at once.`)
      return
    }
    if (economy.unlockPassPremium()) {
      this.refreshChips()
      this.render()
      this.bloom()
    }
  }

  private claimPass(): void {
    const got = economy.claimPassRewards()
    if (!got.length) return
    this.refreshChips()
    this.render()
    this.bloom()
  }

  // ------------------------------------------------------------- feedback
  private refreshChips(): void {
    this.root.querySelector('[data-coins]')!.textContent = String(economy.coins)
    this.root.querySelector('[data-dia]')!.textContent = String(economy.diamonds)
    this.root.querySelector('[data-prism]')!.textContent = String(economy.prisms)
  }

  /** Post-purchase color-bloom thank-you (never a nag; auto-dismisses). */
  private bloom(): void {
    const d = document.createElement('div')
    d.className = 'est-bloom'
    const line = THANKYOU_LINES[this.thanksIdx++ % THANKYOU_LINES.length]
    d.innerHTML = `<div class="wave"></div><div class="msg">${line}</div>`
    document.body.appendChild(d)
    window.setTimeout(() => d.remove(), 2700)
  }

  private mockModal(title: string, msg: string): void {
    const o = document.createElement('div')
    o.className = 'est-overlay'
    o.innerHTML = `<div class="est-modal"><div class="est-mt">${title}</div><div class="est-mb">${msg}</div>
      <button class="est-mbtn">OK</button></div>`
    o.addEventListener('click', (e) => {
      if (e.target === o || (e.target as HTMLElement).closest('.est-mbtn')) o.remove()
    })
    this.root.appendChild(o)
  }

  // ------------------------------------------------------------- rendering
  private render(): void {
    switch (this.tab) {
      case 'featured': this.body.innerHTML = this.renderFeatured(); break
      case 'skins': this.body.innerHTML = this.renderSkins(); break
      case 'utility': this.body.innerHTML = this.renderUtility(); break
      case 'pass': this.body.innerHTML = this.renderPass(); break
      case 'diamonds': this.body.innerHTML = this.renderDiamonds(); break
      case 'ledger': this.body.innerHTML = this.renderLedger(); break
    }
  }

  private swatch(sku: Sku): string {
    if (sku.palette) {
      const c = '#' + sku.palette.color.toString(16).padStart(6, '0')
      const a = '#' + sku.palette.accent.toString(16).padStart(6, '0')
      return `<div class="est-sw"><div class="swb" style="background:linear-gradient(150deg,${c},${a})"></div></div>`
    }
    if (sku.heroTint && sku.slot) {
      const heroId = sku.slot.split(':')[1]
      const art = heroArtUrl(heroId)
      if (art) return `<div class="est-sw" style="background-image:url('${art}'); filter:${sku.heroTint.css}"></div>`
      return `<div class="est-sw">🎭</div>`
    }
    if (sku.spellColor !== undefined) {
      const c = '#' + sku.spellColor.toString(16).padStart(6, '0')
      const glyph = sku.spellKey === 'meteor' ? '☄' : sku.spellKey === 'freeze' ? '❄' : '💰'
      return `<div class="est-sw" style="color:${c}; text-shadow:0 0 12px ${c}">${glyph}</div>`
    }
    if (sku.dyeAccent) return `<div class="est-sw"><div class="swb" style="background:radial-gradient(circle at 35% 30%, #fff, ${sku.dyeAccent} 55%, #201640)"></div></div>`
    if (sku.bannerCss) return `<div class="est-sw"><div class="swb" style="background:${sku.bannerCss}"></div></div>`
    if (sku.kind === 'frame') return `<div class="est-sw">🖼️</div>`
    if (sku.kind === 'prestige') return `<div class="est-sw">👑</div>`
    if (sku.id === 'conv-idle2x') return `<div class="est-sw">⏳</div>`
    if (sku.id === 'conv-autocollect') return `<div class="est-sw">🧲</div>`
    return `<div class="est-sw">🎒</div>`
  }

  private skuCard(sku: Sku): string {
    const owned = economy.owns(sku.id)
    const gateOpen = economy.skuGateOpen(sku)
    const tags = `<span class="est-rk">RANKED: NONE</span>${sku.casualOnly ? '<span class="est-cas">CASUAL ONLY</span>' : ''}`
    let action: string
    if (owned) {
      if (sku.slot) {
        const on = economy.isEquipped(sku.id)
        action = `<button class="est-eq${on ? ' on' : ''}" data-act="equip" data-id="${sku.id}">${on ? '✓ EQUIPPED' : 'EQUIP'}</button>`
      } else {
        action = `<button class="est-eq on">✓ OWNED</button>`
      }
    } else if (!gateOpen) {
      action = `<button class="est-buy poor">🔒 ${priceLabel(sku)}</button>`
    } else {
      const arming = this.confirmId === sku.id
      const cls = sku.currency === 'prisms' ? ' pri2' : ''
      action = `<button class="est-buy${cls}${arming ? ' confirm' : ''}" data-act="buy" data-id="${sku.id}">${arming ? 'SURE? ' : ''}${priceLabel(sku)}</button>`
    }
    const gate = !gateOpen && sku.gate ? `<div class="est-gate">🔒 ${sku.gate.label}</div>` : ''
    return `<div class="est-card${gateOpen ? '' : ' gated'}">${this.swatch(sku)}
      <div class="est-tx"><div class="est-nm">${sku.name} ${tags}</div><div class="est-ds">${sku.desc}</div>${gate}</div>
      <div class="est-act">${action}</div></div>`
  }

  private renderFeatured(): string {
    const day = Math.floor(Date.now() / 86400000)
    const rot = rotationFor(day)
    const ads = REWARDED_ADS.map((a) => `<div class="est-card"><div class="est-sw">${a.icon}</div>
      <div class="est-tx"><div class="est-nm">${a.name} <span class="est-rk">RANKED: NONE</span><span class="est-cas">CASUAL ONLY</span></div>
      <div class="est-ds">${a.desc} Always opt-in, always a gift — never an interruption.</div></div>
      <div class="est-act"><button class="est-buy mock" data-act="mock" data-title="REWARDED ADS"
        data-msg="Ad partners arrive with the web launch. When they do: always opt-in, offered by a character, never forced — and never, ever in Ranked.">▶ SOON</button></div></div>`).join('')
    return `
      <div class="est-h2">TODAY'S ROTATION</div>
      <div class="est-rot">Rotates daily. What leaves always returns — <b>rotation, not extortion.</b> Nothing here is "last chance".</div>
      ${rot.map((s) => this.skuCard(s)).join('')}
      <div class="est-h2">STARTER CHROMA KIT</div>
      <div class="est-card"><div class="est-sw">🎁</div>
        <div class="est-tx"><div class="est-nm">${STARTER_KIT.name} <span class="est-rk">RANKED: NONE</span></div>
        <div class="est-ds">You get exactly: ${STARTER_KIT.contents.join(' + ')}. ${STARTER_KIT.note}</div></div>
        <div class="est-act"><button class="est-buy mock" data-act="mock" data-title="STARTER CHROMA KIT"
          data-msg="Real purchases arrive with the web launch — nothing charges in this build. No countdown either: this kit will still be here tomorrow, and the day after.">${STARTER_KIT.usd} · SOON</button></div></div>
      <div class="est-h2">FIRST PURCHASE</div>
      <div class="est-note"><b>Your first diamond pack is DOUBLED.</b> No timer, no pressure — it's doubled today, tomorrow, and next month. See the DIAMONDS tab.</div>
      <div class="est-h2">FREE GIFTS (REWARDED ADS)</div>
      ${ads}
      <div class="est-note">Why any of this exists: <b>this store sells zero power — it buys us servers.</b> Ranked stays pure forever. Audit every item in the FAIR LEDGER tab.</div>`
  }

  private renderSkins(): string {
    const groups: Array<{ title: string; kinds: string[]; note?: string }> = [
      { title: 'TOWER SKINS', kinds: ['towerSkin'], note: 'Palette swaps on the tower body, orb, range ring and shots. Paint, nothing else.' },
      { title: 'HERO SKINS', kinds: ['heroSkin'], note: 'Recolors the painted portrait and the battle token.' },
      { title: 'SPELL VFX', kinds: ['spellVfx'], note: 'Your spells, your colors. Numbers untouched.' },
      { title: 'DYES', kinds: ['dye'], note: 'Tint the menu & store UI.' },
      { title: 'BANNERS & FRAMES', kinds: ['banner', 'frame'], note: 'Shown on your title screen.' },
      { title: 'PRESTIGE', kinds: ['prestige'], note: 'One per season. Never re-sold. Pure status.' },
    ]
    return groups.map((g) => {
      const items = shelfSkus().filter((s) => g.kinds.includes(s.kind))
      if (!items.length) return ''
      return `<div class="est-h2">${g.title}</div>${g.note ? `<div class="est-note">${g.note}</div>` : ''}${items.map((s) => this.skuCard(s)).join('')}`
    }).join('') + `<div class="est-note">Prism ${PRISM} items are bought with the event currency you EARN on the Prism Pass — prisms are never sold for money. That lane is for players who never spend a cent.</div>`
  }

  private renderUtility(): string {
    const items = shelfSkus().filter((s) => s.kind === 'convenience')
    const slots = economy.loadoutSlots()
    return `
      <div class="est-h2">CONVENIENCE — CASUAL ONLY</div>
      <div class="est-note"><b>Everything below is visibly disabled in Ranked.</b> Ranked runs use loadout slot 1, normalized heroes, neutral modifiers and zero boosts. These buy back your time in casual play — never strength anywhere.</div>
      ${items.map((s) => this.skuCard(s)).join('')}
      <div class="est-note">Loadout slots owned: <b>${slots} / 3</b> — switch between them on the HEROES screen. Ranked always uses Slot 1.</div>`
  }

  private renderPass(): string {
    const tier = economy.passTier()
    const xp = economy.passXp
    const intoTier = Math.min(xp - tier * PASS_TIER_XP, PASS_TIER_XP)
    const pct = tier >= PASS_TIERS ? 100 : Math.round((Math.max(0, intoTier) / PASS_TIER_XP) * 100)
    const claim = economy.passClaimable()
    const claimable = claim.free + claim.premium
    const premium = economy.passPremium
    const rows = PASS_TRACK.map((t) => {
      const reached = tier >= t.tier
      const freeClaimed = economy.data.pass.freeClaimed >= t.tier
      const premClaimed = economy.data.pass.premClaimed >= t.tier
      return `<div class="est-tier${reached ? ' reached' : ''}">
        <div class="est-tn2">${t.tier}</div>
        <div class="est-tr${reached ? '' : ' locked'}">${freeClaimed ? '✓ ' : ''}${rewardLabel(t.free)}</div>
        <div class="est-tr${reached && premium ? '' : ' locked'}">${premClaimed ? '✓ ' : premium ? '' : '🔒 '}${rewardLabel(t.premium)}</div>
      </div>`
    }).join('')
    return `
      <div class="est-pass-head">
        <div class="est-pass-season">${PASS_SEASON_NAME}</div>
        <div class="est-pass-sub">30 tiers over the season. <b>Advances by PLAY only</b> — there is no way to buy XP or skip a tier, for anyone, at any price.</div>
        <div class="est-bar"><div style="width:${pct}%"></div></div>
        <div class="est-pass-xp">TIER ${tier} / ${PASS_TIERS} · ${xp} XP${tier < PASS_TIERS ? ` · ${PASS_TIER_XP - Math.max(0, intoTier)} XP to next` : ' · COMPLETE'}</div>
        <div style="display:flex; gap:8px; flex-wrap:wrap">
          ${claimable > 0 ? `<button class="est-buy" data-act="pass-claim">CLAIM ${claimable} REWARD${claimable > 1 ? 'S' : ''}</button>` : ''}
          ${premium ? '<button class="est-eq on">✓ PREMIUM ACTIVE</button>'
            : `<button class="est-buy pri2" data-act="pass-premium">PREMIUM · ${PASS_PREMIUM_DIAMONDS} ${DIA}</button>
               <button class="est-buy mock" data-act="pass-premium-usd">${PASS_PREMIUM_USD} · SOON</button>`}
        </div>
        ${premium ? '' : `<div class="est-pass-sub">Unlock premium any time — even on the last day — and claim every earned tier at once. Your XP is never wasted.</div>`}
      </div>
      <div class="est-h2">RESTORATION DUTIES (HOW XP IS EARNED)</div>
      <div class="est-duty">${PASS_DUTIES.map((d) => '· ' + d).join('<br/>')}</div>
      <div class="est-h2">REWARDS — FREE TRACK | PREMIUM TRACK</div>
      ${rows}`
  }

  private renderDiamonds(): string {
    const packs = DIAMOND_PACKS.map((p) => `<div class="est-card">
      <div class="est-sw" style="color:#8fe9ff">${DIA}</div>
      <div class="est-tx"><div class="est-nm">${p.diamonds} ${DIA} ${p.best ? '<span class="est-cas">BEST VALUE</span>' : ''}<span class="est-rk">RANKED: NONE</span></div>
      <div class="est-ds">First purchase: <b>doubled to ${p.diamonds * 2} ${DIA}</b> — no timer on that, ever.</div></div>
      <div class="est-act"><button class="est-buy mock" data-act="mock" data-title="DIAMOND PACKS"
        data-msg="Real purchases arrive with the web launch — nothing charges in this build. Until then diamonds drip free from play (~5–15/day), and everything they buy is cosmetic or casual convenience.">${p.usd} · SOON</button></div></div>`).join('')
    return `
      <div class="est-note"><b>Diamonds are also earnable free</b> (~5–15/day: daily bonus, first clears, new stars, the pass). Buying them only buys the same paint faster — and buys us servers.</div>
      ${packs}
      <div class="est-h2">CHROMANCER PLUS</div>
      <div class="est-card"><div class="est-sw">✦</div>
        <div class="est-tx"><div class="est-nm">${PLUS_SUB.name} <span class="est-rk">RANKED: NONE</span><span class="est-cas">CASUAL ONLY</span></div>
        <div class="est-ds">You get exactly: ${PLUS_SUB.perks.join(' · ')}.<br/><b>${PLUS_SUB.note}</b></div></div>
        <div class="est-act"><button class="est-buy mock" data-act="mock" data-title="CHROMANCER PLUS"
          data-msg="Subscriptions arrive with the web launch — nothing charges in this build. Plus never touches Ranked: it buys you time & style, and us servers.">${PLUS_SUB.usd} · SOON</button></div></div>
      <div class="est-note">What we will NEVER do: defeat-screen offers · pay-to-continue · fake discounts · loot boxes · countdown pressure · paid Ranked power. Hold us to it — the FAIR LEDGER tab is the receipt.</div>`
  }

  private renderLedger(): string {
    const rows = CATALOG.map((s) => `<tr><td>${s.name}${s.passExclusive ? ' <span style="color:#e2c9ff">(pass)</span>' : ''}</td>
      <td>${s.passExclusive ? 'Prism Pass' : priceLabel(s)}</td><td>${s.desc}</td><td class="ok">NONE</td></tr>`).join('')
    const money = [
      ...DIAMOND_PACKS.map((p) => [`Diamond pack ${p.diamonds}`, p.usd, `${p.diamonds} ${DIA} (first purchase doubled)`]),
      [STARTER_KIT.name, STARTER_KIT.usd, STARTER_KIT.contents.join(' + ')],
      [PLUS_SUB.name, PLUS_SUB.usd, PLUS_SUB.perks.join(' · ')],
      ['Prism Pass Premium', `${PASS_PREMIUM_USD} / ${PASS_PREMIUM_DIAMONDS} ${DIA}`, 'Premium reward track (XP by play only)'],
    ].map(([n, p, d]) => `<tr><td>${n}</td><td>${p}</td><td>${d}</td><td class="ok">NONE</td></tr>`).join('')
    return `
      <div class="est-h2">THE FAIRNESS LEDGER</div>
      <div class="est-note">Every SKU in the game, public, with its effect on Ranked / Endless / daily-seed play. The verifier rejects any ranked run with a paid modifier active — <b>the column below is enforced by code, not by promise.</b></div>
      <div class="est-note"><b>The constitution:</b> 1) Ranked ignores all purchases — heroes normalized, boosts/convenience/slots disabled. 2) Spend buys cosmetics, casual convenience or breadth — never power. 3) No loot boxes, gacha or blind buys. 4) All gameplay content earnable free. 5) This ledger stays public.</div>
      <table class="est-led"><tr><th>ITEM</th><th>PRICE</th><th>WHAT YOU GET</th><th>RANKED EFFECT</th></tr>${rows}${money}</table>
      <div class="est-h2">THE RESTORERS WALL</div>
      <div class="est-wall">${RESTORERS_WALL_STUB.join('<br/>')}<br/><span style="opacity:.7">— arrives with accounts —</span></div>
      <div class="est-note" style="text-align:center; padding-top:6px">This store buys zero power. It buys us servers. Thank you for keeping the colour on.</div>`
  }

  destroy(): void {
    window.clearTimeout(this.confirmTimer)
    this.root.remove()
  }
}
