// Economy — the SINGLE source of truth for meta currency (coins + diamonds) and
// the seam a future real-money IAP layer drops into (nothing else mutates the
// wallet). Wraps the persistent SaveData and applies workshop meta modifiers.
//
// Currencies:
//   COINS    = free meta currency (level clears, stars, idle offline earnings).
//   DIAMONDS = premium but fully EARNABLE FREE, only slowly (first-clears, new
//              stars, a daily bonus). No real-money purchase this slice.

import { loadSave, writeSave, type SaveData, type SavedHero } from './save'
import {
  aggregateMetaModifiers,
  aggregateRunModifiers,
  NEUTRAL,
  type MetaModifiers,
  type RunModifiers,
  type Currency,
} from './workshop'
import { STARTER_HEROES, MAX_PARTY, heroById } from './heroes'
import { MAX_HERO_LEVEL, clampLevel, xpForLevel, shardCostForLevel } from './heroProgress'

const IDLE_CAP_MS = 8 * 60 * 60 * 1000 // 8 hours
const DAILY_DIAMONDS = 2

export interface CampaignResult {
  levelId: string
  stars: number // stars earned THIS run (0..3)
  bestStars: number // best ever after this run
  gainedStars: number // NEW stars over previous best
  firstClear: boolean
  coins: number
  diamonds: number
}

export interface IdleReport {
  coins: number
  seconds: number
  capped: boolean
}

function now(): number {
  return Date.now()
}

function dayIndex(ms: number): number {
  return Math.floor(ms / (24 * 60 * 60 * 1000))
}

class Economy {
  data: SaveData

  constructor() {
    this.data = loadSave()
  }

  save(): void {
    writeSave(this.data)
  }

  // ---- wallet ----
  get coins(): number {
    return this.data.coins
  }
  get diamonds(): number {
    return this.data.diamonds
  }

  addCoins(n: number): void {
    if (n <= 0) return
    this.data.coins += Math.round(n)
    this.save()
  }
  addDiamonds(n: number): void {
    if (n <= 0) return
    this.data.diamonds += Math.round(n)
    this.save()
  }

  canAfford(currency: Currency, amount: number): boolean {
    return (currency === 'coins' ? this.data.coins : this.data.diamonds) >= amount
  }

  spend(currency: Currency, amount: number): boolean {
    if (!this.canAfford(currency, amount)) return false
    if (currency === 'coins') this.data.coins -= amount
    else this.data.diamonds -= amount
    this.save()
    return true
  }

  // ---- workshop modifiers ----
  runModifiers(endless: boolean): RunModifiers {
    // Endless is the anti-pay-to-win "Ranked" mode: NEVER apply meta buffs.
    return endless ? { ...NEUTRAL } : aggregateRunModifiers(this.data)
  }

  meta(): MetaModifiers {
    return aggregateMetaModifiers(this.data)
  }

  // ---- stars ----
  totalStars(): number {
    let s = 0
    for (const k in this.data.stars) s += this.data.stars[k]
    return s
  }
  starsFor(levelId: string): number {
    return this.data.stars[levelId] ?? 0
  }

  // ---- campaign clear reward ----
  awardCampaign(levelId: string, stars: number, baseCoins: number): CampaignResult {
    const prev = this.data.stars[levelId] ?? 0
    const bestStars = Math.max(prev, stars)
    const gainedStars = Math.max(0, bestStars - prev)
    const firstClear = !this.data.firstClears[levelId] && stars >= 1
    const meta = this.meta()

    // Coins scale with performance; first clear pays a bonus. Boost accelerators apply.
    let coins = baseCoins * (0.6 + 0.2 * stars) * meta.coinClearMult * meta.coinBoost
    if (firstClear) coins += baseCoins * meta.coinBoost
    coins = Math.round(coins)

    // Diamonds: only for genuinely new progress (slow, free trickle).
    const diamonds = gainedStars * 1 + (firstClear ? 3 : 0)

    // persist
    if (bestStars > prev) this.data.stars[levelId] = bestStars
    if (firstClear) this.data.firstClears[levelId] = true
    this.data.coins += coins
    this.data.diamonds += diamonds
    this.save()

    return { levelId, stars, bestStars, gainedStars, firstClear, coins, diamonds }
  }

  // ---- endless reward (coins only; balance stays neutral) ----
  awardEndless(wavesReached: number): { coins: number; best: boolean } {
    const meta = this.meta()
    const coins = Math.round(wavesReached * 8 * meta.coinBoost)
    const best = wavesReached > this.data.endlessBest
    if (best) this.data.endlessBest = wavesReached
    this.data.coins += coins
    this.save()
    return { coins, best }
  }

  // ---- idle offline earnings ----
  idlePreview(): IdleReport {
    const last = this.data.lastSeen
    if (!last) return { coins: 0, seconds: 0, capped: false }
    const rawMs = now() - last
    if (rawMs <= 0) return { coins: 0, seconds: 0, capped: false }
    const capped = rawMs > IDLE_CAP_MS
    const ms = Math.min(rawMs, IDLE_CAP_MS)
    const meta = this.meta()
    const perMs = (meta.idlePerMin * meta.idleBoost * meta.coinBoost) / 60000
    const coins = Math.floor(ms * perMs)
    return { coins, seconds: Math.floor(ms / 1000), capped }
  }

