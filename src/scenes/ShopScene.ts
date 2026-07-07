import Phaser from 'phaser'
import { UI, makeButton, currencyBar, orbBackdrop } from './ui'

// Shop — UI ONLY, nothing charges this slice. Diamond packs + a "Chromancer Plus"
// subscription, all inert "Coming soon". economy.ts stays the single currency
// source; a real IAP layer drops in behind these buttons later.
interface Pack {
  diamonds: number
  price: string
  best?: boolean
}

const PACKS: Pack[] = [
  { diamonds: 100, price: '$2.99' },
  { diamonds: 250, price: '$5.99' },
  { diamonds: 600, price: '$12.99', best: true },
  { diamonds: 1400, price: '$24.99' },
]

export class ShopScene extends Phaser.Scene {
  constructor() {
    super('Shop')
  }

  create(): void {
    const { width, height } = this.scale
    orbBackdrop(this, [0xc06bff, 0x8fe9ff, 0xffd54a])

    this.add
      .text(width / 2, 118, 'SHOP', { fontFamily: 'Arial Black', fontSize: '52px', color: '#ffffff' })
      .setOrigin(0.5)
      .setStroke('#c06bff', 8)

    currencyBar(this, 60)

    this.add
      .text(width / 2, 166, 'Diamonds are also EARNABLE FREE in-game', { fontFamily: 'Arial', fontSize: '19px', color: '#a0f0ff' })
      .setOrigin(0.5)

    // 2x2 grid of diamond packs
    const gx = [width * 0.28, width * 0.72]
    const gy = [300, 470]
    PACKS.forEach((pack, i) => {
      const x = gx[i % 2]
      const y = gy[Math.floor(i / 2)]
      this.drawPack(pack, x, y)
    })

    // Chromancer Plus subscription card
    this.drawSubscription(width / 2, 720)

    this.add
      .text(width / 2, height - 118, 'All purchases are placeholders in this build.', { fontFamily: 'Arial', fontSize: '18px', color: '#8f7fc0' })
      .setOrigin(0.5)

    makeButton(this, width / 2, height - 62, '‹ MENU', () => this.go('Menu'), { color: UI.panel2, w: 240, h: 56, fontSize: 24 })
  }

  private drawPack(pack: Pack, x: number, y: number): void {
    const w = 300
    const h = 150
    const bg = this.add.graphics().setDepth(2)
    bg.fillStyle(0x2a2050, 0.96)
    bg.fillRoundedRect(x - w / 2, y - h / 2, w, h, 18)
    bg.lineStyle(4, pack.best ? UI.coin : UI.diamond, pack.best ? 1 : 0.6)
    bg.strokeRoundedRect(x - w / 2, y - h / 2, w, h, 18)

    if (pack.best) {
      const tag = this.add.graphics().setDepth(3)
      tag.fillStyle(UI.coin, 1)
      tag.fillRoundedRect(x + w / 2 - 108, y - h / 2 - 12, 100, 30, 10)
      this.add.text(x + w / 2 - 58, y - h / 2 + 3, 'BEST VALUE', { fontFamily: 'Arial Black', fontSize: '14px', color: '#7a5600' }).setOrigin(0.5).setDepth(4)
    }

    this.add.polygon(x, y - 34, [0, -22, 20, 0, 0, 22, -20, 0], UI.diamond).setStrokeStyle(3, 0xd6fbff).setDepth(3)
    this.add.text(x, y + 6, `${pack.diamonds} 💎`, { fontFamily: 'Arial Black', fontSize: '30px', color: '#c6f4ff' }).setOrigin(0.5).setDepth(3)

    // inert price button
    const btnW = 160
    const btnH = 44
    const btn = this.add.graphics().setDepth(3)
    btn.fillStyle(0x554a86, 1)
    btn.fillRoundedRect(x - btnW / 2, y + 32, btnW, btnH, 12)
    this.add.text(x, y + 32 + btnH / 2, `${pack.price} · SOON`, { fontFamily: 'Arial Black', fontSize: '18px', color: '#c9b6ff' }).setOrigin(0.5).setDepth(4)

    const hit = this.add.rectangle(x, y, w, h, 0xffffff, 0.001).setDepth(5)
    hit.setInteractive()
    hit.on('pointerdown', () => this.comingSoon(x, y))
  }

  private drawSubscription(x: number, y: number): void {
    const w = 640
    const h = 230
    const bg = this.add.graphics().setDepth(2)
    bg.fillStyle(0x35205e, 0.97)
    bg.fillRoundedRect(x - w / 2, y - h / 2, w, h, 22)
    bg.lineStyle(5, 0xffd54a, 0.9)
    bg.strokeRoundedRect(x - w / 2, y - h / 2, w, h, 22)

    this.add.text(x, y - h / 2 + 32, '✦ CHROMANCER PLUS ✦', { fontFamily: 'Arial Black', fontSize: '30px', color: '#ffd54a' }).setOrigin(0.5).setDepth(3)
    const perks = ['2× idle earnings', 'Daily diamond stipend', 'Exclusive cosmetic skin', 'Auto-collect coins']
    perks.forEach((p, i) => {
      const px = x - w / 2 + 40 + (i % 2) * (w / 2 - 20)
      const py = y - 26 + Math.floor(i / 2) * 40
      this.add.text(px, py, `• ${p}`, { fontFamily: 'Arial', fontSize: '21px', color: '#e6ddff' }).setOrigin(0, 0.5).setDepth(3)
    })

    const btnW = 300
    const btnH = 52
    const btn = this.add.graphics().setDepth(3)
    btn.fillStyle(0x554a86, 1)
    btn.fillRoundedRect(x - btnW / 2, y + h / 2 - btnH - 16, btnW, btnH, 14)
    this.add.text(x, y + h / 2 - btnH / 2 - 16, '$4.99 / mo · COMING SOON', { fontFamily: 'Arial Black', fontSize: '19px', color: '#c9b6ff' }).setOrigin(0.5).setDepth(4)

    const hit = this.add.rectangle(x, y, w, h, 0xffffff, 0.001).setDepth(5)
    hit.setInteractive()
    hit.on('pointerdown', () => this.comingSoon(x, y - 40))
  }

  private comingSoon(x: number, y: number): void {
    const t = this.add.text(x, y, 'Coming soon!', { fontFamily: 'Arial Black', fontSize: '26px', color: '#ffd54a' }).setOrigin(0.5).setDepth(60)
    t.setStroke('#000000', 5)
    t.setScale(0.5)
    this.tweens.add({ targets: t, scale: 1, duration: 140, ease: 'Back.easeOut' })
    this.tweens.add({ targets: t, y: y - 40, alpha: 0, delay: 400, duration: 600, onComplete: () => t.destroy() })
  }

  private go(scene: string): void {
    this.cameras.main.fadeOut(200, 20, 12, 50)
    this.time.delayedCall(210, () => this.scene.start(scene))
  }
}
