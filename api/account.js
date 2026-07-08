// server/_supabase.ts
var URL = process.env.GAME_SUPABASE_URL || process.env.VITE_GAME_SUPABASE_URL || "";
var SERVICE_KEY = process.env.GAME_SUPABASE_SERVICE_ROLE_KEY || "";
function serverConfigured() {
  return !!URL && !!SERVICE_KEY;
}
async function sbFetch(path, init = {}) {
  const res = await fetch(`${URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...init.headers || {}
    }
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`supabase ${res.status}: ${body.slice(0, 300)}`);
  }
  if (res.status === 204) return null;
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}
async function upsertPlayer(deviceHash, handle) {
  const body = { device_hash: deviceHash };
  if (handle) body.handle = handle;
  const rows = await sbFetch("players?on_conflict=device_hash", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(body)
  });
  return Array.isArray(rows) ? rows[0] : rows;
}
async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body) {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  const chunks = [];
  for await (const c of req) chunks.push(Buffer.from(c));
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// server/account.ts
async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, reason: "method" });
    return;
  }
  if (!serverConfigured()) {
    res.status(503).json({ ok: false, reason: "unconfigured" });
    return;
  }
  let body;
  try {
    body = await readBody(req);
  } catch {
    res.status(400).json({ ok: false });
    return;
  }
  const op = String(body?.op || "");
  const deviceHash = typeof body?.deviceHash === "string" ? body.deviceHash : "";
  if (!deviceHash || deviceHash.length < 16) {
    res.status(400).json({ ok: false, reason: "device" });
    return;
  }
  try {
    if (op === "register") {
      const handle = typeof body?.handle === "string" && body.handle.trim() ? body.handle.trim().slice(0, 24) : void 0;
      const player = await upsertPlayer(deviceHash, handle);
      res.status(200).json({ ok: true, id: player?.id, handle: player?.handle ?? null });
      return;
    }
    if (op === "save") {
      const data = body?.data;
      const rev = Number(body?.rev) || 0;
      if (data == null) {
        res.status(400).json({ ok: false, reason: "nodata" });
        return;
      }
      const player = await upsertPlayer(deviceHash);
      const cur = await sbFetch(`saves?player_id=eq.${player.id}&select=rev`);
      const curRev = Array.isArray(cur) && cur[0] ? Number(cur[0].rev) : -1;
      if (rev < curRev) {
        res.status(200).json({ ok: true, stored: false, rev: curRev });
        return;
      }
      await sbFetch("saves?on_conflict=player_id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify({ player_id: player.id, data, rev, updated_at: (/* @__PURE__ */ new Date()).toISOString() })
      });
      res.status(200).json({ ok: true, stored: true, rev });
      return;
    }
    if (op === "load") {
      const found = await sbFetch(`players?device_hash=eq.${encodeURIComponent(deviceHash)}&select=id,handle`);
      const player = Array.isArray(found) && found[0] ? found[0] : null;
      if (!player) {
        res.status(200).json({ ok: true, exists: false });
        return;
      }
      const rows = await sbFetch(`saves?player_id=eq.${player.id}&select=data,rev,updated_at`);
      const save = Array.isArray(rows) && rows[0] ? rows[0] : null;
      res.status(200).json({ ok: true, exists: true, handle: player.handle ?? null, data: save?.data ?? null, rev: save ? Number(save.rev) : -1 });
      return;
    }
    res.status(400).json({ ok: false, reason: "op" });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e).slice(0, 200) });
  }
}
export {
  handler as default
};
