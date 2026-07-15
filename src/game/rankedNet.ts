// ============================================================================
//  RANKED NET — the thin client bridge to the DEDICATED game Supabase project.
//  Everything here DEGRADES GRACEFULLY: when the env vars are unset (or the
//  network is down) every call quietly resolves to null/[]/false and the game
//  plays exactly as before — local PB still works, boards show "connecting to
//  ranked servers…". It NEVER throws into gameplay and NEVER blocks play.
//
//  Reads (leaderboards, ghosts) go straight to PostgREST with the PUBLIC anon
//  key (RLS makes those tables public-read). Writes (run submission, cloud save)
//  go through the server functions (/api/*), which verify + use the service role
//  — the anon client can never write a run or a save directly.
// ============================================================================

import type { RankedMode, RankedRunRecord, RankedLog, DeclaredHero } from './ranked'
import type { PFCell } from './pathforge'

const URL = (import.meta.env.VITE_GAME_SUPABASE_URL as string | undefined)?.replace(/\/$/, '') || ''
const ANON = (import.meta.env.VITE_GAME_SUPABASE_ANON_KEY as string | undefined) || ''

/** True when the ranked backend is wired. Reads/boards need this; when false the
 *  UI shows the "connecting to ranked servers…" state and local play is untouched. */
export function rankedConfigured(): boolean {
  return !!URL && !!ANON
}

const REST = () => `${URL}/rest/v1`

