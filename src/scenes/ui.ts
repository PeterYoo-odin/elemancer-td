// Shared UI helpers for the meta scenes (menu / map / workshop / shop). Pure
// procedural Phaser graphics — no assets. Keeps a consistent candy look + juice.
import Phaser from 'phaser'
import { economy } from '../game/economy'

export const UI = {
  bg: 0x241447,
  panel: 0x2e1a5a,
  panel2: 0x3a2470,
  coin: 0xffd54a,
  diamond: 0x8fe9ff,
  green: 0x2ea043,
  purple: 0x7b2ff7,
  white: 0xffffff,
}

export interface BtnOpts {
  w?: number
  h?: number
  color?: number
  fontSize?: number
  depth?: number
}

// A juicy rounded button that presses on tap.
export function makeButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  label: string,
  onClick: () => void,
  opts: BtnOpts = {},
): Phaser.GameObjects.Container {
  const w = opts.w ?? 360
  const h = opts.h ?? 78
  const color = opts.color ?? UI.green
  const bg = scene.add.graphics()
  bg.fillStyle(color, 1)
  bg.fillRoundedRect(-w / 2, -h / 2, w, h, 16)
  bg.lineStyle(4, 0xffffff, 0.28)
  bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 16)
  const txt = scene.add
    .text(0, 0, label, { fontFamily: 'Arial Black', fontSize: `${opts.fontSize ?? 30}px`, color: '#ffffff' })
    .setOrigin(0.5)
  const cont = scene.add.container(x, y, [bg, txt]).setDepth(opts.depth ?? 10)
  cont.setSize(w, h)
  cont.setData('label', txt)
  cont.setInteractive(new Phaser.Geom.Rectangle(-w / 2, -h / 2, w, h), Phaser.Geom.Rectangle.Contains)
  cont.on('pointerdown', () => {
    scene.tweens.add({ targets: cont, scale: 0.94, duration: 70, yoyo: true })
    onClick()
  })
  cont.on('pointerover', () => cont.setScale(1.03))
  cont.on('pointerout', () => cont.setScale(1))
  return cont
}

// A small currency chip (coins/diamonds) that reads live from economy.
export function currencyBar(scene: Phaser.Scene, y = 60): { refresh: () => void } {
  const coinPill = scene.add.graphics().setDepth(30)
  coinPill.fillStyle(UI.panel2, 0.95)
  coinPill.fillRoundedRect(360 - 320, y - 26, 300, 52, 26)
  coinPill.lineStyle(3, UI.coin, 0.5)
  coinPill.strokeRoundedRect(360 - 320, y - 26, 300, 52, 26)
  const c1 = scene.add.circle(360 - 296, y, 15, UI.coin).setDepth(31)
  c1.setStrokeStyle(3, 0xffe9a6)
  scene.add.text(360 - 296, y, '$', { fontFamily: 'Arial Black', fontSize: '18px', color: '#7a5600' }).setOrigin(0.5).setDepth(32)
  const coinTxt = scene.add.text(360 - 268, y, '', { fontFamily: 'Arial Black', fontSize: '26px', color: '#ffe27a' }).setOrigin(0, 0.5).setDepth(32)

  const dPill = scene.add.graphics().setDepth(30)
  dPill.fillStyle(UI.panel2, 0.95)
  dPill.fillRoundedRect(360 + 20, y - 26, 300, 52, 26)
  dPill.lineStyle(3, UI.diamond, 0.5)
  dPill.strokeRoundedRect(360 + 20, y - 26, 300, 52, 26)
  const d1 = scene.add.polygon(360 + 44, y, [0, -14, 12, 0, 0, 14, -12, 0], UI.diamond).setDepth(31)
  d1.setStrokeStyle(3, 0xd6fbff)
  const dTxt = scene.add.text(360 + 72, y, '', { fontFamily: 'Arial Black', fontSize: '26px', color: '#c6f4ff' }).setOrigin(0, 0.5).setDepth(32)

  const refresh = () => {
    coinTxt.setText(`${economy.coins}`)
    dTxt.setText(`${economy.diamonds}`)
  }
  refresh()
  return { refresh }
}

// Floating drifting orbs backdrop shared by meta scenes.
export function orbBackdrop(scene: Phaser.Scene, tint: number[] = [0x7b2ff7, 0x2ff7c3, 0xff6ad5, 0xffd54a, 0x4ad9ff]): void {
  const { width, height } = scene.scale
  scene.add.rectangle(width / 2, height / 2, width, height, UI.bg).setDepth(-2)
  scene.add.rectangle(width / 2, height * 0.5, width, height * 0.34, 0x2e1a5a, 0.5).setDepth(-2)
  for (let i = 0; i < 12; i++) {
    const orb = scene.add
      .circle(Phaser.Math.Between(40, width - 40), Phaser.Math.Between(120, height - 120), Phaser.Math.Between(10, 26), tint[i % tint.length], 0.4)
      .setDepth(-1)
    scene.tweens.add({
      targets: orb, y: orb.y - Phaser.Math.Between(50, 140), duration: Phaser.Math.Between(1800, 3600),
      yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    })
  }
}

// A one-shot popup card (used for idle earnings). Dismisses on tap.
export function popupCard(scene: Phaser.Scene, title: string, lines: string[], color = UI.coin): void {
  const overlay = scene.add.rectangle(360, 640, 720, 1280, 0x000000, 0.6).setDepth(50).setInteractive()
  const w = 560
  const h = 120 + lines.length * 44 + 90
  const bg = scene.add.graphics().setDepth(51)
  bg.fillStyle(0x1c1038, 0.98)
  bg.fillRoundedRect(360 - w / 2, 640 - h / 2, w, h, 24)
  bg.lineStyle(6, color, 1)
  bg.strokeRoundedRect(360 - w / 2, 640 - h / 2, w, h, 24)
  const els: Phaser.GameObjects.GameObject[] = [overlay, bg]
  const hex = '#' + color.toString(16).padStart(6, '0')
  const t = scene.add.text(360, 640 - h / 2 + 54, title, { fontFamily: 'Arial Black', fontSize: '40px', color: hex }).setOrigin(0.5).setDepth(52)
  t.setStroke('#000000', 6)
  els.push(t)
  lines.forEach((ln, i) => {
    els.push(scene.add.text(360, 640 - h / 2 + 120 + i * 44, ln, { fontFamily: 'Arial', fontSize: '26px', color: '#e6ddff' }).setOrigin(0.5).setDepth(52))
  })
  const tap = scene.add.text(360, 640 + h / 2 - 44, 'TAP TO COLLECT', { fontFamily: 'Arial Black', fontSize: '24px', color: '#a0f0ff' }).setOrigin(0.5).setDepth(52)
  els.push(tap)
  scene.tweens.add({ targets: tap, alpha: 0.3, duration: 700, yoyo: true, repeat: -1 })
  const card = scene.add.container(0, 0, els).setDepth(50)
  card.setScale(0.7)
  scene.tweens.add({ targets: card, scale: 1, duration: 300, ease: 'Back.easeOut' })
  overlay.on('pointerdown', () => card.destroy())
}
