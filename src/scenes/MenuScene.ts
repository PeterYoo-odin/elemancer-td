import Phaser from 'phaser'
import { economy } from '../game/economy'
import { FrontPage } from '../ui/FrontPage'
import { showOdinSplash } from '../ui/OdinSplash'
import { music } from '../ui/music'

// Main menu / hub. The visuals live in FrontPage (an HTML/CSS overlay, like
// BattleHud); this scene owns its lifecycle, routes navigation to the other
// scenes, and surfaces idle offline earnings + the daily diamond bonus.
export class MenuScene extends Phaser.Scene {
  private front: FrontPage | null = null

  constructor() {
    super('Menu')
  }

  create(): void {
    const { width, height } = this.scale
    // Solid backdrop behind the DOM overlay (visible for a frame on scene swaps).
    this.add.rectangle(width / 2, height / 2, width, height, 0x0a0716)
    music.setTrack('map')

    this.front = new FrontPage({
      onPlay: () => this.scene.start('Map'),
      onHeroes: () => this.scene.start('Heroes'),
      onWorkshop: () => this.scene.start('Workshop'),
      onShop: () => this.scene.start('Shop'),
      onEndless: () => this.scene.start('Battle', { endless: true }),
      // Replay from settings: the user has interacted, so no tap gate needed.
      onReplayIntro: () => showOdinSplash({ gate: false }),
    })
    this.front.setCurrencies(economy.coins, economy.diamonds)
    this.front.setBestWave(economy.data.endlessBest)

    this.events.once('shutdown', () => {
      this.front?.destroy()
      this.front = null
    })

    // Idle offline earnings + daily bonus, shown once on entry.
    this.time.delayedCall(500, () => this.showRewards())
  }

  private showRewards(): void {
    if (!this.front) return
    const idle = economy.claimIdle()
    const daily = economy.claimDaily()
    const lines: string[] = []
    let title = ''
    if (idle.coins > 0) {
      const mins = Math.round(idle.seconds / 60)
      title = 'WHILE YOU WERE AWAY'
      lines.push(`You earned ${idle.coins} 🪙 coins`)
      lines.push(mins >= 60 ? `over ${(mins / 60).toFixed(1)}h${idle.capped ? ' (max)' : ''}` : `over ${mins} min`)
    }
    if (daily > 0) {
      if (!title) title = 'DAILY BONUS'
      else lines.push('')
      lines.push(`Daily bonus: +${daily} 💎 diamonds`)
    }
    if (lines.length) {
      this.front.showRewards(title, lines)
      this.front.setCurrencies(economy.coins, economy.diamonds)
    }
  }
}
