// ADMIN DATA LAYER — the typed contract between the dashboard and the game
// backend, plus a deterministic synthetic generator for DEMO mode.
//
// Because the backend seam (window.__CHROMANCER_BACKEND__) is not configured in
// this build, DEMO mode is what the operator actually sees — so the synthetic
// data is a first-class deliverable, not a stub. Every series is derived from a
// SEEDED PRNG (rng.ts) keyed on (section, range) so charts never jitter between
// renders or tab-switches. When a backend IS present, each getter tries the
// authorised admin endpoint first and falls back to the same synthetic shape,
// guaranteeing the dashboard never crashes on a degraded/unconfigured backend.
//
// Privacy: analytics are coarse aggregates (no emails/PHI, country-level geo).
// The integrity views legitimately surface game ACCOUNT ids (not personal data)
// — that is the point of a cheat/abuse watchlist.

import { makeRand, type Rand } from './rng'
import { adminGet, type AdminSession, type RangeDays } from './config'
import { dayLabel } from './theme'

const MS_DAY = 86_400_000

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------
export interface Kpi {
  value: number
  delta: number // fractional change vs prior period
  spark: number[]
}
export interface NamedSeries {
  name: string
  values: number[]
}

// Real game vocabulary — makes the synthetic data legible to the owner.
const SOURCES = [
  { key: 'organic', label: 'Organic / direct', weight: 0.24 },
  { key: 'yt_shorts', label: 'YouTube Shorts', weight: 0.18 },
  { key: 'tiktok', label: 'TikTok', weight: 0.15 },
  { key: 'reddit', label: 'Reddit r/tounofdefense', weight: 0.09 },
  { key: 'referral', label: 'Referral (friend invite)', weight: 0.12 },
  { key: 'portal_crazygames', label: 'CrazyGames portal', weight: 0.11 },
  { key: 'portal_poki', label: 'Poki portal', weight: 0.06 },
  { key: 'twitter', label: 'X / Twitter', weight: 0.05 },
]
const CAMPAIGNS = ['launch_wk1', 'emberwaste_event', 'provably_fair', 'seed_share', 'creator_kit']
const COUNTRIES = [
  ['US', 'United States'], ['BR', 'Brazil'], ['DE', 'Germany'], ['GB', 'United Kingdom'],
  ['PH', 'Philippines'], ['IN', 'India'], ['FR', 'France'], ['CA', 'Canada'],
  ['ID', 'Indonesia'], ['JP', 'Japan'], ['MX', 'Mexico'], ['PL', 'Poland'],
]
const REALMS = ['Emberwaste', 'Frostreach', 'Stormpeaks', 'Verdant Wilds', 'Lumen Sanctum', 'The Hollow']

function daysAxis(range: RangeDays, now: number): string[] {
  const out: string[] = []
  for (let i = range - 1; i >= 0; i--) out.push(dayLabel(i, now))
  return out
}

/** A smooth-ish growth series with weekly seasonality + noise. */
function growthSeries(r: Rand, len: number, start: number, driftPerDay: number, weeklyAmp = 0.12): number[] {
  const out: number[] = []
  let base = start
  for (let i = 0; i < len; i++) {
    base *= 1 + driftPerDay
    const weekend = Math.sin((i / 7) * Math.PI * 2) * weeklyAmp
    out.push(Math.max(0, Math.round(base * (1 + weekend) * r.jitter(0.08))))
  }
  return out
}

function sparkOf(values: number[], n = 12): number[] {
  return values.slice(-n)
}
function deltaOf(values: number[]): number {
  const h = Math.floor(values.length / 2)
  if (h < 1) return 0
  const prev = values.slice(0, h).reduce((a, b) => a + b, 0) / h
  const cur = values.slice(h).reduce((a, b) => a + b, 0) / (values.length - h)
  return prev > 0 ? (cur - prev) / prev : 0
}

