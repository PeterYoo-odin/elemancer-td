// SIGN-IN MODAL — the one place a player SAVES their account so it becomes
// portable across devices and recoverable. Passwordless by design: a MAGIC LINK
// (email) plus "Continue with Google / Apple". No password field, ever.
//
// GUEST PLAY STAYS THE DEFAULT. This modal is never a wall — it is opened from
// Settings, offered (dismissibly) after the first win, and offered before a
// purchase. When the auth backend is unwired it simply never appears, and when
// the player is already signed in it shows their account + a sign-out.
//
// Pure DOM overlay in the house style. Never throws; safe on any device.

import {
  authConfigured, isSignedIn, currentUser, userEmail,
  signInWithMagicLink, signInWithOAuth, signOut, onAuthChange,
  getCachedProviderFlags, fetchProviderFlags,
} from '../game/authNet'
import { HIDDEN, type ProviderFlags } from '../game/authProviders'
import { localHandle } from '../game/rankedNet'
import { playUiTick } from './sfx'
import { appSettings } from './settings'

const NUDGE_KEY = 'chromancer_signin_nudge_v1' // first-win offer shown once, ever
let guardDismissedThisSession = false // purchase guard: one "not now" per session

export interface SignInOpts {
  title?: string
  subtitle?: string
  /** Optional CTA shown as a secondary "continue without saving" action (used by
   *  the purchase guard so sign-in is offered, never forced). */
  proceedLabel?: string
  onProceed?: () => void
  onClose?: () => void
}

let cssInjected = false
let open = false

/** True when there is an auth backend AND the player is a guest (i.e. a sign-in
 *  offer is meaningful). Callers gate their prompts on this. */
export function canOfferSignIn(): boolean {
  return authConfigured() && !isSignedIn()
}

/** Short label for the Settings "Account" row. */
export function accountStatusLabel(): string {
  if (!authConfigured()) return 'Guest (offline)'
  if (isSignedIn()) return userEmail() || localHandle() || 'Signed in'
  return 'Guest — not saved'
}

export function openSignIn(opts: SignInOpts = {}): void {
  if (!authConfigured() || open) { opts.onProceed?.(); return }
  open = true
  injectCss()

  const ov = document.createElement('div')
  ov.className = 'sgn-overlay'
  ov.setAttribute('role', 'dialog')
  ov.setAttribute('aria-label', 'Sign in')

  const card = document.createElement('div')
  card.className = 'sgn-card'
  ov.appendChild(card)
  document.body.appendChild(ov)

  let offAuth = () => {}
  const close = (proceeded: boolean) => {
    if (!open) return
    open = false
    offAuth()
    ov.classList.add('hide')
    window.setTimeout(() => ov.remove(), appSettings.reducedMotion() ? 0 : 180)
    if (proceeded) opts.onProceed?.()
    opts.onClose?.()
  }

  const render = () => {
    if (isSignedIn()) renderSignedIn(card, close)
    else renderSignIn(card, opts, close)
  }
  // re-render live when auth state flips (e.g. a magic-link finishes in another
  // tab, or an inline sign-out completes)
  offAuth = onAuthChange(render)
  render()

  ov.addEventListener('click', (e) => { if (e.target === ov) close(false) })
}

/** The OAuth buttons + divider, or '' when neither provider is enabled (fail-safe
 *  default — see authProviders.ts). Magic-link below is never gated by this. */
function oauthSectionHtml(flags: ProviderFlags): string {
  const buttons = [
    flags.google ? `<button class="sgn-btn sgn-google" data-oauth="google">${GOOGLE_G}<span>Continue with Google</span></button>` : '',
    flags.apple ? `<button class="sgn-btn sgn-apple" data-oauth="apple">${APPLE_A}<span>Continue with Apple</span></button>` : '',
  ].join('')
  if (!buttons) return ''
  return `<div class="sgn-oauth">${buttons}</div><div class="sgn-or"><span>or email me a link</span></div>`
}

