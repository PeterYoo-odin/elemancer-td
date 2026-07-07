// Persistent device preferences (sound / motion). Kept separate from the game
// save in save.ts: these describe the device/session, not player progression.

const KEY = 'elemancer_settings_v1'

export interface AppSettings {
  sound: boolean
  reduceMotion: boolean // explicit user override; the OS preference is honored too
}

function load(): AppSettings {
  const def: AppSettings = { sound: true, reduceMotion: false }
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return def
    const p = JSON.parse(raw) as Partial<AppSettings>
    return { sound: p.sound !== false, reduceMotion: p.reduceMotion === true }
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
