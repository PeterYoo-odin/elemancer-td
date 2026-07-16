// SHARED-DEVICE SIGN-OUT BLEED CHECK — unit proof for chromancer #61.
//
// The finding (chromancer-logon-recon.md §3, MODERATE): op:link's adopt path
// anchors auth_uid on the DEVICE'S OWN guest row; signOut() used to leave the
// device secret (and therefore device_hash) untouched, so the next guest on
// the same browser resolved straight into the signed-out account via op:load's
// device-hash fallback. The fix: signOut() now rotates the local device secret
// (rotateDeviceSecret() in rankedNet.ts), so the next guest on this browser
// derives a brand-new device_hash.
//
// This exercises the REAL production code on both sides of the fix:
//   - client: src/game/rankedNet.ts (deviceHash/rotateDeviceSecret),
//             src/game/authNet.ts (signOut)
//   - server: server/account.ts (the op:link merge/adopt logic — UNCHANGED,
//             just proven against a rotated device_hash for the first time)
// against an in-memory fake of Supabase PostgREST + GoTrue (no network).
//
//   run:  npx tsx scripts/devicecheck.ts

let failures = 0
function check(cond: boolean, msg: string): void {
  console.log(`  ${cond ? '✓' : '✗'} ${msg}`)
  if (!cond) failures++
}

// ---------------------------------------------------------------------------
// Minimal browser-global shims. This code normally runs in a browser; tsx runs
// it in plain Node, which has neither `localStorage` nor a Vite-injected
// `import.meta.env`. rankedNet.ts/authNet.ts already guard `import.meta.env`
// with `?.` for exactly this reason (Vite always defines it at build time —
// this only matters for a non-Vite runtime like this test).
// ---------------------------------------------------------------------------
class MemoryStorage {
  private m = new Map<string, string>()
  getItem(k: string): string | null { return this.m.has(k) ? this.m.get(k)! : null }
  setItem(k: string, v: string): void { this.m.set(k, v) }
  removeItem(k: string): void { this.m.delete(k) }
}
;(globalThis as any).localStorage = new MemoryStorage()

// ---------------------------------------------------------------------------
// In-memory fake of the DEDICATED game Supabase project — just enough
// PostgREST + GoTrue surface for server/_supabase.ts's helper functions.
// ---------------------------------------------------------------------------
type FakePlayer = { id: string; device_hash: string | null; handle: string | null; auth_uid: string | null }
type FakeSave = { player_id: string; data: unknown; rev: number }

const FAKE_URL = 'https://fake-project.supabase.test'
let players: FakePlayer[] = []
let saves: FakeSave[] = []
let nextId = 1
const TOKEN_USERS: Record<string, { id: string; email: string }> = {}

