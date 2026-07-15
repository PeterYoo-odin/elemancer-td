// WELCOME REWARD — the celebratory CLAIM moment. Advertised up front (landing /
// attract), it LANDS here right after the player feels the fun (demo / first
// win). Bundle: 2000💎 + the exclusive Firstlight starter skin + a free first
// spin. If the player arrived on a friend's ?ref= link, the bundle upgrades with
// the Kindred Dye. Everything granted is soft-currency / cosmetic — the fairness
// badge says so on the card, and Ranked ignores all of it by construction.
//
// Pure DOM overlay (like the attract end card). Never throws; safe on any device.

import { economy, type WelcomeGrant, type SpinPrize, WELCOME_DIAMONDS } from '../game/economy'
import { appSettings } from './settings'
import { iconMarkup, currencyIcon, glyphIcon, hasGlyphIcon, type IconName } from './icons'

let open = false

/** True if the welcome bundle is still unclaimed (drives affordances elsewhere). */
export function welcomeUnclaimed(): boolean {
  return economy.welcomeAvailable()
}

/**
 * Show the welcome-reward flow. Resolves when the player closes it (claimed or
 * skipped). Idempotent-ish: if already claimed, resolves immediately unless
 * `review` is set (lets a returning player re-open a read-only recap — unused
 * for now but keeps the seam clean).
 */
export function showWelcomeReward(onClose?: () => void): void {
  if (open) return
  if (!economy.welcomeAvailable()) { onClose?.(); return }
  open = true
  const reduced = appSettings.reducedMotion()

  const ov = document.createElement('div')
  ov.setAttribute('role', 'dialog')
  ov.setAttribute('aria-label', 'Welcome bundle')
  ov.style.cssText =
    'position:fixed;inset:0;z-index:6200;display:flex;align-items:center;justify-content:center;overflow-y:auto;box-sizing:border-box;' +
    'padding:max(20px,env(safe-area-inset-top)) max(20px,env(safe-area-inset-right)) max(20px,env(safe-area-inset-bottom)) max(20px,env(safe-area-inset-left));' +
    'background:radial-gradient(120% 90% at 50% 0%,rgba(60,30,90,.72),rgba(8,5,18,.92));backdrop-filter:blur(6px);' +
    'font-family:"Baloo 2","Nunito",system-ui,sans-serif;color:#fff;text-align:center;opacity:0;transition:opacity .5s ease;'

  const confetti = document.createElement('canvas')
  confetti.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;'
  ov.appendChild(confetti)

  const panel = document.createElement('div')
  panel.style.cssText =
    'position:relative;width:min(94vw,440px);max-height:calc(100vh - 40px);overflow-y:auto;box-sizing:border-box;padding:26px 22px 22px;border-radius:22px;' +
    'background:linear-gradient(180deg,#1c1136,#130b26);border:1px solid rgba(190,160,255,.4);' +
    'box-shadow:0 20px 60px rgba(0,0,0,.6);display:flex;flex-direction:column;gap:14px;align-items:center;flex:0 0 auto;' +
    'transform:scale(.9);transition:transform .5s cubic-bezier(.2,.9,.25,1);'
  ov.appendChild(panel)

  const referred = economy.arrivedReferred()

  // ---- phase 1: the advertised bundle + CLAIM ----
  const kicker = el('div', 'WELCOME, CHROMANCER', 'font-weight:700;letter-spacing:2px;font-size:12.5px;color:#b9a8e8;')
  const title = el('div', 'Your Welcome Bundle', 'font-weight:900;font-size:26px;line-height:1.05;')
  const sub = el('div',
    referred ? 'A friend sent you — your bundle is upgraded. Claim it, no card, no strings.'
             : 'Free, no card, no strings. Claim it and start painting.',
    'font-size:13.5px;color:#c9bdf0;max-width:340px;')

  const chips = document.createElement('div')
  chips.style.cssText = 'display:flex;flex-direction:column;gap:10px;width:100%;margin-top:4px;'
  // First-impression surface: SVG icons only (the crafted icon set), never raw
  // OS emoji — this modal is the first thing a brand-new player ever sees.
  chips.append(
    rewardChip('diamond', '#8fe9ff', `${WELCOME_DIAMONDS.toLocaleString('en-US')} Diamonds`, 'Premium currency — also earned free by playing.'),
    rewardChip('brush', '#ff8fb0', 'Firstlight Cannon skin', 'Exclusive starter cosmetic. Pure paint — never sold.'),
    rewardChip('dice', '#8fe9ff', 'A free First Spin', 'One spin of the welcome wheel — soft-currency prizes.'),
  )
  if (referred) {
    chips.append(rewardChip('sprout', '#8dff4a', 'Kindred Dye (referred bonus)', 'Exclusive to players who arrived on a friend’s invite.'))
  }

  const badge = el('div', '', 'font-size:11.5px;color:#8fe6c0;margin-top:2px;display:flex;align-items:center;gap:6px;justify-content:center;')
  badge.innerHTML = `${iconMarkup('shield', { size: 14, color: '#8fe6c0' })}<span>Nothing you claim here ever works in Ranked.</span>`

  const claimBtn = document.createElement('button')
  claimBtn.innerHTML = `${iconMarkup('sparkle', { size: 18, color: '#6b4404' })}  CLAIM MY BUNDLE`
  claimBtn.style.cssText =
    'margin-top:6px;padding:15px 30px;border-radius:16px;border:1px solid rgba(255,255,255,.3);cursor:pointer;color:#0a0716;' +
    'font:900 19px "Baloo 2","Nunito",system-ui,sans-serif;letter-spacing:.5px;width:100%;' +
    'background:linear-gradient(180deg,#ffe07a,#ffb43c);box-shadow:0 10px 30px rgba(255,180,60,.4);'

  panel.append(kicker, title, sub, chips, badge, claimBtn)
  document.body.appendChild(ov)
  requestAnimationFrame(() => { ov.style.opacity = '1'; panel.style.transform = 'scale(1)' })

  const stopConfetti = reduced ? () => {} : startConfetti(confetti)

  const finish = () => {
    stopConfetti()
    ov.style.opacity = '0'
    window.setTimeout(() => { ov.remove(); open = false; onClose?.() }, 480)
  }

  claimBtn.onclick = () => {
    const grant = economy.claimWelcome()
    if (!grant) { finish(); return } // already claimed elsewhere — bail cleanly
    burst(confetti, reduced)
    renderSpin(panel, grant, finish, reduced)
  }
}

