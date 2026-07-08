// ============================================================================
//  AUTH NET — SECURE, PORTABLE SIGN-IN, layered on top of the anonymous device
//  identity (rankedNet.ts). Hand-rolled GoTrue (Supabase Auth) REST against the
//  DEDICATED game project's anon key — no SDK, no extra bundle weight, and the
//  SAME graceful-degradation contract as rankedNet: when the backend is unwired
//  (or offline) every call quietly resolves to null/false and the game plays as
//  a guest exactly as before. It NEVER throws into gameplay and NEVER walls play.
//
//  FLOW: passwordless only — MAGIC LINK (email one-time link) and OAuth (Google,
//  Apple). No code_challenge is sent, so GoTrue uses the IMPLICIT flow and hands
//  tokens back in the URL hash (#access_token&refresh_token&expires_in). We parse
//  that on load, persist the session, strip the hash, and auto-refresh via the
//  refresh_token. The device SECRET never leaves the client; the server only ever
//  sees a verified access token (it validates it before trusting the uid).
//
//  SECURITY: only the anon key ships here (safe by design). The server (service
//  role) is the sole writer and re-verifies every token. Sign-out clears ONLY the
//  auth session — the device anchor stays, so a signed-out player falls back to
//  guest, never a wipe. Zero PHI stored server-side (only the opaque auth uid).
// ============================================================================

import { deviceHash, setLocalHandle } from './rankedNet'

const URL = (import.meta.env.VITE_GAME_SUPABASE_URL as string | undefined)?.replace(/\/$/, '') || ''
const ANON = (import.meta.env.VITE_GAME_SUPABASE_ANON_KEY as string | undefined) || ''

const SESSION_KEY = 'chromancer_auth_session_v1'

export interface AuthUser {
  id: string
  email: string | null
}
interface AuthSession {
  access_token: string
  refresh_token: string
  expires_at: number // epoch seconds
  user: AuthUser
}

/** True when Supabase Auth is wired (same env as ranked). When false, every auth
 *  affordance stays hidden and the game is guest-only. */
export function authConfigured(): boolean {
  return !!URL && !!ANON
}

// ---------------------------------------------------------------------------
//  Session persistence (local-first; the SDK's job, done by hand)
// ---------------------------------------------------------------------------

let session: AuthSession | null = loadSession()

function loadSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const s = JSON.parse(raw)
    if (s && typeof s.access_token === 'string' && typeof s.refresh_token === 'string' && s.user?.id) return s as AuthSession
  } catch { /* private mode / corrupt */ }
  return null
}
function storeSession(s: AuthSession | null): void {
  session = s
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s))
    else localStorage.removeItem(SESSION_KEY)
  } catch { /* private mode — keep the in-memory session for this tab */ }
  emitChange()
}

// ---- change notifications (UI reacts: menu handle, store guard, etc.) -------
type Listener = () => void
const listeners = new Set<Listener>()
export function onAuthChange(cb: Listener): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
function emitChange(): void { for (const cb of [...listeners]) { try { cb() } catch { /* ignore */ } } }

// ---------------------------------------------------------------------------
//  Public state accessors
// ---------------------------------------------------------------------------

export function currentUser(): AuthUser | null { return session?.user ?? null }
export function isSignedIn(): boolean { return !!session }
export function userEmail(): string | null { return session?.user.email ?? null }

// ---------------------------------------------------------------------------
//  Token freshness — refresh a few seconds before expiry, de-duped so parallel
//  callers share one in-flight refresh.
// ---------------------------------------------------------------------------

let refreshInFlight: Promise<boolean> | null = null

/** A currently-valid access token, refreshing if it is expired/near-expiry.
 *  Returns null when signed out or the refresh fails. */
export async function getAccessToken(): Promise<string | null> {
  if (!session) return null
  const now = Math.floor(Date.now() / 1000)
  if (session.expires_at - now > 30) return session.access_token
  const ok = await refreshSession()
  return ok && session ? session.access_token : null
}

