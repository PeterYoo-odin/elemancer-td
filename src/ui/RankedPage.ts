// RankedPage — the in-game RANKED hub. Three provably-fair boards (Daily seed /
// Weekly seed / All-time Endless), each showing today's shared seed, the public
// top runs (re-run-verified server-side), YOUR rank, and your LOCAL PB history.
// Any top run can be downloaded as a GHOST and raced alongside your live run.
//
// Degrades gracefully: with no backend wired (or offline) the boards show
// "connecting to ranked servers…" while your LOCAL PB history still works — the
// promise is honest either way. Same overlay family as DailySeedPage / StorePage.

import { todaysDaily, seedToCode } from '../game/seedcode'
import { weeklyRankedSeed, weekIndexFor, type RankedMode } from '../game/ranked'
import { rankedConfigured, fetchBoard, fetchRank, registerHandle, localHandle, type BoardRow } from '../game/rankedNet'
import { getAccessToken } from '../game/authNet'
import { localBest, localHistory, type RankedLocalBest } from '../game/rankedLocal'
import { withRef } from '../game/referral'
import { appSettings } from './settings'
import { playUiTick } from './sfx'
import { iconMarkup } from './icons'

export interface RankedHandlers {
  onBack(): void
  onPlay(mode: RankedMode, seed: number | undefined): void
  onGhost(mode: RankedMode, seed: number, runId: string): void
}

