import Phaser from 'phaser'
import { BootScene } from './scenes/BootScene'
import { MenuScene } from './scenes/MenuScene'
import { MapScene } from './scenes/MapScene'
import { BattleScene } from './scenes/BattleScene'
import { WorkshopScene } from './scenes/WorkshopScene'
import { ShopScene } from './scenes/ShopScene'
import { HeroesScene } from './scenes/HeroesScene'
import { DailyScene } from './scenes/DailyScene'
import { showOdinSplash } from './ui/OdinSplash'
import { markSplashDone } from './ui/bootGate'
import { music } from './ui/music'
import { readLaunchParams } from './game/seedcode'

// The Odin Platforms boot splash goes up first (a DOM overlay above the canvas)
// and is gated behind a tap so the thunderclap is allowed to play. Phaser boots
// and preloads assets underneath it; BootScene waits on both before the menu.
// GROWTH DEEP-LINKS skip it entirely: ?attract=1 must run hands-free (headless
// trailer capture), and ?seed=/?demo= links promise <5s to interactive.
const launch = readLaunchParams()
if (launch.attract || launch.demo || launch.seed !== null) markSplashDone()
else showOdinSplash({ gate: true, onDone: markSplashDone })

// The same "TAP TO ENTER" gesture unlocks music playback; scenes then declare
// the theme they want (menu/map vs battle) and the mixer crossfades.
music.init()

// Portrait, mobile-first. FIT scaling letterboxes cleanly on any phone/desktop.
const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#0a0716',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 720,
    height: 1280,
  },
  render: { antialias: true, pixelArt: false },
  scene: [BootScene, MenuScene, MapScene, BattleScene, WorkshopScene, ShopScene, HeroesScene, DailyScene],
}

new Phaser.Game(config)
