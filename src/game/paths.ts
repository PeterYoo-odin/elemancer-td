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
// Contiguous by construction (each cell is grid-adjacent to the next).
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
  return cells
}

// --- connectAnchors: the universal contiguous-fill primitive --------------------
// Walk a list of anchor cells; between consecutive anchors step one cell at a time
// (columns first, then rows) so every emitted cell is grid-adjacent to the prior.
// Consecutive duplicates are collapsed. All anchors are clamped in-bounds, so the
// resulting path (and thus the sim's waypoints) can never leave the map.
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
  return out
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

export const PATH_ARCHETYPES: PathArchetype[] = [
  'serpentine', 'verticalSnake', 'spiral', 'hairpin', 'zigzag', 'corridor', 'switchback',
]

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

const BUILDERS: Record<PathArchetype, (rng: () => number) => Cell[]> = {
  serpentine: buildSerpentine,
  verticalSnake: buildVerticalSnake,
  spiral: buildSpiral,
  hairpin: buildHairpin,
  zigzag: buildZigzag,
  corridor: buildCorridor,
  switchback: buildSwitchback,
}

// Build a path of the given archetype using a deterministic [0,1) source.
export function buildPath(archetype: PathArchetype, rng: () => number): Cell[] {
  const cells = (BUILDERS[archetype] ?? buildSerpentine)(rng)
  return cells.length >= 2 ? cells : serpentine([3, 6, 9])
}

// The buildable (tower) candidate cells for a path: every in-bounds NON-path cell
// with a path cell in its 8-neighbourhood — the same rule the sim uses to mark
// 'build' tiles. Used by the generator to place terrain only where towers can go.
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

// The ordered spawn→base cells the sim & view both consume for a level: the
// authored `path` if present, else the archetype-free serpentine fallback.
export function pathCellsFor(level: Pick<LevelDef, 'path' | 'lanes'>): Cell[] {
  if (level.path && level.path.length >= 2) return level.path
  return serpentine(level.lanes)
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
