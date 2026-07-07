import Phaser from 'phaser'
import { BootScene } from './scenes/BootScene'
import { MenuScene } from './scenes/MenuScene'
import { MapScene } from './scenes/MapScene'
import { BattleScene } from './scenes/BattleScene'
import { WorkshopScene } from './scenes/WorkshopScene'
import { ShopScene } from './scenes/ShopScene'
import { HeroesScene } from './scenes/HeroesScene'

// Portrait, mobile-first. FIT scaling letterboxes cleanly on any phone/desktop.
const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#1a1030',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 720,
    height: 1280,
  },
  render: { antialias: true, pixelArt: false },
  scene: [BootScene, MenuScene, MapScene, BattleScene, WorkshopScene, ShopScene, HeroesScene],
}

new Phaser.Game(config)
