// BondPanel — "The Wyrmroost". The screen where a hero bonds a Chromatic Wyrm
// and previews the ATTUNEMENT. A full-screen DOM overlay (same idiom as
// CodexPanel): pick a hero, pick from the discovered Wyrms, and the panel shows
// the deterministic bond numbers (breath, aura, tier, fused ultimate) — no
// mystery stats. All state flows through `economy`; RANKED normalizes it.

import { economy } from '../game/economy'
import { HERO_ORDER, heroById } from '../game/heroes'
import {
  WYRM_ORDER, wyrmById, resolveBond, bondTier, bondTooltip, isPrismHero,
  WYRM_ACT_REALMS, WYRM_MAX_LEVEL, RANKED_WYRM_LEVEL, TIER_LABEL, wyrmBuffsTowers, type BondTier,
} from '../game/wyrms'
import { wyrmArtUrl } from './wyrmArt'
import { heroArtUrl } from './heroArt'
import { unlockCodex } from '../game/codex'
import { playUiTick } from './sfx'

function hex(c: number): string {
  return '#' + (c & 0xffffff).toString(16).padStart(6, '0')
}
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const TIER_CLASS: Record<BondTier, string> = { perfect: 'perfect', good: 'good', regular: 'regular' }

const CSS = `
.ebd { position: fixed; inset: 0; z-index: 30; display: flex; align-items: center; justify-content: center;
  background: rgba(5,3,14,.8); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);
  font-family: 'Baloo 2','Nunito',system-ui,'Segoe UI',Arial,sans-serif; color: #efe9ff;
  animation: ebdIn .25s ease both; -webkit-tap-highlight-color: transparent; }
@keyframes ebdIn { from { opacity: 0; } to { opacity: 1; } }
.ebd.hide { opacity: 0; transition: opacity .22s ease; pointer-events: none; }
.ebd-card { width: min(600px, 95vw); height: min(820px, 90vh); display: flex; flex-direction: column;
  border-radius: 22px; overflow: hidden; background: linear-gradient(180deg, #21173f 0%, #130b28 100%);
  border: 1px solid rgba(201,182,255,.3); box-shadow: 0 30px 80px rgba(0,0,0,.7); }
.ebd-head { display: flex; align-items: center; gap: 10px; padding: 16px 16px 12px; border-bottom: 1px solid rgba(255,255,255,.1); }
.ebd-head .ic { font-size: 26px; }
.ebd-head .tt { flex: 1 1 auto; }
.ebd-head .t1 { font-size: 17px; font-weight: 900; letter-spacing: .08em; color: #ffe1a6; }
.ebd-head .t2 { font-size: 11px; font-weight: 700; letter-spacing: .14em; color: #9d8fc5; }
.ebd-close { flex: 0 0 auto; width: 40px; height: 40px; border-radius: 50%; border: 1px solid rgba(255,255,255,.2);
  background: rgba(255,255,255,.06); color: #efe9ff; font: inherit; font-size: 17px; font-weight: 800; cursor: pointer; }
.ebd-close:active { transform: scale(.92); }
.ebd-body { flex: 1 1 auto; overflow-y: auto; -webkit-overflow-scrolling: touch; padding: 12px 16px 24px; }

/* locked state */
.ebd-lock { margin: 30px 10px; text-align: center; }
.ebd-lock .lg { font-size: 60px; filter: grayscale(1) brightness(.7); }
.ebd-lock .lt { margin-top: 14px; font-size: 17px; font-weight: 900; color: #cdbcff; }
.ebd-lock .ls { margin-top: 8px; font-size: 13.5px; line-height: 1.55; color: #a99bd0; }
.ebd-lock .lbar { margin: 16px auto 0; width: 220px; height: 12px; border-radius: 7px; background: rgba(255,255,255,.08); overflow: hidden; }
.ebd-lock .lbar > i { display: block; height: 100%; background: linear-gradient(90deg,#7b52d8,#b06bff); }

/* hero picker */
.ebd-heroes { display: flex; gap: 8px; overflow-x: auto; padding: 4px 2px 10px; -webkit-overflow-scrolling: touch; }
.ebd-hero { flex: 0 0 auto; width: 58px; text-align: center; cursor: pointer; }
.ebd-hero .hp { width: 52px; height: 52px; border-radius: 50%; border: 2px solid rgba(255,255,255,.2);
  background-size: cover; background-position: 50% 15%; position: relative; }
.ebd-hero.sel .hp { border-color: #ffd54a; box-shadow: 0 0 10px rgba(255,213,74,.5); }
.ebd-hero .hn { margin-top: 3px; font-size: 10.5px; font-weight: 800; color: #d9cff5; }
.ebd-hero .wsig { position: absolute; bottom: -3px; right: -4px; width: 20px; height: 20px; border-radius: 50%;
  background: #160c2e; border: 1.5px solid #fff; display: grid; place-items: center; font-size: 11px; }

/* current bond hero panel */
.ebd-cur { display: flex; gap: 12px; align-items: center; margin: 6px 0 12px; padding: 12px;
  border-radius: 16px; background: linear-gradient(180deg, rgba(255,255,255,.05), rgba(255,255,255,.02)); border: 1px solid rgba(255,255,255,.1); }
.ebd-cur .big { width: 74px; height: 74px; border-radius: 14px; background-size: cover; background-position: 50% 15%; flex: 0 0 auto; border: 2px solid rgba(255,255,255,.18); }
.ebd-cur .info { flex: 1 1 auto; }
.ebd-cur .nm { font-size: 17px; font-weight: 900; color: #fff; }
.ebd-cur .el { font-size: 12px; font-weight: 800; color: #b6a9dd; letter-spacing: .1em; }
.ebd-cur .bd { margin-top: 6px; font-size: 12.5px; line-height: 1.5; color: #d9cff5; }
.ebd-note { font-size: 11.5px; color: #a99bd0; font-style: italic; margin: 2px 2px 10px; }

/* wyrm grid */
.ebd-lbl { font-size: 11px; font-weight: 900; letter-spacing: .3em; color: #b8a5e8; margin: 8px 2px 8px; }
.ebd-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.ebd-w { border-radius: 15px; overflow: hidden; cursor: pointer; border: 1px solid rgba(255,255,255,.1);
  background: linear-gradient(180deg, rgba(255,255,255,.05), rgba(255,255,255,.015)); transition: transform .08s; position: relative; }
.ebd-w:active { transform: scale(.97); }
.ebd-w.on { border-color: #ffd54a; box-shadow: 0 0 0 1px #ffd54a inset; }
.ebd-w .art { height: 96px; background-size: cover; background-position: 50% 30%; position: relative; }
.ebd-w .art .glyph { position: absolute; inset: 0; display: grid; place-items: center; font-size: 44px; }
.ebd-w .tier { position: absolute; top: 6px; right: 6px; font-size: 9.5px; font-weight: 900; letter-spacing: .08em;
  padding: 3px 7px; border-radius: 9px; color: #10091f; }
.ebd-w .tier.perfect { background: linear-gradient(180deg,#ffe27a,#ffb347); box-shadow: 0 0 8px rgba(255,200,80,.6); }
.ebd-w .tier.good { background: linear-gradient(180deg,#9be7ff,#4aa8ff); }
.ebd-w .tier.regular { background: linear-gradient(180deg,#cdbce6,#9d8fc5); }
.ebd-w .meta { padding: 8px 10px 11px; }
.ebd-w .wn { font-size: 14px; font-weight: 900; color: #fff; }
.ebd-w .ws { margin-top: 2px; font-size: 11px; font-weight: 700; color: #b6a9dd; }
.ebd-w .wl { margin-top: 6px; font-size: 11px; line-height: 1.45; color: #d3c8f0; }
.ebd-w .wl .k { color: #9d8fc5; }
.ebd-w .ult { margin-top: 6px; font-size: 10.5px; line-height: 1.4; color: #ffe1a6; font-weight: 700; }
.ebd-none { grid-column: 1 / -1; text-align: center; padding: 12px; border-radius: 12px; cursor: pointer;
  border: 1px dashed rgba(255,255,255,.18); font-weight: 800; color: #b6a9dd; }
`

