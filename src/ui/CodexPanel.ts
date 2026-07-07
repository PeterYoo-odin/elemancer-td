// CodexPanel — "The Cadet's Sketchbook". A simple full-screen DOM overlay that
// lists every codex entry by category: unlocked pages read as handwritten field
// notes, locked pages show only a hint of how to earn them. Opened from the
// world map; one tap on ✕ (or the backdrop) closes it.

import { CODEX, CODEX_CATEGORY_LABEL, codexUnlockedCount, isCodexUnlocked, clearCodexFresh, REACTION_ORDER, REACTION_TOTAL, reactionsDiscoveredCount, isReactionDiscovered, type CodexCategory } from '../game/codex'
import { REACTIONS } from '../sim/reactions'
import { playUiTick } from './sfx'
import { iconMarkup, reactionIcon, hexOf } from './icons'

const CSS = `
.ecdx { position: fixed; inset: 0; z-index: 30; display: flex; align-items: center; justify-content: center;
  background: rgba(5,3,14,.78); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);
  font-family: 'Baloo 2','Nunito',system-ui,'Segoe UI',Arial,sans-serif; color: #efe9ff;
  animation: ecdxIn .25s ease both; -webkit-tap-highlight-color: transparent; }
@keyframes ecdxIn { from { opacity: 0; } to { opacity: 1; } }
.ecdx.hide { opacity: 0; transition: opacity .22s ease; pointer-events: none; }
.ecdx-card { width: min(560px, 94vw); height: min(760px, 88vh); display: flex; flex-direction: column;
  border-radius: 22px; overflow: hidden; background: linear-gradient(180deg, #221740 0%, #140c2a 100%);
  border: 1px solid rgba(201,182,255,.3); box-shadow: 0 30px 80px rgba(0,0,0,.7); }
.ecdx-head { display: flex; align-items: center; gap: 10px; padding: 16px 16px 12px;
  border-bottom: 1px solid rgba(255,255,255,.1); }
.ecdx-head .ic { font-size: 24px; }
.ecdx-head .tt { flex: 1 1 auto; }
.ecdx-head .t1 { font-size: 17px; font-weight: 900; letter-spacing: .08em; color: #ffe1a6; }
.ecdx-head .t2 { font-size: 11px; font-weight: 700; letter-spacing: .18em; color: #9d8fc5; }
.ecdx-close { flex: 0 0 auto; width: 40px; height: 40px; border-radius: 50%; border: 1px solid rgba(255,255,255,.2);
  background: rgba(255,255,255,.06); color: #efe9ff; font: inherit; font-size: 17px; font-weight: 800; cursor: pointer; }
.ecdx-close:active { transform: scale(.92); }
.ecdx-body { flex: 1 1 auto; overflow-y: auto; -webkit-overflow-scrolling: touch; padding: 6px 16px 22px; }
.ecdx-cat { margin-top: 16px; font-size: 11px; font-weight: 900; letter-spacing: .3em; color: #b8a5e8; }
.ecdx-e { margin-top: 10px; border-radius: 14px; padding: 12px 14px;
  background: linear-gradient(180deg, rgba(255,255,255,.055), rgba(255,255,255,.02));
  border: 1px solid rgba(255,255,255,.1); }
.ecdx-e .et { font-size: 14.5px; font-weight: 800; color: #ffe8b0; display: flex; align-items: center; gap: 8px; }
.ecdx-e .ex { margin-top: 6px; font-size: 13.5px; line-height: 1.5; color: #d9cff5; }
.ecdx-e.lk { opacity: .62; }
.ecdx-e.lk .et { color: #8d82ad; }
.ecdx-e.lk .ex { font-style: italic; color: #8d82ad; }
.ecdx-e .et svg, .ecdx-cat svg { flex: 0 0 auto; }

/* Reactions Discovered — the crown-jewel combo depth, teased */
.ecdx-rx { margin-top: 8px; border-radius: 16px; padding: 13px 14px;
  background: linear-gradient(180deg, rgba(255,213,74,.1), rgba(255,255,255,.02));
  border: 1px solid rgba(255,213,74,.28); }
.ecdx-rxh { display: flex; align-items: center; gap: 8px; }
.ecdx-rxt { flex: 1 1 auto; font-size: 13px; font-weight: 900; letter-spacing: .1em; color: #ffe1a6; }
.ecdx-rxn { font-size: 15px; font-weight: 900; color: #fff; }
.ecdx-rxs { margin-top: 3px; font-size: 11px; color: #b6a9dd; line-height: 1.5; }
.ecdx-rxg { margin-top: 11px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.ecdx-rxc { display: flex; flex-direction: column; align-items: center; gap: 5px; text-align: center;
  border-radius: 11px; padding: 10px 6px; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.1); }
.ecdx-rxc.on { background: rgba(255,255,255,.07); border-color: rgba(255,255,255,.2); }
.ecdx-rxc .rxi { width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; }
.ecdx-rxc .rxn { font-size: 9.5px; font-weight: 900; letter-spacing: .04em; color: #e6ddff; line-height: 1.15; }
.ecdx-rxc.lk { opacity: .5; }
.ecdx-rxc.lk .rxn { color: #8d82ad; }
`

