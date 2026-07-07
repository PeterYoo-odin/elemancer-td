// BattleScene — the ORCHESTRATOR. It owns no gameplay: it drives the pure sim,
// renders it through a Three.js WebGL view (BattleView3D) and a DOM/CSS HUD
// (BattleHud), forwards input into the sim, and turns semantic sim events into
// juice. Phaser is kept only as the app shell + scene router (Menu/Map/Shop/…);
// the battle board itself is real 3D on a full-window canvas above Phaser's.

import Phaser from 'phaser'
import { TOWERS, type TowerKind } from '../game/towers'
import { LEVELS, levelById, serpentine, starsForClear, type LevelDef } from '../game/levels'
import { SPELLS, type SpellKey } from '../game/spells'
import { economy } from '../game/economy'
import { Sim, MAP_X, MAP_Y, MAP_W, MAP_H, cellCenter, type SimEvent } from '../sim'
import { BattleView3D } from '../three/BattleView3D'
import { BattleHud, type HudContext } from '../ui/BattleHud'

const ENDLESS_START_GOLD = 300
const ENDLESS_START_LIVES = 20

type InputMode = 'idle' | 'building' | 'deploying' | 'aiming'

export class BattleScene extends Phaser.Scene {
  private levelId = 'l1'
  private endless = false
  private level!: LevelDef
  private sim!: Sim
  private view!: BattleView3D
  private hud!: BattleHud

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

  private onDown = (e: PointerEvent) => this.handleDown(e)
  private onMove = (e: PointerEvent) => this.handleMove(e)
  private onResize = () => this.view?.resize()
  private lastTime = 0
  private hitstopT = 0 // brief slow-mo on big kills (view pacing only)
  private lastSimState = ''

  constructor() { super('Battle') }

  init(data: { levelId?: string; endless?: boolean }): void {
    this.endless = !!data?.endless
    this.levelId = data?.levelId ?? 'l1'
  }

