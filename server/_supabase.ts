// Server-side Supabase REST helper for the ranked API functions. Uses the
// SERVICE ROLE key (bypasses RLS) and NEVER ships to the browser — these files
// run only as Vercel serverless functions. The `_` prefix keeps Vercel from
// exposing this as a route. Reads env from the DEDICATED game project only.

const URL = process.env.GAME_SUPABASE_URL || process.env.VITE_GAME_SUPABASE_URL || ''
const SERVICE_KEY = process.env.GAME_SUPABASE_SERVICE_ROLE_KEY || ''

export function serverConfigured(): boolean {
  return !!URL && !!SERVICE_KEY
}

/** Fetch against PostgREST with the service role. `path` is e.g.
 *  `players?device_hash=eq.abc&select=*`. Returns parsed JSON (or null on 204). */
export async function sbFetch(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`supabase ${res.status}: ${body.slice(0, 300)}`)
  }
  if (res.status === 204) return null
  const txt = await res.text()
  return txt ? JSON.parse(txt) : null
}

/** Upsert (get-or-create) the player row for a device hash, returning it. */
export async function upsertPlayer(deviceHash: string, handle?: string): Promise<any> {
  const body: Record<string, unknown> = { device_hash: deviceHash }
  if (handle) body.handle = handle
  const rows = await sbFetch('players?on_conflict=device_hash', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(body),
  })
  return Array.isArray(rows) ? rows[0] : rows
}

// ---------------------------------------------------------------------------
//  Auth (portable sign-in) — layered on top of the device identity. The client
//  only ever sends its deviceHash + a Supabase Auth ACCESS TOKEN. We NEVER trust
//  a client-supplied uid: the token is validated here against GoTrue with the
//  service client, and the uid we act on is the one GoTrue returns.
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** True for a plausibly-shaped JWT (three base64url segments). Cheap pre-filter
 *  so obviously-junk tokens never even hit GoTrue. */
export function looksLikeJwt(token: unknown): token is string {
  return typeof token === 'string' && token.length >= 20 && token.length <= 4096 && token.split('.').length === 3
}

/** Validate a user's access token by asking GoTrue who it is (service apikey +
 *  the user's Bearer JWT). Returns the verified { uid, email } or null when the
 *  token is missing/expired/invalid. This is the ONLY source of a trusted uid. */
export async function verifyAuthToken(accessToken: unknown): Promise<{ uid: string; email: string | null } | null> {
  if (!looksLikeJwt(accessToken)) return null
  try {
    const res = await fetch(`${URL}/auth/v1/user`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return null
    const user = await res.json().catch(() => null)
    const uid = user?.id
    if (typeof uid !== 'string' || !UUID_RE.test(uid)) return null
    return { uid, email: typeof user?.email === 'string' ? user.email : null }
  } catch {
    return null
  }
}

/** The player row anchored to an auth uid (the durable, cross-device identity),
 *  or null if this auth user has no row yet. */
export async function findPlayerByAuthUid(uid: string): Promise<any> {
  if (!UUID_RE.test(uid)) return null
  const rows = await sbFetch(`players?auth_uid=eq.${uid}&select=id,handle,auth_uid,device_hash`)
  return Array.isArray(rows) && rows[0] ? rows[0] : null
}

/** The guest player row for a device hash, or null. */
export async function findPlayerByDevice(deviceHash: string): Promise<any> {
  const rows = await sbFetch(`players?device_hash=eq.${encodeURIComponent(deviceHash)}&select=id,handle,auth_uid,device_hash`)
  return Array.isArray(rows) && rows[0] ? rows[0] : null
}

/** Patch selected columns on a player row; returns the updated row. */
export async function patchPlayer(id: string, fields: Record<string, unknown>): Promise<any> {
  const rows = await sbFetch(`players?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(fields),
  })
  return Array.isArray(rows) && rows[0] ? rows[0] : null
}

/** Create a pure-auth player row (no device_hash) for an auth uid. Used only for
 *  the rare case where the device's guest row is already claimed by a DIFFERENT
 *  auth user, so the new signer needs their own row on this device. */
export async function createAuthPlayer(uid: string, handle?: string): Promise<any> {
  const body: Record<string, unknown> = { auth_uid: uid }
  if (handle) body.handle = handle
  const rows = await sbFetch('players', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(body),
  })
  return Array.isArray(rows) && rows[0] ? rows[0] : null
}

/** Resolve the player row a request should read/write. When a valid auth token
 *  is present we use the DURABLE auth-anchored row (portable across devices);
 *  otherwise the guest device row (created if needed). Never auto-creates an
 *  auth row — only the explicit `link` op does that. Returns { player, uid }. */
export async function resolvePlayer(deviceHash: string, accessToken: unknown): Promise<{ player: any; uid: string | null }> {
  const auth = await verifyAuthToken(accessToken)
  if (auth) {
    const byUid = await findPlayerByAuthUid(auth.uid)
    if (byUid) return { player: byUid, uid: auth.uid }
    // Signed in but not linked yet (link op not run / raced): fall back to the
    // device row so the write still lands somewhere sensible.
  }
  const player = await upsertPlayer(deviceHash)
  return { player, uid: auth?.uid ?? null }
}

/** Read a player's cloud-save rev (or -1 if none). */
export async function saveRevFor(playerId: string): Promise<number> {
  const cur = await sbFetch(`saves?player_id=eq.${encodeURIComponent(playerId)}&select=rev`)
  return Array.isArray(cur) && cur[0] ? Number(cur[0].rev) : -1
}

/** Read a player's cloud-save row (data + rev) or null. */
export async function saveRowFor(playerId: string): Promise<{ data: unknown; rev: number } | null> {
  const rows = await sbFetch(`saves?player_id=eq.${encodeURIComponent(playerId)}&select=data,rev`)
  const s = Array.isArray(rows) && rows[0] ? rows[0] : null
  return s ? { data: s.data ?? null, rev: Number(s.rev) || 0 } : null
}

/** Upsert a player's cloud save (last-write-wins is enforced by the caller). */
export async function putSaveRow(playerId: string, data: unknown, rev: number): Promise<void> {
  await sbFetch('saves?on_conflict=player_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ player_id: playerId, data, rev, updated_at: new Date().toISOString() }),
  })
}

/** Read JSON body from a Vercel/Node request (handles pre-parsed + stream). */
export async function readBody(req: any): Promise<any> {
  if (req.body && typeof req.body === 'object') return req.body
  if (typeof req.body === 'string' && req.body) {
    try { return JSON.parse(req.body) } catch { return {} }
  }
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(Buffer.from(c))
  const raw = Buffer.concat(chunks).toString('utf8')
  try { return raw ? JSON.parse(raw) : {} } catch { return {} }
}

export function cors(res: any): void {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}
