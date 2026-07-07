// Persistent save (localStorage). Single versioned blob. Loading NEVER throws:
// any parse failure or old/partial shape falls back field-by-field onto a fresh
// default, so a missing `workshop`/`diamonds`/etc. resolves to a default, not
// `undefined`. economy.ts is the only module that mutates + persists this.

export const SAVE_VERSION = 5
const SAVE_KEY = 'elemancer_td_save_v1'

// Persisted per-hero progression (see heroProgress.ts for the scaling rules).
export interface SavedHero {
  level: number
  xp: number
  unlocked: boolean
}

// Persisted per-Wyrm growth (hatchling→adult). Discovery/awakening is DERIVED
// from realm-finale clears, so only growth needs storing here.
export interface SavedWyrm {
  level: number
  xp: number
}

export interface SaveData {
  version: number
  coins: number
  diamonds: number
  stars: Record<string, number> // levelId -> best stars (0..3)
  firstClears: Record<string, boolean> // levelId -> cleared at least once
  badges: Record<string, string[]> // levelId -> earned difficulty/challenge badge ids
  unlockedTowers: string[] // TowerKind ids the player owns
  workshop: Record<string, number> // workshop nodeId -> purchased level
  lastSeen: number // epoch ms, for idle offline earnings
  dailyClaimedDay: number // epoch-day index of last claimed daily diamond
  endlessBest: number // best endless wave reached
  // --- slice-6 heroes ---
  heroShards: number // free currency for unlocking + levelling heroes
  heroes: Record<string, SavedHero> // heroId -> progression (starters unlocked)
  party: string[] // chosen loadout (hero ids, up to MAX_PARTY) — this is SLOT 1; Ranked always uses it
  // --- Chromatic Wyrms (companion dragons + the hero↔dragon BOND) ---
  wyrms: Record<string, SavedWyrm> // wyrmId -> growth (earned through play)
  bonds: Record<string, string> // heroId -> bonded wyrmId (Ranked normalizes the Wyrm's level)
  wyrmActSeen: boolean // the late-act "Waking of the Wyrms" beat has played once
  // --- store / economy (all cosmetic or casual-only; Ranked ignores everything here) ---
  prisms: number // event-only cosmetic currency, earned by play, never sold
  owned: string[] // owned SKU ids (skins, dyes, convenience, prestige)
  equipped: Record<string, string> // equip slot -> SKU id (e.g. 'tower:cannon')
  loadouts: string[][] // extra casual loadouts (slots 2+); party above is slot 1
  activeLoadout: number // 0 = party (slot 1); 1+ index into loadouts
  pass: PassSave // Prism Pass season progress (advances by play only)
  restorerName: string // Restorers Wall display name stub ('' = unset)
  // --- growth loop (all cosmetic / soft-currency / convenience; Ranked ignores it) ---
  welcomeClaimed: boolean // welcome bundle (2000💎 + starter skin + first spin) claimed
  firstSpinUsed: boolean // the welcome "first spin" free-reward has been spun
  loginStreak: number // consecutive UTC days the daily login reward was claimed
  loginBest: number // longest login streak ever reached
  loginLastDay: number // epoch-day index of the last claimed login-streak day
  referredBy: string // inbound referral code that brought this player ('' = organic)
  referralFriends: number // confirmed friends who played from your link (BACKEND-fed; 0 local-only)
  referralTiersClaimed: number // referral-ladder tiers already granted to this player
}

export interface PassSave {
  season: string
  xp: number
  premium: boolean
  freeClaimed: number // tiers 1..n already claimed on the free track
  premClaimed: number // tiers 1..n already claimed on the premium track
}

