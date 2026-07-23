// ============================================================================
// JUICECHECK — real-browser proof of the battle FEEL layer.
// ============================================================================
// simcheck proves the SIM; qa-hub-check proves the telemetry hub's math;
// qa-wave-proof proves wave progression at the sim level. This script closes
// the loop the E2E report (2026-07-08) could never close: it drives the REAL
// render+view loop (BattleScene.update → BattleView3D.render) in a REAL
// Chromium through the shipped QA drive (`window.__chromancer`, ?qa=1) with a
// DETERMINISTIC fixed-dt clock — so headless rAF throttling (the 100–950 ms
// frame gaps that sank blind-tap testing) cannot corrupt the measurements.
//
// What it asserts (the previously "UNVERIFIED" crux):
//   1. WAVE PROGRESSION in the real loop — the counter leaves 1/N, waves
//      advance prep→wave→prep, and BOTH end screens (won + lost) are reachable.
//   2. HITSTOP — every realized freeze-frame span lands in a sane 30–140 ms
//      window and at least one lands in the designed 40–90 ms band (1× speed).
//   3. ALL 9 REACTIONS fire with their full juice chain (burst + callout +
//      shake + sound + hitstop telemetry).
//   4. COMBO events flow during real combat (milestones reported, soft).
//   5. BOARD TEXTURES — the painted realm ground + path PNGs actually bind
//      (the silent-fallback trap: a 404 must not quietly ship the kit atlas).
//   6. Zero uncaught page errors across the whole drive.
//
// Prereqs: `npm run build` (serves ./dist via `vite preview`), plus a local
// Chrome/Chromium (env JUICE_CHROME, /usr/bin/google-chrome, or a Playwright
// browser cache). Run:  npm run juicecheck
//
// NOTE (honest scope): this proves the juice EXISTS, FIRES and is TIMED right.
// Whether 60 ms of freeze + this shake amplitude FEELS premium on a phone in
// the hand still needs a human on a real device — see the QA overlay knobs.
// ============================================================================

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'
import { chromium } from 'playwright-core'

const PORT = 4317
const ROOT = process.cwd()

let failures = 0
let warnings = 0
function pass(msg: string): void { console.log(`  ✓ ${msg}`) }
function fail(msg: string): void { console.log(`  ✗ ${msg}`); failures++ }
function warn(msg: string): void { console.log(`  ⚠ ${msg}`); warnings++ }
function check(cond: boolean, msg: string): void { cond ? pass(msg) : fail(msg) }

function findChrome(): string {
  const cands = [
    process.env.JUICE_CHROME ?? '',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean)
  for (const c of cands) if (existsSync(c)) return c
  // Playwright browser cache (chromium or headless shell), any version.
  const pwRoot = join(os.homedir(), '.cache', 'ms-playwright')
  if (existsSync(pwRoot)) {
    for (const dir of readdirSync(pwRoot)) {
      if (!/^chromium/.test(dir)) continue
      for (const bin of ['chrome-linux/chrome', 'chrome-linux/headless_shell']) {
        const p = join(pwRoot, dir, bin)
        if (existsSync(p)) return p
      }
    }
  }
  throw new Error('no Chrome/Chromium found — set JUICE_CHROME=/path/to/chrome')
}

function startPreview(): Promise<ChildProcess> {
  if (!existsSync(join(ROOT, 'dist', 'index.html'))) {
    throw new Error('dist/index.html missing — run `npm run build` first')
  }
  return new Promise((resolve, reject) => {
    const proc = spawn('node', ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], {
      cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    })
    let up = false
    const onData = (b: Buffer) => {
      if (!up && b.toString().includes(String(PORT))) { up = true; resolve(proc) }
    }
    proc.stdout.on('data', onData)
    proc.stderr.on('data', onData)
    proc.on('exit', (code) => { if (!up) reject(new Error(`vite preview exited early (code ${code})`)) })
    setTimeout(() => { if (!up) reject(new Error('vite preview did not come up in 15s')) }, 15_000)
  })
}

// The 9 reaction keys (src/sim/reactions.ts REACTIONS) — qaReactionKey accepts keys.
const REACTION_KEYS = ['thermal', 'shatter', 'flashover', 'wildfire', 'overgrow', 'eclipse', 'conduct', 'blight', 'amplify']

