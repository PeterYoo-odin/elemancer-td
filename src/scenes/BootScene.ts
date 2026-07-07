import Phaser from 'phaser'
import { models } from '../three/models'
import { splashDone } from '../ui/bootGate'

/**
 * BootScene — silent asset preloader behind the Odin Platforms splash (a DOM
 * overlay created in main.ts). It advances to the menu once BOTH the splash
 * has finished and the 3D kit is loaded. Its own visuals only matter in the
 * rare case where loading outlasts the splash: a minimal dark screen with a
 * slim gold progress bar.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot')
  }

  create(): void {
    const { width, height } = this.scale

    this.add.rectangle(width / 2, height / 2, width, height, 0x0a0716)

    const label = this.add
      .text(width / 2, height * 0.55, 'SUMMONING ELEMENTS', {
        fontFamily: 'system-ui, Arial, sans-serif',
        fontSize: '22px',
        color: '#8f7fc0',
      })
      .setOrigin(0.5)
      .setLetterSpacing(6)
      .setAlpha(0)
    this.tweens.add({ targets: label, alpha: 0.9, duration: 600, delay: 300 })

    const barW = 320
    const barY = height * 0.55 + 44
    this.add.rectangle(width / 2, barY, barW, 4, 0x2a1c48).setOrigin(0.5)
    const barFill = this.add.rectangle(width / 2 - barW / 2, barY, 2, 4, 0xffd54a).setOrigin(0, 0.5)

    const assetsReady = models.ready
      ? Promise.resolve()
      : models
          .load((frac) => {
            barFill.width = Math.max(2, barW * frac)
          })
          .catch(() => undefined) // never trap the player on a failed asset

    // The splash fades itself out over the top of this scene; by the time it's
    // gone (or the assets finish, whichever is later) we go straight to Menu.
    void Promise.all([assetsReady, splashDone]).then(() => {
      if (!this.scene.isActive('Boot')) return
      this.scene.start('Menu')
    })
  }
}
