// Coordinates the DOM boot splash (created in main.ts, before Phaser) with the
// Phaser BootScene: the game only advances past Boot once the splash has
// finished AND the 3D assets are loaded.

let resolve: () => void = () => {}

export const splashDone: Promise<void> = new Promise<void>((r) => {
  resolve = r
})

export function markSplashDone(): void {
  resolve()
}
