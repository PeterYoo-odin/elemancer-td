// CodexPanel — "The Cadet's Sketchbook". A simple full-screen DOM overlay that
// lists every codex entry by category: unlocked pages read as handwritten field
// notes, locked pages show only a hint of how to earn them. Opened from the
// world map; one tap on ✕ (or the backdrop) closes it.

import { CODEX, CODEX_CATEGORY_LABEL, codexUnlockedCount, isCodexUnlocked, clearCodexFresh, type CodexCategory } from '../game/codex'
import { playUiTick } from './sfx'

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
            return `<div class="ecdx-e${open ? '' : ' lk'}"><div class="et">${open ? '✎' : '🔒'} ${esc(title)}</div><div class="ex">${esc(body)}</div></div>`
          })
          .join('')
        return `<div class="ecdx-cat">${CODEX_CATEGORY_LABEL[cat].toUpperCase()}</div>${rows}`
      })
      .join('')

    this.root = document.createElement('div')
    this.root.className = 'ecdx'
    this.root.innerHTML = `
      <div class="ecdx-card">
        <div class="ecdx-head">
          <span class="ic">📖</span>
          <span class="tt">
            <div class="t1">THE CADET'S SKETCHBOOK</div>
            <div class="t2">${codexUnlockedCount()} / ${CODEX.length} PAGES FILLED</div>
          </span>
          <button class="ecdx-close" data-close>✕</button>
        </div>
        <div class="ecdx-body">${sections}</div>
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
