// ADMIN BOOTSTRAP — the auth gate + router for the admin-only Ops dashboard.
// This is a SEPARATE Vite entry (admin.html): main.ts never imports it, so none
// of this ships in the players' game bundle. The dashboard is not linked from
// the game and requires an admin login; but the honest security model (see the
// IP-posture view) is that the client enforces nothing — real data flows only
// through calls the backend authorises by admin role. When no backend is
// configured, the only mode is an explicit, clearly-labelled DEMO session over
// synthetic data (no real data exists to leak).

import './admin.css'
import { isConfigured, backendUrl, loadSession, logout, login, loadRange, saveRange, type AdminSession, type RangeDays } from './config'
import { esc } from './theme'
import { toast } from './ui'
import { unackedCount, ackAll, ack, renderFeed, getFeed } from './alerts'
import type { View, ViewCtx } from './views/view'
import { overviewView } from './views/overview'
import { retentionView } from './views/retention'
import { economyView } from './views/economy'
import { liveopsView } from './views/liveops'
import { securityView } from './views/security'

const VIEWS: View[] = [overviewView, retentionView, economyView, liveopsView, securityView]
const RANGES: RangeDays[] = [7, 14, 30, 90]

let session: AdminSession | null = loadSession()
let range: RangeDays = loadRange()
let activeId = 'overview'

const app = document.getElementById('admin')!

// ---------------------------------------------------------------------------
// Auth gate
// ---------------------------------------------------------------------------
function renderGate(): void {
  const configured = isConfigured()
  app.innerHTML = `
    <div class="gate">
      <div class="gate-card">
        <div class="gate-brand"><span class="gate-glyph">◆</span> CHROMANCER <span class="gate-sub">Ops</span></div>
        <h1>Admin / Ops Dashboard</h1>
        <p class="gate-lead">Player analytics · live-ops control · integrity &amp; IP protection.</p>
        <div class="gate-status ${configured ? 'ok' : 'demo'}">
          ${configured ? `Backend detected — sign in with an admin-role account. Access is authorised <b>server-side</b>.` : `<b>No backend configured.</b> Only DEMO mode is available (synthetic, stable data). Real data flows only through backend calls the server authorises by admin role.`}
        </div>
        <form id="gate-form">
          <label class="gate-label">${configured ? 'Admin passcode' : 'Enter demo'}</label>
          <input id="gate-pass" type="password" autocomplete="off" placeholder="${configured ? '••••••••' : 'click Enter demo →'}" ${configured ? '' : 'disabled'} />
          <button type="submit" class="btn btn--primary btn--wide">${configured ? 'Sign in' : 'Enter demo dashboard'}</button>
          <div id="gate-err" class="gate-err"></div>
        </form>
        <div class="gate-foot">The client holds no secret and gates no real data. This is the IP-protection posture: <b>the server is the moat</b>.</div>
      </div>
    </div>`
  const form = document.getElementById('gate-form') as HTMLFormElement
  const err = document.getElementById('gate-err')!
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    err.textContent = ''
    const pass = (document.getElementById('gate-pass') as HTMLInputElement)?.value ?? ''
    const res = await login(pass)
    if (res.ok && res.session) {
      session = res.session
      renderShell()
    } else {
      err.textContent = res.error ?? 'Sign-in failed.'
    }
  })
}