let cssInjected = false

export class BondPanel {
  private root: HTMLDivElement
  private body: HTMLDivElement
  private selHero: string

  constructor(onClose: () => void, heroId?: string) {
    if (!cssInjected) {
      cssInjected = true
      const style = document.createElement('style')
      style.textContent = CSS
      document.head.appendChild(style)
    }
    // default selection: the passed hero, else the first unlocked hero
    const unlocked = HERO_ORDER.filter((id) => economy.isHeroUnlocked(id))
    this.selHero = heroId && economy.isHeroUnlocked(heroId) ? heroId : (unlocked[0] ?? HERO_ORDER[0])

    this.root = document.createElement('div')
    this.root.className = 'ebd'
    this.root.innerHTML = `
      <div class="ebd-card">
        <div class="ebd-head">
          <span class="ic">🐉</span>
          <span class="tt">
            <div class="t1">WYRM BONDS · THE WYRMROOST</div>
            <div class="t2">EARNED THROUGH PLAY · RANKED NORMALIZES · SKINS ARE COSMETIC</div>
          </span>
          <button class="ebd-close" data-close>✕</button>
        </div>
        <div class="ebd-body"></div>
      </div>`
    this.body = this.root.querySelector('.ebd-body') as HTMLDivElement

    this.root.addEventListener('click', (e) => {
      const t = e.target as HTMLElement
      if (t === this.root || t.closest('[data-close]')) { this.close(onClose); return }
      const heroEl = t.closest('[data-hero]') as HTMLElement | null
      if (heroEl) { playUiTick(); this.selHero = heroEl.dataset.hero as string; this.render(); return }
      const bondEl = t.closest('[data-bond]') as HTMLElement | null
      if (bondEl) {
        playUiTick()
        const wid = bondEl.dataset.bond as string
        economy.setBond(this.selHero, wid === '' ? null : wid)
        this.render()
        return
      }
    })
    document.body.appendChild(this.root)
    this.render()
  }

