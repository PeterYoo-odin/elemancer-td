// BattleScene — a THIN VIEW over the pure simulation core (src/sim). It owns NO
// game logic: each frame it (1) advances the sim with a fixed-timestep accumulator,
// (2) reconciles Phaser GameObjects to the sim's pooled entity state (keyed by
// stable monotonic id), (3) drains semantic sim events and turns them into juice,
// and (4) forwards input into the sim. Swap this file for a Three.js view later
// and the gameplay is untouched.

import Phaser from 'phaser'
import { ENEMIES, type EnemyDef, type EnemyKind } from '../game/enemies'
import { TOWERS, TOWER_ORDER, type TowerDef, type TowerKind } from '../game/towers'
import { LEVELS, levelById, serpentine, starsForClear, type LevelDef } from '../game/levels'
import { SPELLS, SPELL_ORDER, type SpellDef, type SpellKey } from '../game/spells'
import { economy } from '../game/economy'
import {
  Sim,
  TILE,
  MAP_X,
  MAP_Y,
  MAP_W,
  MAP_H,
  COLS,
  ROWS,
  cellCenter,
  worldToCell,
  TARGET_MODES,
  ELEMENT_COLOR,
  type SimEnemy,
  type SimTower,
  type SimEvent,
  type TargetMode,
  type Effectiveness,
} from '../sim'

const ENDLESS_START_GOLD = 300
const ENDLESS_START_LIVES = 20

const C = {
  base: 0x2ff7c3,
  portal: 0x9a5cff,
  hudBg: 0x241447,
  panel: 0x2e1a5a,
  gold: 0xffd54a,
  life: 0xff5b7a,
  white: 0xffffff,
}

type InputMode = 'idle' | 'building' | 'aiming'

interface EnemyView {
  cont: Phaser.GameObjects.Container
  body: Phaser.GameObjects.Shape
  hpFill: Phaser.GameObjects.Rectangle
  tag: Phaser.GameObjects.Text
  shieldGfx: Phaser.GameObjects.Arc | null
  def: EnemyDef
}
interface TowerView {
  cont: Phaser.GameObjects.Container
  turret: Phaser.GameObjects.Shape
  ring: Phaser.GameObjects.Arc
  lastLevel: number
}

// Tiny WebAudio blip so combos get the rising-pitch feedback the design calls for.
class Blipper {
  private ctx: AudioContext | null = null
  private ok = true
  private ensure(): AudioContext | null {
    if (!this.ok) return null
    if (this.ctx) return this.ctx
    try {
      const Ctor = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)
      this.ctx = new Ctor()
    } catch {
      this.ok = false
    }
    return this.ctx
  }
  blip(freq: number, vol = 0.06): void {
    const ctx = this.ensure()
    if (!ctx) return
    try {
      if (ctx.state === 'suspended') void ctx.resume()
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = 'triangle'
      o.frequency.value = Math.min(3000, Math.max(80, freq))
      g.gain.value = vol
      o.connect(g)
      g.connect(ctx.destination)
      const t = ctx.currentTime
      g.gain.setValueAtTime(vol, t)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12)
      o.start(t)
      o.stop(t + 0.13)
    } catch {
      /* ignore — audio is a nicety, never a failure */
    }
  }
}

export class BattleScene extends Phaser.Scene {
  private levelId = 'l1'
  private endless = false
  private level!: LevelDef
  private sim!: Sim

  private enemyViews = new Map<number, EnemyView>()
  private towerViews = new Map<number, TowerView>()
  private projViews = new Map<number, Phaser.GameObjects.Arc>()
  private activeScratch = new Set<number>()

  private gameSpeed = 1
  private paused = false
  private resultShown = false
  private draftShown = false

  // input
  private mode: InputMode = 'idle'
  private buildKind: TowerKind | null = null
  private aimingSpell: SpellKey | null = null
  private justEnteredAiming = false
  private ghost?: Phaser.GameObjects.Container
  private ghostRing?: Phaser.GameObjects.Arc
  private aimReticle?: Phaser.GameObjects.Container
  private selectedId: number | null = null

  // HUD
  private goldText!: Phaser.GameObjects.Text
  private livesText!: Phaser.GameObjects.Text
  private waveText!: Phaser.GameObjects.Text
  private comboText!: Phaser.GameObjects.Text
  private goldIcon = { x: 72, y: 42 }
  private startBtn!: Phaser.GameObjects.Container
  private startLabel!: Phaser.GameObjects.Text
  private speedLabel!: Phaser.GameObjects.Text
  private pauseLabel!: Phaser.GameObjects.Text
  private towerButtons: Phaser.GameObjects.Container[] = []
  private spellButtons: Array<{ key: SpellKey; def: SpellDef; cont: Phaser.GameObjects.Container; ring: Phaser.GameObjects.Graphics }> = []
  private upgradePanel?: Phaser.GameObjects.Container
  private draftObjects: Phaser.GameObjects.GameObject[] = []
  private telegraph?: Phaser.GameObjects.Container
  private buffLinks!: Phaser.GameObjects.Graphics
  private banner?: Phaser.GameObjects.Text
  private pauseQuitBtn?: Phaser.GameObjects.Container
  private blipper = new Blipper()

  constructor() {
    super('Battle')
  }

  init(data: { levelId?: string; endless?: boolean }): void {
    this.endless = !!data?.endless
    this.levelId = data?.levelId ?? 'l1'
  }