function qval(params: URLSearchParams, key: string): string | null {
  const raw = params.get(key)
  return raw ? raw.replace(/^eq\./, '') : null
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

async function fakeFetch(input: any, init: any = {}): Promise<Response> {
  const url = new URL(String(input))
  const method = (init.method || 'GET').toUpperCase()
  const headers = init.headers || {}

  if (url.pathname === '/auth/v1/user') {
    const auth = String(headers.Authorization || '')
    const token = auth.replace(/^Bearer\s+/, '')
    const user = TOKEN_USERS[token]
    if (!user) return json({ msg: 'invalid token' }, 401)
    return json(user, 200)
  }

  if (url.pathname === '/rest/v1/players') {
    if (method === 'GET') {
      let rows = players
      const dh = qval(url.searchParams, 'device_hash')
      const au = qval(url.searchParams, 'auth_uid')
      const id = qval(url.searchParams, 'id')
      if (dh !== null) rows = rows.filter((p) => p.device_hash === dh)
      if (au !== null) rows = rows.filter((p) => p.auth_uid === au)
      if (id !== null) rows = rows.filter((p) => p.id === id)
      return json(rows)
    }
    if (method === 'POST') {
      const body = JSON.parse(init.body || '{}')
      if (url.searchParams.get('on_conflict') === 'device_hash') {
        let row = players.find((p) => p.device_hash === body.device_hash)
        if (!row) {
          row = { id: String(nextId++), device_hash: body.device_hash, handle: body.handle ?? null, auth_uid: null }
          players.push(row)
        } else if (body.handle) {
          row.handle = body.handle
        }
        return json([row])
      }
      // createAuthPlayer — plain insert, no device_hash
      const row: FakePlayer = { id: String(nextId++), device_hash: null, handle: body.handle ?? null, auth_uid: body.auth_uid ?? null }
      players.push(row)
      return json([row])
    }
    if (method === 'PATCH') {
      const id = qval(url.searchParams, 'id')
      const row = players.find((p) => p.id === id)
      if (row) Object.assign(row, JSON.parse(init.body || '{}'))
      return json(row ? [row] : [])
    }
  }

  if (url.pathname === '/rest/v1/saves') {
    if (method === 'GET') {
      const pid = qval(url.searchParams, 'player_id')
      const row = saves.find((s) => s.player_id === pid)
      return json(row ? [row] : [])
    }
    if (method === 'POST') {
      const body = JSON.parse(init.body || '{}')
      let row = saves.find((s) => s.player_id === body.player_id)
      if (!row) { row = { player_id: body.player_id, data: body.data, rev: body.rev }; saves.push(row) }
      else { row.data = body.data; row.rev = body.rev }
      return new Response(null, { status: 204 })
    }
  }

  if (url.pathname === '/rest/v1/runs') {
    if (method === 'GET') return json([]) // no runs to merge — not under test here
    return new Response(null, { status: 204 })
  }

  return json({ error: `fake backend: unhandled ${method} ${url.pathname}` }, 404)
}

function makeRes() {
  return {
    statusCode: 200,
    body: undefined as any,
    setHeader() { /* cors() calls this — no-op fake */ },
    status(code: number) { this.statusCode = code; return this },
    json(obj: any) { this.body = obj; return this },
    end() { return this },
  }
}
function makeReq(body: any) {
  return { method: 'POST', headers: {}, body }
}

async function main(): Promise<void> {
  process.env.GAME_SUPABASE_URL = FAKE_URL
  process.env.GAME_SUPABASE_SERVICE_ROLE_KEY = 'fake-service-role-key'
  ;(globalThis as any).fetch = fakeFetch

  const { deviceHash: getDeviceHash, rotateDeviceSecret } = await import('../src/game/rankedNet')
  const { signOut } = await import('../src/game/authNet')
  const accountHandler = (await import('../server/account')).default

  const U = '11111111-1111-4111-8111-111111111111'
  const TOKEN_U = 'aaaaaaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbb.cccccccccccccccccccc'
  TOKEN_USERS[TOKEN_U] = { id: U, email: 'u@example.com' }

  // -------------------------------------------------------------------------
  // (a) rotation actually changes the device_hash, and is stable in between.
  // -------------------------------------------------------------------------
  console.log('device-hash rotation…')
  const H1 = await getDeviceHash()
  const H1again = await getDeviceHash()
  check(H1 === H1again, 'deviceHash() is stable across calls before any rotation (cached)')
  check(/^[0-9a-f]{64}$/.test(H1), 'deviceHash() is a 64-char SHA-256 hex digest, not the raw secret')

  rotateDeviceSecret()
  const H2 = await getDeviceHash()
  check(H2 !== H1, 'rotateDeviceSecret() changes the device_hash')
  const H2again = await getDeviceHash()
  check(H2 === H2again, 'the NEW device_hash is stable again after rotation (re-cached)')

  // -------------------------------------------------------------------------
  // Set up "before": U played as a guest on device H1, then signed in — the
  // exact adopt trace from the recon (account.ts:199-203 / op:link case 3c).
  // -------------------------------------------------------------------------
  console.log('seeding pre-fix state (guest H1 plays, then signs in)…')
  {
    const res = makeRes()
    await accountHandler(makeReq({ op: 'register', deviceHash: H1, handle: 'Wizard' }), res)
    check(res.body?.ok === true && res.body?.handle === 'Wizard', 'guest registers a handle on device H1')
  }
  {
    const res = makeRes()
    await accountHandler(makeReq({ op: 'save', deviceHash: H1, data: { coins: 500, diamonds: 3 }, rev: 1 }), res)
    check(res.body?.ok === true && res.body?.stored === true, 'guest saves progress on device H1')
  }
  let originalId: string
  {
    const res = makeRes()
    await accountHandler(makeReq({ op: 'link', deviceHash: H1, accessToken: TOKEN_U }), res)
    check(res.body?.ok === true && res.body?.adopted === true, 'op:link ADOPTS the guest row on H1 (auth_uid=U set on the H1 row)')
    originalId = res.body?.id
  }
  const rowH1 = players.find((p) => p.device_hash === H1)!
  check(rowH1.auth_uid === U, "the H1 row is now BOTH device-anchored (H1) and auth-anchored (U) — the recon's precondition")

  // -------------------------------------------------------------------------
  // Simulate signOut(): clears the session AND rotates the device secret.
  // The already-rotated H2 (from the rotation check above) is what the browser
  // now carries — mirroring "rotate on sign-out, guest continues on H2".
  // -------------------------------------------------------------------------
  console.log('signOut() rotates…')
  const beforeSignOut = await getDeviceHash()
  await signOut()
  const afterSignOut = await getDeviceHash()
  check(afterSignOut !== beforeSignOut, 'signOut() itself rotates the device_hash (not just a manual rotateDeviceSecret() call)')
  const H3 = afterSignOut // the hash the browser now carries as a guest

  // -------------------------------------------------------------------------
  // (a, continued) THE BLEED IS CLOSED: a fresh guest reload on this browser
  // (op:load, no token) must NOT resolve to U's account.
  // -------------------------------------------------------------------------
  console.log('post-sign-out guest load…')
  {
    const res = makeRes()
    await accountHandler(makeReq({ op: 'load', deviceHash: H3 }), res)
    check(res.body?.ok === true && res.body?.exists === false, 'guest reload on the ROTATED device_hash finds NO account — bleed closed')
  }
  {
    // Sanity check on the OLD mechanism: querying by the stale H1 hash still
    // finds U's row (nobody besides U's browser ever had H1 — this just proves
    // the row itself was never touched/wiped by the rotation).
    const res = makeRes()
    await accountHandler(makeReq({ op: 'load', deviceHash: H1 }), res)
    check(res.body?.exists === true && res.body?.data?.coins === 500, "U's row is untouched server-side under its original device_hash — rotation is not a wipe")
  }

  // -------------------------------------------------------------------------
  // (b) THE CRITICAL PROOF: U signs back in on the now-fresh device (H3) and
  // must land on the SAME auth-anchored row, with save + handle intact, and
  // no duplicate auth-anchored row. This exercises server/account.ts's
  // EXISTING merge path (case 3b: "uid already has a row on another device")
  // — a path the recon flagged as UNVERIFIED in production (0/139 linked).
  // -------------------------------------------------------------------------
  console.log('re-sign-in after rotation…')
  {
    const res = makeRes()
    await accountHandler(makeReq({ op: 'link', deviceHash: H3, accessToken: TOKEN_U }), res)
    check(res.body?.ok === true && res.body?.linked === true, 're-sign-in on the rotated device links successfully')
    check(res.body?.merged === true, 'resolved via the MERGE path (uid already anchored elsewhere), not a fresh adopt/create')
    check(res.body?.id === originalId, 're-sign-in returns the SAME player row id as before rotation — not a new/duplicate account')
    check(res.body?.handle === 'Wizard', "the original handle is intact after re-linking")
  }

  const authRows = players.filter((p) => p.auth_uid === U)
  check(authRows.length === 1, 'exactly ONE player row is anchored to auth_uid=U after re-sign-in (no duplicate auth-linked account)')
  check(authRows[0]?.id === originalId, 'that one auth-anchored row is the original row')

  {
    const res = makeRes()
    await accountHandler(makeReq({ op: 'load', deviceHash: H3, accessToken: TOKEN_U }), res)
    check(res.body?.exists === true, "U's account loads via the signed-in path post-rotation")
    check(res.body?.data?.coins === 500 && res.body?.data?.diamonds === 3, 'the ORIGINAL cloud save survived the rotate → re-sign-in round trip untouched')
    check(res.body?.rev === 1, 'save revision is unchanged (the merge did not overwrite it with the empty new-guest row)')
  }

  // -------------------------------------------------------------------------
  // (c) the device secret is NEVER transmitted — only its SHA-256 hash. Proven
  // structurally (a real request from the client code) rather than just by
  // reading the source: intercept an actual outbound /api/account call and
  // check every field that goes over the wire.
  // -------------------------------------------------------------------------
  console.log('device secret never transmitted…')
  const seenBodies: any[] = []
  ;(globalThis as any).fetch = async (input: any, init: any = {}) => {
    if (String(input) === '/api/account') {
      const parsed = JSON.parse(init.body || '{}')
      seenBodies.push(parsed)
      return json({ ok: true, id: 'x', handle: parsed.handle ?? null })
    }
    return fakeFetch(input, init)
  }
  const { registerHandle } = await import('../src/game/rankedNet')
  await registerHandle('ShieldMaiden')
  check(seenBodies.length === 1, 'registerHandle() made exactly one /api/account call')
  const wireBody = seenBodies[0] || {}
  const allowedKeys = new Set(['op', 'deviceHash', 'handle', 'accessToken'])
  check(Object.keys(wireBody).every((k) => allowedKeys.has(k)), 'no unexpected field (e.g. a raw secret) is present in the wire payload')
  check(typeof wireBody.deviceHash === 'string' && /^[0-9a-f]{64}$/.test(wireBody.deviceHash), 'the transmitted `deviceHash` is a 64-char SHA-256 hex digest')
  check(wireBody.deviceHash === H3, 'the transmitted hash matches the current (post-rotation) deviceHash() value — the client and wire agree')
  check(wireBody.deviceHash.length !== 32, 'transmitted value is NOT the raw 16-byte/32-hex-char device secret format')

  if (failures) {
    console.log(`\n${failures} check(s) FAILED`)
    process.exit(1)
  }
  console.log('\nAll shared-device sign-out checks passed.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