// ===========================================================================
// 1) ACQUISITION & PLAYERS
// ===========================================================================
export interface SourceRow {
  key: string
  label: string
  players: number
  d1: number // D1 retention for that source cohort
  convToActivation: number
}
export interface ReferrerRow {
  code: string
  invited: number
  activated: number
  tier: string
}
export interface GeoRow {
  cc: string
  country: string
  players: number
  share: number
}
export interface OverviewData {
  dau: Kpi
  wau: Kpi
  mau: Kpi
  newPlayers: Kpi
  stickiness: Kpi // DAU/MAU
  avgSessionSec: Kpi
  labels: string[]
  newVsReturning: NamedSeries[] // [new, returning]
  dauSeries: number[]
  sources: SourceRow[]
  campaigns: { name: string; players: number }[]
  referrers: ReferrerRow[]
  referralTotals: { invitesSent: number; friendsActivated: number; kFactor: number }
  geo: GeoRow[]
  platform: { label: string; value: number }[] // web / PWA / portal
  os: { label: string; value: number }[]
}

function demoOverview(range: RangeDays, now: number): OverviewData {
  const r = makeRand(`overview:${range}`) // series shape + window-total tables (range-dependent, correctly)
  const rBase = makeRand('overview:base') // range-INDEPENDENT anchors so DAU/WAU/MAU don't swing when the operator flips the range selector
  const labels = daysAxis(range, now)
  // Anchor "today" to values that DON'T depend on the selected window: build the
  // range-seeded trend SHAPES, then scale each so it ENDS at a fixed rBase target.
  // The chart's last point and the KPI tile stay consistent AND range-stable, so
  // flipping 7d↔90d doesn't change the headline DAU/WAU/MAU numbers.
  const shape = growthSeries(r, range, 420, 0.012)
  const retShape = shape.map((v, i) => Math.round(v * (1.6 + Math.sin(i / 5) * 0.2) * r.jitter(0.05)))
  const todayNew = Math.round(rBase.range(430, 610))
  const todayDau = todayNew + Math.round(rBase.range(780, 1000)) // returning stacks on top → DAU ≈ 1.2–1.6k
  const nScale = shape[shape.length - 1] > 0 ? todayNew / shape[shape.length - 1] : 1
  const rScale = retShape[retShape.length - 1] > 0 ? (todayDau - todayNew) / retShape[retShape.length - 1] : 1
  const newP = shape.map((v) => Math.max(0, Math.round(v * nScale)))
  const returning = retShape.map((v) => Math.max(0, Math.round(v * rScale)))
  const dauSeries = newP.map((v, i) => v + returning[i])
  const mkKpi = (series: number[]): Kpi => ({ value: Math.round(series[series.length - 1]), delta: deltaOf(series), spark: sparkOf(series) })
  const dau = mkKpi(dauSeries)
  const mauVal = Math.round(todayDau * rBase.range(11, 14)) // DAU/MAU stickiness ≈ 7–9%
  const wauVal = Math.round(todayDau * rBase.range(4, 5))
  const sessSeries = Array.from({ length: range }, () => Math.round(r.range(360, 620)))
  const todaySession = Math.round(rBase.range(380, 560))

  const totalNew = newP.reduce((a, b) => a + b, 0)
  const sources: SourceRow[] = SOURCES.map((s) => ({
    key: s.key,
    label: s.label,
    players: Math.round(totalNew * s.weight * r.jitter(0.06)),
    d1: r.range(s.key === 'referral' ? 0.42 : s.key.startsWith('portal') ? 0.22 : 0.3, s.key === 'referral' ? 0.52 : 0.4),
    convToActivation: r.range(0.4, 0.72),
  })).sort((a, b) => b.players - a.players)

  const referrers: ReferrerRow[] = Array.from({ length: 8 }, (_, i) => {
    const invited = Math.round(r.range(3, 40) * (1 - i * 0.08))
    const activated = Math.round(invited * r.range(0.35, 0.7))
    const tier = activated >= 10 ? '10 · Legendary dye' : activated >= 5 ? '5 · Auric skin' : activated >= 3 ? '3 · Restorer frame' : activated >= 1 ? '1 · 300💎' : '—'
    return { code: `RSTR-${(r.int(0, 0xffff)).toString(16).toUpperCase().padStart(4, '0')}`, invited, activated, tier }
  }).sort((a, b) => b.activated - a.activated)

  const geoRaw = COUNTRIES.map(([cc, country]) => ({ cc, country, players: Math.round(totalNew * r.range(0.02, 0.2)) }))
  const geoTotal = geoRaw.reduce((a, g) => a + g.players, 0)
  const geo: GeoRow[] = geoRaw.map((g) => ({ ...g, share: g.players / geoTotal })).sort((a, b) => b.players - a.players)

  return {
    dau,
    wau: { value: wauVal, delta: deltaOf(dauSeries) * 0.7, spark: sparkOf(dauSeries) },
    mau: { value: mauVal, delta: 0.18, spark: sparkOf(dauSeries) },
    newPlayers: mkKpi(newP),
    stickiness: { value: Math.round((dau.value / Math.max(1, mauVal)) * 1000) / 10, delta: 0.03, spark: sparkOf(newP) },
    avgSessionSec: { value: todaySession, delta: deltaOf(sessSeries), spark: sparkOf(sessSeries) },
    labels,
    newVsReturning: [
      { name: 'New players', values: newP },
      { name: 'Returning', values: returning },
    ],
    dauSeries,
    sources,
    campaigns: CAMPAIGNS.map((name) => ({ name, players: Math.round(totalNew * r.range(0.04, 0.16)) })).sort((a, b) => b.players - a.players),
    referrers,
    referralTotals: {
      invitesSent: referrers.reduce((a, x) => a + x.invited, 0) * 6,
      friendsActivated: referrers.reduce((a, x) => a + x.activated, 0) * 6,
      kFactor: Math.round(r.range(0.18, 0.34) * 100) / 100,
    },
    geo,
    platform: [
      { label: 'Web (browser)', value: 62 },
      { label: 'PWA (installed)', value: 21 },
      { label: 'Portal embed', value: 17 },
    ],
    os: [
      { label: 'Android', value: 38 },
      { label: 'Windows', value: 27 },
      { label: 'iOS', value: 21 },
      { label: 'macOS', value: 9 },
      { label: 'Other', value: 5 },
    ],
  }
}

