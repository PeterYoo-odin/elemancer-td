// ADMIN CONFIG — the trust + control seam. Three responsibilities:
//   1. Backend detection: read the SAME fire-and-forget seam the game uses
//      (window.__CHROMANCER_BACKEND__). Admin calls hit ${backend}/admin/*.
//   2. Admin session: a bearer token obtained by an admin-role login POST to the
//      backend. The client holds NO secret and gates NO real data on a string
//      compare — real data flows only through calls the server authorises by
//      role. When no backend is configured, the only available mode is an
//      explicit, clearly-labelled DEMO (synthetic) session. This is the honest
//      posture the IP section documents: the server is the moat; the client
//      enforces nothing.
//   3. Live-ops control: feature flags + event toggles + seed-rotation intents,
//      persisted locally and pushed through the backend seam when present.
//
// A separate Vite entry (admin.html) also keeps ALL of this out of the players'
// game bundle — main.ts never imports src/admin/*.

const SESSION_KEY = 'chromancer_admin_session_v1'
const FLAGS_KEY = 'chromancer_admin_flags_v1'
const RANGE_KEY = 'chromancer_admin_range_v1'

export type Mode = 'live' | 'demo'

export interface AdminSession {
  mode: Mode
  token: string // bearer for live mode; '' for demo
  role: string // 'owner' | 'admin' | 'analyst' | 'demo'
  email: string // operator label (never a player email)
  since: number // epoch ms of login
}

export function backendUrl(): string | null {
  try {
    const b = (window as unknown as { __CHROMANCER_BACKEND__?: string }).__CHROMANCER_BACKEND__
    return b && typeof b === 'string' ? b.replace(/\/$/, '') : null
  } catch {
    return null
  }
}

export function isConfigured(): boolean {
  return backendUrl() !== null
}

// ---- session ---------------------------------------------------------------
export function loadSession(): AdminSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const o = JSON.parse(raw) as Partial<AdminSession>
    if (o.mode !== 'live' && o.mode !== 'demo') return null
    return {
      mode: o.mode,
      token: typeof o.token === 'string' ? o.token : '',
      role: typeof o.role === 'string' ? o.role : 'demo',
      email: typeof o.email === 'string' ? o.email : '',
      since: typeof o.since === 'number' ? o.since : Date.now(),
    }
  } catch {
    return null
  }
}

function saveSession(s: AdminSession): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(s))
  } catch {
    /* private mode — session lives in memory for this page load only */
  }
}

export function logout(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY)
  } catch {
    /* ignore */
  }
}

/**
 * Attempt an admin login. LIVE: POST the passcode to the backend, which returns
 * a scoped bearer + role ONLY if the account has an admin role — the check is
 * server-side, always. DEMO: no backend, so we mint a clearly-labelled synthetic
 * session that unlocks ONLY the synthetic dataset (no real data exists to leak).
 */
export async function login(passcode: string): Promise<{ ok: boolean; session?: AdminSession; error?: string }> {
  const base = backendUrl()
  if (!base) {
    const s: AdminSession = { mode: 'demo', token: '', role: 'demo', email: 'demo@local', since: Date.now() }
    saveSession(s)
    return { ok: true, session: s }
  }
  try {
    const res = await fetch(`${base}/admin/auth`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ passcode }),
    })
    if (res.status === 401 || res.status === 403) return { ok: false, error: 'Not authorised — admin role required.' }
    if (!res.ok) return { ok: false, error: `Backend error (${res.status}).` }
    const data = (await res.json()) as { token?: string; role?: string; email?: string }
    if (!data.token) return { ok: false, error: 'No session token returned.' }
    const s: AdminSession = {
      mode: 'live',
      token: data.token,
      role: data.role ?? 'admin',
      email: data.email ?? 'admin',
      since: Date.now(),
    }
    saveSession(s)
    return { ok: true, session: s }
  } catch {
    return { ok: false, error: 'Backend unreachable.' }
  }
}

/**
 * Authorised GET against an admin endpoint. Returns parsed JSON on success, or
 * null on any failure — callers fall back to demo data so the dashboard NEVER
 * crashes on an unconfigured/degraded backend.
 */
