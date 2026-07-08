// Campaign level table — now a GENERATED ladder (see campaign.ts). This module
// owns the shared TYPES + progression helpers, and re-exports the built LEVELS /
// REALMS. Paths are contiguous BY CONSTRUCTION (serpentine or authored routes via
// paths.ts), so no level's route can be malformed. Flow: MapScene →
// BattleScene(levelId) → back with stars.

import type { EnemyKind } from './enemies'
import type { TowerKind } from './towers'
import type { TerrainCell } from './paths'
import { serpentine, pathCellsFor, GRID_COLS, GRID_ROWS } from './paths'
import { buildCampaign, PAL, LEVELS_PER_WORLD } from './campaign'

// Re-export the path primitives so existing importers (sim, scenes, layout) keep
// their import site unchanged.
export { serpentine, pathCellsFor, GRID_COLS, GRID_ROWS }
export { LEVELS_PER_WORLD }

export interface WaveEntry {
  kind: EnemyKind
  count: number
  spacing: number // seconds between spawns in this entry
  hpMul: number
  /** kind 'keeper' only: which Corrupted Keeper this is (id from keepers.ts) */
  keeperId?: string
  /** final-gauntlet / mini-boss ghost: reduced HP, single phase, slower casts */
  echo?: boolean
}

export interface Wave {
  entries: WaveEntry[]
  clearBonus: number // battle-gold awarded when the wave is cleared
}

export interface FieldPalette {
  grassA: number
  grassB: number
  build: number
  path: number
  pathEdge: number
}

export interface LevelDef {
  id: string
  index: number // 0-based order on the map (== position in LEVELS)
  name: string
  blurb: string
  lanes: number[] // serpentine rows (fallback route when `path` is absent)
  /** authored spawn→base cell route (contiguous); overrides `lanes` when present */
  path?: Array<[number, number]>
  /** sim-readable terrain flags on build tiles (lava/high-ground/fog/…) */
  terrain?: TerrainCell[]
  /** PATHFORGE: open-grid building — EVERY non-road tile is buildable (not just
   * road-adjacent). Additive + opt-in; campaign/ranked levels leave it unset. */
  openBuild?: boolean
  /** landmark levels are hand-tuned spectacle stops: mini-boss or realm finale */
  landmark?: 'landmark' | 'finale'
  /** per-level challenge: max heroes that may be deployed (0 = no-hero) */
  heroLimit?: number
  startGold: number
  startLives: number
  baseCoins: number // meta-coin reward basis (economy scales by stars)
  palette: FieldPalette
  unlockTower?: TowerKind // granted on FIRST clear
  waves: Wave[]
}

// ---------------------------------------------------------------------------
// REALMS — the six elemental realms of Aetheria, in campaign order. Realm UI +
// level ids are generated in campaign.ts; the metadata shape lives here.
// ---------------------------------------------------------------------------

export interface RealmUi {
  accent: string // node glow / trail / headline colour
  deep: string // darkest gradient stop of the map band
  mid: string // mid gradient stop
  glow: string // soft radial tint (rgba)
  ridge: string // near mountain-silhouette colour
  ridgeFar: string // far mountain-silhouette colour
}

export interface RealmDef {
  id: string
  name: string
  element: string
  emoji: string
  intro: string // story line shown on the realm banner (skippable flavor)
  ui: RealmUi
  levelIds: string[]
}

// Build the whole campaign once at module load (deterministic + cheap).
const CAMPAIGN = buildCampaign()
export const LEVELS: LevelDef[] = CAMPAIGN.levels
export const REALMS: RealmDef[] = CAMPAIGN.realms
export const FIRST_LEVEL_ID = CAMPAIGN.firstLevelId

const LEVEL_BY_ID: Map<string, LevelDef> = new Map(LEVELS.map((l) => [l.id, l]))
const REALM_BY_LEVEL: Map<string, RealmDef> = new Map()
for (const r of REALMS) for (const id of r.levelIds) REALM_BY_LEVEL.set(id, r)

export function realmForLevel(levelId: string): RealmDef {
  return REALM_BY_LEVEL.get(levelId) ?? REALMS[0]
}

// ---------------------------------------------------------------------------
// DEMO LEVEL — "The Restoration of Ember Vale". Hand-tuned greatest-hits arc for
// the shareable demo (?demo=1) AND the attract/trailer reel (?attract=1). NOT in
// LEVELS (never on the world map); index 1 so the Morose intrusion planner gives
// it exactly one grey moment and no draft steal.
// ---------------------------------------------------------------------------
function w(entries: WaveEntry[], clearBonus: number): Wave { return { entries, clearBonus } }
function e(kind: EnemyKind, count: number, spacing: number, hpMul = 1): WaveEntry { return { kind, count, spacing, hpMul } }

export const DEMO_LEVEL: LevelDef = {
  id: 'demo',
  index: 1,
  name: 'The Restoration of Ember Vale',
  blurb: 'Ember Vale has gone grey. Paint it back.',
  lanes: [2, 5, 8],
  startGold: 260,
  startLives: 10,
  baseCoins: 40,
  palette: PAL.ember,
  unlockTower: 'storm',
  waves: [
    w([e('runner', 8, 0.6)], 22),
    w([e('runner', 10, 0.4), e('grunt', 8, 0.7, 1.1)], 26),
    w([e('grunt', 16, 0.55, 1.25), e('brute', 3, 1.3, 1.15)], 36),
    w([e('shielded', 8, 0.85, 1.5), e('runner', 16, 0.32, 1.6), e('grunt', 10, 0.5, 1.7)], 44),
    w([e('boss', 1, 1, 12), e('brute', 12, 0.9, 3.5), e('runner', 12, 1.4, 60), e('swarm', 30, 0.14, 12)], 120),
  ],
}

export function levelById(id: string): LevelDef | undefined {
  if (id === DEMO_LEVEL.id) return DEMO_LEVEL
  return LEVEL_BY_ID.get(id)
}

// A level is unlocked if it's the first, or the previous level (by index) has ≥ 1 star.
export function isLevelUnlocked(index: number, stars: Record<string, number>): boolean {
  if (index <= 0) return true
  const prev = LEVELS[index - 1]
  if (!prev) return false
  return (stars[prev.id] ?? 0) >= 1
}

// Stars from lives remaining at clear (out of the level's starting lives).
export function starsForClear(livesLeft: number, startLives: number): number {
  if (livesLeft >= startLives) return 3
  const frac = livesLeft / startLives
  if (frac >= 0.6) return 3
  if (frac >= 0.3) return 2
  return 1
}