function defaultPass(): PassSave {
  return { season: '', xp: 0, premium: false, freeClaimed: 0, premClaimed: 0 }
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
    badges: {},
    unlockedTowers: ['cannon', 'frost', 'flame'],
    workshop: {},
    lastSeen: 0,
    dailyClaimedDay: 0,
    endlessBest: 0,
    heroShards: 0,
    heroes: starterHeroes(),
    party: [...STARTER_HERO_IDS],
    wyrms: {},
    bonds: {},
    wyrmActSeen: false,
    prisms: 0,
    owned: [],
    equipped: {},
    loadouts: [],
    activeLoadout: 0,
    pass: defaultPass(),
    restorerName: '',
    welcomeClaimed: false,
    firstSpinUsed: false,
    loginStreak: 0,
    loginBest: 0,
    loginLastDay: 0,
    referredBy: '',
    referralFriends: 0,
    referralTiersClaimed: 0,
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
  if (o.badges && typeof o.badges === 'object') {
    for (const [k, v] of Object.entries(o.badges as Record<string, unknown>)) {
      if (Array.isArray(v)) d.badges[k] = v.filter((x) => typeof x === 'string') as string[]
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

  // --- Chromatic Wyrms (each field defended; old blobs keep the fresh defaults) ---
  if (o.wyrms && typeof o.wyrms === 'object') {
    for (const [k, v] of Object.entries(o.wyrms as Record<string, unknown>)) {
      if (!v || typeof v !== 'object') continue
      const w = v as Record<string, unknown>
      const level = typeof w.level === 'number' && isFinite(w.level) ? Math.max(1, Math.floor(w.level)) : 1
      const xp = typeof w.xp === 'number' && isFinite(w.xp) ? Math.max(0, Math.floor(w.xp)) : 0
      d.wyrms[k] = { level, xp }
    }
  }
  if (o.bonds && typeof o.bonds === 'object') {
    for (const [k, v] of Object.entries(o.bonds as Record<string, unknown>)) {
      if (typeof v === 'string' && v) d.bonds[k] = v
    }
  }
  d.wyrmActSeen = o.wyrmActSeen === true

  // --- store / economy (each field defended; old blobs keep defaults) ---
  if (typeof o.prisms === 'number' && isFinite(o.prisms)) d.prisms = Math.max(0, Math.floor(o.prisms))
  if (Array.isArray(o.owned)) {
    const set = new Set<string>()
    for (const id of o.owned) if (typeof id === 'string') set.add(id)
    d.owned = [...set]
  }
  if (o.equipped && typeof o.equipped === 'object') {
    for (const [k, v] of Object.entries(o.equipped as Record<string, unknown>)) {
      if (typeof v === 'string') d.equipped[k] = v
    }
  }
  if (Array.isArray(o.loadouts)) {
    d.loadouts = []
    for (const lo of o.loadouts) {
      if (!Array.isArray(lo)) continue
      const clean: string[] = []
      for (const p of lo) if (typeof p === 'string' && clean.length < 3 && !clean.includes(p)) clean.push(p)
      d.loadouts.push(clean)
      if (d.loadouts.length >= 2) break // slots 2+3 at most
    }
  }
  if (typeof o.activeLoadout === 'number' && isFinite(o.activeLoadout)) {
    d.activeLoadout = Math.max(0, Math.min(d.loadouts.length, Math.floor(o.activeLoadout)))
  }
  if (o.pass && typeof o.pass === 'object') {
    const p = o.pass as Record<string, unknown>
    if (typeof p.season === 'string') d.pass.season = p.season
    if (typeof p.xp === 'number' && isFinite(p.xp)) d.pass.xp = Math.max(0, Math.floor(p.xp))
    d.pass.premium = p.premium === true
    if (typeof p.freeClaimed === 'number' && isFinite(p.freeClaimed)) d.pass.freeClaimed = Math.max(0, Math.floor(p.freeClaimed))
    if (typeof p.premClaimed === 'number' && isFinite(p.premClaimed)) d.pass.premClaimed = Math.max(0, Math.floor(p.premClaimed))
  }
  if (typeof o.restorerName === 'string') d.restorerName = o.restorerName.slice(0, 24)

  // --- growth loop (additive; old blobs keep the fresh defaults, no migration) ---
  d.welcomeClaimed = o.welcomeClaimed === true
  d.firstSpinUsed = o.firstSpinUsed === true
  if (typeof o.loginStreak === 'number' && isFinite(o.loginStreak)) d.loginStreak = Math.max(0, Math.floor(o.loginStreak))
  if (typeof o.loginBest === 'number' && isFinite(o.loginBest)) d.loginBest = Math.max(0, Math.floor(o.loginBest))
  if (typeof o.loginLastDay === 'number' && isFinite(o.loginLastDay)) d.loginLastDay = Math.max(0, Math.floor(o.loginLastDay))
  if (typeof o.referredBy === 'string') d.referredBy = o.referredBy.slice(0, 24)
  if (typeof o.referralFriends === 'number' && isFinite(o.referralFriends)) d.referralFriends = Math.max(0, Math.floor(o.referralFriends))
  if (typeof o.referralTiersClaimed === 'number' && isFinite(o.referralTiersClaimed)) d.referralTiersClaimed = Math.max(0, Math.floor(o.referralTiersClaimed))
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
