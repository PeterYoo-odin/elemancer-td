// CHROMANCER landing page — the marketing "sell" surface at /landing.
// Static-first: everything here is progressive enhancement over the HTML.
// It imports ONLY pure game data (seed codec, hero roster), never Phaser,
// so the landing bundle stays tiny and the copy can never drift from the game.

import './landing.css'
import { dailySeed, seedToCode } from '../game/seedcode'
import { HEROES, HERO_ORDER } from '../game/heroes'
import { captureAttribution, reportAttribution, getReferrer } from '../game/attribution'
import { registerServiceWorker, canInstall, showInstallCard } from '../ui/pwa'

// ---------------------------------------------------------------------------
//  Today's seed — client-side + deterministic: every visitor worldwide derives
//  the same code for the same UTC day (live top-5 arrives with ranked servers).
//  `dailySeed()` is shared from seedcode.ts so this widget and the in-game Daily
//  screen can never derive different codes for the same day.
// ---------------------------------------------------------------------------

function gameUrl(query: string): string {
  return new URL(`./${query}`, location.href).toString()
}

function initSeedWidget(): void {
  const codeEl = document.getElementById('seed-code')
  const dateEl = document.getElementById('seed-date')
  const playEl = document.getElementById('seed-play') as HTMLAnchorElement | null
  const copyEl = document.getElementById('seed-copy')
  if (!codeEl || !dateEl || !playEl || !copyEl) return

  const now = new Date()
  const code = seedToCode(dailySeed(Math.floor(now.getTime() / 86_400_000)))
  codeEl.textContent = code
  dateEl.textContent = now.toLocaleDateString('en-US', {
    timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric',
  }) + ' UTC'
  playEl.href = gameUrl(`?seed=${encodeURIComponent(code)}`)

  copyEl.addEventListener('click', () => {
    const link = gameUrl(`?seed=${encodeURIComponent(code)}`)
    const done = (): void => {
      const prev = copyEl.textContent
      copyEl.textContent = 'Copied ✓'
      window.setTimeout(() => { copyEl.textContent = prev }, 1600)
    }
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(link).then(done, done)
    else done()
  })
}

// ---------------------------------------------------------------------------
//  Heroes row — rendered straight from the game's roster so names, elements
//  and signature one-liners are always the shipping truth, never marketing copy.
// ---------------------------------------------------------------------------

