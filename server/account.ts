// POST /api/account — anonymous device accounts + PORTABLE sign-in + cloud save.
//
// GUESTS are unchanged: every write is scoped to the caller's own device row
// (device_hash = SHA-256 of a secret the server never sees), so "players write
// only their own rows" holds even though the service role bypasses RLS.
//
// SIGN-IN is layered on top. The client sends its deviceHash + a Supabase Auth
// ACCESS TOKEN. We NEVER trust a client-supplied uid — the token is verified
// against GoTrue here (auth.getUser), and a signed-in caller is resolved to the
// DURABLE auth-anchored row so their handle / progress / cloud save / purchases
// are portable across every device they sign in on. No email/PHI is stored.
//
//  ops:
//   register            → get-or-create the player, optionally set handle
//   link {accessToken}  → link this device's row to the verified auth uid,
//                         MERGING better progress if the uid already has a row
//   save {data, rev}    → last-write-wins mirror of the local save
//   load                → fetch the cloud save (for reconcile on a fresh device)
//   health              → ops probe: is every table/column this API + verify-run
//                         depend on actually migrated on this project? (no auth)
//
// FAILURE CONTRACT: infra problems answer 502/503 with a STABLE `reason`
// (schema-drift | schema-missing | grant | network | upstream); 500 is reserved
// for genuine bugs. op:load additionally survives players.auth_uid drift for
// GUESTS (degraded fallback) so an unapplied auth migration can't kill cloud load.

import {
  serverConfigured, sbFetch, upsertPlayer, readBody, cors,
  verifyAuthToken, findPlayerByAuthUid, findPlayerByDevice, patchPlayer, createAuthPlayer,
  resolvePlayer, saveRevFor, saveRowFor, putSaveRow, SbError,
} from './_supabase'

// Map a thrown failure to an HTTP status + a STABLE machine reason so an
// infra/schema problem is diagnosable from the response (and distinguishable
// from a genuine server bug). Born of the 2026-07 incident where op:load
// 500ed for weeks with a flat string because players.auth_uid was unmigrated.
function failureFor(e: unknown): { status: number; reason: string } {
  if (e instanceof SbError) {
    if (e.code === '42703') return { status: 503, reason: 'schema-drift' } // column missing → unapplied migration
    if (e.code === '42P01') return { status: 503, reason: 'schema-missing' } // table missing → unprovisioned
    if (e.status === 401 || e.status === 403) return { status: 503, reason: 'grant' }
    return { status: 502, reason: 'upstream' }
  }
  if (e instanceof TypeError) return { status: 503, reason: 'network' } // fetch-level failure to reach Supabase
  return { status: 500, reason: 'internal' }
}

// One PostgREST probe per schema dependency this API (and verify-run) needs.
// Each returns 'ok' | 'missing-table' | 'missing-column' | 'error:<code>'.
async function probe(path: string): Promise<string> {
  try {
    await sbFetch(path)
    return 'ok'
  } catch (e) {
    if (e instanceof SbError) {
      if (e.code === '42P01') return 'missing-table'
      if (e.code === '42703') return 'missing-column'
      return `error:${e.code ?? e.status}`
    }
    return 'error:network'
  }
}

// op:'health' — the drift detector. Answers, in ONE unauthenticated call, the
// question that took weeks to see: is every table/column the account + ranked
// APIs query actually present on this project? Reads nothing sensitive (limit=1
// column probes under the service role; results are booleans about SCHEMA, not
// data) and writes nothing.
async function health(res: any): Promise<void> {
  const [players, playersAuthUid, saves, runs, runInputsRoute] = await Promise.all([
    probe('players?select=id&limit=1'),
    probe('players?select=auth_uid&limit=1'), // 0002_auth.sql applied?
    probe('saves?select=rev&limit=1'),
    probe('runs?select=id&limit=1'),
    probe('run_inputs?select=route&limit=1'), // 0003_pathforge.sql applied?
  ])
  const schema = { players, players_auth_uid: playersAuthUid, saves, runs, run_inputs_route: runInputsRoute }
  const ok = Object.values(schema).every((v) => v === 'ok')
  res.status(ok ? 200 : 503).json({ ok, configured: true, schema })
}

