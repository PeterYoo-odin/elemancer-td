// PATHS & TERRAIN — the map-as-puzzle layer.
//
// The sim paths enemies cell-to-cell along an ORDERED list of grid cells (spawn →
// base). Historically that list came from ONE serpentine generator, so every map
// was the same S-shape re-tinted. This module replaces that with a small library
// of PARAMETRIC path builders — spiral, hairpin, zigzag, corridor, verticals —
// all built on a single `connectAnchors` primitive that is CONTIGUOUS BY
// CONSTRUCTION (each emitted cell is grid-adjacent to the previous), so no
// authored route can be malformed and the sim's waypoint chain never jumps.
//
// It also adds sim-readable TERRAIN tile flags (lava boosts fire, high-ground
// boosts range, fog forbids building, sacred/frozen/void trade stats) that change
// tower decisions per map. Terrain modifiers are pure, finite and bounded so the
// determinism/`effDps`-finite gates in simcheck stay green.

import type { LevelDef } from './levels'

export const GRID_COLS = 9
export const GRID_ROWS = 11

export type Cell = [number, number]

const clampCol = (c: number): number => Math.max(0, Math.min(GRID_COLS - 1, Math.round(c)))
const clampRow = (r: number): number => Math.max(0, Math.min(GRID_ROWS - 1, Math.round(r)))

// --- serpentine path builder (kept for compatibility + the endless mode) -------
// Contiguous by construction (each cell is grid-adjacent to the next). Routed
// through stripRevisits too (defined below) so a malformed/non-monotonic `lanes`
// list can never smuggle a revisited cell past the no-backtrack invariant.
export function serpentine(lanes: number[], cols = GRID_COLS): Cell[] {
  const cells: Cell[] = []
  for (let i = 0; i < lanes.length; i++) {
    const row = lanes[i]
    const l2r = i % 2 === 0
    if (l2r) {
      for (let c = 0; c < cols; c++) cells.push([c, row])
    } else {
      for (let c = cols - 1; c >= 0; c--) cells.push([c, row])
    }
    if (i < lanes.length - 1) {
      const endCol = l2r ? cols - 1 : 0 // == next lane's start column
      const nextRow = lanes[i + 1]
      for (let r = row + 1; r < nextRow; r++) cells.push([endCol, r])
    }
  }
  return stripRevisits(cells)
}

// Splice out back-and-forth spurs: if a walk steps onto a cell it has already
// visited (a merge-trunk anchor sequence looping back over a lane's entry stub,
// a spiral/coil coiling tight enough to cross its own earlier ring, etc.), cut
// the loop between the two visits rather than keep it. This is safe because the
// cell right after the SECOND visit was, in the raw walk, grid-adjacent to the
// cell right after the FIRST visit (same coordinates) — so splicing preserves
// contiguity while guaranteeing the walk never revisits a cell and therefore
// never reverses back onto the tile it just came from.
function stripRevisits(cells: Cell[]): Cell[] {
  const out: Cell[] = []
  const indexOf = new Map<string, number>()
  for (const cell of cells) {
    const key = `${cell[0]},${cell[1]}`
    const prior = indexOf.get(key)
    if (prior !== undefined) {
      out.length = prior + 1
      for (const [k, v] of indexOf) if (v > prior) indexOf.delete(k)
      continue
    }
    indexOf.set(key, out.length)
    out.push(cell)
  }
  return out
}

