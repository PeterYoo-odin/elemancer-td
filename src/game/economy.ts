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
import {
  skuById,
  passTierForXp,
  PASS_SEASON,
  PASS_TIERS,
  PASS_TRACK,
  PASS_PREMIUM_DIAMONDS,
  type PassReward,
  type Sku,
} from './cosmetics'

const IDLE_CAP_MS = 8 * 60 * 60 * 1000 // 8 hours
const DAILY_DIAMONDS = 5 // diamonds drip free (~5-15/day with play)

// RANKED NORMALIZATION: endless ignores hero progression — every fielded hero
// plays at this fixed level, so no purchase OR grind buys ranked power.
export const RANKED_HERO_LEVEL = 5

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
    // New season (or first run): reset pass progress to the current season.
    if (this.data.pass.season !== PASS_SEASON) {
      this.data.pass = { season: PASS_SEASON, xp: 0, premium: false, freeClaimed: 0, premClaimed: 0 }
    }
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

  get prisms(): number {
    return this.data.prisms
  }
  addPrisms(n: number): void {
    if (n <= 0) return
    this.data.prisms += Math.round(n)
    this.save()
  }

  // ======================================================================
  //  STORE — cosmetics + casual convenience. FAIRNESS INVARIANT: nothing in
  //  this section is readable by the sim; Ranked cannot see any of it.
  // ======================================================================
  owns(id: string): boolean {
    return this.data.owned.includes(id)
  }

  /** SKU id equipped in a slot ('tower:cannon', 'hero:ember', 'dye', …). */
  equippedIn(slot: string): string | null {
    return this.data.equipped[slot] ?? null
  }

  /** Purchase gate check (e.g. Redeemed-Keeper skins need that Keeper freed). */
  skuGateOpen(sku: Sku): boolean {
    if (!sku.gate) return true
    return this.data.firstClears[sku.gate.levelClear] === true
  }

  /** Buy a shelf SKU with diamonds/prisms. Auto-equips cosmetics. */
  buySku(id: string): boolean {
    const sku = skuById(id)
    if (!sku || this.owns(id) || sku.passExclusive) return false
    if (!this.skuGateOpen(sku)) return false
    const wallet = sku.currency === 'prisms' ? this.data.prisms : this.data.diamonds
    if (wallet < sku.price) return false
    if (sku.currency === 'prisms') this.data.prisms -= sku.price
    else this.data.diamonds -= sku.price
    this.grantSku(id)
    return true
  }

  /** Own a SKU without paying (pass rewards). Auto-equips cosmetics. */
  grantSku(id: string): void {
    const sku = skuById(id)
    if (!sku) return
    if (!this.data.owned.includes(id)) this.data.owned.push(id)
    if (sku.slot && !this.data.equipped[sku.slot]) this.data.equipped[sku.slot] = id
    this.save()
  }

  /** Equip an owned SKU into its slot; pass null-ish to just re-save. */
  equipSku(id: string): boolean {
    const sku = skuById(id)
    if (!sku || !sku.slot || !this.owns(id)) return false
    this.data.equipped[sku.slot] = id
    this.save()
    return true
  }

  unequipSlot(slot: string): void {
    delete this.data.equipped[slot]
    this.save()
  }

  isEquipped(id: string): boolean {
    const sku = skuById(id)
    return !!sku?.slot && this.data.equipped[sku.slot] === id
  }

  // ---- casual convenience (meta-economy only; Ranked never reads these) ----
  private hasIdle2x(): boolean {
    return this.owns('conv-idle2x')
  }
  hasAutoCollect(): boolean {
    return this.owns('conv-autocollect')
  }

  // ---- loadout slots (casual presets; Ranked ALWAYS uses slot 1) ----
  loadoutSlots(): number {
    return 1 + (this.owns('conv-slot2') ? 1 : 0) + (this.owns('conv-slot3') ? 1 : 0)
  }
  activeLoadout(): number {
    return Math.min(this.data.activeLoadout, this.loadoutSlots() - 1)
  }
  setActiveLoadout(i: number): void {
    this.data.activeLoadout = Math.max(0, Math.min(this.loadoutSlots() - 1, Math.floor(i)))
    this.save()
  }
  private rawParty(slot: number): string[] {
    if (slot <= 0) return this.data.party
    return this.data.loadouts[slot - 1] ?? []
  }
  private writeParty(slot: number, ids: string[]): void {
    if (slot <= 0) this.data.party = ids
    else {
      while (this.data.loadouts.length < slot) this.data.loadouts.push([])
      this.data.loadouts[slot - 1] = ids
    }
  }

  // ======================================================================
  //  PRISM PASS — advances by PLAY only. There is no XP purchase path.
  // ======================================================================
  get passXp(): number {
    return this.data.pass.xp
  }
  get passPremium(): boolean {
    return this.data.pass.premium
  }
  passTier(): number {
    return passTierForXp(this.data.pass.xp)
  }
  addPassXp(n: number): void {
    if (n <= 0) return
    this.data.pass.xp += Math.round(n)
    this.save()
  }
  /** Unlock premium with diamonds (diamonds are earnable free). */
  unlockPassPremium(): boolean {
    if (this.data.pass.premium) return false
    if (!this.spend('diamonds', PASS_PREMIUM_DIAMONDS)) return false
    this.data.pass.premium = true
    this.save()
    return true
  }
  /** Tiers claimable right now on each track. */
  passClaimable(): { free: number; premium: number } {
    const tier = this.passTier()
    return {
      free: Math.max(0, tier - this.data.pass.freeClaimed),
      premium: this.data.pass.premium ? Math.max(0, tier - this.data.pass.premClaimed) : 0,
    }
  }
  /** Claim everything available; returns the granted rewards for the UI. */
  claimPassRewards(): PassReward[] {
    const tier = this.passTier()
    const granted: PassReward[] = []
    const apply = (r: PassReward) => {
      if (r.coins) this.data.coins += r.coins
      if (r.diamonds) this.data.diamonds += r.diamonds
      if (r.prisms) this.data.prisms += r.prisms
      if (r.sku) this.grantSku(r.sku)
      granted.push(r)
    }
    while (this.data.pass.freeClaimed < Math.min(tier, PASS_TIERS)) {
      apply(PASS_TRACK[this.data.pass.freeClaimed].free)
      this.data.pass.freeClaimed++
    }
    if (this.data.pass.premium) {
      while (this.data.pass.premClaimed < Math.min(tier, PASS_TIERS)) {
        apply(PASS_TRACK[this.data.pass.premClaimed].premium)
        this.data.pass.premClaimed++
      }
    }
    this.save()
    return granted
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
    // Prism Pass advances by PLAY only (see PASS_DUTIES in cosmetics.ts).
    if (stars >= 1) this.data.pass.xp += 12 + 6 * gainedStars + (firstClear ? 10 : 0)
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
    // Playing Ranked also feeds the pass — earning is fine; SPENDING can't touch it.
    this.data.pass.xp += Math.min(40, wavesReached * 2)
    this.save()
    return { coins, best }
  }

  // ---- idle offline earnings ----
  idlePreview(): IdleReport {
    const last = this.data.lastSeen
    if (!last) return { coins: 0, seconds: 0, capped: false }
    const rawMs = now() - last
    if (rawMs <= 0) return { coins: 0, seconds: 0, capped: false }
    // Store convenience (CASUAL meta only): auto-collect stretches the offline
    // cap 8h→24h; 2× idle doubles the rate. Neither is readable by the sim.
    const capMs = this.hasAutoCollect() ? IDLE_CAP_MS * 3 : IDLE_CAP_MS
    const capped = rawMs > capMs
    const ms = Math.min(rawMs, capMs)
    const meta = this.meta()
    const perMs = (meta.idlePerMin * meta.idleBoost * meta.coinBoost * (this.hasIdle2x() ? 2 : 1)) / 60000
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
  // Reads the ACTIVE casual loadout slot (slot 1 unless extra slots are owned).
  party(): string[] {
    return this.validateParty(this.rawParty(this.activeLoadout()))
  }
  private validateParty(ids: string[]): string[] {
    const out: string[] = []
    for (const id of ids) {
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
    this.writeParty(this.activeLoadout(), clean)
    this.save()
  }

  // RANKED loadout: ALWAYS slot 1, hero levels normalized — no purchase and no
  // grind changes ranked hero strength. This is the constitution, in code.
  rankedParty(): Array<{ heroId: string; level: number }> {
    return this.validateParty(this.data.party).map((id) => ({ heroId: id, level: RANKED_HERO_LEVEL }))
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
