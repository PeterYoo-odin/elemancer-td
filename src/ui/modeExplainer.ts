// MODE EXPLAINERS — a single teach-card the FIRST time a player opens each
// competitive mode. The modes are the deepest thing the menu offers and their
// names (Daily Seed? Pathforge? provably fair?) assume context a new player
// doesn't have yet. One card, once, in the game's own voice; dismiss anywhere.
//
// Persistence rides the existing FTUE store (ftue.isDone / markDone with
// 'mode-<id>' keys) — extends the instrumentation spine, never alters it.

import { ftue } from '../game/onboarding'
import { playUiTick } from './sfx'
import { iconMarkup, type IconName } from './icons'

export type ExplainedMode = 'endless' | 'roguelike' | 'ranked' | 'daily' | 'pathforge'

const CARDS: Record<ExplainedMode, { icon: IconName; accent: string; title: string; lines: string[]; foot: string }> = {
  endless: {
    icon: 'hourglass', accent: '#ff7a4a', title: 'ENDLESS',
    lines: [
      'The waves never stop — they only grow. Hold the line as long as skill allows.',
      'This board is RANKED: every hero pinned to the same level, every boost switched off. Nothing you can buy helps here.',
    ],
    foot: 'Your best run records a replayable seed — the servers re-run it to verify.',
  },
  roguelike: {
    icon: 'dice', accent: '#c06bff', title: 'ROGUELIKE',
    lines: [
      'Draft relics between waves. Stack powers. Take a curse when its upside is worth the sting.',
      'A weekly mutator reshapes the rules — and none of it ever leaks into your ranked runs.',
    ],
    foot: 'Every draft is seeded: the same choices on the same seed replay identically.',
  },
  ranked: {
    icon: 'shield', accent: '#8dff4a', title: 'PROVABLY FAIR',
    lines: [
      'A leaderboard money can’t climb: heroes pinned to one level, boosts void, cosmetics cosmetic.',
      'Every submitted run is re-run on the server, tick for tick. A score that can’t replay doesn’t board.',
    ],
    foot: 'Daily and weekly seeds are shared by everyone — same map, same waves, pure skill.',
  },
  daily: {
    icon: 'star', accent: '#ffd54a', title: 'DAILY SEED',
    lines: [
      'One shared run per day. Everyone on Earth gets this exact seed — same paths, same waves.',
      'Beat your best, then see where you land. Tomorrow, a new seed levels it all again.',
    ],
    foot: 'Share your seed code — a friend can replay your exact run and try to beat it.',
  },
  pathforge: {
    icon: 'link', accent: '#6bd7ff', title: 'PATHFORGE',
    lines: [
      'Here YOU build the road. Paint the enemies’ path across an open field — then defend it.',
      'A longer road buys time; a tighter maze feeds your kill-zones. The maze is your answer.',
    ],
    foot: 'Same seed for everyone. The board rewards the smartest road, not the biggest wallet.',
  },
}

/** Show the mode's first-run card (once ever), then continue. Already seen →
 *  continues immediately. Dismiss = tap anywhere / GOT IT. */
export function withModeExplainer(mode: ExplainedMode, proceed: () => void): void {
  const key = `mode-${mode}`
  if (ftue.isDone(key)) { proceed(); return }
  const card = CARDS[mode]

  const ov = document.createElement('div')
  ov.setAttribute('role', 'dialog')
  ov.setAttribute('aria-label', `${card.title} — how this mode works`)
  ov.style.cssText =
    'position:fixed;inset:0;z-index:6300;display:flex;align-items:center;justify-content:center;box-sizing:border-box;' +
    'padding:max(20px,env(safe-area-inset-top)) 20px max(20px,env(safe-area-inset-bottom));' +
    'background:rgba(6,4,14,.78);backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px);' +
    'font-family:"Baloo 2","Nunito",system-ui,sans-serif;color:#efe9ff;opacity:0;transition:opacity .25s ease;'

  const panel = document.createElement('div')
  panel.style.cssText =
    'width:min(92vw,400px);box-sizing:border-box;padding:22px 20px 18px;border-radius:20px;text-align:center;' +
    `background:linear-gradient(180deg,#1d1338,#130b26);border:1px solid color-mix(in srgb, ${card.accent} 45%, transparent);` +
    'box-shadow:0 20px 60px rgba(0,0,0,.55);display:flex;flex-direction:column;gap:12px;align-items:center;'
  panel.innerHTML =
    `<div style="width:52px;height:52px;border-radius:14px;display:flex;align-items:center;justify-content:center;` +
    `color:${card.accent};background:color-mix(in srgb, ${card.accent} 14%, transparent);border:1px solid color-mix(in srgb, ${card.accent} 40%, transparent);">` +
    `${iconMarkup(card.icon, { size: 28 })}</div>` +
    `<div style="font-weight:900;font-size:21px;letter-spacing:.14em;color:${card.accent};">${card.title}</div>` +
    card.lines.map((l) => `<div style="font-size:13.5px;line-height:1.5;color:#d8cef2;">${l}</div>`).join('') +
    `<div style="font-size:11.5px;line-height:1.5;color:#9d92c4;border-top:1px solid rgba(255,255,255,.08);padding-top:10px;">${card.foot}</div>` +
    `<button data-go style="margin-top:2px;padding:12px 30px;border-radius:14px;border:0;cursor:pointer;width:100%;` +
    `font:900 16px 'Baloo 2','Nunito',system-ui,sans-serif;letter-spacing:.08em;color:#0a0716;` +
    `background:linear-gradient(180deg,#ffe07a,#ffb43c);box-shadow:0 8px 24px rgba(255,180,60,.35);">GOT IT</button>`
  ov.appendChild(panel)
  document.body.appendChild(ov)
  requestAnimationFrame(() => { ov.style.opacity = '1' })

  const done = (): void => {
    ftue.markDone(key)
    playUiTick()
    ov.style.opacity = '0'
    window.setTimeout(() => { ov.remove(); proceed() }, 220)
  }
  ov.addEventListener('click', done) // tap anywhere = got it
}