// --- connectAnchors: the universal contiguous-fill primitive --------------------
// Walk a list of anchor cells; between consecutive anchors step one cell at a time
// (columns first, then rows) so every emitted cell is grid-adjacent to the prior.
// Consecutive duplicates are collapsed. All anchors are clamped in-bounds, so the
// resulting path (and thus the sim's waypoints) can never leave the map. The walk
// is also REVISIT-FREE by construction (see stripRevisits) — every caller (single
// archetypes AND the multi-lane merge trunk) inherits the no-backtrack invariant
// for free, so no route this module emits can ever contain the back-and-forth
// spur where a lane's entry stub re-treads the trunk's first leg.
export function connectAnchors(anchors: Cell[]): Cell[] {
  const out: Cell[] = []
  const push = (c: number, r: number): void => {
    const cc = clampCol(c)
    const rr = clampRow(r)
    const last = out[out.length - 1]
    if (last && last[0] === cc && last[1] === rr) return
    out.push([cc, rr])
  }
  if (anchors.length === 0) return out
  push(anchors[0][0], anchors[0][1])
  for (let i = 1; i < anchors.length; i++) {
    let c = clampCol(out[out.length - 1][0])
    const r0 = clampRow(out[out.length - 1][1])
    let r = r0
    const tc = clampCol(anchors[i][0])
    const tr = clampRow(anchors[i][1])
    while (c !== tc) { c += tc > c ? 1 : -1; push(c, r) }
    while (r !== tr) { r += tr > r ? 1 : -1; push(c, r) }
  }
  return stripRevisits(out)
}

// ---------------------------------------------------------------------------
// PATH ARCHETYPES — each returns an ordered spawn→base cell list. They take a
// deterministic [0,1) source so the generator can vary them per level without
// importing the sim's RNG here (keeps this module leaf). Every archetype starts
// on an edge (so the portal sits off-board) and ends on the far edge (the base).
// Contiguity is guaranteed by connectAnchors.
// ---------------------------------------------------------------------------
export type PathArchetype =
  | 'serpentine'
  | 'verticalSnake'
  | 'spiral'
  | 'hairpin'
  | 'zigzag'
  | 'corridor'
  | 'switchback'
  | 'straight'   // long open trunk, 1–2 gentle jogs (the SIMPLE end — few turns)
  | 'lbend'      // a single 90° elbow (down-then-across) — short & readable
  | 'ushape'     // down one side, across, up the other — a wide U
  | 'coil'       // tight offset switchbacks packed into one half (many chokepoints)

export const PATH_ARCHETYPES: PathArchetype[] = [
  'serpentine', 'verticalSnake', 'spiral', 'hairpin', 'zigzag', 'corridor', 'switchback',
  'straight', 'lbend', 'ushape', 'coil',
]

// SIMPLE archetypes (few turns, open feel) vs COMPLEX (many turns/chokes). The
// generator draws from the simple set at shallow difficulty and the complex set as
// the curve steepens, so early maps read open and deep maps read tangled.
export const SIMPLE_ARCHETYPES: PathArchetype[] = ['straight', 'lbend', 'ushape', 'corridor']
export const COMPLEX_ARCHETYPES: PathArchetype[] = ['spiral', 'hairpin', 'coil', 'switchback', 'zigzag']

// Horizontal serpentine expressed through varying lane rows.
function buildSerpentine(rng: () => number): Cell[] {
  const rows = 3 + Math.floor(rng() * 3) // 3..5 lanes
  const lanes: number[] = []
  const step = (GRID_ROWS - 1) / rows
  for (let i = 0; i < rows; i++) lanes.push(clampRow(0.6 + step * (i + 0.5)))
  return serpentine(lanes)
}

// Vertical snake — sweeps columns top/bottom instead of rows left/right.
function buildVerticalSnake(rng: () => number): Cell[] {
  const colsN = 3 + Math.floor(rng() * 3)
  const anchors: Cell[] = []
  const step = (GRID_COLS - 1) / colsN
  for (let i = 0; i < colsN; i++) {
    const col = clampCol(0.6 + step * (i + 0.5))
    const top = i % 2 === 0
    anchors.push([col, top ? 0 : GRID_ROWS - 1])
    anchors.push([col, top ? GRID_ROWS - 1 : 0])
  }
  return connectAnchors(anchors)
}

// Inward spiral — a rectangular coil from the outer ring toward the centre.
function buildSpiral(rng: () => number): Cell[] {
  let top = 0, bot = GRID_ROWS - 1, left = 0, right = GRID_COLS - 1
  const anchors: Cell[] = [[0, rng() < 0.5 ? 0 : 1]]
  const inset = 2
  while (right - left >= 1 && bot - top >= 1) {
    anchors.push([right, top])
    anchors.push([right, bot])
    anchors.push([left, bot])
    anchors.push([left, top + 1])
    top += inset; bot -= inset; left += inset; right -= inset
    if (anchors.length > 24) break
  }
  anchors.push([clampCol((left + right) / 2), clampRow((top + bot) / 2)]) // finish near centre (base)
  return connectAnchors(anchors)
}

