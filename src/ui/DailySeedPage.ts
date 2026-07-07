// DailySeedPage — the in-game "daily run" habit loop, ZERO backend. Shows TODAY'S
// deterministic seed (the same WORD-WORD-NN every device derives for this UTC day,
// via seedcode.ts `todaysDaily`), a one-tap "Play today's seed" into the seeded
// endless run, and a PURELY LOCAL best-per-day history + streak/PB from
// localStorage (see daily.ts). No global board is faked here — the copy promises
// "a leaderboard money can't climb — servers coming", bridging to real ranked
// servers later. Same overlay family as FrontPage / StorePage (typography, glass,
// reduce-motion, safe-area).

import { todaysDaily } from '../game/seedcode'
import { withRef } from '../game/referral'
import { dailyHistory, dailyPB, dailyStreak, dailyDaysPlayed, bestForDay, playedToday, utcDailyDate } from '../game/daily'
import { appSettings } from './settings'
import { playUiTick } from './sfx'
import { currencyIcon, iconMarkup } from './icons'

export interface DailySeedHandlers {
  onBack(): void
  onPlay(seed: number): void
}

const CSS = `
.eds, .eds * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
.eds {
  position: fixed; inset: 0; z-index: 15; display: flex; flex-direction: column; color: #efe9ff;
  font-family: 'Baloo 2','Nunito',system-ui,-apple-system,'Segoe UI',Arial,sans-serif;
  padding-top: env(safe-area-inset-top);
  background:
    radial-gradient(90% 50% at 50% -8%, rgba(255,180,74,.22), transparent 60%),
    linear-gradient(180deg, #1a1230 0%, #0c0a1e 55%, #070510 100%);
  transition: opacity .25s ease;
}
.eds.eds-leave { opacity: 0; pointer-events: none; }
.eds.eds-reduced { transition: none; }

.eds-head { display: flex; align-items: center; gap: 9px; padding: 12px 14px 8px; max-width: 560px; width: 100%; margin: 0 auto; }
.eds-back { width: 40px; height: 40px; border-radius: 50%; border: 1px solid rgba(255,255,255,.16); flex: 0 0 auto;
  background: rgba(255,255,255,.06); color: #e6ddff; font: inherit; font-size: 21px; cursor: pointer; }
.eds-back:active { transform: scale(.92); }
.eds-title { font-size: 21px; font-weight: 900; letter-spacing: .16em; color: #fff; }

.eds-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch;
  padding: 4px 16px calc(28px + env(safe-area-inset-bottom)); }
.eds-inner { max-width: 560px; margin: 0 auto; display: flex; flex-direction: column; gap: 14px; }

/* hero seed card */
.eds-seedcard { margin-top: 6px; border-radius: 20px; padding: 20px 18px; text-align: center;
  background: linear-gradient(180deg, rgba(255,213,74,.12), rgba(255,255,255,.03));
  border: 1px solid rgba(255,213,74,.34); box-shadow: 0 18px 46px rgba(0,0,0,.4); }
.eds-kick { font-size: 11px; font-weight: 900; letter-spacing: .28em; color: #ffcf7a; }
.eds-date { margin-top: 4px; font-size: 12.5px; font-weight: 700; color: #b9adde; letter-spacing: .04em; }
.eds-code { margin: 12px 0 2px; font-size: clamp(26px, 8.5vw, 40px); font-weight: 900; letter-spacing: .06em;
  color: #fff; text-shadow: 0 2px 18px rgba(255,213,74,.4); display: flex; align-items: center; justify-content: center; gap: 12px; }
.eds-code .fl { color: #ffd54a; opacity: .85; }
.eds-code .fl svg { width: .8em; height: .8em; }
.eds-sub { font-size: 12px; color: #a99dd1; line-height: 1.5; margin-top: 6px; }

/* actions */
.eds-play { margin-top: 16px; width: 100%; padding: 15px; border-radius: 15px; border: 0; font: inherit;
  font-size: 16px; font-weight: 900; letter-spacing: .06em; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 9px;
  background: linear-gradient(180deg, #ffe9a8, #f0a832 82%); color: #3a2604; box-shadow: 0 10px 26px rgba(240,168,50,.32); }
.eds-play:active { transform: scale(.98); }
.eds-play svg { width: 19px; height: 19px; }
.eds-copy { margin-top: 9px; width: 100%; padding: 11px; border-radius: 12px; font: inherit; font-size: 13px; font-weight: 800;
  letter-spacing: .05em; cursor: pointer; background: rgba(255,255,255,.06); color: #d9ceff; border: 1px solid rgba(255,255,255,.18);
  display: inline-flex; align-items: center; justify-content: center; gap: 7px; }
.eds-copy:active { transform: scale(.98); }
.eds-copy svg { width: 15px; height: 15px; }

/* stat strip */
.eds-stats { display: flex; gap: 10px; }
.eds-stat { flex: 1 1 0; border-radius: 14px; padding: 12px 8px; text-align: center;
  background: linear-gradient(180deg, rgba(255,255,255,.055), rgba(255,255,255,.02)); border: 1px solid rgba(255,255,255,.11); }
.eds-stat .v { font-size: 24px; font-weight: 900; color: #fff; display: inline-flex; align-items: center; gap: 5px; }
.eds-stat .v svg { width: 18px; height: 18px; }
.eds-stat .l { margin-top: 3px; font-size: 10px; font-weight: 800; letter-spacing: .14em; color: #9d92c4; }

/* promise ribbon */
.eds-promise { border-radius: 14px; padding: 12px 14px; text-align: center;
  background: rgba(143,233,255,.08); border: 1px solid rgba(143,233,255,.28); }
.eds-promise .p1 { font-size: 13.5px; font-weight: 900; color: #bfe9ff; letter-spacing: .02em; }
.eds-promise .p2 { margin-top: 4px; font-size: 11.5px; color: #9db8cc; line-height: 1.5; }

/* history */
.eds-h2 { font-size: 11px; font-weight: 900; letter-spacing: .22em; color: #9d92c4; margin: 4px 2px 0; }
.eds-list { display: flex; flex-direction: column; gap: 7px; }
.eds-row { display: flex; align-items: center; gap: 10px; padding: 10px 13px; border-radius: 12px;
  background: linear-gradient(180deg, rgba(255,255,255,.05), rgba(255,255,255,.018)); border: 1px solid rgba(255,255,255,.1); }
.eds-row.today { border-color: rgba(255,213,74,.4); background: linear-gradient(180deg, rgba(255,213,74,.1), rgba(255,255,255,.02)); }
.eds-row .d { flex: 1 1 auto; font-size: 13.5px; font-weight: 800; color: #e6ddff; }
.eds-row .badge { font-size: 9px; font-weight: 900; letter-spacing: .1em; color: #ffcf7a; border: 1px solid rgba(255,213,74,.4);
  border-radius: 999px; padding: 2px 7px; background: rgba(255,213,74,.1); }
.eds-row .w { font-size: 13.5px; font-weight: 900; color: #ffe08a; display: inline-flex; align-items: center; gap: 5px; }
.eds-row .w svg { width: 14px; height: 14px; }
.eds-empty { padding: 18px 14px; text-align: center; font-size: 12.5px; color: #9d92c4; line-height: 1.6;
  border-radius: 12px; border: 1px dashed rgba(255,255,255,.16); }
`

