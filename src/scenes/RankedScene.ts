import Phaser from 'phaser'
import { RankedPage } from '../ui/RankedPage'
import { music } from '../ui/music'
import { launchBattle } from '../ui/battleLoader'
import type { RankedMode } from '../game/ranked'

// RankedScene — thin Phaser wrapper mounting the HTML/CSS Ranked hub (RankedPage).
// Routes "Play" into the matching seeded ranked run and "Race ghost" into the
// same seed with a ghost run id. Mirrors DailyScene / ShopScene lifecycle.
export class RankedScene extends Phaser.Scene {
  private page: RankedPage | null = null

  constructor() {
    super('Ranked')
  }

  create(): void {
    const { width, height } = this.scale
    this.add.rectangle(width / 2, height / 2, width, height, 0x0a0716)
    music.setTrack('map')

    this.page = new RankedPage({
      onBack: () => this.scene.start('Menu'),
      onPlay: (mode: RankedMode, seed: number | undefined) => {
        launchBattle(this, {
          endless: true,
          daily: mode === 'daily',
          weekly: mode === 'weekly',
          seedOverride: seed, // undefined for endless → BattleScene picks its own seed
        })
      },
      onGhost: (mode: RankedMode, seed: number, runId: string) => {
        launchBattle(this, {
          endless: true,
          daily: mode === 'daily',
          weekly: mode === 'weekly',
          seedOverride: seed,
          ghostRunId: runId,
        })
      },
    })

    this.events.once('shutdown', () => {
      this.page?.destroy()
      this.page = null
    })
  }
}