  claimIdle(): IdleReport {
    const report = this.idlePreview()
    if (report.coins > 0) this.data.coins += report.coins
    this.touchLastSeen()
    return report
  }

  touchLastSeen(): void {
    this.data.lastSeen = now()
    this.save()
  }

  // ---- daily diamond bonus ----
  dailyAvailable(): boolean {
    return dayIndex(now()) > this.data.dailyClaimedDay
  }
  claimDaily(): number {
    if (!this.dailyAvailable()) return 0
    this.data.dailyClaimedDay = dayIndex(now())
    this.data.diamonds += DAILY_DIAMONDS
    this.save()
    return DAILY_DIAMONDS
  }

  // ======================================================================
  //  HEROES — free-currency progression (shards + XP), loadout, unlocks.
  //  No real-money input: shards come only from play; XP from fielding heroes.
  // ======================================================================
  get heroShards(): number {
    return this.data.heroShards
  }
  addShards(n: number): void {
    if (n <= 0) return
    this.data.heroShards += Math.round(n)
    this.save()
  }

  // Persisted state for a hero, defaulting to a locked level-1 for unknown ids.
  heroState(id: string): SavedHero {
    const s = this.data.heroes[id]
    if (s) return { level: clampLevel(s.level), xp: Math.max(0, s.xp), unlocked: s.unlocked }
    return { level: 1, xp: 0, unlocked: STARTER_HEROES.includes(id) }
  }
  isHeroUnlocked(id: string): boolean {
    return this.heroState(id).unlocked
  }

  private writeHero(id: string, s: SavedHero): void {
    this.data.heroes[id] = { level: clampLevel(s.level), xp: Math.max(0, Math.floor(s.xp)), unlocked: s.unlocked }
    this.save()
  }

  // Spend shards to unlock a locked hero. Returns true on success.
  unlockHero(id: string): boolean {
    const def = heroById(id)
    if (!def) return false
    if (this.isHeroUnlocked(id)) return false
    if (this.data.heroShards < def.unlockShards) return false
    this.data.heroShards -= def.unlockShards
    this.writeHero(id, { level: 1, xp: 0, unlocked: true })
    return true
  }

  // Level a hero up. Prefers the FREE xp path (a full bar); otherwise spends shards.
  // Returns 'xp' | 'shards' on success, or null if it can't (maxed / not enough).
  levelUpHero(id: string): 'xp' | 'shards' | null {
    if (!this.isHeroUnlocked(id)) return null
    const s = this.heroState(id)
    if (s.level >= MAX_HERO_LEVEL) return null
    const need = xpForLevel(s.level)
    if (s.xp >= need) {
      this.writeHero(id, { level: s.level + 1, xp: s.xp - need, unlocked: true })
      return 'xp'
    }
    const cost = shardCostForLevel(s.level)
    if (this.data.heroShards >= cost) {
      this.data.heroShards -= cost
      this.writeHero(id, { level: s.level + 1, xp: s.xp, unlocked: true })
      return 'shards'
    }
    return null
  }

  // Award XP to every fielded party hero + shards to the wallet (after a battle).
  awardHeroProgress(partyIds: string[], xpEach: number, shards: number): void {
    if (shards > 0) this.data.heroShards += Math.round(shards)
    const gain = Math.max(0, Math.round(xpEach))
    if (gain > 0) {
      for (const id of partyIds) {
        if (!this.isHeroUnlocked(id)) continue
        const s = this.heroState(id)
        if (s.level >= MAX_HERO_LEVEL) continue
        this.data.heroes[id] = { level: s.level, xp: s.xp + gain, unlocked: true }
      }
    }
    this.save()
  }

  // ---- loadout ----
  // Validated party: only unlocked, known heroes, deduped, capped at MAX_PARTY.
  party(): string[] {
    const out: string[] = []
    for (const id of this.data.party) {
      if (out.length >= MAX_PARTY) break
      if (out.includes(id)) continue
      if (heroById(id) && this.isHeroUnlocked(id)) out.push(id)
    }
    return out
  }
  setParty(ids: string[]): void {
    const clean: string[] = []
    for (const id of ids) {
      if (clean.length >= MAX_PARTY) break
      if (!clean.includes(id) && heroById(id) && this.isHeroUnlocked(id)) clean.push(id)
    }
    this.data.party = clean
    this.save()
  }
  // Toggle a hero in/out of the party (respecting the cap). Returns the new party.
  toggleParty(id: string): string[] {
    const cur = this.party()
    const idx = cur.indexOf(id)
    if (idx >= 0) cur.splice(idx, 1)
    else if (cur.length < MAX_PARTY && this.isHeroUnlocked(id)) cur.push(id)
    this.setParty(cur)
    return this.party()
  }

  // ---- tower unlocks ----
  isTowerUnlocked(kind: string): boolean {
    return this.data.unlockedTowers.includes(kind)
  }
  unlockTower(kind: string): void {
    if (!this.data.unlockedTowers.includes(kind)) {
      this.data.unlockedTowers.push(kind)
      this.save()
    }
  }
}

export const economy = new Economy()