async function refreshSession(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight
  const rt = session?.refresh_token
  if (!rt || !authConfigured()) return false
  refreshInFlight = (async () => {
    try {
      const res = await fetch(`${URL}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: { apikey: ANON, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: rt }),
      })
      if (!res.ok) { storeSession(null); return false } // refresh token dead → fall back to guest
      const j = await res.json()
      const next = sessionFromTokenResponse(j)
      if (!next) { storeSession(null); return false }
      storeSession(next)
      return true
    } catch {
      return false // transient (offline): keep the session, try again later
    } finally {
      refreshInFlight = null
    }
  })()
  return refreshInFlight
}

function sessionFromTokenResponse(j: any): AuthSession | null {
  if (!j || typeof j.access_token !== 'string' || typeof j.refresh_token !== 'string') return null
  const expiresIn = Number(j.expires_in) || 3600
  const user: AuthUser = {
    id: String(j.user?.id ?? session?.user.id ?? ''),
    email: typeof j.user?.email === 'string' ? j.user.email : (session?.user.email ?? null),
  }
  if (!user.id) return null
  return { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Math.floor(Date.now() / 1000) + expiresIn, user }
}

// ---------------------------------------------------------------------------
//  Redirect target — where GoTrue sends the browser back with the token hash.
//  Origin + path only (no query/hash), so it matches a Supabase redirect-allow
//  entry cleanly. The callback handler below reads the hash on load.
// ---------------------------------------------------------------------------

function redirectUrl(): string {
  try { return `${location.origin}${location.pathname}` } catch { return '' }
}

// ---------------------------------------------------------------------------
//  Sign-in entry points
// ---------------------------------------------------------------------------

/** Send a passwordless MAGIC LINK to the email. Resolves { ok } — on ok the user
 *  must click the emailed link, which returns to redirectUrl() with the token. */
export async function signInWithMagicLink(email: string): Promise<{ ok: boolean; error?: string }> {
  if (!authConfigured()) return { ok: false, error: 'unconfigured' }
  const clean = email.trim()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) return { ok: false, error: 'email' }
  try {
    const res = await fetch(`${URL}/auth/v1/otp?redirect_to=${encodeURIComponent(redirectUrl())}`, {
      method: 'POST',
      headers: { apikey: ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: clean, create_user: true }),
    })
    if (!res.ok) {
      const b = await res.json().catch(() => ({}))
      return { ok: false, error: String(b?.error_description || b?.msg || `http_${res.status}`).slice(0, 120) }
    }
    return { ok: true }
  } catch {
    return { ok: false, error: 'offline' }
  }
}

/** Full-page redirect into a provider's consent screen (implicit flow → token in
 *  the hash on return). Google + Apple. No-op when unconfigured. */
export function signInWithOAuth(provider: 'google' | 'apple'): void {
  if (!authConfigured()) return
  try {
    const url = `${URL}/auth/v1/authorize?provider=${encodeURIComponent(provider)}&redirect_to=${encodeURIComponent(redirectUrl())}`
    location.assign(url)
  } catch { /* navigation blocked — nothing to do */ }
}

// ---------------------------------------------------------------------------
//  Callback — parse the token hash on load, persist, strip the URL, then LINK.
// ---------------------------------------------------------------------------

/** Call once at boot. If the URL hash carries auth tokens (magic link / OAuth
 *  return), capture the session, clean the URL, link the device, and resolve
 *  true. Otherwise resolve false. Never throws. */
export async function handleAuthCallback(): Promise<boolean> {
  if (!authConfigured()) return false
  let hash = ''
  try { hash = location.hash || '' } catch { return false }
  if (!hash || hash.indexOf('access_token') === -1) {
    // surface a clean URL even for the error case (#error=access_denied&…)
    if (hash && hash.indexOf('error') !== -1) cleanUrl()
    return false
  }
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const access = params.get('access_token')
  const refresh = params.get('refresh_token')
  if (!access || !refresh) { cleanUrl(); return false }
  const expiresIn = Number(params.get('expires_in')) || 3600
  // Resolve the user (id is what matters; email is for a friendly menu label).
  // The server re-verifies the token independently before trusting the uid.
  const user = await fetchUser(access)
  cleanUrl()
  if (!user?.id) return false // couldn't resolve the user → stay guest, no session
  storeSession({
    access_token: access,
    refresh_token: refresh,
    expires_at: Math.floor(Date.now() / 1000) + expiresIn,
    user,
  })
  await linkDevice()
  return true
}

async function fetchUser(accessToken: string): Promise<AuthUser | null> {
  try {
    const res = await fetch(`${URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${accessToken}` } })
    if (!res.ok) return null
    const u = await res.json()
    if (typeof u?.id !== 'string') return null
    return { id: u.id, email: typeof u.email === 'string' ? u.email : null }
  } catch { return null }
}

function cleanUrl(): void {
  try {
    const clean = `${location.origin}${location.pathname}${location.search}`
    history.replaceState(null, '', clean)
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
//  Link — bind this device's player row to the verified auth uid (server merges
//  if the uid already has an account elsewhere). Client sends deviceHash + token;
//  the SERVER verifies the token and owns all merge/link logic.
// ---------------------------------------------------------------------------

/** Link the current device to the signed-in account. Returns true on success.
 *  On success the returned handle (if any) is synced locally so the menu updates. */
export async function linkDevice(): Promise<boolean> {
  const token = await getAccessToken()
  if (!token) return false
  try {
    const dh = await deviceHash()
    const res = await fetch('/api/account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'link', deviceHash: dh, accessToken: token }),
    })
    if (!res.ok) return false
    const j = await res.json().catch(() => null)
    if (!j?.ok) return false
    if (typeof j.handle === 'string' && j.handle) setLocalHandle(j.handle)
    emitChange()
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
//  Sign-out — clears ONLY the auth session (device anchor untouched → guest).
// ---------------------------------------------------------------------------

export async function signOut(): Promise<void> {
  const token = session?.access_token
  // best-effort server revoke; local clear happens regardless
  if (token && authConfigured()) {
    try {
      await fetch(`${URL}/auth/v1/logout`, {
        method: 'POST',
        headers: { apikey: ANON, Authorization: `Bearer ${token}` },
      })
    } catch { /* offline — local sign-out still proceeds */ }
  }
  storeSession(null)
}
