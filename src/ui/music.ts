// Music — the looping themes (Kevin MacLeod, CC BY 4.0; credited in Settings)
// PLUS a synthesized ADAPTIVE bed that layers up with combat. The streamed
// tracks now run THROUGH the shared WebAudio graph (a MediaElementAudioSource
// per <audio> → musicDuck bus) so the bed can sidechain-duck under combat and
// breathe with the greying — it MIXES with the battle instead of piling on top.
//
// Layering (task #1) without shipping new stems: the mp3 is the melodic bed;
// a per-realm synth TENSION layer (drone + heartbeat) fades in as waves/bosses
// escalate and resolves on clear. Boss reveal swaps in a darker, faster pulse;
// redemption resolves it. All synth = zero payload, lazy, deterministic.
//
// Browsers block audio until a user gesture, so init() arms a one-shot
// pointerdown hook that also resumes the SHARED context (unlockAudio) inside the
// gesture — otherwise routed elements play silently.

import { appSettings } from './settings'
import { audioContext, musicBusInput, unlockAudio } from './sfx'

export type MusicTrack = 'map' | 'battle'

const SRC: Record<MusicTrack, string> = {
  map: import.meta.env.BASE_URL + 'audio/map-theme-sneaky-adventure.mp3',
  battle: import.meta.env.BASE_URL + 'audio/heroic-age.mp3',
}
const TRACKS = Object.keys(SRC) as MusicTrack[]
// Per-track gain (battle sits a touch under so the SFX/bed have headroom).
const GAIN: Record<MusicTrack, number> = { map: 1, battle: 0.82 }
const FADE_MS = 1100

// Per-realm musical colour for the tension bed — a low root the drone tunes to,
// so each realm's combat feels distinct even sharing the streamed theme.
const REALM_ROOT: Record<string, number> = {
  emberwaste: 61.74, // B1 — hot, low
  frostreach: 65.41, // C2
  stormpeaks: 73.42, // D2
  verdant: 69.3, // C#2
  lumen: 82.41, // E2 — brighter
  hollow: 55.0, // A1 — deepest, darkest
}

class Music {
  private els = new Map<MusicTrack, HTMLAudioElement>()
  private srcNodes = new Map<MusicTrack, MediaElementAudioSourceNode>()
  private want: MusicTrack | null = null
  private unlocked = false
  private fadeTimer = 0

  // --- adaptive tension bed (synth) ---
  private bedRoot = REALM_ROOT.frostreach
  private intensity = 0 // 0 calm build → 1 peak combat
  private boss = false
  private drone: { g: GainNode; oscs: OscillatorNode[]; lp: BiquadFilterNode } | null = null
  private heartTimer = 0
  private heartPhase = 0