// Hairpin — long straights joined by tight U-turns (natural chokepoints).
function buildHairpin(rng: () => number): Cell[] {
  const lanes = 4 + Math.floor(rng() * 2) // 4..5
  const anchors: Cell[] = []
  const step = (GRID_ROWS - 1) / lanes
  for (let i = 0; i < lanes; i++) {
    const row = clampRow(0.6 + step * (i + 0.5))
    const l2r = i % 2 === 0
    anchors.push([l2r ? 0 : GRID_COLS - 1, row])
    anchors.push([l2r ? GRID_COLS - 1 : 0, row])
  }
  return connectAnchors(anchors)
}

// Zigzag diagonal staircase — corner to corner in short steps.
function buildZigzag(rng: () => number): Cell[] {
  const anchors: Cell[] = []
  const steps = 4 + Math.floor(rng() * 3)
  let c = 0, r = 0
  anchors.push([0, 0])
  for (let i = 0; i < steps; i++) {
    const nc = clampCol(((i + 1) / steps) * (GRID_COLS - 1))
    const nr = clampRow(((i + 1) / steps) * (GRID_ROWS - 1))
    if (i % 2 === 0) { anchors.push([nc, r]); anchors.push([nc, nr]) }
    else { anchors.push([c, nr]); anchors.push([nc, nr]) }
    c = nc; r = nr
  }
  return connectAnchors(anchors)
}

// Corridor — a mostly-straight trunk with two deliberate chokepoint jogs.
function buildCorridor(rng: () => number): Cell[] {
  const midRow = clampRow(GRID_ROWS / 2 + (rng() < 0.5 ? -1 : 1))
  const j1 = clampRow(midRow - 3)
  const j2 = clampRow(midRow + 3)
  const q = clampCol(GRID_COLS / 3)
  const q2 = clampCol((GRID_COLS * 2) / 3)
  return connectAnchors([
    [0, midRow], [q, midRow], [q, j1], [q2, j1], [q2, j2], [GRID_COLS - 1, j2], [GRID_COLS - 1, midRow],
  ])
}

// Switchback — vertical descent with alternating side ledges (crag climb feel).
function buildSwitchback(rng: () => number): Cell[] {
  const anchors: Cell[] = [[clampCol(GRID_COLS / 2), 0]]
  const rungs = 4 + Math.floor(rng() * 2)
  const step = (GRID_ROWS - 1) / rungs
  for (let i = 0; i < rungs; i++) {
    const r = clampRow(step * (i + 1))
    const side = i % 2 === 0 ? GRID_COLS - 1 : 0
    anchors.push([side, clampRow(r - step / 2)])
    anchors.push([side, r])
  }
  anchors.push([clampCol(GRID_COLS / 2), GRID_ROWS - 1])
  return connectAnchors(anchors)
}

// Straight-with-turns — a long trunk broken by one or two gentle jogs. The SIMPLE
// end of the spectrum: reads as open, contrasts sharply with the tangled shapes.
function buildStraight(rng: () => number): Cell[] {
  const row = clampRow(2 + Math.floor(rng() * (GRID_ROWS - 4)))
  const turnCol = clampCol(2 + Math.floor(rng() * (GRID_COLS - 4)))
  const endRow = clampRow(row + (rng() < 0.5 ? -3 : 3))
  return connectAnchors([[0, row], [turnCol, row], [turnCol, endRow], [GRID_COLS - 1, endRow]])
}

// L-bend — a single 90° elbow (enter top, descend, turn out to a side). Short and
// very legible; leaves a big open quadrant that rewards long-range coverage.
function buildLbend(rng: () => number): Cell[] {
  const enterCol = clampCol(1 + Math.floor(rng() * (GRID_COLS - 2)))
  const cornerRow = clampRow(GRID_ROWS - 2 - Math.floor(rng() * 2))
  const goRight = enterCol < GRID_COLS / 2
  return connectAnchors([[enterCol, 0], [enterCol, cornerRow], [goRight ? GRID_COLS - 1 : 0, cornerRow]])
}

