import Phaser from 'phaser'
import { StorePage } from '../ui/StorePage'
import { music } from '../ui/music'

// Store hub. The whole UI lives in StorePage (an HTML/CSS overlay, like
// FrontPage); this scene only owns its lifecycle. economy.ts stays the single
// currency/ownership authority; nothing here charges real money (all real-money
// SKUs are inert "coming soon" mocks until the payments layer lands).
export class ShopScene extends Phaser.Scene {
  private page: StorePage | null = null

  constructor() {
    super('Shop')
  }

  create(): void {
    const { width, height } = this.scale
    // Solid backdrop behind the DOM overlay (visible for a frame on scene swaps).
    this.add.rectangle(width / 2, height / 2, width, height, 0x0a0716)
    music.setTrack('map')

    this.page = new StorePage({
      onBack: () => this.scene.start('Menu'),
    })

    this.events.once('shutdown', () => {
      this.page?.destroy()
      this.page = null
    })
  }
}
