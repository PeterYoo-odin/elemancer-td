import Phaser from 'phaser'
import { PathforgePage } from '../ui/PathforgePage'
import { music } from '../ui/music'

// PathforgeScene — thin Phaser wrapper mounting the Pathforge build overlay
// (PathforgePage). Owns only mount/teardown; "Begin the Defense" launches a seeded
// endless run flagged `pathforge`, carrying the player's committed road route so
// BattleScene bakes it into the level. Mirrors DailyScene / RankedScene.
export class PathforgeScene extends Phaser.Scene {
  private page: PathforgePage | null = null

  constructor() {
    super('Pathforge')
  }

  create(data: { seed?: number }): void {
    const { width, height } = this.scale
    this.add.rectangle(width / 2, height / 2, width, height, 0x0a0716)
    music.setTrack('map')

    this.page = new PathforgePage(
      {
        onBack: () => this.scene.start('Menu'),
        onPlay: (seed, route) =>
          this.scene.start('Battle', {
            pathforge: true,
            seedOverride: seed,
            pathforgeMaze: route.map(([c, r]) => [c, r] as [number, number]),
          }),
      },
      { initialSeed: typeof data?.seed === 'number' ? data.seed : undefined },
    )

    this.events.once('shutdown', () => {
      this.page?.destroy()
      this.page = null
    })
  }
}
