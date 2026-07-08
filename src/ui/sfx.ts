// THE AUDIO HUB. One WebAudio graph everything routes through so the whole game
// MIXES instead of piling. Buses hang off a single master:
//
//   destination
//    └ masterGain (masterVol)
//        ├ sfxSpectral(lowpass) → sfxMaster(sfxVol)   ← sfxOut(); tapped by the RMS analyser
//        ├ musicSpectral(lowpass) → musicMaster(musicVol) ← musicDuck ← music.ts sources
//        └ voMaster(voVol)                             ← voOut()
//
// · masterVol/sfxVol/musicVol/voVol are real slider-driven gains.
// · The two "spectral" lowpass filters are THE GREYING made audible: driven by
//   the same battlefield saturation the renderer tracks (setSpectralOpenness),
//   greyed = muffled, restored colour = full spectrum, victory bloom = wide open.
// · musicDuck sidechains the music bed DOWN under combat (RMS + event punches)
//   so reactions and boss-kills read, then recovers.
// Everything respects appSettings and degrades to silence when WebAudio is absent.
// Call unlockAudio() from a user gesture first.

import { appSettings } from './settings'

let ctx: AudioContext | null = null
let masterGain: GainNode | null = null // final trim (masterVol) → destination
let sfxMaster: GainNode | null = null // all SFX (sfxVol) — sfxOut() returns this
let sfxSpectral: BiquadFilterNode | null = null // the greying lowpass on SFX
let musicMaster: GainNode | null = null // music bed (musicVol)
let musicSpectral: BiquadFilterNode | null = null // the greying lowpass on music
let musicDuck: GainNode | null = null // sidechain duck — music.ts connects here
let voMaster: GainNode | null = null // hero VO bus (voVol)
let analyser: AnalyserNode | null = null // combat-loudness tap on the SFX bus
let rmsBuf: Float32Array<ArrayBuffer> | null = null

// --- the greying / duck state, stepped once per battle frame (frame-lock) ----
let openness = 1 // 0 = fully greyed/muffled, 1 = full spectrum, >1 pins wide open
let duckFloor = 0 // transient sidechain "punch" depth, decays to 0

const MIN_HZ = 480 // fully-greyed cutoff — dark, life-drained
const MAX_HZ = 20000 // full-colour cutoff — the whole spectrum

/** Softer transients + gentler ducking for audio-sensitive players. */
export function audioIntensity(): number {
  return appSettings.data.audioSensitivity === 'reduced' ? 0.6 : 1
}

function opennessHz(o: number): number {
  const k = Math.min(1, Math.max(0, o))
  return MIN_HZ * Math.pow(MAX_HZ / MIN_HZ, k) // exponential — matches pitch perception
}

