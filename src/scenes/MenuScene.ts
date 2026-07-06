import Phaser from 'phaser'
import { economy } from '../game/economy'
import { UI, makeButton, currencyBar, orbBackdrop, popupCard } from './ui'

// Main menu / hub. Shows currencies, routes to Map / Workshop / Shop / Endless,
// and surfaces idle offline earnings + the daily diamond bonus on entry.
export class MenuScene extends Phaser.Scene {
  private bar!: { refresh: () => void }

  constructor() {
    super('Menu')
  }

  create(): void {
    const { width, height } = this.scale
    orbBackdrop(this)

    const title = this.add
      .text(width / 2, height * 0.16, 'ELEMANCER', { fontFamily: 'Arial Black', fontSize: '78px', color: '#ffd54a' })
      .setOrigin(0.5)
    title.setStroke('#7b2ff7', 12)
    title.setShadow(0, 6, '#000000', 8, true, true)
    this.add
      .text(width / 2, height * 0.16 + 66, 'TOWER DEFENSE', { fontFamily: 'Arial Black', fontSize: '34px', color: '#ffffff' })
      .setOrigin(0.5)
      .setStroke('#2ff7c3', 6)

    this.bar = currencyBar(this, 340)

    const cx = width / 2
    let y = 560
    makeButton(this, cx, y, '▶  PLAY', () => this.go('Map'), { color: UI.green, w: 420, h: 92, fontSize: 40 })
    y += 116
    makeButton(this, cx, y, '⚒  WORKSHOP', () => this.go('Workshop'), { color: 0x4a7bff, w: 420, h: 78 })
    y += 100
    makeButton(this, cx, y, '💎  SHOP', () => this.go('Shop'), { color: 0xc06bff, w: 420, h: 78 })
    y += 100
    makeButton(this, cx, y, '🏆  ENDLESS — RANKED', () => this.startEndless(), { color: 0xff6a3c, w: 420, h: 78, fontSize: 26 })

    this.add
      .text(width / 2, height - 90, 'Ranked is fair: purchases never affect it', { fontFamily: 'Arial', fontSize: '20px', color: '#8f7fc0' })
      .setOrigin(0.5)
    if (economy.data.endlessBest > 0) {
      this.add
        .text(width / 2, height - 58, `Best endless wave: ${economy.data.endlessBest}`, { fontFamily: 'Arial Black', fontSize: '22px', color: '#ffb27a' })
        .setOrigin(0.5)
    }

    // Idle offline earnings + daily bonus, shown once on entry.
    this.time.delayedCall(400, () => this.showRewards())
  }

  private showRewards(): void {
    const idle = economy.claimIdle()
    const daily = economy.claimDaily()
    const lines: string[] = []
    let color = UI.coin
    let title = ''
    if (idle.coins > 0) {
      const mins = Math.round(idle.seconds / 60)
      title = 'WHILE YOU WERE AWAY'
      lines.push(`You earned ${idle.coins} 🪙 coins`)
      lines.push(mins >= 60 ? `over ${(mins / 60).toFixed(1)}h${idle.capped ? ' (max)' : ''}` : `over ${mins} min`)
    }
    if (daily > 0) {
      if (!title) title = 'DAILY BONUS'
      else lines.push('')
      lines.push(`Daily bonus: +${daily} 💎 diamonds`)
      color = idle.coins > 0 ? UI.coin : UI.diamond
    }
    if (lines.length) {
      popupCard(this, title, lines, color)
      this.bar.refresh()
    }
  }

  private go(scene: string): void {
    this.cameras.main.fadeOut(200, 20, 12, 50)
    this.time.delayedCall(210, () => this.scene.start(scene))
  }

  private startEndless(): void {
    this.cameras.main.fadeOut(200, 20, 12, 50)
    this.time.delayedCall(210, () => this.scene.start('Battle', { endless: true }))
  }
}