  create(): void {
    // resolve run config
    this.level = this.endless ? this.endlessLevel() : levelById(this.levelId) ?? LEVELS[0]
    const mods = economy.runModifiers(this.endless)
    const startGold = this.endless ? ENDLESS_START_GOLD : this.level.startGold + mods.startGoldBonus
    const startLives = this.endless ? ENDLESS_START_LIVES : this.level.startLives + mods.startLivesBonus
    // deterministic seed: campaign keyed to level, endless keyed to attempt count
    const seed = this.endless
      ? (0xE9D1E55 ^ (economy.data.endlessBest * 2654435761)) >>> 0
      : (0xA5EED ^ (this.level.index * 40503) ^ 0x1234) >>> 0

    this.sim = new Sim({ level: this.level, mods, seed, endless: this.endless, startGold, startLives })

    // reset ALL view state (scene.start reuses the instance)
    this.enemyViews.clear()
    this.towerViews.clear()
    this.projViews.clear()
    this.activeScratch.clear()
    this.gameSpeed = 1
    this.paused = false
    this.resultShown = false
    this.draftShown = false
    this.mode = 'idle'
    this.buildKind = null
    this.aimingSpell = null
    this.selectedId = null
    this.towerButtons = []
    this.spellButtons = []
    this.ghost = undefined
    this.ghostRing = undefined
    this.aimReticle = undefined
    this.upgradePanel = undefined
    this.draftObjects = []
    this.telegraph = undefined
    this.banner = undefined
    this.pauseQuitBtn = undefined
    this.tweens.timeScale = 1

    this.drawField()
    this.drawPath()
    this.drawPortalAndBase()
    this.buffLinks = this.add.graphics().setDepth(5)
    this.buildHud()
    this.buildTowerBar()
    this.buildSpellBar()
    this.setupInput()

    economy.touchLastSeen()
    this.cameras.main.fadeIn(350, 20, 12, 50)
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
  update(_time: number, delta: number): void {
    const simDt = this.paused ? 0 : (delta / 1000) * this.gameSpeed
    this.sim.advance(simDt)

    // drain sim events → juice (do this BEFORE reconcile so death FX fire at the
    // death position while the container still exists conceptually)
    for (const ev of this.sim.drainEvents()) this.handleEvent(ev)

    this.syncEnemies()
    this.syncTowers()
    this.syncProjectiles()
    this.drawBuffLinks()
    this.updateHud()
    this.updateGhost()

    // state-driven UI
    if (this.sim.state === 'draft' && !this.draftShown) this.showDraft()
    if (this.sim.state !== 'draft' && this.draftShown) this.hideDraft()
    if ((this.sim.state === 'won' || this.sim.state === 'lost') && !this.resultShown) this.showResult()
  }

  // ---- entity reconciliation (keyed by stable monotonic id) --------------
  private syncEnemies(): void {
    const active = this.activeScratch
    active.clear()
    for (const e of this.sim.enemies) {
      if (!e.active) continue
      active.add(e.id)
      let v = this.enemyViews.get(e.id)
      if (!v) {
        v = this.createEnemyView(e)
        this.enemyViews.set(e.id, v)
      }
      this.updateEnemyView(v, e)
    }
    for (const [id, v] of this.enemyViews) {
      if (!active.has(id)) {
        v.cont.destroy()
        this.enemyViews.delete(id)
      }
    }
  }

  private createEnemyView(e: SimEnemy): EnemyView {
    const def = e.def
    const body = this.makeEnemyBody(def)
    let shieldGfx: Phaser.GameObjects.Arc | null = null
    if (e.shieldMax > 0) {
      shieldGfx = this.add.circle(0, 0, def.radius + 7, 0x9fdcff, 0)
      shieldGfx.setStrokeStyle(3, 0x9fdcff, 0.8)
    }
    const hpBg = this.add.rectangle(0, -def.radius - 12, def.radius * 2 + 6, 7, 0x000000, 0.55)
    const hpFill = this.add.rectangle(-(def.radius + 3), -def.radius - 12, def.radius * 2 + 6, 7, 0x36e05a).setOrigin(0, 0.5)
    const tag = this.add.text(0, -def.radius - 26, '', { fontFamily: 'Arial Black', fontSize: '15px', color: '#4ad9ff' }).setOrigin(0.5)
    const kids: Phaser.GameObjects.GameObject[] = [body]
    if (shieldGfx) kids.push(shieldGfx)
    kids.push(hpBg, hpFill, tag)
    const cont = this.add.container(e.x, e.y, kids).setDepth(def.isAir ? 9 : 7)
    if (def.isAir) {
      const shadow = this.add.ellipse(0, def.radius + 6, def.radius * 1.4, def.radius * 0.5, 0x000000, 0.25)
      cont.addAt(shadow, 0)
    }
    cont.setScale(0.3)
    this.tweens.add({ targets: cont, scale: 1, duration: 200, ease: 'Back.easeOut' })
    if (def.boss) this.cameras.main.shake(200, 0.006)
    return { cont, body, hpFill, tag, shieldGfx, def }
  }

  private updateEnemyView(v: EnemyView, e: SimEnemy): void {
    v.cont.setPosition(e.x, e.y)
    const clock = this.sim.clock
    const stunned = e.stunUntil > clock
    const slowed = e.slowUntil > clock
    const burning = e.burnUntil > clock
    if (e.hitFlash > 0) v.body.setFillStyle(0xffffff)
    else if (stunned) v.body.setFillStyle(0xbfeaff)
    else if (slowed) v.body.setFillStyle(0x8fe9ff)
    else if (burning) v.body.setFillStyle(0xffb15c)
    else v.body.setFillStyle(e.def.color)
    if (stunned) v.tag.setText('FROZEN').setColor('#bfeaff').setVisible(true)
    else if (slowed) v.tag.setText('SLOW').setColor('#4ad9ff').setVisible(true)
    else if (burning) v.tag.setText('BURN').setColor('#ff8a3c').setVisible(true)
    else v.tag.setVisible(false)
    if (v.shieldGfx) v.shieldGfx.setStrokeStyle(3, 0x9fdcff, e.shield > 0 ? 0.8 : 0)
    const ratio = Phaser.Math.Clamp(e.hp / Math.max(1, e.maxHp), 0, 1)
    v.hpFill.width = (e.def.radius * 2 + 6) * ratio
    v.hpFill.setFillStyle(ratio > 0.5 ? 0x36e05a : ratio > 0.25 ? 0xffd54a : 0xff5b7a)
  }

  private makeEnemyBody(def: EnemyDef): Phaser.GameObjects.Shape {
    let body: Phaser.GameObjects.Shape
    const r = def.radius
    if (def.shape === 'triangle') body = this.add.triangle(0, 0, 0, r, r, -r * 0.9, -r, -r * 0.9, def.color)
    else if (def.shape === 'square') body = this.add.rectangle(0, 0, r * 1.8, r * 1.8, def.color)
    else if (def.shape === 'circle') body = this.add.circle(0, 0, r, def.color)
    else if (def.shape === 'diamond') body = this.add.polygon(0, 0, [0, -r, r, 0, 0, r, -r, 0], def.color)
    else {
      const pts: number[] = []
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 2
        pts.push(Math.cos(a) * r, Math.sin(a) * r)
      }
      body = this.add.polygon(0, 0, pts, def.color)
    }
    body.setStrokeStyle(3, def.accent)
    return body
  }

  private syncTowers(): void {
    const active = this.activeScratch
    active.clear()
    for (const t of this.sim.towers) {
      if (!t.active) continue
      active.add(t.id)
      let v = this.towerViews.get(t.id)
      if (!v) {
        v = this.createTowerView(t)
        this.towerViews.set(t.id, v)
      }
      v.cont.setRotation(0)
      v.turret.setRotation(t.aimAngle + Math.PI / 2)
      v.ring.setRadius(this.sim.effRange(t))
      v.ring.setVisible(this.selectedId === t.id)
      if (t.level !== v.lastLevel) {
        v.lastLevel = t.level
        this.tweens.add({ targets: v.cont, scale: 1 + 0.09 * t.level, duration: 220, ease: 'Back.easeOut' })
        if (t.level === 3) {
          const core = this.add.circle(0, 0, 10, 0xffffff, 0.9)
          v.cont.add(core)
          this.tweens.add({ targets: core, scale: 0, alpha: 0, duration: 500, onComplete: () => core.destroy() })
        }
      }
    }
    for (const [id, v] of this.towerViews) {
      if (!active.has(id)) {
        v.cont.destroy()
        v.ring.destroy()
        this.towerViews.delete(id)
      }
    }
  }

  private createTowerView(t: SimTower): TowerView {
    const def = t.def
    const ring = this.add.circle(t.x, t.y, this.sim.effRange(t), def.color, 0.1).setDepth(5).setVisible(false)
    ring.setStrokeStyle(3, def.color, 0.9)
    const shapes = this.towerIconShapes(0, 0, def, 6)
    const cont = this.add.container(t.x, t.y, shapes).setDepth(6)
    const turret = shapes[shapes.length - 1]
    return { cont, turret, ring, lastLevel: 0 }
  }

  private syncProjectiles(): void {
    const active = this.activeScratch
    active.clear()
    for (const p of this.sim.projectiles) {
      if (!p.active) continue
      active.add(p.id)
      let g = this.projViews.get(p.id)
      if (!g) {
        g = this.add.circle(p.x, p.y, 8, 0x1a1030).setDepth(8)
        g.setStrokeStyle(3, p.color)
        this.projViews.set(p.id, g)
      }
      g.setPosition(p.x, p.y)
    }
    for (const [id, g] of this.projViews) {
      if (!active.has(id)) {
        g.destroy()
        this.projViews.delete(id)
      }
    }
  }

  // ======================================================================
  //  EVENT → JUICE
  // ======================================================================
  private handleEvent(ev: SimEvent): void {
    switch (ev.t) {
      case 'damage':
        this.floatDamage(ev.x, ev.y, ev.amount, ev.eff, ev.combo)
        break
      case 'death':
        this.deathBurst(ev.x, ev.y, ev.color)
        if (ev.boss) {
          this.cameras.main.shake(320, 0.012)
          this.cameras.main.flash(200, 255, 120, 200)
        } else if (ev.kind === 'brute') {
          this.cameras.main.shake(160, 0.006)
        }
        break
      case 'shieldBreak':
        this.floatText(ev.x, ev.y, 'SHIELD BREAK!', 0x9fdcff, 22)
        this.pulseRing(ev.x, ev.y + 30, ev.radius, 0x9fdcff, 0.9)
        break
      case 'leak':
        this.cameras.main.shake(180, 0.008)
        this.cameras.main.flash(120, 255, 60, 90)
        this.pulseRing(ev.x, ev.y, 40, C.life)
        break
      case 'towerFire':
        this.muzzle(ev.x, ev.y, ev.tx, ev.ty, ev.color, ev.kind)
        break
      case 'hit':
        this.hitSpark(ev.x, ev.y, ev.color)
        break
      case 'chain':
        this.drawLightning(ev.points, ev.color, ev.count, ev.supercharged)
        break
      case 'aoe':
        this.pulseRing(ev.x, ev.y, ev.radius, ev.color, ev.alpha)
        break
      case 'combo':
        this.comboCallout(ev.count, ev.mult, ev.x, ev.y, ev.milestone)
        break
      case 'heal':
        if (ev.radius > 0) this.pulseRing(ev.x, ev.y, ev.radius, 0x6bffb0, 0.6)
        else this.floatText(ev.x, ev.y, `+${ev.amount}`, 0x6bffb0, 18)
        break
      case 'gold':
        this.spawnCoins(ev.x, ev.y, ev.amount)
        break
      case 'place':
        this.pulseRing(ev.x, ev.y, ev.radius, ev.color)
        this.cameras.main.shake(90, 0.004)
        break
      case 'upgrade':
        this.pulseRing(ev.x, ev.y, ev.radius, ev.color)
        this.floatText(ev.x, ev.y - 34, ev.label, ev.color, 26)
        this.cameras.main.shake(110, 0.005)
        if (this.selectedId) this.showUpgradePanel()
        break
      case 'spell':
        this.spellFx(ev.key, ev.x, ev.y, ev.radius, ev.color, ev.count)
        break
      case 'banner':
        this.floatBanner(ev.msg, ev.color)
        break
      case 'text':
        this.floatText(ev.x, ev.y, ev.msg, ev.color, ev.size)
        break
    }
  }

