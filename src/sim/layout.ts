// Shared world-space layout. The sim runs in this 720×1280 coordinate space so a
// Phaser view maps 1:1; a future Three.js view scales these world units freely.
import { GRID_COLS, GRID_ROWS } from '../game/levels'

export const COLS = GRID_COLS // 9
export const ROWS = GRID_ROWS // 11
export const TILE = 80
export const MAP_X = 0
export const MAP_Y = 200
export const MAP_W = COLS * TILE // 720
export const MAP_H = ROWS * TILE // 880 → map spans y 200..1080

export const FIXED_DT = 1 / 60 // deterministic simulation step
// spiral-of-death guard. advance()'s accumulator clamps each frame's incoming
// dt to 0.25s BEFORE this cap ever applies (sim.ts), so the worst case this cap
// must absorb is bounded: floor(0.25 / FIXED_DT) = 15 steps. That bound holds
// regardless of game speed (1×/2×/4× normal play, up to 8× in attract) because
// it's the ALREADY-SCALED dt that gets clamped — a faster game speed just packs
// more steps into fewer real frames, it never needs more than 15 in one frame.
// 15 is therefore the exact value that keeps 2×/4× (and attract's up to 8×)
// pacing with wall clock without ever tripping the backlog-drop below — a lower
// cap would silently fall behind at high speed and read as slow motion.
export const MAX_STEPS_PER_FRAME = 15

export function cellCenter(col: number, row: number): { x: number; y: number } {
  return { x: MAP_X + col * TILE + TILE / 2, y: MAP_Y + row * TILE + TILE / 2 }
}

// Pointer/world → grid cell, or null if outside the play field.
export function worldToCell(x: number, y: number): { col: number; row: number } | null {
  if (x < MAP_X || x >= MAP_X + MAP_W || y < MAP_Y || y >= MAP_Y + MAP_H) return null
  const col = Math.floor((x - MAP_X) / TILE)
  const row = Math.floor((y - MAP_Y) / TILE)
  if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return null
  return { col, row }
}
