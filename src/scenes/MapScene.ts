import Phaser from 'phaser'
import { WorldMap } from '../ui/WorldMap'
import { music } from '../ui/music'

// Campaign world map. The visuals live in WorldMap (an HTML/CSS overlay, like
// FrontPage/BattleHud): the six realms of Aetheria as one scrolling journey,
// greyed beyond the player's reach. This scene owns its lifecycle and routes
// node taps into BattleScene with the chosen levelId — DOM buttons, so a tap
// on an unlocked node always lands.
export class MapScene extends Phaser.Scene {
  private map: WorldMap | null = null

  constructor() {
    super('Map')
  }

  create(): void {
    const { width, height } = this.scale
    // Solid backdrop behind the DOM overlay (visible for a frame on scene swaps).
    this.add.rectangle(width / 2, height / 2, width, height, 0x0a0716)
    music.setTrack('map')

    this.map = new WorldMap({
      onPlay: (levelId) => this.scene.start('Battle', { levelId, endless: false }),
      onBack: () => this.scene.start('Menu'),
    })

    this.events.once('shutdown', () => {
      this.map?.destroy()
      this.map = null
    })
  }
}
