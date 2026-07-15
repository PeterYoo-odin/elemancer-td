// BattleScene — the ORCHESTRATOR. It owns no gameplay: it drives the pure sim,
// renders it through a Three.js WebGL view (BattleView3D) and a DOM/CSS HUD
// (BattleHud), forwards input into the sim, and turns semantic sim events into
// juice. Phaser is kept only as the app shell + scene router (Menu/Map/Shop/…);
// the battle board itself is real 3D on a full-window canvas above Phaser's.

import Phaser from 'phaser'
import { TOWERS, TOWER_ORDER, type TowerKind } from '../game/towers'
import { LEVELS, levelById, pathCellsFor, starsForClear, isLevelUnlocked, DEMO_LEVEL, type LevelDef } from '../game/levels'
import { SPELLS, type SpellKey } from '../game/spells'
import { economy } from '../game/economy'
import { NEUTRAL } from '../game/workshop'
import { NORMAL_MODE, levelForMode, startLivesForMode, towerCapForMode, partyAllowedForMode, modeSeedSalt, badgesForClear, isNormalMode, BADGE_META, type RunMode } from '../game/modes'
import { Sim, MAP_X, MAP_Y, MAP_W, MAP_H, TARGET_MODES, cellCenter, type SimEvent } from '../sim'
import { BattleView3D } from '../three/BattleView3D'
import { CameraControls } from '../three/cameraControls'
import { hideBrandLoader } from '../ui/brandLoader'
import { BattleHud, BANNER_PRIORITY, type HudContext } from '../ui/BattleHud'
import type { ShareCardOpts } from '../ui/ShareCard'
import { renderShareCard, copyText } from '../ui/ShareCard'
import { music } from '../ui/music'
import { appSettings } from '../ui/settings'
import { barkEngine, pairExchange } from '../game/barks'
import { heroById } from '../game/heroes'
import { towerPalette } from '../game/skins'
import { unlockCodex, recordReaction, reactionsDiscoveredCount, REACTION_TOTAL, unlockCodexBatch, unlockEnemyCodex, CODEX_ON_KEEPER_REDEEM } from '../game/codex'
import { KEEPER_BY_ID } from '../game/keepers'
import { realmForLevel, REALMS } from '../game/levels'
import { realmBackdrop } from '../game/realmBackdrops'
import { playMoroseHush, setSpectralOpenness, spectralDip, duckPunch, stepDuck, resetAudioScene } from '../ui/sfx'
import { battleSfx, panFor } from '../ui/battleSfx'
import { haptic, HAPTIC } from '../ui/haptics'
import { mountQaJuicePanel, unmountQaJuicePanel } from '../ui/qaJuicePanel'
import { heroVo } from '../ui/vo'
import { canonicalSeed, seedToCode, seedLink, utcDayIndex } from '../game/seedcode'
import { recordDailyResult } from '../game/daily'
import { rankedConfig, RunRecorder, rankedPeriod, GhostRunner, type RankedMode, type DeclaredHero } from '../game/ranked'
import { submitRun, fetchGhost } from '../game/rankedNet'
import { recordRankedLocal } from '../game/rankedLocal'
import { pathforgeLevel, recordPathforgeBest } from '../game/pathforge'
import { weeklyPlan, planHeadline, recordWeeklyBest, type WeeklyPlan } from '../game/events'
import { MUTATORS } from '../sim'
import { ScriptRunner, DEMO_SCRIPT, DEMO_SEED, DEMO_PARTY, DEMO_FROST_CELL } from '../game/attractScript'
import { DEMO_CINE_CUES, DEMO_CAPTIONS, CINE_HOME } from '../game/cinema'
import { ftue, LEVEL_LESSONS, deathLesson } from '../game/onboarding'
import { analytics } from '../game/analytics'
import { Coach } from '../ui/coach'
import { showWelcomeReward } from '../ui/WelcomeReward'
import { showInstallCard } from '../ui/pwa'
import { promptSaveAfterFirstWin } from '../ui/SignInModal'
import { withRef } from '../game/referral'
import { qa, type QaSceneControl, type QaState } from '../game/qa'
import { REACTIONS, type ReactionKey } from '../sim/reactions'

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

type InputMode = 'idle' | 'building' | 'deploying' | 'aiming' | 'moving'

export interface BattleLaunchData {
  levelId?: string
  difficulty?: import('../game/modes').Difficulty // campaign: 'heroic' scales waves
  challenge?: import('../game/modes').Challenge // campaign: iron / nohero / towers
  endless?: boolean
  roguelike?: boolean // ROGUELIKE endless: weekly mutator + relics + affixes (its own mode)
  demo?: boolean // "The Restoration of Ember Vale" — live play
  attract?: boolean // hands-free cinematic demo reel (?attract=1)
  seedOverride?: number // ?seed= deep link — the exact seeded run
  speed?: number // ?speed= capture control (attract)
  captions?: boolean // ?captions=0 disables the reel captions
  loop?: boolean // ?loop=1 restarts the reel after the end card
  daily?: boolean // launched from the in-game Daily screen — log the result locally
  weekly?: boolean // launched from the Ranked screen's Weekly board (shared weekly seed)
  ghostRunId?: string // race a downloaded top run's replay ghost alongside this run
  pathforge?: boolean // PATHFORGE: defend the player-built maze (seeded endless, local score)
  pathforgeMaze?: Array<[number, number]> // the committed spawn→base road route
  qaHeroId?: string // QA-only (window.__chromancer): force a single-hero party
}

export class BattleScene extends Phaser.Scene {
  private levelId = 'l1'
  private runMode: RunMode = NORMAL_MODE
  private endless = false
  private roguelike = false
  private roguePlan: import('../game/events').WeeklyPlan | null = null
  private demoMode = false
  private attract = false
  private seedOverride: number | undefined
  private qaCtl: QaSceneControl | null = null // QA-only: the bound drive surface
  private qaHeroId?: string // QA-only: force a single-hero party (window.__chromancer)
  private qaClock = 0 // QA-only: synthetic monotonic time fed to the driven update()
  private isDaily = false
  private pathforge = false
  private pathforgeMaze: Array<[number, number]> | null = null
  private captionsOn = true
  private loopReel = false
  private seed = 0
  private seedCode = ''
  // RANKED (provably-fair) run recording. `ranked` is true only for the pure,
  // normalized modes (daily / weekly / endless) — never demo/attract/campaign/
  // roguelike. When set, every player command is logged to `recorder` so the run
  // can be RE-RUN server-side and verified before it touches the leaderboard.
  private ranked = false
  private rankedMode: RankedMode = 'endless'
  private boardPeriod = 0
  private recorder: RunRecorder | null = null
  private rankedSubmitted = false
  private declaredParty: DeclaredHero[] = []
  // GHOST RACE — an async-downloaded top run replayed in lockstep alongside yours.
  private ghostRunId: string | undefined
  private ghost: GhostRunner | null = null
  private ghostEl: HTMLDivElement | null = null
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
  private selectedHeroSlot: number | null = null // a deployed hero whose panel is open
  private movingHeroSlot: number | null = null // hero armed for relocation (moving mode)
  private heroPanelT = 0 // throttles live refresh of the open hero panel's cooldown

  private camCtl: CameraControls | null = null
  private onResize = () => this.view?.resize()
  // Keyboard operability (accessibility): remappable hotkeys drive the core loop so
  // the game is playable without a pointer. Bindings live in appSettings.keybinds.
  private onKeyDown = (e: KeyboardEvent) => this.handleKey(e)
  private lastTime = 0
  private hitstopT = 0 // active freeze-frame timer (view + sim pacing only)
  private lastSimState = ''
  private reactCalloutCd = 0 // throttles the big reaction slam (bursts still always fire)
  private killStopCd = 0 // throttles the frequent minor freezes (elite kills, shield breaks) so a dense cull / pack-break can't chain-freeze the sim into a stutter

  // THE GREYING as rendering: the battlefield starts drained and colour returns
  // as the player clears it (CSS saturate filter on the 3D canvas — cheap, GPU-composited).
  private greySat = -1 // current smoothed saturation (-1 = uninitialised)
  private greyBloomT = 0 // victory colour-bloom timer

