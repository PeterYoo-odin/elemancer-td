import Phaser from 'phaser'
import { RankedPage } from '../ui/RankedPage'
import { music } from '../ui/music'
import { launchBattle } from '../ui/battleLoader'
import type { RankedMode } from '../game/ranked'
import { fetchGhost } from '../game/rankedNet'

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
        // PATHFORGE needs a committed route before any battle can launch — send
        // the player to the maze editor (on today's shared seed) instead of
        // straight into a battle; "Begin the Defense" there carries the route on.
        if (mode === 'pathforge') { this.scene.start('Pathforge', { seed }); return }
        launchBattle(this, {
          endless: true,
          daily: mode === 'daily',
          weekly: mode === 'weekly',
          seedOverride: seed, // undefined for endless → BattleScene picks its own seed
        })
      },
      onGhost: (mode: RankedMode, seed: number, runId: string) => {
        if (mode === 'pathforge') {
          // Need the ghost's committed route before BattleScene can bake its
          // LevelDef — fetch it here, then launch pre-armed with the maze.
          void fetchGhost(runId).then((g) => {
            if (!g || !g.route || g.route.length < 2) return
            launchBattle(this, { pathforge: true, seedOverride: seed, pathforgeMaze: g.route, ghostRunId: runId })
          })
          return
        }
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
