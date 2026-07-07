// Synthesized branding/UI audio — pure WebAudio, no assets, works offline.
// Everything here respects appSettings.sound and degrades to silence when the
// AudioContext is unavailable. Call unlockAudio() from a user gesture first.

import { appSettings } from './settings'

let ctx: AudioContext | null = null

function ensure(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null
  if (!ctx) {
    try {
      ctx = new AudioContext()
    } catch {
      return null
    }
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

/** Create/resume the context. Must be called from a user gesture (tap/click). */
export function unlockAudio(): void {
  ensure()
}

function noiseBuffer(ac: AudioContext, seconds: number): AudioBuffer {
  const buf = ac.createBuffer(1, Math.ceil(ac.sampleRate * seconds), ac.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  return buf
}

/**
 * Thunderclap: a bright noise CRACK, a rolling lowpass-swept noise BODY, and a
 * sagging sine sub-RUMBLE, all fed through a cheap cross-delay "reverb" tail.
 */
export function playThunderclap(): void {
  if (!appSettings.data.sound) return
  const ac = ensure()
  if (!ac) return
  const t0 = ac.currentTime + 0.02

  const out = ac.createGain()
  out.gain.value = 0.85
  out.connect(ac.destination)

  // Echo tail — two cross-feeding damped delays stand in for a reverb.
  const wet = ac.createGain()
  wet.gain.value = 0.35
  const d1 = ac.createDelay(1)
  d1.delayTime.value = 0.157
  const d2 = ac.createDelay(1)
  d2.delayTime.value = 0.243
  const f1 = ac.createGain()
  f1.gain.value = 0.45
  const f2 = ac.createGain()
  f2.gain.value = 0.4
  const dampen = ac.createBiquadFilter()
  dampen.type = 'lowpass'
  dampen.frequency.value = 900
  wet.connect(d1)
  d1.connect(f1)
  f1.connect(dampen)
  dampen.connect(d2)
  d2.connect(f2)
  f2.connect(d1)
  d1.connect(out)
  d2.connect(out)

  // 1) CRACK — hard, bright transient.
  const crack = ac.createBufferSource()
  crack.buffer = noiseBuffer(ac, 0.4)
  const crackHp = ac.createBiquadFilter()
  crackHp.type = 'highpass'
  crackHp.frequency.value = 700
  const crackG = ac.createGain()
  crackG.gain.setValueAtTime(0, t0)
  crackG.gain.linearRampToValueAtTime(1.0, t0 + 0.008)
  crackG.gain.exponentialRampToValueAtTime(0.001, t0 + 0.3)
  crack.connect(crackHp)
  crackHp.connect(crackG)
  crackG.connect(out)
  crackG.connect(wet)
  crack.start(t0)

  // 2) BODY — noise swept down through a lowpass; the rolling part.
  const body = ac.createBufferSource()
  body.buffer = noiseBuffer(ac, 3.5)
  const bodyLp = ac.createBiquadFilter()
  bodyLp.type = 'lowpass'
  bodyLp.frequency.setValueAtTime(1400, t0)
  bodyLp.frequency.exponentialRampToValueAtTime(90, t0 + 2.8)
  const bodyG = ac.createGain()
  bodyG.gain.setValueAtTime(0, t0)
  bodyG.gain.linearRampToValueAtTime(0.8, t0 + 0.05)
  bodyG.gain.exponentialRampToValueAtTime(0.001, t0 + 3.2)
  body.connect(bodyLp)
  bodyLp.connect(bodyG)
  bodyG.connect(out)
  bodyG.connect(wet)
  body.start(t0)

  // 3) RUMBLE — sub sine that sags in pitch as it fades.
  const sub = ac.createOscillator()
  sub.type = 'sine'
  sub.frequency.setValueAtTime(55, t0)
  sub.frequency.exponentialRampToValueAtTime(30, t0 + 2.4)
  const subG = ac.createGain()
  subG.gain.setValueAtTime(0, t0)
  subG.gain.linearRampToValueAtTime(0.55, t0 + 0.06)
  subG.gain.exponentialRampToValueAtTime(0.001, t0 + 2.6)
  sub.connect(subG)
  subG.connect(out)
  sub.start(t0)
  sub.stop(t0 + 2.7)
}

/** Soft rising sparkle as the gold ignites: swept bandpass air + two chime tones. */
export function playShimmer(): void {
  if (!appSettings.data.sound) return
  const ac = ensure()
  if (!ac) return
  const t0 = ac.currentTime + 0.02

  const out = ac.createGain()
  out.gain.value = 0.14
  out.connect(ac.destination)

  const n = ac.createBufferSource()
  n.buffer = noiseBuffer(ac, 1.6)
  const bp = ac.createBiquadFilter()
  bp.type = 'bandpass'
  bp.Q.value = 6
  bp.frequency.setValueAtTime(1200, t0)
  bp.frequency.exponentialRampToValueAtTime(5200, t0 + 1.2)
  const g = ac.createGain()
  g.gain.setValueAtTime(0, t0)
  g.gain.linearRampToValueAtTime(1, t0 + 0.5)
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 1.5)
  n.connect(bp)
  bp.connect(g)
  g.connect(out)
  n.start(t0)

  const chimes = [1568, 2349.3]
  chimes.forEach((hz, i) => {
    const o = ac.createOscillator()
    o.type = 'sine'
    o.frequency.value = hz
    const og = ac.createGain()
    const s = t0 + 0.35 + i * 0.12
    og.gain.setValueAtTime(0, s)
    og.gain.linearRampToValueAtTime(0.12, s + 0.03)
    og.gain.exponentialRampToValueAtTime(0.001, s + 1.1)
    o.connect(og)
    og.connect(out)
    o.start(s)
    o.stop(s + 1.2)
  })
}

/** Morose's hush: a dark, downward-sighing filtered noise — the sound of grey. */
export function playMoroseHush(): void {
  if (!appSettings.data.sound) return
  const ac = ensure()
  if (!ac) return
  const t0 = ac.currentTime + 0.02
  const out = ac.createGain()
  out.gain.value = 0.5
  out.connect(ac.destination)

  const n = ac.createBufferSource()
  n.buffer = noiseBuffer(ac, 2.0)
  const lp = ac.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.setValueAtTime(1200, t0)
  lp.frequency.exponentialRampToValueAtTime(120, t0 + 1.6)
  const g = ac.createGain()
  g.gain.setValueAtTime(0, t0)
  g.gain.linearRampToValueAtTime(0.5, t0 + 0.35)
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 1.8)
  n.connect(lp)
  lp.connect(g)
  g.connect(out)
  n.start(t0)

  // a low sighing tone underneath, sagging a minor third
  const o = ac.createOscillator()
  o.type = 'sine'
  o.frequency.setValueAtTime(196, t0) // G3…
  o.frequency.exponentialRampToValueAtTime(164.8, t0 + 1.2) // …to E3
  const og = ac.createGain()
  og.gain.setValueAtTime(0, t0)
  og.gain.linearRampToValueAtTime(0.16, t0 + 0.25)
  og.gain.exponentialRampToValueAtTime(0.001, t0 + 1.6)
  o.connect(og)
  og.connect(out)
  o.start(t0)
  o.stop(t0 + 1.7)
}

/** Node-arrival stinger: two bright plucked notes, a tiny "you made it". */
export function playNodeStinger(): void {
  if (!appSettings.data.sound) return
  const ac = ensure()
  if (!ac) return
  const t0 = ac.currentTime + 0.02
  const out = ac.createGain()
  out.gain.value = 0.22
  out.connect(ac.destination)
  const notes = [523.25, 784] // C5 → G5
  notes.forEach((hz, i) => {
    const o = ac.createOscillator()
    o.type = 'triangle'
    o.frequency.value = hz
    const g = ac.createGain()
    const s = t0 + i * 0.12
    g.gain.setValueAtTime(0, s)
    g.gain.linearRampToValueAtTime(0.7, s + 0.012)
    g.gain.exponentialRampToValueAtTime(0.001, s + 0.55)
    o.connect(g)
    g.connect(out)
    o.start(s)
    o.stop(s + 0.6)
  })
}

/** Discovery chime: a small ascending arpeggio for road finds / codex pages. */
export function playDiscovery(): void {
  if (!appSettings.data.sound) return
  const ac = ensure()
  if (!ac) return
  const t0 = ac.currentTime + 0.02
  const out = ac.createGain()
  out.gain.value = 0.18
  out.connect(ac.destination)
  const notes = [659.25, 830.6, 987.77, 1318.5] // E5 G#5 B5 E6
  notes.forEach((hz, i) => {
    const o = ac.createOscillator()
    o.type = 'sine'
    o.frequency.value = hz
    const g = ac.createGain()
    const s = t0 + i * 0.09
    g.gain.setValueAtTime(0, s)
    g.gain.linearRampToValueAtTime(0.5, s + 0.015)
    g.gain.exponentialRampToValueAtTime(0.001, s + 0.9)
    o.connect(g)
    g.connect(out)
    o.start(s)
    o.stop(s + 1)
  })
}

/** Tiny click for menu buttons. */
export function playUiTick(): void {
  if (!appSettings.data.sound) return
  const ac = ensure()
  if (!ac) return
  const t0 = ac.currentTime + 0.005
  const o = ac.createOscillator()
  o.type = 'triangle'
  o.frequency.setValueAtTime(950, t0)
  o.frequency.exponentialRampToValueAtTime(620, t0 + 0.07)
  const g = ac.createGain()
  g.gain.setValueAtTime(0, t0)
  g.gain.linearRampToValueAtTime(0.11, t0 + 0.008)
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.09)
  o.connect(g)
  g.connect(ac.destination)
  o.start(t0)
  o.stop(t0 + 0.1)
}