// ===========================================================================
// 2) RETENTION & FUNNEL
// ===========================================================================
export interface FunnelStep {
  label: string
  value: number
}
export interface LevelDropRow {
  levelId: string
  name: string
  realm: string
  starts: number
  clears: number
  clearRate: number
  topDefeatReason: string
}
export interface RetentionData {
  cohortLabels: string[]
  dayHeaders: number[]
  cohortMatrix: (number | null)[][]
  benchmark: { d1: number; d7: number; d30: number } // targets
  actual: { d1: number; d7: number; d30: number }
  onboarding: FunnelStep[]
  levelDrop: LevelDropRow[]
  worldCompletion: { realm: string; started: number; completed: number }[]
  defeatReasons: { reason: string; count: number }[]
}

const DEFEAT_REASONS = ['Leaked on a fast wave', 'Under-leveled towers', 'Wrong element vs boss', 'No AoE for swarm', 'Economy starved early', 'Missed a reaction combo']

function demoRetention(range: RangeDays, now: number): RetentionData {
  const r = makeRand(`retention:${range}`)
  // Spread ~14 cohort rows across the FULL window so the oldest cohort's age
  // reaches the widest day-header — and only show headers the oldest cohort can
  // actually fill (so no column is permanently blank).
  const maxAge = Math.max(1, range - 1)
  const dayHeaders = [0, 1, 3, 7, 14, 30].filter((d) => d <= maxAge)
  const rows = Math.min(range, 14)
  const cohortLabels: string[] = []
  const cohortMatrix: (number | null)[][] = []
  for (let ri = 0; ri < rows; ri++) {
    // ri=0 → oldest cohort (top of the triangle), ri=rows-1 → today
    const ageDays = Math.round(((rows - 1 - ri) / Math.max(1, rows - 1)) * maxAge)
    cohortLabels.push(dayLabel(ageDays, now))
    const row: (number | null)[] = dayHeaders.map((d) => {
      if (d > ageDays) return null // future — no data yet for this cohort
      const base = d === 0 ? 1 : 0.34 * Math.pow(d, -0.42) // decaying retention curve
      return Math.max(0.01, Math.min(1, base * r.jitter(0.12)))
    })
    cohortMatrix.push(row)
  }

  const onboarding: FunnelStep[] = [
    { label: 'Landed (click → load)', value: 10000 },
    { label: 'Reached menu', value: 9120 },
    { label: 'Started first battle', value: 7840 },
    { label: 'Placed first tower', value: 7290 },
    { label: 'First "wow" (first reaction)', value: 6010 },
    { label: 'Cleared level 1', value: 4980 },
    { label: 'Cleared world 1', value: 2740 },
    { label: 'Welcome bundle claimed (activation)', value: 2210 },
    { label: 'Returned day 2', value: 1180 },
  ].map((s) => ({ ...s, value: Math.round(s.value * r.jitter(0.03)) }))

  const levelDrop: LevelDropRow[] = [
    { id: 'l1', name: 'The Cold Forge', realm: 'Emberwaste' },
    { id: 'w0_3', name: 'Molten Throne Descent', realm: 'Emberwaste' },
    { id: 'w0_finale', name: 'Emberwaste Finale', realm: 'Emberwaste' },
    { id: 'l2', name: 'Frostreach Gate', realm: 'Frostreach' },
    { id: 'w1_7', name: 'Glacier Spillway', realm: 'Frostreach' },
    { id: 'l3', name: 'Stormpeaks Ascent', realm: 'Stormpeaks' },
    { id: 'w2_12', name: 'Thunderhead Vault', realm: 'Stormpeaks' },
    { id: 'l4', name: 'Verdant Threshold', realm: 'Verdant Wilds' },
    { id: 'l5', name: 'Lumen Approach', realm: 'Lumen Sanctum' },
    { id: 'l6', name: 'The Hollow', realm: 'The Hollow' },
  ].map((l, i) => {
    const starts = Math.round(5200 * Math.pow(0.86, i) * r.jitter(0.05))
    const clearRate = Math.max(0.28, Math.min(0.96, (0.9 - i * 0.05) * r.jitter(0.06)))
    return { levelId: l.id, name: l.name, realm: l.realm, starts, clears: Math.round(starts * clearRate), clearRate, topDefeatReason: r.pick(DEFEAT_REASONS) }
  })

  const worldCompletion = REALMS.map((realm, i) => {
    const started = Math.round(5000 * Math.pow(0.72, i) * r.jitter(0.04))
    return { realm, started, completed: Math.round(started * r.range(0.35, 0.7)) }
  })

  const defeatReasons = DEFEAT_REASONS.map((reason) => ({ reason, count: Math.round(r.range(300, 2400)) })).sort((a, b) => b.count - a.count)

  return {
    cohortLabels,
    dayHeaders,
    cohortMatrix,
    benchmark: { d1: 0.35, d7: 0.12, d30: 0.05 },
    actual: { d1: 0.33, d7: 0.11, d30: 0.046 },
    onboarding,
    levelDrop,
    worldCompletion,
    defeatReasons,
  }
}

