// REFERRAL — the both-sided viral loop, constitution-safe (cosmetic + soft
// currency only, Ranked ignores every grant). Each device gets ONE stable
// referral code; sharing a ?ref= link and a friend PLAYING rewards both sides.
//
// HONEST DEGRADATION: the *referred* side is fully local and real — a new player
// who arrives with ?ref= carries it (see attribution.ts), and their welcome
// bundle upgrades locally. The *referrer* side genuinely cannot be verified
// without a server (a client can't prove a friend played), so the friend count
// and referrer ladder are BACKEND-fed; local-only play shows the loop and the
// share tools but never fabricates unearned referrer rewards.
//
// DOM/localStorage access lives only inside functions, so the module stays
// importable by headless checks and never throws.

const DEVICE_KEY = 'chromancer_device_v1'
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no ambiguous 0/O/1/I

/** Canonical public home used when we can't trust location (file://, headless). */
const SHARE_HOME = 'https://chromancer.io/'

// A stable 30-bit device number, generated once and persisted. Not identifying —
// just a per-browser token so a player's referral code stays the same.
function deviceNumber(): number {
  try {
    const raw = localStorage.getItem(DEVICE_KEY)
    if (raw) {
      const n = parseInt(raw, 10)
      if (Number.isFinite(n) && n > 0) return n
    }
  } catch { /* fall through to generate */ }
  // generate: prefer crypto, fall back to time+math (uniqueness isn't critical)
  let n = 0
  try {
    const buf = new Uint32Array(1)
    ;(globalThis.crypto as Crypto | undefined)?.getRandomValues(buf)
    n = buf[0] >>> 2 // 30 bits
  } catch { /* no crypto */ }
  if (!n) n = ((Date.now() >>> 0) ^ Math.floor(Math.random() * 0x3fffffff)) >>> 2
  n = (n % 0x3fffffff) + 1
  try { localStorage.setItem(DEVICE_KEY, String(n)) } catch { /* private mode */ }
  return n
}

/** Encode a number into a short CR-XXXXX code (base-32, unambiguous glyphs). */
function encodeCode(n: number): string {
  let x = (n >>> 0) || 1
  let s = ''
  for (let i = 0; i < 5; i++) {
    s = CODE_ALPHABET[x % CODE_ALPHABET.length] + s
    x = Math.floor(x / CODE_ALPHABET.length)
  }
  return 'CR-' + s
}

/** Is a string shaped like a referral code? (loose — just for validation) */
export function isReferralCode(v: string | null | undefined): boolean {
  return !!v && /^CR-[A-Z0-9]{4,6}$/i.test(v.trim())
}

/** This device's stable referral code (e.g. CR-7K2QP). */
export function myReferralCode(): string {
  return encodeCode(deviceNumber())
}

/**
 * Fuse this device's ?ref= code onto ANY share URL (seed/prove-it links), so
 * every brag is also an invite — the loop's highest-volume surface. Idempotent:
 * a URL that already carries a ref is left untouched. View-side only; keep the
 * `referral` module out of the sim import graph.
 */
export function withRef(url: string, code = myReferralCode()): string {
  if (!url || /[?&]ref=/.test(url)) return url
  return url + (url.includes('?') ? '&' : '?') + 'ref=' + encodeURIComponent(code)
}

/** The shareable invite link carrying this device's ?ref= code. */
export function referralLink(code = myReferralCode()): string {
  let base = SHARE_HOME
  try {
    if (typeof location !== 'undefined' && /^https?:$/.test(location.protocol)) {
      base = location.origin + location.pathname
    }
  } catch { /* non-browser */ }
  return `${base}?ref=${encodeURIComponent(code)}`
}

// ---------------------------------------------------------------------------
//  Referral ladder (referrer side) — cosmetic-only rungs, BACKEND-gated.
//  friends → reward. Grants only fire when a server confirms `friends`; the
//  UI shows the ladder either way so the loop is legible before accounts land.
// ---------------------------------------------------------------------------
export interface ReferralRung {
  friends: number // confirmed friends required
  sku?: string // cosmetic SKU granted (promoExclusive; never sold on the shelf)
  diamonds?: number // soft-currency granted (earnable free anyway)
  label: string // human description of the rung
}

export const REFERRAL_LADDER: ReferralRung[] = [
  { friends: 1, diamonds: 300, label: '300 💎' },
  { friends: 3, sku: 'frame-restorer', label: '“Restorer” banner frame' },
  { friends: 5, sku: 'ts-frost-referral', label: 'Exclusive Auric tower skin' },
  { friends: 10, sku: 'dye-restorers-wall', label: 'Legendary dye + Restorers-Wall credit' },
]

/**
 * BACKEND SEAM — tell the server "this device sent an invite" / "a referred
 * friend played". No-op without a configured backend so local play never
 * blocks. The friend COUNT (which unlocks the ladder) can only come back from
 * the server; we never self-award referrer rungs offline.
 */
export function reportReferralEvent(kind: 'invite' | 'friend-played', payload: Record<string, unknown> = {}): void {
  try {
    const backend = (window as unknown as { __CHROMANCER_BACKEND__?: string }).__CHROMANCER_BACKEND__
    if (!backend) return
    void fetch(`${backend.replace(/\/$/, '')}/referral/${kind}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: myReferralCode(), ...payload }),
      keepalive: true,
    }).catch(() => { /* fire-and-forget */ })
  } catch { /* no window / blocked */ }
}