const CSS = `
.erk, .erk * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
.erk {
  position: fixed; inset: 0; z-index: 15; display: flex; flex-direction: column; color: #efe9ff;
  font-family: 'Baloo 2','Nunito',system-ui,-apple-system,'Segoe UI',Arial,sans-serif;
  padding-top: env(safe-area-inset-top);
  background:
    radial-gradient(90% 50% at 50% -8%, rgba(141,255,74,.16), transparent 60%),
    linear-gradient(180deg, #141026 0%, #0c0a1e 55%, #070510 100%);
  transition: opacity .25s ease;
}
.erk.erk-leave { opacity: 0; pointer-events: none; }
.erk.erk-reduced { transition: none; }

.erk-head { display: flex; align-items: center; gap: 9px; padding: 12px 14px 8px; max-width: 580px; width: 100%; margin: 0 auto; }
.erk-back { width: 40px; height: 40px; border-radius: 50%; border: 1px solid rgba(255,255,255,.16); flex: 0 0 auto;
  background: rgba(255,255,255,.06); color: #e6ddff; font: inherit; font-size: 21px; cursor: pointer; }
.erk-back:active { transform: scale(.92); }
.erk-title { font-size: 21px; font-weight: 900; letter-spacing: .16em; color: #fff; display: flex; align-items: center; gap: 8px; }
.erk-title .lock { font-size: 14px; }

.erk-tabs { display: flex; gap: 6px; max-width: 580px; width: 100%; margin: 4px auto 0; padding: 0 14px; }
.erk-tab { flex: 1 1 0; padding: 9px 4px; border-radius: 11px; font: inherit; font-size: 12px; font-weight: 900;
  letter-spacing: .1em; cursor: pointer; color: #b3a6da; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.1); }
.erk-tab.on { color: #071; background: linear-gradient(180deg, #c9ff9a, #7fe04a); border-color: transparent; color: #12300a; }
.erk-tab:active { transform: scale(.97); }

.erk-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch;
  padding: 10px 14px calc(28px + env(safe-area-inset-bottom)); }
.erk-inner { max-width: 580px; margin: 0 auto; display: flex; flex-direction: column; gap: 13px; }

.erk-seedcard { border-radius: 18px; padding: 16px; text-align: center;
  background: linear-gradient(180deg, rgba(141,255,74,.1), rgba(255,255,255,.03));
  border: 1px solid rgba(141,255,74,.3); box-shadow: 0 14px 40px rgba(0,0,0,.4); }
.erk-kick { font-size: 10.5px; font-weight: 900; letter-spacing: .26em; color: #a6e57a; }
.erk-code { margin: 8px 0 2px; font-size: clamp(22px, 7vw, 34px); font-weight: 900; letter-spacing: .05em; color: #fff;
  text-shadow: 0 2px 16px rgba(141,255,74,.32); }
.erk-sub { font-size: 11.5px; color: #a99dd1; line-height: 1.5; margin-top: 5px; }
.erk-actions { display: flex; gap: 8px; margin-top: 13px; }
.erk-play { flex: 2 1 0; padding: 13px; border-radius: 13px; border: 0; font: inherit; font-size: 15px; font-weight: 900;
  letter-spacing: .05em; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  background: linear-gradient(180deg, #d6ffab, #7fe04a 82%); color: #143007; box-shadow: 0 8px 22px rgba(127,224,74,.3); }
.erk-play:active { transform: scale(.98); }
.erk-copy { flex: 1 1 0; padding: 13px 8px; border-radius: 13px; font: inherit; font-size: 12px; font-weight: 800;
  cursor: pointer; background: rgba(255,255,255,.06); color: #d9ceff; border: 1px solid rgba(255,255,255,.18);
  display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
.erk-copy:active { transform: scale(.98); }

.erk-yourank { display: flex; align-items: center; gap: 10px; border-radius: 13px; padding: 11px 14px;
  background: linear-gradient(180deg, rgba(255,213,74,.1), rgba(255,255,255,.02)); border: 1px solid rgba(255,213,74,.3); }
.erk-yourank .rk { font-size: 22px; font-weight: 900; color: #ffe08a; }
.erk-yourank .lab { flex: 1 1 auto; font-size: 12px; font-weight: 800; color: #e6ddff; line-height: 1.4; }
.erk-yourank .pb { font-size: 12px; font-weight: 900; color: #bfe9ff; text-align: right; }

.erk-h2 { font-size: 10.5px; font-weight: 900; letter-spacing: .2em; color: #9d92c4; margin: 6px 2px 0; display: flex; justify-content: space-between; align-items: center; }
.erk-h2 .mini { font-size: 10px; font-weight: 800; letter-spacing: .08em; color: #7de04a; cursor: pointer; }
.erk-list { display: flex; flex-direction: column; gap: 6px; }
.erk-row { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-radius: 11px;
  background: linear-gradient(180deg, rgba(255,255,255,.05), rgba(255,255,255,.018)); border: 1px solid rgba(255,255,255,.09); }
.erk-row.me { border-color: rgba(255,213,74,.45); background: linear-gradient(180deg, rgba(255,213,74,.09), rgba(255,255,255,.02)); }
.erk-row .rank { width: 26px; font-size: 13px; font-weight: 900; color: #c8bdf0; text-align: center; flex: 0 0 auto; }
.erk-row .rank.top { color: #ffd54a; }
.erk-row .who { flex: 1 1 auto; min-width: 0; font-size: 13px; font-weight: 800; color: #e6ddff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.erk-row .sc { font-size: 13px; font-weight: 900; color: #fff; flex: 0 0 auto; }
.erk-row .wv { font-size: 10.5px; font-weight: 800; color: #9db8cc; flex: 0 0 auto; }
.erk-row .ghost { flex: 0 0 auto; width: 30px; height: 30px; border-radius: 9px; border: 1px solid rgba(180,140,255,.4);
  background: rgba(180,140,255,.12); color: #d9c9ff; font-size: 15px; cursor: pointer; }
.erk-row .ghost:active { transform: scale(.9); }

.erk-empty { padding: 16px 14px; text-align: center; font-size: 12px; color: #9d92c4; line-height: 1.6;
  border-radius: 11px; border: 1px dashed rgba(255,255,255,.16); }
.erk-empty.connecting { border-color: rgba(141,255,74,.3); color: #a6e57a; }
.erk-retry { margin-top: 10px; padding: 7px 22px; border-radius: 10px; cursor: pointer; font: 800 11px inherit;
  letter-spacing: .12em; color: #a6e57a; background: rgba(141,255,74,.12); border: 1px solid rgba(141,255,74,.4); }
.erk-retry:active { transform: scale(.96); }

.erk-promise { border-radius: 13px; padding: 13px 15px; text-align: center;
  background: rgba(141,255,74,.07); border: 1px solid rgba(141,255,74,.26); }
.erk-promise .p1 { font-size: 13px; font-weight: 900; color: #c7f5a0; letter-spacing: .01em; }
.erk-promise .p2 { margin-top: 5px; font-size: 11px; color: #a3c99a; line-height: 1.55; }
`

