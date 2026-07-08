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
