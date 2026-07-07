// HeroesScene — thin Phaser wrapper that mounts the HTML/CSS hero CARD collection
// (HeroCollection) as a full-window DOM overlay and disposes it on exit. All the
// progression/loadout logic lives in economy + the DOM UI; this scene only owns
// the mount/teardown lifecycle (mirrors how BattleScene owns BattleHud).

import Phaser from 'phaser'
import { HeroCollection } from '../ui/HeroCollection'

export class HeroesScene extends Phaser.Scene {
  private ui?: HeroCollection

  constructor() {
    super('Heroes')
  }

  create(): void {
    this.ui = new HeroCollection(() => this.goBack())
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown())
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.teardown())
  }

  private goBack(): void {
    this.scene.start('Menu')
  }

  private teardown(): void {
    this.ui?.dispose()
    this.ui = undefined
  }
}