let cssInjected = false

export class RankedPage {
  private root: HTMLDivElement
  private handlers: RankedHandlers
  private mode: RankedMode = 'daily'
  private reqToken = 0

  constructor(handlers: RankedHandlers) {
    this.handlers = handlers
    if (!cssInjected) {
      cssInjected = true
      const style = document.createElement('style')
      style.textContent = CSS
      document.head.appendChild(style)
    }
    this.root = document.createElement('div')
    this.root.className = 'erk'
    if (appSettings.reducedMotion()) this.root.classList.add('erk-reduced')
    this.renderShell()
    document.body.appendChild(this.root)
    void this.renderBoard()
  }

  // --- seed + period for the active mode ---
  private seedFor(mode: RankedMode): { seed: number | undefined; code: string | null; period: number } {
    // PathForge shares the DAILY seed pattern — everyone forges the same maze
    // puzzle that UTC day (see rankedPeriod()) — but is its own board (mode).
    if (mode === 'daily' || mode === 'pathforge') { const t = todaysDaily(); return { seed: t.seed, code: t.code, period: t.day } }
    if (mode === 'weekly') { const w = weekIndexFor(); const s = weeklyRankedSeed(w); return { seed: s, code: seedToCode(s), period: w } }
    return { seed: undefined, code: null, period: 0 } // endless: a per-player seed
  }

  private renderShell(): void {
    this.root.innerHTML = `
      <div class="erk-head">
        <button class="erk-back" data-back aria-label="Back">‹</button>
        <div class="erk-title">RANKED <span class="lock">🔒</span></div>
      </div>
      <div class="erk-tabs">
        <button class="erk-tab" data-tab="daily">DAILY</button>
        <button class="erk-tab" data-tab="weekly">WEEKLY</button>
        <button class="erk-tab" data-tab="endless">ENDLESS</button>
        <button class="erk-tab" data-tab="pathforge">PATHFORGE</button>
      </div>
      <div class="erk-body"><div class="erk-inner" data-inner></div></div>`
    this.root.querySelector('[data-back]')!.addEventListener('click', () => this.leave())
    for (const tab of this.root.querySelectorAll<HTMLElement>('[data-tab]')) {
      tab.addEventListener('click', () => {
        const m = tab.dataset.tab as RankedMode
        if (m === this.mode) return
        playUiTick()
        this.mode = m
        void this.renderBoard()
      })
    }
    this.syncTabs()
  }

  private syncTabs(): void {
    for (const tab of this.root.querySelectorAll<HTMLElement>('[data-tab]')) {
      tab.classList.toggle('on', tab.dataset.tab === this.mode)
    }
  }

