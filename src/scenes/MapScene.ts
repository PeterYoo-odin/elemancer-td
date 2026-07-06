import Phaser from 'phaser'
import { economy } from '../game/economy'
import { LEVELS, isLevelUnlocked, type LevelDef } from '../game/levels'
import { UI, makeButton, currencyBar, orbBackdrop } from './ui'

// Campaign world map. Colourful level nodes on a winding trail, each showing
// 0–3 stars. Clearing a level (>=1 star) unlocks the next. Locked levels are
// greyed with a padlock.
export class MapScene extends Phaser.Scene {
  constructor() {
    super('Map')
  }

  create(): void {
    const { width, height } = this.scale
    orbBackdrop(this, [0x2ff7c3, 0x7b2ff7, 0xffd54a])

    this.add
      .text(width / 2, 130, 'WORLD MAP', { fontFamily: 'Arial Black', fontSize: '52px', color: '#ffffff' })
      .setOrigin(0.5)
      .setStroke('#7b2ff7', 8)

    currencyBar(this, 60)

    // node positions zig-zag down the screen
    const nodes = LEVELS.map((lvl, i) => {
      const x = i % 2 === 0 ? width * 0.32 : width * 0.68
      const y = 260 + i * 138
      return { lvl, x, y }
    })

    // trail connectors behind the nodes
    const trail = this.add.graphics().setDepth(0)
    for (let i = 0; i < nodes.length - 1; i++) {
      const a = nodes[i]
      const b = nodes[i + 1]
      const unlocked = isLevelUnlocked(b.lvl.index, economy.data.stars)
      trail.lineStyle(10, unlocked ? 0xffd54a : 0x4a3a7a, unlocked ? 0.8 : 0.5)
      trail.lineBetween(a.x, a.y, b.x, b.y)
    }

    for (const n of nodes) this.drawNode(n.lvl, n.x, n.y)

    makeButton(this, width / 2, height - 70, '‹ MENU', () => this.go('Menu'), { color: UI.panel2, w: 240, h: 62, fontSize: 26 })
  }

  private drawNode(lvl: LevelDef, x: number, y: number): void {
    const unlocked = isLevelUnlocked(lvl.index, economy.data.stars)
    const stars = economy.starsFor(lvl.id)
    const p = lvl.palette

    const ring = this.add.circle(x, y, 52, unlocked ? p.path : 0x4a3a7a, unlocked ? 1 : 0.6).setDepth(1)
    ring.setStrokeStyle(6, unlocked ? 0xffffff : 0x2e1a5a, unlocked ? 0.6 : 0.4)
    const inner = this.add.circle(x, y, 40, unlocked ? p.grassA : 0x322458).setDepth(2)
    inner.setStrokeStyle(3, 0x000000, 0.2)

    this.add
      .text(x, y, `${lvl.index + 1}`, { fontFamily: 'Arial Black', fontSize: '40px', color: unlocked ? '#ffffff' : '#6b5a9a' })
      .setOrigin(0.5)
      .setDepth(3)

    // name plate
    this.add
      .text(x, y + 66, unlocked ? lvl.name : '???', { fontFamily: 'Arial Black', fontSize: '20px', color: unlocked ? '#ffe27a' : '#6b5a9a' })
      .setOrigin(0.5)
      .setDepth(3)

    // stars
    for (let i = 0; i < 3; i++) {
      const filled = i < stars
      const sx = x - 32 + i * 32
      const sy = y - 66
      const star = this.add.star(sx, sy, 5, 7, 15, filled ? UI.coin : 0x2e1a5a).setDepth(3)
      star.setStrokeStyle(2, filled ? 0xffe9a6 : 0x554a86)
    }

    if (!unlocked) {
      this.add.text(x, y, '🔒', { fontSize: '34px' }).setOrigin(0.5).setDepth(4)
      return
    }

    // pulse + interactivity for unlocked nodes
    this.tweens.add({ targets: ring, scale: 1.06, duration: 1000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' })
    const hit = this.add.circle(x, y, 56, 0xffffff, 0.001).setDepth(5)
    hit.setInteractive(new Phaser.Geom.Circle(0, 0, 56), Phaser.Geom.Circle.Contains)
    hit.on('pointerover', () => ring.setScale(1.12))
    hit.on('pointerout', () => ring.setScale(1))
    hit.on('pointerdown', () => {
      this.tweens.add({ targets: ring, scale: 0.9, duration: 80, yoyo: true })
      this.cameras.main.fadeOut(220, 20, 12, 50)
      this.time.delayedCall(240, () => this.scene.start('Battle', { levelId: lvl.id, endless: false }))
    })
  }

  private go(scene: string): void {
    this.cameras.main.fadeOut(200, 20, 12, 50)
    this.time.delayedCall(210, () => this.scene.start(scene))
  }
}