// ===========================================================================
// 3) ECONOMY & MONETIZATION
// ===========================================================================
export interface EconomyData {
  labels: string[]
  diamondsEarned: number[] // faucet
  diamondsSpent: number[] // sink
  faucets: NamedSeries[] // welcome, referral, drip, pass rebate
  sinks: NamedSeries[] // skins, dyes, convenience, pass premium
  welcomeClaims: Kpi
  referralPayouts: Kpi
  storeViews: Kpi
  storeConversion: Kpi // views → purchase
  arpdauCents: Kpi
  grossRevenueCents: number[]
  packSales: { id: string; usd: string; units: number; grossCents: number }[]
  topCosmetics: { id: string; name: string; owners: number; adoption: number }[]
  passProgress: { tier: number; players: number }[] // distribution across pass tiers
  passPremiumRate: number
  chargebackRate: number
  refundRate: number
  balanceDistribution: { bucket: string; players: number }[]
}

const PACKS = [
  { id: 'pack-60', usd: '$1.99', cents: 199 },
  { id: 'pack-100', usd: '$2.99', cents: 299 },
  { id: 'pack-250', usd: '$5.99', cents: 599 },
  { id: 'pack-600', usd: '$12.99', cents: 1299 },
  { id: 'pack-1400', usd: '$24.99', cents: 2499 },
  { id: 'pack-3200', usd: '$49.99', cents: 4999 },
]
const COSMETICS = [
  ['ts-cannon-rose', 'Rosequartz Cannon'], ['ts-frost-aurora', 'Aurora Frost'], ['ts-flame-viridian', 'Viridian Fire'],
  ['ts-storm-ion', 'Ion Storm'], ['hs-ember-solar', 'Solarflare Ember'], ['dye-ember', 'Emberwaste Dye'],
  ['bn-emberwaste', 'Emberwaste Banner'], ['sv-meteor-azure', 'Azure Comet'], ['fr-gilded', 'Gilded Frame'],
]

