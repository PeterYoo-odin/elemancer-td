// BattleScene — the ORCHESTRATOR. It owns no gameplay: it drives the pure sim,
// renders it through a Three.js WebGL view (BattleView3D) and a DOM/CSS HUD
// (BattleHud), forwards input into the sim, and turns semantic sim events into
// juice. Phaser is kept only as the app shell + scene router (Menu/Map/Shop/…);
// the battle board itself is real 3D on a full-window canvas above Phaser's.

import Phaser from 'phaser'
import { TOWERS, type TowerKind } from '../game/towers'
import { LEVELS, levelById, pathCellsFor, starsForClear, DEMO_LEVEL, type LevelDef } from '../game/levels'
import { SPELLS, type SpellKey } from '../game/spells'
import { economy } from '../game/economy'
import { NEUTRAL } from '../game/workshop'
import { NORMAL_MODE, levelForMode, startLivesForMode, towerCapForMode, partyAllowedForMode, modeSeedSalt, badgesForClear, isNormalMode, BADGE_META, type RunMode } from '../game/modes'
import { Sim, MAP_X, MAP_Y, MAP_W, MAP_H, TARGET_MODES, cellCenter, type SimEvent } from '../sim'
import { BattleView3D } from '../three/BattleView3D'
import { CameraControls } from '../three/cameraControls'
import { BattleHud, type HudContext } from '../ui/BattleHud'
import type { ShareCardOpts } from '../ui/ShareCard'
import { renderShareCard, copyText } from '../ui/ShareCard'
import { music } from '../ui/music'
import { appSettings } from '../ui/settings'
import { barkEngine } from '../game/barks'
import { unlockCodex, recordReaction, reactionsDiscoveredCount, REACTION_TOTAL, unlockCodexBatch, unlockEnemyCodex, CODEX_ON_KEEPER_REDEEM } from '../game/codex'
import { KEEPER_BY_ID } from '../game/keepers'
import { realmForLevel } from '../game/levels'
import { playMoroseHush } from '../ui/sfx'
import { battleSfx } from '../ui/battleSfx'
import { canonicalSeed, seedToCode, seedLink, utcDayIndex } from '../game/seedcode'
import { recordDailyResult } from '../game/daily'
import { ScriptRunner, DEMO_SCRIPT, DEMO_SEED, DEMO_PARTY, DEMO_FROST_CELL } from '../game/attractScript'
import { DEMO_CINE_CUES, DEMO_CAPTIONS, CINE_HOME } from '../game/cinema'
import { ftue, LEVEL_LESSONS, deathLesson } from '../game/onboarding'
import { analytics } from '../game/analytics'
import { Coach } from '../ui/coach'
import { showWelcomeReward } from '../ui/WelcomeReward'
import { showInstallCard } from '../ui/pwa'
import { withRef } from '../game/referral'

// ONBOARDING coach steps for the first-ever battle (L1). Every step completes
// by DOING; none of them ever blocks input, and skipping ahead auto-advances.
type CoachStep =
  | 'off'
  | 'pickTower' // tap the Flame button
  | 'placeTower' // tap the suggested bend cell
  | 'start' // press START
  | 'watch' // wave 1 runs, coach stays quiet
  | 'frost' // wave 2 prep: add Frost next to Flame → THERMAL SHOCK
  | 'upgradeWait'
  | 'upgrade' // wave 3 prep: tap a tower → UPGRADE
  | 'heroWait'
  | 'hero' // wave 4 prep: deploy the first party hero
  | 'done'

const ENDLESS_START_GOLD = 300
const ENDLESS_START_LIVES = 20

type InputMode = 'idle' | 'building' | 'deploying' | 'aiming'

export interface BattleLaunchData {
  levelId?: string
  difficulty?: import('../game/modes').Difficulty // campaign: 'heroic' scales waves
  challenge?: import('../game/modes').Challenge // campaign: iron / nohero / towers
  endless?: boolean
  demo?: boolean // "The Restoration of Ember Vale" — live play
  attract?: boolean // hands-free cinematic demo reel (?attract=1)
  seedOverride?: number // ?seed= deep link — the exact seeded run
  speed?: number // ?speed= capture control (attract)
  captions?: boolean // ?captions=0 disables the reel captions
  loop?: boolean // ?loop=1 restarts the reel after the end card
  daily?: boolean // launched from the in-game Daily screen — log the result locally
}

export class BattleScene extends Phaser.Scene {
  private levelId = 'l1'
  private runMode: RunMode = NORMAL_MODE
  private endless = false
  private demoMode = false
  private attract = false
  private seedOverride: number | undefined
  private isDaily = false
  private captionsOn = true
  private loopReel = false
  private seed = 0
  private seedCode = ''
  private level!: LevelDef
  private sim!: Sim
  private view!: BattleView3D
  private hud!: BattleHud

  // attract-mode machinery (all torn down on takeover/shutdown)
  private script: ScriptRunner | null = null
  private cueIdx = 0
  private capIdx = 0
  private draftHoldT = 0
  private takeoverEl: HTMLDivElement | null = null
  private captionEl: HTMLDivElement | null = null
  private attractEndEl: HTMLDivElement | null = null
  private shatterBloomDone = false

  private gameSpeed = 1
  private paused = false
  private resultShown = false
  private draftShown = false

  private mode: InputMode = 'idle'
  private buildKind: TowerKind | null = null
  private buildHeroId: string | null = null
  private aimingSpell: SpellKey | null = null
  private aimingHeroSlot: number | null = null
  private selectedId: number | null = null

  private camCtl: CameraControls | null = null
  private onResize = () => this.view?.resize()
  private lastTime = 0
  private hitstopT = 0 // brief slow-mo on big kills (view pacing only)
  private lastSimState = ''
  private reactCalloutCd = 0 // throttles the big reaction slam (bursts still always fire)

  // THE GREYING as rendering: the battlefield starts drained and colour returns
  // as the player clears it (CSS saturate filter on the 3D canvas — cheap, GPU-composited).
  private greySat = -1 // current smoothed saturation (-1 = uninitialised)
  private greyBloomT = 0 // victory colour-bloom timer

  // barks: character voice on semantic events (engine handles all rate limits)
  private partyIds: string[] = []
  private lowLivesBarked = false
  private pairTimer = 0
  private barkNow(): number { return performance.now() / 1000 }

  // ONBOARDING & FIRST SESSION — all view-side; the sim never sees any of it.
  private coach: Coach | null = null
  private coachStep: CoachStep = 'off'
  private coachCellSim: { x: number; y: number } | null = null // cached teach cell
  private battleT = 0 // wall-clock seconds since battle create (TTFT / first-wow)
  private firstTowerRecorded = false
  private towersBuilt = 0
  private leakKinds: Record<string, number> = {} // enemy kind -> leaks (death teaches)
  private firstWowDone = false // per-run guard for the first-reaction colour bloom

  constructor() { super('Battle') }

  init(data: BattleLaunchData): void {
    this.attract = !!data?.attract
    this.demoMode = this.attract || !!data?.demo || data?.levelId === 'demo'
    this.endless = !this.demoMode && !!data?.endless
    this.levelId = this.demoMode ? 'demo' : data?.levelId ?? 'l1'
    // Difficulty/challenge modes apply to campaign play only (never demo/attract/endless).
    this.runMode = (this.demoMode || data?.endless)
      ? NORMAL_MODE
      : { difficulty: data?.difficulty ?? 'normal', challenge: data?.challenge ?? '' }
    this.seedOverride = data?.seedOverride
    this.isDaily = !!data?.daily
    this.gameSpeed = this.attract ? Math.min(8, Math.max(0.25, data?.speed ?? 1)) : 1
    this.captionsOn = data?.captions !== false
    this.loopReel = !!data?.loop
  }

