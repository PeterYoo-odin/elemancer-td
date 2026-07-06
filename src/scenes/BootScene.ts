import Phaser from 'phaser'
import { models } from '../three/models'

const NEON = [0x7b2ff7, 0x2ff7c3, 0xff6ad5, 0xffd54a, 0x4ad9ff]

/**
 * BootScene — the scaffold's living title screen. The battle scene (path, towers,
 * waves, spells, idle) gets built on top of this next, in Odin.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot')
  }

  create(): void {
    const { width, height } = this.scale

    // Deep magic-purple backdrop with a couple of soft bands for depth.
    this.add.rectangle(width / 2, height / 2, width, height, 0x241447)
    this.add.rectangle(width / 2, height * 0.5, width, height * 0.34, 0x2e1a5a, 0.6)

    // Floating elemental orbs so the screen feels alive.
    for (let i = 0; i < 12; i++) {
      const orb = this.add.circle(
        Phaser.Math.Between(40, width - 40),
        Phaser.Math.Between(80, height - 80),
        Phaser.Math.Between(10, 28),
        NEON[i % NEON.length],
        0.5,
      )
      this.tweens.add({
        targets: orb,
        y: orb.y - Phaser.Math.Between(50, 140),
        duration: Phaser.Math.Between(1800, 3600),
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      })
    }

    // Title.
    const title = this.add
      .text(width / 2, height * 0.3, 'ELEMANCER', {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: '92px',
        color: '#ffd54a',
      })
      .setOrigin(0.5)
    title.setStroke('#7b2ff7', 14)
    title.setShadow(0, 6, '#000000', 8, true, true)

    this.add
      .text(width / 2, height * 0.3 + 78, 'TOWER  DEFENSE', {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: '42px',
        color: '#ffffff',
      })
      .setOrigin(0.5)
      .setStroke('#2ff7c3', 6)

    // Pulsing play prompt (revealed once the 3D art assets finish preloading).
    const prompt = this.add
      .text(width / 2, height * 0.62, 'LOADING…', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '40px',
        color: '#a0f0ff',
      })
      .setOrigin(0.5)

    // Slim progress bar under the prompt.
    const barW = 360
    const barX = width / 2 - barW / 2
    const barY = height * 0.62 + 46
    const barBg = this.add.rectangle(width / 2, barY, barW, 10, 0x2a1c48).setOrigin(0.5)
    const barFill = this.add.rectangle(barX, barY, 2, 10, 0x2ff7c3).setOrigin(0, 0.5)

    this.add
      .text(width / 2, height - 56, 'v0.3 · built in Odin', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '22px',
        color: '#6b5a9a',
      })
      .setOrigin(0.5)

    const startWhenReady = () => {
      barBg.setVisible(false)
      barFill.setVisible(false)
      prompt.setText('TAP TO PLAY')
      this.tweens.add({ targets: prompt, alpha: 0.25, duration: 800, yoyo: true, repeat: -1 })
      this.input.once('pointerdown', () => {
        prompt.setText('Entering…')
        this.cameras.main.flash(300, 123, 47, 247)
        this.cameras.main.fadeOut(320, 20, 12, 50)
        this.time.delayedCall(340, () => this.scene.start('Menu'))
      })
    }

    if (models.ready) {
      barFill.width = barW
      startWhenReady()
    } else {
      models
        .load((frac) => { barFill.width = Math.max(2, barW * frac) })
        .then(startWhenReady)
        .catch(startWhenReady) // never trap the player on a failed asset
    }
  }
}
