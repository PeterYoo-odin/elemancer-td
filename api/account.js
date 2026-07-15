// server/_supabase.ts
var URL = process.env.GAME_SUPABASE_URL || process.env.VITE_GAME_SUPABASE_URL || "";
var SERVICE_KEY = process.env.GAME_SUPABASE_SERVICE_ROLE_KEY || "";
function serverConfigured() {
  return !!URL && !!SERVICE_KEY;
}
var SbError = class extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "SbError";
    this.status = status;
    this.code = code;
  }
};
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
    let code = null;
    try {
      code = JSON.parse(body)?.code ?? null;
    } catch {
    }
    throw new SbError(res.status, code, `supabase ${res.status}: ${body.slice(0, 300)}`);
  }
  if (res.status === 204) return null;
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}
function isSchemaDrift(e) {
  return e instanceof SbError && (e.code === "42703" || e.code === "42P01");
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
var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function looksLikeJwt(token) {
  return typeof token === "string" && token.length >= 20 && token.length <= 4096 && token.split(".").length === 3;
}
async function verifyAuthToken(accessToken) {
  if (!looksLikeJwt(accessToken)) return null;
  try {
    const res = await fetch(`${URL}/auth/v1/user`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${accessToken}` }
    });
    if (!res.ok) return null;
    const user = await res.json().catch(() => null);
    const uid = user?.id;
    if (typeof uid !== "string" || !UUID_RE.test(uid)) return null;
    return { uid, email: typeof user?.email === "string" ? user.email : null };
  } catch {
    return null;
  }
}
async function findPlayerByAuthUid(uid) {
  if (!UUID_RE.test(uid)) return null;
  const rows = await sbFetch(`players?auth_uid=eq.${uid}&select=id,handle,auth_uid,device_hash`);
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}
async function findPlayerByDevice(deviceHash) {
  try {
    const rows = await sbFetch(`players?device_hash=eq.${encodeURIComponent(deviceHash)}&select=id,handle,auth_uid,device_hash`);
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  } catch (e) {
    if (!isSchemaDrift(e)) throw e;
    const rows = await sbFetch(`players?device_hash=eq.${encodeURIComponent(deviceHash)}&select=id,handle,device_hash`);
    const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
    return row ? { ...row, auth_uid: null, _schemaDrift: true } : null;
  }
}
async function patchPlayer(id, fields) {
  const rows = await sbFetch(`players?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(fields)
  });
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}
async function createAuthPlayer(uid, handle) {
  const body = { auth_uid: uid };
  if (handle) body.handle = handle;
  const rows = await sbFetch("players", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(body)
  });
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}
async function resolvePlayer(deviceHash, accessToken) {
  const auth = await verifyAuthToken(accessToken);
  if (auth) {
    const byUid = await findPlayerByAuthUid(auth.uid);
    if (byUid) return { player: byUid, uid: auth.uid };
  }
  const player = await upsertPlayer(deviceHash);
  return { player, uid: auth?.uid ?? null };
}
async function saveRevFor(playerId) {
  const cur = await sbFetch(`saves?player_id=eq.${encodeURIComponent(playerId)}&select=rev`);
  return Array.isArray(cur) && cur[0] ? Number(cur[0].rev) : -1;
}
async function saveRowFor(playerId) {
  const rows = await sbFetch(`saves?player_id=eq.${encodeURIComponent(playerId)}&select=data,rev`);
  const s = Array.isArray(rows) && rows[0] ? rows[0] : null;
  return s ? { data: s.data ?? null, rev: Number(s.rev) || 0 } : null;
}
async function putSaveRow(playerId, data, rev) {
  await sbFetch("saves?on_conflict=player_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ player_id: playerId, data, rev, updated_at: (/* @__PURE__ */ new Date()).toISOString() })
  });
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
function failureFor(e) {
  if (e instanceof SbError) {
    if (e.code === "42703") return { status: 503, reason: "schema-drift" };
    if (e.code === "42P01") return { status: 503, reason: "schema-missing" };
    if (e.status === 401 || e.status === 403) return { status: 503, reason: "grant" };
    return { status: 502, reason: "upstream" };
  }
  if (e instanceof TypeError) return { status: 503, reason: "network" };
  return { status: 500, reason: "internal" };
}
async function probe(path) {
  try {
    await sbFetch(path);
    return "ok";
  } catch (e) {
    if (e instanceof SbError) {
      if (e.code === "42P01") return "missing-table";
      if (e.code === "42703") return "missing-column";
      return `error:${e.code ?? e.status}`;
    }
    return "error:network";
  }
}
async function health(res) {
  const [players, playersAuthUid, saves, runs, runInputsRoute] = await Promise.all([
    probe("players?select=id&limit=1"),
    probe("players?select=auth_uid&limit=1"),
    // 0002_auth.sql applied?
    probe("saves?select=rev&limit=1"),
    probe("runs?select=id&limit=1"),
    probe("run_inputs?select=route&limit=1")
    // 0003_pathforge.sql applied?
  ]);
  const schema = { players, players_auth_uid: playersAuthUid, saves, runs, run_inputs_route: runInputsRoute };
  const ok = Object.values(schema).every((v) => v === "ok");
  res.status(ok ? 200 : 503).json({ ok, configured: true, schema });
}
function progressScore(d) {
  if (!d || typeof d !== "object") return 0;
  const n = (x) => Number(x) || 0;
  return Object.keys(d.firstClears || {}).length * 10 + n(d.endlessBest) + Math.floor(n(d.coins) / 100) + n(d.diamonds) + Object.keys(d.heroes || {}).length;
}
async function mergeInto(survivor, loser) {
  const updates = {};
  if (!survivor.handle && loser.handle) updates.handle = loser.handle;
  if (Object.keys(updates).length) {
    await patchPlayer(survivor.id, updates);
    survivor.handle = updates.handle;
  }
  const [sRow, lRow] = await Promise.all([saveRowFor(survivor.id), saveRowFor(loser.id)]);
  if (lRow && lRow.data != null) {
    const sScore = sRow ? progressScore(sRow.data) : -1;
    const lScore = progressScore(lRow.data);
    const loserWins = lScore > sScore || lScore === sScore && lRow.rev > (sRow?.rev ?? -1);
    if (loserWins) await putSaveRow(survivor.id, lRow.data, Math.max(lRow.rev, sRow?.rev ?? 0));
  }
  try {
    await mergeRuns(survivor.id, loser.id);
  } catch {
  }
}
async function mergeRuns(survId, loserId) {
  const loserRuns = await sbFetch(`runs?player_id=eq.${encodeURIComponent(loserId)}&select=id,mode,period,score`);
  if (!Array.isArray(loserRuns)) return;
  for (const lr of loserRuns) {
    const q = `runs?player_id=eq.${encodeURIComponent(survId)}&mode=eq.${encodeURIComponent(lr.mode)}&period=eq.${lr.period}&select=id,score`;
    const existing = await sbFetch(q);
    const sr = Array.isArray(existing) && existing[0] ? existing[0] : null;
    if (!sr) {
      await sbFetch(`runs?id=eq.${lr.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ player_id: survId }) });
    } else if (Number(lr.score) > Number(sr.score)) {
      await sbFetch(`runs?id=eq.${sr.id}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
      await sbFetch(`runs?id=eq.${lr.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ player_id: survId }) });
    } else {
      await sbFetch(`runs?id=eq.${lr.id}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
    }
  }
}
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
  if (op === "health") {
    await health(res);
    return;
  }
  const deviceHash = typeof body?.deviceHash === "string" ? body.deviceHash : "";
  const accessToken = typeof body?.accessToken === "string" ? body.accessToken : void 0;
  if (!deviceHash || deviceHash.length < 16) {
    res.status(400).json({ ok: false, reason: "device" });
    return;
  }
  try {
    if (op === "register") {
      const handle = typeof body?.handle === "string" && body.handle.trim() ? body.handle.trim().slice(0, 24) : void 0;
      const { player } = await resolvePlayer(deviceHash, accessToken);
      if (handle && player?.id) {
        const upd = await patchPlayer(player.id, { handle });
        res.status(200).json({ ok: true, id: player.id, handle: upd?.handle ?? handle });
        return;
      }
      res.status(200).json({ ok: true, id: player?.id, handle: player?.handle ?? null });
      return;
    }
    if (op === "link") {
      const auth = await verifyAuthToken(accessToken);
      if (!auth) {
        res.status(401).json({ ok: false, reason: "auth" });
        return;
      }
      const [deviceRow, authRow] = await Promise.all([
        upsertPlayer(deviceHash),
        findPlayerByAuthUid(auth.uid)
      ]);
      if (authRow && deviceRow && authRow.id === deviceRow.id) {
        res.status(200).json({ ok: true, id: authRow.id, handle: authRow.handle ?? null, linked: true });
        return;
      }
      if (authRow) {
        await mergeInto(authRow, deviceRow);
        res.status(200).json({ ok: true, id: authRow.id, handle: authRow.handle ?? null, linked: true, merged: true });
        return;
      }
      if (!deviceRow?.auth_uid) {
        const upd = await patchPlayer(deviceRow.id, { auth_uid: auth.uid });
        res.status(200).json({ ok: true, id: deviceRow.id, handle: upd?.handle ?? deviceRow.handle ?? null, linked: true, adopted: true });
        return;
      }
      const fresh = await createAuthPlayer(auth.uid);
      res.status(200).json({ ok: true, id: fresh?.id, handle: fresh?.handle ?? null, linked: true, created: true });
      return;
    }
    if (op === "save") {
      const data = body?.data;
      const rev = Number(body?.rev) || 0;
      if (data == null) {
        res.status(400).json({ ok: false, reason: "nodata" });
        return;
      }
      const { player } = await resolvePlayer(deviceHash, accessToken);
      const curRev = await saveRevFor(player.id);
      if (rev < curRev) {
        res.status(200).json({ ok: true, stored: false, rev: curRev });
        return;
      }
      await putSaveRow(player.id, data, rev);
      res.status(200).json({ ok: true, stored: true, rev });
      return;
    }
    if (op === "load") {
      let player = null;
      if (accessToken) {
        const auth = await verifyAuthToken(accessToken);
        if (auth) player = await findPlayerByAuthUid(auth.uid);
      }
      if (!player) player = await findPlayerByDevice(deviceHash);
      if (!player) {
        res.status(200).json({ ok: true, exists: false });
        return;
      }
      const save = await saveRowFor(player.id);
      res.status(200).json({
        ok: true,
        exists: true,
        handle: player.handle ?? null,
        data: save?.data ?? null,
        rev: save ? save.rev : -1,
        // guest lookup succeeded only via the drift fallback → tell ops (the
        // client ignores unknown fields) without failing the player.
        ...player._schemaDrift ? { degraded: "schema-drift" } : {}
      });
      return;
    }
    res.status(400).json({ ok: false, reason: "op" });
  } catch (e) {
    const f = failureFor(e);
    res.status(f.status).json({ ok: false, reason: f.reason, error: String(e?.message || e).slice(0, 200) });
  }
}
export {
  handler as default
};
