// Persistent save (localStorage). Single versioned blob. Loading NEVER throws:
// any parse failure or old/partial shape falls back field-by-field onto a fresh
// default, so a missing `workshop`/`diamonds`/etc. resolves to a default, not
// `undefined`. economy.ts is the only module that mutates + persists this.

export const SAVE_VERSION = 2
const SAVE_KEY = 'elemancer_td_save_v1'

export interface SaveData {
  version: number
  coins: number
  diamonds: number
  stars: Record<string, number> // levelId -> best stars (0..3)
  firstClears: Record<string, boolean> // levelId -> cleared at least once
  unlockedTowers: string[] // TowerKind ids the player owns
  workshop: Record<string, number> // workshop nodeId -> purchased level
  lastSeen: number // epoch ms, for idle offline earnings
  dailyClaimedDay: number // epoch-day index of last claimed daily diamond
  endlessBest: number // best endless wave reached
}

export function defaultSave(): SaveData {
  return {
    version: SAVE_VERSION,
    coins: 0,
    diamonds: 0,
    stars: {},
    firstClears: {},
    unlockedTowers: ['cannon', 'frost', 'flame'],
    workshop: {},
    lastSeen: 0,
    dailyClaimedDay: 0,
    endlessBest: 0,
  }
}

// Overlay only known keys, coercing types; unknown/missing keys keep the default.
function coerce(raw: unknown): SaveData {
  const d = defaultSave()
  if (!raw || typeof raw !== 'object') return d
  const o = raw as Record<string, unknown>
  if (typeof o.coins === 'number' && isFinite(o.coins)) d.coins = Math.max(0, o.coins)
  if (typeof o.diamonds === 'number' && isFinite(o.diamonds)) d.diamonds = Math.max(0, o.diamonds)
  if (o.stars && typeof o.stars === 'object') {
    for (const [k, v] of Object.entries(o.stars as Record<string, unknown>)) {
      if (typeof v === 'number' && isFinite(v)) d.stars[k] = Phaser0to3(v)
    }
  }
  if (o.firstClears && typeof o.firstClears === 'object') {
    for (const [k, v] of Object.entries(o.firstClears as Record<string, unknown>)) {
      if (v === true) d.firstClears[k] = true
    }
  }
  if (Array.isArray(o.unlockedTowers)) {
    const set = new Set(d.unlockedTowers)
    for (const t of o.unlockedTowers) if (typeof t === 'string') set.add(t)
    d.unlockedTowers = [...set]
  }
  if (o.workshop && typeof o.workshop === 'object') {
    for (const [k, v] of Object.entries(o.workshop as Record<string, unknown>)) {
      if (typeof v === 'number' && isFinite(v) && v > 0) d.workshop[k] = Math.floor(v)
    }
  }
  if (typeof o.lastSeen === 'number' && isFinite(o.lastSeen)) d.lastSeen = o.lastSeen
  if (typeof o.dailyClaimedDay === 'number' && isFinite(o.dailyClaimedDay)) d.dailyClaimedDay = o.dailyClaimedDay
  if (typeof o.endlessBest === 'number' && isFinite(o.endlessBest)) d.endlessBest = Math.max(0, Math.floor(o.endlessBest))
  return d
}

// clamp a stars value into 0..3
function Phaser0to3(v: number): number {
  return Math.max(0, Math.min(3, Math.floor(v)))
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    if (!raw) return defaultSave()
    return coerce(JSON.parse(raw))
  } catch {
    return defaultSave()
  }
}

export function writeSave(data: SaveData): void {
  try {
    data.version = SAVE_VERSION
    localStorage.setItem(SAVE_KEY, JSON.stringify(data))
  } catch {
    // storage unavailable (private mode / quota) — fail silently, game still runs.
  }
}
