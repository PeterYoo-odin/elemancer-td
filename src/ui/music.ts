// Music — the looping adventure themes (Kevin MacLeod, CC BY 4.0; credited in
// Settings) behind a tiny crossfade mixer. Uses HTMLAudio so the long tracks
// stream instead of being decoded up front; sfx.ts keeps owning the short
// synthesized cues.
//
// Browsers block audio until a user gesture, so init() arms a one-shot
// pointerdown hook (the Odin splash "TAP TO ENTER" is the first tap) that
// primes every track inside the gesture — after that, scenes just declare the
// theme they want via setTrack() and the mixer crossfades.

import { appSettings } from './settings'

export type MusicTrack = 'map' | 'battle'

const SRC: Record<MusicTrack, string> = {
  map: import.meta.env.BASE_URL + 'audio/map-theme-sneaky-adventure.mp3',
  battle: import.meta.env.BASE_URL + 'audio/heroic-age.mp3',
}
const TRACKS = Object.keys(SRC) as MusicTrack[]
// Per-track gain under the user's music volume (battle sits under SFX).
const GAIN: Record<MusicTrack, number> = { map: 1, battle: 0.8 }
const FADE_MS = 1100

class Music {
  private els = new Map<MusicTrack, HTMLAudioElement>()
  private want: MusicTrack | null = null
  private unlocked = false
  private fadeTimer = 0

  /** Call once from main.ts. The first tap anywhere unlocks playback. */
  init(): void {
    const onFirst = () => {
      window.removeEventListener('pointerdown', onFirst, true)
      this.unlock()
    }
    window.addEventListener('pointerdown', onFirst, true)
  }

  /** Which theme should be playing. Scenes call this on create(); idempotent. */
  setTrack(track: MusicTrack | null): void {
    if (this.want === track) return
    this.want = track
    if (this.unlocked) this.apply(FADE_MS)
  }

  /** Re-read settings (music toggle / volume) and ease to the new levels. */
  refresh(fadeMs = 250): void {
    if (this.unlocked) this.apply(fadeMs)
  }

  private el(track: MusicTrack): HTMLAudioElement {
    let a = this.els.get(track)
    if (!a) {
      a = new Audio(SRC[track])
      a.loop = true
      a.preload = 'auto'
      a.volume = 0
      this.els.set(track, a)
    }
    return a
  }

  // Runs inside the first user gesture. Safari requires each element's FIRST
  // play() to happen in a gesture, so prime the tracks we aren't about to
  // start for real (muted play → pause), then fade in the wanted one.
  private unlock(): void {
    if (this.unlocked) return
    this.unlocked = true
    for (const t of TRACKS) {
      const a = this.el(t)
      if (t === this.want && appSettings.data.music) continue // apply() starts it in-gesture
      a.muted = true
      void a
        .play()
        .then(() => {
          a.pause()
          a.currentTime = 0
          a.muted = false
        })
        .catch(() => {
          a.muted = false
        })
    }
    this.apply(FADE_MS)
  }

  private target(track: MusicTrack): number {
    const on = appSettings.data.music && this.want === track
    return on ? GAIN[track] * appSettings.data.musicVol : 0
  }

  private apply(fadeMs: number): void {
    const want = this.want
    if (want && appSettings.data.music) {
      const a = this.el(want)
      if (a.paused) void a.play().catch(() => {})
    }
    window.clearInterval(this.fadeTimer)
    const from = new Map<MusicTrack, number>()
    for (const [t, a] of this.els) from.set(t, a.volume)
    const start = performance.now()
    this.fadeTimer = window.setInterval(() => {
      const f = Math.min(1, (performance.now() - start) / Math.max(1, fadeMs))
      for (const [t, a] of this.els) {
        const to = this.target(t)
        const v = (from.get(t) ?? 0) + (to - (from.get(t) ?? 0)) * f
        a.volume = Math.min(1, Math.max(0, v))
        if (f >= 1 && to === 0 && !a.paused) a.pause()
      }
      if (f >= 1) window.clearInterval(this.fadeTimer)
    }, 50)
  }
}

export const music = new Music()
