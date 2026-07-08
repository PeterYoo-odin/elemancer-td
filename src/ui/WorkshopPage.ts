// WorkshopPage — the persistent meta-upgrade tree as a polished HTML/CSS overlay
// (same family as FrontPage / StorePage / HeroCollection). Replaces the old
// Phaser 'Arial Black' WorkshopScene drawing; WorkshopScene now just mounts this.
// economy.ts stays the single wallet authority — this file is presentation + the
// thin buy calls. The 85/15 coin·diamond split and the "accelerators never buy
// battle power" invariant are surfaced up top so the fairness reads at a glance.

import { economy } from '../game/economy'
import {
  WORKSHOP_NODES,
  nodeLevel,
  nextCost,
  coinDiamondSplit,
  type WorkshopNode,
} from '../game/workshop'
import { appSettings } from './settings'
import { playUiTick } from './sfx'
import { attachTip } from './tooltip'
import { currencyIcon } from './icons'

export interface WorkshopPageHandlers {
  onBack(): void
}

const CSS = `
.ewk, .ewk * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
.ewk {
  --coin: #ffd54a; --dia: #8fe9ff;
  position: fixed; inset: 0; z-index: 15; display: flex; flex-direction: column; color: #efe9ff;
  font-family: 'Baloo 2','Nunito',system-ui,-apple-system,'Segoe UI',Arial,sans-serif;
  padding-top: env(safe-area-inset-top);
  background:
    radial-gradient(90% 50% at 50% -8%, rgba(74,123,255,.26), transparent 60%),
    linear-gradient(180deg, #101a30 0%, #0a0a1e 55%, #070510 100%);
  transition: opacity .25s ease;
}
.ewk.ewk-leave { opacity: 0; pointer-events: none; }

/* floating orb backdrop (parity with the old scene's juice; stilled on reduce-motion) */
.ewk-orbs { position: absolute; inset: 0; overflow: hidden; pointer-events: none; z-index: 0; }
.ewk-orb { position: absolute; border-radius: 50%; filter: blur(1px); opacity: .35;
  animation: ewkFloat 4s ease-in-out infinite; }
@keyframes ewkFloat { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-46px); } }
.ewk.ewk-reduced .ewk-orb { animation: none; }
.ewk.ewk-reduced { transition: none; }

/* header */
.ewk-head { position: relative; z-index: 2; display: flex; align-items: center; gap: 9px;
  padding: 12px 14px 8px; max-width: 620px; width: 100%; margin: 0 auto; }
.ewk-back { width: 40px; height: 40px; border-radius: 50%; border: 1px solid rgba(255,255,255,.16); flex: 0 0 auto;
  background: rgba(255,255,255,.06); color: #e6ddff; font: inherit; font-size: 21px; cursor: pointer; }
.ewk-back:active { transform: scale(.92); }
.ewk-title { font-size: 21px; font-weight: 900; letter-spacing: .16em; color: #fff;
  flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ewk-chip { display: flex; align-items: center; gap: 5px; padding: 6px 11px 6px 9px; border-radius: 999px; flex: 0 0 auto;
  background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.13); font-weight: 800; font-size: 13.5px; }
.ewk-chip.c1 { color: #ffe08a; } .ewk-chip.c2 { color: #c9f2ff; }

/* fairness ribbon */
.ewk-ribbon { position: relative; z-index: 2; max-width: 620px; width: calc(100% - 28px); margin: 2px auto 8px;
  padding: 8px 12px; border-radius: 12px; background: rgba(74,123,255,.12); border: 1px solid rgba(120,160,255,.32);
  color: #cfe0ff; font-size: 12px; font-weight: 700; letter-spacing: .02em; text-align: center; line-height: 1.55; }
.ewk-ribbon b { color: #9fdcff; }

/* scroll body */
.ewk-body { position: relative; z-index: 2; flex: 1 1 auto; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch;
  padding: 2px 14px calc(24px + env(safe-area-inset-bottom)); }
.ewk-inner { max-width: 620px; margin: 0 auto; display: flex; flex-direction: column; gap: 10px; }
.ewk-h2 { font-size: 11px; font-weight: 900; letter-spacing: .22em; color: #9db0d8; margin: 12px 2px 0; }

/* node row */
.ewk-node { display: flex; align-items: center; gap: 11px; padding: 11px 12px; border-radius: 15px;
  background: linear-gradient(180deg, rgba(255,255,255,.055), rgba(255,255,255,.02));
  border: 1px solid rgba(255,255,255,.11); }
.ewk-node.dia { border-color: rgba(143,233,255,.35); background: linear-gradient(180deg, rgba(60,110,150,.16), rgba(40,60,90,.06)); }
.ewk-badge { flex: 0 0 auto; width: 44px; height: 44px; border-radius: 12px; display: flex; align-items: center; justify-content: center;
  background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.14); font-size: 22px; }
.ewk-node.dia .ewk-badge { border-color: rgba(143,233,255,.4); }
.ewk-tx { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.ewk-nm { font-size: 14.5px; font-weight: 800; letter-spacing: .02em; display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.ewk-acc { font-size: 8.5px; font-weight: 900; letter-spacing: .12em; color: #9fdcff; border: 1px solid rgba(143,233,255,.45);
  border-radius: 999px; padding: 2px 6px; background: rgba(143,233,255,.1); }
.ewk-ds { font-size: 11.5px; color: #a9b6d1; line-height: 1.4; }
.ewk-pips { display: flex; gap: 4px; margin-top: 2px; }
.ewk-pip { width: 9px; height: 9px; border-radius: 50%; border: 1.5px solid rgba(255,255,255,.28); background: transparent; }
.ewk-pip.on { background: var(--coin); border-color: var(--coin); box-shadow: 0 0 6px color-mix(in srgb, var(--coin) 60%, transparent); }
.ewk-node.dia .ewk-pip.on { background: var(--dia); border-color: var(--dia); box-shadow: 0 0 6px color-mix(in srgb, var(--dia) 60%, transparent); }
.ewk-act { flex: 0 0 auto; }
.ewk-buy { min-width: 96px; padding: 9px 10px; border-radius: 11px; border: 0; font: inherit; font-size: 12.5px; font-weight: 900;
  letter-spacing: .03em; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 5px; white-space: nowrap;
  background: linear-gradient(180deg, #ffe9a8, #eda528 82%); color: #3a2604; }
.ewk-buy.dia { background: linear-gradient(180deg, #d6f4ff, #6bb8e0 84%); color: #08303f; }
.ewk-buy.poor { opacity: .42; cursor: default; }
.ewk-buy.max { background: linear-gradient(180deg, #b8ffd2, #2ea043 85%); color: #04310f; cursor: default; }
.ewk-buy:not(.poor):not(.max):active { transform: scale(.94); }
.ewk-buy svg { width: 15px; height: 15px; }

/* transient flash toast */
.ewk-toast { position: fixed; left: 50%; bottom: calc(30px + env(safe-area-inset-bottom)); transform: translateX(-50%);
  z-index: 40; padding: 10px 18px; border-radius: 999px; font-size: 14px; font-weight: 900; letter-spacing: .04em;
  background: rgba(20,12,40,.94); border: 1px solid rgba(255,255,255,.2); color: #fff; box-shadow: 0 12px 34px rgba(0,0,0,.6);
  animation: ewkToast 1.6s ease forwards; pointer-events: none; }
@keyframes ewkToast { 0% { opacity: 0; transform: translate(-50%, 10px); } 12%,72% { opacity: 1; transform: translate(-50%, 0); } 100% { opacity: 0; transform: translate(-50%, -8px); } }
.ewk.ewk-reduced .ewk-toast { animation: none; }
`

