// POST /api/account — lightweight anonymous accounts + cloud save. Every write is
// scoped to the caller's own device row (identified by device_hash = SHA-256 of a
// secret the server never sees), so "players write only their own rows" holds even
// though the service role bypasses RLS. No email, no PHI — just a recoverable
// device identity, an upgradable handle, and a mirror of the local save.
//
//  ops:
//   register           → get-or-create the player, optionally set handle
//   save {data, rev}   → last-write-wins mirror of the local save
//   load               → fetch the cloud save (for reconcile on a fresh device)

import { serverConfigured, sbFetch, upsertPlayer, readBody, cors } from './_supabase'

export default async function handler(req: any, res: any): Promise<void> {
  cors(res)
  if (req.method === 'OPTIONS') { res.status(204).end(); return }
  if (req.method !== 'POST') { res.status(405).json({ ok: false, reason: 'method' }); return }
  if (!serverConfigured()) { res.status(503).json({ ok: false, reason: 'unconfigured' }); return }

  let body: any
  try { body = await readBody(req) } catch { res.status(400).json({ ok: false }); return }
  const op = String(body?.op || '')
  const deviceHash = typeof body?.deviceHash === 'string' ? body.deviceHash : ''
  if (!deviceHash || deviceHash.length < 16) { res.status(400).json({ ok: false, reason: 'device' }); return }

  try {
    if (op === 'register') {
      const handle = typeof body?.handle === 'string' && body.handle.trim() ? body.handle.trim().slice(0, 24) : undefined
      const player = await upsertPlayer(deviceHash, handle)
      res.status(200).json({ ok: true, id: player?.id, handle: player?.handle ?? null })
      return
    }

    if (op === 'save') {
      const data = body?.data
      const rev = Number(body?.rev) || 0
      if (data == null) { res.status(400).json({ ok: false, reason: 'nodata' }); return }
      const player = await upsertPlayer(deviceHash)
      // last-write-wins: only overwrite if the incoming rev is newer
      const cur = await sbFetch(`saves?player_id=eq.${player.id}&select=rev`)
      const curRev = Array.isArray(cur) && cur[0] ? Number(cur[0].rev) : -1
      if (rev < curRev) { res.status(200).json({ ok: true, stored: false, rev: curRev }); return }
      await sbFetch('saves?on_conflict=player_id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({ player_id: player.id, data, rev, updated_at: new Date().toISOString() }),
      })
      res.status(200).json({ ok: true, stored: true, rev })
      return
    }

    if (op === 'load') {
      const found = await sbFetch(`players?device_hash=eq.${encodeURIComponent(deviceHash)}&select=id,handle`)
      const player = Array.isArray(found) && found[0] ? found[0] : null
      if (!player) { res.status(200).json({ ok: true, exists: false }); return }
      const rows = await sbFetch(`saves?player_id=eq.${player.id}&select=data,rev,updated_at`)
      const save = Array.isArray(rows) && rows[0] ? rows[0] : null
      res.status(200).json({ ok: true, exists: true, handle: player.handle ?? null, data: save?.data ?? null, rev: save ? Number(save.rev) : -1 })
      return
    }

    res.status(400).json({ ok: false, reason: 'op' })
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message || e).slice(0, 200) })
  }
}