  private muzzle(x: number, y: number, tx: number, ty: number, color: number, kind: TowerKind): void {
    if (kind === 'cannon') {
      const flash = this.add.circle(x, y - 20, 12, 0xffe9a6, 0.9).setDepth(8)
      this.tweens.add({ targets: flash, scale: 0, alpha: 0, duration: 140, onComplete: () => flash.destroy() })
    } else if (kind === 'flame') {
      const ang = Math.atan2(ty - y, tx - x)
      const fx = this.add.circle(x + Math.cos(ang) * 24, y + Math.sin(ang) * 24, 16, 0xff8a3c, 0.9).setDepth(8)
      this.tweens.add({ targets: fx, scale: 2.2, alpha: 0, duration: 220, onComplete: () => fx.destroy() })
    } else if (kind === 'arcane') {
      const g = this.add.graphics().setDepth(10)
      g.lineStyle(5, color, 0.8)
      g.lineBetween(x, y, tx, ty)
      this.tweens.add({ targets: g, alpha: 0, duration: 200, onComplete: () => g.destroy() })
    }
  }

  private drawLightning(points: Array<[number, number]>, color: number, count: number, supercharged: boolean): void {
    if (points.length < 2) return
    const g = this.add.graphics().setDepth(11)
    g.lineStyle(4, 0xffffff, 0.95)
    g.beginPath()
    g.moveTo(points[0][0], points[0][1])
    for (let i = 1; i < points.length; i++) {
      const px = points[i][0]
      const py = points[i][1]
      const midx = (points[i - 1][0] + px) / 2 + Phaser.Math.Between(-10, 10)
      const midy = (points[i - 1][1] + py) / 2 + Phaser.Math.Between(-10, 10)
      g.lineTo(midx, midy)
      g.lineTo(px, py)
    }
    g.strokePath()
    const g2 = this.add.graphics().setDepth(10)
    g2.lineStyle(supercharged ? 12 : 9, color, 0.5)
    g2.beginPath()
    g2.moveTo(points[0][0], points[0][1])
    for (let i = 1; i < points.length; i++) g2.lineTo(points[i][0], points[i][1])
    g2.strokePath()
    this.tweens.add({ targets: [g, g2], alpha: 0, duration: 220, onComplete: () => { g.destroy(); g2.destroy() } })
    if (count > 1) {
      const last = points[points.length - 1]
      this.floatText(last[0], last[1] - 24, `CHAIN x${count}`, 0xffe14a, 20)
    }
  }

  private spellFx(key: SpellKey, x: number, y: number, radius: number, color: number, count: number): void {
    if (key === 'meteor') {
      const streak = this.add.circle(x - 120, y - 260, 18, 0xffe9a6, 0.9).setDepth(13)
      this.tweens.add({
        targets: streak, x, y, duration: 260, ease: 'Cubic.easeIn',
        onComplete: () => {
          streak.destroy()
          this.cameras.main.shake(240, 0.012)
          this.cameras.main.flash(160, 255, 140, 60)
          const flash = this.add.circle(x, y, radius * 0.5, 0xffe0a0, 0.9).setDepth(14)
          this.tweens.add({ targets: flash, scale: 2.2, alpha: 0, duration: 380, onComplete: () => flash.destroy() })
          this.pulseRing(x, y, radius, color)
          for (let i = 0; i < 22; i++) {
            const a = Phaser.Math.FloatBetween(0, Math.PI * 2)
            const spark = this.add.rectangle(x, y, 7, 7, i % 2 ? 0xff7a3c : 0xffd54a).setDepth(14)
            this.tweens.add({
              targets: spark, x: x + Math.cos(a) * Phaser.Math.Between(30, radius), y: y + Math.sin(a) * Phaser.Math.Between(30, radius),
              alpha: 0, scale: 0.2, duration: Phaser.Math.Between(320, 560), ease: 'Cubic.easeOut', onComplete: () => spark.destroy(),
            })
          }
        },
      })
    } else if (key === 'freeze') {
      this.cameras.main.flash(200, 120, 220, 255)
      const overlay = this.add.rectangle(360, 640, 720, 1280, color, 0.22).setDepth(12)
      this.tweens.add({ targets: overlay, alpha: 0, duration: 700, onComplete: () => overlay.destroy() })
      if (count > 0) this.floatText(360, 300, `FROZEN x${count}!`, color, 36)
    } else {
      this.floatText(x, y, `+${count} GOLD!`, C.gold, 34)
      this.cameras.main.flash(140, 255, 213, 74)
    }
  }

  // ---- juice primitives ---------------------------------------------------
  private floatDamage(x: number, y: number, amount: number, eff: Effectiveness, combo: number): void {
    const n = Math.max(1, Math.round(amount))
    const color = eff === 'strong' ? 0x8dff4a : eff === 'weak' ? 0xb8b0d0 : 0xffffff
    const base = eff === 'strong' ? 26 : 22
    const size = base + Math.min(28, combo * 3)
    const hex = '#' + color.toString(16).padStart(6, '0')
    const arrow = eff === 'strong' ? ' ↑' : eff === 'weak' ? ' ↓' : ''
    const t = this.add.text(x + Phaser.Math.Between(-8, 8), y, `${n}${arrow}`, { fontFamily: 'Arial Black', fontSize: `${size}px`, color: hex }).setOrigin(0.5).setDepth(15)
    t.setStroke('#000000', 4)
    t.setScale(0.3)
    const leap = combo > 0 ? 70 + combo * 6 : 44
    this.tweens.add({ targets: t, scale: combo > 0 ? 1.25 : 1, duration: 130, ease: 'Back.easeOut' })
    this.tweens.add({ targets: t, y: y - leap, alpha: 0, delay: 200, duration: 560, ease: 'Cubic.easeIn', onComplete: () => t.destroy() })
  }

  private comboCallout(count: number, mult: number, x: number, y: number, milestone: boolean): void {
    const hue = Phaser.Display.Color.HSVToRGB((0.14 - Math.min(0.14, count * 0.012)) % 1, 0.9, 1) as Phaser.Types.Display.ColorObject
    const color = (hue.r << 16) | (hue.g << 8) | hue.b
    const hex = '#' + color.toString(16).padStart(6, '0')
    const size = 30 + Math.min(46, count * 4)
    const t = this.add.text(x, y - 20, `COMBO x${count}!`, { fontFamily: 'Arial Black', fontSize: `${size}px`, color: hex }).setOrigin(0.5).setDepth(17)
    t.setStroke('#000000', 6)
    t.setScale(0.2).setAngle(Phaser.Math.Between(-8, 8))
    this.tweens.add({ targets: t, scale: 1, duration: 150, ease: 'Back.easeOut' })
    this.tweens.add({ targets: t, y: y - 80, alpha: 0, delay: 260, duration: 520, ease: 'Cubic.easeIn', onComplete: () => t.destroy() })
    this.blipper.blip(280 + count * 55)
    if (milestone) {
      this.cameras.main.shake(180, 0.006)
      this.cameras.main.flash(120, (color >> 16) & 255, (color >> 8) & 255, color & 255)
    }
    // pulse the HUD combo readout
    this.comboText.setText(`COMBO x${count}  ·  ${mult.toFixed(2)}×`).setVisible(true).setColor(hex)
    this.tweens.killTweensOf(this.comboText)
    this.comboText.setScale(1.3)
    this.tweens.add({ targets: this.comboText, scale: 1, duration: 160, ease: 'Back.easeOut' })
  }

  private floatText(x: number, y: number, msg: string, color: number, size = 24): void {
    const hex = '#' + color.toString(16).padStart(6, '0')
    const t = this.add.text(x, y, msg, { fontFamily: 'Arial Black', fontSize: `${size}px`, color: hex }).setOrigin(0.5).setDepth(15)
    t.setStroke('#000000', 4)
    t.setScale(0.4)
    this.tweens.add({ targets: t, scale: 1, duration: 120, ease: 'Back.easeOut' })
    this.tweens.add({ targets: t, y: y - 44, alpha: 0, delay: 220, duration: 560, ease: 'Cubic.easeIn', onComplete: () => t.destroy() })
  }

  private floatBanner(msg: string, color: number): void {
    this.floatText(360, 250, msg, color, 34)
  }

  private hitSpark(x: number, y: number, color: number): void {
    for (let i = 0; i < 5; i++) {
      const a = Phaser.Math.FloatBetween(0, Math.PI * 2)
      const sp = this.add.circle(x, y, Phaser.Math.Between(2, 4), color).setDepth(14)
      this.tweens.add({ targets: sp, x: x + Math.cos(a) * Phaser.Math.Between(14, 30), y: y + Math.sin(a) * Phaser.Math.Between(14, 30), alpha: 0, duration: 260, onComplete: () => sp.destroy() })
    }
  }