let cssInjected = false

const ORB_TINTS = ['#4a7bff', '#2ff7c3', '#ffd54a', '#8fe9ff']

export class WorkshopPage {
  private root: HTMLDivElement
  private handlers: WorkshopPageHandlers

  constructor(handlers: WorkshopPageHandlers) {
    this.handlers = handlers
    if (!cssInjected) {
      cssInjected = true
      const style = document.createElement('style')
      style.textContent = CSS
      document.head.appendChild(style)
    }

    this.root = document.createElement('div')
    this.root.className = 'ewk'
    if (appSettings.reducedMotion()) this.root.classList.add('ewk-reduced')
    this.render()
    document.body.appendChild(this.root)
  }

  private render(): void {
    const split = coinDiamondSplit()
    const battle = WORKSHOP_NODES.filter((n) => n.category === 'battle')
    const economyNodes = WORKSHOP_NODES.filter((n) => n.category === 'economy')
    const accel = WORKSHOP_NODES.filter((n) => n.category === 'accelerator')

    this.root.innerHTML = `
      <div class="ewk-orbs">${this.orbs()}</div>
      <div class="ewk-head">
        <button class="ewk-back" data-back aria-label="Back">‹</button>
        <div class="ewk-title">WORKSHOP</div>
        <div class="ewk-chip c1">${currencyIcon('coin', { size: 15 })}<span data-coins>${economy.coins}</span></div>
        <div class="ewk-chip c2">${currencyIcon('diamond', { size: 15 })}<span data-dia>${economy.diamonds}</span></div>
      </div>
      <div class="ewk-ribbon">
        <b>${split.coin} free upgrades</b> buy every ounce of battle power ·
        <b>${split.diamond} diamond accelerators</b> only speed up earning — never strength.
      </div>
      <div class="ewk-body">
        <div class="ewk-inner">
          <div class="ewk-h2">BATTLE POWER · FREE PATH</div>
          ${battle.map((n) => this.rowHtml(n)).join('')}
          <div class="ewk-h2">META ECONOMY · FREE PATH</div>
          ${economyNodes.map((n) => this.rowHtml(n)).join('')}
          <div class="ewk-h2">DIAMOND ACCELERATORS · ENDLESS-SAFE</div>
          ${accel.map((n) => this.rowHtml(n)).join('')}
        </div>
      </div>`

    this.root.querySelector('[data-back]')!.addEventListener('click', () => this.leave())
    this.root.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('[data-buy]') as HTMLElement | null
      if (btn) this.buy(btn.dataset.buy!)
    })

    // Tooltips explain the fairness invariant per row (hover / long-press).
    for (const node of WORKSHOP_NODES) {
      const rowEl = this.root.querySelector(`[data-row="${node.id}"]`) as HTMLElement | null
      if (rowEl) {
        attachTip(rowEl, () => {
          const lvl = nodeLevel(economy.data, node.id)
          const cost = nextCost(economy.data, node)
          return {
            tag: node.currency === 'diamonds' ? 'ACCELERATOR · ENDLESS-SAFE' : 'FREE PATH · BATTLE OR ECONOMY',
            title: node.name,
            accent: node.currency === 'diamonds' ? '#8fe9ff' : '#ffd54a',
            body: node.desc + '.',
            rows: [
              { k: 'Level', v: `${lvl} / ${node.maxLevel}` },
              { k: 'Next cost', v: cost === null ? 'MAXED' : `${cost} ${node.currency === 'diamonds' ? 'diamonds' : 'coins'}` },
            ],
            foot: node.currency === 'diamonds'
              ? 'Accelerators multiply EARNING only — they can never buy battle strength, so Endless stays fair.'
              : 'The free path is the only source of battle power.',
          }
        })
      }
    }
  }

  private orbs(): string {
    // deterministic scatter (no Math.random dependency in view churn)
    const spots = [
      [12, 22, 20], [78, 16, 16], [30, 60, 26], [86, 68, 18], [50, 40, 22],
      [18, 84, 14], [66, 88, 20], [92, 40, 14], [8, 50, 16], [42, 12, 14],
    ]
    return spots
      .map(([x, y, s], i) => {
        const c = ORB_TINTS[i % ORB_TINTS.length]
        return `<div class="ewk-orb" style="left:${x}%;top:${y}%;width:${s}px;height:${s}px;background:${c};animation-delay:${(i % 5) * 0.4}s"></div>`
      })
      .join('')
  }

  private rowHtml(node: WorkshopNode): string {
    const isDia = node.currency === 'diamonds'
    const lvl = nodeLevel(economy.data, node.id)
    const cost = nextCost(economy.data, node)
    const icon = isDia ? currencyIcon('diamond', { size: 22 }) : currencyIcon('coin', { size: 22 })
    const pips = Array.from({ length: node.maxLevel }, (_, i) => `<span class="ewk-pip${i < lvl ? ' on' : ''}"></span>`).join('')
    return `
      <div class="ewk-node${isDia ? ' dia' : ''}" data-row="${node.id}">
        <div class="ewk-badge">${icon}</div>
        <div class="ewk-tx">
          <div class="ewk-nm">${esc(node.name)}${isDia ? '<span class="ewk-acc">ACCELERATOR</span>' : ''}</div>
          <div class="ewk-ds">${esc(node.desc)}</div>
          <div class="ewk-pips">${pips}</div>
        </div>
        <div class="ewk-act">${this.buyHtml(node, cost, isDia)}</div>
      </div>`
  }

  private buyHtml(node: WorkshopNode, cost: number | null, isDia: boolean): string {
    if (cost === null) return `<button class="ewk-buy max" disabled>MAX</button>`
    const poor = !economy.canAfford(node.currency, cost)
    const cur = isDia ? currencyIcon('diamond', { size: 15 }) : currencyIcon('coin', { size: 15 })
    return `<button class="ewk-buy${isDia ? ' dia' : ''}${poor ? ' poor' : ''}" data-buy="${node.id}">${cost} ${cur}</button>`
  }

  private buy(id: string): void {
    const node = WORKSHOP_NODES.find((n) => n.id === id)
    if (!node) return
    const cost = nextCost(economy.data, node)
    if (cost === null) return
    if (!economy.spend(node.currency, cost)) {
      this.toast(`Not enough ${node.currency === 'diamonds' ? 'diamonds' : 'coins'}`)
      return
    }
    economy.data.workshop[node.id] = nodeLevel(economy.data, node.id) + 1
    economy.save()
    playUiTick()
    this.refreshRow(node)
    this.refreshChips()
    this.toast(`${node.name} upgraded!`)
  }

  private refreshRow(node: WorkshopNode): void {
    const rowEl = this.root.querySelector(`[data-row="${node.id}"]`) as HTMLElement | null
    if (!rowEl) return
    const lvl = nodeLevel(economy.data, node.id)
    const pipsEl = rowEl.querySelector('.ewk-pips')
    if (pipsEl) pipsEl.innerHTML = Array.from({ length: node.maxLevel }, (_, i) => `<span class="ewk-pip${i < lvl ? ' on' : ''}"></span>`).join('')
    const actEl = rowEl.querySelector('.ewk-act')
    if (actEl) actEl.innerHTML = this.buyHtml(node, nextCost(economy.data, node), node.currency === 'diamonds')
    // affordability of OTHER rows may have changed (shared wallet) → refresh all buys
    for (const other of WORKSHOP_NODES) {
      if (other.id === node.id) continue
      const oRow = this.root.querySelector(`[data-row="${other.id}"] .ewk-act`)
      if (oRow) oRow.innerHTML = this.buyHtml(other, nextCost(economy.data, other), other.currency === 'diamonds')
    }
  }

  private refreshChips(): void {
    const c = this.root.querySelector('[data-coins]')
    const d = this.root.querySelector('[data-dia]')
    if (c) c.textContent = String(economy.coins)
    if (d) d.textContent = String(economy.diamonds)
  }

  private toast(msg: string): void {
    const t = document.createElement('div')
    t.className = 'ewk-toast'
    t.textContent = msg
    this.root.appendChild(t)
    window.setTimeout(() => t.remove(), appSettings.reducedMotion() ? 900 : 1600)
  }

  private leave(): void {
    playUiTick()
    this.root.classList.add('ewk-leave')
    window.setTimeout(() => this.handlers.onBack(), appSettings.reducedMotion() ? 0 : 240)
  }

  destroy(): void {
    this.root.remove()
  }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