/** Painted portraits shipped so far; heroes without one get an element-tinted card. */
const PORTRAITS: Record<string, string> = {
  ember: './concepts/hero-01-ashka-fire.jpg',
  glacia: './concepts/hero-02-lumi-frost.jpg',
  zephyra: './concepts/hero-03-galea-storm.jpg',
  sylvan: './concepts/hero-04-thornwick-nature.jpg',
  aurelia: './concepts/hero-05-seraphine-light.jpg',
  vex: './concepts/hero-06-nyx-dark.jpg',
  volt: './concepts/hero-07-fizz-arcane.jpg',
}

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`

function initHeroRow(): void {
  const row = document.getElementById('hero-row')
  if (!row) return
  for (const id of HERO_ORDER) {
    const def = HEROES[id]
    if (!def) continue
    const card = document.createElement('div')
    card.className = 'hero-card'
    card.tabIndex = 0
    card.style.setProperty('--card-accent', hex(def.color))
    card.setAttribute('role', 'button')
    card.setAttribute('aria-label', `${def.name} ${def.title} — ${def.signature.blurb}`)

    const portrait = PORTRAITS[id]
    if (portrait) {
      const img = document.createElement('img')
      img.src = portrait
      img.alt = `${def.name} ${def.title}`
      img.loading = 'lazy'
      card.appendChild(img)
    } else {
      const fallback = document.createElement('div')
      fallback.className = 'hero-card-fallback'
      fallback.textContent = def.glyph
      card.appendChild(fallback)
    }

    const name = document.createElement('div')
    name.className = 'hero-card-name'
    const strong = document.createElement('strong')
    strong.textContent = def.name
    const span = document.createElement('span')
    span.textContent = `${def.element} · ${def.role}`
    name.append(strong, span)

    const sig = document.createElement('div')
    sig.className = 'hero-card-sig'
    const sigName = document.createElement('strong')
    sigName.textContent = `${def.signature.glyph} ${def.signature.name}`
    const sigBlurb = document.createElement('p')
    sigBlurb.textContent = def.signature.blurb
    sig.append(sigName, sigBlurb)

    card.append(name, sig)
    // touch devices have no hover: first tap flips the card, second tap unflips
    card.addEventListener('click', () => card.classList.toggle('is-flipped'))
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); card.classList.toggle('is-flipped') }
    })
    row.appendChild(card)
  }
}

// ---------------------------------------------------------------------------
//  Hero attract embed — the live game (?attract=1) plays muted behind the H1.
//  Painted key art is always underneath, so this is pure enhancement: it loads
//  after the page settles and is skipped for reduced-motion / data-saver.
// ---------------------------------------------------------------------------

function initAttractEmbed(): void {
  const slot = document.getElementById('attract-slot')
  if (!slot) return
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const saveData = (navigator as { connection?: { saveData?: boolean } }).connection?.saveData === true
  if (reducedMotion || saveData) return

  const mount = (): void => {
    const iframe = document.createElement('iframe')
    // audio stays muted for free: the game gates its mixer behind a user
    // gesture, and pointer-events:none means the embed never receives one.
    iframe.src = gameUrl('?attract=1&loop=1&captions=0')
    iframe.title = 'CHROMANCER attract mode — live gameplay'
    iframe.setAttribute('aria-hidden', 'true')
    iframe.tabIndex = -1
    iframe.addEventListener('load', () => {
      slot.classList.add('is-live')
      const note = document.getElementById('hero-live-note')
      if (note) note.hidden = false
    })
    slot.appendChild(iframe)
  }
  // wait for the landing's own assets, then give the main thread a beat
  if (document.readyState === 'complete') window.setTimeout(mount, 800)
  else window.addEventListener('load', () => window.setTimeout(mount, 800), { once: true })
}

// ---------------------------------------------------------------------------
//  Trailer — "the trailer is just the game": the poster swaps for a live
//  attract-mode run with input enabled, so TAP TO TAKE OVER works in-place.
// ---------------------------------------------------------------------------

function initTrailer(): void {
  const frame = document.getElementById('trailer-frame')
  const play = document.getElementById('trailer-play')
  if (!frame || !play) return
  play.addEventListener('click', () => {
    const iframe = document.createElement('iframe')
    iframe.src = gameUrl('?attract=1&loop=1')
    iframe.title = 'CHROMANCER trailer — a live run playing itself'
    iframe.allow = 'autoplay; fullscreen'
    frame.replaceChildren(iframe)
    iframe.focus()
  })
}

// ---------------------------------------------------------------------------
//  Email capture — localStorage queue for now; the same shape POSTs to the
//  waitlist endpoint once the backend lands (S7), so nothing here changes.
// ---------------------------------------------------------------------------

const WAITLIST_KEY = 'chromancer-waitlist-v1'

function initSignup(): void {
  const form = document.getElementById('signup-form') as HTMLFormElement | null
  const input = document.getElementById('signup-email') as HTMLInputElement | null
  const status = document.getElementById('signup-status')
  if (!form || !input || !status) return

  form.addEventListener('submit', (e) => {
    e.preventDefault()
    const email = input.value.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      status.textContent = 'That doesn\'t look like an email — one more try?'
      status.classList.add('is-error')
      return
    }
    try {
      const raw = localStorage.getItem(WAITLIST_KEY)
      const list: Array<{ email: string; at: string }> = raw ? JSON.parse(raw) : []
      if (!list.some((entry) => entry.email === email)) {
        list.push({ email, at: new Date().toISOString() })
        localStorage.setItem(WAITLIST_KEY, JSON.stringify(list))
      }
    } catch { /* private mode etc. — the thank-you still stands */ }
    status.classList.remove('is-error')
    status.textContent = 'You\'re on the list. First seed drop heads your way soon.'
    input.value = ''
  })
}

// ---------------------------------------------------------------------------
//  Footer bits — year stamp + honest "coming soon" on stubbed links.
// ---------------------------------------------------------------------------

function initFooter(): void {
  const year = document.getElementById('footer-year')
  if (year) year.textContent = String(new Date().getUTCFullYear())

  document.querySelectorAll<HTMLAnchorElement>('a.stub').forEach((link) => {
    const label = link.textContent ?? ''
    link.addEventListener('click', (e) => {
      e.preventDefault()
      link.textContent = link.dataset.stub ?? 'Coming soon'
      window.setTimeout(() => { link.textContent = label }, 2200)
    })
  })
}

// ---------------------------------------------------------------------------
//  Growth: capture the marketing params first-touch (?ref= · ?utm_* · ?campaign=
//  · ?src= · ?c=), register the installable-PWA shell, and — when a friend's
//  invite brought this visitor — warm the welcome copy so it feels personal.
//  Same-origin localStorage is shared with the game at /, so capturing here is
//  enough; clicking PLAY carries the attribution through with zero query juggling.
// ---------------------------------------------------------------------------
function initGrowth(): void {
  captureAttribution()
  reportAttribution()
  registerServiceWorker()

  if (getReferrer()) {
    const bundle = document.getElementById('hero-bundle')
    if (bundle) {
      bundle.innerHTML =
        'A friend invited you — your welcome bundle is <strong>upgraded</strong>. ' +
        'Play now → claim 2,000 diamonds + a starter skin + a referred-only dye. Ranked stays untouched.'
    }
  }

  // Tasteful install affordance: only if installable and not already dismissed.
  // Wait for engagement (the beforeinstallprompt event often lands after load).
  const maybeInstall = (): void => { if (canInstall()) showInstallCard() }
  window.addEventListener('load', () => window.setTimeout(maybeInstall, 4000), { once: true })
}

initSeedWidget()
initHeroRow()
initAttractEmbed()
initTrailer()
initSignup()
initFooter()
initGrowth()