// U-shape — down one side, across the floor, up the other. A wide, open loop with
// a long single-file base run (a natural late chokepoint) but airy flanks.
function buildUshape(rng: () => number): Cell[] {
  const inset = clampCol(1 + Math.floor(rng() * 2))
  const bottom = clampRow(GRID_ROWS - 1 - Math.floor(rng() * 2))
  const topRight = clampRow(1 + Math.floor(rng() * 3))
  return connectAnchors([
    [inset, 0], [inset, bottom], [clampCol(GRID_COLS - 1 - inset), bottom], [clampCol(GRID_COLS - 1 - inset), topRight],
  ])
}

// Coil — tight offset switchbacks packed into one vertical half, leaving the other
// half wide open. Maximum chokepoints on one flank, maximum openness on the other.
function buildCoil(rng: () => number): Cell[] {
  const leftHalf = rng() < 0.5
  const near = leftHalf ? 0 : GRID_COLS - 1
  const far = clampCol(leftHalf ? GRID_COLS - 3 : 2)
  const rungs = 4 + Math.floor(rng() * 2) // 4..5
  const step = (GRID_ROWS - 1) / rungs
  const anchors: Cell[] = [[near, 0]]
  for (let i = 0; i < rungs; i++) {
    const r = clampRow(step * (i + 1))
    const side = i % 2 === 0 ? far : near
    anchors.push([side, clampRow(r - step / 2)])
    anchors.push([side, r])
  }
  anchors.push([clampCol((near + far) / 2), GRID_ROWS - 1])
  return connectAnchors(anchors)
}

const BUILDERS: Record<PathArchetype, (rng: () => number) => Cell[]> = {
  serpentine: buildSerpentine,
  verticalSnake: buildVerticalSnake,
  spiral: buildSpiral,
  hairpin: buildHairpin,
  zigzag: buildZigzag,
  corridor: buildCorridor,
  switchback: buildSwitchback,
  straight: buildStraight,
  lbend: buildLbend,
  ushape: buildUshape,
  coil: buildCoil,
}

// Build a path of the given archetype using a deterministic [0,1) source.
export function buildPath(archetype: PathArchetype, rng: () => number): Cell[] {
  const cells = (BUILDERS[archetype] ?? buildSerpentine)(rng)
  return cells.length >= 2 ? cells : serpentine([3, 6, 9])
}

// ---------------------------------------------------------------------------
// MULTI-ROUTE TOPOLOGIES — a level may spawn enemies from 2+ portals that all
// CONVERGE ON ONE SHARED BASE cell. Each route is an independent ordered
// spawn→base list (the sim gives every enemy one route). Splitting a wave's
// spawns across routes (rather than duplicating them) raises coverage decisions
// without multiplying pressure, so beatability stays fair. Invariant enforced by
// `normalizePlan`: every route ends at the identical base cell.
// ---------------------------------------------------------------------------
export type PathPlan = Cell[][] // 1..N contiguous routes, all ending at the same base cell

export type PathTopology =
  | 'single'      // one route (uses an archetype) — the classic layout
  | 'dualLane'    // two portals down opposite flanks, meeting at a central base
  | 'crossing'    // two portals whose lanes cross mid-field before the base
  | 'forkRejoin'  // one portal that splits into two lanes and rejoins at the base

export const MULTI_TOPOLOGIES: PathTopology[] = ['dualLane', 'crossing', 'forkRejoin']

