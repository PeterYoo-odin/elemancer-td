// HERO VO — stylized synthesized vocal stingers. Not recorded speech: a two-
// formant "vowel" (band-passed sawtooth) with a pitch contour + a breath, so a
// hero's deploy / signature / awakening lands with a CHARACTERFUL vocal punch
// on-theme. Zero payload, deterministic-ish, routed to the dedicated VO bus so
// the sliders + mute reach it. Runs alongside chatBark text, never replaces it.

import { appSettings } from './settings'
import { audioContext, audioIntensity, voOut } from './sfx'

export type VoKind = 'deploy' | 'signature' | 'awaken'

// Vocal register per hero element — the field's cast has distinct timbres.
// Falls back to a mid tenor for unknown ids.
const REGISTER: Record<string, number> = {
  Fire: 150, Storm: 138, Arcane: 220, Light: 210,
  Water: 174, Nature: 165, Dark: 110,
}

let lastAt = -1e9

/** Fire a hero vocal stinger. element hints the register; kind shapes the contour. */
export function heroVo(element: string | undefined, kind: VoKind, panv = 0): void {
  if (!appSettings.data.vo || !appSettings.data.sound) return
  if (typeof document !== 'undefined' && document.hidden) return
  const now = performance.now()
  if (now - lastAt < 220) return // never machine-gun the voice
  lastAt = now
  const ac = audioContext()
  if (!ac) return

  const base = (REGISTER[element ?? ''] ?? 155) * (kind === 'awaken' ? 0.92 : 1)
  const t0 = ac.currentTime + 0.02
  const gain = audioIntensity()

  const bus = voOut(ac)
  const sp = ac.createStereoPanner()
  sp.pan.value = Math.max(-0.7, Math.min(0.7, panv))
  sp.connect(bus)

  // Two vocal formants shaped from a sawtooth glottal source.
  const src = ac.createOscillator()
  src.type = 'sawtooth'
  // contour: deploy rises (confident), signature is a firm accent, awaken swells up.
  const dur = kind === 'awaken' ? 0.9 : kind === 'signature' ? 0.42 : 0.5
  src.frequency.setValueAtTime(base * (kind === 'signature' ? 1.06 : 0.82), t0)
  if (kind === 'awaken') {
    src.frequency.exponentialRampToValueAtTime(base * 1.35, t0 + dur * 0.6)
    src.frequency.exponentialRampToValueAtTime(base * 1.1, t0 + dur)
  } else {
    src.frequency.exponentialRampToValueAtTime(base * (kind === 'signature' ? 0.9 : 1.18), t0 + dur)
  }
  const vib = ac.createOscillator()
  vib.type = 'sine'
  vib.frequency.value = 5.5
  const vibG = ac.createGain()
  vibG.gain.value = base * 0.03
  vib.connect(vibG)
  vibG.connect(src.frequency)

  // formant filters → a bright "ah/oh" colour
  const f1 = ac.createBiquadFilter()
  f1.type = 'bandpass'
  f1.frequency.value = kind === 'awaken' ? 620 : 720
  f1.Q.value = 6
  const f2 = ac.createBiquadFilter()
  f2.type = 'bandpass'
  f2.frequency.value = 1200
  f2.Q.value = 8
  const mix = ac.createGain()
  const env = ac.createGain()
  env.gain.setValueAtTime(0, t0)
  env.gain.linearRampToValueAtTime(0.5 * gain, t0 + 0.05)
  env.gain.setValueAtTime(0.5 * gain, t0 + dur * 0.6)
  env.gain.exponentialRampToValueAtTime(0.001, t0 + dur)
  src.connect(f1)
  src.connect(f2)
  f1.connect(mix)
  f2.connect(mix)
  mix.connect(env)
  env.connect(sp)
  src.start(t0)
  src.stop(t0 + dur + 0.05)
  vib.start(t0)
  vib.stop(t0 + dur + 0.05)

  // a breath of air over the vowel — sells it as a voice, not a synth pad
  const n = ac.createBufferSource()
  const buf = ac.createBuffer(1, Math.ceil(ac.sampleRate * 0.3), ac.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  n.buffer = buf
  const bp = ac.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = 2400
  bp.Q.value = 1.2
  const ng = ac.createGain()
  ng.gain.setValueAtTime(0.08 * gain, t0)
  ng.gain.exponentialRampToValueAtTime(0.001, t0 + 0.22)
  n.connect(bp)
  bp.connect(ng)
  ng.connect(sp)
  n.start(t0)
  n.stop(t0 + 0.3)
}