// A cheap "how much progress is here" score over the opaque save blob — MUST
// stay in sync with progressScore() in src/game/cloudSave.ts. Used so a merge
// keeps the account with the MOST progress (not merely the newest timestamp).
function progressScore(d: any): number {
  if (!d || typeof d !== 'object') return 0
  const n = (x: any) => Number(x) || 0
  return (
    Object.keys(d.firstClears || {}).length * 10 +
    n(d.endlessBest) +
    Math.floor(n(d.coins) / 100) +
    n(d.diamonds) +
    Object.keys(d.heroes || {}).length
  )
}

// Carry the LOSER's better bits into the SURVIVOR (the auth-anchored row). Row
// identity is invisible to the player, so we never branch on "which wins" — we
// always keep the auth row and copy the best of both into it.
async function mergeInto(survivor: any, loser: any): Promise<void> {
  const updates: Record<string, unknown> = {}
  if (!survivor.handle && loser.handle) updates.handle = loser.handle
  if (Object.keys(updates).length) { await patchPlayer(survivor.id, updates); survivor.handle = updates.handle }

  // cloud save: keep the save with MORE progress (ties broken by newer rev). The
  // survivor's rev is bumped to the max so a later last-write-wins push from the
  // lower-progress device can't immediately clobber the recovered account.
  const [sRow, lRow] = await Promise.all([saveRowFor(survivor.id), saveRowFor(loser.id)])
  if (lRow && lRow.data != null) {
    const sScore = sRow ? progressScore(sRow.data) : -1
    const lScore = progressScore(lRow.data)
    const loserWins = lScore > sScore || (lScore === sScore && lRow.rev > (sRow?.rev ?? -1))
    if (loserWins) await putSaveRow(survivor.id, lRow.data, Math.max(lRow.rev, sRow?.rev ?? 0))
  }

  // best runs: reassign the loser's runs to the survivor, keeping the better per
  // board. BEST-EFFORT and conflict-safe (the runs_best_per_period partial unique
  // index makes a naive re-point collide) — wrapped so it can NEVER fail the link.
  try { await mergeRuns(survivor.id, loser.id) } catch { /* leaderboard-only; never block the link */ }
}

async function mergeRuns(survId: string, loserId: string): Promise<void> {
  const loserRuns = await sbFetch(`runs?player_id=eq.${encodeURIComponent(loserId)}&select=id,mode,period,score`)
  if (!Array.isArray(loserRuns)) return
  for (const lr of loserRuns) {
    const q = `runs?player_id=eq.${encodeURIComponent(survId)}&mode=eq.${encodeURIComponent(lr.mode)}&period=eq.${lr.period}&select=id,score`
    const existing = await sbFetch(q)
    const sr = Array.isArray(existing) && existing[0] ? existing[0] : null
    if (!sr) {
      // survivor has no run on this board → move the loser's over (run_inputs ride along, same run_id)
      await sbFetch(`runs?id=eq.${lr.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ player_id: survId }) })
    } else if (Number(lr.score) > Number(sr.score)) {
      // loser's is better → drop the survivor's weaker row, then move the loser's in
      await sbFetch(`runs?id=eq.${sr.id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } })
      await sbFetch(`runs?id=eq.${lr.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ player_id: survId }) })
    } else {
      // survivor's is better or equal → discard the loser's duplicate
      await sbFetch(`runs?id=eq.${lr.id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } })
    }
  }
}

