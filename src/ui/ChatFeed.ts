// ChatFeed — the docked battle CHAT/LOG. Every conversational line (hero barks,
// Morose taunts, event notes) lands here instead of floating over the board.
//
//   wide screens (≥900px): a translucent scrolling feed pinned bottom-left,
//   above the action dock — always visible, never over the play space centre.
//   narrow/portrait: collapsed to a 💬 tab with an unread badge; tapping opens
//   a drawer anchored to the same corner. It counts as a contextual panel, so
//   opening it closes the upgrade panel (via onExpand) and vice-versa.
//
// Positioning rides the HUD's --dock-h variable so the feed always clears the
// bottom action bar exactly, whatever rows the dock currently shows.

import { speakerInfo } from './barkUi'
import { glyphIcon, iconMarkup } from './icons'

const CSS = `
.eld-chat { position:absolute; left:8px; bottom: calc(var(--dock-h, 230px) + 10px); z-index:24;
  display:flex; flex-direction:column; align-items:flex-start; gap:6px; pointer-events:none; }
.eld-chat-panel { pointer-events:auto; width:min(300px, 74vw); max-height:24vh; overflow-y:auto;
  overscroll-behavior:contain; scrollbar-width:thin; display:flex; flex-direction:column; gap:6px;
  padding:8px 9px; border-radius:14px; background:rgba(15,9,30,.72);
  border:1px solid rgba(255,255,255,.12); backdrop-filter:blur(4px); }
.eld-chat-msg { display:flex; gap:7px; align-items:flex-start; animation:eldchatin .25s ease-out; }
.eld-chat-msg .cg { flex:0 0 auto; width:22px; height:22px; border-radius:50%; display:grid;
  place-items:center; font-size:12px; border:1px solid var(--ck,#b06bff);
  background:linear-gradient(180deg, rgba(46,32,90,.9), rgba(24,14,48,.9)); }
.eld-chat-msg .cb { min-width:0; }
.eld-chat-msg .cn { font-size:9.5px; font-weight:900; letter-spacing:.12em; color:var(--ck,#b06bff); }
.eld-chat-msg .ct { font-size:12.5px; line-height:1.3; font-weight:600; color:#e6dfff; overflow-wrap:break-word; }
.eld-chat-msg.morose .ct { font-style:italic; color:#cfcbdd; }
.eld-chat-msg.event { align-items:center; }
.eld-chat-msg.event .ct { font-size:11px; font-weight:700; font-style:italic; color:#a99cd0; }
@keyframes eldchatin { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:none; } }
@media (prefers-reduced-motion: reduce) { .eld-chat-msg { animation:none; } }
.eld-chat-tab { display:none; pointer-events:auto; position:relative; width:44px; height:44px;
  border-radius:50%; place-items:center; font-size:19px; cursor:pointer;
  background:linear-gradient(180deg,#2f2258,#241a44); border:1px solid rgba(255,255,255,.16);
  box-shadow:0 4px 12px rgba(0,0,0,.4); color:#fff; }
.eld-chat-tab .ub { position:absolute; top:-4px; right:-4px; min-width:18px; height:18px;
  border-radius:9px; background:#ff5b7a; font-size:11px; font-weight:900; line-height:18px;
  text-align:center; padding:0 4px; }
.eld-chat-tab .ub:empty { display:none; }
@media (max-width:899px) {
  .eld-chat-panel { display:none; width:min(320px, 82vw); max-height:32vh; }
  .eld-chat.open .eld-chat-panel { display:flex; }
  .eld-chat-tab { display:grid; }
}
`

let cssInjected = false
const MAX_ENTRIES = 40

export type FeedKind = 'bark' | 'event'

export class ChatFeed {
  readonly root: HTMLDivElement
  private panel: HTMLDivElement
  private tab: HTMLButtonElement
  private badge: HTMLSpanElement
  private unread = 0
  private wide: MediaQueryList

  constructor(private onExpand?: () => void) {
    if (!cssInjected) {
      cssInjected = true
      const style = document.createElement('style')
      style.textContent = CSS
      document.head.appendChild(style)
    }
    this.wide = matchMedia('(min-width: 900px)')
    this.root = document.createElement('div')
    this.root.className = 'eld-chat'
    this.panel = document.createElement('div')
    this.panel.className = 'eld-chat-panel'
    this.tab = document.createElement('button')
    this.tab.className = 'eld-chat-tab'
    this.tab.innerHTML = iconMarkup('chat', { size: 22, color: '#efe9ff' })
    this.badge = document.createElement('span')
    this.badge.className = 'ub'
    this.tab.appendChild(this.badge)
    this.tab.onclick = () => this.toggle()
    this.root.append(this.panel, this.tab)
  }

  private toggle(): void {
    if (this.root.classList.contains('open')) {
      this.collapse()
    } else {
      this.onExpand?.() // one contextual panel at a time: close the upgrade panel
      this.root.classList.add('open')
      this.unread = 0
      this.badge.textContent = ''
      this.panel.scrollTop = this.panel.scrollHeight
    }
  }

  /** Close the portrait drawer (no-op on wide layouts where the feed is docked). */
  collapse(): void {
    this.root.classList.remove('open')
  }

  /** Append a line. speaker=null → dim italic event line; else a bark bubble row. */
  add(speaker: string | null, text: string, kind: FeedKind = 'bark'): void {
    const msg = document.createElement('div')
    if (kind === 'event' || !speaker) {
      msg.className = 'eld-chat-msg event'
      const t = document.createElement('div')
      t.className = 'ct'
      t.textContent = `· ${text}`
      msg.appendChild(t)
    } else {
      const s = speakerInfo(speaker)
      msg.className = 'eld-chat-msg' + (speaker === 'morose' ? ' morose' : '')
      msg.style.setProperty('--ck', s.color)
      const g = document.createElement('div')
      g.className = 'cg'
      g.innerHTML = glyphIcon(s.glyph, { size: 18, color: s.color })
      const b = document.createElement('div')
      b.className = 'cb'
      const n = document.createElement('div')
      n.className = 'cn'
      n.textContent = s.name
      const t = document.createElement('div')
      t.className = 'ct'
      t.textContent = text
      b.append(n, t)
      msg.append(g, b)
    }
    this.panel.appendChild(msg)
    while (this.panel.children.length > MAX_ENTRIES) this.panel.firstElementChild?.remove()
    const visible = this.wide.matches || this.root.classList.contains('open')
    if (visible) {
      this.panel.scrollTop = this.panel.scrollHeight
    } else if (kind !== 'event') {
      this.unread = Math.min(9, this.unread + 1)
      this.badge.textContent = String(this.unread)
    }
  }

  dispose(): void {
    this.root.remove()
  }
}