  /** Call once from main.ts. The first tap anywhere unlocks playback. */
  init(): void {
    const onFirst = () => {
      window.removeEventListener('pointerdown', onFirst, true)
      unlockAudio() // resume the SHARED ctx in-gesture so routed elements are audible
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

  /** Pick the realm's musical colour for the tension bed. Safe any time. */
  setRealm(realmId: string | undefined): void {
    this.bedRoot = (realmId && REALM_ROOT[realmId]) || REALM_ROOT.frostreach
    this.retuneDrone()
  }

  /** Combat intensity 0..1 — the adaptive bed layers up as this rises. */
  setIntensity(v: number): void {
    this.intensity = Math.min(1, Math.max(0, v))
    this.applyBed()
  }

  /** A Keeper/Titan is on the field — darker, faster musical moment. */
  setBoss(on: boolean): void {
    if (this.boss === on) return
    this.boss = on
    this.retuneDrone()
    this.applyBed()
  }

  /** Re-read settings (music toggle / volume) and ease to the new levels. */
  refresh(fadeMs = 250): void {
    if (this.unlocked) this.apply(fadeMs)
    this.applyBed()
  }

  private el(track: MusicTrack): HTMLAudioElement {
    let a = this.els.get(track)
    if (!a) {
      a = new Audio(SRC[track])
      a.loop = true
      // preload='none' until a track is actually wanted: the menu must NOT eager-
      // fetch the 3.9 MB battle theme (that download, cancelled when we prime+pause
      // it for Safari, is the ERR_ABORTED noise). apply() bumps the wanted track to
      // 'auto' so it still buffers ahead for a seamless loop.
      a.preload = 'none'
      a.crossOrigin = 'anonymous'
      a.volume = 0
      this.els.set(track, a)
      // Route the element THROUGH the graph (once per element — a second
      // createMediaElementSource on the same node throws). If WebAudio is
      // unavailable the element still plays straight to the device.
      const bus = musicBusInput()
      const ac = audioContext()
      if (bus && ac && !this.srcNodes.has(track)) {
        try {
          const node = ac.createMediaElementSource(a)
          node.connect(bus)
          this.srcNodes.set(track, node)
        } catch {
          // already routed / unsupported — fall back to direct playback
        }
      }
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
      if (t === this.want && appSettings.data.music) continue // apply() starts it in-gesture
      // LAZY BATTLE BED: do NOT prime a not-yet-wanted track on the menu/first
      // paint — priming calls play(), which fetches the file (the 3.9 MB battle
      // theme). It stays untouched (preload='none') until a scene first calls
      // setTrack('battle'), where apply() plays it (that transition follows a tap,
      // and the shared audio context is already unlocked, so it still sounds).
      if (!this.els.has(t)) continue
      const a = this.el(t)
      a.muted = true
      void a
        .play()
        .then(() => {
          // pause WITHOUT seeking: a currentTime reset mid-fetch is what cancels the
          // in-flight request (ERR_ABORTED). The element is at ~0 already; leave it.
          a.pause()
          a.muted = false
        })
        .catch(() => {
          a.muted = false
        })
    }
    this.buildDrone()
    this.apply(FADE_MS)
  }

  private target(track: MusicTrack): number {
    // musicVol lives on the musicMaster node now — keep the per-element crossfade
    // in raw track gain so we don't square the slider.
    const on = appSettings.data.music && this.want === track
    return on ? GAIN[track] : 0
  }

  private apply(fadeMs: number): void {
    const want = this.want
    if (want && appSettings.data.music) {
      const a = this.el(want)
      if (a.preload !== 'auto') a.preload = 'auto' // buffer the wanted theme ahead for a seamless loop
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

  // ---- adaptive synth bed --------------------------------------------------
  // A persistent detuned drone whose gain + brightness track combat intensity,
  // plus a heartbeat pulse scheduled from stepBed(). Built once on unlock.
  private buildDrone(): void {
    if (this.drone) return
    const bus = musicBusInput()
    const ac = audioContext()
    if (!bus || !ac) return
    const g = ac.createGain()
    g.gain.value = 0
    const lp = ac.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 400
    lp.Q.value = 0.7
    lp.connect(g)
    g.connect(bus)
    const oscs: OscillatorNode[] = []
    for (const detune of [-6, 6, 0]) {
      const o = ac.createOscillator()
      o.type = detune === 0 ? 'sine' : 'sawtooth'
      o.frequency.value = this.bedRoot
      o.detune.value = detune
      o.connect(lp)
      o.start()
      oscs.push(o)
    }
    this.drone = { g, oscs, lp }
    this.retuneDrone()
    this.applyBed()
  }

  private retuneDrone(): void {
    const d = this.drone
    const ac = audioContext()
    if (!d || !ac) return
    const now = ac.currentTime
    // boss adds a dissonant fifth-below shadow; combat rides the realm root.
    d.oscs[0].frequency.setTargetAtTime(this.bedRoot, now, 0.3)
    d.oscs[1].frequency.setTargetAtTime(this.bedRoot * (this.boss ? 1.5 : 1.002), now, 0.3)
    d.oscs[2].frequency.setTargetAtTime(this.boss ? this.bedRoot * 0.749 : this.bedRoot * 2, now, 0.3)
  }

  private applyBed(): void {
    const d = this.drone
    const ac = audioContext()
    if (!d || !ac) return
    const on = appSettings.data.music
    const base = this.boss ? 0.14 : 0.08
    // silent outside combat (intensity ~0 on map/menu) so the bed is a BATTLE layer
    const level = on && this.intensity > 0.01 ? base * (0.15 + 0.85 * this.intensity) : 0
    d.g.gain.setTargetAtTime(level, ac.currentTime, 0.4)
    d.lp.frequency.setTargetAtTime(300 + 1400 * this.intensity + (this.boss ? 300 : 0), ac.currentTime, 0.4)
  }

  /** Called each battle frame: schedules the heartbeat pulse under high intensity. */
  stepBed(dt: number): void {
    if (!this.drone || !appSettings.data.music) return
    const drive = this.intensity + (this.boss ? 0.35 : 0)
    if (drive < 0.35) return
    this.heartTimer -= dt
    if (this.heartTimer <= 0) {
      const period = this.boss ? 0.5 : 0.62 - 0.18 * this.intensity
      this.heartTimer = period
      this.heartPhase ^= 1
      this.heart(this.heartPhase === 0 ? 1 : 0.7)
    }
  }

  private heart(accent: number): void {
    const bus = musicBusInput()
    const ac = audioContext()
    if (!bus || !ac) return
    const t0 = ac.currentTime + 0.01
    const o = ac.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(this.bedRoot * 1.5, t0)
    o.frequency.exponentialRampToValueAtTime(this.bedRoot * 0.75, t0 + 0.16)
    const g = ac.createGain()
    const peak = (this.boss ? 0.09 : 0.055) * accent * (0.4 + 0.6 * this.intensity)
    g.gain.setValueAtTime(0, t0)
    g.gain.linearRampToValueAtTime(peak, t0 + 0.015)
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.2)
    o.connect(g)
    g.connect(bus)
    o.start(t0)
    o.stop(t0 + 0.24)
  }
}

export const music = new Music()