function demoEconomy(range: RangeDays, now: number): EconomyData {
  const r = makeRand(`economy:${range}`)
  const labels = daysAxis(range, now)
  const welcome = growthSeries(r, range, 3000, 0.01)
  const referral = growthSeries(r, range, 900, 0.012)
  const drip = growthSeries(r, range, 1400, 0.006)
  const passReb = growthSeries(r, range, 700, 0.008)
  const skins = growthSeries(r, range, 2100, 0.014)
  const dyes = growthSeries(r, range, 800, 0.01)
  const conv = growthSeries(r, range, 500, 0.008)
  const passPrem = growthSeries(r, range, 600, 0.01)
  const diamondsEarned = welcome.map((v, i) => v + referral[i] + drip[i] + passReb[i])
  const diamondsSpent = skins.map((v, i) => v + dyes[i] + conv[i] + passPrem[i])
  const gross = skins.map((_, i) => Math.round((skins[i] * 4 + passPrem[i] * 6) * r.jitter(0.1)))
  const dauApprox = 1400
  const arpdau = gross.map((g) => Math.round((g / dauApprox) * 100) / 100)

  const mkKpi = (s: number[]): Kpi => ({ value: s[s.length - 1], delta: deltaOf(s), spark: sparkOf(s) })
  const welcomeClaimsSeries = growthSeries(r, range, 380, 0.011)
  const viewsSeries = growthSeries(r, range, 5200, 0.009)
  const convRateSeries = viewsSeries.map((v, i) => Math.round((conv[i] / Math.max(1, v)) * 1000) / 10)

  return {
    labels,
    diamondsEarned,
    diamondsSpent,
    faucets: [
      { name: 'Welcome bundle', values: welcome },
      { name: 'Referral payouts', values: referral },
      { name: 'Daily drip', values: drip },
      { name: 'Pass rebates', values: passReb },
    ],
    sinks: [
      { name: 'Skins', values: skins },
      { name: 'Dyes / banners', values: dyes },
      { name: 'Convenience (casual)', values: conv },
      { name: 'Pass premium', values: passPrem },
    ],
    welcomeClaims: mkKpi(welcomeClaimsSeries),
    referralPayouts: mkKpi(referral),
    storeViews: mkKpi(viewsSeries),
    storeConversion: { value: convRateSeries[convRateSeries.length - 1], delta: deltaOf(convRateSeries), spark: sparkOf(convRateSeries) },
    // `arpdau` is already cents-per-DAU (grossCents / DAU) — feed it straight to
    // fmtUsd (which divides by 100), NOT ×100 which would over-report ~100×.
    arpdauCents: { value: arpdau[arpdau.length - 1], delta: deltaOf(gross), spark: sparkOf(gross) },
    grossRevenueCents: gross,
    packSales: PACKS.map((p) => {
      const units = Math.round(r.range(20, 320) * (p.cents < 600 ? 1.4 : 0.7))
      return { id: p.id, usd: p.usd, units, grossCents: units * p.cents }
    }),
    topCosmetics: COSMETICS.map(([id, name]) => {
      const owners = Math.round(r.range(200, 3200))
      return { id, name, owners, adoption: owners / 12000 }
    }).sort((a, b) => b.owners - a.owners),
    passProgress: Array.from({ length: 30 }, (_, i) => ({ tier: i + 1, players: Math.round(2600 * Math.pow(0.9, i) * r.jitter(0.08)) })),
    passPremiumRate: r.range(0.06, 0.11),
    chargebackRate: r.range(0.002, 0.008),
    refundRate: r.range(0.01, 0.03),
    balanceDistribution: [
      { bucket: '0', players: 4200 },
      { bucket: '1–200', players: 3100 },
      { bucket: '201–1k', players: 2400 },
      { bucket: '1k–5k', players: 900 },
      { bucket: '5k+', players: 240 },
    ].map((b) => ({ ...b, players: Math.round(b.players * r.jitter(0.05)) })),
  }
}