  private close(onClose: () => void): void {
    playUiTick()
    this.root.classList.add('hide')
    window.setTimeout(() => { this.root.remove(); onClose() }, 220)
  }

  private render(): void {
    if (!economy.wyrmsAwakened()) { this.body.innerHTML = this.lockedHtml(); return }
    // opening the roost fills in the codex for whatever is discovered
    unlockCodex('wyrm-act')
    const discovered = economy.discoveredWyrms()
    for (const id of discovered) unlockCodex('wyrm-' + id)

    const heroes = HERO_ORDER.filter((id) => economy.isHeroUnlocked(id))
    const heroStrip = heroes.map((id) => {
      const def = heroById(id)!
      const art = heroArtUrl(id)
      const bg = art ? `background-image:url('${art}');` : `background:linear-gradient(160deg,${hex(def.color)},${hex(def.accent)});`
      const bond = economy.bondFor(id)
      const w = bond ? wyrmById(bond) : null
      const sig = w ? `<span class="wsig" style="border-color:${hex(w.color)}">${w.emoji}</span>` : ''
      return `<div class="ebd-hero${id === this.selHero ? ' sel' : ''}" data-hero="${id}"><div class="hp" style="${bg}">${sig}</div><div class="hn">${esc(def.name)}</div></div>`
    }).join('')

    const def = heroById(this.selHero)!
    const heroArt = heroArtUrl(this.selHero)
    const heroBg = heroArt ? `background-image:url('${heroArt}');` : `background:linear-gradient(160deg,${hex(def.color)},${hex(def.accent)});`
    const bondId = economy.bondFor(this.selHero)
    const cur = bondId ? resolveBond(this.selHero, bondId, economy.wyrmState(bondId).level) : null
    const curHtml = cur
      ? `<div class="nm">${cur.wyrm.emoji} ${esc(cur.wyrm.name)} · <span style="color:${hex(cur.wyrm.color)}">${cur.tierLabel}</span></div>
         <div class="el">${esc(def.name.toUpperCase())} · ${cur.stageLabel.toUpperCase()} Lv ${cur.level}</div>
         <div class="bd">${bondTooltip(cur).slice(2).map(esc).join('<br>')}</div>`
      : `<div class="nm">${esc(def.name)}</div><div class="el">NO WYRM BONDED</div>
         <div class="bd">Pick a Wyrm below. Every hero can bond any Wyrm — the tier just changes.</div>`

    const prismNote = isPrismHero(this.selHero)
      ? `<div class="ebd-note">⚗ Prism Bond: Fizz harmonises with all six Wyrms (GOOD) and may swap freely — the arcane commands the whole flight.</div>`
      : ''

    const cells = WYRM_ORDER.map((wid) => {
      const wdef = wyrmById(wid)!
      const disc = economy.wyrmDiscovered(wid)
      const lvl = economy.wyrmState(wid).level
      const b = resolveBond(this.selHero, wid, lvl)!
      const tier = bondTier(this.selHero, wid)
      const art = wyrmArtUrl(wid)
      if (!disc) {
        return `<div class="ebd-w" style="opacity:.5;filter:grayscale(.6)"><div class="art" style="background:linear-gradient(160deg,#2a2350,#171030)"><div class="glyph">🥚</div></div>
          <div class="meta"><div class="wn">??? </div><div class="ws">Undiscovered</div><div class="wl">Restore ${esc(wdef.name)}'s realm to wake it.</div></div></div>`
      }
      const artBg = art ? `background-image:url('${art}');` : `background:linear-gradient(160deg,${hex(wdef.color)},${hex(wdef.accent)});`
      const on = bondId === wid ? ' on' : ''
      const ultLine = b.ult ? `<div class="ult">★ ${esc(b.ult.name)}: ${esc(b.ult.blurb)}</div>` : (b.named ? `<div class="ult">✦ ${esc(b.named.name)}: ${esc(b.named.blurb)}</div>` : '')
      return `<div class="ebd-w${on}" data-bond="${wid}">
        <div class="art" style="${artBg}"><span class="tier ${TIER_CLASS[tier]}">${esc(TIER_LABEL[tier])}</span></div>
        <div class="meta">
          <div class="wn">${wdef.emoji} ${esc(wdef.name)}</div>
          <div class="ws">${esc(wdef.title)} · ${esc(b.stageLabel)} Lv ${lvl}/${WYRM_MAX_LEVEL}</div>
          <div class="wl"><span class="k">Breath</span> ${Math.round(b.breathDamage)} ${wdef.element}, ${b.breathRadiusTiles.toFixed(1)}t/${b.breathCd.toFixed(1)}s
            · <span class="k">Aura</span> +${Math.round((b.heroAmp - 1) * 100)}% hero${wyrmBuffsTowers(wdef.element) ? `, +${Math.round(b.towerBuff * 100)}% ${wdef.element} towers` : ''}${b.status ? ` · ${b.status.toUpperCase()}` : ''}</div>
          ${ultLine}
        </div>
      </div>`
    }).join('')
    const noneCell = bondId ? `<div class="ebd-none" data-bond="">✕ Unbond ${esc(wyrmById(bondId)?.name ?? '')}</div>` : ''

    this.body.innerHTML = `
      <div class="ebd-heroes">${heroStrip}</div>
      <div class="ebd-cur"><div class="big" style="${heroBg}"></div><div class="info">${curHtml}</div></div>
      ${prismNote}
      <div class="ebd-lbl">DISCOVERED WYRMS — RANKED PINS EVERY BOND TO LV ${RANKED_WYRM_LEVEL}</div>
      <div class="ebd-grid">${cells}${noneCell}</div>`
  }

  private lockedHtml(): string {
    const restored = economy.realmsRestored()
    const pct = Math.min(100, Math.round((restored / WYRM_ACT_REALMS) * 100))
    return `<div class="ebd-lock">
      <div class="lg">🐉</div>
      <div class="lt">The Wyrms Sleep</div>
      <div class="ls">Before the Greying, six great Wyrms were the living founts of colour in Aetheria.<br>
        They did not die — they went dormant, curled around the last ember of each realm.<br>
        Restore <b>${WYRM_ACT_REALMS} realms</b> and pour enough feeling back into the world to wake them.</div>
      <div class="lbar"><i style="width:${pct}%"></i></div>
      <div class="ls" style="margin-top:8px"><b>${restored} / ${WYRM_ACT_REALMS}</b> realms restored</div>
    </div>`
  }

  destroy(): void {
    this.root.remove()
  }
}
