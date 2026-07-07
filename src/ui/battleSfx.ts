// battleSfx — the BATTLE AUDIO LAYER. Every meaningful action gets a voice:
// per-element shots, hit thocks, combo-pitched kill pops, boss booms, shield
// cracks, coin arpeggios, reaction slams, the fusion forge, wave horns, leak
// alarms, spell whooshes and the victory colour-bloom swell.
//
// Design rules (kept sacred so 60 events/second stays MUSIC, not noise):
//  · 100% synthesized WebAudio — zero assets, works offline, ~nothing to load.
//  · Everything flows through ONE master gain → compressor, so simultaneous
//    bursts glue together and duck each other instead of clipping.
//  · Per-category rate gates: shots/hits/kills are throttled, celebrations are
//    not. A swarm sounds like a busy battle, never like a fire alarm.
//  · Pitch carries information: kill pops climb a semitone ladder with the
//    combo counter (Balatro), coins arpeggiate upward, leaks sag downward.
//  · Respects appSettings.sound; silent when the tab is hidden.

import { appSettings } from './settings'
import { audioContext, sfxOut } from './sfx'

let master: GainNode | null = null
let noiseBuf: AudioBuffer | null = null

function chain(): { ac: AudioContext; out: GainNode } | null {
  if (!appSettings.data.sound) return null
  if (typeof document !== 'undefined' && document.hidden) return null
  const ac = audioContext()
  if (!ac) return null
  if (!master) {
    const comp = ac.createDynamicsCompressor()
    comp.threshold.value = -16
    comp.knee.value = 20
    comp.ratio.value = 5
    comp.attack.value = 0.004
    comp.release.value = 0.16
    comp.connect(sfxOut(ac))
    master = ac.createGain()
    master.gain.value = 0.82
    master.connect(comp)
  }
  return { ac, out: master }
}

function noise(ac: AudioContext): AudioBuffer {
  if (!noiseBuf || noiseBuf.sampleRate !== ac.sampleRate) {
    noiseBuf = ac.createBuffer(1, Math.ceil(ac.sampleRate * 1.2), ac.sampleRate)
    const d = noiseBuf.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  }
  return noiseBuf
}

// ---- rate gates -------------------------------------------------------------
const lastAt = new Map<string, number>()
function gate(key: string, minMs: number): boolean {
  const t = performance.now()
  if (t - (lastAt.get(key) ?? -1e9) < minMs) return false
  lastAt.set(key, t)
  return true
}

// ---- tiny voice builders ----------------------------------------------------
// One-shot oscillator: type, frequency glide f0→f1 over dur, gain envelope.
function blip(
  ac: AudioContext, out: AudioNode, type: OscillatorType,
  f0: number, f1: number, dur: number, peak: number, at = 0, attack = 0.006,
): void {
  const t0 = ac.currentTime + 0.005 + at
  const o = ac.createOscillator()
  o.type = type
  o.frequency.setValueAtTime(Math.max(20, f0), t0)
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur)
  const g = ac.createGain()
  g.gain.setValueAtTime(0, t0)
  g.gain.linearRampToValueAtTime(peak, t0 + attack)
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur)
  o.connect(g)
  g.connect(out)
  o.start(t0)
  o.stop(t0 + dur + 0.03)
}

// One-shot filtered noise burst: filter sweep f0→f1, gain envelope.
function hiss(
  ac: AudioContext, out: AudioNode, kind: BiquadFilterType,
  f0: number, f1: number, dur: number, peak: number, at = 0, q = 1,
): void {
  const t0 = ac.currentTime + 0.005 + at
  const n = ac.createBufferSource()
  n.buffer = noise(ac)
  n.loop = true
  const f = ac.createBiquadFilter()
  f.type = kind
  f.Q.value = q
  f.frequency.setValueAtTime(Math.max(30, f0), t0)
  f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t0 + dur)
  const g = ac.createGain()
  g.gain.setValueAtTime(0, t0)
  g.gain.linearRampToValueAtTime(peak, t0 + 0.008)
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur)
  n.connect(f)
  f.connect(g)
  g.connect(out)
  n.start(t0)
  n.stop(t0 + dur + 0.03)
}

