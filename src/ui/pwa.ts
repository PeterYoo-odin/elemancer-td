// PWA / "download feel" — service-worker registration + a tasteful, custom-timed
// "Add to Home Screen" card. Pure DOM (no Phaser), so both the game and the
// marketing landing import it. Everything degrades gracefully: no SW support,
// no install event, private mode — all just no-op and the game plays on.

let deferredPrompt: BeforeInstallPromptEvent | null = null
let installedThisSession = false

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISS_KEY = 'chromancer_pwa_dismissed_v1'

// Chrome/Edge/Android fire this when the app is installable — stash it so our
// own card can trigger the native prompt at a moment WE choose (post-reward).
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferredPrompt = e as BeforeInstallPromptEvent
  })
  window.addEventListener('appinstalled', () => {
    installedThisSession = true
    deferredPrompt = null
  })
}

/** Register the service worker after load. Safe to call on every entry point. */
export function registerServiceWorker(): void {
  try {
    if (!('serviceWorker' in navigator)) return
    if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return
    const swUrl = new URL('sw.js', document.baseURI).toString()
    const doReg = () => { navigator.serviceWorker.register(swUrl).catch(() => { /* SW optional */ }) }
    if (document.readyState === 'complete') doReg()
    else window.addEventListener('load', doReg, { once: true })
  } catch { /* no SW / blocked — instant web play is unaffected */ }
}

export function isStandalone(): boolean {
  try {
    return window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true
  } catch { return false }
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    // iPadOS 13+ reports as Mac; disambiguate by touch
    (/Macintosh/.test(navigator.userAgent) && 'ontouchend' in document)
}

function dismissed(): boolean {
  try { return localStorage.getItem(DISMISS_KEY) === '1' } catch { return false }
}
function markDismissed(): void {
  try { localStorage.setItem(DISMISS_KEY, '1') } catch { /* private mode */ }
}

/** True if we have something meaningful to offer (native prompt or iOS manual). */
export function canInstall(): boolean {
  if (installedThisSession || isStandalone()) return false
  return deferredPrompt !== null || isIos()
}

/**
 * Show the custom install card. `force` re-shows even after a prior dismissal
 * (e.g. the player tapped an explicit "Install" button). Returns true if a card
 * was shown. Never shows when already installed / running standalone.
 */
export function showInstallCard(opts: { force?: boolean } = {}): boolean {
  if (isStandalone() || installedThisSession) return false
  if (!opts.force && dismissed()) return false
  if (!deferredPrompt && !isIos()) return false
  if (document.getElementById('pwa-install-card')) return false

  const ios = isIos() && !deferredPrompt
  const wrap = document.createElement('div')
  wrap.id = 'pwa-install-card'
  wrap.setAttribute('role', 'dialog')
  wrap.setAttribute('aria-label', 'Install CHROMANCER')
  wrap.style.cssText =
    'position:fixed;left:50%;bottom:16px;transform:translateX(-50%) translateY(140%);z-index:6000;' +
    'width:min(92vw,420px);box-sizing:border-box;padding:14px 16px;border-radius:18px;' +
    'background:linear-gradient(180deg,#1a1030,#120a24);border:1px solid rgba(180,150,255,.35);' +
    'box-shadow:0 14px 44px rgba(0,0,0,.55);color:#f0e9ff;font-family:"Baloo 2","Nunito",system-ui,sans-serif;' +
    'display:flex;gap:12px;align-items:center;transition:transform .45s cubic-bezier(.2,.9,.25,1);'

  const icon = document.createElement('img')
  icon.src = new URL('icons/icon-192.png', document.baseURI).toString()
  icon.alt = ''
  icon.width = 46; icon.height = 46
  icon.style.cssText = 'width:46px;height:46px;border-radius:12px;flex:0 0 auto;box-shadow:0 3px 10px rgba(0,0,0,.4);'

  const body = document.createElement('div')
  body.style.cssText = 'flex:1 1 auto;min-width:0;'
  const title = document.createElement('div')
  title.textContent = 'Put Chromancer on your home screen'
  title.style.cssText = 'font-weight:800;font-size:15px;line-height:1.2;'
  const sub = document.createElement('div')
  sub.textContent = ios
    ? 'Tap  Share  →  “Add to Home Screen”. Plays offline; your colours stay saved.'
    : 'Plays offline · instant reloads · your colours stay saved.'
  sub.style.cssText = 'font-size:12.5px;color:#b9a8e8;margin-top:2px;line-height:1.3;'
  body.append(title, sub)

  const actions = document.createElement('div')
  actions.style.cssText = 'display:flex;flex-direction:column;gap:6px;flex:0 0 auto;'

  const close = document.createElement('button')
  close.setAttribute('aria-label', 'Dismiss install prompt')
  close.textContent = '✕'
  close.style.cssText = 'position:absolute;top:6px;right:8px;background:none;border:none;color:#7a6fa8;font-size:15px;cursor:pointer;padding:4px;'
  const dismiss = () => {
    markDismissed()
    wrap.style.transform = 'translateX(-50%) translateY(140%)'
    window.setTimeout(() => wrap.remove(), 460)
  }
  close.onclick = dismiss

  if (!ios) {
    const cta = document.createElement('button')
    cta.textContent = '⬇  Install'
    cta.style.cssText =
      'padding:10px 18px;border-radius:12px;border:1px solid rgba(255,255,255,.25);cursor:pointer;color:#0a0716;' +
      'font:800 14px "Baloo 2","Nunito",system-ui,sans-serif;background:linear-gradient(180deg,#ffd873,#ffb43c);'
    cta.onclick = async () => {
      if (!deferredPrompt) { dismiss(); return }
      try {
        await deferredPrompt.prompt()
        await deferredPrompt.userChoice
      } catch { /* user cancelled */ }
      deferredPrompt = null
      markDismissed()
      wrap.remove()
    }
    actions.append(cta)
  }

  wrap.append(icon, body, actions, close)
  document.body.appendChild(wrap)
  requestAnimationFrame(() => { wrap.style.transform = 'translateX(-50%) translateY(0)' })
  return true
}
