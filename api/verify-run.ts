// POST /api/verify-run — THE MOAT, server side. Receives a submitted ranked run
// record, RE-RUNS the pure sim from its seed + input log (the SAME src/sim the
// client ran, with zero renderer deps), and accepts the score onto the board
// ONLY if the replay reproduces the claimed score+wave under the current sim
// version. A cheater can submit any number; only a real run survives the re-run.
//
// Runs on Vercel's Node runtime (V8 === the browser's V8 === simcheck's V8), so
// the sim's float branches resolve identically and honest runs never false-reject.

import { verifyRun, logHash, type RankedRunRecord } from '../src/game/ranked'
import { serverConfigured, sbFetch, upsertPlayer, readBody, cors } from './_supabase'

export default async function handler(req: any, res: any): Promise<void> {
  cors(res)
  if (req.method === 'OPTIONS') { res.status(204).end(); return }
  if (req.method !== 'POST') { res.status(405).json({ ok: false, reason: 'method' }); return }
  if (!serverConfigured()) { res.status(503).json({ ok: false, reason: 'unconfigured' }); return }

  let body: any
  try { body = await readBody(req) } catch { res.status(400).json({ ok: false, reason: 'badbody' }); return }
  const rec = body?.record as RankedRunRecord | undefined
  const deviceHash = typeof body?.deviceHash === 'string' ? body.deviceHash : ''
  const handle = typeof body?.handle === 'string' ? body.handle.slice(0, 24) : undefined
  if (!rec || !deviceHash) { res.status(400).json({ ok: false, reason: 'missing' }); return }

  // 1) RE-RUN. This is the whole product: no trust, only replay.
  const v = verifyRun(rec)
  if (!v.ok) { res.status(200).json({ ok: false, reason: v.reason, score: v.score, wave: v.wave }); return }

  try {
    // 2) resolve the (anonymous, device-scoped) player
    const player = await upsertPlayer(deviceHash, handle)
    const playerId = player?.id
    const displayHandle = player?.handle || handle || null

    // 3) upsert the player's BEST row for this board period, keeping the higher
    //    score. Uses the server-verified numbers (v.score/v.wave), never the
    //    client's claim (they matched, but boarding the re-run value is the rule).
    const existing = await sbFetch(
      `runs?mode=eq.${encodeURIComponent(rec.mode)}&period=eq.${rec.period}&player_id=eq.${playerId}&select=id,score`,
    )
    const prev = Array.isArray(existing) && existing[0] ? existing[0] : null
    let runId = prev?.id as string | undefined
    const improved = !prev || v.score > Number(prev.score)

    if (improved) {
      const payload = {
        seed: rec.seed >>> 0, mode: rec.mode, period: rec.period,
        score: v.score, wave: v.wave, sim_version: rec.v,
        player_id: playerId, handle: displayHandle, replay_input_hash: logHash(rec),
      }
      // explicit update-or-insert (no on_conflict → robust against the partial
      // unique index): PATCH the player's existing best, else POST a fresh row.
      if (prev) {
        await sbFetch(`runs?id=eq.${prev.id}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify(payload),
        })
        runId = prev.id
      } else {
        const rows = await sbFetch('runs', {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify(payload),
        })
        runId = (Array.isArray(rows) ? rows[0]?.id : rows?.id) || runId
      }
      // 4) store the replay log (ghost source). run_id is the PK → on_conflict ok.
      if (runId) {
        await sbFetch('run_inputs?on_conflict=run_id', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates' },
          body: JSON.stringify({ run_id: runId, log: rec.log, party: rec.party }),
        })
      }
    }

    // 5) compute the player's rank on this board (1-indexed, higher score wins)
    const better = await sbFetch(
      `runs?mode=eq.${encodeURIComponent(rec.mode)}&period=eq.${rec.period}&score=gt.${v.score}&select=id`,
    )
    const rank = (Array.isArray(better) ? better.length : 0) + 1

    res.status(200).json({ ok: true, score: v.score, wave: v.wave, rank, improved, runId, handle: displayHandle })
  } catch (e: any) {
    res.status(200).json({ ok: true, verified: true, boarded: false, score: v.score, wave: v.wave, error: String(e?.message || e).slice(0, 200) })
  }
}
