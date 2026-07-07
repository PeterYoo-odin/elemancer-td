import Phaser from 'phaser'
import { WorkshopPage } from '../ui/WorkshopPage'
import { music } from '../ui/music'

// Workshop — persistent meta-upgrade tree boosting all CAMPAIGN runs. The whole
// UI now lives in WorkshopPage (an HTML/CSS overlay, like FrontPage/StorePage);
// this scene only owns its lifecycle. economy.ts stays the single wallet
// authority — the ~85% free coin path is the only source of battle power, the
// diamond nodes are endless-safe accelerators (surfaced in the page's ribbon).
export class WorkshopScene extends Phaser.Scene {
  private page: WorkshopPage | null = null

  constructor() {
    super('Workshop')
  }

  create(): void {
    const { width, height } = this.scale
    // Solid backdrop behind the DOM overlay (visible for a frame on scene swaps).
    this.add.rectangle(width / 2, height / 2, width, height, 0x0a0716)
    music.setTrack('map')

    this.page = new WorkshopPage({
      onBack: () => this.scene.start('Menu'),
    })

    this.events.once('shutdown', () => {
      this.page?.destroy()
      this.page = null
    })
  }
}