// ===========================================================================
// 4) LEADERBOARD / LIVE-OPS
// ===========================================================================
export interface LiveOpsData {
  verified: number
  pending: number
  rejected: number
  verifyLatencyMs: number
  dailyParticipation: number[]
  dailyLabels: string[]
  weeklyParticipation: { week: string; players: number }[]
  weeklySeed: { week: number; seed: string; mutator: string }
  event: { id: string; name: string; status: 'live' | 'scheduled' | 'ended'; participants: number; endsInDays: number; completion: number }
  seedRotations: { kind: 'daily' | 'weekly'; current: string; rotatedAt: number; by: string }[]
  boardHealth: { topScore: number; medianTop100: number; suspiciousInTop100: number }
}

function demoLiveOps(range: RangeDays, now: number): LiveOpsData {
  const r = makeRand(`liveops:${range}`)
  const dailyLabels = daysAxis(Math.min(range, 30) as RangeDays, now)
  const dailyParticipation = growthSeries(r, dailyLabels.length, 1200, 0.006)
  return {
    verified: Math.round(r.range(48000, 62000)),
    pending: Math.round(r.range(40, 220)),
    rejected: Math.round(r.range(400, 900)),
    verifyLatencyMs: Math.round(r.range(180, 640)),
    dailyParticipation,
    dailyLabels,
    weeklyParticipation: Array.from({ length: 8 }, (_, i) => ({ week: `W${26 - 7 + i}`, players: Math.round(r.range(3000, 9000) * (0.7 + i * 0.04)) })),
    weeklySeed: { week: 26, seed: '0x5EED-A31C', mutator: 'Pyroclasm + Glass Cannon' },
    event: { id: 'emberwaste', name: 'The Emberwaste Restoration', status: 'live', participants: Math.round(r.range(18000, 32000)), endsInDays: 41, completion: r.range(0.42, 0.61) },
    seedRotations: [
      { kind: 'daily', current: 'D-7429', rotatedAt: now - 3 * 3600_000, by: 'system (00:00 UTC)' },
      { kind: 'weekly', current: 'W26 · 0x5EED-A31C', rotatedAt: now - 2 * MS_DAY, by: 'system (Mon 00:00 UTC)' },
    ],
    boardHealth: { topScore: Math.round(r.range(180, 260)), medianTop100: Math.round(r.range(120, 150)), suspiciousInTop100: r.int(0, 3) },
  }
}

// ===========================================================================
// 5) SECURITY / INTEGRITY  (the headline plane)
// ===========================================================================
export type Verdict = 'verified' | 'pending' | 'rejected'
export interface RejectionReason {
  reason: string
  count: number
}
export interface SuspectAccount {
  acct: string // game account id (not PII)
  score: number // 0..100 risk
  flags: string[]
  reason: string
  status: 'watch' | 'shadow' | 'flagged' | 'cleared'
  lastSeenMs: number
  runs: number
}
export interface ScrapeSignal {
  id: string
  kind: 'rapid-asset-pull' | 'api-enumeration' | 'hotlink' | 'odd-user-agent' | 'off-origin' | 'rate-limit-trip'
  detail: string
  source: string // coarse: ip-hash / ASN / referrer host
  count: number
  firstMs: number
  lastMs: number
  severity: 'low' | 'med' | 'high'
}
export interface CloneSignal {
  host: string
  referrerHits: number
  firstMs: number
  status: 'observed' | 'phone-home' | 'dmca-filed' | 'removed'
}
export interface AssetIntegrityRow {
  asset: string
  expectedHash: string
  status: 'ok' | 'served-elsewhere' | 'mismatch'
  watermark: string
}
export interface SecurityData {
  // anti-cheat
  verifyTotals: { verified: number; pending: number; rejected: number }
  rejectionReasons: RejectionReason[]
  submissionRate: number[] // runs/hour, last 48
  submissionLabels: string[]
  submissionBaseline: number
  impossibleScores: { acct: string; claimed: number; ceiling: number; seed: string; ms: number }[]
  suspects: SuspectAccount[]
  // abuse / scraping
  scrapeSignals: ScrapeSignal[]
  rateLimitTrips: number[]
  rateLimitLabels: string[]
  cloneSignals: CloneSignal[]
  assetIntegrity: AssetIntegrityRow[]
  // posture / KPIs
  runsVerifiedToday: number
  rejectionRatePct: number
  medianVerifyMs: number
  offOriginCallsToday: number
}