// ---------------------------------------------------------------------------
// Shell (top bar + nav + content)
// ---------------------------------------------------------------------------
function renderShell(): void {
  if (!session) return renderGate()
  const s = session
  const nav = VIEWS.map((v) => `<button class="nav-item${v.id === activeId ? ' active' : ''}" data-view="${v.id}"><span class="nav-ico">${v.icon}</span>${esc(v.label)}</button>`).join('')
  const rangeSel = RANGES.map((r) => `<button class="range-btn${r === range ? ' active' : ''}" data-range="${r}">${r}d</button>`).join('')
  const bellCount = unackedCount()
  app.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand"><span class="brand-glyph">◆</span> CHROMANCER<span class="brand-tag">Ops</span></div>
        <nav class="nav">${nav}</nav>
        <div class="side-foot">
          <div class="mode-badge mode--${s.mode}">${s.mode === 'live' ? '● LIVE' : '● DEMO'}</div>
          <div class="side-meta">${esc(s.email)} · ${esc(s.role)}</div>
          <div class="side-meta dim">${s.mode === 'live' ? esc(backendUrl() ?? '') : 'synthetic data'}</div>
        </div>
      </aside>
      <main class="main">
        <header class="topbar">
          <div class="topbar-title" id="crumb"></div>
          <div class="topbar-actions">
            <div class="range-group" role="group" aria-label="Date range">${rangeSel}</div>
            <button class="bell" id="bell" aria-label="Alerts">🔔${bellCount ? `<span class="bell-count">${bellCount}</span>` : ''}</button>
            <button class="btn btn--ghost btn--sm" id="logout">Sign out</button>
          </div>
        </header>
        <div class="content" id="content"><div class="loading">Loading…</div></div>
      </main>
    </div>
    <div class="alert-drawer" id="alert-drawer" hidden>
      <div class="drawer-head"><b>Security alerts</b><div><button class="btn btn--sm btn--ghost" id="ack-all">ack all</button><button class="btn btn--sm btn--ghost" id="drawer-close">✕</button></div></div>
      <div id="drawer-body"></div>
    </div>`

  // nav
  app.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) =>
    b.addEventListener('click', () => {
      activeId = b.dataset.view!
      renderShell()
    }),
  )
  // range
  app.querySelectorAll<HTMLButtonElement>('[data-range]').forEach((b) =>
    b.addEventListener('click', () => {
      range = Number(b.dataset.range) as RangeDays
      saveRange(range)
      renderShell()
    }),
  )
  document.getElementById('logout')?.addEventListener('click', () => {
    logout()
    session = null
    renderGate()
  })
  wireBell()
  void renderActiveView()
}

function wireBell(): void {
  const drawer = document.getElementById('alert-drawer')!
  const body = document.getElementById('drawer-body')!
  const refresh = (): void => {
    body.innerHTML = renderFeed(Date.now())
    body.querySelectorAll<HTMLButtonElement>('[data-ack]').forEach((b) =>
      b.addEventListener('click', () => {
        ack(b.dataset.ack!)
        refresh()
        refreshBellCount()
      }),
    )
  }
  document.getElementById('bell')?.addEventListener('click', () => {
    drawer.hidden = !drawer.hidden
    if (!drawer.hidden) refresh()
  })
  document.getElementById('drawer-close')?.addEventListener('click', () => (drawer.hidden = true))
  document.getElementById('ack-all')?.addEventListener('click', () => {
    ackAll()
    refresh()
    refreshBellCount()
  })
}

function refreshBellCount(): void {
  const bell = document.getElementById('bell')
  if (!bell) return
  const n = unackedCount()
  bell.innerHTML = `🔔${n ? `<span class="bell-count">${n}</span>` : ''}`
}

async function renderActiveView(): Promise<void> {
  if (!session) return
  const view = VIEWS.find((v) => v.id === activeId) ?? VIEWS[0]
  const content = document.getElementById('content')
  const crumb = document.getElementById('crumb')
  if (crumb) crumb.innerHTML = `<span class="crumb-ico">${view.icon}</span> ${esc(view.label)}`
  if (!content) return
  const ctx: ViewCtx = { session, range, now: Date.now() }
  try {
    content.innerHTML = await view.render(ctx)
    view.mount?.(content, ctx, () => void renderActiveView())
  } catch (e) {
    content.innerHTML = `<div class="err-panel">Failed to render this view. ${esc(String(e))}</div>`
  }
  refreshBellCount()
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
if (session) renderShell()
else renderGate()

// Surface the freshest alert once on open, if it arrived in the last minute.
if (session && getFeed().length) {
  const latest = getFeed()[0]
  if (latest && Date.now() - latest.ts < 60_000) toast(`Latest alert: ${latest.title}`, 'info')
}
