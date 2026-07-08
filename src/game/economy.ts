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
import { heroArc, emptyArcProgress, type ArcProgress, type ArcMetric, type HeroQuest } from './heroArcs'
import {
  REALM_FINALE, WYRM_ACT_REALMS, WYRM_MAX_LEVEL, RANKED_WYRM_LEVEL,
  clampWyrmLevel, wyrmXpForLevel, wyrmById, isPrismHero, bondTier, WYRM_ORDER,
} from './wyrms'
import type { SavedWyrm } from './save'
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
import { myReferralCode, isReferralCode, reportReferralEvent, REFERRAL_LADDER, type ReferralRung } from './referral'

const IDLE_CAP_MS = 8 * 60 * 60 * 1000 // 8 hours
const DAILY_DIAMONDS = 5 // diamonds drip free (~5-15/day with play)

// ---- growth-loop constants (all soft-currency / cosmetic; Ranked ignores) ----
export const WELCOME_DIAMONDS = 2000 // ≈ $35 face value at pack rates — costs us nothing
export const WELCOME_SKIN_ID = 'ts-cannon-firstlight' // exclusive starter cosmetic
export const REFERRED_DYE_ID = 'dye-referred' // referred-friend bundle upgrade

export interface WelcomeGrant {
  diamonds: number
  skinId: string
  referred: boolean // arrived on a friend's invite → bundle upgraded
  referredDyeId?: string
}

export interface SpinPrize {
  currency: 'diamonds' | 'coins' | 'prisms' | 'shards'
  amount: number
  label: string
}

// Welcome "first spin" — a one-time wheel. Every wedge is a currency Ranked
// FULLY ignores: diamonds/prisms buy only cosmetics; coins buy only casual
// Workshop nodes. No hero shards here — roster breadth stays earned-by-play, so
// the wheel can never touch Ranked in any way.
const FIRST_SPIN_PRIZES: SpinPrize[] = [
  { currency: 'diamonds', amount: 150, label: '150 💎' },
  { currency: 'coins', amount: 300, label: '300 🪙' },
  { currency: 'diamonds', amount: 250, label: '250 💎' },
  { currency: 'prisms', amount: 5, label: '5 ✦' },
  { currency: 'prisms', amount: 10, label: '10 ✦' },
  { currency: 'diamonds', amount: 500, label: '500 💎 · jackpot!' },
]

export interface StreakReward {
  diamonds?: number
  coins?: number
  prisms?: number
}
export interface StreakGrant {
  streak: number
  reward: StreakReward
  continued: boolean
  isJackpot: boolean
}
export interface LoginStreakInfo {
  streak: number
  best: number
  claimable: boolean
  nextStreak: number
  todayReward: StreakReward
  tomorrowReward: StreakReward
  cycleLength: number
}