function renderSignIn(card: HTMLElement, opts: SignInOpts, close: (p: boolean) => void): void {
  const title = opts.title || 'Save your account'
  const subtitle = opts.subtitle || 'Keep your progress, handle and purchases safe — and play on any device. Free, passwordless, no card.'
  const flags = getCachedProviderFlags()
  card.innerHTML = `
    <div class="sgn-title">${esc(title)}</div>
    <div class="sgn-sub">${esc(subtitle)}</div>
    <div data-oauth-section>${oauthSectionHtml(flags || HIDDEN)}</div>
    <form class="sgn-mail" data-mailform>
      <input class="sgn-input" type="email" inputmode="email" autocomplete="email" placeholder="you@email.com" aria-label="Email address" data-email />
      <button class="sgn-btn sgn-primary" type="submit" data-magic>Email me a sign-in link</button>
    </form>
    <div class="sgn-msg" data-msg></div>
    <div class="sgn-badge">🔒 We never post, never spam, and store no personal data beyond sign-in. Ranked stays untouched.</div>
    <div class="sgn-foot">
      ${opts.onProceed ? `<button class="sgn-link" data-proceed>${esc(opts.proceedLabel || 'Not now')}</button>` : ''}
      <button class="sgn-link" data-close>${opts.onProceed ? 'Cancel' : 'Maybe later'}</button>
    </div>`

  const msg = card.querySelector<HTMLElement>('[data-msg]')!
  const setMsg = (t: string, kind: 'ok' | 'err' | '' = '') => { msg.textContent = t; msg.className = 'sgn-msg' + (kind ? ' ' + kind : '') }

  const wireOauthButtons = () => {
    for (const b of card.querySelectorAll<HTMLElement>('[data-oauth]')) {
      b.addEventListener('click', () => {
        playUiTick()
        setMsg('Redirecting…')
        signInWithOAuth(b.dataset.oauth as 'google' | 'apple')
      })
    }
  }
  wireOauthButtons()

  // Never block/delay the modal on the settings check — magic-link is already
  // live above. If it resolves while this card is still the sign-in view,
  // patch ONLY the oauth section in place (never wipe an in-progress email).
  if (!flags) {
    fetchProviderFlags().then((f) => {
      if (!open || isSignedIn()) return
      const section = card.querySelector<HTMLElement>('[data-oauth-section]')
      if (!section) return
      section.innerHTML = oauthSectionHtml(f)
      wireOauthButtons()
    })
  }

  const form = card.querySelector<HTMLFormElement>('[data-mailform]')!
  const input = card.querySelector<HTMLInputElement>('[data-email]')!
  const magicBtn = card.querySelector<HTMLButtonElement>('[data-magic]')!
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    playUiTick()
    const email = input.value.trim()
    if (!email) { setMsg('Enter your email first.', 'err'); input.focus(); return }
    magicBtn.disabled = true
    magicBtn.textContent = 'Sending…'
    const r = await signInWithMagicLink(email)
    if (r.ok) {
      form.style.display = 'none'
      setMsg(`Check ${email} for a sign-in link — open it on this device to finish. You can keep playing meanwhile.`, 'ok')
    } else {
      magicBtn.disabled = false
      magicBtn.textContent = 'Email me a sign-in link'
      setMsg(r.error === 'email' ? "That email doesn't look right." : 'Could not send the link — check your connection and try again.', 'err')
    }
  })

  card.querySelector('[data-proceed]')?.addEventListener('click', () => { playUiTick(); close(true) })
  card.querySelector('[data-close]')?.addEventListener('click', () => { playUiTick(); close(false) })
}

function renderSignedIn(card: HTMLElement, close: (p: boolean) => void): void {
  const who = userEmail() || localHandle() || 'your account'
  card.innerHTML = `
    <div class="sgn-title">You're signed in</div>
    <div class="sgn-sub">Your progress is saved to <b>${esc(who)}</b> and follows you to any device you sign in on.</div>
    <div class="sgn-account">${currentUser()?.email ? '📧 ' + esc(currentUser()!.email!) : '🔗 Linked account'}</div>
    <div class="sgn-badge">🔒 Signing out won't wipe your account — you'll continue as a new guest on this device, and signing back in restores everything.</div>
    <div class="sgn-foot col">
      <button class="sgn-btn sgn-ghost" data-signout>Sign out</button>
      <button class="sgn-btn sgn-primary" data-close>Done</button>
    </div>`
  card.querySelector('[data-signout]')?.addEventListener('click', async () => {
    playUiTick()
    await signOut()
    // onAuthChange re-renders to the signed-out view automatically
  })
  card.querySelector('[data-close]')?.addEventListener('click', () => { playUiTick(); close(false) })
}

// ---------------------------------------------------------------------------
//  High-intent prompts
// ---------------------------------------------------------------------------

/** Offer to save the account right after the FIRST WIN — once, ever, and only
 *  for a configured guest. Never a wall. */
export function promptSaveAfterFirstWin(): void {
  if (!canOfferSignIn()) return
  try { if (localStorage.getItem(NUDGE_KEY) === '1') return } catch { /* private mode */ }
  try { localStorage.setItem(NUDGE_KEY, '1') } catch { /* ignore */ }
  openSignIn({
    title: 'Nice — save this win',
    subtitle: 'Lock in your progress and rewards so you never lose them. Sign in free (no password) and play on any device.',
  })
}

/** Guard a purchase: if a configured guest, offer one-tap sign-in first so the
 *  purchase is tied to a recoverable account — but always let them proceed. When
 *  signed in (or unwired), runs `proceed` immediately. */
export function guardPurchaseWithSignIn(proceed: () => void): void {
  if (!canOfferSignIn() || guardDismissedThisSession) { proceed(); return }
  openSignIn({
    title: 'Save your purchases first?',
    subtitle: 'Sign in (free, no password) so anything you buy is tied to a recoverable account and follows you across devices.',
    proceedLabel: 'Continue as guest',
    onProceed: () => { guardDismissedThisSession = true; proceed() },
  })
}