  private deathBurst(x: number, y: number, color: number): void {
    const flash = this.add.circle(x, y, 20, 0xffffff, 0.9).setDepth(14)
    this.tweens.add({ targets: flash, scale: 1.8, alpha: 0, duration: 220, onComplete: () => flash.destroy() })
    for (let i = 0; i < 10; i++) {
      const a = (Math.PI * 2 * i) / 10 + Phaser.Math.FloatBetween(-0.3, 0.3)
      const piece = this.add.rectangle(x, y, 8, 8, color).setDepth(14).setAngle(Phaser.Math.Between(0, 360))
      this.tweens.add({ targets: piece, x: x + Math.cos(a) * Phaser.Math.Between(24, 54), y: y + Math.sin(a) * Phaser.Math.Between(24, 54), angle: piece.angle + 220, alpha: 0, scale: 0.2, duration: Phaser.Math.Between(320, 500), ease: 'Cubic.easeOut', onComplete: () => piece.destroy() })
    }
  }

  private spawnCoins(x: number, y: number, amount: number): void {
    if (amount <= 0) return
    const n = Phaser.Math.Clamp(Math.round(amount / 4), 2, 6)
    for (let i = 0; i < n; i++) {
      const coin = this.add.circle(x, y, 7, C.gold).setDepth(16)
      coin.setStrokeStyle(2, 0xffe9a6)
      const midx = x + Phaser.Math.Between(-40, 40)
      const midy = y - Phaser.Math.Between(30, 70)
      this.tweens.add({
        targets: coin, x: midx, y: midy, duration: 180, ease: 'Cubic.easeOut',
        onComplete: () => {
          this.tweens.add({ targets: coin, x: this.goldIcon.x, y: this.goldIcon.y, scale: 0.4, delay: i * 20, duration: 320, ease: 'Cubic.easeIn', onComplete: () => coin.destroy() })
        },
      })
    }
  }

  private pulseRing(x: number, y: number, r: number, color: number, alpha = 0.8): void {
    const ring = this.add.circle(x, y, Math.max(4, r * 0.4), color, 0).setDepth(13)
    ring.setStrokeStyle(4, color, alpha)
    this.tweens.add({ targets: ring, scale: 2.6, alpha: 0, duration: 340, ease: 'Cubic.easeOut', onComplete: () => ring.destroy() })
  }

