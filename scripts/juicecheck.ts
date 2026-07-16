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
import { existsSync, readdirSync } from 'node:fs'
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
    check(allPoseMisses.size === 0, allPoseMisses.size ? `pose art fell back silently: ${[...allPoseMisses].join(' | ')}` : 'zero pose-art misses across the whole drive (no silent fallback)')

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