// ---------------------------------------------------------------------------
//  Styling + assets
// ---------------------------------------------------------------------------

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] || c))
}

const GOOGLE_G = `<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"/></svg>`
const APPLE_A = `<svg width="16" height="18" viewBox="0 0 16 18" aria-hidden="true" fill="#fff"><path d="M13.3 9.6c0-2 1.64-2.96 1.72-3-.94-1.37-2.4-1.56-2.92-1.58-1.24-.13-2.42.73-3.05.73-.63 0-1.6-.71-2.63-.7-1.35.02-2.6.79-3.3 2-1.4 2.44-.36 6.05 1 8.03.67.97 1.46 2.06 2.5 2.02 1-.04 1.38-.65 2.6-.65 1.2 0 1.55.65 2.6.63 1.08-.02 1.76-.99 2.42-1.96.76-1.12 1.07-2.2 1.09-2.26-.02-.01-2.09-.8-2.11-3.18zM11.3 3.3c.55-.67.92-1.6.82-2.53-.79.03-1.75.53-2.32 1.2-.51.58-.96 1.53-.84 2.43.88.07 1.79-.44 2.34-1.1z"/></svg>`

function injectCss(): void {
  if (cssInjected) return
  cssInjected = true
  const style = document.createElement('style')
  style.id = 'signin-css'
  style.textContent = CSS
  document.head.appendChild(style)
}

const CSS = `
.sgn-overlay { position: fixed; inset: 0; z-index: 6300; display: flex; align-items: center; justify-content: center;
  background: rgba(6,4,16,.74); backdrop-filter: blur(5px); opacity: 1; transition: opacity .18s ease; overflow-y: auto;
  padding: max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
.sgn-overlay.hide { opacity: 0; }
.sgn-card { width: min(400px, 96vw); margin: auto; box-sizing: border-box; padding: 22px 20px 16px; border-radius: 20px;
  background: linear-gradient(180deg, #241a44, #17102f); border: 1px solid rgba(255,255,255,.15);
  box-shadow: 0 24px 60px rgba(0,0,0,.6); color: #fff; display: flex; flex-direction: column; gap: 11px; }
.sgn-title { font-weight: 900; font-size: 20px; letter-spacing: .01em; }
.sgn-sub { font-size: 13px; color: #cabff0; line-height: 1.5; }
.sgn-sub b { color: #fff; }
.sgn-oauth { display: flex; flex-direction: column; gap: 8px; margin-top: 2px; }
.sgn-btn { display: flex; align-items: center; justify-content: center; gap: 9px; padding: 12px 14px; border-radius: 12px;
  font: inherit; font-size: 14px; font-weight: 800; cursor: pointer; border: 1px solid rgba(255,255,255,.16); width: 100%; }
.sgn-google { background: #fff; color: #1f1f1f; border-color: #fff; }
.sgn-apple { background: #000; color: #fff; border-color: rgba(255,255,255,.3); }
.sgn-primary { background: linear-gradient(180deg, #c98bff, #a15cf0); color: #fff; border-color: #cd9bff; }
.sgn-ghost { background: rgba(255,255,255,.07); color: #fff; }
.sgn-or { display: flex; align-items: center; gap: 10px; color: #9d90c6; font-size: 11.5px; letter-spacing: .04em; margin: 2px 0; }
.sgn-or::before, .sgn-or::after { content: ''; flex: 1; height: 1px; background: rgba(255,255,255,.14); }
.sgn-mail { display: flex; flex-direction: column; gap: 8px; }
.sgn-input { padding: 12px 14px; border-radius: 12px; border: 1px solid rgba(255,255,255,.2); background: rgba(255,255,255,.06);
  color: #fff; font: inherit; font-size: 15px; }
.sgn-input::placeholder { color: #9184b6; }
.sgn-input:focus { outline: none; border-color: #b06bff; background: rgba(255,255,255,.1); }
.sgn-msg { font-size: 12.5px; color: #cabff0; line-height: 1.45; min-height: 2px; }
.sgn-msg.ok { color: #8fe6b8; }
.sgn-msg.err { color: #ff9db0; }
.sgn-badge { font-size: 11px; color: #9d90c6; line-height: 1.45; }
.sgn-account { font-size: 13.5px; font-weight: 700; color: #e8ddff; padding: 10px 12px; border-radius: 12px;
  background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.12); }
.sgn-foot { display: flex; align-items: center; justify-content: center; gap: 16px; margin-top: 4px; }
.sgn-foot.col { flex-direction: column; gap: 8px; }
.sgn-link { background: none; border: none; color: #b9a8e8; font: inherit; font-size: 12.5px; font-weight: 700; cursor: pointer; padding: 6px; text-decoration: underline; }
@media (prefers-reduced-motion: reduce) { .sgn-overlay { transition: none; } }
`