  // ======================================================================
  //  STATIC FIELD
  // ======================================================================
  private drawField(): void {
    const p = this.level.palette
    this.add.rectangle(360, 640, 720, 1280, C.hudBg).setDepth(0)
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cc = cellCenter(c, r)
        const cell = this.sim.grid[r][c]
        let color = (c + r) % 2 === 0 ? p.grassA : p.grassB
        if (cell === 'build') color = (c + r) % 2 === 0 ? p.build : this.mix(p.build, 0x000000, 0.08)
        const rect = this.add.rectangle(cc.x, cc.y, TILE - 2, TILE - 2, color).setDepth(1)
        if (cell === 'build') rect.setStrokeStyle(2, 0xffffff, 0.22)
      }
    }
  }

  private mix(a: number, b: number, t: number): number {
    const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255
    const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255
    return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t)
  }

  private drawPath(): void {
    const p = this.level.palette
    const cells = serpentine(this.level.lanes)
    const g = this.add.graphics().setDepth(2)
    const roadW = TILE * 0.78
    g.fillStyle(p.pathEdge, 1)
    for (const [c, r] of cells) {
      const cc = cellCenter(c, r)
      g.fillRoundedRect(cc.x - roadW / 2 - 5, cc.y - roadW / 2 - 5, roadW + 10, roadW + 10, 14)
    }
    g.fillStyle(p.path, 1)
    for (const [c, r] of cells) {
      const cc = cellCenter(c, r)
      g.fillRoundedRect(cc.x - roadW / 2, cc.y - roadW / 2, roadW, roadW, 12)
    }
    const dash = this.add.graphics().setDepth(2)
    dash.fillStyle(0xffffff, 0.5)
    const wp = this.sim.pathWaypoints()
    for (let i = 1; i < wp.length; i++) {
      const a = wp[i - 1]
      const b = wp[i]
      const len = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y)
      const steps = Math.max(1, Math.floor(len / 26))
      for (let s = 0; s < steps; s += 2) {
        const t = s / steps
        dash.fillCircle(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, 3.5)
      }
    }
  }

  private drawPortalAndBase(): void {
    const start = this.sim.waypointFor('portal')
    const ring1 = this.add.circle(start.x, start.y, 30, C.portal, 0.9).setDepth(3)
    ring1.setStrokeStyle(5, 0xd7b8ff)
    this.add.circle(start.x, start.y, 15, 0xf0e0ff, 0.9).setDepth(3)
    this.tweens.add({ targets: ring1, scale: 1.25, alpha: 0.55, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' })
    const base = this.sim.waypointFor('base')
    const glow = this.add.circle(base.x, base.y, 46, C.base, 0.28).setDepth(3)
    this.tweens.add({ targets: glow, scale: 1.3, alpha: 0.12, duration: 1100, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' })
    const gem = this.add.polygon(base.x, base.y, [0, -34, 26, 0, 0, 34, -26, 0], C.base, 1).setDepth(4)
    gem.setStrokeStyle(4, 0xd6fff5)
    this.add.polygon(base.x, base.y, [0, -34, 26, 0, 0, 0, -12, -10], 0xeafffb, 0.7).setDepth(4)
    this.tweens.add({ targets: gem, angle: 8, duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' })
  }

  // ======================================================================
  //  HUD
  // ======================================================================
  private pill(x: number, y: number, w: number, h: number, color: number): void {
    const g = this.add.graphics().setDepth(20)
    g.fillStyle(color, 0.9)
    g.fillRoundedRect(x - w / 2, y - h / 2, w, h, h / 2)
    g.lineStyle(3, 0xffffff, 0.18)
    g.strokeRoundedRect(x - w / 2, y - h / 2, w, h, h / 2)
  }

  private buildHud(): void {
    this.add.rectangle(360, 100, 720, 200, C.panel, 1).setDepth(19)
    this.add.rectangle(360, 200, 720, 4, 0x000000, 0.25).setDepth(19)

    this.pill(140, 42, 190, 50, 0x3a2470)
    const gc = this.add.circle(72, 42, 16, C.gold).setDepth(20)
    gc.setStrokeStyle(3, 0xffe9a6)
    this.add.text(72, 42, '$', { fontFamily: 'Arial Black', fontSize: '20px', color: '#7a5600' }).setOrigin(0.5).setDepth(21)
    this.goldText = this.add.text(98, 42, '0', { fontFamily: 'Arial Black', fontSize: '28px', color: '#ffe27a' }).setOrigin(0, 0.5).setDepth(21)

    this.pill(340, 42, 150, 50, 0x3a2470)
    const heart = this.add.circle(288, 42, 14, C.life).setDepth(20)
    heart.setStrokeStyle(3, 0xffd0da)
    this.livesText = this.add.text(310, 42, '0', { fontFamily: 'Arial Black', fontSize: '28px', color: '#ffd0da' }).setOrigin(0, 0.5).setDepth(21)

    this.pill(540, 42, 180, 50, 0x3a2470)
    this.waveText = this.add.text(540, 42, '', { fontFamily: 'Arial Black', fontSize: '24px', color: '#a0f0ff' }).setOrigin(0.5).setDepth(21)

    this.add.text(714, 16, this.level.name.toUpperCase(), { fontFamily: 'Arial Black', fontSize: '15px', color: '#c9b6ff' }).setOrigin(1, 0).setDepth(21)

    // combo readout (hidden until a combo starts)
    this.comboText = this.add.text(360, 172, '', { fontFamily: 'Arial Black', fontSize: '22px', color: '#ffd54a' }).setOrigin(0.5).setDepth(21).setVisible(false)

    this.startBtn = this.makeButton(150, 120, 250, 58, 'START ▶', 0x2ea043, () => this.onStart())
    this.startLabel = this.startBtn.getData('label') as Phaser.GameObjects.Text
    this.pauseLabel = this.makeButton(606, 120, 70, 58, 'II', 0x4a3a7a, () => this.togglePause()).getData('label') as Phaser.GameObjects.Text
    this.speedLabel = this.makeButton(684, 120, 70, 58, '1x', 0x4a3a7a, () => this.toggleSpeed()).getData('label') as Phaser.GameObjects.Text
  }

  private makeButton(x: number, y: number, w: number, h: number, label: string, color: number, onClick: () => void): Phaser.GameObjects.Container {
    const bg = this.add.graphics()
    bg.fillStyle(color, 1)
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, 14)
    bg.lineStyle(3, 0xffffff, 0.25)
    bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 14)
    const txt = this.add.text(0, 0, label, { fontFamily: 'Arial Black', fontSize: '26px', color: '#ffffff' }).setOrigin(0.5)
    const cont = this.add.container(x, y, [bg, txt]).setDepth(22)
    cont.setSize(w, h)
    cont.setData('label', txt)
    cont.setInteractive(new Phaser.Geom.Rectangle(-w / 2, -h / 2, w, h), Phaser.Geom.Rectangle.Contains)
    cont.on('pointerdown', () => {
      this.tweens.add({ targets: cont, scale: 0.92, duration: 70, yoyo: true })
      onClick()
    })
    return cont
  }

  private updateHud(): void {
    this.goldText.setText(`${this.sim.gold}`)
    this.livesText.setText(`${this.sim.lives}`)
    if (this.endless) this.waveText.setText(`WAVE ${this.sim.waveIndex + 1} ∞`)
    else this.waveText.setText(`WAVE ${Math.min(this.sim.waveIndex + 1, this.level.waves.length)}/${this.level.waves.length}`)

    if (this.sim.comboCount < 2 && this.comboText.visible) this.comboText.setVisible(false)

    // start button + prep countdown + telegraph
    if (this.sim.state === 'prep') {
      this.startBtn.setVisible(true)
      const secs = Math.max(0, Math.ceil(this.sim.prepTimer))
      this.startLabel.setText(`START ▶ (${secs})`)
      this.showTelegraph()
    } else {
      this.startBtn.setVisible(false)
      this.hideTelegraph()
    }
    this.refreshTowerButtons()
    this.refreshSpellButtons()
  }

  // ---- pre-wave telegraph -------------------------------------------------
  private showTelegraph(): void {
    const tg = this.sim.waveTelegraph()
    if (!this.telegraph) {
      const bg = this.add.graphics()
      bg.fillStyle(0x1c1038, 0.9)
      bg.fillRoundedRect(-150, -22, 300, 44, 12)
      bg.lineStyle(2, 0xffffff, 0.2)
      bg.strokeRoundedRect(-150, -22, 300, 44, 12)
      const txt = this.add.text(0, 0, '', { fontFamily: 'Arial Black', fontSize: '17px', color: '#ffd54a' }).setOrigin(0.5)
      this.telegraph = this.add.container(360, 232, [bg, txt]).setDepth(21)
      this.telegraph.setData('txt', txt)
    }
    const txt = this.telegraph.getData('txt') as Phaser.GameObjects.Text
    const elemPart = tg.element ? ` · ${tg.element}` : ''
    txt.setText(`${tg.boss ? '☠ BOSS · ' : 'INCOMING: '}${tg.armor}${elemPart}`)
    txt.setColor(tg.element ? '#' + ELEMENT_COLOR[tg.element].toString(16).padStart(6, '0') : '#ffd54a')
    this.telegraph.setVisible(true)
  }
  private hideTelegraph(): void {
    this.telegraph?.setVisible(false)
  }

  // ======================================================================
  //  TOWER BAR
  // ======================================================================
  private buildTowerBar(): void {
    this.add.rectangle(360, 1180, 720, 200, C.panel, 1).setDepth(19)
    this.add.rectangle(360, 1080, 720, 4, 0x000000, 0.25).setDepth(19)
    const xs = [76, 204, 332, 460, 588]
    const w = 120
    const h = 158
    TOWER_ORDER.forEach((kind, i) => {
      const def = TOWERS[kind]
      const bg = this.add.graphics()
      const icon = this.towerIconShapes(0, -38, def, 0)
      const name = this.add.text(0, 20, def.name, { fontFamily: 'Arial Black', fontSize: '20px', color: '#ffffff' }).setOrigin(0.5)
      const cost = this.add.text(0, 46, `$${this.sim.placeCost(kind)}`, { fontFamily: 'Arial Black', fontSize: '20px', color: '#ffe27a' }).setOrigin(0.5)
      const type = this.add.text(0, 66, def.damageType.slice(0, 4).toUpperCase() + (def.element ? ' · ' + def.element[0] : ''), { fontFamily: 'Arial', fontSize: '12px', color: '#c9b6ff' }).setOrigin(0.5)
      const lock = this.add.text(0, -38, '🔒', { fontSize: '30px' }).setOrigin(0.5).setVisible(false)
      const cont = this.add.container(xs[i], 1176, [bg, ...icon, name, cost, type, lock]).setDepth(22)
      cont.setSize(w, h)
      cont.setData('kind', kind)
      cont.setData('bg', bg)
      cont.setData('lock', lock)
      cont.setData('cost', cost)
      cont.setData('w', w).setData('h', h).setData('def', def)
      cont.setInteractive(new Phaser.Geom.Rectangle(-w / 2, -h / 2, w, h), Phaser.Geom.Rectangle.Contains)
      cont.on('pointerdown', () => this.onTowerButton(kind))
      this.towerButtons.push(cont)
    })
    this.refreshTowerButtons()
  }

  private towerUnlocked(kind: TowerKind): boolean {
    return this.endless || economy.isTowerUnlocked(kind)
  }

  private refreshTowerButtons(): void {
    for (const cont of this.towerButtons) {
      const def = cont.getData('def') as TowerDef
      const kind = cont.getData('kind') as TowerKind
      const bg = cont.getData('bg') as Phaser.GameObjects.Graphics
      const lock = cont.getData('lock') as Phaser.GameObjects.Text
      const cost = cont.getData('cost') as Phaser.GameObjects.Text
      const w = cont.getData('w') as number
      const h = cont.getData('h') as number
      const unlocked = this.towerUnlocked(kind)
      const selected = this.buildKind === kind
      const afford = this.sim.gold >= this.sim.placeCost(kind)
      bg.clear()
      bg.fillStyle(selected ? def.color : 0x3a2470, selected ? 0.85 : 1)
      bg.fillRoundedRect(-w / 2, -h / 2, w, h, 16)
      bg.lineStyle(selected ? 6 : 4, def.color, unlocked && afford ? 1 : 0.35)
      bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 16)
      lock.setVisible(!unlocked)
      cost.setVisible(unlocked).setText(`$${this.sim.placeCost(kind)}`)
      cont.setAlpha(!unlocked ? 0.55 : afford ? 1 : 0.6)
    }
  }

  private towerIconShapes(x: number, y: number, def: TowerDef, depth: number): Phaser.GameObjects.Shape[] {
    const shapes: Phaser.GameObjects.Shape[] = []
    shapes.push(this.add.circle(x, y, 20, def.accent).setDepth(depth))
    if (def.kind === 'cannon') {
      shapes.push(this.add.circle(x, y, 13, def.color).setDepth(depth))
      const barrel = this.add.rectangle(x, y - 12, 9, 20, def.color).setDepth(depth)
      barrel.setStrokeStyle(2, 0xffffff, 0.4)
      shapes.push(barrel)
    } else if (def.kind === 'frost') {
      const body = this.add.star(x, y, 6, 6, 14, def.color).setDepth(depth)
      body.setStrokeStyle(2, 0xffffff, 0.5)
      shapes.push(body)
    } else if (def.kind === 'flame') {
      const body = this.add.triangle(x, y, 0, 14, 12, -12, -12, -12, def.color).setDepth(depth)
      body.setStrokeStyle(2, 0xffffff, 0.4)
      shapes.push(body)
    } else if (def.kind === 'storm') {
      const body = this.add.star(x, y, 4, 5, 15, def.color).setDepth(depth)
      body.setStrokeStyle(2, 0xffffff, 0.5)
      shapes.push(body)
    } else {
      const pts: number[] = []
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 2
        pts.push(Math.cos(a) * 14, Math.sin(a) * 14)
      }
      const body = this.add.polygon(x, y, pts, def.color).setDepth(depth)
      body.setStrokeStyle(2, 0xffffff, 0.5)
      shapes.push(body)
    }
    return shapes
  }

  private onTowerButton(kind: TowerKind): void {
    if (this.sim.state === 'won' || this.sim.state === 'lost' || this.sim.state === 'draft') return
    if (!this.towerUnlocked(kind)) {
      this.floatText(360, 1080, 'LOCKED — clear levels to unlock', 0xff5b7a, 22)
      return
    }
    this.exitAiming()
    this.deselect()
    if (this.buildKind === kind) {
      this.exitBuild()
      return
    }
    this.buildKind = kind
    this.mode = 'building'
    this.spawnGhost(kind)
  }

  private spawnGhost(kind: TowerKind): void {
    this.clearGhost()
    const def = TOWERS[kind]
    const shapes = this.towerIconShapes(0, 0, def, 6)
    this.ghost = this.add.container(-100, -100, shapes).setDepth(6).setVisible(false)
    const range = def.levels[0].range * TILE * economy.runModifiers(this.endless).rangeMult
    this.ghostRing = this.add.circle(-100, -100, range, def.color, 0.12).setDepth(5).setVisible(false)
    this.ghostRing.setStrokeStyle(3, 0x9affc0, 0.9)
  }
  private clearGhost(): void {
    this.ghost?.destroy()
    this.ghostRing?.destroy()
    this.ghost = undefined
    this.ghostRing = undefined
  }
  private exitBuild(): void {
    this.buildKind = null
    if (this.mode === 'building') this.mode = 'idle'
    this.clearGhost()
  }
  private updateGhost(): void {
    if (this.mode !== 'building' || !this.ghost || !this.ghostRing) return
    const p = this.input.activePointer
    const cell = worldToCell(p.worldX, p.worldY)
    if (!cell) {
      this.ghost.setVisible(false)
      this.ghostRing.setVisible(false)
      return
    }
    const cc = cellCenter(cell.col, cell.row)
    const ok = this.sim.canPlace(cell.col, cell.row)
    this.ghost.setVisible(true).setPosition(cc.x, cc.y).setAlpha(ok ? 0.9 : 0.4)
    this.ghostRing.setVisible(true).setPosition(cc.x, cc.y)
    this.ghostRing.setStrokeStyle(3, ok ? 0x9affc0 : 0xff5b7a, 0.9)
  }

  // ======================================================================
  //  SPELL BAR
  // ======================================================================
  private buildSpellBar(): void {
    const xs = [320, 410, 500]
    SPELL_ORDER.forEach((key, i) => {
      const def = SPELLS[key]
      const r = 30
      const bg = this.add.circle(0, 0, r, 0x1c1038, 1)
      bg.setStrokeStyle(3, def.color, 0.9)
      const icon = this.spellIcon(0, 0, def)
      const ring = this.add.graphics()
      const cont = this.add.container(xs[i], 120, [bg, ...icon, ring]).setDepth(23)
      cont.setSize(r * 2, r * 2)
      cont.setInteractive(new Phaser.Geom.Circle(0, 0, r), Phaser.Geom.Circle.Contains)
      cont.on('pointerdown', () => this.onSpellButton(key))
      this.spellButtons.push({ key, def, cont, ring })
    })
  }

  private spellIcon(x: number, y: number, def: SpellDef): Phaser.GameObjects.Shape[] {
    const out: Phaser.GameObjects.Shape[] = []
    if (def.key === 'meteor') {
      out.push(this.add.circle(x, y, 11, def.color))
      out.push(this.add.circle(x - 4, y - 4, 4, 0xffe9a6))
    } else if (def.key === 'freeze') {
      out.push(this.add.star(x, y, 6, 5, 13, def.color))
    } else {
      const c = this.add.circle(x, y, 11, def.color)
      c.setStrokeStyle(3, 0xffe9a6)
      out.push(c)
    }
    return out
  }

  private refreshSpellButtons(): void {
    for (const sb of this.spellButtons) {
      const cd = this.sim.spellCd[sb.key]
      const maxCd = this.sim.spellMaxCd[sb.key]
      sb.ring.clear()
      if (cd > 0 && maxCd > 0) {
        const frac = Phaser.Math.Clamp(cd / maxCd, 0, 1)
        sb.ring.fillStyle(0x000000, 0.55)
        sb.ring.slice(0, 0, 30, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac, false)
        sb.ring.fillPath()
      }
    }
  }

  private onSpellButton(key: SpellKey): void {
    if (this.sim.state === 'won' || this.sim.state === 'lost' || this.sim.state === 'draft') return
    if (this.sim.spellCd[key] > 0) {
      const sb = this.spellButtons.find((s) => s.key === key)!
      this.floatText(sb.cont.x, sb.cont.y + 40, 'CHARGING', 0xff5b7a, 18)
      return
    }
    const def = SPELLS[key]
    if (def.targeted) {
      this.exitBuild()
      this.deselect()
      this.mode = 'aiming'
      this.aimingSpell = key
      this.justEnteredAiming = true
      this.spawnAimReticle(def)
    } else {
      this.sim.castSpell(key, 360, MAP_Y + MAP_H / 2)
    }
  }

  private spawnAimReticle(def: SpellDef): void {
    this.clearAimReticle()
    const r = (def.radius ?? 2) * TILE
    const ring = this.add.circle(0, 0, r, def.color, 0.15)
    ring.setStrokeStyle(4, def.color, 0.9)
    const cross = this.add.rectangle(0, 0, r * 2, 3, def.color, 0.5)
    const cross2 = this.add.rectangle(0, 0, 3, r * 2, def.color, 0.5)
    this.aimReticle = this.add.container(-200, -200, [ring, cross, cross2]).setDepth(12).setVisible(false)
  }
  private clearAimReticle(): void {
    this.aimReticle?.destroy()
    this.aimReticle = undefined
  }
  private exitAiming(): void {
    this.aimingSpell = null
    this.justEnteredAiming = false
    if (this.mode === 'aiming') this.mode = 'idle'
    this.clearAimReticle()
  }

  // ======================================================================
  //  INPUT
  // ======================================================================
  private setupInput(): void {
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (this.mode === 'aiming' && this.aimReticle) {
        // WORLD coords everywhere (matches the ghost/placement mapping) so the
        // reticle sits under the finger regardless of Scale.FIT letterboxing.
        const inMap = p.worldX >= MAP_X && p.worldX < MAP_X + MAP_W && p.worldY >= MAP_Y && p.worldY < MAP_Y + MAP_H
        this.aimReticle.setVisible(inMap).setPosition(p.worldX, p.worldY)
      }
    })
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.onPointerDown(p))
  }

  private onPointerDown(p: Phaser.Input.Pointer): void {
    if (this.sim.state === 'won' || this.sim.state === 'lost' || this.sim.state === 'draft') return
    if (this.paused) return

    // ONE consistent pointer→world mapping everywhere. The ghost preview uses
    // worldX/worldY; the tap resolves the cell with the SAME coords so the
    // highlighted buildable cell and the placed cell always match.
    const px = p.worldX
    const py = p.worldY

    if (this.mode === 'aiming') {
      if (this.justEnteredAiming) {
        this.justEnteredAiming = false
        return
      }
      const inMap = px >= MAP_X && px < MAP_X + MAP_W && py >= MAP_Y && py < MAP_Y + MAP_H
      if (inMap && this.aimingSpell) this.sim.castSpell(this.aimingSpell, px, py)
      this.exitAiming()
      return
    }

    // let the upgrade panel's own buttons handle taps in its region
    if (this.upgradePanel && Phaser.Geom.Rectangle.Contains(new Phaser.Geom.Rectangle(120, 840, 480, 230), px, py)) return

    const cell = worldToCell(px, py)
    if (!cell) return

    if (this.mode === 'building') {
      this.tryPlace(cell.col, cell.row)
      return
    }
    const t = this.sim.towerAt(cell.col, cell.row)
    if (t) this.selectTower(t.id)
    else this.deselect()
  }

  private onStart(): void {
    if (this.sim.state === 'prep') this.sim.startWave()
  }

  private tryPlace(col: number, row: number): void {
    if (!this.buildKind) return
    const cc = cellCenter(col, row)
    if (!this.sim.canPlace(col, row)) {
      this.floatText(cc.x, cc.y, 'CANT BUILD', 0xff5b7a)
      return
    }
    if (this.sim.gold < this.sim.placeCost(this.buildKind)) {
      this.floatText(cc.x, cc.y, 'NEED GOLD', 0xff5b7a)
      return
    }
    const placed = this.sim.placeTower(this.buildKind, col, row)
    if (placed && this.sim.gold < this.sim.placeCost(this.buildKind)) this.exitBuild()
  }

  // ======================================================================
  //  SELECTION / UPGRADE PANEL (deep-on-tap approachability)
  // ======================================================================
  private selectTower(id: number): void {
    this.deselect()
    this.selectedId = id
    this.showUpgradePanel()
  }
  private deselect(): void {
    this.selectedId = null
    this.upgradePanel?.destroy()
    this.upgradePanel = undefined
  }

  private tierStars(n: number): string {
    return '★'.repeat(n) + '☆'.repeat(5 - n)
  }

  private showUpgradePanel(): void {
    this.upgradePanel?.destroy()
    this.upgradePanel = undefined
    if (this.selectedId === null) return
    const t = this.sim.towerById(this.selectedId)
    if (!t) return

    const w = 480, h = 210, x = 360, y = 955
    const bg = this.add.graphics()
    bg.fillStyle(0x1c1038, 0.97)
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, 18)
    bg.lineStyle(4, t.def.color, 1)
    bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 18)
    const cur = this.sim.stats(t)
    const tierName = this.sim.isMax(t) ? t.def.branches[t.branch].name : `Lv ${t.level + 1}`
    const title = this.add.text(-w / 2 + 20, -h / 2 + 12, `${t.def.name} · ${tierName}`, { fontFamily: 'Arial Black', fontSize: '23px', color: '#ffffff' }).setOrigin(0, 0)
    const stars = this.add.text(w / 2 - 20, -h / 2 + 14, this.tierStars(this.sim.powerTier(t)), { fontFamily: 'Arial', fontSize: '20px', color: '#ffd54a' }).setOrigin(1, 0)
    const typeLine = `${t.def.damageType}${t.def.element ? ' · ' + t.def.element : ''}`
    const dpsLine = t.def.support ? `BUFF +${Math.round((cur.buffDamage ?? 0) * 100)}%` : `DPS ${Math.round(this.sim.effDps(t))}`
    const stat1 = this.add.text(-w / 2 + 20, -h / 2 + 46, `${dpsLine}   RNG ${(this.sim.effRange(t) / TILE).toFixed(1)}   ${typeLine}`, { fontFamily: 'Arial', fontSize: '18px', color: '#a0f0ff' }).setOrigin(0, 0)

    // live effectiveness vs the incoming wave's dominant enemy
    const tg = this.sim.waveTelegraph()
    const domKind = this.dominantWaveKind()
    const evsm = this.sim.effectivenessVs(t, domKind)
    const arrow = evsm.eff === 'strong' ? '↑↑' : evsm.eff === 'weak' ? '↓↓' : '→'
    const evColor = evsm.eff === 'strong' ? '#8dff4a' : evsm.eff === 'weak' ? '#ff8a8a' : '#d8d0ff'
    const evText = this.add.text(-w / 2 + 20, -h / 2 + 72, `vs ${ENEMIES[domKind].name} (${tg.armor}): ${arrow} ${evsm.mult.toFixed(2)}×`, { fontFamily: 'Arial Black', fontSize: '16px', color: evColor }).setOrigin(0, 0)

    const children: Phaser.GameObjects.GameObject[] = [bg, title, stars, stat1, evText]
    const panel = this.add.container(x, y, children).setDepth(30)
    this.upgradePanel = panel

    // targeting selector (player-switchable priority)
    const modeIdx = TARGET_MODES.indexOf(t.targeting)
    const tw = 150, th = 40, tx = -w / 2 + 20 + tw / 2, ty = h / 2 - th / 2 - 14
    const tBg = this.add.graphics()
    tBg.fillStyle(0x3a2470, 1)
    tBg.fillRoundedRect(tx - tw / 2, ty - th / 2, tw, th, 10)
    tBg.lineStyle(2, t.def.color, 0.8)
    tBg.strokeRoundedRect(tx - tw / 2, ty - th / 2, tw, th, 10)
    const tTxt = this.add.text(tx, ty, `🎯 ${t.targeting}`, { fontFamily: 'Arial Black', fontSize: '17px', color: '#ffffff' }).setOrigin(0.5)
    panel.add([tBg, tTxt])
    tBg.setInteractive(new Phaser.Geom.Rectangle(tx - tw / 2, ty - th / 2, tw, th), Phaser.Geom.Rectangle.Contains)
    tBg.on('pointerdown', () => {
      const next = TARGET_MODES[(modeIdx + 1) % TARGET_MODES.length]
      this.sim.setTargeting(t.id, next)
      this.showUpgradePanel()
    })

    // upgrade / branch / max
    if (t.level < 2) {
      const cost = this.sim.upgradeCostFor(t) ?? 0
      const afford = this.sim.gold >= cost
      const bw = 200, bh = 56, bx = w / 2 - bw / 2 - 16, by = h / 2 - bh / 2 - 14
      const btnBg = this.add.graphics()
      btnBg.fillStyle(afford ? 0x2ea043 : 0x555070, 1)
      btnBg.fillRoundedRect(bx - bw / 2, by - bh / 2, bw, bh, 12)
      const btnTxt = this.add.text(bx, by, `UPGRADE $${cost}`, { fontFamily: 'Arial Black', fontSize: '20px', color: '#ffffff' }).setOrigin(0.5)
      panel.add([btnBg, btnTxt])
      btnBg.setInteractive(new Phaser.Geom.Rectangle(bx - bw / 2, by - bh / 2, bw, bh), Phaser.Geom.Rectangle.Contains)
      btnBg.on('pointerdown', () => this.sim.upgradeTower(t.id))
    } else if (t.level === 2) {
      const label = this.add.text(w / 2 - 20, -h / 2 + 100, 'CHOOSE A PATH:', { fontFamily: 'Arial Black', fontSize: '15px', color: '#ffd54a' }).setOrigin(1, 0)
      panel.add(label)
      t.def.branches.forEach((br, idx) => {
        const bw = 150, bh = 52
        const bx = w / 2 - 20 - bw / 2
        const by = -h / 2 + 128 + idx * 40
        const cost = this.sim.branchCostFor(t, idx) ?? 0
        const afford = this.sim.gold >= cost
        const bBg = this.add.graphics()
        bBg.fillStyle(afford ? t.def.color : 0x555070, 0.9)
        bBg.fillRoundedRect(bx - bw / 2, by - bh / 2, bw, bh, 10)
        const bName = this.add.text(bx, by - 9, br.name, { fontFamily: 'Arial Black', fontSize: '16px', color: '#ffffff' }).setOrigin(0.5)
        const bCost = this.add.text(bx, by + 11, `$${cost}`, { fontFamily: 'Arial', fontSize: '13px', color: '#eae0ff' }).setOrigin(0.5)
        panel.add([bBg, bName, bCost])
        bBg.setInteractive(new Phaser.Geom.Rectangle(bx - bw / 2, by - bh / 2, bw, bh), Phaser.Geom.Rectangle.Contains)
        bBg.on('pointerdown', () => this.sim.chooseBranch(t.id, idx))
      })
    } else {
      const maxTxt = this.add.text(w / 2 - 20, h / 2 - 34, 'MAX', { fontFamily: 'Arial Black', fontSize: '26px', color: '#ffd54a' }).setOrigin(1, 0.5)
      const blurb = this.add.text(w / 2 - 20, h / 2 - 64, (this.sim.stats(t) as { blurb?: string }).blurb ?? '', { fontFamily: 'Arial', fontSize: '14px', color: '#ffe27a' }).setOrigin(1, 0.5)
      panel.add([maxTxt, blurb])
    }
    panel.setScale(0.9)
    this.tweens.add({ targets: panel, scale: 1, duration: 150, ease: 'Back.easeOut' })
  }

  private dominantWaveKind(): EnemyKind {
    const wave = this.sim.currentWave()
    let best: EnemyKind = 'runner'
    let max = -1
    for (const entry of wave.entries) {
      if (entry.count > max) {
        max = entry.count
        best = entry.kind
      }
    }
    return best
  }

  // ======================================================================
  //  DRAFTS
  // ======================================================================
  private showDraft(): void {
    this.draftShown = true
    this.exitBuild()
    this.exitAiming()
    this.deselect()

    // IMPORTANT: the cards must each be TOP-LEVEL interactive containers (the
    // proven pattern used by every working button in this game). Nesting them in
    // the same container as a full-screen interactive `overlay` makes Phaser's
    // input sort ambiguous and the overlay swallows the tap. So: overlay stays a
    // standalone object BELOW the cards (depth 37), cards sit at depth 40 on top.
    const objs: Phaser.GameObjects.GameObject[] = []
    const overlay = this.add.rectangle(360, 640, 720, 1280, 0x000000, 0.6).setDepth(37)
    overlay.setInteractive() // blocks taps from reaching the field/buttons behind
    const title = this.add.text(360, 360, 'CHOOSE A POWER', { fontFamily: 'Arial Black', fontSize: '44px', color: '#c06bff' }).setOrigin(0.5).setDepth(38)
    title.setStroke('#000000', 8)
    const sub = this.add.text(360, 410, 'Pick 1 of 3 — lasts the whole run', { fontFamily: 'Arial', fontSize: '20px', color: '#d8d0ff' }).setOrigin(0.5).setDepth(38)
    objs.push(overlay, title, sub)

    const cards = this.sim.draftOffer
    const cw = 200, ch = 250, gap = 20
    const totalW = cards.length * cw + (cards.length - 1) * gap
    cards.forEach((card, i) => {
      const cx = 360 - totalW / 2 + cw / 2 + i * (cw + gap)
      const cy = 640
      const cardCont = this.add.container(cx, cy).setDepth(40)
      const cBg = this.add.graphics()
      cBg.fillStyle(0x1c1038, 1)
      cBg.fillRoundedRect(-cw / 2, -ch / 2, cw, ch, 18)
      cBg.lineStyle(5, card.color, 1)
      cBg.strokeRoundedRect(-cw / 2, -ch / 2, cw, ch, 18)
      const gem = this.add.star(0, -ch / 2 + 58, card.rarity === 'relic' ? 6 : 5, 16, 34, card.color)
      gem.setStrokeStyle(3, 0xffffff, 0.6)
      const rarity = this.add.text(0, -ch / 2 + 106, card.rarity.toUpperCase(), { fontFamily: 'Arial Black', fontSize: '13px', color: card.rarity === 'relic' ? '#ff8aff' : card.rarity === 'rare' ? '#8fe9ff' : '#c9b6ff' }).setOrigin(0.5)
      const name = this.add.text(0, -ch / 2 + 140, card.title, { fontFamily: 'Arial Black', fontSize: '21px', color: '#ffffff', align: 'center', wordWrap: { width: cw - 24 } }).setOrigin(0.5)
      const desc = this.add.text(0, 44, card.desc, { fontFamily: 'Arial', fontSize: '16px', color: '#d8d0ff', align: 'center', wordWrap: { width: cw - 30 } }).setOrigin(0.5)
      const pick = this.add.text(0, ch / 2 - 30, 'PICK', { fontFamily: 'Arial Black', fontSize: '22px', color: '#' + card.color.toString(16).padStart(6, '0') }).setOrigin(0.5)
      cardCont.add([cBg, gem, rarity, name, desc, pick])
      cardCont.setSize(cw, ch)
      // whole card is tappable (generous hit area, not just the tiny PICK text)
      cardCont.setInteractive(new Phaser.Geom.Rectangle(-cw / 2, -ch / 2, cw, ch), Phaser.Geom.Rectangle.Contains)
      cardCont.setScale(0.4)
      this.tweens.add({ targets: cardCont, scale: 1, duration: 260, delay: 100 + i * 90, ease: 'Back.easeOut' })
      this.tweens.add({ targets: gem, angle: 360, duration: 6000, repeat: -1 })
      cardCont.on('pointerover', () => this.tweens.add({ targets: cardCont, scale: 1.06, duration: 120 }))
      cardCont.on('pointerout', () => this.tweens.add({ targets: cardCont, scale: 1, duration: 120 }))
      cardCont.on('pointerdown', () => {
        // immediate pressed feedback, then resolve (pickDraft guards exactly-one)
        this.tweens.add({ targets: cardCont, scale: 0.9, duration: 90, yoyo: true })
        this.pickDraft(i, cx, cy, card.color)
      })
      objs.push(cardCont)
    })

    this.draftObjects = objs
  }

  private pickDraft(index: number, x: number, y: number, color: number): void {
    if (this.sim.state !== 'draft') return
    this.blipper.blip(700)
    this.cameras.main.flash(160, (color >> 16) & 255, (color >> 8) & 255, color & 255)
    this.pulseRing(x, y, 120, color)
    this.sim.chooseDraft(index)
    this.hideDraft()
  }

  private hideDraft(): void {
    // idempotent: pickDraft calls this directly, and update() may also call it
    // once state leaves 'draft' — either path must be safe to run twice.
    if (!this.draftShown && this.draftObjects.length === 0) return
    this.draftShown = false
    for (const o of this.draftObjects) o.destroy()
    this.draftObjects = []
  }

  // ======================================================================
  //  PAUSE / SPEED / RESULT
  // ======================================================================
  private togglePause(): void {
    if (this.sim.state === 'won' || this.sim.state === 'lost') return
    this.paused = !this.paused
    this.pauseLabel.setText(this.paused ? '▶' : 'II')
    this.tweens.timeScale = this.paused ? 0 : this.gameSpeed
    if (this.paused) {
      this.showBanner('PAUSED')
      this.exitBuild()
      this.exitAiming()
      this.pauseQuitBtn = this.makeButton(360, 760, 360, 76, this.endless ? 'RETIRE & BANK' : 'QUIT TO MAP', 0xff6a3c, () => this.quitBattle())
      this.pauseQuitBtn.setDepth(41)
    } else {
      this.clearBanner()
      this.pauseQuitBtn?.destroy()
      this.pauseQuitBtn = undefined
    }
  }

  private quitBattle(): void {
    if (this.endless) economy.awardEndless(this.sim.waveIndex)
    this.cameras.main.fadeOut(220, 20, 12, 50)
    this.time.delayedCall(240, () => this.scene.start(this.endless ? 'Menu' : 'Map'))
  }

  private toggleSpeed(): void {
    this.gameSpeed = this.gameSpeed === 1 ? 2 : 1
    this.speedLabel.setText(`${this.gameSpeed}x`)
    if (!this.paused) this.tweens.timeScale = this.gameSpeed
  }

  private showBanner(msg: string): void {
    this.clearBanner()
    this.banner = this.add.text(360, 640, msg, { fontFamily: 'Arial Black', fontSize: '64px', color: '#ffffff' }).setOrigin(0.5).setDepth(40)
    this.banner.setStroke('#7b2ff7', 10)
  }
  private clearBanner(): void {
    this.banner?.destroy()
    this.banner = undefined
  }

  private showResult(): void {
    this.resultShown = true
    this.exitBuild()
    this.exitAiming()
    this.deselect()
    if (this.sim.state === 'won') {
      const stars = starsForClear(this.sim.lives, this.sim.startLives)
      const result = economy.awardCampaign(this.level.id, stars, this.level.baseCoins)
      let unlocked: string | null = null
      if (result.firstClear && this.level.unlockTower && !economy.isTowerUnlocked(this.level.unlockTower)) {
        economy.unlockTower(this.level.unlockTower)
        unlocked = TOWERS[this.level.unlockTower].name
      }
      for (let i = 0; i < 3; i++) this.time.delayedCall(i * 250, () => this.cameras.main.flash(200, 47, 247, 195))
      this.resultPanel('VICTORY!', C.base, stars, result.coins, result.diamonds, unlocked)
    } else {
      this.cameras.main.shake(300, 0.01)
      if (this.endless) {
        const res = economy.awardEndless(this.sim.waveIndex)
        this.resultPanel('DEFEAT', C.life, 0, res.coins, 0, null, `Reached wave ${this.sim.waveIndex + 1}${res.best ? ' · NEW BEST!' : ''}`)
      } else {
        this.resultPanel('DEFEAT', C.life, 0, 0, 0, null, 'The crystal was overrun…')
      }
    }
  }

  private resultPanel(title: string, color: number, stars: number, coins: number, diamonds: number, unlocked: string | null, subOverride?: string): void {
    this.startBtn.setVisible(false)
    const overlay = this.add.rectangle(360, 640, 720, 1280, 0x000000, 0.62).setDepth(38)
    overlay.setInteractive()
    const w = 580, h = 560
    const bg = this.add.graphics().setDepth(39)
    bg.fillStyle(0x1c1038, 0.98)
    bg.fillRoundedRect(360 - w / 2, 640 - h / 2, w, h, 26)
    bg.lineStyle(6, color, 1)
    bg.strokeRoundedRect(360 - w / 2, 640 - h / 2, w, h, 26)
    const hex = '#' + color.toString(16).padStart(6, '0')
    const t = this.add.text(360, 470, title, { fontFamily: 'Arial Black', fontSize: '70px', color: hex }).setOrigin(0.5).setDepth(40)
    t.setStroke('#000000', 8)

    if (!this.endless && title === 'VICTORY!') {
      for (let i = 0; i < 3; i++) {
        const filled = i < stars
        const star = this.add.star(360 - 90 + i * 90, 560, 5, 18, 40, filled ? C.gold : 0x3a2c66).setDepth(40)
        star.setStrokeStyle(4, filled ? 0xffe9a6 : 0x554a86)
        star.setScale(0)
        this.tweens.add({ targets: star, scale: 1, duration: 300, delay: 300 + i * 160, ease: 'Back.easeOut' })
        if (filled) this.time.delayedCall(300 + i * 160, () => this.pulseRing(star.x, star.y, 44, C.gold))
      }
    } else if (subOverride) {
      this.add.text(360, 560, subOverride, { fontFamily: 'Arial', fontSize: '26px', color: '#d8d0ff' }).setOrigin(0.5).setDepth(40)
    }

    let ry = 640
    if (coins > 0) {
      this.add.text(360, ry, `+${coins} 🪙 Coins`, { fontFamily: 'Arial Black', fontSize: '30px', color: '#ffe27a' }).setOrigin(0.5).setDepth(40)
      ry += 46
    }
    if (diamonds > 0) {
      this.add.text(360, ry, `+${diamonds} 💎 Diamonds`, { fontFamily: 'Arial Black', fontSize: '30px', color: '#8fe9ff' }).setOrigin(0.5).setDepth(40)
      ry += 46
    }
    if (unlocked) {
      this.add.text(360, ry, `NEW TOWER: ${unlocked}!`, { fontFamily: 'Arial Black', fontSize: '26px', color: '#c06bff' }).setOrigin(0.5).setDepth(40)
      ry += 46
    }

    const retry = this.makeButton(360, 800, 300, 74, 'REPLAY', 0x4a3a7a, () => {
      this.cameras.main.fadeOut(220, 20, 12, 50)
      this.time.delayedCall(240, () => this.scene.restart({ levelId: this.levelId, endless: this.endless }))
    })
    retry.setDepth(41).setScale(0.6)
    this.tweens.add({ targets: retry, scale: 1, duration: 300, ease: 'Back.easeOut' })
    const back = this.makeButton(360, 888, 300, 74, this.endless ? 'MENU' : 'WORLD MAP', 0x2ea043, () => {
      this.cameras.main.fadeOut(220, 20, 12, 50)
      this.time.delayedCall(240, () => this.scene.start(this.endless ? 'Menu' : 'Map'))
    })
    back.setDepth(41).setScale(0.6)
    this.tweens.add({ targets: back, scale: 1, duration: 300, delay: 80, ease: 'Back.easeOut' })
  }

  // ---- buff links ---------------------------------------------------------
  private drawBuffLinks(): void {
    this.buffLinks.clear()
    for (const l of this.sim.buffLinks()) {
      this.buffLinks.lineStyle(4, l.color, 0.5)
      this.buffLinks.lineBetween(l.ax, l.ay, l.bx, l.by)
      this.buffLinks.fillStyle(l.color, 0.18)
      this.buffLinks.fillCircle(l.bx, l.by, 26)
    }
  }
}