  create(): void {
    music.setTrack('battle')
    // ---- run config ----
    const baseLevel = this.endless ? this.endlessLevel() : this.demoMode ? DEMO_LEVEL : levelById(this.levelId) ?? LEVELS[0]
    // Heroic scales the waves (deterministic, harder); other modes leave waves intact.
    this.level = levelForMode(baseLevel, this.runMode)
    // Demo/attract runs are provably fair showcases: NEUTRAL modifiers always,
    // so a shared seed replays identically on every account.
    const mods = this.demoMode ? { ...NEUTRAL } : economy.runModifiers(this.endless)
    const startGold = this.endless ? ENDLESS_START_GOLD : this.level.startGold + mods.startGoldBonus
    // Iron mode = one life; otherwise the level's lives + meta bonus.
    const startLives = this.endless ? ENDLESS_START_LIVES : startLivesForMode(this.level.startLives + mods.startLivesBonus, this.runMode)
    // Every run's seed lives in the shareable WORD-WORD-NN code space, so the
    // "Copy seed link" on ANY run reproduces it exactly.
    const rawSeed = this.endless
      ? (0xE9D1E55 ^ (economy.data.endlessBest * 2654435761)) >>> 0
      : this.demoMode
        ? DEMO_SEED
        : (0xA5EED ^ (this.level.index * 40503) ^ 0x1234 ^ modeSeedSalt(this.runMode)) >>> 0
    this.seed = this.seedOverride ?? canonicalSeed(rawSeed)
    this.seedCode = seedToCode(this.seed)
    // resolve the chosen loadout into (heroId, level) pairs — economy.party() is
    // already filtered to unlocked, valid heroes, so no bad id reaches the sim.
    // The attract reel uses a FIXED party so the footage never depends on a save.
    // RANKED (endless): loadout slot 1 with NORMALIZED hero levels — no purchase
    // and no grind changes ranked strength (the store constitution, enforced).
    const party = this.attract
      ? DEMO_PARTY.map((p) => ({ ...p }))
      : this.endless
        ? economy.rankedParty()
        : partyAllowedForMode(this.runMode) // No-Hero challenge: leave the champions home
          ? economy.party().map((id) => ({ heroId: id, level: economy.heroState(id).level }))
          : []
    this.sim = new Sim({ level: this.level, mods, seed: this.seed, endless: this.endless, startGold, startLives, party, towerCap: towerCapForMode(this.runMode) })

    // LIVE demo: Maddervane pre-places the Frost tower (the guaranteed-SHATTER
    // setup — the player adds Storm). Placement is refunded: a gift, not a cost.
    if (this.demoMode && !this.attract) {
      const cost = this.sim.placeCost('frost')
      const t = this.sim.placeTower('frost', DEMO_FROST_CELL.col, DEMO_FROST_CELL.row)
      if (t) this.sim.gold += cost
    }

    // reset transient state (scene instance is reused across restarts)
    if (!this.attract) this.gameSpeed = 1 // attract keeps its ?speed= capture rate
    this.paused = false
    this.resultShown = false
    this.draftShown = false
    this.mode = 'idle'
    this.buildKind = null
    this.buildHeroId = null
    this.aimingSpell = null
    this.aimingHeroSlot = null
    this.selectedId = null
    this.lastTime = 0
    this.hitstopT = 0
    this.lastSimState = ''
    this.reactCalloutCd = 0
    this.greySat = -1
    this.greyBloomT = 0
    this.partyIds = party.map((p) => p.heroId)
    this.lowLivesBarked = false
    window.clearTimeout(this.pairTimer)
    barkEngine.resetBattle()
    this.script = null
    this.cueIdx = 0
    this.capIdx = 0
    this.draftHoldT = 0
    this.shatterBloomDone = false
    this.takeoverEl?.remove()
    this.takeoverEl = null
    this.captionEl?.remove()
    this.captionEl = null
    this.attractEndEl?.remove()
    this.attractEndEl = null
    this.coach?.dispose()
    this.coach = null
    this.coachStep = 'off'
    this.coachCellSim = null
    this.battleT = 0
    this.firstTowerRecorded = false
    this.towersBuilt = 0
    this.leakKinds = {}
    this.firstWowDone = false
    if (!this.attract && !this.demoMode) analytics.recordBattleStart(this.levelId) // opt-in funnel: level drop-off

    // ---- 3D view ----
    const accent = this.level.palette.pathEdge
    const pathCells = pathCellsFor(this.level) // ordered spawn→base, for tile orientation
    this.view = new BattleView3D(this.sim, this.level.palette, accent, pathCells)
    this.view.mount(document.body)

    // ---- DOM HUD ----
    this.hud = new BattleHud({
      onStart: () => { if (this.sim.state === 'prep') this.sim.startWave() },
      onPause: () => this.togglePause(),
      onSpeed: () => this.toggleSpeed(),
      onResetView: () => this.view.resetView(),
      onTowerButton: (k) => this.onTowerButton(k),
      onSpellButton: (k) => this.onSpellButton(k),
      onHeroButton: (id) => this.onHeroButton(id),
      onSelectDeselect: () => this.deselect(),
      onUpgrade: (id) => { if (this.sim.upgradeTower(id)) this.hud.showUpgrade(this.sim, id) },
      onBranch: (id, idx) => { if (this.sim.chooseBranch(id, idx)) this.hud.showUpgrade(this.sim, id) },
      onFuse: (id, partnerId) => { if (this.sim.fuseTowers(id, partnerId)) this.hud.showUpgrade(this.sim, id) },
      onTargeting: (id) => this.cycleTargeting(id),
      onDraft: (i) => this.pickDraft(i),
      onQuit: () => this.quitBattle(),
      onReplay: () => {
        if (this.sim.state === 'lost') ftue.recordRetry() // death → same-seed retry taken
        this.scene.restart({ levelId: this.levelId, endless: this.endless, demo: this.demoMode, seedOverride: this.seed })
      },
      onBack: () => this.scene.start(this.endless ? 'Menu' : 'Map'),
    })
    this.hud.setLevelName(this.level.name)

    // ---- input + lifecycle ----
    // The gesture layer owns the canvas: it turns drags/pinches/wheel into
    // camera moves and hands us only CLEAN taps and hover positions.
    this.camCtl = new CameraControls(this.view.canvas, this.view, {
      onTap: (x, y) => this.handleTap(x, y),
      onHover: (x, y) => this.handleHover(x, y),
    })
    window.addEventListener('resize', this.onResize)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown())
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.teardown())

    // ---- ATTRACT / DEMO REEL: scripted run + cinematic camera, hands-free ----
    if (this.attract) {
      this.script = new ScriptRunner(DEMO_SCRIPT)
      this.hud.setAttract(true)
      this.view.cineTimeScale = this.gameSpeed
      this.view.setCinematic(true, CINE_HOME)
      this.buildTakeoverOverlay()
    } else if (this.demoMode) {
      this.hud.banner('MADDERVANE LEFT YOU A FROST TOWER', 0x9fdcff)
    } else if (this.endless) {
      // The store constitution, on screen: Ranked ignores every purchase —
      // heroes normalized, boosts/convenience/extra slots disabled.
      this.hud.banner('RANKED · NOTHING YOU CAN BUY WORKS HERE', 0x9fe8ff)
    }
    if (this.attract) this.hud.setSpeed(this.gameSpeed)

    // ---- ONBOARDING: the L1 live coach, or a one-time ramp lesson (l2+) ----
    if (!this.attract && !this.demoMode && !this.endless) {
      // The live coach runs until the L1 curriculum completes — but never for a
      // save that already has stars (veterans replaying L1 are left alone).
      if (this.levelId === 'l1' && !ftue.isDone('l1-core') && economy.totalStars() === 0) {
        this.coach = new Coach()
        this.coachStep = 'pickTower'
      } else {
        const lesson = LEVEL_LESSONS[this.levelId]
        if (lesson && !ftue.lessonSeen(this.levelId)) {
          ftue.markLessonSeen(this.levelId)
          this.coach = new Coach()
          this.coach.say(lesson.title, lesson.body, 9000)
        }
      }
    }

    economy.touchLastSeen()
  }

  private endlessLevel(): LevelDef {
    return {
      id: 'endless', index: 99, name: 'Endless — Ranked', blurb: 'Purchases do not affect this mode',
      lanes: [1, 3, 5, 7, 9], startGold: ENDLESS_START_GOLD, startLives: ENDLESS_START_LIVES,
      baseCoins: 0, palette: LEVELS[3].palette, waves: [],
    }
  }

  // ======================================================================
  //  MAIN LOOP
  // ======================================================================
  update(time: number, delta: number): void {
    if (!this.sim) return
    const dt = Math.min(0.05, delta / 1000)
    let simDt = this.paused ? 0 : dt * this.gameSpeed
    // hitstop: big kills bite for a beat (render keeps animating at full rate)
    if (this.hitstopT > 0) {
      this.hitstopT -= dt
      simDt *= 0.12
    }
    // Scripted input (attract reel) is injected on exact fixed-step boundaries
    // so the showcase run replays identically at any frame rate or ?speed=.
    // The draft pick is held open for a real-time beat (sim clock is frozen in
    // draft, so the hold can't desync the deterministic timeline).
    if (this.script && this.sim.state === 'draft' && this.draftHoldT > 0) this.draftHoldT -= dt
    const allowPick = !this.script || this.draftHoldT <= 0
    const runner = this.script
    this.sim.advance(simDt, runner ? () => runner.update(this.sim, allowPick) : undefined)

    for (const ev of this.sim.drainEvents()) this.handleEvent(ev)

    // wave-start flourish on the prep→active transition
    if (this.sim.state === 'active' && this.lastSimState === 'prep') {
      this.hud.waveBanner(`WAVE ${this.sim.waveIndex + 1}`)
      battleSfx.waveStart()
      // the mini-Keeper gets a proper entrance in the demo
      if (this.demoMode && this.sim.waveIndex === this.level.waves.length - 1) {
        window.setTimeout(() => this.hud.banner('CINDRAL, EMBER OF KAELEN', 0xff4db8), 900)
      }
      // live demo: telegraph the guaranteed-SHATTER build beat at W3
      if (this.demoMode && !this.attract && this.sim.waveIndex === 2) {
        this.hud.banner('ADD A STORM TOWER BY THE FROST — ⚡ SHATTER!', 0xffe14a)
      }
    }
    // wave-clear resolve chime on the way out of combat (prep or draft next)
    if (this.lastSimState === 'active' && (this.sim.state === 'prep' || this.sim.state === 'draft')) {
      battleSfx.waveClear()
    }
    this.lastSimState = this.sim.state

    // attract cinematography: camera cues + captions keyed to the sim clock
    if (this.attract) this.updateAttract()

    if (this.reactCalloutCd > 0) this.reactCalloutCd -= dt
    this.updateGreying(dt)
    this.battleT += dt
    if (this.coachStep !== 'off' && this.coachStep !== 'done') this.runCoach()

    // danger line: one in-voice rally when lives first dip below 35%
    if (!this.lowLivesBarked && this.sim.lives > 0 && this.sim.lives < this.sim.startLives * 0.35) {
      this.lowLivesBarked = true
      this.tryBark('lowLives')
    }

    this.view.syncFrom(this.selectedId)
    this.view.render(dt)
    this.hud.update(this.sim, this.hudCtx())

    // state-driven overlays
    if (this.sim.state === 'draft' && !this.draftShown) {
      this.draftShown = true
      if (this.script) this.draftHoldT = 2.6 // let the reel viewer READ the cards
      this.enterDraftUi()
    }
    if (this.sim.state !== 'draft' && this.draftShown) { this.draftShown = false; this.hud.hideDraft() }
    if ((this.sim.state === 'won' || this.sim.state === 'lost') && !this.resultShown) this.showResult()
    void time
  }

  // ======================================================================
  //  ATTRACT / DEMO REEL — cinematic camera, captions, take-over
  // ======================================================================
  private updateAttract(): void {
    const clock = this.sim.clock
    this.view.cineTimeScale = this.gameSpeed
    while (this.cueIdx < DEMO_CINE_CUES.length && clock >= DEMO_CINE_CUES[this.cueIdx].at) {
      const c = DEMO_CINE_CUES[this.cueIdx++]
      this.view.cineTo({ x: c.x, y: c.y, dist: c.dist, pitch: c.pitch, yaw: c.yaw }, c.dur)
    }
    while (this.capIdx < DEMO_CAPTIONS.length && clock >= DEMO_CAPTIONS[this.capIdx].at) {
      const cap = DEMO_CAPTIONS[this.capIdx++]
      if (this.captionsOn) this.showCaption(cap.text, cap.sub, cap.dur)
    }
  }

  private showCaption(text: string, sub: string | undefined, dur: number): void {
    this.captionEl?.remove()
    const d = document.createElement('div')
    d.style.cssText =
      'position:fixed;left:50%;bottom:18%;transform:translateX(-50%);z-index:3500;text-align:center;' +
      'pointer-events:none;color:#fff;font-family:"Baloo 2","Nunito",system-ui,sans-serif;max-width:86vw;' +
      'text-shadow:0 3px 0 rgba(0,0,0,.55),0 0 26px rgba(130,90,255,.6);transition:opacity .45s ease;opacity:0;'
    const h = document.createElement('div')
    h.textContent = text
    h.style.cssText = 'font-size:clamp(22px,5.4vw,40px);font-weight:900;letter-spacing:2px;'
    d.append(h)
    if (sub) {
      const s = document.createElement('div')
      s.textContent = sub
      s.style.cssText = 'font-size:clamp(13px,3vw,19px);font-weight:700;color:#cbbcff;margin-top:4px;letter-spacing:1px;'
      d.append(s)
    }
    document.body.appendChild(d)
    this.captionEl = d
    requestAnimationFrame(() => { d.style.opacity = '1' })
    const ms = (dur / Math.max(0.25, this.gameSpeed)) * 1000
    window.setTimeout(() => { d.style.opacity = '0' }, Math.max(600, ms - 450))
    window.setTimeout(() => { d.remove(); if (this.captionEl === d) this.captionEl = null }, ms + 500)
  }

  private buildTakeoverOverlay(): void {
    const d = document.createElement('div')
    d.style.cssText = 'position:fixed;inset:0;z-index:4000;cursor:pointer;background:transparent;touch-action:manipulation;'
    const pill = document.createElement('div')
    pill.textContent = '▶  TAP TO TAKE OVER'
    pill.style.cssText =
      'position:absolute;left:50%;bottom:6.5%;transform:translateX(-50%);padding:14px 30px;border-radius:999px;' +
      'font:800 19px "Baloo 2","Nunito",system-ui,sans-serif;letter-spacing:2px;color:#fff;white-space:nowrap;' +
      'background:rgba(22,13,44,.68);border:1px solid rgba(255,255,255,.4);backdrop-filter:blur(5px);' +
      'box-shadow:0 0 26px rgba(160,110,255,.5);animation:chrTakeover 1.7s ease-in-out infinite;'
    const style = document.createElement('style')
    style.textContent = '@keyframes chrTakeover{0%,100%{transform:translateX(-50%) scale(1);opacity:.92}50%{transform:translateX(-50%) scale(1.06);opacity:1}}'
    d.append(style, pill)
    d.addEventListener('pointerdown', (e) => { e.preventDefault(); this.takeOver() })
    document.body.appendChild(d)
    this.takeoverEl = d
  }

  // The reel hands the brush to the viewer mid-run: script stops, HUD returns,
  // camera glides home, and the SAME deterministic sim keeps playing.
  private takeOver(): void {
    if (!this.attract) return
    this.attract = false
    this.script = null
    this.gameSpeed = 1
    this.hud.setSpeed(1)
    this.hud.setAttract(false)
    this.view.setCinematic(false)
    this.takeoverEl?.remove()
    this.takeoverEl = null
    this.captionEl?.remove()
    this.captionEl = null
    this.hud.banner('YOUR BRUSH NOW — HOLD THE LINE', 0x2ff7c3)
    this.tryBark('deploy')
  }

  // The Greying: battlefield saturation tracks clear progress — every kill and
  // wave paints colour back; victory blooms past full colour then settles.
  private updateGreying(dt: number): void {
    const p = this.sim.colorProgress()
    // the demo opens ~90% Greyed — maximum before/after contrast for the reel
    let target = this.demoMode ? 0.1 + 0.9 * p : 0.28 + 0.72 * p
    let bright = this.demoMode ? 0.86 + 0.14 * p : 0.92 + 0.08 * p
    if (this.greyBloomT > 0) {
      this.greyBloomT = Math.max(0, this.greyBloomT - dt)
      const k = Math.sin(Math.min(1, this.greyBloomT / 1.4) * Math.PI) // 0→1→0 pulse
      target = 1 + k * 0.45
      bright = 1 + k * 0.18
    }
    if (this.greySat < 0) this.greySat = target // no pop-in on the first frame
    this.greySat += (target - this.greySat) * Math.min(1, dt * 3)
    const sat = Math.round(this.greySat * 200) / 200 // quantise → no per-frame string churn
    const br = Math.round(bright * 200) / 200
    const filter = sat >= 0.995 && br >= 0.995 && br <= 1.005 ? '' : `saturate(${sat}) brightness(${br})`
    if (this.view.canvas.style.filter !== filter) this.view.canvas.style.filter = filter
  }

  // ======================================================================
  //  ONBOARDING COACH — teach-by-doing, never blocks, auto-advances if the
  //  player runs ahead. Steps persist (ftue) so a retry never re-teaches.
  // ======================================================================
  private runCoach(): void {
    const c = this.coach
    if (!c) { this.coachStep = 'off'; return }
    const s = this.sim
    if (s.state === 'won' || s.state === 'lost' || s.state === 'draft' || this.paused) { c.clear(); return }
    switch (this.coachStep) {
      case 'pickTower': {
        if (this.towersBuilt > 0) { this.coachStep = 'start'; break } // they figured it out
        if (this.buildKind) { this.coachStep = 'placeTower'; break }
        c.say('Tap the FLAME tower', '“Small strokes first, little brush.” — Maddervane')
        const btn = this.hud.towerButtonEl('flame')
        c.ring(btn)
        c.pointAtEl(btn)
        break
      }
      case 'placeTower': {
        if (this.towersBuilt > 0) { ftue.markDone('l1-place'); this.coachStep = 'start'; break }
        if (!this.buildKind) { this.coachStep = 'pickTower'; break } // backed out of build mode
        c.say('Now tap the glowing tile at the bend', 'Corners see the road twice — double the shots')
        c.ring(null)
        const cell = this.bestTeachCell()
        if (cell) {
          const p = this.view.projectToScreen(cell.x, cell.y, 0)
          if (p.visible) c.pointAt(p.x, p.y)
          else c.hidePointer()
        }
        break
      }
      case 'start': {
        if (s.state !== 'prep') { ftue.markDone('l1-start'); c.clear(); this.coachStep = 'watch'; break }
        c.say('Press START to send them in', 'Starting early pays bonus gold — courage is a currency')
        const btn = this.hud.startButtonEl()
        c.ring(btn)
        c.pointAtEl(btn)
        break
      }
      case 'watch': {
        if (s.state === 'prep' && s.waveIndex >= 1) this.coachStep = 'frost'
        break
      }
      case 'frost': {
        const hasFrost = s.towers.some((t) => t.active && t.kind === 'frost')
        if (hasFrost) {
          ftue.markDone('l1-combo')
          c.clear()
          c.say('Fire + Water on the same foe…', '⚡ THERMAL SHOCK — watch the colour come back', 6000)
          this.coachStep = 'upgradeWait'
          break
        }
        if (s.state !== 'prep') { this.coachStep = 'upgradeWait'; break } // never nag mid-wave
        if (this.buildKind === 'frost') {
          c.ring(null)
          c.say('Place FROST beside your Flame', 'Two elements, one victim — that\'s a REACTION')
          const cell = this.cellBesideFirstTower()
          if (cell) {
            const p = this.view.projectToScreen(cell.x, cell.y, 0)
            if (p.visible) c.pointAt(p.x, p.y)
            else c.hidePointer()
          }
        } else {
          c.say('Add a FROST tower next to your Flame', 'Fire + Water on the same foe = ⚡ THERMAL SHOCK')
          const btn = this.hud.towerButtonEl('frost')
          c.ring(btn)
          c.pointAtEl(btn)
        }
        break
      }
      case 'upgradeWait': {
        if (s.state === 'prep' && s.waveIndex >= 2) this.coachStep = 'upgrade'
        break
      }
      case 'upgrade': {
        const upgraded = s.towers.some((t) => t.active && t.level > 0)
        if (upgraded) { ftue.markDone('l1-upgrade'); c.clear(); this.coachStep = 'heroWait'; break }
        if (s.state !== 'prep') { this.coachStep = 'heroWait'; break }
        if (this.selectedId != null) { c.clear(); break } // panel open — it takes over
        c.say('Tap a tower, then UPGRADE it', 'One strong tower beats two weak ones')
        c.ring(null)
        const t = s.towers.find((tw) => tw.active)
        if (t) {
          const p = this.view.projectToScreen(t.x, t.y, 0.6)
          if (p.visible) c.pointAt(p.x, p.y)
          else c.hidePointer()
        } else {
          c.hidePointer()
        }
        break
      }
      case 'heroWait': {
        if (s.state === 'prep' && s.waveIndex >= 3) this.coachStep = 'hero'
        break
      }
      case 'hero': {
        const party = s.partyLoadout()
        if (party.length === 0 || s.deployedHeroes().length > 0) { this.finishCoach(); break }
        if (s.state !== 'prep') { this.finishCoach(); break }
        const first = party[0]
        if (this.buildHeroId) {
          c.ring(null)
          c.hidePointer()
          c.say(`Set ${first.def.name} on any free tile`, 'Heroes fight beside your towers — and cast on demand')
        } else {
          c.say(`Deploy ${first.def.name}, your first hero`, 'Tap the portrait, then tap a tile')
          const btn = this.hud.heroButtonEl(first.heroId)
          c.ring(btn)
          c.pointAtEl(btn)
        }
        break
      }
    }
  }

  private finishCoach(): void {
    ftue.markDone('l1-hero')
    ftue.markDone('l1-core')
    this.coach?.clear()
    this.coach?.say('You know everything that matters', 'The rest is paint. Bring the colour home.', 5000)
    this.coachStep = 'done'
  }

  // The teach cell: a free build tile touching the MOST path tiles (a bend sees
  // the road twice), tie-broken toward the board centre. Cached per battle.
  private bestTeachCell(): { x: number; y: number } | null {
    if (this.coachCellSim) return this.coachCellSim
    const g = this.sim.grid
    let best: { col: number; row: number } | null = null
    let bestScore = -1
    for (const cand of this.sim.buildCells()) {
      if (!this.sim.canPlace(cand.col, cand.row)) continue
      let paths = 0
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const r = cand.row + dr
        const cc = cand.col + dc
        if (r >= 0 && r < g.length && cc >= 0 && cc < g[0].length && g[r][cc] === 'path') paths++
      }
      const score = paths * 10 - Math.abs(cand.col - 4) - Math.abs(cand.row - 5) * 0.5
      if (score > bestScore) { bestScore = score; best = cand }
    }
    if (!best) return null
    this.coachCellSim = cellCenter(best.col, best.row)
    return this.coachCellSim
  }

  // A free tile orthogonally beside the player's first tower (for the Frost step).
  private cellBesideFirstTower(): { x: number; y: number } | null {
    const t = this.sim.towers.find((tw) => tw.active)
    if (!t) return this.bestTeachCell()
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      if (this.sim.canPlace(t.col + dc, t.row + dr)) return cellCenter(t.col + dc, t.row + dr)
    }
    return this.bestTeachCell()
  }

  private hudCtx(): HudContext {
    return {
      endless: this.endless,
      levelName: this.level.name,
      totalWaves: this.endless ? Infinity : this.level.waves.length,
      towerUnlocked: (k) => this.towerUnlocked(k),
      buildKind: this.buildKind,
      buildHeroId: this.buildHeroId,
      selectedId: this.selectedId,
    }
  }

  // ======================================================================
  //  INPUT
  // ======================================================================
  // A CLEAN tap on the board (the gesture layer already filtered out pans,
  // pinches and rotates — a drag can never misfire a build or select).
  private handleTap(x: number, y: number): void {
    if (!this.sim) return
    if (this.sim.state === 'won' || this.sim.state === 'lost' || this.sim.state === 'draft') return
    if (this.paused) return

    if (this.mode === 'aiming') {
      // The spell button is a DOM click (never a canvas tap), so the FIRST
      // canvas tap here is the intended aim — no "just entered" tap to swallow.
      const p = this.view.pickPoint(x, y)
      if (p && this.inMap(p.x, p.y)) {
        if (this.aimingHeroSlot != null) this.sim.castHeroSpell(this.aimingHeroSlot, p.x, p.y)
        else if (this.aimingSpell) this.sim.castSpell(this.aimingSpell, p.x, p.y)
      }
      this.exitAiming()
      return
    }

    const cell = this.view.pickCell(x, y)
    if (!cell) { if (this.mode === 'idle') this.deselect(); return }

    if (this.mode === 'building') { this.tryPlace(cell.col, cell.row); return }
    if (this.mode === 'deploying') { this.tryDeploy(cell.col, cell.row); return }

    const t = this.sim.towerAt(cell.col, cell.row)
    if (t) this.selectTower(t.id)
    else this.deselect() // tap on empty board: deselect + close panels
  }

  private handleHover(x: number, y: number): void {
    if (!this.sim) return
    if (this.mode === 'building' || this.mode === 'deploying') {
      const cell = this.view.pickCell(x, y)
      this.view.setHover(cell, cell ? this.sim.canPlace(cell.col, cell.row) : false)
    } else if (this.mode === 'aiming') {
      const cell = this.view.pickCell(x, y)
      this.view.setHover(cell, true)
    }
  }

  private inMap(x: number, y: number): boolean {
    return x >= MAP_X && x < MAP_X + MAP_W && y >= MAP_Y && y < MAP_Y + MAP_H
  }

  private onTowerButton(kind: TowerKind): void {
    if (this.sim.state === 'won' || this.sim.state === 'lost' || this.sim.state === 'draft') return
    if (!this.towerUnlocked(kind)) { this.hud.banner('LOCKED — clear levels to unlock', 0xff5b7a); return }
    this.exitAiming()
    this.exitDeploy()
    this.deselect()
    if (this.buildKind === kind) { this.exitBuild(); return }
    this.buildKind = kind
    this.mode = 'building'
    this.view.setHover(null, false)
    this.view.setBuildHighlight(true)
  }

  private exitBuild(): void {
    this.buildKind = null
    if (this.mode === 'building') this.mode = 'idle'
    this.view.setHover(null, false)
    this.view.setBuildHighlight(false)
  }

  // A party-hero button: DEPLOY it if not yet fielded, else CAST its spell.
  private onHeroButton(heroId: string): void {
    if (this.sim.state === 'won' || this.sim.state === 'lost' || this.sim.state === 'draft') return
    const deployed = this.sim.deployedHeroes().find((h) => h.heroId === heroId)
    if (deployed) {
      if (deployed.spellCd > 0) return
      this.exitBuild()
      this.exitDeploy()
      this.deselect()
      if (deployed.spell.targeted) {
        this.mode = 'aiming'
        this.aimingSpell = null
        this.aimingHeroSlot = deployed.id
      } else {
        this.sim.castHeroSpell(deployed.id, deployed.x, deployed.y)
      }
      return
    }
    // not yet on the field → enter deploy mode
    if (!this.sim.partyLoadout().some((p) => p.heroId === heroId)) return
    this.exitAiming()
    this.exitBuild()
    this.deselect()
    if (this.buildHeroId === heroId) { this.exitDeploy(); return }
    this.buildHeroId = heroId
    this.mode = 'deploying'
    this.view.setHover(null, false)
    this.view.setBuildHighlight(true)
  }

  private exitDeploy(): void {
    this.buildHeroId = null
    if (this.mode === 'deploying') this.mode = 'idle'
    this.view.setHover(null, false)
    this.view.setBuildHighlight(false)
  }

  private tryDeploy(col: number, row: number): void {
    if (!this.buildHeroId) return
    const cc = cellCenter(col, row)
    if (!this.sim.canPlace(col, row)) { this.floatAt(cc.x, cc.y, 'CANT DEPLOY', 0xff5b7a, 22); return }
    const cost = this.sim.heroDeployCost(this.buildHeroId)
    if (this.sim.gold < cost) { this.floatAt(cc.x, cc.y, 'NEED GOLD', 0xff5b7a, 22); return }
    const h = this.sim.deployHero(this.buildHeroId, col, row)
    if (h) {
      this.exitDeploy() // one deploy per hero → drop out of deploy mode
      if (unlockCodex('hero-' + h.heroId)) this.hud.banner('✎ SKETCHBOOK UPDATED', 0xc9b6ff)
      if (h.sigAwake && unlockCodex('field-signature')) this.hud.banner('✎ SKETCHBOOK UPDATED', 0xc9b6ff)
      if (this.sim.activeResonances().length > 0 && unlockCodex('field-resonance')) this.hud.banner('✎ SKETCHBOOK UPDATED', 0xc9b6ff)
      this.tryBark('deploy', h.heroId)
      // party-composition banter: once a second hero stands on the field, the
      // squad might have something to say to each other (both must be fielded)
      const fielded = this.sim.deployedHeroes().map((d) => d.heroId)
      if (fielded.length >= 2) {
        window.clearTimeout(this.pairTimer)
        this.pairTimer = window.setTimeout(() => {
          if (!this.sim || this.sim.state === 'won' || this.sim.state === 'lost') return
          const bark = barkEngine.pick('pair', { party: fielded }, this.barkNow())
          if (bark) this.hud.chatBark(bark.speaker, bark.text)
        }, 2600)
      }
    }
  }

  // ask the engine for a line; it may say "not now" (rate limits) — that's fine.
  // Lines land in the docked chat feed, never floating over the board.
  private tryBark(trigger: Parameters<typeof barkEngine.pick>[0], heroId?: string): void {
    const realmId = this.endless ? undefined : realmForLevel(this.levelId).id
    const bark = barkEngine.pick(trigger, { party: this.partyIds, heroId, realmId }, this.barkNow())
    if (bark) this.hud.chatBark(bark.speaker, bark.text)
  }

  private onSpellButton(key: SpellKey): void {
    if (this.sim.state === 'won' || this.sim.state === 'lost' || this.sim.state === 'draft') return
    if (this.sim.spellCd[key] > 0) return
    const def = SPELLS[key]
    if (def.targeted) {
      this.exitBuild()
      this.exitDeploy()
      this.deselect()
      this.mode = 'aiming'
      this.aimingSpell = key
      this.aimingHeroSlot = null
    } else {
      this.sim.castSpell(key, 360, MAP_Y + MAP_H / 2)
    }
  }

  private exitAiming(): void {
    this.aimingSpell = null
    this.aimingHeroSlot = null
    if (this.mode === 'aiming') this.mode = 'idle'
    this.view.setHover(null, false)
  }

  private tryPlace(col: number, row: number): void {
    if (!this.buildKind) return
    const cc = cellCenter(col, row)
    if (!this.sim.canPlace(col, row)) { this.floatAt(cc.x, cc.y, 'CANT BUILD', 0xff5b7a, 22); return }
    if (this.sim.gold < this.sim.placeCost(this.buildKind)) { this.floatAt(cc.x, cc.y, 'NEED GOLD', 0xff5b7a, 22); return }
    const placed = this.sim.placeTower(this.buildKind, col, row)
    if (placed) {
      this.towersBuilt++
      // KPI instrumentation: time-to-first-tower (first-ever only; guards inside)
      if (!this.firstTowerRecorded && !this.attract) {
        this.firstTowerRecorded = true
        ftue.recordFirstTower(this.battleT)
      }
    }
    if (placed && this.sim.activeResonances().length > 0 && unlockCodex('field-resonance')) {
      this.hud.banner('✎ SKETCHBOOK UPDATED', 0xc9b6ff)
    }
    if (placed && this.sim.gold < this.sim.placeCost(this.buildKind)) this.exitBuild()
  }

  private selectTower(id: number): void {
    this.selectedId = id
    this.hud.showUpgrade(this.sim, id)
  }
  private deselect(): void {
    this.selectedId = null
    this.hud.hideUpgrade()
  }
  private cycleTargeting(id: number): void {
    const t = this.sim.towerById(id)
    if (!t) return
    const next = TARGET_MODES[(TARGET_MODES.indexOf(t.targeting) + 1) % TARGET_MODES.length]
    this.sim.setTargeting(id, next)
    this.hud.showUpgrade(this.sim, id)
  }

  private towerUnlocked(kind: TowerKind): boolean {
    return this.endless || this.demoMode || economy.isTowerUnlocked(kind)
  }

  // ======================================================================
  //  DRAFT / PAUSE / RESULT
  // ======================================================================
  private enterDraftUi(): void {
    this.exitBuild()
    this.exitAiming()
    this.exitDeploy()
    this.deselect()
    this.hud.showDraft(this.sim)
  }
  private pickDraft(i: number): void {
    if (this.sim.state !== 'draft') return
    const card = this.sim.draftOffer[i]
    if (card) { this.hud.flash(card.color, 0.4); battleSfx.draftPick() }
    this.sim.chooseDraft(i)
    this.hud.hideDraft()
    this.draftShown = false
  }

  private togglePause(): void {
    if (this.sim.state === 'won' || this.sim.state === 'lost') return
    this.paused = !this.paused
    this.hud.setPauseIcon(this.paused)
    if (this.paused) {
      this.exitBuild()
      this.exitAiming()
      this.exitDeploy()
      this.hud.showPause(this.endless, { code: this.seedCode, link: this.runLink() })
    } else {
      this.hud.hidePause()
    }
  }

  private toggleSpeed(): void {
    this.gameSpeed = this.gameSpeed === 1 ? 2 : 1
    this.hud.setSpeed(this.gameSpeed)
  }

  private quitBattle(): void {
    if (this.endless) {
      economy.awardEndless(this.sim.waveIndex)
      this.awardHeroes(this.endlessShards(), this.endlessXp())
    }
    this.scene.start(this.endless ? 'Menu' : 'Map')
  }

  // Free hero currency + XP earned by playing (the provably-fair progression path).
  private awardHeroes(shards: number, xpEach: number): number {
    economy.awardHeroProgress(economy.party(), xpEach, shards)
    return shards
  }
  private endlessShards(): number { return 8 + Math.round(this.sim.waveIndex * 2.5) }
  private endlessXp(): number { return 30 + this.sim.waveIndex * 8 }

  // The full deep link for THIS run (level-scoped for campaign/demo, plain for
  // endless). Fused with the player's ?ref= so every shared run is ALSO an invite
  // (the prove-it card, attract card, pause + copy buttons all flow through here).
  private runLink(): string {
    return withRef(seedLink(this.seedCode, this.endless ? undefined : this.level.id))
  }

  // The prove-it card payload: pure function of the finished sim + run identity.
  private buildShare(win: boolean): ShareCardOpts {
    const rs = this.sim.runStats
    let bestName = ''
    let bestN = 0
    for (const [name, n] of Object.entries(rs.reactionCounts)) {
      if (n > bestN) { bestN = n; bestName = name }
    }
    let comboHighlight = bestName
      ? `${bestName} ×${bestN} · combo ×${rs.maxCombo}`
      : rs.maxCombo > 1 ? `combo ×${rs.maxCombo}` : `${rs.kills} restored`
    if (rs.fusions > 0) comboHighlight += ` · ⚛ ×${rs.fusions}`
    const deployed = this.sim.deployedHeroes()
    const heroName = deployed[0]?.def.name ?? this.sim.partyLoadout()[0]?.def.name ?? 'No hero'
    const totalWaves = this.endless ? Infinity : this.level.waves.length
    const wave = win && !this.endless ? this.level.waves.length : this.sim.waveIndex + 1
    const realm = realmForLevel(this.levelId)
    const headline = win
      ? this.demoMode ? 'EMBER VALE RESTORED' : this.endless ? `SURVIVED TO WAVE ${wave}` : 'RESTORED IN FULL COLOUR'
      : `FELL AT WAVE ${wave}`
    return {
      code: this.seedCode,
      link: this.runLink(),
      headline,
      levelName: this.level.name,
      heroName,
      score: this.sim.score(),
      wave,
      totalWaves,
      comboHighlight,
      accent: realm.ui.accent,
      accent2: '#ffd54a',
      win,
    }
  }

  // Turn the run's evidence (what leaked, what stood, what was hoarded) into
  // ONE actionable lesson for the defeat screen. Pure diagnosis, no state.
  private buildDefeatLesson(): string {
    const wave = this.level.waves[Math.min(this.sim.waveIndex, this.level.waves.length - 1)]
    return deathLesson({
      leakKinds: this.leakKinds,
      towerKinds: [...new Set(this.sim.towers.filter((t) => t.active).map((t) => t.kind))],
      towersBuilt: this.towersBuilt,
      goldLeft: this.sim.gold,
      hadAntiAir: this.sim.towers.some((t) => t.active && TOWERS[t.kind].antiAir),
      waveHadHealers: !!wave && wave.entries.some((e) => e.kind === 'healer'),
    })
  }

  private showResult(): void {
    this.resultShown = true
    this.exitBuild()
    this.exitAiming()
    this.exitDeploy()
    this.deselect()
    this.coach?.clear() // the coach never talks over a result screen
    const win = this.sim.state === 'won'
    // opt-in funnel: records the battle outcome + deaths-by-level (no-op without consent)
    if (!this.attract && !this.demoMode) analytics.recordBattleEnd(this.levelId, { win, wave: this.sim.waveIndex })
    // hands-free reel: bloom, then its own end card (prove-it + PLAY CTA)
    if (this.attract) {
      if (win && !appSettings.reducedMotion()) this.greyBloomT = 1.4
      if (win) { this.view.bloomPulse(0.5); battleSfx.victory() }
      window.setTimeout(() => this.showAttractEnd(win), win ? 2400 : 800)
      if (win) this.tryBark('victory')
      return
    }
    if (win) {
      if (this.levelId === 'l1') ftue.markDone('l1-core') // graduated — never coach again
      // victory colour-BLOOM: the level snaps back to full colour with an overshoot,
      // the post-process glow itself surges, and the swell sings it home
      // (reduce-motion users still get full colour, just without the pulse)
      if (!appSettings.reducedMotion()) this.greyBloomT = 1.4
      this.view.bloomPulse(0.5)
      battleSfx.victory()
      const stars = starsForClear(this.sim.lives, this.sim.startLives)
      const result = economy.awardCampaign(this.level.id, stars, this.level.baseCoins)
      // Difficulty/challenge badges are earned on any clear of a non-normal run.
      if (!isNormalMode(this.runMode)) {
        const fresh = economy.recordBadges(this.level.id, badgesForClear(this.runMode))
        if (fresh.length > 0) this.hud.banner(`BADGE EARNED · ${fresh.map((b) => BADGE_META[b]?.label ?? b).join(' + ')}`, 0xffd873)
      }
      const shards = this.awardHeroes(20 + stars * 12, 55 + stars * 30)
      let unlocked: string | null = null
      if (result.firstClear && this.level.unlockTower && !economy.isTowerUnlocked(this.level.unlockTower)) {
        economy.unlockTower(this.level.unlockTower)
        unlocked = TOWERS[this.level.unlockTower].name
      }
      this.hud.flash(0x2ff7c3, 0.4)
      this.hud.showResult({
        win: true, title: this.demoMode ? 'THE VALE BLOOMS!' : 'VICTORY!', color: 0x2ff7c3, stars,
        coins: result.coins, diamonds: result.diamonds, shards, unlocked, endless: this.endless,
        share: this.buildShare(true),
        // demo: guest progress carries straight into the full game
        continueLabel: this.demoMode ? 'CONTINUE INTO THE FULL GAME →' : undefined,
        onContinue: this.demoMode ? () => this.scene.start('Map') : undefined,
      })
      this.tryBark('victory') // post-victory beat: Color Bloom + one line over the card
      // GROWTH HYBRID: the welcome bundle LANDS right after the first felt win
      // (the demo or first campaign clear) — the activation + account hook. Never
      // in attract (headless capture / landing embed must not claim). After the
      // celebratory claim, offer the PWA install (a completed critical journey).
      if (!this.attract && economy.welcomeAvailable()) {
        window.setTimeout(() => showWelcomeReward(() => showInstallCard()), 1100)
      }
    } else {
      this.hud.flash(0xff3b6b, 0.5)
      battleSfx.defeat()
      if (this.endless) {
        const res = economy.awardEndless(this.sim.waveIndex)
        const shards = this.awardHeroes(this.endlessShards(), this.endlessXp())
        // Daily runs also log a PURELY LOCAL best-for-today (habit loop; no backend).
        let dailyPb = false
        if (this.isDaily) dailyPb = recordDailyResult(utcDayIndex(), this.sim.waveIndex + 1)
        const bestTag = res.best ? ' · NEW BEST!' : dailyPb ? ' · DAILY PB!' : ''
        this.hud.showResult({ win: false, title: 'DEFEAT', color: 0xff5b7a, stars: 0, coins: res.coins, diamonds: 0, shards, unlocked: null, sub: `Reached wave ${this.sim.waveIndex + 1}${bestTag}`, endless: true, share: this.buildShare(false) })
      } else {
        // DEATH TEACHES: diagnose the loss into one actionable lesson, and the
        // retry button replays the SAME seed — the player knows the whole plan.
        ftue.recordDefeat()
        this.hud.showResult({ win: false, title: 'DEFEAT', color: 0xff5b7a, stars: 0, coins: 0, diamonds: 0, shards: 0, unlocked: null, sub: 'The crystal was overrun…', endless: false, lesson: this.buildDefeatLesson(), share: this.buildShare(false) })
        this.tryBark('defeat') // Morose condoles — he always does
      }
    }
  }

  // The reel's final frame: prove-it card + the seed challenge + one-tap PLAY.
  // Doubles as the trailer's closing shot and the landing embed's CTA.
  private showAttractEnd(win: boolean): void {
    this.takeoverEl?.remove()
    this.takeoverEl = null
    this.captionEl?.remove()
    this.captionEl = null
    const ov = document.createElement('div')
    ov.style.cssText =
      'position:fixed;inset:0;z-index:4200;display:flex;flex-direction:column;align-items:center;justify-content:center;' +
      'gap:18px;background:rgba(8,5,18,.78);backdrop-filter:blur(4px);opacity:0;transition:opacity .6s ease;' +
      'font-family:"Baloo 2","Nunito",system-ui,sans-serif;color:#fff;text-align:center;padding:20px;'
    const card = renderShareCard(this.buildShare(win))
    card.style.cssText = 'width:min(88vw,480px);height:auto;border-radius:14px;box-shadow:0 12px 44px rgba(0,0,0,.6);'
    const line = document.createElement('div')
    line.textContent = win ? 'Everything you just watched is real gameplay.' : 'Even the reel bleeds. Your turn.'
    line.style.cssText = 'font-size:clamp(15px,3.6vw,21px);font-weight:700;color:#d8ccff;'
    const cta = document.createElement('button')
    cta.textContent = '🎨  PLAY FREE NOW'
    cta.style.cssText =
      'padding:16px 44px;border-radius:18px;border:1px solid rgba(255,255,255,.3);cursor:pointer;color:#fff;' +
      'font:900 22px "Baloo 2","Nunito",system-ui,sans-serif;letter-spacing:1px;' +
      'background:linear-gradient(180deg,#3ad07a,#1f9a54);box-shadow:0 8px 30px rgba(46,220,130,.4);'
    cta.onclick = () => { window.location.href = window.location.origin + window.location.pathname + '?demo=1' }
    // welcome-bundle enticement — advertise the reward up front so it magnetizes
    // the click (the celebratory claim lands after the quick demo win).
    const bundle = document.createElement('div')
    bundle.textContent = '🎁 Finish the quick demo → claim 2000💎 + an exclusive starter skin'
    bundle.style.cssText = 'font-size:clamp(12px,3vw,15px);font-weight:700;color:#ffe9a8;'
    const seedBtn = document.createElement('button')
    seedBtn.textContent = `🔗 seed ${this.seedCode} — copy the challenge link`
    seedBtn.style.cssText =
      'padding:10px 22px;border-radius:12px;border:1px solid rgba(255,255,255,.25);cursor:pointer;color:#cbe9ff;' +
      'font:700 15px ui-monospace,Menlo,monospace;background:rgba(255,255,255,.08);'
    seedBtn.onclick = async () => {
      const ok = await copyText(this.runLink())
      seedBtn.textContent = ok ? '✓ link copied — go beat it' : '✗ copy failed'
    }
    ov.append(card, line, cta, bundle, seedBtn)
    document.body.appendChild(ov)
    requestAnimationFrame(() => { ov.style.opacity = '1' })
    this.attractEndEl = ov
    // landing-hero loop: run it again for the next passer-by
    if (this.loopReel) window.setTimeout(() => window.location.reload(), 16000)
  }

  // ======================================================================
  //  SIM EVENTS → JUICE
  // ======================================================================
  private floatAt(simX: number, simY: number, msg: string, color: number, size: number, style: 'norm' | 'combo' | 'crit' = 'norm', h = 0.8): void {
    const s = this.view.projectToScreen(simX, simY, h)
    if (s.visible) this.hud.floatText(s.x, s.y, msg, color, size, style)
  }

  private handleEvent(ev: SimEvent): void {
    switch (ev.t) {
      case 'damage': {
        const n = Math.max(1, Math.round(ev.amount))
        const color = ev.eff === 'strong' ? 0x8dff4a : ev.eff === 'weak' ? 0xb8b0d0 : 0xffffff
        const arrow = ev.eff === 'strong' ? ' ↑' : ev.eff === 'weak' ? ' ↓' : ''
        // numbers GROW with the blow: base by effectiveness, plus combo and raw amount
        const size = (ev.eff === 'strong' ? 24 : 20) + Math.min(26, ev.combo * 3) + Math.min(10, Math.round(n / 12))
        const style = ev.eff === 'strong' ? 'crit' : ev.combo > 0 ? 'combo' : 'norm'
        this.floatAt(ev.x, ev.y, `${n}${arrow}`, color, size, style)
        break
      }
      case 'death':
        this.view.fxDeath(ev.x, ev.y, ev.color, ev.boss, ev.kind)
        battleSfx.kill(this.sim.comboCount, ev.boss)
        if (ev.boss) { this.hud.flash(0xff6ad5, 0.35); this.hitstopT = 0.22; this.view.bloomPulse(0.3); this.tryBark('kill') }
        // Bestiary — "The Greyed" fills in as the player frees each kind (never keepers).
        if (ev.kind !== 'keeper' && unlockEnemyCodex(ev.kind)) this.hud.banner('✎ SKETCHBOOK UPDATED', 0xc9b6ff)
        break
      case 'shieldBreak':
        this.floatAt(ev.x, ev.y, 'SHIELD BREAK!', 0x9fdcff, 22)
        this.view.fxAoe(ev.x, ev.y, ev.radius + 20, 0x9fdcff, 0.9)
        this.view.shake(0.05)
        this.hitstopT = Math.max(this.hitstopT, 0.04)
        battleSfx.shieldBreak()
        break
      case 'leak':
        this.hud.flash(0xff3b3b, 0.4)
        this.view.shake(0.08)
        battleSfx.leak(ev.boss)
        this.leakKinds[ev.kind] = (this.leakKinds[ev.kind] ?? 0) + 1 // death teaches
        break
      case 'towerFire':
        this.view.fxMuzzle(ev.x, ev.y, ev.tx, ev.ty, ev.color, ev.kind)
        battleSfx.shot(ev.kind)
        break
      case 'hit':
        this.view.fxHit(ev.x, ev.y, ev.color)
        battleSfx.hit()
        break
      case 'chain':
        this.view.fxChain(ev.points, ev.color, ev.supercharged)
        // (renamed from SHATTER — that name now belongs to the Water+Storm reaction)
        if (ev.supercharged) { this.hud.waveBanner('❄⚡ SUPERCHARGED!'); this.hitstopT = Math.max(this.hitstopT, 0.12); battleSfx.reaction() }
        if (ev.count > 1) {
          const last = ev.points[ev.points.length - 1]
          this.floatAt(last[0], last[1], `CHAIN ×${ev.count}`, 0xffe14a, 20)
        }
        break
      case 'aoe':
        this.view.fxAoe(ev.x, ev.y, ev.radius, ev.color, ev.alpha)
        break
      case 'combo':
        this.floatAt(ev.x, ev.y, `COMBO ×${ev.count}!`, comboHue(ev.count), 28 + Math.min(30, ev.count * 3), 'combo', 1.1)
        if (ev.milestone) { this.hud.flash(comboHue(ev.count), 0.25); battleSfx.combo(ev.count) }
        if (ev.milestone && ev.count >= 10) this.tryBark('kill')
        break
      case 'heal':
        if (ev.radius > 0) this.view.fxAoe(ev.x, ev.y, ev.radius, 0x6bffb0, 0.5)
        else this.floatAt(ev.x, ev.y, `+${ev.amount}`, 0x6bffb0, 18)
        break
      case 'gold':
        if (ev.amount >= 4) {
          const s = this.view.projectToScreen(ev.x, ev.y, 0.8)
          if (s.visible) this.hud.coinBurst(s.x, s.y, ev.amount)
        }
        break
      case 'place':
        this.view.fxPlace(ev.x, ev.y, ev.color, ev.radius)
        battleSfx.place()
        break
      case 'upgrade':
        this.view.fxAoe(ev.x, ev.y, ev.radius, ev.color, 0.9)
        this.floatAt(ev.x, ev.y, ev.label, ev.color, 26)
        if (!ev.label.startsWith('⚛')) battleSfx.upgrade() // fusion has its own forge voice
        if (this.selectedId != null) this.hud.showUpgrade(this.sim, this.selectedId)
        break
      case 'spell':
        this.view.fxSpell(ev.key, ev.x, ev.y, ev.radius, ev.color)
        battleSfx.spell(ev.key === 'meteor')
        if (ev.key === 'meteor') this.hud.flash(0xffb15c, 0.35)
        else if (ev.key === 'freeze') { this.hud.flash(0x9fdcff, 0.4); if (ev.count > 0) this.hud.banner(`FROZEN ×${ev.count}!`, ev.color) }
        else this.floatAt(ev.x, ev.y, `+${ev.count} GOLD!`, 0xffd54a, 30)
        break
      case 'heroDeploy':
        this.view.fxHeroDeploy(ev.x, ev.y, ev.color, ev.radius)
        this.hud.flash(ev.color, 0.25)
        battleSfx.heroDeploy()
        break
      case 'heroFire':
        this.view.fxHeroFire(ev.x, ev.y, ev.tx, ev.ty, ev.color)
        battleSfx.shot('hero')
        break
      case 'heroSpell':
        this.view.fxHeroSpell(ev.effect, ev.x, ev.y, ev.radius, ev.color)
        this.hud.flash(ev.color, 0.4)
        this.hud.banner(ev.name.toUpperCase() + '!', ev.color)
        battleSfx.spell(ev.effect === 'aoeBurn' || ev.effect === 'execute')
        break
      case 'reaction':
        this.view.fxReaction(ev.x, ev.y, ev.radius, ev.color, ev.color2)
        this.floatAt(ev.x, ev.y, ev.name + '!', ev.color, 24, 'combo', 1.1)
        battleSfx.reaction()
        // the demo's scripted wow: the FIRST Shatter re-colours a slice of the vale
        if (this.demoMode && ev.key === 'shatter' && !this.shatterBloomDone) {
          this.shatterBloomDone = true
          if (!appSettings.reducedMotion()) this.greyBloomT = Math.max(this.greyBloomT, 1.0)
          this.view.bloomPulse(0.35)
          window.setTimeout(() => this.hud.banner('THE COLOUR RETURNS', 0x9fdcff), 450)
        }
        // the campaign's scripted first-wow: the FIRST-EVER reaction blooms colour
        // back across the field (L1's coach guarantees this lands inside 90s)
        if (!this.demoMode && !this.endless && !this.firstWowDone && ftue.data.firstWowS === undefined) {
          this.firstWowDone = true
          ftue.recordFirstWow(this.battleT)
          if (!appSettings.reducedMotion()) this.greyBloomT = Math.max(this.greyBloomT, 1.2)
          this.view.bloomPulse(0.4)
          window.setTimeout(() => this.hud.banner('THE COLOUR RETURNS', 0x9fdcff), 500)
        }
        if (this.reactCalloutCd <= 0) {
          this.hud.reactionCallout(ev.name, ev.color)
          this.reactCalloutCd = 0.55
          this.hitstopT = Math.max(this.hitstopT, 0.06)
        }
        if (unlockCodex('field-reactions')) this.hud.banner('✎ SKETCHBOOK UPDATED', 0xc9b6ff)
        // CROWN-JEWEL depth, made legible: log this reaction to the discovery
        // tracker and celebrate the FIRST time each of the nine is seen.
        if (recordReaction(ev.key)) {
          this.hud.banner(`NEW REACTION · ${reactionsDiscoveredCount()}/${REACTION_TOTAL} DISCOVERED`, ev.color)
        }
        this.tryBark('reaction')
        break
      case 'fuse':
        // FUSION FORGED — an earned spectacle: the partner flares out, the host
        // erupts in both colours, and the new tower's name slams on screen.
        this.view.fxReaction(ev.px, ev.py, 60, ev.color2, ev.color)
        this.view.fxReaction(ev.x, ev.y, 110, ev.color, ev.color2)
        this.view.bloomPulse(0.35)
        this.hud.flash(ev.color, 0.3)
        this.hud.reactionCallout(`⚛ ${ev.name}`, ev.color)
        this.hitstopT = Math.max(this.hitstopT, 0.1)
        battleSfx.fusion()
        if (unlockCodex('field-fusion')) this.hud.banner('✎ SKETCHBOOK UPDATED', 0xc9b6ff)
        this.tryBark('fusion')
        break
      case 'morose':
        // THE signature moment: Morose reaches into the battle and condoles.
        if (ev.kind === 'warn') {
          this.hud.moroseVeil(ev.duration + 0.6)
          playMoroseHush()
        } else if (ev.kind === 'greyTower') {
          this.hud.moroseVeil(ev.duration * 0.6)
          this.tryBark('moroseGrey')
          if (unlockCodex('field-intrusion')) this.hud.banner('✎ SKETCHBOOK UPDATED', 0xc9b6ff)
        } else {
          playMoroseHush()
          this.tryBark('moroseSteal')
          if (unlockCodex('field-morose-steal')) this.hud.banner('✎ SKETCHBOOK UPDATED', 0xc9b6ff)
        }
        break
      case 'keeper':
        this.handleKeeperEvent(ev)
        break
      case 'banner':
        this.hud.banner(ev.msg, ev.color)
        break
      case 'text':
        this.floatAt(ev.x, ev.y, ev.msg, ev.color, ev.size)
        break
    }
  }

  // A fallen Keeper's fight is a REDEMPTION, not a kill — so the boss speaks:
  // reveal → (the twisted hero answers) → the grey cracks (phase 2/3) → the
  // colour returns. Echoes are grey memories, not the friend, so they stay
  // silent. Pure delivery: reads the keeper event the sim already emits.
  private keeperTold = new Set<string>() // reveal/heroLine fired, per keeper id
  private keeperRedeemed = new Set<string>()
  private keeperTimers: number[] = [] // delayed stingers, cleared on teardown
  private handleKeeperEvent(ev: Extract<SimEvent, { t: 'keeper' }>): void {
    if (ev.echo) return // an echo is a memory of the fight, not the fight
    const k = KEEPER_BY_ID[ev.keeperId]
    if (!k) return
    if (ev.kind === 'reveal') {
      if (this.keeperTold.has(k.id)) return
      this.keeperTold.add(k.id)
      this.hud.chatBark(k.id, k.barks.reveal)
      this.hud.moroseVeil(1.6)
      // the twisted hero answers, if they are on the line
      if (this.partyIds.includes(k.heroId)) {
        this.keeperTimers.push(window.setTimeout(() => { if (!this.resultShown) this.hud.chatBark(k.heroId, k.barks.heroLine) }, 2100))
      }
    } else if (ev.kind === 'phase') {
      if (ev.phase === 2) this.hud.chatBark(k.id, k.barks.phase2)
      else if (ev.phase === 3) this.hud.chatBark(k.id, k.barks.phase3)
    } else if (ev.kind === 'redeemed') {
      if (this.keeperRedeemed.has(k.id)) return
      this.keeperRedeemed.add(k.id)
      // THE payoff beat: the grey breaks, the Keeper's true name returns in colour
      this.hud.chatBark(k.id, k.barks.redeemed)
      this.hud.banner(`✦ ${k.trueName.toUpperCase()} — REDEEMED`, k.enemy.accent)
      if (!appSettings.reducedMotion()) this.greyBloomT = Math.max(this.greyBloomT, 1.3)
      this.view.bloomPulse(0.45)
      battleSfx.reaction()
      if (unlockCodexBatch(CODEX_ON_KEEPER_REDEEM[k.id]) > 0) this.hud.banner('✎ SKETCHBOOK UPDATED', 0xc9b6ff)
      // Morose's thread stinger, a beat later — his reaction degrades across the six
      this.keeperTimers.push(window.setTimeout(() => { if (!this.resultShown) this.hud.chatBark('morose', k.barks.morose) }, 2600))
    }
  }

  // ======================================================================
  //  TEARDOWN (critical: dispose GL context every time we leave/restart)
  // ======================================================================
  private teardown(): void {
    this.camCtl?.dispose()
    this.camCtl = null
    window.removeEventListener('resize', this.onResize)
    window.clearTimeout(this.pairTimer)
    for (const t of this.keeperTimers) window.clearTimeout(t)
    this.keeperTimers = []
    this.script = null
    this.takeoverEl?.remove()
    this.takeoverEl = null
    this.captionEl?.remove()
    this.captionEl = null
    this.attractEndEl?.remove()
    this.attractEndEl = null
    this.coach?.dispose()
    this.coach = null
    this.hud?.dispose()
    this.view?.dispose()
  }
}

function comboHue(count: number): number {
  const t = Math.min(1, count * 0.08)
  const r = 255
  const g = Math.round(213 - t * 120)
  const b = Math.round(74 + t * 160)
  return (r << 16) | (g << 8) | b
}
