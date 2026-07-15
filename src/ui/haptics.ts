// HAPTICS — thin, feature-detected wrapper over navigator.vibrate. View-only and
// never touches the sim, so it can't affect deterministic replay/simcheck.
//
// Gated three ways so it only ever fires where it's welcome:
//   1. the player's `haptics` setting (SettingsPanel toggle, default on),
//   2. an actual vibrate-capable navigator (desktop Chrome exposes a no-op; iOS
//      Safari has none — feature-detect both),
//   3. a COARSE pointer (touch) — we never buzz a mouse/desktop session.
// Callers pass a short pattern in milliseconds (a single number or an array).

import { appSettings } from './settings'
import { qa } from '../game/qa'

// Resolved once: is this a touch device with a real vibrate API? matchMedia is
// read lazily so SSR/test contexts without `window` don't throw at import time.
let supported: boolean | null = null
function canVibrate(): boolean {
  if (supported !== null) return supported
  const nav = typeof navigator !== 'undefined' ? navigator : undefined
  const hasApi = !!nav && typeof nav.vibrate === 'function'
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
  supported = hasApi && coarse
  return supported
}

/** Fire a haptic pattern (ms) if enabled + supported. Silently no-ops otherwise. */
export function haptic(pattern: number | number[]): void {
  if (!appSettings.data.haptics) return
  if (!canVibrate()) return
  try {
    // device-session knob (?qa=1 overlay): scale the pattern's durations; neutral in prod
    if (qa.enabled && qa.juice.hapticMul !== 1) {
      const m = qa.juice.hapticMul
      pattern = Array.isArray(pattern) ? pattern.map((v) => Math.round(v * m)) : Math.round(pattern * m)
    }
    navigator.vibrate(pattern)
  } catch {
    // some embedded webviews throw on unusual patterns — never let juice crash play
  }
}

// Named beats so call sites read as intent, not magic numbers. (Not `as const` —
// vibrate() wants a mutable number[], and a readonly tuple won't assign.)
export const HAPTIC: { place: number; reaction: number; bossKill: number[] } = {
  place: 10, // tower committed to the board — a light confirming tick
  reaction: 20, // an elemental reaction detonates — a sharper single bump
  bossKill: [12, 40, 14, 40, 22], // boss/keeper falls — a celebratory triple pulse
}
