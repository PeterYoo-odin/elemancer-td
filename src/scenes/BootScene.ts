import Phaser from 'phaser'
import { splashDone } from '../ui/bootGate'
import { readLaunchParams, codeToSeed } from '../game/seedcode'
import { levelById } from '../game/levels'
import { launchBattle } from '../ui/battleLoader'
import type { BattleLaunchData } from './BattleScene'

/**
 * BootScene — the gate behind the Odin Platforms splash (a DOM overlay created
 * in main.ts). The heavy 3D kit no longer loads here: it is code-split into the
 * battle chunk and streamed on demand (see battleLoader.ts), so the menu path is
 * lean. Boot now simply waits for the splash, then routes. Its own visuals only
 * show in the rare case loading outlasts the splash: a minimal dark screen.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot')
  }

  create(): void {
    const { width, height } = this.scale

    this.add.rectangle(width / 2, height / 2, width, height, 0x0a0716)

    const label = this.add
      .text(width / 2, height * 0.55, 'SUMMONING ELEMENTS', {
        fontFamily: 'system-ui, Arial, sans-serif',
        fontSize: '22px',
        color: '#8f7fc0',
      })
      .setOrigin(0.5)
      .setLetterSpacing(6)
      .setAlpha(0)
    this.tweens.add({ targets: label, alpha: 0.9, duration: 600, delay: 300 })

    // The splash fades itself out over the top of this scene; by the time it's
    // gone we go straight to Menu — unless a growth deep-link (?attract / ?demo
    // / ?seed) routes into a run, in which case the battle chunk streams on
    // demand behind the branded loader.
    void splashDone.then(() => {
      if (!this.scene.isActive('Boot')) return
      // ?pathforge=CODE → the Pathforge build page seeded to that shared puzzle.
      const pfSeed = pathforgeDeepLink()
      if (pfSeed !== null) { this.scene.start('Pathforge', { seed: pfSeed }); return }
      const route = deepLinkRoute()
      if (route) launchBattle(this, route)
      else this.scene.start('Menu')
    })
  }
}

// ?attract=1 → hands-free cinematic reel (trailer source / landing hero / demo).
// ?demo=1 or ?lv=demo → the Ember Vale demo, live, as guest.
// ?seed=CODE [&lv=..] → that exact seeded run: campaign level, demo, or endless.
function deepLinkRoute(): BattleLaunchData | null {
  const p = readLaunchParams()
  const common = {
    seedOverride: p.seed ?? undefined,
    speed: p.speed,
    captions: p.captions,
    loop: p.loop,
  }
  if (p.attract) return { ...common, attract: true, demo: true }
  if (p.demo) return { ...common, demo: true }
  // ?rogue=1 → THIS WEEK'S roguelike run. The week (seed + mutator + event) is
  // derived from the wall clock, so a shared link opens the identical weekly board
  // for anyone who clicks it during the same week — the fair "challenge a friend".
  if (new URLSearchParams(window.location.search).get('rogue')) return { roguelike: true }
  if (p.seed !== null) {
    if (p.levelId && levelById(p.levelId)) return { ...common, levelId: p.levelId }
    return { ...common, endless: true }
  }
  return null
}

// ?pathforge=CODE → the shared seed to open the Pathforge build page on. Returns the
// resolved seed, or null when the param is absent/malformed (plain launch).
function pathforgeDeepLink(): number | null {
  try {
    const code = new URLSearchParams(window.location.search).get('pathforge')
    if (!code) return null
    return codeToSeed(code)
  } catch {
    return null
  }
}
