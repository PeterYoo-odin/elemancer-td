// Enemy data tables. Add a new enemy by extending EnemyKind + ENEMIES; waves.ts
// references them by kind. Speed is in tiles/second; the scene multiplies by TILE.

export type EnemyKind = 'runner' | 'grunt' | 'brute'

export type EnemyShape = 'triangle' | 'square' | 'hex'

export interface EnemyDef {
  kind: EnemyKind
  name: string
  hp: number
  speed: number // tiles per second
  radius: number // px
  color: number
  accent: number // outline / detail colour
  shape: EnemyShape
  reward: number // gold on kill
}

export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  runner: {
    kind: 'runner',
    name: 'Runner',
    hp: 32,
    speed: 2.35,
    radius: 15,
    color: 0x8dff4a,
    accent: 0x2f7a10,
    shape: 'triangle',
    reward: 6,
  },
  grunt: {
    kind: 'grunt',
    name: 'Grunt',
    hp: 78,
    speed: 1.35,
    radius: 18,
    color: 0xff9b2f,
    accent: 0x8a4400,
    shape: 'square',
    reward: 10,
  },
  brute: {
    kind: 'brute',
    name: 'Brute',
    hp: 240,
    speed: 0.82,
    radius: 27,
    color: 0xff3b6b,
    accent: 0x7a0a28,
    shape: 'hex',
    reward: 22,
  },
}