async function sbGet(path: string): Promise<any> {
  if (!rankedConfigured()) return null
  try {
    const res = await fetch(`${REST()}/${path}`, {
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null // network down / offline — degrade to local
  }
}

async function apiPost(fn: string, body: unknown): Promise<any> {
  try {
    const res = await fetch(`/api/${fn}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
//  Device identity — an anonymous, recoverable account. We hold a random secret
//  locally and only ever send its SHA-256 hash, so the server stores an opaque
//  id it can't reverse. Upgradable to a chosen handle. Zero PHI.
// ---------------------------------------------------------------------------

const SECRET_KEY = 'chromancer_device_secret_v1'
const HANDLE_KEY = 'chromancer_handle_v1'

function deviceSecret(): string {
  try {
    let s = localStorage.getItem(SECRET_KEY)
    if (!s) {
      const buf = new Uint8Array(16)
      ;(globalThis.crypto || ({} as Crypto)).getRandomValues?.(buf)
      s = Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('')
      if (s.length < 8) s = 'x' + Date.now().toString(16) + Math.floor(Math.random() * 1e9).toString(16)
      localStorage.setItem(SECRET_KEY, s)
    }
    return s
  } catch {
    return 'ephemeral-' + Math.floor(Math.random() * 1e9).toString(16)
  }
}

let cachedHash: string | null = null

/** SHA-256 hex of the device secret (falls back to a stable non-crypto mix on
 *  insecure contexts where subtle crypto is unavailable). */
export async function deviceHash(): Promise<string> {
  if (cachedHash) return cachedHash
  const secret = deviceSecret()
  try {
    const subtle = globalThis.crypto?.subtle
    if (subtle) {
      const data = new TextEncoder().encode('chromancer:' + secret)
      const digest = await subtle.digest('SHA-256', data)
      cachedHash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
      return cachedHash
    }
  } catch {
    /* fall through to the non-crypto fallback */
  }
  // Fallback: 128-bit mix of the secret (stable per device; not collision-proof,
  // acceptable for an anonymous leaderboard identity).
  let h1 = 0x811c9dc5, h2 = 0x1000193, h3 = 0xdeadbeef, h4 = 0x41c64e6d
  for (let i = 0; i < secret.length; i++) {
    const c = secret.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193); h2 = Math.imul(h2 + c, 0x27d4eb2f)
    h3 = Math.imul(h3 ^ (c << 3), 0x165667b1); h4 = Math.imul(h4 + (c << 5), 0x2545f491)
  }
  cachedHash = [h1, h2, h3, h4].map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('')
  return cachedHash
}

export function localHandle(): string | null {
  try { return localStorage.getItem(HANDLE_KEY) } catch { return null }
}

/** Persist the display handle locally (also used after a sign-in link carries the
 *  account's handle back). Exported so the auth layer can sync it. */
export function setLocalHandle(h: string): void {
  try { localStorage.setItem(HANDLE_KEY, h) } catch { /* private mode */ }
}

/** Register (or fetch) this device's account, optionally claiming a handle. When
 *  an `accessToken` is passed (signed in) the handle is set on the durable auth
 *  account, not the guest device row. Returns the confirmed handle, or null. */
export async function registerHandle(handle?: string, accessToken?: string): Promise<string | null> {
  const dh = await deviceHash()
  const clean = handle ? handle.replace(/[^\w \-]/g, '').trim().slice(0, 24) : undefined
  const r = await apiPost('account', { op: 'register', deviceHash: dh, handle: clean, accessToken })
  if (r?.ok) {
    if (r.handle) setLocalHandle(r.handle)
    else if (clean) setLocalHandle(clean)
    return r.handle ?? clean ?? null
  }
  // offline: still remember the chosen handle locally for a later sync
  if (clean) setLocalHandle(clean)
  return clean ?? null
}

// ---------------------------------------------------------------------------
//  Leaderboards + ghosts
// ---------------------------------------------------------------------------

export interface BoardRow {
  id: string
  handle: string | null
  score: number
  wave: number
  seed: number
  player_id: string | null
  created_at: string
}

/** Top rows for a board (mode + period). Distinguishes the two nothings:
 *  `[]` = the board is reachable and genuinely empty; `null` = unreachable
 *  (unconfigured / offline / server error) — the UI must NOT render an outage
 *  as "no runs yet", or a downed backend quietly gaslights every player. */
export async function fetchBoard(mode: RankedMode, period: number, limit = 100): Promise<BoardRow[] | null> {
  const rows = await sbGet(
    `runs?select=id,handle,score,wave,seed,player_id,created_at&mode=eq.${mode}&period=eq.${period}&order=score.desc,created_at.asc&limit=${limit}`,
  )
  return Array.isArray(rows) ? rows.map(normalizeRow) : null
}

function normalizeRow(r: any): BoardRow {
  return {
    id: String(r.id), handle: r.handle ?? null, score: Number(r.score) || 0,
    wave: Number(r.wave) || 0, seed: Number(r.seed) >>> 0, player_id: r.player_id ?? null,
    created_at: String(r.created_at ?? ''),
  }
}

/** 1-indexed rank a given score would hold on a board (count of strictly-better
 *  runs + 1). null when unconfigured. Uses a HEAD count request. */
export async function fetchRank(mode: RankedMode, period: number, score: number): Promise<number | null> {
  if (!rankedConfigured()) return null
  try {
    const res = await fetch(
      `${REST()}/runs?select=id&mode=eq.${mode}&period=eq.${period}&score=gt.${score}`,
      { headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, Prefer: 'count=exact', Range: '0-0' } },
    )
    const range = res.headers.get('content-range') // e.g. "0-0/42"
    const total = range ? parseInt(range.split('/')[1] ?? '', 10) : NaN
    if (Number.isFinite(total)) return total + 1
    const body = await res.json().catch(() => [])
    return (Array.isArray(body) ? body.length : 0) + 1
  } catch {
    return null
  }
}

/** Download a run's replay log for GHOST racing. null when unavailable. `route`
 *  is present only for PathForge runs — the ghost's own maze, needed to rebuild
 *  the exact LevelDef it ran on (a fixed-arena ghost can't race a maze run). */
export async function fetchGhost(runId: string): Promise<{ log: RankedLog; party: DeclaredHero[]; seed: number; mode: RankedMode; route?: PFCell[] } | null> {
  const rows = await sbGet(`run_inputs?select=log,party,route,runs(seed,mode)&run_id=eq.${encodeURIComponent(runId)}`)
  const row = Array.isArray(rows) && rows[0] ? rows[0] : null
  if (!row?.log) return null
  const run = row.runs || {}
  return {
    log: row.log as RankedLog, party: (row.party as DeclaredHero[]) || [], seed: Number(run.seed) >>> 0,
    mode: (run.mode as RankedMode) || 'endless', route: Array.isArray(row.route) ? (row.route as PFCell[]) : undefined,
  }
}

// ---------------------------------------------------------------------------
//  Submission — verify-then-board. Returns the server-verified outcome, or null
//  if the backend is unreachable (the run still counts locally).
// ---------------------------------------------------------------------------

export interface SubmitResult {
  ok: boolean
  reason?: string
  score: number
  wave: number
  rank?: number
  runId?: string
  handle?: string | null
}

export async function submitRun(rec: RankedRunRecord): Promise<SubmitResult | null> {
  const dh = await deviceHash()
  const r = await apiPost('verify-run', { record: rec, deviceHash: dh, handle: localHandle() || undefined })
  if (!r) return null
  return r as SubmitResult
}

// ---------------------------------------------------------------------------
//  Cloud save (local-first mirror)
// ---------------------------------------------------------------------------

export async function cloudSavePut(data: unknown, rev: number, accessToken?: string): Promise<boolean> {
  const dh = await deviceHash()
  const r = await apiPost('account', { op: 'save', deviceHash: dh, data, rev, accessToken })
  return !!r?.ok
}

export async function cloudSaveGet(accessToken?: string): Promise<{ data: unknown; rev: number; handle: string | null } | null> {
  const dh = await deviceHash()
  const r = await apiPost('account', { op: 'load', deviceHash: dh, accessToken })
  if (!r?.ok || !r.exists) return null
  return { data: r.data ?? null, rev: Number(r.rev) || -1, handle: r.handle ?? null }
}