// The shared MERGE point (near the top) and the long winding trunk both lanes
// traverse together down to the base. Keeping the split short (just the entry
// stubs) and the shared gauntlet long is what keeps multi-spawn beatable by a
// min-resource defence — a tower on the trunk fires on every enemy, both lanes.
function convergeTrunk(rng: () => number): { merge: Cell; trunk: Cell[] } {
  const bcol = clampCol(GRID_COLS / 2)
  const base: Cell = [bcol, GRID_ROWS - 1]
  const merge: Cell = [bcol, clampRow(2)]
  const lc = clampCol(1)
  const rc = clampCol(GRID_COLS - 2)
  // VARY the sweep rows + the initial sweep direction so multi-spawn trunks aren't
  // clones of each other (the trunk is the long shared gauntlet; if it were fixed,
  // every multi map would read identically — the repetition we're curing). 8 base
  // variants × the entry-stub jitter below.
  const r1 = clampRow(3 + Math.floor(rng() * 2)) // 3..4
  const r2 = clampRow(6 + Math.floor(rng() * 2)) // 6..7
  const r3 = clampRow(GRID_ROWS - 2)
  const startRight = rng() < 0.5
  const s1 = startRight ? rc : lc
  const s2 = startRight ? lc : rc
  const trunk = connectAnchors([
    merge, [s1, r1], [s2, r1], [s2, r2], [s1, r2], [s1, r3], [bcol, r3], base,
  ])
  return { merge, trunk }
}

// Two portals down the left & right flanks that MERGE near the top into the shared
// trunk. The parallel entry mouths are the coverage decision; the trunk is shared.
function planDualLane(rng: () => number): PathPlan {
  const { merge, trunk } = convergeTrunk(rng)
  const lx = clampCol(1 + Math.floor(rng() * 2))
  const rx = clampCol(GRID_COLS - 2 - Math.floor(rng() * 2))
  const a = connectAnchors([[lx, 0], [lx, merge[1]], merge, ...trunk])
  const b = connectAnchors([[rx, 0], [rx, merge[1]], merge, ...trunk])
  return [a, b]
}

// Two portals whose entry stubs CROSS (each dives to the opposite flank) before
// merging into the shared trunk — a read-the-crossing coverage puzzle up top.
function planCrossing(rng: () => number): PathPlan {
  const { merge, trunk } = convergeTrunk(rng)
  const swap = clampRow(1)
  const a = connectAnchors([[1, 0], [1, swap], [GRID_COLS - 1, swap], [GRID_COLS - 1, merge[1]], merge, ...trunk])
  const b = connectAnchors([[GRID_COLS - 2, 0], [GRID_COLS - 2, merge[1]], [0, merge[1]], merge, ...trunk])
  return [a, b]
}

// One portal at the top that FORKS into a left and a right branch, both bowing out
// then rejoining at the shared trunk's merge point (a diamond mouth). The player
// sees a single spawn split and must guard both bows before they reconverge.
function planForkRejoin(rng: () => number): PathPlan {
  const { merge, trunk } = convergeTrunk(rng)
  const head: Cell = [clampCol(GRID_COLS / 2), 0]
  const bow = clampRow(1)
  const lc = clampCol(1 + Math.floor(rng() * 2))
  const rc = clampCol(GRID_COLS - 2 - Math.floor(rng() * 2))
  const left = connectAnchors([head, [lc, bow], [lc, merge[1]], merge, ...trunk])
  const right = connectAnchors([head, [rc, bow], [rc, merge[1]], merge, ...trunk])
  return [left, right]
}

// Drop malformed routes (< 2 cells) and force the shared-base invariant: every
// route is snapped to end at the FIRST route's final cell. If nothing survives,
// falls back to a plain serpentine so the sim always has a valid route.
function normalizePlan(plan: PathPlan): PathPlan {
  const routes = plan.filter((r) => r.length >= 2)
  if (routes.length === 0) return [serpentine([3, 6, 9])]
  const base = routes[0][routes[0].length - 1]
  return routes.map((r) => {
    const last = r[r.length - 1]
    if (last[0] === base[0] && last[1] === base[1]) return r
    return connectAnchors([...r, base]) // stitch the route onto the shared base
  })
}