// ---- phase 2: the first-spin wheel ----
function renderSpin(panel: HTMLDivElement, grant: WelcomeGrant, finish: () => void, reduced: boolean): void {
  panel.replaceChildren()
  const claimed = el('div', '', 'font-size:13px;color:#e8ddff;')
  claimed.innerHTML =
    `+${grant.diamonds.toLocaleString('en-US')} ${currencyIcon('diamond', { size: 13 })}  &middot;  Firstlight skin equipped${grant.referred ? '  &middot;  Kindred Dye' : ''}`
  panel.append(
    el('div', 'BUNDLE CLAIMED', 'font-weight:700;letter-spacing:2px;font-size:12.5px;color:#8fe6c0;'),
    claimed,
    el('div', 'One free spin →', 'font-weight:900;font-size:23px;margin-top:2px;'),
  )

  const reel = document.createElement('div')
  reel.style.cssText =
    'width:100%;padding:20px 12px;border-radius:16px;margin-top:4px;overflow:hidden;position:relative;' +
    'background:rgba(255,255,255,.05);border:1px solid rgba(190,160,255,.3);'
  const face = document.createElement('div')
  face.style.cssText = 'font-weight:900;font-size:26px;color:#ffe9a8;display:flex;align-items:center;gap:9px;justify-content:center;'
  setFace(face, 'dice', '?')
  reel.appendChild(face)
  panel.appendChild(reel)

  const spinBtn = document.createElement('button')
  spinBtn.innerHTML = `${iconMarkup('dice', { size: 17, color: '#0a3b55' })}  SPIN`
  spinBtn.style.cssText =
    'margin-top:8px;padding:14px 28px;border-radius:16px;border:1px solid rgba(255,255,255,.3);cursor:pointer;color:#0a0716;' +
    'font:900 18px "Baloo 2","Nunito",system-ui,sans-serif;width:100%;' +
    'background:linear-gradient(180deg,#b8f0ff,#5cc7ff);box-shadow:0 10px 30px rgba(90,199,255,.35);'
  panel.appendChild(spinBtn)

  const prizes = economy.firstSpinPrizes()

  const doneBtn = document.createElement('button')
  doneBtn.textContent = 'CONTINUE  →'
  doneBtn.style.cssText =
    'margin-top:4px;padding:12px 26px;border-radius:14px;border:1px solid rgba(255,255,255,.22);cursor:pointer;color:#e8ddff;' +
    'font:800 15px "Baloo 2","Nunito",system-ui,sans-serif;width:100%;background:rgba(255,255,255,.08);display:none;'
  doneBtn.onclick = finish
  panel.appendChild(doneBtn)

  spinBtn.onclick = () => {
    spinBtn.disabled = true
    spinBtn.style.opacity = '.5'
    const prize = economy.firstSpin()
    if (!prize) { land(face, null, prizes); doneBtn.style.display = 'block'; return }
    if (reduced) { land(face, prize, prizes); afterSpin(face, prize, doneBtn); return }
    // quick cycling reveal, decelerating onto the granted prize
    let i = 0
    let delay = 60
    const tick = () => {
      setFace(face, 'dice', prizes[i % prizes.length].label)
      i++
      delay *= 1.12
      if (delay < 320 && i < 26) { window.setTimeout(tick, delay) }
      else { land(face, prize, prizes); afterSpin(face, prize, doneBtn) }
    }
    tick()
  }
}

