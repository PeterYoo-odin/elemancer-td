import Phaser from 'phaser'
import { economy } from '../game/economy'
import { WORKSHOP_NODES, nodeLevel, nextCost, coinDiamondSplit, type WorkshopNode } from '../game/workshop'
import { UI, makeButton, currencyBar, orbBackdrop } from './ui'

// Workshop — persistent meta-upgrade tree boosting all CAMPAIGN runs. ~85% of
// nodes are the free coin path; the rest are diamond ACCELERATORS (never raw
// power the free path can't reach). The split is shown up top.
export class WorkshopScene extends Phaser.Scene {
  private bar!: { refresh: () => void }
  private rows: Array<{ node: WorkshopNode; redraw: () => void }> = []

  constructor() {
    super('Workshop')
  }

  create(): void {
    const { width, height } = this.scale
    this.rows = []
    orbBackdrop(this, [0x4a7bff, 0x2ff7c3, 0xffd54a])

    this.add
      .text(width / 2, 118, 'WORKSHOP', { fontFamily: 'Arial Black', fontSize: '50px', color: '#ffffff' })
      .setOrigin(0.5)
      .setStroke('#4a7bff', 8)

    this.bar = currencyBar(this, 60)

    const split = coinDiamondSplit()
    this.add
      .text(width / 2, 162, `Upgrades: ${split.coin} free (🪙) · ${split.diamond} premium (💎)`, { fontFamily: 'Arial', fontSize: '20px', color: '#a0f0ff' })
      .setOrigin(0.5)

    // scrollable-ish list (fits on screen: 13 compact rows)
    const top = 210
    const rowH = 74
    WORKSHOP_NODES.forEach((node, i) => {
      this.drawRow(node, top + i * rowH, rowH - 8)
    })

    makeButton(this, width / 2, height - 60, '‹ MENU', () => this.go('Menu'), { color: UI.panel2, w: 240, h: 56, fontSize: 24 })
  }

  private drawRow(node: WorkshopNode, y: number, h: number): void {
    const isDiamond = node.currency === 'diamonds'
    const accent = isDiamond ? UI.diamond : UI.coin
    const x = 360
    const w = 680

    const bg = this.add.graphics().setDepth(2)
    const draw = () => {
      bg.clear()
      bg.fillStyle(isDiamond ? 0x2a2050 : 0x241a48, 0.96)
      bg.fillRoundedRect(x - w / 2, y - h / 2, w, h, 14)
      bg.lineStyle(3, accent, isDiamond ? 0.9 : 0.5)
      bg.strokeRoundedRect(x - w / 2, y - h / 2, w, h, 14)
    }
    draw()

    const badge = this.add
      .text(x - w / 2 + 22, y, isDiamond ? '💎' : '🪙', { fontSize: '26px' })
      .setOrigin(0.5)
      .setDepth(3)
    const name = this.add
      .text(x - w / 2 + 48, y - 15, node.name, { fontFamily: 'Arial Black', fontSize: '22px', color: '#ffffff' })
      .setOrigin(0, 0.5)
      .setDepth(3)
    if (isDiamond) {
      this.add
        .text(x - w / 2 + 48 + name.width + 10, y - 15, 'ACCELERATOR', { fontFamily: 'Arial Black', fontSize: '13px', color: '#8fe9ff' })
        .setOrigin(0, 0.5)
        .setDepth(3)
    }
    this.add
      .text(x - w / 2 + 48, y + 13, node.desc, { fontFamily: 'Arial', fontSize: '17px', color: '#c9b6ff' })
      .setOrigin(0, 0.5)
      .setDepth(3)

    // level pips
    const pipY = y - 15
    const pips: Phaser.GameObjects.Arc[] = []
    for (let i = 0; i < node.maxLevel; i++) {
      pips.push(this.add.circle(x + 150 + i * 18, pipY, 6, 0x000000, 0.4).setStrokeStyle(2, accent, 0.6).setDepth(3))
    }

    const btn = this.add.graphics().setDepth(3)
    const btnW = 128
    const btnH = 50
    const btnX = x + w / 2 - btnW / 2 - 16
    const btnY = y
    const btnLabel = this.add.text(btnX, btnY, '', { fontFamily: 'Arial Black', fontSize: '19px', color: '#ffffff' }).setOrigin(0.5).setDepth(4)

    const redraw = () => {
      draw()
      const lvl = nodeLevel(economy.data, node.id)
      const cost = nextCost(economy.data, node)
      for (let i = 0; i < pips.length; i++) {
        pips[i].setFillStyle(i < lvl ? accent : 0x000000, i < lvl ? 1 : 0.4)
      }
      btn.clear()
      if (cost === null) {
        btn.fillStyle(0x2ea043, 1)
        btn.fillRoundedRect(btnX - btnW / 2, btnY - btnH / 2, btnW, btnH, 12)
        btnLabel.setText('MAX')
      } else {
        const afford = economy.canAfford(node.currency, cost)
        btn.fillStyle(afford ? (isDiamond ? 0x7a4ad0 : 0x2ea043) : 0x554a86, 1)
        btn.fillRoundedRect(btnX - btnW / 2, btnY - btnH / 2, btnW, btnH, 12)
        btnLabel.setText(`${cost} ${isDiamond ? '💎' : '🪙'}`)
      }
    }
    redraw()

    btn.setInteractive(new Phaser.Geom.Rectangle(btnX - btnW / 2, btnY - btnH / 2, btnW, btnH), Phaser.Geom.Rectangle.Contains)
    btn.on('pointerdown', () => this.buy(node, redraw))

    this.rows.push({ node, redraw })
  }

  private buy(node: WorkshopNode, redraw: () => void): void {
    const cost = nextCost(economy.data, node)
    if (cost === null) return
    if (!economy.spend(node.currency, cost)) {
      this.flash('NOT ENOUGH ' + (node.currency === 'diamonds' ? '💎' : '🪙'), 0xff5b7a)
      return
    }
    economy.data.workshop[node.id] = nodeLevel(economy.data, node.id) + 1
    economy.save()
    redraw()
    this.bar.refresh()
    this.cameras.main.flash(120, 80, 180, 255)
    this.flash(`${node.name} upgraded!`, node.currency === 'diamonds' ? UI.diamond : UI.coin)
  }

  private flash(msg: string, color: number): void {
    const hex = '#' + color.toString(16).padStart(6, '0')
    const t = this.add
      .text(360, 640, msg, { fontFamily: 'Arial Black', fontSize: '30px', color: hex })
      .setOrigin(0.5)
      .setDepth(60)
    t.setStroke('#000000', 5)
    this.tweens.add({ targets: t, y: 600, alpha: 0, duration: 900, ease: 'Cubic.easeIn', onComplete: () => t.destroy() })
  }

  private go(scene: string): void {
    this.cameras.main.fadeOut(200, 20, 12, 50)
    this.time.delayedCall(210, () => this.scene.start(scene))
  }
}
