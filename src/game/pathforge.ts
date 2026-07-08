// PATHFORGE — the flagship fair maze mode. On an OPEN grid with a fixed Portal
// (spawn) and the Prism Wellspring (base), the player PAINTS the Prism-road that
// enemies walk. Longer, more-winding routes keep enemies in tower fire longer —
// the whole tradeoff. This module is the deterministic, view-free core:
//
//   • pathforgeLayout(seed)  — the seeded Portal + Wellspring cells (a fresh puzzle
//                              per seed). Spawn is pinned to the LEFT edge so the
//                              sim's off-board portal offset (path[0]-1.2) renders.
//   • bfsRoute(road,…)       — the enemy route: the SHORTEST path along painted road
//                              (4-connected, fixed neighbour order → deterministic).
//                              Off-route paint is inert (enemies always take the
//                              shortest road), which the editor teaches live.
//   • validateMaze(…)        — the anti-exploit HARD RULE: a run may only begin when
//                              a completable Portal→Wellspring route exists. You can
//                              never wall the enemies off. The road then LOCKS for the
//                              run, so there is no mid-run trap and nothing to re-path.
//   • pathforgeLevel(route)  — bakes the committed route into a LevelDef the existing
//                              sim/3D-view/HUD consume unchanged (openBuild = towers on
//                              every non-road tile).
//   • local best + saved maze — per-seed, on-device (no backend). Wires to the shared
//                              daily seed when present; degrades to local score.
//
// Everything here is pure + seeded → reproducible + simcheck-safe. No gacha, no paid
// advantage: road paint and the whole run are free (the store constitution).

import type { LevelDef } from './levels'
import { LEVELS, GRID_COLS, GRID_ROWS } from './levels'
import { canonicalSeed, todaysDaily } from './seedcode'

export const PF_COLS = GRID_COLS // 9
export const PF_ROWS = GRID_ROWS // 11

export type PFCell = [number, number]

// Cell ↔ compact key. Used for the road Set and localStorage packing.
export const pfKey = (col: number, row: number): number => row * PF_COLS + col
export const pfCol = (k: number): number => k % PF_COLS
export const pfRow = (k: number): number => Math.floor(k / PF_COLS)
export const pfInBounds = (col: number, row: number): boolean =>
  col >= 0 && col < PF_COLS && row >= 0 && row < PF_ROWS

// Deterministic per-seed layout. Portal on the LEFT edge (col 0), Wellspring on the
// RIGHT edge (col COLS-1); their rows fall out of the seed so every seed is a new
// puzzle. Left-edge spawn keeps the sim's hard-coded portal offset valid.
export function pathforgeLayout(seed: number): { spawn: PFCell; base: PFCell } {
  const s = canonicalSeed(seed) >>> 0
  const spawnRow = s % PF_ROWS
  const baseRow = Math.floor(s / PF_ROWS) % PF_ROWS
  return { spawn: [0, spawnRow], base: [PF_COLS - 1, baseRow] }
}

// Fixed 4-neighbour order — up, down, left, right — so BFS is fully deterministic.
const PF_DIRS: ReadonlyArray<PFCell> = [[0, -1], [0, 1], [-1, 0], [1, 0]]

// The enemy route: the SHORTEST orthogonal path along painted road cells from spawn
// to base. Returns the ordered cell list (spawn … base) or null when unreachable.
// Deterministic: BFS in layers, each cell's predecessor is its FIRST discoverer under
// the fixed neighbour order, so the same road always yields the same route.
export function bfsRoute(road: ReadonlySet<number>, spawn: PFCell, base: PFCell): PFCell[] | null {
  const startK = pfKey(spawn[0], spawn[1])
  const goalK = pfKey(base[0], base[1])
  if (!road.has(startK) || !road.has(goalK)) return null
  if (startK === goalK) return [[spawn[0], spawn[1]]]
  const prev = new Map<number, number>()
  const seen = new Set<number>([startK])
  let frontier: number[] = [startK]
  while (frontier.length) {
    const next: number[] = []
    for (const k of frontier) {
      const c = pfCol(k), r = pfRow(k)
      for (const [dc, dr] of PF_DIRS) {
        const nc = c + dc, nr = r + dr
        if (!pfInBounds(nc, nr)) continue
        const nk = pfKey(nc, nr)
        if (!road.has(nk) || seen.has(nk)) continue
        seen.add(nk)
        prev.set(nk, k)
        next.push(nk)
      }
    }
    if (seen.has(goalK)) break
    frontier = next
  }
  if (!seen.has(goalK)) return null
  const out: PFCell[] = []
  let cur = goalK
  while (cur !== startK) {
    out.push([pfCol(cur), pfRow(cur)])
    cur = prev.get(cur)!
  }
  out.push([spawn[0], spawn[1]])
  out.reverse()
  return out
}

