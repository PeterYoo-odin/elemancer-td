// On-demand loader for the heavy Three.js battle view.
//
// The entire BattleScene module — Three.js (~600 KB), the WebGL renderer, the
// realm atmosphere/board-life, and every battle-only game system — is split into
// a lazy chunk behind a dynamic import(). It is NOT registered with Phaser at
// boot; the title + menu path never downloads it. This module fetches that chunk
// the first time the player enters a run (showing the branded loader while it
// streams), registers the scene, preloads the 3D kit, then starts the battle.
//
// A background idle-prefetch keeps offline play + instant first-battle intact:
// once the menu is idle we warm the same chunk so the service worker caches it.

import type Phaser from 'phaser'
import type { BattleLaunchData } from '../scenes/BattleScene'
import { showBrandLoader, setBrandLoaderProgress, hideBrandLoader } from './brandLoader'

// Memoized so the chunk fetch + scene registration + kit preload happen exactly
// once, no matter how many entry points race to enter a battle.
let ready: Promise<void> | null = null

function ensureBattle(game: Phaser.Game, onProgress?: (frac: number) => void): Promise<void> {
  ready ??= (async () => {
    const [{ BattleScene }, { models }] = await Promise.all([
      import('../scenes/BattleScene'),
      import('../three/models'),
    ])
    // Register the scene with Phaser once (autoStart = false).
    if (!game.scene.getScene('Battle')) game.scene.add('Battle', BattleScene, false)
    // Preload the shared 3D kit before the first board builds (BootScene used to
    // do this on the critical path; it is now part of the on-demand battle load).
    await models.load(onProgress).catch(() => undefined)
  })()
  return ready
}

/**
 * Enter a battle from any scene. Lazily loads + registers the battle chunk (with
 * the branded loader covering the fetch), then hands control to BattleScene.
 * BattleScene tears the loader down itself once its first frame has painted.
 */
export function launchBattle(from: Phaser.Scene, data: BattleLaunchData): void {
  showBrandLoader()
  ensureBattle(from.game, (frac) => setBrandLoaderProgress(frac))
    .then(() => { from.scene.start('Battle', data) })
    .catch(() => {
      // A failed chunk/asset load must never trap the player on the loader.
      hideBrandLoader()
    })
}

/**
 * Warm the battle chunk + 3D kit in the background once the menu is idle. Keeps
 * the installable/offline experience whole (the SW caches the chunk after this
 * runs) and makes the first real battle-entry feel instant. No-op if already
 * loaded; never blocks and never shows UI.
 */
export function prefetchBattle(game: Phaser.Game): void {
  const warm = () => { void ensureBattle(game) }
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void })
    .requestIdleCallback
  if (typeof ric === 'function') ric(warm, { timeout: 4000 })
  else window.setTimeout(warm, 1500)
}