const REJECTION_REASONS = [
  'Replay hash mismatch (re-sim ≠ claim)',
  'Elapsed time < replay duration',
  'Paid modifier active in ranked run',
  'Score exceeds theoretical ceiling',
  'Malformed / truncated input log',
  'Impossible economy (gold underflow)',
]
const SCRAPE_KINDS: ScrapeSignal['kind'][] = ['rapid-asset-pull', 'api-enumeration', 'hotlink', 'odd-user-agent', 'off-origin', 'rate-limit-trip']

function acctId(r: Rand): string {
  return `acct_${r.int(0x100000, 0xffffff).toString(16)}`
}

function demoSecurity(now: number): SecurityData {
  const r = makeRand('security:v1')
  const verified = Math.round(r.range(52000, 60000))
  const rejected = Math.round(r.range(500, 950))
  const pending = Math.round(r.range(30, 160))

  const rejectionReasons: RejectionReason[] = REJECTION_REASONS.map((reason) => ({ reason, count: Math.round(r.range(30, 260)) })).sort((a, b) => b.count - a.count)

  const submissionLabels: string[] = []
  const submissionRate: number[] = []
  const baseline = 220
  for (let h = 47; h >= 0; h--) {
    submissionLabels.push(`${h}h`)
    // a spike ~6h ago (submission-rate anomaly)
    const spike = h >= 5 && h <= 7 ? r.range(2.4, 3.6) : 1
    submissionRate.push(Math.round(baseline * (0.7 + Math.sin(h / 3.8) * 0.25) * spike * r.jitter(0.08)))
  }

  const impossibleScores = Array.from({ length: 4 }, () => {
    const ceiling = r.int(210, 260)
    return { acct: acctId(r), claimed: ceiling + r.int(30, 180), ceiling, seed: `0x${r.int(0, 0xffffff).toString(16).toUpperCase()}`, ms: now - r.int(1, 40) * 3600_000 }
  }).sort((a, b) => b.claimed - a.claimed)

  const SUSPECT_FLAGS = ['multi-account', 'same-device', 'submission-burst', 'superhuman-APM', 'zero-jitter-placement', 'replay-mismatch', 'impossible-score', 'VPN-cluster']
  const suspects: SuspectAccount[] = Array.from({ length: 12 }, () => {
    const score = r.int(45, 99)
    const flags = Array.from(new Set(Array.from({ length: r.int(1, 3) }, () => r.pick(SUSPECT_FLAGS))))
    const status: SuspectAccount['status'] = score >= 90 ? 'flagged' : score >= 78 ? 'shadow' : score >= 60 ? 'watch' : 'cleared'
    return {
      acct: acctId(r),
      score,
      flags,
      reason: flags.includes('replay-mismatch') ? 'Top-N run failed re-simulation' : flags.includes('submission-burst') ? 'N submissions in <60s' : 'Behavioral + cluster signals',
      status,
      lastSeenMs: now - r.int(1, 72) * 3600_000,
      runs: r.int(3, 400),
    }
  }).sort((a, b) => b.score - a.score)

  const scrapeSignals: ScrapeSignal[] = Array.from({ length: 9 }, (_, i) => {
    const kind = SCRAPE_KINDS[i % SCRAPE_KINDS.length]
    const count = r.int(40, 5200)
    const severity: ScrapeSignal['severity'] = count > 2500 ? 'high' : count > 600 ? 'med' : 'low'
    const detail =
      kind === 'rapid-asset-pull' ? `Sequential fetch of ${r.int(120, 900)} sprite/audio assets in ${r.int(3, 40)}s`
      : kind === 'api-enumeration' ? `Enumerating /leaderboard?page=1..${r.int(50, 900)}`
      : kind === 'hotlink' ? `Key art hotlinked from external host`
      : kind === 'odd-user-agent' ? `UA "python-requests/2.x" · no Referer`
      : kind === 'off-origin' ? `API calls with Origin ≠ chromancer.io`
      : `IP-hash tripped 429 rate-limit ${r.int(5, 60)}×`
    const src = kind === 'hotlink' || kind === 'off-origin' ? r.pick(['tdgames-free.example', 'freeonlinetd.example', 'unblocked-games.example']) : `ip#${r.int(0x1000, 0xffff).toString(16)} · AS${r.int(9000, 65000)}`
    return { id: `sig_${i}`, kind, detail, source: src, count, firstMs: now - r.int(4, 72) * 3600_000, lastMs: now - r.int(0, 3) * 3600_000, severity }
  }).sort((a, b) => (a.severity === b.severity ? b.count - a.count : a.severity === 'high' ? -1 : b.severity === 'high' ? 1 : 0))

  const cloneSignals: CloneSignal[] = [
    { host: 'tdgames-free.example', referrerHits: r.int(400, 2200), firstMs: now - 9 * MS_DAY, status: 'phone-home' },
    { host: 'unblocked-games.example', referrerHits: r.int(120, 800), firstMs: now - 4 * MS_DAY, status: 'observed' },
    { host: 'freeonlinetd.example', referrerHits: r.int(60, 400), firstMs: now - 15 * MS_DAY, status: 'dmca-filed' },
    { host: 'arcade-mirror.example', referrerHits: r.int(20, 180), firstMs: now - 28 * MS_DAY, status: 'removed' },
  ]

  const assetIntegrity: AssetIntegrityRow[] = [
    { asset: 'concepts/00-keyart-v2.jpg', expectedHash: 'sha256:9f2c…a71b', status: 'served-elsewhere', watermark: 'build-2f9a·chromancer.io' },
    { asset: 'audio/theme-menu.ogg', expectedHash: 'sha256:1d84…3c02', status: 'ok', watermark: 'build-2f9a' },
    { asset: 'sprites/atlas-towers.png', expectedHash: 'sha256:77ef…9a10', status: 'ok', watermark: 'build-2f9a' },
    { asset: 'js/main-[hash].js', expectedHash: 'sha256:c3b1…ee49', status: 'ok', watermark: 'build-2f9a (source maps stripped)' },
  ]

  const rateLimitLabels = submissionLabels.slice(-24)
  const rateLimitTrips = rateLimitLabels.map((_, i) => (i >= 17 && i <= 20 ? r.int(30, 140) : r.int(0, 18)))

  return {
    verifyTotals: { verified, pending, rejected },
    rejectionReasons,
    submissionRate,
    submissionLabels,
    submissionBaseline: baseline,
    impossibleScores,
    suspects,
    scrapeSignals,
    rateLimitTrips,
    rateLimitLabels,
    cloneSignals,
    assetIntegrity,
    runsVerifiedToday: Math.round(r.range(2100, 3400)),
    rejectionRatePct: Math.round((rejected / (verified + rejected)) * 10000) / 100,
    medianVerifyMs: Math.round(r.range(190, 420)),
    offOriginCallsToday: Math.round(r.range(200, 5200)),
  }
}

// ===========================================================================
// Public getters — try authorised backend, fall back to seeded demo.
// ===========================================================================
export async function getOverview(s: AdminSession, range: RangeDays, now: number): Promise<OverviewData> {
  return (await adminGet<OverviewData>(s, `/overview?range=${range}`)) ?? demoOverview(range, now)
}
export async function getRetention(s: AdminSession, range: RangeDays, now: number): Promise<RetentionData> {
  return (await adminGet<RetentionData>(s, `/retention?range=${range}`)) ?? demoRetention(range, now)
}
export async function getEconomy(s: AdminSession, range: RangeDays, now: number): Promise<EconomyData> {
  return (await adminGet<EconomyData>(s, `/economy?range=${range}`)) ?? demoEconomy(range, now)
}
export async function getLiveOps(s: AdminSession, range: RangeDays, now: number): Promise<LiveOpsData> {
  return (await adminGet<LiveOpsData>(s, `/liveops?range=${range}`)) ?? demoLiveOps(range, now)
}
export async function getSecurity(s: AdminSession, now: number): Promise<SecurityData> {
  return (await adminGet<SecurityData>(s, `/security`)) ?? demoSecurity(now)
}