export default async function handler(req: any, res: any): Promise<void> {
  cors(res)
  if (req.method === 'OPTIONS') { res.status(204).end(); return }
  if (req.method !== 'POST') { res.status(405).json({ ok: false, reason: 'method' }); return }
  if (!serverConfigured()) { res.status(503).json({ ok: false, reason: 'unconfigured' }); return }

  let body: any
  try { body = await readBody(req) } catch { res.status(400).json({ ok: false }); return }
  const op = String(body?.op || '')
  // health needs no identity — it's the ops probe for schema drift.
  if (op === 'health') { await health(res); return }
  const deviceHash = typeof body?.deviceHash === 'string' ? body.deviceHash : ''
  const accessToken = typeof body?.accessToken === 'string' ? body.accessToken : undefined
  if (!deviceHash || deviceHash.length < 16) { res.status(400).json({ ok: false, reason: 'device' }); return }

  try {
    if (op === 'register') {
      const handle = typeof body?.handle === 'string' && body.handle.trim() ? body.handle.trim().slice(0, 24) : undefined
      // Signed in → the handle belongs on the durable auth row; guest → the device row.
      const { player } = await resolvePlayer(deviceHash, accessToken)
      if (handle && player?.id) {
        const upd = await patchPlayer(player.id, { handle })
        res.status(200).json({ ok: true, id: player.id, handle: upd?.handle ?? handle })
        return
      }
      res.status(200).json({ ok: true, id: player?.id, handle: player?.handle ?? null })
      return
    }

    if (op === 'link') {
      // 1) VERIFY the token server-side — the only source of a trusted uid.
      const auth = await verifyAuthToken(accessToken)
      if (!auth) { res.status(401).json({ ok: false, reason: 'auth' }); return }

      // 2) Ensure this device has its guest row, and find any existing row for the uid.
      const [deviceRow, authRow] = await Promise.all([
        upsertPlayer(deviceHash),
        findPlayerByAuthUid(auth.uid),
      ])

      // 3a) Already linked to this exact device row → nothing to do.
      if (authRow && deviceRow && authRow.id === deviceRow.id) {
        res.status(200).json({ ok: true, id: authRow.id, handle: authRow.handle ?? null, linked: true })
        return
      }

      // 3b) uid already has a row (another device) → MERGE this device's better
      //     progress into it and re-point identity to it. The device's guest row
      //     is left intact so sign-out falls back to guest (not a wipe).
      if (authRow) {
        await mergeInto(authRow, deviceRow)
        res.status(200).json({ ok: true, id: authRow.id, handle: authRow.handle ?? null, linked: true, merged: true })
        return
      }

      // 3c) uid has no row yet:
      if (!deviceRow?.auth_uid) {
        // the guest device row is unclaimed → ADOPT it (seamless guest→linked).
        const upd = await patchPlayer(deviceRow.id, { auth_uid: auth.uid })
        res.status(200).json({ ok: true, id: deviceRow.id, handle: upd?.handle ?? deviceRow.handle ?? null, linked: true, adopted: true })
        return
      }
      // the guest row already belongs to a DIFFERENT auth user → give this signer
      // their own pure-auth row on this device (resolved by uid from here on).
      const fresh = await createAuthPlayer(auth.uid)
      res.status(200).json({ ok: true, id: fresh?.id, handle: fresh?.handle ?? null, linked: true, created: true })
      return
    }

    if (op === 'save') {
      const data = body?.data
      const rev = Number(body?.rev) || 0
      if (data == null) { res.status(400).json({ ok: false, reason: 'nodata' }); return }
      const { player } = await resolvePlayer(deviceHash, accessToken)
      // last-write-wins: only overwrite if the incoming rev is newer
      const curRev = await saveRevFor(player.id)
      if (rev < curRev) { res.status(200).json({ ok: true, stored: false, rev: curRev }); return }
      await putSaveRow(player.id, data, rev)
      res.status(200).json({ ok: true, stored: true, rev })
      return
    }

    if (op === 'load') {
      // Read-only resolve: signed-in → auth row (portable across devices); guest →
      // device row. Never creates a row (a brand-new device correctly reports none).
      let player = null
      if (accessToken) {
        const auth = await verifyAuthToken(accessToken)
        if (auth) player = await findPlayerByAuthUid(auth.uid)
      }
      if (!player) player = await findPlayerByDevice(deviceHash)
      if (!player) { res.status(200).json({ ok: true, exists: false }); return }
      const save = await saveRowFor(player.id)
      res.status(200).json({
        ok: true, exists: true, handle: player.handle ?? null, data: save?.data ?? null, rev: save ? save.rev : -1,
        // guest lookup succeeded only via the drift fallback → tell ops (the
        // client ignores unknown fields) without failing the player.
        ...(player._schemaDrift ? { degraded: 'schema-drift' } : {}),
      })
      return
    }

    res.status(400).json({ ok: false, reason: 'op' })
  } catch (e: any) {
    const f = failureFor(e)
    res.status(f.status).json({ ok: false, reason: f.reason, error: String(e?.message || e).slice(0, 200) })
  }
}
