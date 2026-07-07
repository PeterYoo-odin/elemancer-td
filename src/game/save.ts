// Persistent save (localStorage). Single versioned blob. Loading NEVER throws:
// any parse failure or old/partial shape falls back field-by-field onto a fresh
// default, so a missing `workshop`/`diamonds`/etc. resolves to a default, not
// `undefined`. economy.ts is the only module that mutates + persists this.

export const SAVE_VERSION = 3
const SAVE_KEY = 'elemancer_td_save_v1'

// Persisted per-hero progression (see heroProgress.ts for the scaling rules).
export interface SavedHero {
  level: number
  xp: number
  unlocked: boolean
}

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
  // --- slice-6 heroes ---
  heroShards: number // free currency for unlocking + levelling heroes
  heroes: Record<string, SavedHero> // heroId -> progression (starters unlocked)
  party: string[] // chosen loadout (hero ids, up to MAX_PARTY)
}

// Heroes owned from a fresh save. Kept local (like unlockedTowers) so save.ts has
// no dependency on the hero data tables.
const STARTER_HERO_IDS = ['ember', 'glacia', 'sylvan']

function starterHeroes(): Record<string, SavedHero> {
  const out: Record<string, SavedHero> = {}
  for (const id of STARTER_HERO_IDS) out[id] = { level: 1, xp: 0, unlocked: true }
  return out
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
    heroShards: 0,
    heroes: starterHeroes(),
    party: [...STARTER_HERO_IDS],
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

  // --- heroes (each field defended like the rest; a partial/old blob keeps defaults) ---
  if (typeof o.heroShards === 'number' && isFinite(o.heroShards)) d.heroShards = Math.max(0, Math.floor(o.heroShards))
  if (o.heroes && typeof o.heroes === 'object') {
    for (const [k, v] of Object.entries(o.heroes as Record<string, unknown>)) {
      if (!v || typeof v !== 'object') continue
      const h = v as Record<string, unknown>
      const level = typeof h.level === 'number' && isFinite(h.level) ? Math.max(1, Math.floor(h.level)) : 1
      const xp = typeof h.xp === 'number' && isFinite(h.xp) ? Math.max(0, Math.floor(h.xp)) : 0
      const unlocked = h.unlocked === true
      d.heroes[k] = { level, xp, unlocked }
    }
  }
  // starters can never end up locked (guards a corrupted/partial heroes map)
  for (const id of STARTER_HERO_IDS) {
    if (!d.heroes[id]) d.heroes[id] = { level: 1, xp: 0, unlocked: true }
    else d.heroes[id].unlocked = true
  }
  if (Array.isArray(o.party)) {
    const party: string[] = []
    for (const p of o.party) if (typeof p === 'string' && party.length < 3 && !party.includes(p)) party.push(p)
    d.party = party
  }
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