function afterSpin(face: HTMLDivElement, prize: SpinPrize, doneBtn: HTMLButtonElement): void {
  face.style.transition = 'transform .3s ease'
  face.style.transform = 'scale(1.18)'
  window.setTimeout(() => { face.style.transform = 'scale(1)' }, 300)
  doneBtn.style.display = 'block'
}

function land(face: HTMLDivElement, prize: SpinPrize | null, prizes: SpinPrize[]): void {
  setFace(face, 'sparkle', prize?.label ?? prizes[0].label)
  face.style.color = '#ffe9a8'
}

/** Wheel face = crafted SVG glyph + a text label. Prize labels come from the
 *  economy data table and may carry glyph characters (e.g. "5 ✦") — those are
 *  routed through the emoji→icon bridge so no raw glyph ever reaches the
 *  screen. Plain text renders via textContent (never interpreted as HTML). */
function setFace(face: HTMLDivElement, icon: IconName, label: string): void {
  face.innerHTML = iconMarkup(icon, { size: 24, color: '#ffe9a8' })
  let buf = ''
  const flush = () => {
    if (!buf) return
    const s = document.createElement('span')
    s.textContent = buf
    face.appendChild(s)
    buf = ''
  }
  for (const ch of label) {
    if (hasGlyphIcon(ch)) {
      flush()
      const s = document.createElement('span')
      s.style.lineHeight = '0'
      s.innerHTML = glyphIcon(ch, { size: 20 })
      face.appendChild(s)
    } else buf += ch
  }
  flush()
}

// ---- helpers ----
function el(tag: string, text: string, css: string): HTMLElement {
  const e = document.createElement(tag)
  e.textContent = text
  e.style.cssText = css
  return e
}

function rewardChip(icon: IconName, tint: string, name: string, desc: string): HTMLElement {
  const row = document.createElement('div')
  row.style.cssText =
    'display:flex;gap:12px;align-items:center;text-align:left;padding:10px 12px;border-radius:14px;' +
    'background:rgba(255,255,255,.05);border:1px solid rgba(190,160,255,.22);'
  const g = document.createElement('div')
  g.innerHTML = iconMarkup(icon, { size: 26, color: tint })
  g.style.cssText = 'flex:0 0 auto;width:34px;text-align:center;line-height:0;'
  const t = document.createElement('div')
  t.style.cssText = 'min-width:0;'
  const n = el('div', name, 'font-weight:800;font-size:15px;')
  const d = el('div', desc, 'font-size:11.5px;color:#b9a8e8;margin-top:1px;line-height:1.25;')
  t.append(n, d)
  row.append(g, t)
  return row
}

// lightweight paint-dab confetti on a canvas; returns a stop fn
function startConfetti(cv: HTMLCanvasElement): () => void {
  const ctx = cv.getContext('2d')
  if (!ctx) return () => {}
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const resize = () => { cv.width = cv.clientWidth * dpr; cv.height = cv.clientHeight * dpr }
  resize()
  const colors = ['#ff7a4c', '#ffd54a', '#6dff8a', '#5cc7ff', '#c06bff', '#ff8fb0']
  interface P { x: number; y: number; vx: number; vy: number; r: number; c: string; life: number }
  const parts: P[] = []
  let raf = 0
  let running = true
  const spawn = (n: number, burstY: number) => {
    for (let i = 0; i < n; i++) {
      parts.push({
        x: cv.width * (0.3 + Math.random() * 0.4), y: burstY,
        vx: (Math.random() - 0.5) * 9 * dpr, vy: (Math.random() * -6 - 3) * dpr,
        r: (3 + Math.random() * 5) * dpr, c: colors[(Math.random() * colors.length) | 0],
        life: 1,
      })
    }
  }
  spawn(50, cv.height * 0.32)
  const frame = () => {
    if (!running) return
    ctx.clearRect(0, 0, cv.width, cv.height)
    for (const p of parts) {
      p.vy += 0.22 * dpr
      p.x += p.vx; p.y += p.vy; p.life -= 0.006
      ctx.globalAlpha = Math.max(0, p.life)
      ctx.fillStyle = p.c
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill()
    }
    ctx.globalAlpha = 1
    for (let i = parts.length - 1; i >= 0; i--) if (parts[i].life <= 0 || parts[i].y > cv.height + 20) parts.splice(i, 1)
    raf = requestAnimationFrame(frame)
  }
  raf = requestAnimationFrame(frame)
  ;(cv as unknown as { __burst?: (n: number) => void }).__burst = (n: number) => spawn(n, cv.height * 0.4)
  return () => { running = false; cancelAnimationFrame(raf) }
}

function burst(cv: HTMLCanvasElement, reduced: boolean): void {
  if (reduced) return
  const b = (cv as unknown as { __burst?: (n: number) => void }).__burst
  if (b) b(70)
}
