import Phaser from 'phaser'
import { DailySeedPage } from '../ui/DailySeedPage'
import { music } from '../ui/music'

// DailyScene — thin Phaser wrapper mounting the HTML/CSS Daily Seed overlay
// (DailySeedPage). Owns only the mount/teardown lifecycle and routes "Play
// today's seed" into a seeded endless run flagged `daily` (so BattleScene logs
// the result to the local per-day history). Mirrors ShopScene / HeroesScene.
export class DailyScene extends Phaser.Scene {
  private page: DailySeedPage | null = null

  constructor() {
    super('Daily')
  }

  create(): void {
    const { width, height } = this.scale
    this.add.rectangle(width / 2, height / 2, width, height, 0x0a0716)
    music.setTrack('map')

    this.page = new DailySeedPage({
      onBack: () => this.scene.start('Menu'),
      onPlay: (seed) => this.scene.start('Battle', { endless: true, seedOverride: seed, daily: true }),
    })

    this.events.once('shutdown', () => {
      this.page?.destroy()
      this.page = null
    })
  }
}