// small human variation so repeated one-shots never machine-gun
function vary(hz: number, cents = 40): number {
  return hz * Math.pow(2, ((Math.random() * 2 - 1) * cents) / 1200)
}

// ==============================================================================
//  PUBLIC VOICES
// ==============================================================================
export const battleSfx = {
  /** Tower muzzle, voiced by element. Globally throttled — swarm-fire stays musical. */
  shot(kind: string): void {
    if (!gate('shot', 65)) return
    const c = chain()
    if (!c) return
    const { ac, out } = c
    switch (kind) {
      case 'flame':
        blip(ac, out, 'square', vary(170), 80, 0.11, 0.05)
        hiss(ac, out, 'lowpass', 1400, 300, 0.09, 0.05)
        break
      case 'frost':
        blip(ac, out, 'sine', vary(1250), 820, 0.09, 0.055)
        break
      case 'storm':
        blip(ac, out, 'sawtooth', vary(760), 140, 0.07, 0.045)
        hiss(ac, out, 'highpass', 2400, 3600, 0.04, 0.03)
        break
      case 'arcane':
        blip(ac, out, 'triangle', vary(500), 690, 0.1, 0.05)
        break
      case 'hero':
        blip(ac, out, 'sine', vary(660), 880, 0.08, 0.04)
        break
      default: // cannon
        blip(ac, out, 'square', vary(115), 55, 0.12, 0.07)
        hiss(ac, out, 'lowpass', 700, 160, 0.1, 0.06)
    }
  },

  /** Projectile connect — a soft thock under the damage number. */
  hit(): void {
    if (!gate('hit', 85)) return
    const c = chain()
    if (!c) return
    blip(c.ac, c.out, 'triangle', vary(240), 150, 0.06, 0.05)
    hiss(c.ac, c.out, 'lowpass', 900, 280, 0.05, 0.04)
  },

  /** Kill pop. The pitch climbs a semitone ladder with the combo — you can HEAR a streak. */
  kill(combo: number, boss: boolean): void {
    const c = chain()
    if (!c) return
    const { ac, out } = c
    if (boss) {
      // the money boom: crack + falling body + sub drop (no gate — always lands)
      hiss(ac, out, 'highpass', 900, 500, 0.2, 0.3)
      hiss(ac, out, 'lowpass', 1500, 90, 0.7, 0.4)
      blip(ac, out, 'sine', 95, 34, 0.65, 0.4, 0, 0.012)
      blip(ac, out, 'triangle', 392, 196, 0.4, 0.12, 0.05)
      return
    }
    if (!gate('kill', 70)) return
    const base = 430 * Math.pow(2, Math.min(12, combo) / 12) // ladder caps 1 octave up
    blip(ac, out, 'triangle', base, base * 1.4, 0.11, 0.1)
    hiss(ac, out, 'highpass', 1800, 2600, 0.04, 0.045)
  },

  /** Shield shatter — glassy, brittle, unmistakable. */
  shieldBreak(): void {
    if (!gate('shield', 140)) return
    const c = chain()
    if (!c) return
    const { ac, out } = c
    blip(ac, out, 'sine', 2100, 1500, 0.14, 0.07)
    blip(ac, out, 'sine', 3150, 2300, 0.1, 0.05, 0.012)
    hiss(ac, out, 'highpass', 2600, 4200, 0.09, 0.09)
  },

  /** One flying coin arriving — index i climbs the arpeggio into the counter. */
  coin(i: number): void {
    if (!gate('coin', 36)) return
    const c = chain()
    if (!c) return
    const f = 940 * Math.pow(2, Math.min(10, i) * 2 / 12)
    blip(c.ac, c.out, 'sine', f, f * 1.5, 0.08, 0.065)
    blip(c.ac, c.out, 'sine', f * 2, f * 2.6, 0.05, 0.02)
  },

  /** ELEMENTAL REACTION slam — riser into a two-tone impact with shimmer. */
  reaction(): void {
    if (!gate('react', 240)) return
    const c = chain()
    if (!c) return
    const { ac, out } = c
    blip(ac, out, 'sawtooth', 220, 830, 0.1, 0.06) // riser
    blip(ac, out, 'triangle', 300, 110, 0.26, 0.16, 0.09, 0.008) // impact body
    hiss(ac, out, 'bandpass', 500, 180, 0.22, 0.16, 0.09, 1.4)
    blip(ac, out, 'sine', 1560, 2140, 0.3, 0.05, 0.11) // shimmer tail
  },

  /** FUSION FORGED — an anvil clang (off-harmonic partials) + a rising fifth. */
  fusion(): void {
    const c = chain()
    if (!c) return
    const { ac, out } = c
    hiss(ac, out, 'highpass', 1400, 2600, 0.08, 0.16)
    blip(ac, out, 'square', 224, 208, 0.5, 0.09, 0, 0.004)
    blip(ac, out, 'square', 337, 320, 0.42, 0.06, 0, 0.004)
    blip(ac, out, 'sine', 392, 392, 0.5, 0.1, 0.16)
    blip(ac, out, 'sine', 588, 588, 0.6, 0.1, 0.3)
  },

  /** Tower planted — a woody thunk with a dust breath. */
  place(): void {
    const c = chain()
    if (!c) return
    blip(c.ac, c.out, 'triangle', 170, 85, 0.1, 0.14, 0, 0.004)
    hiss(c.ac, c.out, 'lowpass', 600, 150, 0.12, 0.1)
  },

  /** Upgrade bought — a quick ascending three-note chime in the tower's honour. */
  upgrade(): void {
    const c = chain()
    if (!c) return
    const notes = [523.25, 659.25, 784]
    notes.forEach((hz, i) => blip(c.ac, c.out, 'triangle', hz, hz, 0.3, 0.09, i * 0.06))
  },

  /** Wave sent — a short horn swell; the charge begins. */
  waveStart(): void {
    if (!gate('waveStart', 600)) return
    const c = chain()
    if (!c) return
    const { ac, out } = c
    const t0 = ac.currentTime + 0.005
    for (const hz of [196, 294]) {
      const o = ac.createOscillator()
      o.type = 'sawtooth'
      o.frequency.value = hz
      const f = ac.createBiquadFilter()
      f.type = 'lowpass'
      f.frequency.setValueAtTime(500, t0)
      f.frequency.exponentialRampToValueAtTime(1600, t0 + 0.22)
      const g = ac.createGain()
      g.gain.setValueAtTime(0, t0)
      g.gain.linearRampToValueAtTime(0.07, t0 + 0.16)
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.62)
      o.connect(f)
      f.connect(g)
      g.connect(out)
      o.start(t0)
      o.stop(t0 + 0.7)
    }
  },

  /** Wave cleared — a small two-note resolve with sparkle. */
  waveClear(): void {
    if (!gate('waveClear', 600)) return
    const c = chain()
    if (!c) return
    blip(c.ac, c.out, 'sine', 587.33, 587.33, 0.35, 0.09)
    blip(c.ac, c.out, 'sine', 784, 784, 0.5, 0.1, 0.11)
    hiss(c.ac, c.out, 'bandpass', 2400, 5200, 0.4, 0.04, 0.1, 4)
  },

  /** Enemy leaked — a sagging alarm blat; a life just walked out. */
  leak(boss: boolean): void {
    if (!gate('leak', 220)) return
    const c = chain()
    if (!c) return
    blip(c.ac, c.out, 'square', boss ? 260 : 330, boss ? 110 : 175, 0.24, 0.11, 0, 0.008)
    blip(c.ac, c.out, 'sine', 120, 55, 0.22, 0.12, 0.02)
  },

  /** Spell / hero-spell cast — a whoosh; big casts add a ground thump. */
  spell(big: boolean): void {
    if (!gate('spell', 200)) return
    const c = chain()
    if (!c) return
    const { ac, out } = c
    const t0 = ac.currentTime + 0.005
    const n = ac.createBufferSource()
    n.buffer = noise(ac)
    n.loop = true
    const f = ac.createBiquadFilter()
    f.type = 'bandpass'
    f.Q.value = 1.6
    f.frequency.setValueAtTime(320, t0)
    f.frequency.exponentialRampToValueAtTime(2100, t0 + 0.2)
    f.frequency.exponentialRampToValueAtTime(400, t0 + 0.42)
    const g = ac.createGain()
    g.gain.setValueAtTime(0, t0)
    g.gain.linearRampToValueAtTime(0.16, t0 + 0.1)
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.48)
    n.connect(f)
    f.connect(g)
    g.connect(out)
    n.start(t0)
    n.stop(t0 + 0.55)
    if (big) {
      blip(ac, out, 'sine', 110, 42, 0.5, 0.24, 0.16, 0.01)
      hiss(ac, out, 'lowpass', 1100, 120, 0.4, 0.2, 0.16)
    }
  },

  /** Hero steps onto the field — a bright arrival flourish. */
  heroDeploy(): void {
    const c = chain()
    if (!c) return
    const notes = [392, 523.25, 659.25]
    notes.forEach((hz, i) => blip(c.ac, c.out, 'triangle', hz, hz, 0.28, 0.08, i * 0.055))
    hiss(c.ac, c.out, 'bandpass', 1800, 4200, 0.3, 0.05, 0, 3)
  },

  /** Combo milestone sting — pitched by the streak, quick double-tap. */
  combo(count: number): void {
    if (!gate('combo', 300)) return
    const c = chain()
    if (!c) return
    const f = 660 * Math.pow(2, Math.min(14, count) / 14)
    blip(c.ac, c.out, 'square', f, f, 0.09, 0.05)
    blip(c.ac, c.out, 'square', f * 1.335, f * 1.335, 0.16, 0.06, 0.07)
  },

  /** Draft power picked — a confident bright confirm. */
  draftPick(): void {
    const c = chain()
    if (!c) return
    blip(c.ac, c.out, 'triangle', 880, 1174.7, 0.22, 0.11)
    hiss(c.ac, c.out, 'bandpass', 2600, 5600, 0.28, 0.05, 0.04, 4)
  },

  /** VICTORY — the Colour Bloom's sound: a rising major swell + air shimmer. */
  victory(): void {
    const c = chain()
    if (!c) return
    const { ac, out } = c
    const notes = [523.25, 659.25, 784, 1046.5]
    notes.forEach((hz, i) => {
      blip(ac, out, 'triangle', hz, hz, 1.5, 0.085, i * 0.13, 0.02)
      blip(ac, out, 'sine', hz * 2, hz * 2, 1.1, 0.025, i * 0.13 + 0.05)
    })
    const t0 = ac.currentTime + 0.005
    const n = ac.createBufferSource()
    n.buffer = noise(ac)
    n.loop = true
    const f = ac.createBiquadFilter()
    f.type = 'bandpass'
    f.Q.value = 5
    f.frequency.setValueAtTime(1400, t0)
    f.frequency.exponentialRampToValueAtTime(6400, t0 + 1.4)
    const g = ac.createGain()
    g.gain.setValueAtTime(0, t0)
    g.gain.linearRampToValueAtTime(0.06, t0 + 0.6)
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 1.8)
    n.connect(f)
    f.connect(g)
    g.connect(out)
    n.start(t0)
    n.stop(t0 + 1.9)
  },

  /** DEFEAT — a sagging minor sigh; the grey wins this one. */
  defeat(): void {
    const c = chain()
    if (!c) return
    blip(c.ac, c.out, 'sine', 392, 392, 0.7, 0.09)
    blip(c.ac, c.out, 'sine', 311.13, 311.13, 1.1, 0.1, 0.32)
    blip(c.ac, c.out, 'sine', 155.56, 146.83, 1.4, 0.08, 0.32)
    hiss(c.ac, c.out, 'lowpass', 900, 110, 1.3, 0.08, 0.1)
  },
}
