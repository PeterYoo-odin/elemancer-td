import Phaser from 'phaser'
import { economy } from '../game/economy'
import { FrontPage } from '../ui/FrontPage'
import { showOdinSplash } from '../ui/OdinSplash'
import { music } from '../ui/music'
import { playCutsceneOnce } from '../ui/Cutscene'

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
      // FIRST SESSION: nothing cleared yet → skip the map and drop straight into
      // level 1 with the live coach (first tower <20s). The world map opens after.
      onPlay: () => {
        const fresh = economy.totalStars() === 0 && Object.keys(economy.data.firstClears).length === 0
        // First-ever Play: the OPENING motion-comic (skippable, once) sets the
        // stakes before the first battle. Returning players go to the map.
        if (fresh) playCutsceneOnce('opening', () => this.scene.start('Battle', { levelId: 'l1' }))
        else this.scene.start('Map')
      },
      onHeroes: () => this.scene.start('Heroes'),
      onWorkshop: () => this.scene.start('Workshop'),
      onShop: () => this.scene.start('Shop'),
      onEndless: () => this.scene.start('Battle', { endless: true }),
      onRoguelike: () => this.scene.start('Battle', { roguelike: true }),
      onDaily: () => this.scene.start('Daily'),
      // Replay from settings: the user has interacted, so no tap gate needed.
      onReplayIntro: () => showOdinSplash({ gate: false }),
    })
    this.front.setCurrencies(economy.coins, economy.diamonds, economy.prisms)
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
    const streak = economy.claimLoginStreak()
    const lines: string[] = []
    let title = ''
    if (idle.coins > 0) {
      const mins = Math.round(idle.seconds / 60)
      title = 'WHILE YOU WERE AWAY'
      lines.push(`You earned ${idle.coins} coins`)
      lines.push(mins >= 60 ? `over ${(mins / 60).toFixed(1)}h${idle.capped ? ' (max)' : ''}` : `over ${mins} min`)
    }
    if (streak) {
      if (!title) title = streak.isJackpot ? 'STREAK JACKPOT!' : 'DAILY REWARD'
      else lines.push('')
      const r = streak.reward
      const parts: string[] = []
      if (r.diamonds) parts.push(`+${r.diamonds} 💎`)
      if (r.coins) parts.push(`+${r.coins} 🪙`)
      if (r.prisms) parts.push(`+${r.prisms} ✦`)
      lines.push(`Day ${streak.streak} streak: ${parts.join(' · ')}`)
      // the "come back tomorrow" nudge — name tomorrow's escalating reward
      const info = economy.loginStreakInfo()
      const t = info.tomorrowReward
      const tParts: string[] = []
      if (t.diamonds) tParts.push(`${t.diamonds} 💎`)
      if (t.coins) tParts.push(`${t.coins} 🪙`)
      if (t.prisms) tParts.push(`${t.prisms} ✦`)
      if (tParts.length) lines.push(`Come back tomorrow for ${tParts.join(' · ')} →`)
    }
    if (lines.length) {
      this.front.showRewards(title, lines)
      this.front.setCurrencies(economy.coins, economy.diamonds, economy.prisms)
    }
  }
}