let cssInjected = false

export class CodexPanel {
  private root: HTMLDivElement

  constructor(onClose: () => void) {
    if (!cssInjected) {
      cssInjected = true
      const style = document.createElement('style')
      style.textContent = CSS
      document.head.appendChild(style)
    }
    clearCodexFresh()

    const cats: CodexCategory[] = ['heroes', 'world', 'morose', 'field']
    const sections = cats
      .map((cat) => {
        const rows = CODEX.filter((e) => e.category === cat)
          .map((e) => {
            const open = isCodexUnlocked(e.id)
            const title = open ? e.title : '??? '
            const body = open ? e.text : e.hint
            const mark = open ? iconMarkup('pencil', { size: 15, color: '#ffe8b0' }) : iconMarkup('lock', { size: 14, color: '#8d82ad' })
            return `<div class="ecdx-e${open ? '' : ' lk'}"><div class="et">${mark} ${esc(title)}</div><div class="ex">${esc(body)}</div></div>`
          })
          .join('')
        return `<div class="ecdx-cat">${CODEX_CATEGORY_LABEL[cat].toUpperCase()}</div>${rows}`
      })
      .join('')

    // REACTIONS DISCOVERED — surface the hidden combo depth (crown jewel).
    const rxCount = reactionsDiscoveredCount()
    const rxCells = REACTION_ORDER.map((key) => {
      const def = REACTIONS[key]
      const found = isReactionDiscovered(key)
      const icon = found
        ? reactionIcon(key, hexOf(def.color), { size: 24 })
        : iconMarkup('lock', { size: 18, color: '#8d82ad' })
      const label = found ? esc(def.name) : '? ? ?'
      return `<div class="ecdx-rxc${found ? ' on' : ' lk'}"><span class="rxi">${icon}</span><span class="rxn">${label}</span></div>`
    }).join('')
    const reactionsSection = `
      <div class="ecdx-rx">
        <div class="ecdx-rxh">
          ${iconMarkup('burst', { size: 20, color: '#ffd54a' })}
          <div class="ecdx-rxt">REACTIONS DISCOVERED <span class="ecdx-rxn">${rxCount}/${REACTION_TOTAL}</span></div>
        </div>
        <div class="ecdx-rxs">Two different elements on one foe within the window detonate a named reaction. The Greying hates it. Find all nine.</div>
        <div class="ecdx-rxg">${rxCells}</div>
      </div>`

    this.root = document.createElement('div')
    this.root.className = 'ecdx'
    this.root.innerHTML = `
      <div class="ecdx-card">
        <div class="ecdx-head">
          <span class="ic">${iconMarkup('book', { size: 24, color: '#ffe1a6' })}</span>
          <span class="tt">
            <div class="t1">THE CADET'S SKETCHBOOK</div>
            <div class="t2">${codexUnlockedCount()} / ${CODEX.length} PAGES FILLED</div>
          </span>
          <button class="ecdx-close" data-close>✕</button>
        </div>
        <div class="ecdx-body">${reactionsSection}${sections}</div>
      </div>`
    this.root.addEventListener('click', (e) => {
      const t = e.target as HTMLElement
      if (t === this.root || t.closest('[data-close]')) {
        playUiTick()
        this.root.classList.add('hide')
        window.setTimeout(() => {
          this.root.remove()
          onClose()
        }, 220)
      }
    })
    document.body.appendChild(this.root)
  }

  destroy(): void {
    this.root.remove()
  }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