  create(): void {
    // ---- run config (unchanged from the 2D scene) ----
    this.level = this.endless ? this.endlessLevel() : levelById(this.levelId) ?? LEVELS[0]
    const mods = economy.runModifiers(this.endless)
    const startGold = this.endless ? ENDLESS_START_GOLD : this.level.startGold + mods.startGoldBonus
    const startLives = this.endless ? ENDLESS_START_LIVES : this.level.startLives + mods.startLivesBonus
    const seed = this.endless
      ? (0xE9D1E55 ^ (economy.data.endlessBest * 2654435761)) >>> 0
      : (0xA5EED ^ (this.level.index * 40503) ^ 0x1234) >>> 0
    // resolve the chosen loadout into (heroId, level) pairs — economy.party() is
    // already filtered to unlocked, valid heroes, so no bad id reaches the sim.
    const party = economy.party().map((id) => ({ heroId: id, level: economy.heroState(id).level }))
    this.sim = new Sim({ level: this.level, mods, seed, endless: this.endless, startGold, startLives, party })

    // reset transient state (scene instance is reused across restarts)
    this.gameSpeed = 1
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

    // ---- 3D view ----
    const accent = this.level.palette.pathEdge
    const pathCells = serpentine(this.level.lanes) // ordered spawn→base, for tile orientation
    this.view = new BattleView3D(this.sim, this.level.palette, accent, pathCells)
    this.view.mount(document.body)

    // ---- DOM HUD ----
    this.hud = new BattleHud({
      onStart: () => { if (this.sim.state === 'prep') this.sim.startWave() },
      onPause: () => this.togglePause(),
      onSpeed: () => this.toggleSpeed(),
      onTowerButton: (k) => this.onTowerButton(k),
      onSpellButton: (k) => this.onSpellButton(k),
      onHeroButton: (id) => this.onHeroButton(id),
      onSelectDeselect: () => this.deselect(),
      onUpgrade: (id) => { if (this.sim.upgradeTower(id)) this.hud.showUpgrade(this.sim, id) },
      onBranch: (id, idx) => { if (this.sim.chooseBranch(id, idx)) this.hud.showUpgrade(this.sim, id) },
      onTargeting: (id) => this.cycleTargeting(id),
      onDraft: (i) => this.pickDraft(i),
      onQuit: () => this.quitBattle(),
      onReplay: () => this.scene.restart({ levelId: this.levelId, endless: this.endless }),
      onBack: () => this.scene.start(this.endless ? 'Menu' : 'Map'),
    })
    this.hud.setLevelName(this.level.name)

    // ---- input + lifecycle ----
    this.view.canvas.addEventListener('pointerdown', this.onDown)
    this.view.canvas.addEventListener('pointermove', this.onMove)
    window.addEventListener('resize', this.onResize)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown())
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.teardown())

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
    this.sim.advance(simDt)

    for (const ev of this.sim.drainEvents()) this.handleEvent(ev)

    // wave-start flourish on the prep→active transition
    if (this.sim.state === 'active' && this.lastSimState === 'prep') {
      this.hud.waveBanner(`WAVE ${this.sim.waveIndex + 1}`)
    }
    this.lastSimState = this.sim.state

    this.view.syncFrom(this.selectedId)
    this.view.render(dt)
    this.hud.update(this.sim, this.hudCtx())

    // state-driven overlays
    if (this.sim.state === 'draft' && !this.draftShown) { this.draftShown = true; this.enterDraftUi() }
    if (this.sim.state !== 'draft' && this.draftShown) { this.draftShown = false; this.hud.hideDraft() }
    if ((this.sim.state === 'won' || this.sim.state === 'lost') && !this.resultShown) this.showResult()
    void time
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
  private handleDown(e: PointerEvent): void {
    if (!this.sim) return
    if (this.sim.state === 'won' || this.sim.state === 'lost' || this.sim.state === 'draft') return
    if (this.paused) return

    if (this.mode === 'aiming') {
      // The spell button is a DOM click (never a canvas pointerdown), so the FIRST
      // canvas tap here is the intended aim — no "just entered" tap to swallow.
      const p = this.view.pickPoint(e.clientX, e.clientY)
      if (p && this.inMap(p.x, p.y)) {
        if (this.aimingHeroSlot != null) this.sim.castHeroSpell(this.aimingHeroSlot, p.x, p.y)
        else if (this.aimingSpell) this.sim.castSpell(this.aimingSpell, p.x, p.y)
      }
      this.exitAiming()
      return
    }

    const cell = this.view.pickCell(e.clientX, e.clientY)
    if (!cell) { if (this.mode === 'idle') this.deselect(); return }

    if (this.mode === 'building') { this.tryPlace(cell.col, cell.row); return }
    if (this.mode === 'deploying') { this.tryDeploy(cell.col, cell.row); return }

    const t = this.sim.towerAt(cell.col, cell.row)
    if (t) this.selectTower(t.id)
    else this.deselect()
  }

  private handleMove(e: PointerEvent): void {
    if (!this.sim) return
    if (this.mode === 'building' || this.mode === 'deploying') {
      const cell = this.view.pickCell(e.clientX, e.clientY)
      this.view.setHover(cell, cell ? this.sim.canPlace(cell.col, cell.row) : false)
    } else if (this.mode === 'aiming') {
      const cell = this.view.pickCell(e.clientX, e.clientY)
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
    if (h) this.exitDeploy() // one deploy per hero → drop out of deploy mode
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
    const modes = ['First', 'Last', 'Close', 'Strong'] as const
    const next = modes[(modes.indexOf(t.targeting) + 1) % modes.length]
    this.sim.setTargeting(id, next)
    this.hud.showUpgrade(this.sim, id)
  }

  private towerUnlocked(kind: TowerKind): boolean {
    return this.endless || economy.isTowerUnlocked(kind)
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
    if (card) this.hud.flash(card.color, 0.4)
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
      this.hud.showPause(this.endless)
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

  private showResult(): void {
    this.resultShown = true
    this.exitBuild()
    this.exitAiming()
    this.exitDeploy()
    this.deselect()
    if (this.sim.state === 'won') {
      const stars = starsForClear(this.sim.lives, this.sim.startLives)
      const result = economy.awardCampaign(this.level.id, stars, this.level.baseCoins)
      const shards = this.awardHeroes(20 + stars * 12, 55 + stars * 30)
      let unlocked: string | null = null
      if (result.firstClear && this.level.unlockTower && !economy.isTowerUnlocked(this.level.unlockTower)) {
        economy.unlockTower(this.level.unlockTower)
        unlocked = TOWERS[this.level.unlockTower].name
      }
      this.hud.flash(0x2ff7c3, 0.4)
      this.hud.showResult({ win: true, title: 'VICTORY!', color: 0x2ff7c3, stars, coins: result.coins, diamonds: result.diamonds, shards, unlocked, endless: this.endless })
    } else {
      this.hud.flash(0xff3b6b, 0.5)
      if (this.endless) {
        const res = economy.awardEndless(this.sim.waveIndex)
        const shards = this.awardHeroes(this.endlessShards(), this.endlessXp())
        this.hud.showResult({ win: false, title: 'DEFEAT', color: 0xff5b7a, stars: 0, coins: res.coins, diamonds: 0, shards, unlocked: null, sub: `Reached wave ${this.sim.waveIndex + 1}${res.best ? ' · NEW BEST!' : ''}`, endless: true })
      } else {
        this.hud.showResult({ win: false, title: 'DEFEAT', color: 0xff5b7a, stars: 0, coins: 0, diamonds: 0, shards: 0, unlocked: null, sub: 'The crystal was overrun…', endless: false })
      }
    }
  }

  // ======================================================================
  //  SIM EVENTS → JUICE
  // ======================================================================
  private floatAt(simX: number, simY: number, msg: string, color: number, size: number, combo = false, h = 0.8): void {
    const s = this.view.projectToScreen(simX, simY, h)
    if (s.visible) this.hud.floatText(s.x, s.y, msg, color, size, combo)
  }

  private handleEvent(ev: SimEvent): void {
    switch (ev.t) {
      case 'damage': {
        const n = Math.max(1, Math.round(ev.amount))
        const color = ev.eff === 'strong' ? 0x8dff4a : ev.eff === 'weak' ? 0xb8b0d0 : 0xffffff
        const arrow = ev.eff === 'strong' ? ' ↑' : ev.eff === 'weak' ? ' ↓' : ''
        const size = (ev.eff === 'strong' ? 24 : 20) + Math.min(26, ev.combo * 3)
        this.floatAt(ev.x, ev.y, `${n}${arrow}`, color, size, ev.combo > 0)
        break
      }
      case 'death':
        this.view.fxDeath(ev.x, ev.y, ev.color, ev.boss, ev.kind)
        if (ev.boss) { this.hud.flash(0xff6ad5, 0.35); this.hitstopT = 0.22 }
        break
      case 'shieldBreak':
        this.floatAt(ev.x, ev.y, 'SHIELD BREAK!', 0x9fdcff, 22)
        this.view.fxAoe(ev.x, ev.y, ev.radius + 20, 0x9fdcff, 0.9)
        break
      case 'leak':
        this.hud.flash(0xff3b3b, 0.4)
        break
      case 'towerFire':
        this.view.fxMuzzle(ev.x, ev.y, ev.tx, ev.ty, ev.color, ev.kind)
        break
      case 'hit':
        this.view.fxHit(ev.x, ev.y, ev.color)
        break
      case 'chain':
        this.view.fxChain(ev.points, ev.color, ev.supercharged)
        if (ev.supercharged) { this.hud.waveBanner('❄⚡ SHATTER!'); this.hitstopT = Math.max(this.hitstopT, 0.12) }
        if (ev.count > 1) {
          const last = ev.points[ev.points.length - 1]
          this.floatAt(last[0], last[1], `CHAIN ×${ev.count}`, 0xffe14a, 20)
        }
        break
      case 'aoe':
        this.view.fxAoe(ev.x, ev.y, ev.radius, ev.color, ev.alpha)
        break
      case 'combo':
        this.floatAt(ev.x, ev.y, `COMBO ×${ev.count}!`, comboHue(ev.count), 28 + Math.min(30, ev.count * 3), true, 1.1)
        if (ev.milestone) this.hud.flash(comboHue(ev.count), 0.25)
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
        break
      case 'upgrade':
        this.view.fxAoe(ev.x, ev.y, ev.radius, ev.color, 0.9)
        this.floatAt(ev.x, ev.y, ev.label, ev.color, 26)
        if (this.selectedId != null) this.hud.showUpgrade(this.sim, this.selectedId)
        break
      case 'spell':
        this.view.fxSpell(ev.key, ev.x, ev.y, ev.radius, ev.color)
        if (ev.key === 'meteor') this.hud.flash(0xffb15c, 0.35)
        else if (ev.key === 'freeze') { this.hud.flash(0x9fdcff, 0.4); if (ev.count > 0) this.hud.banner(`FROZEN ×${ev.count}!`, ev.color) }
        else this.floatAt(ev.x, ev.y, `+${ev.count} GOLD!`, 0xffd54a, 30)
        break
      case 'heroDeploy':
        this.view.fxHeroDeploy(ev.x, ev.y, ev.color, ev.radius)
        this.hud.flash(ev.color, 0.25)
        break
      case 'heroFire':
        this.view.fxHeroFire(ev.x, ev.y, ev.tx, ev.ty, ev.color)
        break
      case 'heroSpell':
        this.view.fxHeroSpell(ev.effect, ev.x, ev.y, ev.radius, ev.color)
        this.hud.flash(ev.color, 0.4)
        this.hud.banner(ev.name.toUpperCase() + '!', ev.color)
        break
      case 'banner':
        this.hud.banner(ev.msg, ev.color)
        break
      case 'text':
        this.floatAt(ev.x, ev.y, ev.msg, ev.color, ev.size)
        break
    }
  }

  // ======================================================================
  //  TEARDOWN (critical: dispose GL context every time we leave/restart)
  // ======================================================================
  private teardown(): void {
    this.view?.canvas.removeEventListener('pointerdown', this.onDown)
    this.view?.canvas.removeEventListener('pointermove', this.onMove)
    window.removeEventListener('resize', this.onResize)
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