export async function adminGet<T>(session: AdminSession, path: string): Promise<T | null> {
  const base = backendUrl()
  if (!base || session.mode !== 'live') return null
  try {
    const res = await fetch(`${base}/admin${path}`, {
      headers: { authorization: `Bearer ${session.token}` },
    })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

/** Authorised POST for control actions (flags, seed rotation, flag account…). */
export async function adminPost<T>(session: AdminSession, path: string, body: unknown): Promise<{ ok: boolean; data?: T }> {
  const base = backendUrl()
  if (!base || session.mode !== 'live') return { ok: false }
  try {
    const res = await fetch(`${base}/admin${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${session.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) return { ok: false }
    const data = res.headers.get('content-type')?.includes('json') ? ((await res.json()) as T) : undefined
    return { ok: true, data }
  } catch {
    return { ok: false }
  }
}

// ---- feature flags / event toggles (live-ops kill switches) ----------------
export interface FlagDef {
  id: string
  label: string
  sub: string
  group: 'store' | 'growth' | 'events' | 'safety'
  defaultOn: boolean
  locked?: boolean // emergency switches that can't be toggled off casually
}

// The switches the research spec calls "minimum viable live-ops" — read by the
// client at boot (via the config seam) so an incident is handled with NO
// redeploy. Defaults mirror the game's current live behaviour.
export const FLAG_DEFS: FlagDef[] = [
  { id: 'store_enabled', label: 'Store', sub: 'Cosmetic store + diamond packs surface in-game', group: 'store', defaultOn: true },
  { id: 'pass_enabled', label: 'Prism Pass', sub: 'Season pass track & premium upgrade', group: 'store', defaultOn: true },
  { id: 'referral_enabled', label: 'Referral program', sub: 'Invite links + referral ladder rewards', group: 'growth', defaultOn: true },
  { id: 'welcome_bundle', label: 'Welcome bundle', sub: 'New-player diamond + starter-skin grant', group: 'growth', defaultOn: true },
  { id: 'daily_seed', label: 'Daily seed', sub: 'Daily shared-seed challenge board', group: 'events', defaultOn: true },
  { id: 'weekly_seed', label: 'Weekly seed', sub: 'Weekly roguelike seed + headline mutator', group: 'events', defaultOn: true },
  { id: 'seasonal_event', label: 'Seasonal event', sub: 'Emberwaste Restoration event window', group: 'events', defaultOn: true },
  { id: 'ranked_submissions', label: 'Ranked submissions', sub: 'Accept new ranked run submissions', group: 'safety', defaultOn: true },
  { id: 'leaderboard_freeze', label: '🚨 Freeze leaderboard', sub: 'Emergency: stop all board writes + hide pending', group: 'safety', defaultOn: false, locked: true },
  { id: 'sitelock_phonehome', label: 'Site-lock phone-home', sub: 'Off-origin clients report referrer (clone telemetry)', group: 'safety', defaultOn: true },
]

export type FlagState = Record<string, boolean>

export function defaultFlags(): FlagState {
  const s: FlagState = {}
  for (const f of FLAG_DEFS) s[f.id] = f.defaultOn
  return s
}

export function loadFlags(): FlagState {
  const base = defaultFlags()
  try {
    const raw = localStorage.getItem(FLAGS_KEY)
    if (!raw) return base
    const o = JSON.parse(raw) as Record<string, unknown>
    for (const f of FLAG_DEFS) if (typeof o[f.id] === 'boolean') base[f.id] = o[f.id] as boolean
    return base
  } catch {
    return base
  }
}

export function saveFlags(state: FlagState): void {
  try {
    localStorage.setItem(FLAGS_KEY, JSON.stringify(state))
  } catch {
    /* ignore */
  }
}

// ---- date range ------------------------------------------------------------
export type RangeDays = 7 | 14 | 30 | 90
export function loadRange(): RangeDays {
  try {
    const v = Number(localStorage.getItem(RANGE_KEY))
    return v === 7 || v === 14 || v === 30 || v === 90 ? v : 30
  } catch {
    return 30
  }
}
export function saveRange(r: RangeDays): void {
  try {
    localStorage.setItem(RANGE_KEY, String(r))
  } catch {
    /* ignore */
  }
}