// ---------------------------------------------------------------------------
// D3 — VISUAL REGRESSION GATE. The check whose ABSENCE let four "it looks the
// same" rounds ship green: it screenshots the composited canvas (CSS greying
// filter BAKED IN — a raw canvas read bypasses it and would measure the art at
// full chroma, defeating the point), downsamples to 64×64, converts to HSV and
// asserts the painted world reaches the eye VIVID at the wave-1 colour floor,
// then that the Greying arc actually RAISES saturation by the finale.
//
// Per-realm modal-hue targets (degrees), CALIBRATED post-D1 to the MEASURED mode
// of the composited board's lit/saturated pixels. NB: these are the painted
// ground/backdrop's real on-screen hue, which is what reaches the eye — not the
// raw PAL tint (PAL colours the rock/fallback; the painted PNG carries the real
// play-surface albedo). Emberwaste measures 25° (matches PAL's rust-orange);
// verdantwilds measures ~65° — the painted ground is a warm OLIVE-green, not PAL's
// 120° pure green. Only emberwaste + verdantwilds are asserted (the two D3 levels);
// the rest are documented references for when future realms are added to D3.
const REALM_HUE: Record<string, number> = {
  emberwaste: 25, verdantwilds: 65, frostreach: 200, stormpeaks: 255, radiantsanctum: 48, umbralvoid: 285,
}
// Per-realm WAVE-1 median-saturation floors, calibrated by SANDWICH: measured at
// the shipped 0.80 colour floor vs the old 0.45 regression floor, then set BETWEEN
// them with margin so the shipped build PASSES and a drop back to 0.45 FAILS (red).
//   emberwaste:   shipped 0.670 · regression 0.450 → 0.56
//   verdantwilds: shipped 0.314 · regression 0.180 → 0.25  (its olive ground + more
//                 visible void is inherently less saturated than ember's — a single
//                 global floor can't discriminate both realms, hence per-realm)
const REALM_SAT_FLOOR: Record<string, number> = { emberwaste: 0.56, verdantwilds: 0.25 }
const GREY_FRAC_MAX = 0.30      // near-grey (S<0.08) fraction (shipped ember 0.001 / verdant 0.086; guard vs a grey wash)
const HUE_TOL = 40              // modal hue must land within ±this of the calibrated realm target
// finale median saturation must exceed the wave-1 floor by ≥ this. Kept modest: the
// ember ground is ALREADY highly saturated at the 0.80 floor (0.671), so the rise to
// the finale's ~0.97 filter is bounded by the HSV ceiling (converged finale ~0.71 →
// rise ~0.04). 0.02 stays a clear positive signal (~8× the run-to-run noise of ±0.005)
// without riding the ceiling. Defeat, by contrast, slams the world to grey (target 0).
const RISE_MIN = 0.02

// circular hue histogram (saturation-weighted) + saturation stats over a 64×64
// downsample of the COMPOSITED canvas. Runs entirely in-page: the screenshot is
// decoded by the browser (no Node PNG lib), and drawImage of the screenshot (NOT
// the WebGL canvas — preserveDrawingBuffer is false) is what makes the CSS filter
// survive into the pixels we measure.
async function analyzeCanvas(page: import('playwright-core').Page, targetHue: number, savePath?: string): Promise<{ medSat: number; meanSat: number; greyFrac: number; modalHue: number; hueDist: number; huePix: number }> {
  // Hide every DOM overlay (the ?qa juice panel, onboarding/welcome modals, the
  // HUD) around the shot: an element screenshot composites overlapping DOM in, and
  // those saturated amber UI panels would otherwise OWN the hue/saturation stats
  // instead of the rendered board. visibility (not display) avoids any reflow that
  // could resize the canvas. Canvas is a direct child of <body>.
  await page.evaluate(() => {
    const cv = document.querySelector('canvas.battle3d-canvas')
    const hidden: Array<[HTMLElement, string]> = []
    for (const el of Array.from(document.body.children)) {
      if (el === cv) continue
      const he = el as HTMLElement
      hidden.push([he, he.style.visibility])
      he.style.visibility = 'hidden'
    }
    ;(window as any).__jcHidden = hidden
  })
  const buf = await page.locator('canvas.battle3d-canvas').screenshot()
  await page.evaluate(() => {
    for (const [el, v] of ((window as any).__jcHidden ?? [])) el.style.visibility = v
    ;(window as any).__jcHidden = null
  })
  if (savePath && process.env.JUICE_SHOTS) writeFileSync(savePath, buf)
  const b64 = buf.toString('base64')
  return await page.evaluate(async ({ b64, targetHue }) => {
    const img = new Image()
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('shot decode failed')); img.src = 'data:image/png;base64,' + b64 })
    const N = 64
    const cv = document.createElement('canvas'); cv.width = N; cv.height = N
    const ctx = cv.getContext('2d')!
    ctx.drawImage(img, 0, 0, N, N)
    const d = ctx.getImageData(0, 0, N, N).data
    const sats: number[] = []
    let grey = 0, huePix = 0
    const bins = new Array(36).fill(0)
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255
      const max = Math.max(r, g, b), min = Math.min(r, g, b), dlt = max - min
      const v = max
      const s = max === 0 ? 0 : dlt / max
      sats.push(s)
      if (s < 0.08) grey++
      // MODAL HUE is measured over LIT, saturated pixels only. The board fills only
      // the lower third of a portrait phone frame; the upper region is the near-black
      // violet void sky which — though it's *saturated* violet — is LOW-value. Without
      // a value floor it owns the mode (~245°) and swamps the realm's own ground/
      // backdrop hue. Gating on v ≥ floor drops the void and lets the painted world's
      // colour read through.
      if (s >= 0.15 && v >= 0.42) {
        let h = 0
        if (dlt > 0) {
          if (max === r) h = ((g - b) / dlt) % 6
          else if (max === g) h = (b - r) / dlt + 2
          else h = (r - g) / dlt + 4
          h *= 60; if (h < 0) h += 360
        }
        bins[Math.floor(h / 10) % 36] += s // saturation-weighted so faint pixels don't sway the mode
        huePix++
      }
    }
    sats.sort((a, b) => a - b)
    const medSat = sats[Math.floor(sats.length / 2)]
    const meanSat = sats.reduce((a, b) => a + b, 0) / sats.length
    let mb = 0; for (let i = 1; i < 36; i++) if (bins[i] > bins[mb]) mb = i
    const modalHue = mb * 10 + 5
    let hueDist = Math.abs(modalHue - targetHue) % 360; if (hueDist > 180) hueDist = 360 - hueDist
    return { medSat, meanSat, greyFrac: grey / sats.length, modalHue, hueDist, huePix }
  }, { b64, targetHue })
}