function ensure(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null
  if (!ctx) {
    try {
      ctx = new AudioContext()
    } catch {
      return null
    }
  }
  if (!masterGain && ctx) {
    masterGain = ctx.createGain()
    masterGain.gain.value = appSettings.data.masterVol
    masterGain.connect(ctx.destination)

    // SFX bus: sfxSpectral(lowpass) → sfxMaster → master
    sfxMaster = ctx.createGain()
    sfxMaster.gain.value = appSettings.data.sfxVol
    sfxSpectral = ctx.createBiquadFilter()
    sfxSpectral.type = 'lowpass'
    sfxSpectral.frequency.value = MAX_HZ
    sfxSpectral.Q.value = 0.0001
    sfxMaster.connect(sfxSpectral)
    sfxSpectral.connect(masterGain)
    // combat-loudness tap (analyser sinks the signal for RMS; no onward connect)
    analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    rmsBuf = new Float32Array(new ArrayBuffer(analyser.fftSize * 4))
    sfxMaster.connect(analyser)

    // Music bus: musicDuck → musicSpectral(lowpass) → musicMaster → master
    musicMaster = ctx.createGain()
    musicMaster.gain.value = appSettings.data.musicVol
    musicMaster.connect(masterGain)
    musicSpectral = ctx.createBiquadFilter()
    musicSpectral.type = 'lowpass'
    musicSpectral.frequency.value = MAX_HZ
    musicSpectral.Q.value = 0.0001
    musicSpectral.connect(musicMaster)
    musicDuck = ctx.createGain()
    musicDuck.gain.value = 1
    musicDuck.connect(musicSpectral)

    // VO bus
    voMaster = ctx.createGain()
    voMaster.gain.value = appSettings.data.voVol
    voMaster.connect(masterGain)
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

/** The shared SFX output node. Layers respect the SFX slider + the greying. */
export function sfxOut(ac: AudioContext): AudioNode {
  return sfxMaster ?? ac.destination
}

/** The hero-VO output node (voVol bus). */
export function voOut(ac: AudioContext): AudioNode {
  return voMaster ?? ac.destination
}

/** Music sources (music.ts) connect their MediaElementSource chains here. */
export function musicBusInput(): AudioNode | null {
  ensure()
  return musicDuck
}

/** Re-apply volumes from settings (call after a slider moves). */
export function refreshSfxVolume(): void {
  if (sfxMaster) sfxMaster.gain.value = appSettings.data.sfxVol
}
export function refreshMasterVolume(): void {
  if (masterGain) masterGain.gain.value = appSettings.data.masterVol
}
export function refreshMusicVolume(): void {
  if (musicMaster) musicMaster.gain.value = appSettings.data.musicVol
}
export function refreshVoVolume(): void {
  if (voMaster) voMaster.gain.value = appSettings.data.voVol
}

/**
 * SOUND THE GREYING. Drive the shared lowpass off the battlefield's saturation
 * (0 = fully greyed → muffled; 1 = full colour → open; >1 = victory bloom, wide
 * open). Called every battle frame from updateGreying so it frame-locks to the
 * visual desaturation. Music is muffled a touch harder than SFX (the bed feels
 * the drain most). Idempotent + smoothed via the audio param.
 */
export function setSpectralOpenness(o: number): void {
  openness = o
  const ac = ctx
  if (!ac || !sfxSpectral || !musicSpectral) return
  const sfxHz = opennessHz(0.25 + 0.75 * o) // SFX stay a bit brighter than the bed
  const musHz = opennessHz(o)
  sfxSpectral.frequency.setTargetAtTime(sfxHz, ac.currentTime, 0.05)
  musicSpectral.frequency.setTargetAtTime(musHz, ac.currentTime, 0.08)
}

/** A momentary spectral dip — Morose touching the field drains the light. */
export function spectralDip(depth = 0.5): void {
  setSpectralOpenness(Math.max(0, openness - depth * audioIntensity()))
}

/**
 * Sidechain PUNCH — an event (reaction, boss kill) momentarily pulls the music
 * bed down so the hit reads, then it recovers. Depth 0..1. Frame-locked: called
 * synchronously from the same block that fires the SFX + flash + shake.
 */
export function duckPunch(depth: number): void {
  duckFloor = Math.max(duckFloor, Math.min(0.8, depth * audioIntensity()))
}

/**
 * Step the sidechain duck once per frame from the battle loop. Reads the SFX
 * bus RMS (continuous combat loudness) and blends it with the decaying punch
 * floor, then eases musicDuck toward the result. One tick, one clock.
 */
export function stepDuck(dt: number): void {
  const ac = ctx
  if (!ac || !analyser || !rmsBuf || !musicDuck) return
  analyser.getFloatTimeDomainData(rmsBuf)
  let sum = 0
  for (let i = 0; i < rmsBuf.length; i++) sum += rmsBuf[i] * rmsBuf[i]
  const rms = Math.sqrt(sum / rmsBuf.length)
  duckFloor = Math.max(0, duckFloor - dt * 1.6) // ~0.6s recovery from a punch
  const rmsDuck = Math.min(0.5, rms * 2.4) * audioIntensity()
  const target = 1 - Math.max(rmsDuck, duckFloor)
  musicDuck.gain.setTargetAtTime(Math.max(0.2, target), ac.currentTime, 0.06)
}

/** Reset the greying + duck to neutral when leaving battle (map/menu = full colour). */
export function resetAudioScene(): void {
  setSpectralOpenness(1)
  duckFloor = 0
  if (ctx && musicDuck) musicDuck.gain.setTargetAtTime(1, ctx.currentTime, 0.2)
}

/** Create/resume the context. Must be called from a user gesture (tap/click). */
export function unlockAudio(): void {
  ensure()
}

/** Shared context for sibling audio modules (battleSfx/vo/music layer in). */
export function audioContext(): AudioContext | null {
  return ensure()
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
  out.connect(sfxOut(ac))

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
  out.connect(sfxOut(ac))

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
  out.connect(sfxOut(ac))

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
  out.connect(sfxOut(ac))
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
  out.connect(sfxOut(ac))
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
  g.connect(sfxOut(ac))
  o.start(t0)
  o.stop(t0 + 0.1)
}
