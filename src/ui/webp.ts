// WEBP-FIRST ART URLS — the battle's painted art ships BOTH ways: the original
// PNGs (kept for fallback) and WebP siblings at ~93% smaller (q88, dims + real
// alpha verified identical at conversion). First battle entry used to pull
// 5–10 MB of PNG; the same art in WebP is a few hundred KB.
//
// Two safety nets, so the silent-fallback trap can't bite:
//   1. artUrl() only swaps the extension when the BROWSER decodes WebP
//      (checked once, synchronously, via canvas.toDataURL).
//   2. Every load site keeps an onerror fallback to the original .png, so a
//      missing/corrupt .webp on the server can never blank an asset.

import { qa } from '../game/qa'

/** An art asset fell through to its LAST fallback rung. Fail LOUD (warn once
 *  per asset + a QA telemetry event) so a deploy that drops a file — or a
 *  regression that greys something out via fail-soft — can never read as
 *  success. The render-side fallbacks themselves stay graceful and NON-grey. */
const missed = new Set<string>()
export function artMiss(what: string, url: string): void {
  if (missed.has(url)) return
  missed.add(url)
  console.warn(`[chromancer:art] ${what} failed to load — using fallback:`, url)
  if (qa.enabled) qa.emit('asset', { what, url })
}

/** The POSITIVE counterpart of artMiss: a painted asset genuinely decoded and
 *  is BOUND to its material/billboard. Emitted once per asset so a QA run can
 *  assert the NEW art actually loaded — closing the silent-fallback trap from
 *  the other side (a 404 that fails soft to older art can no longer read as
 *  success, because the expected 'asset-bound' event never fires). */
const boundSeen = new Set<string>()
export function artBound(what: string, id: string): void {
  const key = what + ':' + id
  if (boundSeen.has(key)) return
  boundSeen.add(key)
  if (qa.enabled) qa.emit('asset-bound', { what, id })
}

let ok: boolean | null = null

/** True when this browser can decode WebP (evaluated once). */
export function webpOk(): boolean {
  if (ok !== null) return ok
  try {
    ok = document.createElement('canvas').toDataURL('image/webp').startsWith('data:image/webp')
  } catch {
    ok = false
  }
  return ok
}

/** Prefer the .webp sibling of a .png art URL (no-op for other extensions or
 *  non-WebP browsers). Callers keep their .png fallback on load error. */
export function artUrl(pngUrl: string): string {
  return webpOk() && pngUrl.endsWith('.png') ? pngUrl.slice(0, -4) + '.webp' : pngUrl
}