// Build a full path PLAN (1..N routes) for a topology. Single topologies wrap the
// archetype builder; multi-route topologies converge on one base. Deterministic
// via the [0,1) source; contiguity + shared base guaranteed.
export function buildPathPlan(topology: PathTopology, archetype: PathArchetype, rng: () => number): PathPlan {
  switch (topology) {
    case 'dualLane': return normalizePlan(planDualLane(rng))
    case 'crossing': return normalizePlan(planCrossing(rng))
    case 'forkRejoin': return normalizePlan(planForkRejoin(rng))
    default: return [buildPath(archetype, rng)]
  }
}

// The buildable (tower) candidate cells for a path (or the UNION of all routes in
// a multi-lane plan): every in-bounds NON-path cell with a path cell in its
// 8-neighbourhood — the same rule the sim uses to mark 'build' tiles. Used by the
// generator to place terrain only where towers can go.
export function computeBuildCandidates(path: Cell[]): Cell[] {
  const onPath = new Set<string>()
  for (const [c, r] of path) onPath.add(`${c},${r}`)
  const out: Cell[] = []
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      if (onPath.has(`${c},${r}`)) continue
      let near = false
      for (let dr = -1; dr <= 1 && !near; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (onPath.has(`${c + dc},${r + dr}`)) { near = true; break }
        }
      }
      if (near) out.push([c, r])
    }
  }
  return out
}

// The full route PLAN (1..N spawn→base routes) the sim consumes for a level:
// `paths` (multi-lane) if present, else the single authored `path`, else the
// archetype-free serpentine fallback. Every route ends at the same base cell.
export function pathPlanFor(level: Pick<LevelDef, 'path' | 'paths' | 'lanes'>): Cell[][] {
  if (level.paths && level.paths.length >= 1 && level.paths.every((r) => r.length >= 2)) return level.paths
  if (level.path && level.path.length >= 2) return [level.path]
  return [serpentine(level.lanes)]
}

// The PRIMARY ordered spawn→base cells (route 0) — used for tile orientation and
// any single-route consumer. Multi-lane levels expose the rest via pathPlanFor.
export function pathCellsFor(level: Pick<LevelDef, 'path' | 'paths' | 'lanes'>): Cell[] {
  return pathPlanFor(level)[0]
}

// ---------------------------------------------------------------------------
// TERRAIN — sim-readable build-tile flags. Modifiers are pure & bounded.
// ---------------------------------------------------------------------------
export type TerrainKind = '' | 'lava' | 'highground' | 'fog' | 'sacred' | 'frozen' | 'void'

export interface TerrainCell { col: number; row: number; kind: TerrainKind }

export interface TerrainMeta {
  label: string
  color: number // emissive tint for the view
  blurb: string
}

export const TERRAIN_META: Record<Exclude<TerrainKind, ''>, TerrainMeta> = {
  lava: { label: 'Emberflow', color: 0xff5a2a, blurb: 'Fire towers here burn +50%.' },
  highground: { label: 'High Ground', color: 0xbfe3ff, blurb: 'Towers here gain range & bite.' },
  fog: { label: 'Greyfog', color: 0x9aa0ae, blurb: 'Too murky to build on.' },
  sacred: { label: 'Sacred Ground', color: 0xffe9a3, blurb: 'Long reach, gentler strike.' },
  frozen: { label: 'Rimefrost', color: 0xa9d8ee, blurb: 'Numbing cold dulls damage.' },
  void: { label: 'Void Scar', color: 0xb06bff, blurb: 'Glass cannon: +bite, −reach.' },
}

// Element string is the sim's Element union; passed as string to stay leaf.
export function terrainDmgMul(kind: TerrainKind, element: string | undefined): number {
  switch (kind) {
    case 'lava': return element === 'Fire' ? 1.5 : 1
    case 'highground': return 1.12
    case 'sacred': return 0.85
    case 'frozen': return 0.85
    case 'void': return 1.3
    default: return 1
  }
}

export function terrainRngMul(kind: TerrainKind): number {
  switch (kind) {
    case 'highground': return 1.28
    case 'sacred': return 1.25
    case 'fog': return 0.62
    case 'void': return 0.72
    default: return 1
  }
}

// Some tiles simply cannot host a tower (fog-of-placement).
export function terrainNoBuild(kind: TerrainKind): boolean {
  return kind === 'fog'
}
