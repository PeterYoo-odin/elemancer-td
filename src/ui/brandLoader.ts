// Branded cold-load screen controller — the Chromancer wordmark + color-vs-grey
// "painting" sweep that is the game's FIRST paint (markup + CSS live inline in
// index.html so they render before any JS arrives). This module only tears it
// down when a real screen is ready, and re-raises it for the on-demand battle
// chunk fetch, so the player never sees a blank frame during a lazy load.
//
// Pure DOM, no Phaser: safe to call from anywhere (scenes, main, the loader).

const ID = 'chromancer-boot'

// The inline markup is duplicated here ONLY so we can rebuild the overlay after
// it has been removed (e.g. menu → battle navigation). The CSS that styles it
// lives permanently in index.html's <style>, so a rebuilt node styles itself.
const MARKUP =
  '<div class="cb-mark">CHROMANCER</div>' +
  '<div class="cb-tag">Paint the world back</div>' +
  '<div class="cb-track"><div class="cb-fill"></div></div>'

let hideTimer: number | undefined

function node(): HTMLElement | null {
  return document.getElementById(ID)
}

/** Ensure the branded loader is visible (rebuilds it if it was torn down). */
export function showBrandLoader(): void {
  if (hideTimer !== undefined) { window.clearTimeout(hideTimer); hideTimer = undefined }
  let n = node()
  if (!n) {
    n = document.createElement('div')
    n.id = ID
    n.setAttribute('role', 'status')
    n.setAttribute('aria-label', 'Loading Chromancer')
    n.innerHTML = MARKUP
    document.body.appendChild(n)
  }
  n.classList.remove('cb-leave')
  // reset to the indeterminate shimmer for the next load
  const fill = n.querySelector<HTMLElement>('.cb-fill')
  if (fill) { fill.classList.remove('cb-determinate'); fill.style.width = '' }
}

/**
 * Drive the loader bar with a real 0..1 fraction (used while the battle chunk's
 * 3D kit streams in). Switches the bar from its indeterminate shimmer to a
 * determinate fill.
 */
export function setBrandLoaderProgress(frac: number): void {
  const fill = node()?.querySelector<HTMLElement>('.cb-fill')
  if (!fill) return
  fill.classList.add('cb-determinate')
  fill.style.width = Math.max(6, Math.min(100, frac * 100)) + '%'
}

/** Fade the branded loader out and remove it. Idempotent. */
export function hideBrandLoader(): void {
  const n = node()
  if (!n || n.classList.contains('cb-leave')) return
  n.classList.add('cb-leave')
  hideTimer = window.setTimeout(() => { n.remove(); hideTimer = undefined }, 500)
}