  private async renderBoard(): Promise<void> {
    this.syncTabs()
    const inner = this.root.querySelector<HTMLElement>('[data-inner]')!
    const mode = this.mode
    const { seed, code, period } = this.seedFor(mode)
    const mine = localBest(mode, period)
    const history = localHistory(mode, 12)

    const kick = mode === 'daily' ? "TODAY'S SEED · EVERYONE, EVERYWHERE"
      : mode === 'weekly' ? "THIS WEEK'S SEED · SHARED BY ALL"
      : mode === 'pathforge' ? "TODAY'S MAZE · SAME PUZZLE FOR EVERYONE"
      : 'ENDLESS · YOUR OWN SEED, ALL-TIME HIGH SCORES'
    const seedBlock = code
      ? `<div class="erk-code">${esc(code.split('-').join(' · '))}</div>
         <div class="erk-sub">${mode === 'pathforge' ? 'Paint the same open grid everyone forges today — the replay is re-verified.' : 'Same waves, same rolls — the only variable is you.'}</div>`
      : `<div class="erk-code" style="font-size:22px">ALL-TIME</div>
         <div class="erk-sub">A fresh seed each run. Climb the endless ladder — every score re-run-verified.</div>`

    inner.innerHTML = `
      <div class="erk-seedcard">
        <div class="erk-kick">${esc(kick)}</div>
        ${seedBlock}
        <div class="erk-actions">
          <button class="erk-play" data-play>${iconMarkup('storm', { color: '#143007' })}${mode === 'endless' ? 'Play Endless' : mode === 'pathforge' ? 'Open the Forge' : 'Play this seed'}</button>
          ${code ? `<button class="erk-copy" data-copy>${iconMarkup('link', { size: 14 })}<span data-copylabel>Copy link</span></button>` : ''}
        </div>
      </div>

      <div class="erk-yourank" data-yourank>
        <div class="rk">${mine ? '#—' : '—'}</div>
        <div class="lab">Your best ${labelForMode(mode)}${mine ? '' : ' — play to set it'}<br>
          <span data-sethandle style="font-size:10.5px;font-weight:800;color:#8dff4a;cursor:pointer;letter-spacing:.04em">
            ${localHandle() ? '✎ ' + esc(localHandle()!) : '✎ Claim a handle'}</span></div>
        <div class="pb">${mine ? `${mine.score.toLocaleString()}<br><span style="opacity:.7;font-size:10px">wave ${mine.wave}</span>` : ''}</div>
      </div>

      <div class="erk-h2"><span>TOP RUNS${mode === 'endless' ? '' : ' · THIS ' + (mode === 'daily' || mode === 'pathforge' ? 'DAY' : 'WEEK')}</span></div>
      <div data-board><div class="erk-empty connecting">${rankedConfigured() ? 'Loading the board…' : 'Connecting to ranked servers…'}</div></div>

      <div class="erk-h2"><span>YOUR PB HISTORY</span></div>
      ${history.length === 0
        ? `<div class="erk-empty">No ranked runs yet. Every run you finish records a shareable seed and a replay we re-run to verify.</div>`
        : `<div class="erk-list">${history.map((h) => historyRow(h, mode)).join('')}</div>`}

      <div class="erk-promise">
        <div class="p1">A leaderboard money can't climb</div>
        <div class="p2">Every run is a seed you can share and a replay we re-run to verify. Nothing you buy touches Ranked.</div>
      </div>`

    // actions
    inner.querySelector('[data-play]')?.addEventListener('click', () => {
      playUiTick()
      this.root.classList.add('erk-leave')
      window.setTimeout(() => this.handlers.onPlay(mode, seed), appSettings.reducedMotion() ? 0 : 200)
    })
    inner.querySelector('[data-copy]')?.addEventListener('click', () => this.copyLink(code!))
    inner.querySelector('[data-sethandle]')?.addEventListener('click', () => this.promptHandle())

    // async board fetch (guarded by a token so stale tab switches don't clobber)
    const token = ++this.reqToken
    if (!rankedConfigured()) return
    const rows = await fetchBoard(mode, period, 50)
    if (token !== this.reqToken) return
    const boardEl = inner.querySelector<HTMLElement>('[data-board]')
    if (!boardEl) return
    if (rows === null) {
      // OUTAGE ≠ EMPTY: never tell a player "no runs yet" when the truth is
      // "we couldn't reach the board". Warm copy + a retry, local PBs intact.
      boardEl.innerHTML =
        `<div class="erk-empty connecting">The boards are waking up — your runs are safe on this device and will sync.` +
        `<br/><button class="erk-retry" data-retry>RETRY</button></div>`
      boardEl.querySelector<HTMLElement>('[data-retry]')?.addEventListener('click', () => {
        playUiTick()
        void this.renderBoard()
      })
    } else if (rows.length === 0) {
      boardEl.innerHTML = `<div class="erk-empty">No runs on this board yet — be the first to set the pace.</div>`
    } else {
      boardEl.innerHTML = `<div class="erk-list">${rows.map((r, i) => boardRow(r, i, mode)).join('')}</div>`
      for (const g of boardEl.querySelectorAll<HTMLElement>('[data-ghost]')) {
        g.addEventListener('click', () => {
          const runId = g.dataset.ghost!
          const gseed = Number(g.dataset.seed) >>> 0
          playUiTick()
          this.root.classList.add('erk-leave')
          window.setTimeout(() => this.handlers.onGhost(mode, gseed, runId), appSettings.reducedMotion() ? 0 : 200)
        })
      }
    }

    // your rank (only meaningful with a local best to compare)
    if (mine) {
      const rank = await fetchRank(mode, period, mine.score)
      if (token !== this.reqToken) return
      const ru = inner.querySelector<HTMLElement>('[data-yourank] .rk')
      if (ru && rank) ru.textContent = `#${rank}`
    }
  }