// 7-day login cycle: escalates within the week, then loops. Diamonds are the
// premium-but-earnable currency; day 7 is the jackpot. Ranked-neutral.
const LOGIN_CYCLE: StreakReward[] = [
  { diamonds: 30 },
  { coins: 120 },
  { diamonds: 40 },
  { prisms: 1 },
  { diamonds: 50 },
  { coins: 200 },
  { diamonds: 100 }, // day-7 jackpot
]

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

  // ---- difficulty / challenge badges (separate from campaign stars) ----
  badgesFor(levelId: string): string[] {
    return this.data.badges[levelId] ?? []
  }
  hasBadge(levelId: string, badge: string): boolean {
    return (this.data.badges[levelId] ?? []).includes(badge)
  }
  totalBadges(): number {
    let n = 0
    for (const k in this.data.badges) n += this.data.badges[k].length
    return n
  }
  // Record badges earned on a mode clear; returns the newly-earned ones.
  recordBadges(levelId: string, badges: string[]): string[] {
    if (badges.length === 0) return []
    const have = new Set(this.data.badges[levelId] ?? [])
    const fresh = badges.filter((b) => !have.has(b))
    if (fresh.length === 0) return []
    for (const b of fresh) have.add(b)
    this.data.badges[levelId] = [...have]
    this.save()
    return fresh
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

  // ---- roguelike reward (coins + pass xp; NEVER touches endlessBest, so the
  //      provably-fair Ranked ladder stays pure — the roguelike is its own mode) ----
  awardRoguelike(wavesReached: number): { coins: number } {
    const meta = this.meta()
    const coins = Math.round(wavesReached * 9 * meta.coinBoost)
    this.data.coins += coins
    this.data.pass.xp += Math.min(50, wavesReached * 2)
    this.save()
    return { coins }
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
  //  GROWTH LOOP — welcome bundle, first spin, daily-login streak, referral.
  //  FAIRNESS INVARIANT: every grant below is diamonds/coins/prisms (all
  //  earnable free) or a cosmetic SKU (pure paint). The sim reads NONE of it;
  //  Ranked/Endless/daily-seed ignore all of it by construction.
  // ======================================================================

  // ---- welcome bundle (the hybrid enticement + activation hook) ----
  welcomeAvailable(): boolean {
    return !this.data.welcomeClaimed
  }
  /** Was this player brought in on a friend's ?ref= link? (drives the upgrade) */
  arrivedReferred(): boolean {
    return this.data.referredBy !== ''
  }
  /** Record the inbound referral code once (first-touch), from attribution. */
  setReferredBy(code: string): void {
    if (this.data.referredBy || !code) return
    const c = code.trim().toUpperCase().slice(0, 24)
    if (c === myReferralCode().toUpperCase()) return // never self-refer
    if (!isReferralCode(c)) return
    this.data.referredBy = c
    this.save()
  }
  /** Claim the welcome bundle. Idempotent — a second call returns null. */
  claimWelcome(): WelcomeGrant | null {
    if (this.data.welcomeClaimed) return null
    this.data.welcomeClaimed = true
    const diamonds = WELCOME_DIAMONDS
    this.data.diamonds += diamonds
    this.grantSku(WELCOME_SKIN_ID) // auto-equips (Cannon slot is empty for a new player)
    const referred = this.arrivedReferred()
    let referredDyeId: string | undefined
    if (referred) {
      this.grantSku(REFERRED_DYE_ID)
      referredDyeId = REFERRED_DYE_ID
      // BACKEND SEAM: the friend played + claimed → credit the referrer server-side.
      reportReferralEvent('friend-played', { referredBy: this.data.referredBy })
    }
    this.save()
    return { diamonds, skinId: WELCOME_SKIN_ID, referred, referredDyeId }
  }

  // ---- welcome "first spin" — a one-time wheel of SOFT rewards ----
  firstSpinAvailable(): boolean {
    return !this.data.firstSpinUsed
  }
  firstSpinPrizes(): SpinPrize[] {
    return FIRST_SPIN_PRIZES
  }
  /** Spin the welcome wheel once; grants a soft-currency prize. */
  firstSpin(): SpinPrize | null {
    if (this.data.firstSpinUsed) return null
    this.data.firstSpinUsed = true
    const prize = FIRST_SPIN_PRIZES[Math.floor(Math.random() * FIRST_SPIN_PRIZES.length)]
    if (prize.currency === 'diamonds') this.data.diamonds += prize.amount
    else if (prize.currency === 'coins') this.data.coins += prize.amount
    else if (prize.currency === 'prisms') this.data.prisms += prize.amount
    else this.data.heroShards += prize.amount
    this.save()
    return prize
  }

  // ---- daily-login streak (soft-currency; the "come back tomorrow" hook) ----
  private streakRewardFor(streakDay: number): StreakReward {
    return LOGIN_CYCLE[(Math.max(1, streakDay) - 1) % LOGIN_CYCLE.length]
  }
  loginStreakInfo(): LoginStreakInfo {
    const today = dayIndex(now())
    const claimable = today > this.data.loginLastDay
    // what the streak becomes if claimed right now
    const next = claimable
      ? (this.data.loginLastDay === today - 1 ? this.data.loginStreak + 1 : 1)
      : this.data.loginStreak
    return {
      streak: this.data.loginStreak,
      best: this.data.loginBest,
      claimable,
      nextStreak: next,
      todayReward: this.streakRewardFor(next),
      tomorrowReward: this.streakRewardFor(next + 1),
      cycleLength: LOGIN_CYCLE.length,
    }
  }
  /** Claim today's login reward, advancing (or resetting) the streak. */
  claimLoginStreak(): StreakGrant | null {
    const today = dayIndex(now())
    if (today <= this.data.loginLastDay) return null
    const continued = this.data.loginLastDay === today - 1
    const streak = continued ? this.data.loginStreak + 1 : 1
    this.data.loginStreak = streak
    this.data.loginLastDay = today
    if (streak > this.data.loginBest) this.data.loginBest = streak
    const reward = this.streakRewardFor(streak)
    if (reward.diamonds) this.data.diamonds += reward.diamonds
    if (reward.coins) this.data.coins += reward.coins
    if (reward.prisms) this.data.prisms += reward.prisms
    this.save()
    return { streak, reward, continued, isJackpot: streak % LOGIN_CYCLE.length === 0 }
  }

  // ---- referral ladder (referrer side; BACKEND-gated friend count) ----
  get referralFriends(): number {
    return this.data.referralFriends
  }
  /** State of every rung for the referral UI (unlocked = server-confirmed count). */
  referralLadderState(): Array<{ rung: ReferralRung; unlocked: boolean; claimed: boolean }> {
    return REFERRAL_LADDER.map((rung, i) => ({
      rung,
      unlocked: this.data.referralFriends >= rung.friends,
      claimed: this.data.referralTiersClaimed > i,
    }))
  }
  /** Claim a referral rung. Only possible when the backend has confirmed enough
   *  friends — offline, `referralFriends` stays 0, so nothing is ever fabricated. */
  claimReferralRung(index: number): boolean {
    const rung = REFERRAL_LADDER[index]
    if (!rung) return false
    if (this.data.referralTiersClaimed > index) return false
    if (this.data.referralFriends < rung.friends) return false
    if (this.data.referralTiersClaimed !== index) return false // claim in order
    this.data.referralTiersClaimed = index + 1
    if (rung.diamonds) this.data.diamonds += rung.diamonds
    if (rung.sku) this.grantSku(rung.sku)
    this.save()
    return true
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

  // ---- hero ARCS (cosmetic / lore progression; never touches the sim) --------

  /** Read a hero's arc progress (defensive copy; empty default for untouched heroes). */
  arcProgress(id: string): ArcProgress {
    const raw = this.data.heroArcs[id]
    if (!raw) return emptyArcProgress()
    return { metrics: { ...raw.metrics }, quests: [...raw.quests], beats: Math.max(0, Math.floor(raw.beats)) }
  }

  private writeArc(id: string, p: ArcProgress): void {
    this.data.heroArcs[id] = { metrics: { ...p.metrics }, quests: [...p.quests], beats: Math.max(0, Math.floor(p.beats)) }
  }

  // beat count derives from state: 0 until awakened, then 1 (awakening) + quests done.
  private syncArcBeats(arc: ReturnType<typeof heroArc>, p: ArcProgress): void {
    if (!arc || p.beats < 1) return // not awakened yet — beats stay at 0
    p.beats = Math.min(arc.beats.length, 1 + p.quests.length)
  }

  /** Lv-3 awakening: unlock the first story beat (idempotent). */
  unlockArcAwakening(id: string): void {
    const arc = heroArc(id)
    if (!arc) return
    const p = this.arcProgress(id)
    if (p.beats >= 1) return
    p.beats = 1
    this.syncArcBeats(arc, p)
    this.writeArc(id, p)
    this.save()
  }

  /**
   * Add `n` to a hero's arc METRIC and settle any quests it completes. Returns the
   * quests newly completed by this call (for a reward toast). Cosmetic/lore only.
   */
  addArcMetric(id: string, metric: ArcMetric, n = 1): HeroQuest[] {
    const arc = heroArc(id)
    if (!arc || n <= 0) return []
    const p = this.arcProgress(id)
    p.metrics[metric] = (p.metrics[metric] ?? 0) + n
    const fresh: HeroQuest[] = []
    for (const q of arc.quests) {
      if (p.quests.includes(q.id)) continue
      if ((p.metrics[q.metric] ?? 0) >= q.goal) { p.quests.push(q.id); fresh.push(q) }
    }
    this.syncArcBeats(arc, p)
    this.writeArc(id, p)
    this.save()
    return fresh
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
  rankedParty(): Array<{ heroId: string; level: number; wyrm?: { wyrmId: string; level: number } }> {
    return this.validateParty(this.data.party).map((id) => ({
      heroId: id, level: RANKED_HERO_LEVEL, wyrm: this.rankedBondEntry(id),
    }))
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

  // ======================================================================
  //  CHROMATIC WYRMS — companion dragons + the hero↔dragon BOND.
  //  FAIRNESS: discovery is EARNED (gated on realm restoration), growth is
  //  EARNED (play awards XP), and RANKED NORMALIZES the Wyrm's level so no
  //  grind/purchase changes ranked strength. Skins are the only store items.
  // ======================================================================

  // Persisted growth for a Wyrm (defaults to a fresh hatchling).
  wyrmState(id: string): SavedWyrm {
    const s = this.data.wyrms[id]
    if (s) return { level: clampWyrmLevel(s.level), xp: Math.max(0, s.xp) }
    return { level: 1, xp: 0 }
  }
  wyrmXpProgress(id: string): { xp: number; need: number } {
    const s = this.wyrmState(id)
    return { xp: s.xp, need: wyrmXpForLevel(s.level) }
  }

  // How many realms are RESTORED (their Keeper finale cleared). Drives the gate.
  realmsRestored(): number {
    let n = 0
    for (const finaleId of Object.values(REALM_FINALE)) {
      if (this.data.firstClears[finaleId]) n++
    }
    return n
  }
  // The late act — "The Waking of the Wyrms" — unlocks once enough realms return.
  wyrmsAwakened(): boolean {
    return this.realmsRestored() >= WYRM_ACT_REALMS
  }
  // A Wyrm is discovered when the act is open AND its own realm is restored.
  wyrmDiscovered(wyrmId: string): boolean {
    if (!this.wyrmsAwakened()) return false
    const w = wyrmById(wyrmId)
    if (!w) return false
    return this.data.firstClears[REALM_FINALE[w.realmId]] === true
  }
  discoveredWyrms(): string[] {
    if (!this.wyrmsAwakened()) return []
    return WYRM_ORDER.filter((id) => this.wyrmDiscovered(id))
  }
  wyrmActSeen(): boolean {
    return this.data.wyrmActSeen === true
  }
  markWyrmActSeen(): void {
    if (!this.data.wyrmActSeen) { this.data.wyrmActSeen = true; this.save() }
  }

  // The bonded Wyrm for a hero (validated: only a DISCOVERED Wyrm counts).
  bondFor(heroId: string): string | null {
    const w = this.data.bonds[heroId]
    return w && this.wyrmDiscovered(w) ? w : null
  }
  // Assign (or clear) a hero's bonded Wyrm. A Wyrm bonds to at most one hero at a
  // time (like a pet) — assigning it elsewhere unbinds the previous holder. Fizz
  // (Prism Bond) may swap freely; any hero may re-bond any discovered Wyrm.
  setBond(heroId: string, wyrmId: string | null): boolean {
    if (!heroById(heroId)) return false
    if (!wyrmId) { delete this.data.bonds[heroId]; this.save(); return true }
    if (!this.wyrmDiscovered(wyrmId)) return false
    for (const [hid, wid] of Object.entries(this.data.bonds)) {
      if (wid === wyrmId && hid !== heroId) delete this.data.bonds[hid]
    }
    this.data.bonds[heroId] = wyrmId
    this.save()
    return true
  }

  // Sim loadout entry for a hero's bonded Wyrm (casual: earned level). undefined
  // when unbonded/undiscovered, so no companion reaches the sim.
  bondEntry(heroId: string): { wyrmId: string; level: number } | undefined {
    const w = this.bondFor(heroId)
    if (!w) return undefined
    return { wyrmId: w, level: this.wyrmState(w).level }
  }
  // RANKED loadout entry — the Wyrm's level is NORMALIZED to a constant, so
  // grinding or buying never changes ranked companion power (the constitution).
  rankedBondEntry(heroId: string): { wyrmId: string; level: number } | undefined {
    const w = this.bondFor(heroId)
    if (!w) return undefined
    return { wyrmId: w, level: RANKED_WYRM_LEVEL }
  }

  // Award XP to the bonded Wyrms of the fielded party (auto-levels, like heroes).
  awardWyrmProgress(wyrmIds: string[], xp: number): void {
    const gain = Math.max(0, Math.round(xp))
    if (gain <= 0) return
    let touched = false
    for (const id of wyrmIds) {
      if (!wyrmById(id)) continue
      const s = this.wyrmState(id)
      let level = s.level
      let cur = s.xp + gain
      while (level < WYRM_MAX_LEVEL) {
        const need = wyrmXpForLevel(level)
        if (cur < need) break
        cur -= need
        level++
      }
      if (level >= WYRM_MAX_LEVEL) cur = 0
      this.data.wyrms[id] = { level: clampWyrmLevel(level), xp: Math.max(0, Math.floor(cur)) }
      touched = true
    }
    if (touched) this.save()
  }

  // The best available Wyrm for a hero to bond next (its Perfect if discovered,
  // else the tightest discovered tier) — powers the Bond screen's suggestion.
  suggestedWyrm(heroId: string): string | null {
    if (isPrismHero(heroId)) {
      const d = this.discoveredWyrms()
      return d.length ? d[0] : null
    }
    let best: string | null = null
    let bestRank = -1
    const rank: Record<string, number> = { perfect: 2, good: 1, regular: 0 }
    for (const id of this.discoveredWyrms()) {
      const r = rank[bondTier(heroId, id)] ?? 0
      if (r > bestRank) { bestRank = r; best = id }
    }
    return best
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