type ShotStats = { medSat: number; meanSat: number; greyFrac: number; modalHue: number; hueDist: number; huePix: number }

// STABILIZED sampler: the board animates (a pulsing additive glow band, drifting
// particles, an idle camera drift), all keyed to the sim clock. A single shot lands
// at whatever animation phase the (variable-length) scene-swap wait left us in — so
// the same state reads 0.68–0.72 run-to-run, which swamps the modest ember rise.
// Sampling the MEDIAN over ~one full pulse period (5 shots × 10 frames @50ms = 2 s;
// the ember glow pulses at 0.5 Hz) removes the phase noise, and applying the SAME
// treatment to floor + finale keeps the rise comparison fair.
async function analyzeStable(page: import('playwright-core').Page, targetHue: number, savePath?: string): Promise<ShotStats> {
  const shots: ShotStats[] = []
  const SAMPLES = 5
  for (let i = 0; i < SAMPLES; i++) {
    shots.push(await analyzeCanvas(page, targetHue, i === 0 ? savePath : undefined))
    if (i < SAMPLES - 1) await page.evaluate(() => (window as any).__chromancer.stepFrames(10, 50))
  }
  const med = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }
  const mid = shots[Math.floor(SAMPLES / 2)]
  return {
    medSat: med(shots.map((s) => s.medSat)),
    meanSat: med(shots.map((s) => s.meanSat)),
    greyFrac: med(shots.map((s) => s.greyFrac)),
    modalHue: mid.modalHue, hueDist: mid.hueDist, huePix: mid.huePix,
  }
}

// A painted enemy sprite genuinely on disk in the SERVED build (dist/, webp-first).
// juicecheck's positive enemy-pose assertion is gated on this: a not-yet-shipped
// grunt/keeper/boss sprite never turns CI red (only warns), but a REGRESSION on an
// existing sprite (a 404 that fell soft) still fails. See ENEMY_ART in enemyArt.ts.
function poseArtOnDisk(kind: string): boolean {
  const base = join(ROOT, 'dist', 'concepts', 'enemies', 'poses')
  return existsSync(join(base, `${kind}-walk-a.webp`)) || existsSync(join(base, `${kind}-walk-a.png`))
}