export interface MazeValidation {
  ok: boolean
  route: PFCell[] | null // the committed enemy route (shortest path)
  reason: string // player-facing message when !ok
}

// The HARD anti-exploit rule, evaluated live in the editor and again at launch:
// a maze is only valid when a completable Portal→Wellspring route exists.
export function validateMaze(road: ReadonlySet<number>, spawn: PFCell, base: PFCell): MazeValidation {
  const startK = pfKey(spawn[0], spawn[1])
  const goalK = pfKey(base[0], base[1])
  if (!road.has(startK) || !road.has(goalK)) {
    return { ok: false, route: null, reason: 'Paint road on both the Portal and the Wellspring.' }
  }
  const route = bfsRoute(road, spawn, base)
  if (!route) return { ok: false, route: null, reason: 'Connect the road — enemies have no way through.' }
  return { ok: true, route, reason: '' }
}

// Bake the committed route into a LevelDef the existing battle stack renders as-is.
// openBuild = every non-road tile is a tower slot. Runs endless (seeded waves) so
// startGold/startLives here are cosmetic (BattleScene supplies the ranked-fair pair).
export function pathforgeLevel(route: PFCell[]): LevelDef {
  const palette = (LEVELS[3] ?? LEVELS[0]).palette
  return {
    id: 'pathforge',
    index: 98,
    name: 'Pathforge',
    blurb: 'Your maze. Hold the line.',
    lanes: [1, 3, 5, 7, 9],
    path: route.map(([c, r]) => [c, r] as [number, number]),
    openBuild: true,
    startGold: 300,
    startLives: 20,
    baseCoins: 0,
    palette,
    waves: [],
  }
}

// ---- local score + saved design (on-device; no backend) --------------------
const LS_BEST = 'chromancer.pathforge.best.v1'
const LS_MAZE = 'chromancer.pathforge.maze.v1'

function loadMap(key: string): Record<string, number[] | number> {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null
    const v = raw ? JSON.parse(raw) : {}
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}
function saveMap(key: string, data: unknown): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, JSON.stringify(data))
  } catch {
    /* storage disabled — degrade silently */
  }
}
const seedTag = (seed: number): string => String(canonicalSeed(seed))

export function pathforgeBest(seed: number): number {
  const v = loadMap(LS_BEST)[seedTag(seed)]
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

// Record a run's reached wave; returns true on a new personal best for the seed.
export function recordPathforgeBest(seed: number, wave: number): boolean {
  if (!Number.isFinite(wave) || wave <= 0) return false
  const data = loadMap(LS_BEST) as Record<string, number>
  const tag = seedTag(seed)
  if (wave > (data[tag] ?? 0)) {
    data[tag] = Math.floor(wave)
    saveMap(LS_BEST, data)
    return true
  }
  return false
}

// Persist / recall the painted road (packed cell keys) per seed, so returning to the
// forge reloads your design instead of a blank grid.
export function savePathforgeMaze(seed: number, roadKeys: number[]): void {
  const data = loadMap(LS_MAZE) as Record<string, number[]>
  data[seedTag(seed)] = roadKeys.slice().sort((a, b) => a - b)
  saveMap(LS_MAZE, data)
}
export function loadPathforgeMaze(seed: number): number[] | null {
  const v = loadMap(LS_MAZE)[seedTag(seed)]
  return Array.isArray(v) ? v.filter((n) => typeof n === 'number' && n >= 0 && n < PF_COLS * PF_ROWS) : null
}

// The default seed for a fresh visit: today's shared daily seed (same puzzle for
// everyone that day). Degrades to a fine local seed if the clock is unavailable.
export function defaultPathforgeSeed(): number {
  try {
    return todaysDaily().seed
  } catch {
    return canonicalSeed(0x9e3779b9)
  }
}