  // barks: character voice on semantic events (engine handles all rate limits)
  private partyIds: string[] = []
  private lowLivesBarked = false
  private pairTimer = 0
  private exchangeTimers: number[] = [] // pending back-and-forth line timers
  private shownPairs = new Set<string>() // pair keys already exchanged this battle
  private lastPairExchange = -999 // barkNow() of the last exchange (paces them)
  private barkNow(): number { return performance.now() / 1000 }
  // hero ARC metric tallies for THIS battle — flushed to economy on the result
  // screen (never during attract/demo). Cosmetic/lore progression, sim-inert.
  private arcCounts = new Map<string, { signature: number; spell: number; deploy: number }>()

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
    // ROGUELIKE is its OWN infinite mode (weekly mutator + relics + affixes). It
    // reuses the endless scaffolding (infinite waves + draft loop) but never writes
    // the Ranked ladder (endlessBest), so the provably-fair board stays pure.
    this.roguelike = !this.demoMode && !!data?.roguelike
    // PATHFORGE reuses the endless scaffolding (seeded infinite waves) on the player's
    // OWN maze. Its committed route rides the SAME ranked ladder as every other pure
    // mode (Chromancer#56) — the server re-validates the maze + re-runs the log before
    // it ever touches the board, so a tampered/illegal maze can't board a fake score.
    this.pathforge = !this.demoMode && !!data?.pathforge
    this.pathforgeMaze = (this.pathforge && data?.pathforgeMaze && data.pathforgeMaze.length >= 2)
      ? data.pathforgeMaze.map(([c, r]) => [c, r] as [number, number])
      : null
    this.endless = !this.demoMode && (!!data?.endless || this.roguelike || this.pathforge)
    this.levelId = this.demoMode ? 'demo' : data?.levelId ?? 'l1'
    // Difficulty/challenge modes apply to campaign play only (never demo/attract/endless).
    this.runMode = (this.demoMode || data?.endless)
      ? NORMAL_MODE
      : { difficulty: data?.difficulty ?? 'normal', challenge: data?.challenge ?? '' }
    this.seedOverride = data?.seedOverride
    this.qaHeroId = qa.enabled ? data?.qaHeroId : undefined
    this.isDaily = !!data?.daily
    // RANKED (provably-fair) = the pure normalized modes only. Roguelike is endless
    // but carries mutators/relics, so it rides its OWN weekly board, not this one.
    // PathForge only rides the ladder when it has a committed route to submit — an
    // invalid/missing maze (shouldn't happen from the real editor, but never trust
    // launch data) just plays locally instead of attempting a route-less ranked run.
    this.ranked = this.endless && !this.roguelike && !this.attract && !this.demoMode && (!this.pathforge || !!this.pathforgeMaze)
    this.rankedMode = this.isDaily ? 'daily' : data?.weekly ? 'weekly' : this.pathforge ? 'pathforge' : 'endless'
    this.ghostRunId = data?.ghostRunId
    // reset per-run ranked state (the scene instance is reused across restarts)
    this.recorder = null
    this.ghost = null
    this.rankedSubmitted = false
    this.declaredParty = []
    this.gameSpeed = this.attract ? Math.min(8, Math.max(0.25, data?.speed ?? 1)) : 1
    this.captionsOn = data?.captions !== false
    this.loopReel = !!data?.loop
  }

  create(): void {
    music.setTrack('battle')
    // per-realm musical colour for the adaptive tension bed
    music.setRealm(this.endless ? undefined : realmForLevel(this.levelId).id)
    // ---- run config ----
    const baseLevel = (this.pathforge && this.pathforgeMaze)
      ? pathforgeLevel(this.pathforgeMaze)
      : this.endless ? this.endlessLevel() : this.demoMode ? DEMO_LEVEL : levelById(this.levelId) ?? LEVELS[0]
    // Heroic scales the waves (deterministic, harder); other modes leave waves intact.
    this.level = levelForMode(baseLevel, this.runMode)
    // ROGUELIKE: resolve THIS week's shared plan (headline mutator + live event +
    // relic boosts) from the wall clock. The sim never reads the clock — it takes
    // the resolved RogueConfig verbatim, so the shared weekly seed replays for all.
    this.roguePlan = this.roguelike ? weeklyPlan(Date.now()) : null
    // Demo/attract runs are provably fair showcases: NEUTRAL modifiers always,
    // so a shared seed replays identically on every account.
    // PATHFORGE is a pure-skill board: NEUTRAL modifiers (no purchased advantage),
    // exactly like demo/ranked, so "same seed + open grid" stays fair.
    const mods = (this.demoMode || this.pathforge) ? { ...NEUTRAL } : economy.runModifiers(this.endless)
    // ASSIST (accessibility): a personal, opt-in easier ride for NORMAL campaign play
    // only — never endless/ranked/demo, so leaderboards and showcases stay fair. It
    // only ever GRANTS resources (never makes the game harder) and adds no immunities.
    const assistNormal = !this.demoMode && !this.attract && !this.endless && isNormalMode(this.runMode)
    const assist = assistNormal ? appSettings.data.assist : 'off'
    const assistLives = assist === 'cozy' ? 12 : assist === 'relaxed' ? 5 : 0
    const assistGoldMult = assist === 'cozy' ? 1.5 : assist === 'relaxed' ? 1.2 : 1
    const startGold = this.endless ? ENDLESS_START_GOLD : Math.round((this.level.startGold + mods.startGoldBonus) * assistGoldMult)
    // Iron mode = one life; otherwise the level's lives + meta bonus (+ assist).
    const startLives = this.endless ? ENDLESS_START_LIVES : startLivesForMode(this.level.startLives + mods.startLivesBonus, this.runMode) + assistLives
    // Every run's seed lives in the shareable WORD-WORD-NN code space, so the
    // "Copy seed link" on ANY run reproduces it exactly.
    const rawSeed = this.roguelike
      ? this.roguePlan!.seed // the SHARED weekly seed — everyone's board runs this
      : this.endless
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
    // ROGUELIKE feeds the shared WEEKLY BOARD, so hero power is NORMALIZED exactly
    // like Ranked — every account on the week's seed compares fairly (the wildness
    // comes from seed-fair relics/mutators, never from grind/purchases). Its own MODE
    // (relics, curses, affixes, mutators); still provably fair on the leaderboard.
    let party = this.attract
      ? DEMO_PARTY.map((p) => ({ ...p }))
      : this.endless // covers Ranked AND roguelike — both normalized
        ? economy.rankedParty()
        : partyAllowedForMode(this.runMode) // No-Hero challenge: leave the champions home
          ? economy.party().map((id) => ({ heroId: id, level: economy.heroState(id).level, wyrm: economy.bondEntry(id) }))
          : []
    // QA-only: override the loadout to a single requested hero (never in normal play).
    if (this.qaHeroId && heroById(this.qaHeroId)) party = [{ heroId: this.qaHeroId, level: economy.heroState(this.qaHeroId).level }]
    if (this.ranked) {
      // Route the ranked Sim through the SAME canonical builder the SERVER uses,
      // so the config the player runs is byte-identical to the one we re-run to
      // verify — zero drift, zero chance of an honest run failing verification.
      // PathForge threads its committed route through too (ignored by every
      // other mode) so its LevelDef matches the server's rebuild exactly.
      this.declaredParty = party.map((p) => ({ heroId: p.heroId, wyrmId: (p as { wyrm?: { wyrmId: string } }).wyrm?.wyrmId }))
      this.boardPeriod = rankedPeriod(this.rankedMode)
      this.recorder = new RunRecorder()
      this.sim = new Sim(rankedConfig(this.rankedMode, this.seed, this.declaredParty, this.pathforgeMaze ?? undefined))
      if (this.ghostRunId) void this.loadGhost(this.ghostRunId)
    } else {
      this.sim = new Sim({ level: this.level, mods, seed: this.seed, endless: this.endless, rogue: this.roguePlan?.rogue, startGold, startLives, party, towerCap: towerCapForMode(this.runMode) })
    }

    // LIVE demo: Maddervane pre-places the Frost tower (the guaranteed-SHATTER
    // setup — the player adds Storm). Placement is refunded: a gift, not a cost.
    if (this.demoMode && !this.attract) {
      const cost = this.sim.placeCost('frost')
      const t = this.sim.placeTower('frost', DEMO_FROST_CELL.col, DEMO_FROST_CELL.row)
      if (t) this.sim.gold += cost
    }

    // reset transient state (scene instance is reused across restarts)
    // normal play restores the player's persisted speed choice (same device-pref
    // store as sound/motion — see ui/settings.ts); attract keeps its own ?speed=
    // capture rate untouched.
    if (!this.attract) this.gameSpeed = appSettings.data.gameSpeed
    this.paused = false
    this.resultShown = false
    this.draftShown = false
    this.mode = 'idle'
    this.buildKind = null
    this.buildHeroId = null
    this.aimingSpell = null
    this.aimingHeroSlot = null
    this.selectedId = null
    this.selectedHeroSlot = null
    this.movingHeroSlot = null
    this.lastTime = 0
    this.hitstopT = 0
    this.lastSimState = ''
    this.reactCalloutCd = 0
    this.killStopCd = 0
    this.greySat = -1
    this.greyBloomT = 0
    this.partyIds = party.map((p) => p.heroId)
    this.lowLivesBarked = false
    window.clearTimeout(this.pairTimer)
    for (const id of this.exchangeTimers) window.clearTimeout(id)
    this.exchangeTimers = []
    this.shownPairs.clear()
    this.lastPairExchange = -999
    this.arcCounts.clear()
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
    this.ghostEl?.remove()
    this.ghostEl = null
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
    // Map this level's realm → painted backdrop by REALM ORDER (endless/demo fall
    // through realmForLevel to REALMS[0] → Emberwaste, which is a fine default).
    const realmIdx = Math.max(0, REALMS.indexOf(realmForLevel(this.levelId)))
    this.view = new BattleView3D(this.sim, this.level.palette, accent, pathCells, realmBackdrop(realmIdx))
    this.view.mount(document.body)
    // The WebGL board is mounted — retire the branded cold-load screen (raised by
    // battleLoader while the lazy battle chunk streamed in) on the next frame,
    // once the canvas has painted, so there is never a blank gap or a flash.
    requestAnimationFrame(() => hideBrandLoader())

    // ---- DOM HUD ----
    this.hud = new BattleHud({
      onStart: () => { if (this.sim.state === 'prep') { const c = this.sim.clock; this.sim.startWave(); this.recorder?.startWave(c) } },
      onPause: () => this.togglePause(),
      onSpeed: () => this.toggleSpeed(),
      onResetView: () => this.view.resetView(),
      onTowerButton: (k) => this.onTowerButton(k),
      onSpellButton: (k) => this.onSpellButton(k),
      onHeroButton: (id) => this.onHeroButton(id),
      onSelectDeselect: () => this.deselect(),
      onBoardTapThrough: (x, y) => this.handlePanelTapThrough(x, y),
      onUpgrade: (id) => { const c = this.sim.clock; if (this.sim.upgradeTower(id)) { this.hud.showUpgrade(this.sim, id); this.recorder?.upgrade(c, id) } },
      onBranch: (id, idx) => { const c = this.sim.clock; if (this.sim.chooseBranch(id, idx)) { this.hud.showUpgrade(this.sim, id); this.recorder?.branch(c, id, idx) } },
      onFuse: (id, partnerId) => { const c = this.sim.clock; if (this.sim.fuseTowers(id, partnerId)) { this.hud.showUpgrade(this.sim, id); this.recorder?.fuse(c, id, partnerId) } },
      onSalvage: (id) => {
        const c = this.sim.clock
        if (this.sim.salvageTower(id) !== null) {
          this.recorder?.salvage(c, id) // a REAL replayed input — ranked verify re-runs it
          this.deselect() // the panel's tower is gone; drop the sheet
        }
      },
      onTargeting: (id) => this.cycleTargeting(id),
      onHeroTargeting: (slot) => this.cycleHeroTargeting(slot),
      onHeroMove: (slot) => this.armHeroMove(slot),
      onHeroCast: (slot) => this.castSelectedHero(slot),
      onDraft: (i) => this.pickDraft(i),
      onQuit: () => this.quitBattle(),
      onReplay: () => {
        if (this.sim.state === 'lost') ftue.recordRetry() // death → same-seed retry taken
        this.scene.restart(this.pathforge
          ? { pathforge: true, seedOverride: this.seed, pathforgeMaze: this.pathforgeMaze ?? undefined }
          : { levelId: this.levelId, endless: this.endless, demo: this.demoMode, seedOverride: this.seed })
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
    if (!this.attract) window.addEventListener('keydown', this.onKeyDown)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown())
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.teardown())

    // QA DRIVE: hand the gated drive a controlled surface onto this live battle.
    // No-op unless the QA flag is set (window.__chromancer never exists otherwise).
    if (qa.enabled) { this.qaClock = 0; this.qaCtl = this.qaMakeControl(); qa.bindScene(this.qaCtl) }
    if (qa.enabled) mountQaJuicePanel() // device-tuning sliders, QA gate only

    // ---- ATTRACT / DEMO REEL: scripted run + cinematic camera, hands-free ----
    if (this.attract) {
      this.script = new ScriptRunner(DEMO_SCRIPT)
      this.hud.setAttract(true)
      this.view.cineTimeScale = this.gameSpeed
      this.view.setCinematic(true, CINE_HOME)
      this.buildTakeoverOverlay()
    } else if (this.demoMode) {
      this.hud.banner('MADDERVANE LEFT YOU A FROST TOWER', 0x9fdcff)
    } else if (this.roguelike && this.roguePlan) {
      // The weekly headline mutator (+ live event) — the run's rule twist, up front.
      const head = MUTATORS[this.roguePlan.headline]
      this.hud.banner(`${head?.icon ?? '🎲'} ${planHeadline(this.roguePlan)}`, this.roguePlan.event?.color ?? head?.color ?? 0xc06bff)
    } else if (this.pathforge) {
      this.hud.banner('PATHFORGE · HOLD THE LINE ON YOUR MAZE', 0x6bd7ff)
    } else if (this.endless) {
      // The store constitution, on screen: Ranked ignores every purchase —
      // heroes normalized, boosts/convenience/extra slots disabled.
      this.hud.banner('RANKED · NOTHING YOU CAN BUY WORKS HERE', 0x9fe8ff)
    }
    this.hud.setSpeed(this.gameSpeed) // reflect the active (attract capture, or persisted) speed on load

    // ---- ONBOARDING: the L1 live coach, or a one-time ramp lesson (l2+) ----
    if (!this.attract && !this.demoMode && !this.endless) {
      // The live coach runs until the L1 curriculum completes — but never for a
      // save that already has stars (veterans replaying L1 are left alone).
      if (this.levelId === 'l1' && !ftue.isDone('l1-core') && economy.totalStars() === 0) {
        this.coach = new Coach(() => this.skipTutorial())
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

    // REALM ENTRY: a hero who KNOWS this realm (origin/mentor/rival) speaks once
    // on arrival — routed to the chat feed, gated on the campaign (realm-tagged).
    if (!this.attract && !this.demoMode && !this.endless) {
      const id = window.setTimeout(() => {
        if (!this.sim || this.sim.state === 'won' || this.sim.state === 'lost') return
        this.tryBark('levelStart')
      }, 1800)
      this.exchangeTimers.push(id)
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
    // QA DRIVE: in driven mode Phaser's own rAF frames are ignored — only
    // qa.stepOnce() re-enters here (at a fixed dt) so the render+view loop (and
    // therefore hitstop/juice timing) advances against a known, deterministic
    // clock instead of a headless tab's 100–950ms frame gaps. Inert in normal play.
    if (qa.enabled && qa.skipAutoFrame()) return
    const dt = Math.min(0.05, delta / 1000)
    if (qa.enabled) qa.beginFrame(dt)
    let simDt = this.paused ? 0 : dt * this.gameSpeed
    // HITSTOP — a true freeze-frame (40–70ms) on reaction detonations + boss/elite
    // kills: the single best "weight" trick. We halt BOTH the sim step (enemy screen
    // positions are direct reads of sim x/y, so a zero step holds them) AND the view
    // clock (viewDt→0 freezes the walk-cycle, camera, bloom surge and the burst
    // particles mid-flight). Nothing moves during the freeze, so there is ZERO
    // resume-snap — the whole board locks for a beat, then punches back to life.
    // Freezes are capped (see the Math.max sites) so it always reads as a bite,
    // never a drag. Wall-clock timers below still use real dt.
    let viewDt = dt
    if (this.hitstopT > 0) {
      // QA: time the REALIZED freeze span (overlapping reactions extend it via
      // Math.max, so we measure the actual frozen frames, not the requested value).
      if (qa.enabled) qa.hitstopTick(dt)
      this.hitstopT -= dt
      simDt = 0
      viewDt = 0
    } else if (qa.enabled) qa.hitstopIdle()
    // Scripted input (attract reel) is injected on exact fixed-step boundaries
    // so the showcase run replays identically at any frame rate or ?speed=.
    // The draft pick is held open for a real-time beat (sim clock is frozen in
    // draft, so the hold can't desync the deterministic timeline).
    if (this.script && this.sim.state === 'draft' && this.draftHoldT > 0) this.draftHoldT -= dt
    const allowPick = !this.script || this.draftHoldT <= 0
    const runner = this.script
    this.sim.advance(simDt, runner ? () => runner.update(this.sim, allowPick) : undefined)

    // GHOST RACE: advance the downloaded replay by the same sim-time and update
    // the ahead/behind pill (it races the same seed on the same clock as you).
    if (this.ghost) { this.ghost.advance(simDt); this.updateGhostPill() }

    this.drainAndMergeEvents()

    // wave-start flourish on the prep→active transition
    if (this.sim.state === 'active' && this.lastSimState === 'prep') {
      this.hud.waveBanner(`WAVE ${this.sim.waveIndex + 1}`)
      battleSfx.waveStart()
      // the mini-Keeper gets a proper entrance in the demo
      if (this.demoMode && this.sim.waveIndex === this.level.waves.length - 1) {
        window.setTimeout(() => this.hud.banner('CINDRAL, EMBER OF KAELEN', 0xff4db8, BANNER_PRIORITY.boss), 900)
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

    // keep the open hero panel's ULT cooldown live — but only WHILE it's cooling
    // (once ready the button is static, so no churn/tooltip-dismiss when idle).
    if (this.selectedHeroSlot != null && this.mode === 'idle') {
      const sel = this.sim.heroBySlot(this.selectedHeroSlot)
      if (!sel) { this.deselect() } // the hero left the field — drop the panel
      else if (sel.spellCd > 0) {
        this.heroPanelT += dt
        if (this.heroPanelT >= 0.5) { this.heroPanelT = 0; this.hud.showHeroPanel(this.sim, this.selectedHeroSlot) }
      }
    }

    if (this.reactCalloutCd > 0) this.reactCalloutCd -= dt
    if (this.killStopCd > 0) this.killStopCd -= dt
    this.updateGreying(dt)
    this.updateAudioBed(dt)
    this.battleT += dt
    if (this.coachStep !== 'off' && this.coachStep !== 'done') this.runCoach()

    // danger line: one in-voice rally + a Wellspring warning when integrity first
    // dips below 35% — the base is visibly fading and the player must be told.
    if (!this.lowLivesBarked && this.sim.baseHp > 0 && this.sim.baseIntegrity < 0.35) {
      this.lowLivesBarked = true
      this.tryBark('lowLives')
      this.hud.waveBanner('⚠ The Wellspring is fading!', BANNER_PRIORITY.boss)
    }

    // Drive the painted Wellspring's desaturate/crack state from base integrity.
    this.view.setBaseIntegrity(this.sim.baseIntegrity)

    this.view.syncFrom(this.selectedId)
    this.view.render(viewDt) // viewDt=0 during hitstop → a frozen frame (see update())
    this.hud.update(this.sim, this.hudCtx())

    // state-driven overlays
    if (this.sim.state === 'draft' && !this.draftShown) {
      this.draftShown = true
      if (this.script) this.draftHoldT = 2.6 // let the reel viewer READ the cards
      this.enterDraftUi()
    }
    if (this.sim.state !== 'draft' && this.draftShown) { this.draftShown = false; this.hud.hideDraft() }
    if ((this.sim.state === 'won' || this.sim.state === 'lost') && !this.resultShown) this.showResult()
    if (qa.enabled) qa.endFrame()
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
    // DEFEAT: the Greying consumes the Wellspring — the whole world bleeds to grey.
    if (this.sim.state === 'lost') { target = 0; bright = 0.82 }
    if (this.greySat < 0) this.greySat = target // no pop-in on the first frame
    this.greySat += (target - this.greySat) * Math.min(1, dt * 3)
    // SOUND THE GREYING — drive the shared audio lowpass off the SAME saturation
    // the canvas filter uses, frame-locked. Grey = muffled, colour = open, the
    // victory bloom (greySat→~1.45) sweeps the whole mix wide open.
    setSpectralOpenness(this.greySat)
    const sat = Math.round(this.greySat * 200) / 200 // quantise → no per-frame string churn
    const br = Math.round(bright * 200) / 200
    const filter = sat >= 0.995 && br >= 0.995 && br <= 1.005 ? '' : `saturate(${sat}) brightness(${br})`
    if (this.view.canvas.style.filter !== filter) this.view.canvas.style.filter = filter
  }

  // ADAPTIVE MUSIC + SIDECHAIN, stepped once per frame off the same clock as the
  // greying (frame-lock). Intensity rises with active combat / wave depth / boss
  // presence; the tension bed layers up and the music bed ducks under the SFX RMS.
  private bossOnField = false
  private updateAudioBed(dt: number): void {
    const s = this.sim
    let boss = false
    let live = 0
    for (const e of s.enemies) {
      if (!e.active) continue
      live++
      if (e.def.boss) boss = true
    }
    if (boss !== this.bossOnField) {
      this.bossOnField = boss
      music.setBoss(boss)
    }
    // 0 = calm prep, ramps through the wave, peaks with a boss + a swarm.
    let intensity = 0
    if (s.state === 'active') {
      const wave = Math.min(1, (s.waveIndex + 1) / Math.max(1, this.level.waves.length))
      const swarm = Math.min(1, live / 14)
      intensity = 0.35 + 0.35 * wave + 0.3 * swarm
      if (boss) intensity = Math.max(intensity, 0.9)
    } else if (s.state === 'won' || s.state === 'lost') {
      intensity = 0
    } else {
      intensity = 0.15 // prep/draft — a low simmer
    }
    music.setIntensity(intensity)
    music.stepBed(dt)
    stepDuck(dt)
  }

  // ======================================================================
  //  ONBOARDING COACH — teach-by-doing, never blocks, auto-advances if the
  //  player runs ahead. Steps persist (ftue) so a retry never re-teaches.
  // ======================================================================
  private runCoach(): void {
    const c = this.coach
    if (!c) { this.coachStep = 'off'; return }
    const s = this.sim
    if (s.state === 'won' || s.state === 'lost') { c.hideSkip(); c.clear(); return }
    if (s.state === 'draft' || this.paused) { c.clear(); return }
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
    this.coach?.hideSkip()
    this.coach?.clear()
    this.coach?.say('You know everything that matters', 'The rest is paint. Bring the colour home.', 5000)
    this.coachStep = 'done'
  }

  // SKIP TUTORIAL — the escape hatch. Marks the whole L1 curriculum done (so it
  // never re-teaches, this session or later), tears the coach layer down, and
  // hands the board straight back to the player. A returning/expert can just play.
  private skipTutorial(): void {
    for (const s of ['l1-place', 'l1-start', 'l1-combo', 'l1-upgrade', 'l1-hero', 'l1-core']) ftue.markDone(s)
    this.coachStep = 'off'
    this.coach?.dispose()
    this.coach = null
    this.hud.banner('Tutorial skipped — the canvas is yours', 0xc9b6ff)
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
        if (this.aimingHeroSlot != null) {
          const hero = this.sim.heroBySlot(this.aimingHeroSlot)
          const c = this.sim.clock
          if (this.sim.castHeroSpell(this.aimingHeroSlot, p.x, p.y)) {
            this.view.heroCastPose(this.aimingHeroSlot)
            if (hero) this.bumpArc(hero.heroId, 'spell')
            this.recorder?.heroSpell(c, this.aimingHeroSlot, p.x, p.y)
          }
        } else if (this.aimingSpell) { const c = this.sim.clock; if (this.sim.castSpell(this.aimingSpell, p.x, p.y)) this.recorder?.spell(c, this.aimingSpell, p.x, p.y) }
      }
      this.exitAiming()
      return
    }

    const cell = this.view.pickCell(x, y)
    if (!cell) {
      // off-grid tap: while a hero is selected, treat it as a FOCUS on the nearest
      // enemy (chase the boss); otherwise deselect.
      if (this.mode === 'idle' && this.selectedHeroSlot != null && this.tryFocusAt(x, y)) return
      if (this.mode === 'idle') this.deselect()
      return
    }

    const t = this.sim.towerAt(cell.col, cell.row)
    const hero = this.sim.heroAt(cell.col, cell.row)

    // MOVING: the armed hero relocates to this tile (or re-selects a tapped entity).
    if (this.mode === 'moving') {
      if (this.movingHeroSlot != null) this.tryMoveHero(cell.col, cell.row)
      return
    }

    // An armed option (build/deploy) is superseded the instant you tap an existing
    // tower — the new selection wins on the FIRST tap, no exit-mode click first.
    if (this.mode === 'building') {
      if (hero) { this.exitBuild(); this.selectHero(hero.id); return }
      if (t) { this.exitBuild(); this.selectTower(t.id); return }
      this.tryPlace(cell.col, cell.row); return
    }
    if (this.mode === 'deploying') {
      if (hero) { this.exitDeploy(); this.selectHero(hero.id); return }
      if (t) { this.exitDeploy(); this.selectTower(t.id); return }
      this.tryDeploy(cell.col, cell.row); return
    }

    if (hero) this.selectHero(hero.id) // single-tap select the hero on board
    else if (t) this.selectTower(t.id) // swaps directly if a different tower's panel was open
    else if (this.selectedHeroSlot != null && this.tryFocusAt(x, y)) return // tap enemy → focus
    else this.deselect() // tap on empty board: deselect + close panels
  }

  // A tap that landed on the OPEN upgrade sheet's dead-space (not a button): the
  // sheet floats over the board's lower rows, so a tower underneath would be
  // unreachable without first closing the panel. Route the tap to the board so a
  // different tower swaps in on the FIRST tap — but never DESELECT from here, or
  // tapping the panel's own chrome would close it.
  private handlePanelTapThrough(x: number, y: number): void {
    if (!this.sim || this.mode !== 'idle') return
    const cell = this.view.pickCell(x, y)
    if (!cell) return
    const t = this.sim.towerAt(cell.col, cell.row)
    if (t && t.id !== this.selectedId) this.selectTower(t.id)
  }

  private handleHover(x: number, y: number): void {
    if (!this.sim) return
    if (this.mode === 'building') {
      const cell = this.view.pickCell(x, y)
      const ok = cell ? this.sim.canPlace(cell.col, cell.row) : false
      this.view.setHover(cell, ok)
      // LIVE coverage preview: this tower's real range, sized to the hovered tile.
      if (cell && this.buildKind) {
        this.view.setPlaceRing(cell, this.sim.previewTowerRange(this.buildKind, cell.col, cell.row), towerPalette(this.buildKind).color, ok)
      }
    } else if (this.mode === 'deploying') {
      const cell = this.view.pickCell(x, y)
      const ok = cell ? this.sim.canPlace(cell.col, cell.row) : false
      this.view.setHover(cell, ok)
      // hero coverage/aura preview at its progression range
      if (cell && this.buildHeroId) {
        const def = heroById(this.buildHeroId)
        this.view.setPlaceRing(cell, this.sim.previewHeroRange(this.buildHeroId), def ? def.color : 0x9affc0, ok)
      }
    } else if (this.mode === 'moving') {
      const cell = this.view.pickCell(x, y)
      const ok = cell != null && this.movingHeroSlot != null && this.sim.canMoveHeroTo(this.movingHeroSlot, cell.col, cell.row)
      this.view.setHover(cell, ok)
      // the armed hero's REAL range follows the tile it would relocate to
      const h = this.movingHeroSlot != null ? this.sim.heroBySlot(this.movingHeroSlot) : null
      if (cell && h) this.view.setPlaceRing(cell, this.sim.heroRange(h), h.def.color, ok)
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
        const c = this.sim.clock
        if (this.sim.castHeroSpell(deployed.id, deployed.x, deployed.y)) {
          this.view.heroCastPose(deployed.id)
          this.bumpArc(deployed.heroId, 'spell')
          this.recorder?.heroSpell(c, deployed.id, deployed.x, deployed.y)
        }
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
    const c = this.sim.clock
    const heroId = this.buildHeroId
    const h = this.sim.deployHero(this.buildHeroId, col, row)
    if (h) {
      this.recorder?.deploy(c, heroId, col, row)
      this.exitDeploy() // one deploy per hero → drop out of deploy mode
      if (unlockCodex('hero-' + h.heroId)) this.hud.banner('✎ SKETCHBOOK UPDATED', 0xc9b6ff)
      if (h.sigAwake && unlockCodex('field-signature')) this.hud.banner('✎ SKETCHBOOK UPDATED', 0xc9b6ff)
      if (this.sim.activeResonances().length > 0 && unlockCodex('field-resonance')) this.hud.banner('✎ SKETCHBOOK UPDATED', 0xc9b6ff)
      // an already-awakened hero enters with a signature flourish (earned presence)
      if (h.sigAwake) this.view.heroAwakenPose(h.id, h.x, h.y, h.def.color)
      this.bumpArc(h.heroId, 'deploy')
      this.tryBark('deploy', h.heroId)
      // party-composition banter: once a second hero stands on the field, the
      // squad might trade a short back-and-forth (both must be fielded together)
      const fielded = this.sim.deployedHeroes().map((d) => d.heroId)
      if (fielded.length >= 2) {
        window.clearTimeout(this.pairTimer)
        this.pairTimer = window.setTimeout(() => this.tryPairExchange(fielded), 2600)
      }
    }
  }

  // A fielded relationship pair trades a short call→reply exchange in the chat
  // feed — the Hades trick that turns 8 stat blocks into a CAST. Each pair fires
  // at most once per battle; exchanges are paced so a deploy burst can't spam.
  private tryPairExchange(fielded: string[]): void {
    if (!this.sim || this.sim.state === 'won' || this.sim.state === 'lost') return
    const now = this.barkNow()
    if (now - this.lastPairExchange < 9) return
    const ex = pairExchange(fielded, this.shownPairs)
    if (!ex) return
    this.shownPairs.add(ex.key)
    this.lastPairExchange = now
    // play the lines as a back-and-forth: first now, each reply ~1.9s later
    ex.lines.forEach((line, i) => {
      if (i === 0) { this.hud.chatBark(line.speaker, line.text); return }
      const id = window.setTimeout(() => {
        if (!this.sim || this.sim.state === 'won' || this.sim.state === 'lost') return
        this.hud.chatBark(line.speaker, line.text)
      }, 1900 * i)
      this.exchangeTimers.push(id)
    })
  }

  // Tally a hero-arc metric for this battle (deferred to the result screen). Never
  // runs in attract/demo, so the trailer loop can't farm quest progress.
  private bumpArc(heroId: string, key: 'signature' | 'spell' | 'deploy'): void {
    if (this.attract || this.demoMode) return
    let c = this.arcCounts.get(heroId)
    if (!c) { c = { signature: 0, spell: 0, deploy: 0 }; this.arcCounts.set(heroId, c) }
    c[key]++
  }

  // Flush this battle's arc tallies to the save (economy is the sole writer).
  // 'win' credits every hero that ended the battle on the field. Newly completed
  // quests surface a single celebratory banner — the rest live in the collection.
  private flushArcProgress(win: boolean): void {
    if (this.attract || this.demoMode) return
    const fresh: Array<{ heroId: string; quest: string }> = []
    for (const [heroId, c] of this.arcCounts) {
      if (c.signature) for (const q of economy.addArcMetric(heroId, 'signature', c.signature)) fresh.push({ heroId, quest: q.name })
      if (c.spell) for (const q of economy.addArcMetric(heroId, 'spell', c.spell)) fresh.push({ heroId, quest: q.name })
      if (c.deploy) for (const q of economy.addArcMetric(heroId, 'deploy', c.deploy)) fresh.push({ heroId, quest: q.name })
    }
    if (win) {
      for (const h of this.sim.deployedHeroes()) {
        for (const q of economy.addArcMetric(h.heroId, 'win', 1)) fresh.push({ heroId: h.heroId, quest: q.name })
      }
    }
    if (fresh.length > 0) {
      const first = fresh[0]
      const name = heroById(first.heroId)?.name ?? 'Hero'
      const extra = fresh.length > 1 ? ` (+${fresh.length - 1} more)` : ''
      this.hud.banner(`✦ ${name.toUpperCase()} — ${first.quest} complete!${extra}`, heroById(first.heroId)?.color ?? 0xc9b6ff)
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
      const c = this.sim.clock
      if (this.sim.castSpell(key, 360, MAP_Y + MAP_H / 2)) this.recorder?.spell(c, key, 360, MAP_Y + MAP_H / 2)
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
    const c = this.sim.clock
    const kind = this.buildKind
    const placed = this.sim.placeTower(this.buildKind, col, row)
    if (placed) {
      if (!this.attract) haptic(HAPTIC.place) // light confirming tick under the thumb
      this.recorder?.place(c, kind, col, row)
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
    this.selectedHeroSlot = null
    this.exitMoving()
    this.hud.showUpgrade(this.sim, id)
  }
  private deselect(): void {
    this.selectedId = null
    this.selectedHeroSlot = null
    this.exitMoving()
    this.hud.hideUpgrade()
  }

  // ---- HERO control: select · retarget · relocate · focus · cast -----------
  private selectHero(slotId: number): void {
    if (!this.sim.heroBySlot(slotId)) return
    this.exitBuild()
    this.exitDeploy()
    this.exitAiming()
    this.exitMoving()
    this.selectedId = null
    this.selectedHeroSlot = slotId
    this.hud.showHeroPanel(this.sim, slotId)
  }

  private cycleHeroTargeting(slotId: number): void {
    const h = this.sim.heroBySlot(slotId)
    if (!h) return
    // heroes hit air freely, so 'Primed' stays; cycle the full wheel
    const next = TARGET_MODES[(TARGET_MODES.indexOf(h.targeting) + 1) % TARGET_MODES.length]
    const c = this.sim.clock
    this.sim.setHeroTargeting(slotId, next)
    this.recorder?.heroTarget(c, slotId, next)
    this.hud.showHeroPanel(this.sim, slotId)
  }

  private armHeroMove(slotId: number): void {
    if (!this.sim.heroBySlot(slotId)) return
    this.movingHeroSlot = slotId
    this.mode = 'moving'
    this.view.setHover(null, false)
    this.view.setBuildHighlight(true)
    this.hud.banner('TAP A TILE TO MOVE', this.sim.heroBySlot(slotId)?.def.color ?? 0x8fbfff)
  }

  private exitMoving(): void {
    this.movingHeroSlot = null
    if (this.mode === 'moving') this.mode = 'idle'
    this.view.setHover(null, false)
    this.view.setBuildHighlight(false)
  }

  private tryMoveHero(col: number, row: number): void {
    const slot = this.movingHeroSlot
    if (slot == null) { this.exitMoving(); return }
    const cc = cellCenter(col, row)
    if (!this.sim.canMoveHeroTo(slot, col, row)) { this.floatAt(cc.x, cc.y, 'CANT MOVE', 0xff5b7a, 22); return }
    const c = this.sim.clock
    if (this.sim.moveHero(slot, col, row)) {
      this.recorder?.heroMove(c, slot, col, row)
      this.view.heroCastPose(slot) // little blink pose on arrival
    }
    this.exitMoving()
    this.selectedHeroSlot = slot
    this.hud.showHeroPanel(this.sim, slot)
  }

  private castSelectedHero(slotId: number): void {
    const h = this.sim.heroBySlot(slotId)
    if (!h || h.spellCd > 0) return
    if (h.spell.targeted) {
      // close the panel so the aim tap lands on the board, not the floating sheet
      this.selectedHeroSlot = null
      this.hud.hideUpgrade()
      this.exitMoving()
      this.mode = 'aiming'
      this.aimingSpell = null
      this.aimingHeroSlot = slotId
    } else {
      const c = this.sim.clock
      if (this.sim.castHeroSpell(slotId, h.x, h.y)) {
        this.view.heroCastPose(slotId)
        this.bumpArc(h.heroId, 'spell')
        this.recorder?.heroSpell(c, slotId, h.x, h.y)
        if (this.selectedHeroSlot === slotId) this.hud.showHeroPanel(this.sim, slotId)
      }
    }
  }

  // A tap resolved to a world point near an enemy → hard-FOCUS the selected hero on
  // it (chase the boss). Returns true if a focus was set.
  private tryFocusAt(x: number, y: number): boolean {
    const slot = this.selectedHeroSlot
    if (slot == null) return false
    const p = this.view.pickPoint(x, y)
    if (!p || !this.inMap(p.x, p.y)) return false
    const e = this.sim.enemyNear(p.x, p.y)
    if (!e) return false
    const c = this.sim.clock
    this.sim.focusHero(slot, e.id)
    this.recorder?.heroFocus(c, slot, e.id)
    this.floatAt(e.x, e.y, '🎯 FOCUS', this.sim.heroBySlot(slot)?.def.color ?? 0xffe27a, 20)
    this.hud.showHeroPanel(this.sim, slot)
    return true
  }
  private cycleTargeting(id: number): void {
    const t = this.sim.towerById(id)
    if (!t) return
    const next = TARGET_MODES[(TARGET_MODES.indexOf(t.targeting) + 1) % TARGET_MODES.length]
    const c = this.sim.clock
    this.sim.setTargeting(id, next)
    this.recorder?.target(c, id, next)
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
    if (this.sim.chooseDraft(i)) this.recorder?.draft(i)
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

  // 1× → 2× → 4× → 1×. Purely cosmetic wall-clock scaling: the sim is fixed-
  // timestep and ranked commands are tick-stamped (not wall-clock-stamped — see
  // game/ranked.ts), so a faster game speed just packs more identical fixed
  // steps into fewer real frames. Persisted so the choice survives level
  // restarts and sessions (see ui/settings.ts, same store as other device prefs).
  private toggleSpeed(): void {
    this.gameSpeed = this.gameSpeed === 1 ? 2 : this.gameSpeed === 2 ? 4 : 1
    this.hud.setSpeed(this.gameSpeed)
    appSettings.set({ gameSpeed: this.gameSpeed as 1 | 2 | 4 })
  }

  // Hitstop is a true wall-clock freeze-frame (see update()). At 1× that reads as
  // a satisfying punch; at higher game speed the SAME wall-clock freeze eats a
  // proportionally bigger bite out of the sped-up action, so it's scaled down as
  // speed rises — full weight at 1×, half at 2×, a light tap at 4× — so fast play
  // stays smooth instead of stuttering on every kill/reaction.
  private hitstopScale(): number {
    return this.gameSpeed >= 4 ? 0.15 : this.gameSpeed >= 2 ? 0.5 : 1
  }

  private addHitstop(seconds: number): void {
    const tune = qa.enabled ? qa.juice.hitstopMul : 1 // device-session knob; neutral in prod
    this.hitstopT = Math.max(this.hitstopT, seconds * this.hitstopScale() * tune)
  }

  // Remappable keyboard controls (accessibility). Ignored while a DOM dialog is up
  // (settings/rebind capture) or while typing, so it never fights the overlay.
  private handleKey(e: KeyboardEvent): void {
    if (e.repeat || e.altKey || e.ctrlKey || e.metaKey) return
    if (document.querySelector('.settings-overlay')) return
    const tag = (document.activeElement?.tagName ?? '').toLowerCase()
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return
    const k = appSettings.data.keybinds
    const code = e.code
    if (code === k.startWave) {
      if (this.sim.state === 'prep' && !this.paused) { e.preventDefault(); const c = this.sim.clock; this.sim.startWave(); this.recorder?.startWave(c) }
      return
    }
    if (code === k.pause) { e.preventDefault(); this.togglePause(); return }
    if (code === k.toggleSpeed) { e.preventDefault(); this.toggleSpeed(); return }
    if (code === k.cancel) { e.preventDefault(); this.exitBuild(); this.exitAiming(); this.exitDeploy(); this.deselect(); return }
    const towerIdx = [k.tower1, k.tower2, k.tower3, k.tower4, k.tower5].indexOf(code)
    if (towerIdx >= 0 && this.sim.state !== 'won' && this.sim.state !== 'lost' && !this.paused) {
      const kind = TOWER_ORDER[towerIdx]
      if (kind) { e.preventDefault(); this.onTowerButton(kind) }
    }
  }

  private quitBattle(): void {
    if (this.roguelike) {
      economy.awardRoguelike(this.sim.waveIndex)
      this.awardHeroes(this.endlessShards(), this.endlessXp())
    } else if (this.endless) {
      economy.awardEndless(this.sim.waveIndex)
      this.awardHeroes(this.endlessShards(), this.endlessXp())
    }
    this.scene.start(this.endless ? 'Menu' : 'Map')
  }

  // Free hero currency + XP earned by playing (the provably-fair progression path).
  private awardHeroes(shards: number, xpEach: number): number {
    const party = economy.party()
    economy.awardHeroProgress(party, xpEach, shards)
    // A bonded Wyrm grows by flying with its hero (hatchling → adult, earned).
    const wyrmIds: string[] = []
    for (const id of party) {
      const w = economy.bondFor(id)
      if (w && !wyrmIds.includes(w)) wyrmIds.push(w)
    }
    if (wyrmIds.length > 0) economy.awardWyrmProgress(wyrmIds, xpEach)
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
    // hero ARCS: bank this battle's quest progress (no-op in attract/demo)
    this.flushArcProgress(win)
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
      // NEXT LEVEL: offer a direct hop to the next campaign level when one exists
      // and is unlocked (any ≥1★ clear unlocks it — and stars were just banked
      // above). Never for the demo (guest funnel) or endless modes.
      let onNext: (() => void) | undefined
      if (!this.demoMode && !this.endless) {
        // canonical id (this.level is the mode-transformed def — heroic could re-id it)
        const idx = LEVELS.findIndex((l) => l.id === this.levelId)
        const next = idx >= 0 ? LEVELS[idx + 1] : undefined
        if (next && isLevelUnlocked(next.index, economy.data.stars)) {
          onNext = () => this.scene.restart({ levelId: next.id, difficulty: this.runMode.difficulty, challenge: this.runMode.challenge })
        }
      }
      this.hud.showResult({
        win: true, title: this.demoMode ? 'THE VALE BLOOMS!' : 'VICTORY!', color: 0x2ff7c3, stars,
        coins: result.coins, diamonds: result.diamonds, shards, unlocked, endless: this.endless,
        share: this.buildShare(true), onNext,
        // demo: guest progress carries straight into the full game
        continueLabel: this.demoMode ? 'CONTINUE INTO THE FULL GAME →' : undefined,
        onContinue: this.demoMode ? () => this.scene.start('Map') : undefined,
      })
      this.tryBark('victory') // post-victory beat: Color Bloom + one line over the card
      // GROWTH HYBRID: the welcome bundle LANDS right after the first felt win
      // (the demo or first campaign clear) — the activation + account hook. Never
      // in attract (headless capture / landing embed must not claim). After the
      // celebratory claim, offer the PWA install (a completed critical journey).
      if (!this.attract) {
        // ACCOUNT HOOK: right after the first felt win, offer to SAVE the account
        // (portable sign-in) — once, ever, and only for a configured guest. We
        // chain it after the welcome + install beats so prompts never stack; if the
        // install toast shows we defer the account nudge to the next win (Settings
        // always offers it too). promptSaveAfterFirstWin() self-guards everything.
        if (economy.welcomeAvailable()) {
          window.setTimeout(() => showWelcomeReward(() => {
            const installShown = showInstallCard()
            if (!installShown) window.setTimeout(promptSaveAfterFirstWin, 500)
          }), 1100)
        } else {
          window.setTimeout(promptSaveAfterFirstWin, 900)
        }
      }
    } else {
      this.hud.flash(0xff3b6b, 0.5)
      battleSfx.defeat()
      if (this.roguelike) {
        // ROGUELIKE run end: coins/xp via the rogue path (never endlessBest), a LOCAL
        // weekly-best record (the leaderboard hook), and the full run-summary recap.
        const res = economy.awardRoguelike(this.sim.waveIndex)
        const shards = this.awardHeroes(this.endlessShards(), this.endlessXp())
        const plan = this.roguePlan!
        const pb = recordWeeklyBest(plan.week, this.sim.waveIndex + 1)
        const bestTag = pb ? ' · NEW WEEKLY BEST!' : ''
        this.hud.showResult({ win: false, title: 'RUN OVER', color: 0xc06bff, stars: 0, coins: res.coins, diamonds: 0, shards, unlocked: null, sub: `Reached wave ${this.sim.waveIndex + 1}${bestTag}`, endless: true, share: this.buildShare(false) })
        window.setTimeout(() => this.showRunSummary(), 480)
      } else if (this.pathforge) {
        // PATHFORGE: local per-seed best (never endlessBest — meta progression never
        // touches the fair run itself) PLUS, when the maze committed cleanly, the
        // ranked ladder submit (server re-validates the maze + re-runs the log before
        // it boards). Score = waves survived on the player's own maze.
        const wave = this.sim.waveIndex + 1
        const pb = recordPathforgeBest(this.seed, wave)
        const shards = this.awardHeroes(this.endlessShards(), this.endlessXp())
        this.hud.showResult({
          win: false, title: 'THE LINE BREAKS', color: 0x6bd7ff, stars: 0, coins: 0, diamonds: 0, shards,
          unlocked: null, sub: `Reached wave ${wave}${pb ? ' · NEW BEST FOR THIS SEED!' : ''}`,
          endless: true, share: this.buildShare(false),
        })
        this.submitRankedRun()
      } else if (this.endless) {
        const res = economy.awardEndless(this.sim.waveIndex)
        const shards = this.awardHeroes(this.endlessShards(), this.endlessXp())
        // Daily runs also log a PURELY LOCAL best-for-today (habit loop; no backend).
        let dailyPb = false
        if (this.isDaily) dailyPb = recordDailyResult(utcDayIndex(), this.sim.waveIndex + 1)
        const bestTag = res.best ? ' · NEW BEST!' : dailyPb ? ' · DAILY PB!' : ''
        this.hud.showResult({ win: false, title: 'DEFEAT', color: 0xff5b7a, stars: 0, coins: res.coins, diamonds: 0, shards, unlocked: null, sub: `Reached wave ${this.sim.waveIndex + 1}${bestTag}`, endless: true, share: this.buildShare(false) })
        // RANKED: record the local PB and submit the seed + replay log for
        // server-side re-run verification (degrades to local-only if unwired).
        this.submitRankedRun()
      } else {
        // DEATH TEACHES: diagnose the loss into one actionable lesson, and the
        // retry button replays the SAME seed — the player knows the whole plan.
        ftue.recordDefeat()
        this.hud.showResult({ win: false, title: 'THE COLOR IS LOST…', color: 0x8f8a99, stars: 0, coins: 0, diamonds: 0, shards: 0, unlocked: null, sub: 'The Greying consumed the Prism Wellspring.', endless: false, lesson: this.buildDefeatLesson(), share: this.buildShare(false) })
        this.tryBark('defeat') // Morose condoles — he always does
      }
    }
  }

  // RANKED SUBMIT — the moat, from the client's side. Record the local PB, then
  // ship the seed + deterministic input log to the server, which RE-RUNS the pure
  // sim and confirms the score before it touches the board. Fire-and-forget and
  // fully degrading: if the backend is unwired/offline the run still counts
  // locally and the player never notices a hitch.
  private submitRankedRun(): void {
    if (!this.ranked || !this.recorder || this.rankedSubmitted) return
    this.rankedSubmitted = true
    const score = this.sim.score()
    const wave = this.sim.waveIndex + 1
    recordRankedLocal(this.rankedMode, this.boardPeriod, score, wave, this.seed)
    const rec = this.recorder.record(this.rankedMode, this.seed, this.boardPeriod, this.declaredParty, score, wave, this.pathforgeMaze ?? undefined)
    void submitRun(rec).then((r) => {
      if (!r) return // offline / unwired — local PB already banked
      if (r.ok && typeof r.rank === 'number') {
        this.hud.banner(`✔ VERIFIED · RANKED #${r.rank}`, 0x8dff4a)
      } else if (!r.ok && r.reason === 'version') {
        this.hud.banner('Ranked client outdated — update to submit', 0xffd54a)
      } else if (!r.ok) {
        this.hud.banner('Ranked verify failed — run kept locally', 0xffd54a)
      }
    })
  }

  // GHOST — download a top run's replay log and build an incremental replay we
  // advance in lockstep with the live run. Fully async + degrading: if the log
  // can't be fetched the race simply doesn't appear and play is unaffected.
  private async loadGhost(runId: string): Promise<void> {
    const g = await fetchGhost(runId)
    if (!g || !this.sim || this.sim.state === 'won' || this.sim.state === 'lost') return
    try {
      this.ghost = new GhostRunner(g.mode, this.seed, g.party, g.log, g.route)
    } catch { return }
    const el = document.createElement('div')
    el.style.cssText =
      'position:fixed;left:50%;transform:translateX(-50%);top:calc(env(safe-area-inset-top) + 58px);z-index:30;' +
      'pointer-events:none;font-family:"Baloo 2","Nunito",system-ui,sans-serif;font-weight:900;font-size:12px;' +
      'letter-spacing:.03em;color:#e9dcff;background:rgba(16,10,30,.72);border:1px solid rgba(180,140,255,.4);' +
      'border-radius:999px;padding:6px 13px;box-shadow:0 6px 20px rgba(0,0,0,.4);white-space:nowrap;'
    el.textContent = '👻 GHOST loading…'
    document.body.appendChild(el)
    this.ghostEl = el
    this.updateGhostPill()
  }

  private updateGhostPill(): void {
    if (!this.ghostEl || !this.ghost) return
    const gs = this.ghost.score()
    const ys = this.sim.score()
    const lead = ys - gs
    const state = lead >= 0 ? 'AHEAD' : 'BEHIND'
    const color = lead >= 0 ? '#8dff4a' : '#ff8da6'
    this.ghostEl.innerHTML =
      `👻 GHOST W${this.ghost.wave()} · ${gs.toLocaleString()}` +
      `<span style="opacity:.5"> — </span>` +
      `<span style="color:${color}">YOU ${state} ${Math.abs(lead).toLocaleString()}</span>`
  }

  // ROGUELIKE END-OF-RUN RECAP — the build you took, your biggest reaction, how
  // deep you got, and the seed to share. A self-contained DOM overlay layered over
  // the result card; dismisses on tap.
  private showRunSummary(): void {
    if (!this.roguePlan) return
    const s = this.sim.runSummary()
    const plan = this.roguePlan
    const ov = document.createElement('div')
    ov.style.cssText =
      'position:fixed;inset:0;z-index:4300;display:flex;align-items:center;justify-content:center;padding:20px;' +
      'background:rgba(8,5,18,.82);backdrop-filter:blur(5px);opacity:0;transition:opacity .45s ease;' +
      'font-family:"Baloo 2","Nunito",system-ui,sans-serif;color:#fff;'
    const relics = s.relics.length ? s.relics.map((r) => `<span style="display:inline-block;margin:2px 3px;padding:3px 9px;border-radius:9px;background:rgba(192,107,255,.18);border:1px solid rgba(192,107,255,.4);font-size:12px;font-weight:700">${r}</span>`).join('') : '<span style="opacity:.6">no relics drafted</span>'
    const big = s.biggestReaction ? `${s.biggestReaction.name} ×${s.biggestReaction.count}` : '—'
    const muts = plan.rogue.mutators.map((m) => `${MUTATORS[m]?.icon ?? ''} ${MUTATORS[m]?.name ?? m}`).join(' · ')
    const card = document.createElement('div')
    card.style.cssText =
      'width:min(92vw,460px);max-height:88vh;overflow:auto;border-radius:18px;padding:22px 22px 18px;' +
      'background:linear-gradient(170deg,#1a1030,#0d0820);border:1px solid rgba(192,107,255,.35);box-shadow:0 18px 60px rgba(0,0,0,.6);'
    card.innerHTML = `
      <div style="font:900 26px 'Baloo 2';letter-spacing:.5px;color:#d8ccff">RUN SUMMARY</div>
      ${plan.event ? `<div style="margin-top:4px;font-size:13px;font-weight:800;color:#${plan.event.color.toString(16).padStart(6, '0')}">${plan.event.icon} ${plan.event.name}</div>` : ''}
      <div style="margin-top:2px;font-size:12px;font-weight:700;color:#9ad0ff">${muts}</div>
      <div style="display:flex;gap:10px;margin-top:16px">
        <div style="flex:1;text-align:center;background:rgba(255,255,255,.05);border-radius:12px;padding:12px 6px">
          <div style="font:900 30px 'Baloo 2';color:#2ff7c3">${s.wave}</div><div style="font-size:11px;font-weight:800;opacity:.7">WAVE REACHED</div></div>
        <div style="flex:1;text-align:center;background:rgba(255,255,255,.05);border-radius:12px;padding:12px 6px">
          <div style="font:900 30px 'Baloo 2';color:#ffd54a">${s.score.toLocaleString('en-US')}</div><div style="font-size:11px;font-weight:800;opacity:.7">SCORE</div></div>
      </div>
      <div style="margin-top:14px;font-size:13px;line-height:1.7">
        <div>⚛ Biggest reaction: <b>${big}</b></div>
        <div>🔗 Combo peak: <b>×${s.maxCombo}</b> &nbsp;·&nbsp; 💥 Reactions: <b>${s.reactions}</b></div>
        <div>💀 Kills: <b>${s.kills}</b> &nbsp;·&nbsp; ⭐ Elites: <b>${s.elitesSlain}</b></div>
      </div>
      <div style="margin-top:14px;font-size:12px;font-weight:800;opacity:.7">YOUR BUILD (${s.relics.length} relics)</div>
      <div style="margin-top:6px">${relics}</div>
      <div style="margin-top:16px;display:flex;gap:8px">
        <button data-copy style="flex:1;padding:11px;border-radius:12px;border:1px solid rgba(255,255,255,.25);cursor:pointer;color:#cbe9ff;background:rgba(90,141,255,.14);font:800 13px 'Baloo 2'">🔗 Copy challenge link · seed ${this.seedCode}</button>
        <button data-close style="flex:0 0 auto;padding:11px 20px;border-radius:12px;border:1px solid rgba(255,255,255,.25);cursor:pointer;color:#fff;background:rgba(192,107,255,.24);font:800 13px 'Baloo 2'">CLOSE</button>
      </div>
      <div style="margin-top:8px;text-align:center;font-size:11px;opacity:.55">Same weekly board all week — challenge a friend to beat wave ${s.wave}</div>
    `
    ov.appendChild(card)
    document.body.appendChild(ov)
    requestAnimationFrame(() => { ov.style.opacity = '1' })
    const close = () => { ov.style.opacity = '0'; window.setTimeout(() => ov.remove(), 350) }
    card.querySelector<HTMLButtonElement>('[data-close]')!.onclick = close
    // Share the ROGUELIKE deep link (?rogue=1), NOT a bare seed — a raw seed routes
    // to plain endless. This week's link opens the same weekly board for the clicker.
    card.querySelector<HTMLButtonElement>('[data-copy]')!.onclick = () => {
      copyText(withRef(window.location.origin + window.location.pathname + '?rogue=1'))
      battleSfx.draftPick()
    }
    ov.addEventListener('click', (e) => { if (e.target === ov) close() })
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
  // CHROMANCER #55 — peak-density readability: default float height raised
  // (0.8→1.3 world units) so numbers clear the enemy/HP-bar band instead of
  // spawning right on top of the thing the player is trying to read.
  private floatAt(simX: number, simY: number, msg: string, color: number, size: number, style: 'norm' | 'combo' | 'crit' = 'norm', h = 1.3): void {
    const s = this.view.projectToScreen(simX, simY, h)
    if (s.visible) this.hud.floatText(s.x, s.y, msg, color, size, style)
  }

  // CHROMANCER #55 — MERGE every 'damage' event landing on (roughly) the same
  // target within a single drained frame into ONE rolling number instead of
  // spawning one floater per tick. A reaction chain that ticks a target 6x in
  // one frame used to spawn 6 stacked numbers piling onto the enemy/HP-bar;
  // now it spawns exactly 1 with the summed total. Bucketed by rounded
  // sim-pixel position — the same target's hits land at (near-)identical
  // coordinates within a single frame, distinct targets don't.
  private drainAndMergeEvents(): void {
    let dmgBuckets: Map<string, { x: number; y: number; amount: number; combo: number; strong: boolean; weak: boolean }> | null = null
    for (const ev of this.sim.drainEvents()) {
      if (ev.t === 'damage') {
        dmgBuckets ??= new Map()
        const key = `${Math.round(ev.x / 10)},${Math.round(ev.y / 10)}`
        const b = dmgBuckets.get(key)
        if (b) {
          b.amount += ev.amount
          b.combo = Math.max(b.combo, ev.combo)
          if (ev.eff === 'strong') b.strong = true
          else if (ev.eff === 'weak' && !b.strong) b.weak = true
        } else {
          dmgBuckets.set(key, { x: ev.x, y: ev.y, amount: ev.amount, combo: ev.combo, strong: ev.eff === 'strong', weak: ev.eff === 'weak' })
        }
        continue
      }
      this.handleEvent(ev)
    }
    if (!dmgBuckets || dmgBuckets.size === 0) return
    // dense: many distinct targets hit this same frame, or the floater band is
    // already near its cap — either way, a small non-crit/non-combo hit adds
    // clutter without adding information, so it's dropped rather than drawn.
    const dense = dmgBuckets.size > 4 || this.hud.floatersActive >= this.hud.FLOAT_CAP - 1
    for (const b of dmgBuckets.values()) this.showDamageFloat(b.x, b.y, b.amount, b.strong, b.weak, b.combo, dense)
  }

  private showDamageFloat(x: number, y: number, amount: number, strong: boolean, weak: boolean, combo: number, dense: boolean): void {
    const n = Math.max(1, Math.round(amount))
    if (dense && !strong && combo === 0 && n < 15) return
    const color = strong ? 0x8dff4a : weak ? 0xb8b0d0 : 0xffffff
    const arrow = strong ? ' ↑' : weak ? ' ↓' : ''
    // numbers GROW with the blow: base by effectiveness, plus combo and raw amount
    const size = (strong ? 24 : 20) + Math.min(26, combo * 3) + Math.min(10, Math.round(n / 12))
    const style = strong ? 'crit' : combo > 0 ? 'combo' : 'norm'
    this.floatAt(x, y, `${n}${arrow}`, color, size, style)
  }

  private handleEvent(ev: SimEvent): void {
    switch (ev.t) {
      case 'death':
        this.view.fxDeath(ev.x, ev.y, ev.color, ev.boss, ev.kind, ev.elite)
        battleSfx.kill(this.sim.comboCount, ev.boss, panFor(ev.x))
        if (qa.enabled) {
          qa.emit('kill', { kind: ev.kind, boss: ev.boss, elite: ev.elite })
          // kill pop pitch ladder: 430 Hz base, climbs one octave over 12 kills
          const ratio = Math.pow(2, Math.min(12, this.sim.comboCount) / 12)
          qa.emit('sound', { id: ev.boss ? 'kill:boss' : 'kill', gain: 0.16, playbackRate: ratio, freq: 430 * ratio, combo: this.sim.comboCount })
        }
        if (ev.boss) { this.hud.flash(0xff6ad5, 0.35); this.addHitstop(0.07); this.view.bloomPulse(0.4); duckPunch(0.6); if (!this.attract) haptic(HAPTIC.bossKill); this.tryBark('kill') }
        else if (ev.elite && this.killStopCd <= 0) { this.addHitstop(0.055); this.killStopCd = 0.45; this.view.bloomPulse(0.18); duckPunch(0.35); if (!this.attract) haptic(HAPTIC.reaction) }
        // Bestiary — "The Greyed" fills in as the player frees each kind (never keepers).
        if (ev.kind !== 'keeper' && unlockEnemyCodex(ev.kind)) this.hud.banner('✎ SKETCHBOOK UPDATED', 0xc9b6ff)
        break
      case 'shieldBreak':
        this.floatAt(ev.x, ev.y, 'SHIELD BREAK!', 0x9fdcff, 22)
        this.view.fxAoe(ev.x, ev.y, ev.radius + 20, 0x9fdcff, 0.9)
        this.view.shake(0.05)
        if (qa.enabled) { qa.emit('shake', { amplitude: 0.05, cause: 'shieldBreak' }); qa.emit('sound', { id: 'shieldBreak', gain: 0.12 }) }
        // a small satisfying freeze, but THROTTLED — a shielded pack breaking across
        // consecutive frames must not chain hard-freezes into a stutter.
        if (this.killStopCd <= 0) { this.addHitstop(0.04); this.killStopCd = 0.4 }
        battleSfx.shieldBreak(panFor(ev.x))
        break
      case 'leak': {
        // A breach on the Prism Wellspring: floating −N drain, edge flash + shake
        // scaled to the bite, and a hero flinch. Bigger hits, bigger dread.
        const heavy = ev.dmg >= 6 || ev.boss
        this.hud.flash(0xff3b3b, heavy ? 0.6 : 0.4)
        this.view.shake(heavy ? 0.16 : 0.08)
        if (qa.enabled) qa.emit('shake', { amplitude: heavy ? 0.16 : 0.08, cause: 'leak', dmg: ev.dmg })
        this.view.enemyStrike(ev.x, ev.y, ev.kind, ev.boss) // wind-up → lunge → strike the base
        this.floatAt(ev.x, ev.y - 30, `−${ev.dmg}`, heavy ? 0xff3b6b : 0xff8a9a, heavy ? 32 : 24, 'crit')
        this.view.heroHurtAll() // the line broke — every fielded hero flinches
        // NB: no hitstop on a breach — freezing the frame while you're LOSING lives
        // reads as a hitch, and breaches cluster; the edge-flash + shake + strike
        // already sell the dread. Freezes are reserved for the player's WINS.
        battleSfx.leak(ev.boss, panFor(ev.x))
        this.leakKinds[ev.kind] = (this.leakKinds[ev.kind] ?? 0) + 1 // death teaches
        break
      }
      case 'towerFire':
        this.view.fxMuzzle(ev.x, ev.y, ev.tx, ev.ty, ev.color, ev.kind)
        battleSfx.shot(ev.kind, panFor(ev.x))
        break
      case 'hit':
        this.view.fxHit(ev.x, ev.y, ev.color)
        battleSfx.hit(panFor(ev.x))
        break
      case 'chain':
        this.view.fxChain(ev.points, ev.color, ev.supercharged)
        // (renamed from SHATTER — that name now belongs to the Water+Storm reaction)
        if (ev.supercharged) {
          this.hud.waveBanner('❄⚡ SUPERCHARGED!'); this.addHitstop(0.06); duckPunch(0.4)
          const tip = ev.points[ev.points.length - 1]
          battleSfx.reaction(undefined, tip ? panFor(tip[0]) : 0)
        }
        if (ev.count > 1) {
          const last = ev.points[ev.points.length - 1]
          this.floatAt(last[0], last[1], `CHAIN ×${ev.count}`, 0xffe14a, 20)
        }
        break
      case 'aoe':
        this.view.fxAoe(ev.x, ev.y, ev.radius, ev.color, ev.alpha)
        break
      case 'combo': {
        // The streak should feel EUPHORIC. Every 5th kill pitches the sting up the
        // ladder (battleSfx.combo climbs with count); the big milestones (x10 / x25 /
        // x50 and every x25 after) earn a celebratory slam — a named callout, a
        // colour flash, a bloom surge and a fat pitched sting — the peak beat.
        const big = ev.count === 10 || ev.count === 25 || (ev.count >= 50 && ev.count % 25 === 0)
        this.floatAt(ev.x, ev.y, `COMBO ×${ev.count}!`, comboHue(ev.count), 28 + Math.min(30, ev.count * 3), 'combo', 1.1)
        if (qa.enabled) {
          qa.emit('combo', { multiplier: Math.round(ev.mult * 100) / 100, count: ev.count, milestone: big || ev.milestone, big })
          if (big || ev.milestone) {
            // combo sting pitch ladder: 660 Hz base, climbs one octave over 14 kills
            const ratio = Math.pow(2, Math.min(14, ev.count) / 14)
            qa.emit('sound', { id: 'combo', gain: 0.06, playbackRate: ratio, freq: 660 * ratio, count: ev.count })
          }
          if (big) qa.emit('callout', { text: `COMBO ×${ev.count}`, kind: 'KILL STREAK' })
        }
        const reduced = appSettings.reducedMotion()
        if (big) {
          this.hud.reactionCallout(`COMBO ×${ev.count}`, comboHue(ev.count), 'KILL STREAK')
          if (!reduced) { this.hud.flash(comboHue(ev.count), 0.3, 240); this.view.bloomPulse(0.3) }
          battleSfx.combo(ev.count)
          duckPunch(0.4)
          if (!this.attract) haptic(HAPTIC.reaction)
          this.tryBark('kill')
        } else if (ev.milestone) {
          if (!reduced) this.hud.flash(comboHue(ev.count), 0.18, 220)
          battleSfx.combo(ev.count)
        }
        break
      }
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
      case 'salvage': {
        // sell beat: a small dust ring where the tower stood + the refund arcing up
        this.view.fxAoe(ev.x, ev.y, 46, ev.color, 0.6)
        this.floatAt(ev.x, ev.y, `+$${ev.refund}`, 0xffd54a, 24)
        const sp = this.view.projectToScreen(ev.x, ev.y, 0.8)
        if (sp.visible) this.hud.coinBurst(sp.x, sp.y, Math.min(ev.refund, 40))
        battleSfx.coin(2)
        if (!this.attract) haptic(HAPTIC.place)
        break
      }
      case 'spell':
        this.view.fxSpell(ev.key, ev.x, ev.y, ev.radius, ev.color)
        battleSfx.spell(ev.key === 'meteor', panFor(ev.x))
        if (ev.key === 'meteor') this.hud.flash(0xffb15c, 0.35)
        else if (ev.key === 'freeze') { this.hud.flash(0x9fdcff, 0.4); if (ev.count > 0) this.hud.banner(`FROZEN ×${ev.count}!`, ev.color) }
        else this.floatAt(ev.x, ev.y, `+${ev.count} GOLD!`, 0xffd54a, 30)
        break
      case 'heroDeploy':
        this.view.fxHeroDeploy(ev.x, ev.y, ev.color, ev.radius)
        this.hud.flash(ev.color, 0.25)
        battleSfx.heroDeploy()
        heroVo(undefined, 'deploy', panFor(ev.x))
        break
      case 'heroFire':
        this.view.fxHeroFire(ev.x, ev.y, ev.tx, ev.ty, ev.color)
        battleSfx.shot('hero', panFor(ev.x))
        break
      case 'heroMove':
        // the hero blinks to a new tile — streak from old cell to new + settle ring.
        this.view.fxHeroFire(ev.fromX, ev.fromY, ev.x, ev.y, ev.color)
        this.view.fxHeroDeploy(ev.x, ev.y, ev.color, ev.radius)
        battleSfx.heroDeploy()
        break
      case 'heroSpell':
        this.view.fxHeroSpell(ev.effect, ev.x, ev.y, ev.radius, ev.color)
        this.hud.flash(ev.color, 0.55)
        this.view.shake(0.045) // a signature ULT lands as a real punch
        if (!this.attract) haptic(HAPTIC.reaction)
        this.hud.banner(ev.name.toUpperCase() + '!', ev.color)
        battleSfx.spell(ev.effect === 'aoeBurn' || ev.effect === 'execute', panFor(ev.x))
        // the hero's SIGNATURE — a stylized vocal punch on the bus (not the chat feed)
        heroVo(undefined, 'signature', panFor(ev.x))
        break
      case 'heroSig':
        // a signature mechanic detonated — the hero pops a cast beat + element
        // flourish, and (out of attract/demo) it feeds that hero's quest progress
        this.view.pulseHeroSig(ev.slotId, ev.x, ev.y, ev.color)
        this.bumpArc(ev.heroId, 'signature')
        break
      case 'wyrmBreath':
        // a bonded Wyrm exhales — a coloured elemental burst around its hero.
        if (ev.ult) {
          this.view.fxReaction(ev.x, ev.y, ev.radius, ev.color, ev.color)
          this.hud.flash(ev.color, 0.3)
          this.hud.banner(`★ ${ev.name.toUpperCase()}!`, ev.color)
          duckPunch(0.5)
          battleSfx.reaction(undefined, panFor(ev.x))
          heroVo(ev.element, 'awaken', panFor(ev.x)) // the Wyrm awakens — a vocal swell
        } else {
          this.view.fxAoe(ev.x, ev.y, ev.radius, ev.color, 0.5)
        }
        break
      case 'reaction': {
        // FRAME-LOCK: the distinct reaction SFX, the burst, the shake, the haptic
        // and the music-duck all fire off THIS one event so the detonation lands as
        // a single A/V punch. `mag` scales it so a big AoE reaction hits harder than
        // a light mark ("bigger reactions = bigger hit"). The LOUD beat (callout +
        // screen-flash + bloom surge + hitstop) is throttled below so a peak-density
        // burst never strobes or over-freezes the board.
        const mag = REACTION_MAG[ev.key] ?? 0.75
        this.view.fxReaction(ev.x, ev.y, ev.radius, ev.color, ev.color2, ev.key, mag)
        this.floatAt(ev.x, ev.y, ev.name + '!', ev.color, 24 + Math.round(mag * 8), 'combo', 1.1)
        if (!this.attract) haptic(HAPTIC.reaction) // sharp single bump on detonation
        duckPunch(0.4 + mag * 0.2)
        battleSfx.reaction(ev.key, panFor(ev.x))
        if (qa.enabled) {
          // FRAME-LOCK: burst + shake + sound (+ throttled callout/flash below) all
          // land on THIS frame index. `magnitude`→`shakeAmplitude` is monotonic
          // (fxReaction shakes 0.055 + 0.055·max(0.4,mag)), so bigger reaction ⇒
          // bigger amplitude is directly assertable from the log.
          const shakeAmp = 0.055 + 0.055 * Math.max(0.4, mag)
          qa.lastReaction = ev.name
          qa.emit('reaction', { name: ev.name, key: ev.key, magnitude: mag, x: ev.x, y: ev.y, shakeAmplitude: Math.round(shakeAmp * 1000) / 1000, requestedHitstopMs: Math.round((0.045 + mag * 0.025) * 1000) })
          qa.emit('shake', { amplitude: Math.round(shakeAmp * 1000) / 1000, cause: 'reaction', magnitude: mag })
          qa.emit('sound', { id: `reaction:${ev.key}`, gain: 0.16, magnitude: mag })
        }
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
          // the throttled LOUD beat: the named slam + a brief element-flash + a bloom
          // surge + the freeze-frame — gated so a burst of reactions can't strobe.
          this.hud.reactionCallout(ev.name, ev.color)
          if (qa.enabled) qa.emit('callout', { text: ev.name, kind: 'reaction', magnitude: mag })
          this.reactCalloutCd = 0.55
          this.addHitstop(0.045 + mag * 0.025) // 40–70ms, scaled by hitstopScale()
          if (!appSettings.reducedMotion()) {
            this.hud.flash(ev.color, 0.1 + mag * 0.12, 200) // brief element-colored surge (opacity-damped under reduce-motion)
            this.view.bloomPulse(0.14 + mag * 0.2)
          }
        }
        if (unlockCodex('field-reactions')) this.hud.banner('✎ SKETCHBOOK UPDATED', 0xc9b6ff)
        // CROWN-JEWEL depth, made legible: log this reaction to the discovery
        // tracker and celebrate the FIRST time each of the nine is seen.
        if (recordReaction(ev.key)) {
          this.hud.banner(`NEW REACTION · ${reactionsDiscoveredCount()}/${REACTION_TOTAL} DISCOVERED`, ev.color)
        }
        this.tryBark('reaction')
        break
      }
      case 'fuse':
        // FUSION FORGED — an earned spectacle: the partner flares out, the host
        // erupts in both colours, and the new tower's name slams on screen.
        this.view.fxReaction(ev.px, ev.py, 60, ev.color2, ev.color)
        this.view.fxReaction(ev.x, ev.y, 110, ev.color, ev.color2)
        this.view.bloomPulse(0.35)
        this.hud.flash(ev.color, 0.3)
        this.hud.reactionCallout(`⚛ ${ev.name}`, ev.color)
        this.addHitstop(0.07)
        battleSfx.fusion()
        if (unlockCodex('field-fusion')) this.hud.banner('✎ SKETCHBOOK UPDATED', 0xc9b6ff)
        this.tryBark('fusion')
        break
      case 'morose':
        // THE signature moment: Morose reaches into the battle and condoles.
        if (ev.kind === 'warn') {
          this.hud.moroseVeil(ev.duration + 0.6)
          playMoroseHush()
          spectralDip(0.5) // the light drains — the mix muffles, then recovers
        } else if (ev.kind === 'greyTower') {
          this.hud.moroseVeil(ev.duration * 0.6)
          spectralDip(0.4) // a greyed tower's voice goes muffled
          this.tryBark('moroseGrey')
          if (unlockCodex('field-intrusion')) this.hud.banner('✎ SKETCHBOOK UPDATED', 0xc9b6ff)
        } else {
          playMoroseHush()
          spectralDip(0.5)
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
      // the entrance beat fires once, even if the sim re-announces the reveal
      if (!this.keeperTold.has(k.id)) this.view.fxKeeperReveal(ev.x, ev.y, ev.color, ev.accent)
      if (this.keeperTold.has(k.id)) return
      this.keeperTold.add(k.id)
      this.hud.chatBark(k.id, k.barks.reveal)
      this.hud.moroseVeil(1.6)
      // the twisted hero answers, if they are on the line
      if (this.partyIds.includes(k.heroId)) {
        this.keeperTimers.push(window.setTimeout(() => { if (!this.resultShown) this.hud.chatBark(k.heroId, k.barks.heroLine) }, 2100))
      }
    } else if (ev.kind === 'telegraph') {
      this.view.fxKeeperTelegraph(ev.x, ev.y, ev.radius, ev.accent)
    } else if (ev.kind === 'cast') {
      this.view.fxKeeperCast(ev.x, ev.y, ev.radius, ev.color, ev.accent)
      battleSfx.bossHit(panFor(ev.x)) // the boss strikes — a meaty low thud
    } else if (ev.kind === 'phase') {
      this.view.fxKeeperPhase(ev.x, ev.y, ev.color, ev.accent)
      if (ev.phase === 2) this.hud.chatBark(k.id, k.barks.phase2)
      else if (ev.phase === 3) this.hud.chatBark(k.id, k.barks.phase3)
    } else if (ev.kind === 'redeemed') {
      if (this.keeperRedeemed.has(k.id)) return
      this.keeperRedeemed.add(k.id)
      // THE payoff beat: the grey breaks, the Keeper's true name returns in colour
      this.hud.chatBark(k.id, k.barks.redeemed)
      this.hud.banner(`✦ ${k.trueName.toUpperCase()} — REDEEMED`, k.enemy.accent, BANNER_PRIORITY.boss)
      if (!appSettings.reducedMotion()) this.greyBloomT = Math.max(this.greyBloomT, 1.3)
      this.view.fxKeeperRedeem(ev.x, ev.y, ev.color, ev.accent)
      duckPunch(0.6)
      battleSfx.reaction(undefined, panFor(ev.x))
      if (unlockCodexBatch(CODEX_ON_KEEPER_REDEEM[k.id]) > 0) this.hud.banner('✎ SKETCHBOOK UPDATED', 0xc9b6ff)
      // Morose's thread stinger, a beat later — his reaction degrades across the six
      this.keeperTimers.push(window.setTimeout(() => { if (!this.resultShown) this.hud.chatBark('morose', k.barks.morose) }, 2600))
    }
  }

  // ======================================================================
  //  TEARDOWN (critical: dispose GL context every time we leave/restart)
  // ======================================================================
  // ======================================================================
  //  QA DRIVE surface (gated — only reachable via window.__chromancer)
  // ======================================================================
  private qaMakeControl(): QaSceneControl {
    const scene = this
    return {
      sim: () => scene.sim,
      // Re-enter the REAL update() (render + view + hitstop) one frame at a fixed
      // dt on a synthetic monotonic clock — deterministic, and juice stays measurable.
      stepOnce: (dtMs: number) => { scene.qaClock += dtMs; scene.update(scene.qaClock, dtMs) },
      placeTower: (kind, col, row) => {
        const k = kind as TowerKind
        if (!TOWERS[k]) return false
        scene.sim.qaGrantGold(scene.sim.placeCost(k)) // QA convenience: never fail on affordability
        return !!scene.sim.placeTower(k, col, row)
      },
      placeHero: (heroId, col, row) => {
        if (!heroById(heroId)) return false
        scene.sim.qaGrantGold(scene.sim.heroDeployCost(heroId))
        return !!scene.sim.deployHero(heroId, col, row)
      },
      upgradeTower: (col, row) => {
        const t = scene.sim.towerAt(col, row)
        if (!t) return false
        const cost = scene.sim.upgradeCostFor(t)
        if (cost === null) return false
        scene.sim.qaGrantGold(cost)
        return scene.sim.upgradeTower(t.id)
      },
      sellTower: (col, row) => {
        const t = scene.sim.towerAt(col, row)
        return !!t && scene.sim.salvageTower(t.id) !== null
      },
      startWave: () => { if (scene.sim.state === 'prep') scene.sim.startWave() },
      skipToWave: (n) => scene.sim.qaSkipToWave(n),
      forceWin: () => scene.sim.qaForceEnd('won'),
      forceDefeat: () => scene.sim.qaForceEnd('lost'),
      triggerReaction: (name) => scene.qaFireReaction(name),
      showPlacement: (on) => scene.view.setBuildHighlight(on),
      state: () => scene.qaState(),
    }
  }

  // Fire a NAMED reaction's full view juice on demand — burst, callout, shake,
  // sound, hitstop, telemetry — WITHOUT the save-state side effects of the live
  // handler (no codex unlock / ftue / discovery banners). Pure measurement.
  private qaFireReaction(name: string): boolean {
    const key = qaReactionKey(name)
    if (!key) return false
    const def = REACTIONS[key]
    const mag = REACTION_MAG[key] ?? 0.75
    const cx = MAP_X + MAP_W / 2
    const cy = MAP_Y + MAP_H / 2
    const radius = 70
    this.view.fxReaction(cx, cy, radius, def.color, def.color2, key, mag)
    this.floatAt(cx, cy, def.name + '!', def.color, 24 + Math.round(mag * 8), 'combo', 1.1)
    duckPunch(0.4 + mag * 0.2)
    battleSfx.reaction(key, panFor(cx))
    const shakeAmp = 0.055 + 0.055 * Math.max(0.4, mag)
    qa.lastReaction = def.name
    qa.emit('reaction', { name: def.name, key, magnitude: mag, x: cx, y: cy, shakeAmplitude: Math.round(shakeAmp * 1000) / 1000, requestedHitstopMs: Math.round((0.045 + mag * 0.025) * this.hitstopScale() * 1000) })
    qa.emit('shake', { amplitude: Math.round(shakeAmp * 1000) / 1000, cause: 'reaction', magnitude: mag })
    qa.emit('sound', { id: `reaction:${key}`, gain: 0.16, magnitude: mag })
    if (this.reactCalloutCd <= 0) {
      this.hud.reactionCallout(def.name, def.color)
      qa.emit('callout', { text: def.name, kind: 'reaction', magnitude: mag })
      this.reactCalloutCd = 0.55
      this.addHitstop(0.045 + mag * 0.025)
      if (!appSettings.reducedMotion()) { this.hud.flash(def.color, 0.1 + mag * 0.12, 200); this.view.bloomPulse(0.14 + mag * 0.2) }
    }
    return true
  }

  private qaState(): QaState {
    const s = this.sim
    const towers = s.towers.filter((t) => t.active).map((t) => ({ id: t.id, kind: t.kind as string, col: t.col, row: t.row, level: t.level }))
    return {
      wave: s.waveIndex + 1,
      waveTotal: s.totalWaves(),
      state: s.state,
      baseHp: s.baseHp,
      baseIntegrity: Math.round(s.baseIntegrity * 1000) / 1000,
      gold: s.gold,
      mana: null, // gold-only economy — no mana resource exists in the sim
      aliveEnemies: s.liveEnemyCount(),
      towers,
      comboMult: Math.round(s.comboMult * 100) / 100,
      comboCount: s.comboCount,
      draftOffer: s.state === 'draft' ? s.draftOffer.map((c) => c.title) : [],
      currentReaction: qa.lastReaction,
      frame: qa.frame,
      driven: qa.driven,
      boardTexture: this.view.boardTextureState(),
    }
  }

  private teardown(): void {
    if (this.qaCtl) { qa.unbindScene(this.qaCtl); this.qaCtl = null }
    unmountQaJuicePanel()
    // leaving battle: colour + volume back to neutral so map/menu music is full
    // spectrum and un-ducked (the greying is a battlefield state, not a global one).
    music.setBoss(false)
    music.setIntensity(0)
    resetAudioScene()
    this.camCtl?.dispose()
    this.camCtl = null
    window.removeEventListener('resize', this.onResize)
    window.removeEventListener('keydown', this.onKeyDown)
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
    this.ghostEl?.remove()
    this.ghostEl = null
    this.ghost = null
    this.coach?.dispose()
    this.coach = null
    this.hud?.dispose()
    this.view?.dispose()
  }
}

// Detonation "weight" per reaction — drives burst size, camera bite, flash + freeze
// so the nine read on a scale: a wide AoE boom SLAMS, a single-target mark taps.
// (View/FX only — never touches the sim's damage/effect math.)
const REACTION_MAG: Record<string, number> = {
  flashover: 1, // Fire+Storm — big AoE explosion
  shatter: 1, // Water+Storm — heavy burst (doubled vs armor)
  eclipse: 0.95, // Light+Dark — area stun
  conduct: 0.85, // Storm+Light — chain arc
  thermal: 0.8, // Fire+Water — armor break + burst
  wildfire: 0.8, // Fire+Nature — spreading burn
  overgrow: 0.75, // Water+Nature — area root/slow
  blight: 0.7, // Nature+Dark — poison field
  amplify: 0.55, // Arcane — a vulnerability MARK, not a blast
}

// QA: resolve a human reaction identifier ('SHATTER', 'Thermal Shock', 'thermal',
// 'thermal shock') to its ReactionKey. Case/space/underscore tolerant.
function qaReactionKey(name: string): ReactionKey | null {
  const norm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, '')
  const q = norm(name)
  for (const k of Object.keys(REACTIONS) as ReactionKey[]) {
    if (norm(k) === q || norm(REACTIONS[k].name) === q) return k
  }
  return null
}

function comboHue(count: number): number {
  const t = Math.min(1, count * 0.08)
  const r = 255
  const g = Math.round(213 - t * 120)
  const b = Math.round(74 + t * 160)
  return (r << 16) | (g << 8) | b
}
