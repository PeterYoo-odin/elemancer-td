// Persistent device preferences (sound / motion / accessibility). Kept separate
// from the game save in save.ts: these describe the device/session, not player
// progression. This is the SINGLE source of truth every screen reads.

const KEY = 'elemancer_settings_v1'

export type ColorblindMode = 'off' | 'deuter' | 'protan' | 'trit'
export type AssistMode = 'off' | 'relaxed' | 'cozy'
// 'reduced' softens harsh transients + ducking for audio-sensitive players
// (the reduce-motion analogue for ears).
export type AudioSensitivity = 'full' | 'reduced'

// Remappable gameplay actions. Values are KeyboardEvent.code strings ('Space',
// 'KeyR', 'Digit1'…). Defaults give the game full keyboard operability.
export type BindableAction = 'startWave' | 'tower1' | 'tower2' | 'tower3' | 'tower4' | 'tower5' | 'cancel' | 'toggleSpeed' | 'pause'
export const DEFAULT_KEYBINDS: Record<BindableAction, string> = {
  startWave: 'Space',
  tower1: 'Digit1',
  tower2: 'Digit2',
  tower3: 'Digit3',
  tower4: 'Digit4',
  tower5: 'Digit5',
  cancel: 'KeyX',
  toggleSpeed: 'KeyF',
  pause: 'Escape',
}

export interface AppSettings {
  masterVol: number // 0..1 master trim over the whole audio graph
  sound: boolean // synthesized SFX (thunder, ticks) master toggle
  sfxVol: number // 0..1 SFX volume
  music: boolean // streamed music themes
  musicVol: number // 0..1
  vo: boolean // hero voice stingers (barks get an audible voice)
  voVol: number // 0..1
  audioSensitivity: AudioSensitivity // 'reduced' softens transients + ducking
  reduceMotion: boolean // explicit user override; the OS preference is honored too
  haptics: boolean // touch-device vibration on placement / reactions / boss kills
  // --- accessibility ---
  colorblind: ColorblindMode // element palette remap for colour-vision deficiency
  elementGlyphs: boolean // show a distinct SHAPE per element (not colour-only)
  highContrast: boolean // stronger panel/text contrast
  textScale: number // UI text scale, 0.8..1.5 (1 = default)
  // --- difficulty / assist ---
  assist: AssistMode // extra starting lives/gold for an easier ride (never harder)
  // --- input remap ---
  keybinds: Record<BindableAction, string>
}

function clamp01(v: unknown, dflt: number): number {
  return typeof v === 'number' && isFinite(v) ? Math.min(1, Math.max(0, v)) : dflt
}

function defaults(): AppSettings {
  return {
    masterVol: 0.9, sound: true, sfxVol: 0.8, music: true, musicVol: 0.6,
    vo: true, voVol: 0.75, audioSensitivity: 'full', reduceMotion: false, haptics: true,
    colorblind: 'off', elementGlyphs: false, highContrast: false, textScale: 1,
    assist: 'off', keybinds: { ...DEFAULT_KEYBINDS },
  }
}

function load(): AppSettings {
  const def = defaults()
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return def
    const p = JSON.parse(raw) as Partial<AppSettings>
    const cb: ColorblindMode = p.colorblind === 'deuter' || p.colorblind === 'protan' || p.colorblind === 'trit' ? p.colorblind : 'off'
    const assist: AssistMode = p.assist === 'relaxed' || p.assist === 'cozy' ? p.assist : 'off'
    const audioSens: AudioSensitivity = p.audioSensitivity === 'reduced' ? 'reduced' : 'full'
    const scale = typeof p.textScale === 'number' && isFinite(p.textScale) ? Math.min(1.5, Math.max(0.8, p.textScale)) : def.textScale
    const binds: Record<BindableAction, string> = { ...DEFAULT_KEYBINDS }
    if (p.keybinds && typeof p.keybinds === 'object') {
      for (const k of Object.keys(DEFAULT_KEYBINDS) as BindableAction[]) {
        const v = (p.keybinds as Record<string, unknown>)[k]
        if (typeof v === 'string' && v) binds[k] = v
      }
    }
    return {
      masterVol: clamp01(p.masterVol, def.masterVol),
      sound: p.sound !== false,
      sfxVol: clamp01(p.sfxVol, def.sfxVol),
      music: p.music !== false,
      musicVol: clamp01(p.musicVol, def.musicVol),
      vo: p.vo !== false,
      voVol: clamp01(p.voVol, def.voVol),
      audioSensitivity: audioSens,
      reduceMotion: p.reduceMotion === true,
      haptics: p.haptics !== false,
      colorblind: cb,
      elementGlyphs: p.elementGlyphs === true,
      highContrast: p.highContrast === true,
      textScale: scale,
      assist,
      keybinds: binds,
    }
  } catch {
    return def
  }
}

export const appSettings = {
  data: load(),

  set(patch: Partial<AppSettings>): void {
    Object.assign(this.data, patch)
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data))
    } catch {
      // storage unavailable (private mode) — setting still applies this session
    }
  },

  /** True when either the user setting or the OS asks for reduced motion. */
  reducedMotion(): boolean {
    if (this.data.reduceMotion) return true
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  },
}