let cssInjected = false

export class DailySeedPage {
  private root: HTMLDivElement
  private handlers: DailySeedHandlers
  private seed: number

  constructor(handlers: DailySeedHandlers) {
    this.handlers = handlers
    const today = todaysDaily()
    this.seed = today.seed

    if (!cssInjected) {
      cssInjected = true
      const style = document.createElement('style')
      style.textContent = CSS
      document.head.appendChild(style)
    }

    this.root = document.createElement('div')
    this.root.className = 'eds'
    if (appSettings.reducedMotion()) this.root.classList.add('eds-reduced')
    this.render(today.code)
    document.body.appendChild(this.root)
  }

  private render(code: string): void {
    const streak = dailyStreak()
    const pb = dailyPB()
    const todayBest = bestForDay(todaysDaily().day)
    const history = dailyHistory(14)
    const codeParts = code.split('-')

    this.root.innerHTML = `
      <div class="eds-head">
        <button class="eds-back" data-back aria-label="Back">‹</button>
        <div class="eds-title">DAILY SEED</div>
      </div>
      <div class="eds-body">
        <div class="eds-inner">
          <div class="eds-seedcard">
            <div class="eds-kick">TODAY'S RUN · EVERYONE, EVERYWHERE</div>
            <div class="eds-date">${esc(utcDailyDate())}</div>
            <div class="eds-code"><span class="fl">${iconMarkup('sparkle', { color: '#ffd54a' })}</span>${esc(codeParts.join(' · '))}<span class="fl">${iconMarkup('sparkle', { color: '#ffd54a' })}</span></div>
            <div class="eds-sub">One shared seed. Same waves, same rolls — the only variable is you.${todayBest > 0 ? ` <b style="color:#ffe08a">Your best today: wave ${todayBest}.</b>` : ''}</div>
            <button class="eds-play" data-play>${iconMarkup('storm', { color: '#3a2604' })}Play today's seed</button>
            <button class="eds-copy" data-copy>${iconMarkup('link', { size: 15 })}<span data-copylabel>Copy challenge link</span></button>
          </div>

          <div class="eds-stats">
            <div class="eds-stat"><div class="v">${iconMarkup('burst', { size: 18, color: '#ff9a4a' })}${streak}</div><div class="l">DAY STREAK</div></div>
            <div class="eds-stat"><div class="v">${currencyIcon('star', { size: 18 })}${pb || '—'}</div><div class="l">BEST WAVE</div></div>
            <div class="eds-stat"><div class="v">${dailyDaysPlayed()}</div><div class="l">DAYS PLAYED</div></div>
          </div>

          <div class="eds-promise">
            <div class="p1">A leaderboard money can't climb</div>
            <div class="p2">This history is yours alone, saved on this device. Global ranked servers are coming — no pay-to-win, ever.</div>
          </div>

          <div class="eds-h2">YOUR RUN HISTORY</div>
          ${history.length === 0
            ? `<div class="eds-empty">No runs yet. Beat today's seed to start your streak — come back tomorrow for a fresh one.</div>`
            : `<div class="eds-list">${history.map((r) => `
              <div class="eds-row${r.isToday ? ' today' : ''}">
                <span class="d">${esc(r.label)}</span>
                ${r.isToday ? '<span class="badge">TODAY</span>' : ''}
                <span class="w">${currencyIcon('star', { size: 14 })}wave ${r.wave}</span>
              </div>`).join('')}</div>`}
        </div>
      </div>`

    this.root.querySelector('[data-back]')!.addEventListener('click', () => this.leave())
    this.root.querySelector('[data-play]')!.addEventListener('click', () => {
      playUiTick()
      this.root.classList.add('eds-leave')
      window.setTimeout(() => this.handlers.onPlay(this.seed), appSettings.reducedMotion() ? 0 : 200)
    })
    this.root.querySelector('[data-copy]')!.addEventListener('click', () => this.copyLink())
  }

  private copyLink(): void {
    playUiTick()
    const label = this.root.querySelector('[data-copylabel]')
    let base = 'https://chromancer.io/'
    try {
      if (typeof location !== 'undefined' && /^https?:$/.test(location.protocol)) base = location.origin + location.pathname
    } catch { /* non-browser */ }
    const link = withRef(`${base}?seed=${encodeURIComponent(todaysDaily().code)}`)
    const done = (): void => {
      if (!label) return
      const prev = label.textContent
      label.textContent = 'Copied!'
      window.setTimeout(() => { if (label) label.textContent = prev }, 1500)
    }
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(link).then(done, done)
    else done()
  }

  private leave(): void {
    playUiTick()
    this.root.classList.add('eds-leave')
    window.setTimeout(() => this.handlers.onBack(), appSettings.reducedMotion() ? 0 : 240)
  }

  destroy(): void {
    this.root.remove()
  }
}

// re-export playedToday so callers (menu badge) can query without importing daily.ts
export { playedToday }

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