async function main(): Promise<void> {
  console.log('JUICECHECK — real-browser battle-feel verification\n')
  const server = await startPreview()
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true, args: ['--no-sandbox', '--mute-audio'] })
  try {
    // Small phone-aspect viewport: the full bloom-composer render is ~0.4 s/frame
    // headless at 414×896 (fill-rate bound under SwiftShader); 320×568 (iPhone-SE
    // class) keeps the layout realistic and roughly halves the wall cost. All
    // MEASUREMENTS are on the deterministic fixed-dt clock, not wall time, so
    // viewport size cannot change any asserted number.
    const page = await browser.newPage({ viewport: { width: 320, height: 568 }, hasTouch: true })
    const pageErrors: string[] = []
    page.on('pageerror', (e) => pageErrors.push(String(e)))
    let emberFloorSat = 0 // D3: wave-1 floor median saturation, compared against the finale rise

    await page.goto(`http://127.0.0.1:${PORT}/?qa=1`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => !!(window as any).__chromancer, undefined, { timeout: 30_000 })
    pass('QA drive attached (window.__chromancer present under ?qa=1)')

    // ---- launch l1 deterministically -------------------------------------
    const state0 = await page.evaluate(async () => {
      const c = (window as any).__chromancer
      return await c.startLevel({ levelId: 'l1', seed: 0xa5eed })
    })
    check(state0.state === 'prep' && state0.wave === 1, `battle launched: wave ${state0.wave}/${state0.waveTotal}, state '${state0.state}'`)

    // ---- board textures (silent-fallback trap) ----------------------------
    // Textures load async over local HTTP; POLL (network+decode timing varies
    // headless) and read back what is ACTUALLY bound to the materials.
    let tex = { realm: '?', ground: '', path: '' }
    for (let i = 0; i < 30; i++) {
      tex = await page.evaluate(() => (window as any).__chromancer.getState().boardTexture)
      if (tex.ground === 'realm-png' && tex.path === 'path-png') break
      await page.waitForTimeout(500)
    }
    check(tex.ground === 'realm-png', `painted GROUND texture bound (${tex.realm}: ${tex.ground})`)
    check(tex.path === 'path-png', `painted PATH texture bound (${tex.path})`)

    // ---- painted BACKDROP bound (D2 silent-fallback gate) ------------------
    // The backdrop cylinder had no read-back API and no positive gate: a dropped
    // painting fell soft to the tinted gradient sky and read as success. Assert the
    // real material state ('painted') + the artBound('backdrop') ledger event.
    let bdState = 'gradient'
    for (let i = 0; i < 30; i++) {
      bdState = await page.evaluate(() => (window as any).__chromancer.getState().backdrop)
      if (bdState === 'painted') break
      await page.waitForTimeout(300)
    }
    check(bdState === 'painted', `painted BACKDROP bound (${tex.realm}: ${bdState})`)

    // ---- Wellspring painted base sprites bound (D2) ------------------------
    // Both the radiant + critical Wellspring paintings must decode; a 404 that fell
    // soft to the procedural fount used to emit NO artBound at all.
    let wellBound: string[] = []
    for (let i = 0; i < 30; i++) {
      wellBound = await page.evaluate(() => (((window as any).__chromancer.assetEvents as any[])
        .filter((e) => e.type === 'asset-bound' && e.what === 'base').map((e) => e.id)))
      if (wellBound.includes('wellspring.png') && wellBound.includes('wellspring-critical.png')) break
      await page.waitForTimeout(300)
    }
    check(wellBound.includes('wellspring.png'), `Wellspring RADIANT painting bound (base:wellspring.png)`)
    check(wellBound.includes('wellspring-critical.png'), `Wellspring CRITICAL painting bound (base:wellspring-critical.png)`)

    // ---- Kenney kit models all loaded (D2) --------------------------------
    // A missing GLB used to clone() a silent empty Group (props just absent). Assert
    // the registry is ready and every MODEL_NAMES entry actually has() a scene.
    const modelState = await page.evaluate(() => (window as any).__chromancer.models)
    check(modelState.ready === true, `kit-model registry ready (models.ready)`)
    check(modelState.missing.length === 0, modelState.missing.length ? `kit models MISSING: ${modelState.missing.join(', ')}` : `all ${'12'} MODEL_NAMES entries loaded (has())`)

    // ---- D3 VISUAL REGRESSION: wave-1 colour floor (ember) -----------------
    // Settle the greying filter to its wave-1 floor, then measure the COMPOSITED
    // canvas. This is the exact state a new player sees at battle start.
    await page.evaluate(() => (window as any).__chromancer.stepFrames(6, 50))
    const emberFloor = await analyzeStable(page, REALM_HUE[tex.realm] ?? 25, '/tmp/shot-ember.png')
    console.log(`    · D3 ember wave-1 floor: medSat ${emberFloor.medSat.toFixed(3)} meanSat ${emberFloor.meanSat.toFixed(3)} greyFrac ${emberFloor.greyFrac.toFixed(3)} modalHue ${emberFloor.modalHue}° huePix ${emberFloor.huePix} (target ${REALM_HUE[tex.realm]}°, dist ${emberFloor.hueDist}°)`)
    emberFloorSat = emberFloor.medSat
    check(emberFloor.medSat >= (REALM_SAT_FLOOR[tex.realm] ?? 0.25), `D3 wave-1 median saturation ${emberFloor.medSat.toFixed(3)} ≥ ${REALM_SAT_FLOOR[tex.realm]} (painted world reaches the eye vivid, not greyed)`)
    check(emberFloor.greyFrac <= GREY_FRAC_MAX, `D3 wave-1 grey fraction ${emberFloor.greyFrac.toFixed(3)} ≤ ${GREY_FRAC_MAX}`)
    check(emberFloor.hueDist <= HUE_TOL, `D3 wave-1 modal hue ${emberFloor.modalHue}° within ±${HUE_TOL}° of ${tex.realm} target ${REALM_HUE[tex.realm]}°`)

    // ---- build a real defense (brute-force legal cells; QA grants gold) ---
    const placed = await page.evaluate(() => {
      const c = (window as any).__chromancer
      let n = 0
      const kinds = ['storm', 'frost', 'flame']
      outer: for (let q = 0; q < 20; q++) {
        for (let r = 0; r < 14; r++) {
          if (c.placeTower(kinds[n % kinds.length], { q, r })) {
            c.upgradeTower({ q, r }); c.upgradeTower({ q, r })
            n++
            if (n >= 8) break outer
          }
        }
      }
      return n
    })
    check(placed >= 4, `placed + double-upgraded ${placed} towers via QA drive`)

    // ---- painted POSE-FRAME binding: heroes (assert-bound, not fail-soft) --
    // Deploy the roster and POSITIVELY assert each deployed hero's painted
    // pose frames decoded and bound ('asset-bound' telemetry). A 404 that
    // fails soft to the portrait cutout can no longer read as success.
    const heroBind = await page.evaluate(async (ids: string[]) => {
      const c = (window as any).__chromancer
      const deployed: string[] = []
      outer: for (const id of ids) {
        for (let q = 0; q < 20; q++) {
          for (let r = 0; r < 14; r++) {
            if (c.placeHero(id, { q, r })) { deployed.push(id); continue outer }
          }
        }
      }
      for (let i = 0; i < 60; i++) {
        // the drive is frozen between steps — step a few frames so the VIEW
        // creates the hero slots and binds the decoded frames
        c.stepFrames(4)
        const boundNow = new Set((c.assetEvents as any[])
          .filter((e: any) => e.type === 'asset-bound' && e.what === 'hero-pose')
          .map((e: any) => e.id))
        if (deployed.every((id) => boundNow.has(id))) break
        await new Promise((res) => setTimeout(res, 250))
      }
      const evs = (c.assetEvents as any[]).slice()
      return {
        deployed,
        bound: evs.filter((e: any) => e.type === 'asset-bound').map((e: any) => `${e.what}:${e.id}`),
        misses: evs.filter((e: any) => e.type === 'asset' && /pose/.test(String(e.what))).map((e: any) => `${e.what}:${e.url}`),
      }
    }, ['ember', 'glacia', 'sylvan', 'pyra', 'zephyra', 'volt', 'aurelia', 'vex'])
    const allBound = new Set<string>(heroBind.bound)
    const allPoseMisses = new Set<string>(heroBind.misses)
    check(heroBind.deployed.length >= 3, `deployed ${heroBind.deployed.length} heroes via QA drive (${heroBind.deployed.join(', ')})`)
    for (const id of heroBind.deployed) {
      check(allBound.has(`hero-pose:${id}`), `hero '${id}' painted pose frames BOUND (idle/attack/cast)`)
    }

    // ---- all 9 reactions fire their full juice chain -----------------------
    const rx = await page.evaluate((keys: string[]) => {
      const c = (window as any).__chromancer
      c.clearEvents()
      const fired: Record<string, boolean> = {}
      for (const k of keys) {
        fired[k] = c.triggerReaction(k)
        c.stepFrames(8) // fine dt: time the freeze span precisely (hitstop ≈ 3–6 frames @60fps)
        // burn the 0.55 s reaction-callout/hitstop throttle (a peak-density guard,
        // by design). NB: BattleScene.update clamps dt to 50 ms/frame, so 12
        // frames at 50 ms = 0.6 s — just past the cooldown, so EVERY reaction
        // lands its own slam.
        c.stepFrames(12, 50)
      }
      c.stepFrames(8)
      const evs = (c.events as any[]).slice()
      return { fired, evs }
    }, REACTION_KEYS)

    for (const e of rx.evs as any[]) {
      if (e.type === 'asset-bound') allBound.add(`${e.what}:${e.id}`)
      if (e.type === 'asset' && /pose/.test(String(e.what))) allPoseMisses.add(`${e.what}:${e.url}`)
    }
    for (const k of REACTION_KEYS) check(rx.fired[k] === true, `reaction '${k}' triggered`)
    const byType = (t: string) => rx.evs.filter((e: any) => e.type === t)
    check(byType('reaction').length >= 9, `${byType('reaction').length} reaction telemetry events (>=9)`)
    check(byType('shake').length >= 9, `${byType('shake').length} shake events (>=9)`)
    check(byType('sound').length >= 9, `${byType('sound').length} sound events (>=9)`)
    check(byType('callout').length >= 1, `${byType('callout').length} callout events (callouts are throttled by design)`)

    // ---- hitstop realized spans -------------------------------------------
    const stops = byType('hitstop').map((e: any) => e.durationMs as number)
    check(stops.length >= 7, `${stops.length} realized hitstop freeze spans measured (>=7 of 9 — first trigger can race the settle window)`)
    const inSane = stops.filter((d) => d >= 30 && d <= 140)
    const inBand = stops.filter((d) => d >= 40 && d <= 90)
    check(inSane.length === stops.length, `every span within 30–140 ms sanity window (min ${Math.min(...stops).toFixed(1)}, max ${Math.max(...stops).toFixed(1)})`)
    check(inBand.length >= 1, `>=1 span inside the designed 40–90 ms band (${inBand.length}/${stops.length})`)

    // ---- wave progression in the REAL loop --------------------------------
    // COARSE deterministic stepping: BattleScene.update clamps dt to 50 ms per
    // frame, so each real render advances 3× more sim than 60 fps stepping —
    // still the REAL loop (render+HUD+events every frame). Prove the counter
    // leaves wave 1, then skipToWave(N) and run the finale to an end state so
    // the whole check stays inside a few wall-minutes.
    await page.evaluate(() => { const c = (window as any).__chromancer; c.clearEvents(); c.startWave() })
    // Node-side chunked loop (progress stays visible; each chunk = 2 sim-seconds).
    const stepChunk = () => page.evaluate(() => (window as any).__chromancer.stepFrames(8, 250))
    let s = await stepChunk()
    let chunks = 0
    for (; chunks < 120 && s.wave < 2 && s.state !== 'won' && s.state !== 'lost'; chunks++) {
      s = await stepChunk()
      if (chunks % 15 === 14) console.log(`    … driving: wave ${s.wave}/${s.waveTotal}, state ${s.state}, enemies ${s.aliveEnemies} (${(chunks + 1) * 2}s sim)`)
    }
    const wave2 = s.wave
    // Jump the mid-waves; the finale still runs for real to an end state.
    await page.evaluate(() => { const c = (window as any).__chromancer; c.skipToWave(c.getState().waveTotal) })
    for (chunks = 0; chunks < 150 && s.state !== 'won' && s.state !== 'lost'; chunks++) {
      if (s.state === 'prep') await page.evaluate(() => (window as any).__chromancer.startWave())
      s = await stepChunk()
      if (chunks % 15 === 14) console.log(`    … finale: wave ${s.wave}/${s.waveTotal}, state ${s.state}, enemies ${s.aliveEnemies}`)
    }
    const wavep = await page.evaluate(([w2, endState, endWave]: any[]) => {
      const evs = ((window as any).__chromancer.events as any[]).slice()
      return {
        wave2: w2, endState, endWave,
        combo: evs.filter((e) => e.type === 'combo').length,
        kills: evs.filter((e) => e.type === 'kill').length,
        milestones: evs.filter((e) => e.type === 'combo' && (e as any).milestone).length,
        bound: evs.filter((e) => e.type === 'asset-bound').map((e: any) => `${e.what}:${e.id}`),
        misses: evs.filter((e) => e.type === 'asset' && /pose/.test(String((e as any).what))).map((e: any) => `${e.what}:${e.url}`),
      }
    }, [wave2, s.state, s.wave])
    for (const b of wavep.bound) allBound.add(b)
    for (const m of wavep.misses) allPoseMisses.add(m)
    check(wavep.wave2 >= 2, `WAVE COUNTER ADVANCES in the real loop (reached wave ${wavep.wave2}) — the E2E 'stuck 1/7' was a reachability artifact`)
    check(wavep.endState === 'won' || wavep.endState === 'lost', `level ran to a real end state: '${wavep.endState}' at wave ${wavep.endWave}`)
    if (wavep.endState !== 'won') warn(`defense did not WIN naturally (ended '${wavep.endState}') — win screen still proven via forceWin below`)
    check(wavep.kills > 0, `${wavep.kills} kill events during real combat`)
    if (wavep.combo > 0) pass(`${wavep.combo} combo events (${wavep.milestones} milestone slams) during real combat`)
    else warn('no combo events reached — combo depth needs a denser wave (not a failure)')

    // ---- both end screens -------------------------------------------------
    const ends = await page.evaluate(async () => {
      const c = (window as any).__chromancer
      const w = await c.startLevel({ levelId: 'l1', seed: 7 }).then(() => c.forceWin().state)
      const l = await c.startLevel({ levelId: 'l1', seed: 8 }).then(() => c.forceDefeat().state)
      return { w, l }
    })
    check(ends.w === 'won', `WIN end state fires ('${ends.w}')`)
    check(ends.l === 'lost', `DEFEAT end state fires ('${ends.l}')`)

    // ---- painted POSE-FRAME binding: enemies + no silent fallback ----------
    // The main drive's maxed defense one-shots spawns inside a single coarse
    // 250 ms step, so the VIEW can never create an enemy slot (nothing survives
    // to a render). Probe binding on a FRESH, undefended board instead: let
    // runners genuinely march a few rendered seconds, then read the persistent
    // asset ledger (immune to ring-buffer churn + clearEvents).
    const tail = await page.evaluate(async () => {
      const c = (window as any).__chromancer
      await c.startLevel({ levelId: 'l1', seed: 9 })
      for (let i = 0; i < 32; i++) {
        // the re-entered scene settles into 'prep' a few frames late (the prior
        // forceDefeat state lingers) — keep nudging the wave until it takes
        if (c.getState().state === 'prep') c.startWave()
        c.stepFrames(10) // fine dt — enemies live across many rendered frames
        const evs0 = c.assetEvents as any[]
        if (evs0.some((e: any) => e.type === 'asset-bound' && e.what === 'enemy-pose')) break
        await new Promise((res) => setTimeout(res, 250)) // wall time for decode
      }
      const evs = (c.assetEvents as any[]).slice()
      return {
        bound: evs.filter((e) => e.type === 'asset-bound').map((e: any) => `${e.what}:${e.id}`),
        misses: evs.filter((e) => e.type === 'asset' && /pose/.test(String((e as any).what))).map((e: any) => `${e.what}:${e.url}`),
      }
    })
    for (const b of tail.bound) allBound.add(b)
    for (const m of tail.misses) allPoseMisses.add(m)
    const enemyBound = [...allBound].filter((b) => b.startsWith('enemy-pose:')).map((b) => b.split(':')[1])
    check(enemyBound.length >= 1, `enemy painted pose frames BOUND for ${enemyBound.length} archetype(s): ${enemyBound.join(', ') || 'none'}`)

    // D2 ENEMY-ART TOTALITY (disk-existence-aware). ENEMY_ART is now a TOTAL
    // Record<EnemyKind, …>, so grunt/keeper/boss have art contracts whose PNGs are
    // still being generated in parallel. Split pose misses:
    //   · REAL regression → an existing sprite 404'd and fell soft (or any hero
    //     pose miss, since those all ship). HARD FAIL.
    //   · PENDING → an enemy sprite not yet on disk degrading safely. WARN only,
    //     so a not-yet-shipped grunt/keeper/boss can't turn CI red (per Part D).
    const ENEMY_MISS = 'enemy pose art:'
    const enemyMissKinds = [...allPoseMisses].filter((m) => m.startsWith(ENEMY_MISS)).map((m) => m.slice(ENEMY_MISS.length))
    const pendingMisses = [...allPoseMisses].filter((m) => m.startsWith(ENEMY_MISS) && !poseArtOnDisk(m.slice(ENEMY_MISS.length)))
    const realMisses = [...allPoseMisses].filter((m) => !pendingMisses.includes(m))
    // POSITIVE totality: every kind that actually SPAWNED (bound or missed) whose
    // sprite is on disk MUST be bound — a 404 that fell soft can't read as success.
    const spawnedKinds = new Set<string>([...enemyBound, ...enemyMissKinds])
    for (const kind of spawnedKinds) {
      if (poseArtOnDisk(kind)) check(enemyBound.includes(kind), `enemy '${kind}' pose frames BOUND (sprite on disk → must bind, no silent fallback)`)
    }
    if (pendingMisses.length) warn(`enemy pose art PENDING (sprite not yet in build, degrading safely to primitive): ${pendingMisses.join(' | ')}`)
    check(realMisses.length === 0, realMisses.length ? `pose art fell back SILENTLY (regression — a shipped sprite 404'd): ${realMisses.join(' | ')}` : 'zero unexpected pose-art misses (no silent fallback)')

    // ---- painted WORLD-MAP RIDGE binding (assert-bound) --------------------
    // Reach the real map through the shipped flow (win screen → WORLD MAP),
    // then require every realm band to flip to .ridged — which only happens
    // after a REAL decode — and all six 'ridge-art' ledger binds.
    const ridge = await page.evaluate(async () => {
      const c = (window as any).__chromancer
      await c.startLevel({ levelId: 'l1', seed: 10 })
      // the re-entered scene settles into 'prep' a few frames late — wait for
      // it (stepping so the driven loop advances), then win, then poll for the
      // victory screen's WORLD MAP button
      for (let i = 0; i < 40 && c.getState().state !== 'prep'; i++) {
        c.stepFrames(5)
        await new Promise((res) => setTimeout(res, 150))
      }
      c.forceWin()
      let btn: HTMLButtonElement | undefined
      for (let i = 0; i < 40 && !btn; i++) {
        c.stepFrames(5)
        btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes('WORLD MAP')) as HTMLButtonElement | undefined
        if (!btn) await new Promise((res) => setTimeout(res, 250))
      }
      btn?.click()
      let bands = 0
      for (let i = 0; i < 40; i++) {
        bands = document.querySelectorAll('.ewm-band.ridged').length
        if (bands >= 6) break
        await new Promise((res) => setTimeout(res, 300))
      }
      const bound = (c.assetEvents as any[])
        .filter((e: any) => e.type === 'asset-bound' && e.what === 'ridge-art')
        .map((e: any) => e.id)
      return { clicked: !!btn, bands, bound }
    })
    check(ridge.clicked, 'win screen exposes the WORLD MAP button (map reachable)')
    check(ridge.bands === 6, `painted ridge panoramas BOUND on ${ridge.bands}/6 realm bands (.ridged only flips on a real decode)`)
    check(ridge.bound.length === 6, `6/6 'ridge-art' asset-bound ledger events (${ridge.bound.join(', ')})`)

    // ---- D3 VISUAL REGRESSION: the Greying arc actually RAISES saturation ---
    // Fresh l1, jump to the FINAL wave (colorProgress ≈ (total-1)/total ≈ 0.86, so
    // the greying filter opens to ~0.97 sat) and measure in prep — no win overlay,
    // no transient bloom. The finale must read clearly MORE saturated than the
    // wave-1 floor, proving the restoration mechanic plays (not a static tint).
    const emberRise = await page.evaluate(async () => {
      const c = (window as any).__chromancer
      await c.startLevel({ levelId: 'l1', seed: 11 })
      // startLevel can return the OLD scene mid-swap (awaitScene resolves on the
      // still-bound prior scene) — WAIT for the fresh l1 to settle into wave-1 prep
      // before jumping, stepping frames to drive the async transition.
      for (let i = 0; i < 50; i++) {
        let st: any = null
        try { st = c.getState() } catch { st = null }
        if (st && st.state === 'prep' && st.wave === 1) break
        c.stepFrames(4)
        await new Promise((r) => setTimeout(r, 150))
      }
      const s = c.getState()
      c.skipToWave(s.waveTotal)
      // Fully CONVERGE the greying filter: it eases toward its target (~0.97 at this
      // colorProgress) at ~15%/frame, so 8 frames leaves it mid-ease and the rise
      // measurement wobbles run-to-run. ~28 frames settles it to within ~1%.
      c.stepFrames(28, 50)
      const st = c.getState()
      return { realm: st.boardTexture.realm, wave: st.wave, waveTotal: st.waveTotal, state: st.state }
    })
    if (process.env.JUICE_SHOTS) console.log(`      (finale state: ${JSON.stringify(emberRise)})`)
    const finaleShot = await analyzeStable(page, REALM_HUE[emberRise.realm] ?? 25, '/tmp/shot-finale.png')
    console.log(`    · D3 ember finale: medSat ${finaleShot.medSat.toFixed(3)} (floor ${emberFloorSat.toFixed(3)}, rise ${(finaleShot.medSat - emberFloorSat).toFixed(3)})`)
    check(finaleShot.medSat >= emberFloorSat + RISE_MIN, `D3 Greying arc RAISES saturation by the finale: ${finaleShot.medSat.toFixed(3)} ≥ floor ${emberFloorSat.toFixed(3)} + ${RISE_MIN}`)

    // ---- D3 VISUAL REGRESSION: a second realm (verdant) at the wave-1 floor --
    // A different painted realm must ALSO clear the floor and land on its own hue
    // (guards against a single-realm calibration or a global grey wash).
    // 'w3_0' = verdant realm's first generated level (finale ids like 'l4' are
    // gated and fall back to l1/emberwaste through the QA drive).
    const verdRealm = await page.evaluate(async () => {
      const c = (window as any).__chromancer
      await c.startLevel({ levelId: 'w3_0', seed: 12 })
      // WAIT for the verdant scene to actually replace the prior one — poll on the
      // DISTINGUISHING signal (realm flips to verdantwilds + its ground PNG binds),
      // not merely 'a realm-png is bound' (the carried-over ember scene already had
      // one). Step frames to drive the swap.
      let t = { realm: '?', ground: '', path: '' }
      for (let i = 0; i < 50; i++) {
        try { t = c.getState().boardTexture } catch { /* null-control window mid-swap */ }
        if (t.realm === 'verdantwilds' && t.ground === 'realm-png') break
        c.stepFrames(4)
        await new Promise((r) => setTimeout(r, 200))
      }
      c.stepFrames(6, 50)
      return t.realm
    })
    check(verdRealm === 'verdantwilds', `verdant level w3_0 renders the verdantwilds realm (got '${verdRealm}')`)
    const verdShot = await analyzeStable(page, REALM_HUE[verdRealm] ?? 120, '/tmp/shot-verdant.png')
    console.log(`    · D3 verdant wave-1 floor: medSat ${verdShot.medSat.toFixed(3)} greyFrac ${verdShot.greyFrac.toFixed(3)} modalHue ${verdShot.modalHue}° huePix ${verdShot.huePix} (target ${REALM_HUE[verdRealm]}°, dist ${verdShot.hueDist}°)`)
    check(verdShot.medSat >= (REALM_SAT_FLOOR[verdRealm] ?? 0.25), `D3 verdant wave-1 median saturation ${verdShot.medSat.toFixed(3)} ≥ ${REALM_SAT_FLOOR[verdRealm]}`)
    check(verdShot.greyFrac <= GREY_FRAC_MAX, `D3 verdant wave-1 grey fraction ${verdShot.greyFrac.toFixed(3)} ≤ ${GREY_FRAC_MAX}`)
    check(verdShot.hueDist <= HUE_TOL, `D3 verdant wave-1 modal hue ${verdShot.modalHue}° within ±${HUE_TOL}° of verdantwilds target ${REALM_HUE[verdRealm]}°`)

    // ---- page health -------------------------------------------------------
    check(pageErrors.length === 0, pageErrors.length ? `uncaught page errors: ${pageErrors.slice(0, 3).join(' | ')}` : 'zero uncaught page errors across the whole drive')
  } finally {
    await browser.close().catch(() => {})
    server.kill('SIGTERM')
  }

  console.log(`\nJUICECHECK ${failures ? 'FAILED' : 'PASSED'} — ${failures} failure(s), ${warnings} warning(s)`)
  if (failures) process.exit(1)
}

main().catch((e) => {
  console.error('juicecheck: fatal —', e?.message ?? e)
  process.exit(1)
})
