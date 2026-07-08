// REFERRAL PANEL — the invite-a-friend viral surface. Shows the player's stable
// referral code + link, one-tap share, and the cosmetic-only reward ladder.
// Both sides win (constitution-safe): the friend's welcome bundle upgrades, and
// the referrer earns cosmetics as confirmed friends play. The referrer ladder is
// BACKEND-gated (a client can't prove a friend played), so offline it shows the
// loop honestly without fabricating unearned rewards.
//
// Pure DOM overlay. Reuses copyText from ShareCard for the clipboard fallback.

import { economy } from '../game/economy'
import { myReferralCode, referralLink, reportReferralEvent } from '../game/referral'
import { copyText } from './ShareCard'

let open = false

export function showReferralPanel(onClose?: () => void): void {
  if (open) return
  open = true
  const code = myReferralCode()
  const link = referralLink(code)

  const ov = document.createElement('div')
  ov.setAttribute('role', 'dialog')
  ov.setAttribute('aria-label', 'Invite friends')
  ov.style.cssText =
    'position:fixed;inset:0;z-index:6100;display:flex;align-items:center;justify-content:center;overflow-y:auto;box-sizing:border-box;' +
    'padding:max(18px,env(safe-area-inset-top)) max(18px,env(safe-area-inset-right)) max(18px,env(safe-area-inset-bottom)) max(18px,env(safe-area-inset-left));' +
    'background:rgba(8,5,18,.82);backdrop-filter:blur(5px);opacity:0;transition:opacity .4s ease;' +
    'font-family:"Baloo 2","Nunito",system-ui,sans-serif;color:#fff;'

  const panel = document.createElement('div')
  panel.style.cssText =
    'position:relative;width:min(94vw,440px);max-height:90vh;overflow:auto;box-sizing:border-box;padding:22px 20px;border-radius:20px;' +
    'background:linear-gradient(180deg,#1b1134,#120a24);border:1px solid rgba(190,160,255,.4);box-shadow:0 18px 54px rgba(0,0,0,.6);' +
    'display:flex;flex-direction:column;gap:12px;text-align:center;'
  ov.appendChild(panel)

  const close = document.createElement('button')
  close.textContent = '✕'
  close.setAttribute('aria-label', 'Close')
  close.style.cssText = 'position:absolute;top:8px;right:12px;background:none;border:none;color:#7a6fa8;font-size:18px;cursor:pointer;padding:4px;'
  close.onclick = () => {
    ov.style.opacity = '0'
    window.setTimeout(() => { ov.remove(); open = false; onClose?.() }, 400)
  }
  panel.appendChild(close)

  panel.append(
    text('div', 'INVITE FRIENDS', 'font-weight:700;letter-spacing:2px;font-size:12px;color:#b9a8e8;'),
    text('div', 'You both win', 'font-weight:900;font-size:25px;line-height:1;'),
    text('div', 'Send your link. When a friend plays, their welcome bundle upgrades — and you climb the referral ladder. All cosmetic. Ranked ignores it.',
      'font-size:13px;color:#c9bdf0;max-width:360px;margin:0 auto;line-height:1.35;'),
  )

  // code pill
  const codeRow = document.createElement('div')
  codeRow.style.cssText = 'display:flex;gap:8px;align-items:stretch;margin-top:4px;'
  const codeBox = document.createElement('div')
  codeBox.textContent = code
  codeBox.style.cssText =
    'flex:1;padding:12px;border-radius:12px;background:rgba(255,255,255,.06);border:1px solid rgba(255,233,168,.5);' +
    'font:800 20px ui-monospace,Menlo,monospace;color:#ffe9a8;letter-spacing:1px;display:flex;align-items:center;justify-content:center;'
  const copyBtn = button('Copy link', 'linear-gradient(180deg,#ffe07a,#ffb43c)', '#0a0716')
  copyBtn.style.flex = '0 0 auto'
  copyBtn.onclick = async () => {
    const ok = await copyText(link)
    copyBtn.textContent = ok ? '✓ Copied' : 'Copy failed'
    reportReferralEvent('invite', { via: 'copy' })
    window.setTimeout(() => { copyBtn.textContent = 'Copy link' }, 1600)
  }
  codeRow.append(codeBox, copyBtn)
  panel.appendChild(codeRow)

  // share (native)
  const shareBtn = button('📣  Share invite', 'linear-gradient(180deg,#b8f0ff,#5cc7ff)', '#062033')
  shareBtn.onclick = async () => {
    const shareData = {
      title: 'CHROMANCER',
      text: 'Come paint the world back with me — grab your welcome bundle (2000💎 + a starter skin). Provably-fair TD, instant web play:',
      url: link,
    }
    reportReferralEvent('invite', { via: 'share' })
    try {
      const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> }
      if (typeof nav.share === 'function') { await nav.share(shareData); return }
    } catch { /* cancelled/unsupported */ }
    const ok = await copyText(link)
    shareBtn.textContent = ok ? '✓ Link copied — paste it anywhere' : 'Copy failed'
    window.setTimeout(() => { shareBtn.textContent = '📣  Share invite' }, 1800)
  }
  panel.appendChild(shareBtn)

  // ladder
  const friends = economy.referralFriends
  panel.append(text('div', `Referral ladder — ${friends} friend${friends === 1 ? '' : 's'} so far`,
    'font-weight:800;font-size:14px;margin-top:8px;color:#e8ddff;'))
  const ladder = document.createElement('div')
  ladder.style.cssText = 'display:flex;flex-direction:column;gap:7px;'
  for (const { rung, unlocked, claimed } of economy.referralLadderState()) {
    const row = document.createElement('div')
    row.style.cssText =
      'display:flex;gap:10px;align-items:center;text-align:left;padding:9px 11px;border-radius:12px;' +
      `background:rgba(255,255,255,${unlocked ? '.08' : '.03'});border:1px solid rgba(190,160,255,${unlocked ? '.35' : '.15'});`
    const badge = document.createElement('div')
    badge.textContent = claimed ? '✓' : unlocked ? '★' : String(rung.friends)
    badge.style.cssText =
      `flex:0 0 auto;width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:900;` +
      `background:${unlocked ? 'linear-gradient(180deg,#ffe07a,#ffb43c)' : 'rgba(255,255,255,.08)'};color:${unlocked ? '#0a0716' : '#8f7fc0'};`
    const label = document.createElement('div')
    label.style.cssText = 'flex:1;min-width:0;'
    label.append(
      text('div', `${rung.friends} friend${rung.friends === 1 ? '' : 's'}`, 'font-weight:800;font-size:13px;'),
      text('div', rung.label, 'font-size:11.5px;color:#b9a8e8;'),
    )
    row.append(badge, label)
    if (unlocked && !claimed) {
      const claimBtn = button('Claim', 'linear-gradient(180deg,#6dff8a,#2fbf6a)', '#06301a')
      claimBtn.style.cssText += 'padding:7px 14px;font-size:12px;flex:0 0 auto;'
      claimBtn.onclick = () => {
        if (economy.claimReferralRung(economy.referralLadderState().findIndex((r) => r.rung === rung))) {
          claimBtn.remove()
          badge.textContent = '✓'
        }
      }
      row.appendChild(claimBtn)
    }
    ladder.appendChild(row)
  }
  panel.appendChild(ladder)

  panel.append(text('div', 'Ladder rewards credit once accounts are live — a friend’s play is confirmed server-side, so nobody games the ladder.',
    'font-size:10.5px;color:#7a6fa8;margin-top:2px;line-height:1.3;'))

  document.body.appendChild(ov)
  requestAnimationFrame(() => { ov.style.opacity = '1' })
}

function text(tag: string, s: string, css: string): HTMLElement {
  const e = document.createElement(tag)
  e.textContent = s
  e.style.cssText = css
  return e
}
function button(label: string, bg: string, color: string): HTMLButtonElement {
  const b = document.createElement('button')
  b.textContent = label
  b.style.cssText =
    `padding:12px 18px;border-radius:12px;border:1px solid rgba(255,255,255,.25);cursor:pointer;color:${color};` +
    `font:800 14px "Baloo 2","Nunito",system-ui,sans-serif;background:${bg};`
  return b
}