  // Claim / change the anonymous account's display handle. Uses a simple prompt
  // (kept lightweight on purpose) and syncs to the ranked account when wired.
  private promptHandle(): void {
    playUiTick()
    const current = localHandle() ?? ''
    const raw = window.prompt('Choose a handle for the ranked board (letters, numbers, spaces):', current)
    if (raw == null) return
    const clean = raw.replace(/[^\w \-]/g, '').trim().slice(0, 24)
    if (!clean) return
    // When signed in, claim the handle on the durable auth account (portable);
    // otherwise on the guest device row. Token fetch degrades to guest on failure.
    void getAccessToken().then((token) => registerHandle(clean, token ?? undefined)).then(() => void this.renderBoard())
  }

  private copyLink(code: string): void {
    playUiTick()
    const label = this.root.querySelector('[data-copylabel]')
    let base = 'https://chromancer.io/'
    try {
      if (typeof location !== 'undefined' && /^https?:$/.test(location.protocol)) base = location.origin + location.pathname
    } catch { /* non-browser */ }
    const link = withRef(`${base}?seed=${encodeURIComponent(code)}`)
    const done = (): void => {
      if (!label) return
      const prev = label.textContent
      label.textContent = 'Copied!'
      window.setTimeout(() => { if (label) label.textContent = prev }, 1400)
    }
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(link).then(done, done)
    else done()
  }

  private leave(): void {
    playUiTick()
    this.root.classList.add('erk-leave')
    window.setTimeout(() => this.handlers.onBack(), appSettings.reducedMotion() ? 0 : 240)
  }

  destroy(): void {
    this.reqToken++
    this.root.remove()
  }
}

// re-export so the menu can offer a handle prompt without importing rankedNet
export { registerHandle, localHandle }

function labelForMode(mode: RankedMode): string {
  return mode === 'daily' ? 'today' : mode === 'weekly' ? 'this week' : mode === 'pathforge' ? "today's maze" : 'all-time'
}

function boardRow(r: BoardRow, i: number, mode: RankedMode): string {
  const rank = i + 1
  const me = r.handle && r.handle === localHandle()
  const name = r.handle ? esc(r.handle) : 'anonymous'
  return `<div class="erk-row${me ? ' me' : ''}">
    <span class="rank${rank <= 3 ? ' top' : ''}">${rank}</span>
    <span class="who">${name}</span>
    <span class="sc">${r.score.toLocaleString()}</span>
    <span class="wv">W${r.wave}</span>
    <button class="ghost" data-ghost="${esc(r.id)}" data-seed="${r.seed}" title="Race this run's ghost" aria-label="Race ghost">👻</button>
  </div>`
}

function historyRow(h: RankedLocalBest, _mode: RankedMode): string {
  const when = h.mode === 'endless' ? new Date(h.at).toLocaleDateString() : periodLabel(h.mode, h.period)
  return `<div class="erk-row">
    <span class="rank">★</span>
    <span class="who">${esc(when)}</span>
    <span class="sc">${h.score.toLocaleString()}</span>
    <span class="wv">W${h.wave}</span>
  </div>`
}

function periodLabel(mode: RankedMode, period: number): string {
  if (mode === 'daily' || mode === 'pathforge') {
    const ms = period * 86_400_000
    return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
  }
  if (mode === 'weekly') {
    const isThis = period === weekIndexFor()
    return isThis ? 'This week' : `Week ${period}`
  }
  return 'All-time'
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
