// Campaign level table. Each level owns its path layout, wave table, palette and
// rewards. Paths are built by a serpentine generator that is contiguous BY
// CONSTRUCTION (each cell is grid-adjacent to the next), so no hand-authored path
// can be malformed. Flow: MapScene → BattleScene(levelId) → back with stars.

import type { EnemyKind } from './enemies'
import type { TowerKind } from './towers'

export const GRID_COLS = 9
export const GRID_ROWS = 11

export interface WaveEntry {
  kind: EnemyKind
  count: number
  spacing: number // seconds between spawns in this entry
  hpMul: number
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
  index: number // 0-based order on the map
  name: string
  blurb: string
  lanes: number[] // serpentine rows (strictly increasing) → path
  startGold: number
  startLives: number
  baseCoins: number // meta-coin reward basis (economy scales by stars)
  palette: FieldPalette
  unlockTower?: TowerKind // granted on FIRST clear
  waves: Wave[]
}

// --- serpentine path builder (contiguous by construction) ---
export function serpentine(lanes: number[], cols = GRID_COLS): Array<[number, number]> {
  const cells: Array<[number, number]> = []
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

// Palettes give each realm its own colour identity (battle-field ground colours).
const PAL = {
  meadow: { grassA: 0x53c66e, grassB: 0x49b862, build: 0x74d98a, path: 0xffcf5c, pathEdge: 0xe0a838 },
  frost: { grassA: 0x6fb6d6, grassB: 0x5ea6c8, build: 0x9fd8ee, path: 0xe8f4ff, pathEdge: 0x9ac0e0 },
  storm: { grassA: 0x3f8a96, grassB: 0x367c88, build: 0x5aa8b4, path: 0xffd54a, pathEdge: 0xc79a20 },
  lumen: { grassA: 0xcdb468, grassB: 0xc1a75c, build: 0xe6d493, path: 0xfff3c8, pathEdge: 0xd9ae44 },
  ember: { grassA: 0xc65c4a, grassB: 0xb84c3c, build: 0xe08070, path: 0xffb24c, pathEdge: 0xc76020 },
  void: { grassA: 0x3a2c66, grassB: 0x322458, build: 0x5a4c86, path: 0xff6ad5, pathEdge: 0xc72a95 },
}

// ---------------------------------------------------------------------------
// REALMS — the six elemental realms of Aetheria, in campaign order. The world
// map, realm banners and level theming are all data-driven from this table:
// a realm owns its story intro line, its world-map colours and its level ids.
// The Greying (Morose's colourless corruption) drains every realm the player
// hasn't reached yet; clearing levels restores the colour.
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

export const REALMS: RealmDef[] = [
  {
    id: 'emberwaste',
    name: 'Emberwaste',
    element: 'Fire',
    emoji: '🔥',
    intro: 'The forges have gone cold and grey. Wake the fire before it forgets how to burn.',
    ui: { accent: '#ff8a4c', deep: '#260c07', mid: '#5a1d0e', glow: 'rgba(255,122,60,.32)', ridge: '#38130a', ridgeFar: '#552012' },
    levelIds: ['l1'],
  },
  {
    id: 'frostreach',
    name: 'Frostreach',
    element: 'Frost',
    emoji: '❄️',
    intro: 'The Greying froze even the aurora. Bring back the blue of deep winter ice.',
    ui: { accent: '#7fe3ff', deep: '#081827', mid: '#14395c', glow: 'rgba(127,227,255,.28)', ridge: '#0f2439', ridgeFar: '#1b3c5e' },
    levelIds: ['l2'],
  },
  {
    id: 'stormpeaks',
    name: 'Stormpeaks',
    element: 'Storm',
    emoji: '⚡',
    intro: 'Silent summits where thunder used to sing. Climb, and call the storm back home.',
    ui: { accent: '#ffd95c', deep: '#0a1e22', mid: '#155059', glow: 'rgba(72,214,202,.26)', ridge: '#0d2c31', ridgeFar: '#175059' },
    levelIds: ['l3'],
  },
  {
    id: 'verdant',
    name: 'Verdant Wilds',
    element: 'Nature',
    emoji: '🌿',
    intro: 'Every leaf hangs ashen and still. The Wilds are waiting for one drop of green.',
    ui: { accent: '#6fe08a', deep: '#0a2010', mid: '#1b4a22', glow: 'rgba(110,224,138,.26)', ridge: '#113016', ridgeFar: '#1e5426' },
    levelIds: ['l4'],
  },
  {
    id: 'lumen',
    name: 'Lumen Sanctum',
    element: 'Light',
    emoji: '✨',
    intro: 'The last lanterns of Aetheria gutter. Rekindle the Sanctum before its gold goes out.',
    ui: { accent: '#ffe27a', deep: '#241c06', mid: '#59460f', glow: 'rgba(255,226,122,.28)', ridge: '#372c09', ridgeFar: '#5c4c14' },
    levelIds: ['l5'],
  },
  {
    id: 'hollow',
    name: 'The Hollow',
    element: 'Shadow',
    emoji: '🌑',
    intro: 'Morose the Hollow King sits at the heart of the Greying. End it — and colour comes home.',
    ui: { accent: '#b06bff', deep: '#0f0722', mid: '#2a1150', glow: 'rgba(176,107,255,.30)', ridge: '#190b34', ridgeFar: '#2c165a' },
    levelIds: ['l6'],
  },
]

export function realmForLevel(levelId: string): RealmDef {
  return REALMS.find((r) => r.levelIds.includes(levelId)) ?? REALMS[0]
}

function w(entries: WaveEntry[], clearBonus: number): Wave {
  return { entries, clearBonus }
}
function e(kind: EnemyKind, count: number, spacing: number, hpMul = 1): WaveEntry {
  return { kind, count, spacing, hpMul }
}

export const LEVELS: LevelDef[] = [
  {
    id: 'l1',
    index: 0,
    name: 'The Cold Forge',
    blurb: 'Emberwaste · a gentle start',
    lanes: [3, 6, 9],
    startGold: 240,
    startLives: 20,
    baseCoins: 30,
    palette: PAL.ember,
    waves: [
      w([e('runner', 6, 0.65)], 20),
      w([e('runner', 6, 0.5), e('grunt', 4, 0.8)], 22),
      w([e('grunt', 8, 0.7, 1.05), e('runner', 5, 0.4, 1.05)], 25),
      w([e('runner', 12, 0.4, 1.1), e('grunt', 6, 0.6, 1.1)], 28),
      w([e('grunt', 10, 0.55, 1.2), e('runner', 8, 0.35, 1.2)], 34),
      w([e('runner', 16, 0.3, 1.35), e('grunt', 8, 0.5, 1.35)], 60),
    ],
  },
  {
    id: 'l2',
    index: 1,
    name: 'Glacier Causeway',
    blurb: 'Brutes arrive · clear to unlock STORM',
    lanes: [1, 4, 7, 10],
    startGold: 260,
    startLives: 20,
    baseCoins: 45,
    palette: PAL.frost,
    unlockTower: 'storm',
    waves: [
      w([e('runner', 8, 0.5)], 22),
      w([e('grunt', 8, 0.6, 1.1)], 24),
      w([e('runner', 10, 0.35, 1.1), e('brute', 1, 1, 1)], 28),
      w([e('grunt', 10, 0.5, 1.2), e('brute', 2, 1.2, 1.05)], 32),
      w([e('runner', 14, 0.3, 1.3), e('grunt', 8, 0.5, 1.3)], 36),
      w([e('brute', 3, 1.2, 1.2), e('grunt', 8, 0.5, 1.35)], 42),
      w([e('brute', 4, 1.0, 1.35), e('runner', 14, 0.28, 1.4)], 90),
    ],
  },
  {
    id: 'l3',
    index: 2,
    name: 'Thunder Steps',
    blurb: 'Flyers! Only Storm/Arcane hit them · unlock ARCANE',
    lanes: [2, 4, 6, 8],
    startGold: 280,
    startLives: 18,
    baseCoins: 65,
    palette: PAL.storm,
    unlockTower: 'arcane',
    waves: [
      w([e('runner', 10, 0.4, 1.2), e('grunt', 6, 0.6, 1.2)], 24),
      w([e('flyer', 5, 0.8, 1)], 28),
      w([e('grunt', 10, 0.5, 1.3), e('flyer', 4, 0.9, 1.05)], 30),
      w([e('brute', 2, 1.2, 1.3), e('flyer', 6, 0.7, 1.1)], 34),
      w([e('runner', 16, 0.28, 1.4), e('flyer', 6, 0.6, 1.15)], 38),
      w([e('grunt', 12, 0.45, 1.5), e('brute', 3, 1.1, 1.35)], 44),
      w([e('flyer', 10, 0.5, 1.3), e('brute', 4, 1.0, 1.45), e('grunt', 10, 0.4, 1.5)], 100),
    ],
  },
  {
    id: 'l4',
    index: 3,
    name: 'Rootveil Marsh',
    blurb: 'Bulwarks shrug off damage until their shield breaks',
    lanes: [1, 3, 5, 7, 9],
    startGold: 300,
    startLives: 18,
    baseCoins: 90,
    palette: PAL.meadow,
    waves: [
      w([e('grunt', 10, 0.45, 1.3), e('flyer', 4, 0.8, 1.1)], 26),
      w([e('shielded', 5, 0.9, 1)], 30),
      w([e('shielded', 6, 0.8, 1.05), e('runner', 12, 0.3, 1.4)], 32),
      w([e('brute', 3, 1.1, 1.4), e('flyer', 6, 0.7, 1.2)], 36),
      w([e('shielded', 8, 0.7, 1.15), e('grunt', 10, 0.45, 1.5)], 40),
      w([e('flyer', 10, 0.5, 1.3), e('shielded', 6, 0.8, 1.2)], 44),
      w([e('brute', 4, 1.0, 1.5), e('shielded', 6, 0.7, 1.25), e('runner', 14, 0.28, 1.55)], 50),
      w([e('shielded', 10, 0.6, 1.3), e('brute', 5, 1.0, 1.55), e('flyer', 8, 0.5, 1.35)], 120),
    ],
  },
  {
    id: 'l5',
    index: 4,
    name: 'The Gilded Aisle',
    blurb: 'Menders heal · Sprites swarm in packs',
    lanes: [0, 3, 6, 9],
    startGold: 320,
    startLives: 16,
    baseCoins: 120,
    palette: PAL.lumen,
    waves: [
      w([e('swarm', 20, 0.16, 1.2)], 28),
      w([e('healer', 3, 1.2, 1), e('grunt', 10, 0.45, 1.4)], 32),
      w([e('swarm', 24, 0.14, 1.3), e('healer', 2, 1.5, 1.05)], 34),
      w([e('shielded', 6, 0.8, 1.3), e('healer', 3, 1.2, 1.1)], 38),
      w([e('swarm', 28, 0.13, 1.4), e('brute', 3, 1.1, 1.5)], 42),
      w([e('healer', 4, 1.0, 1.2), e('flyer', 10, 0.5, 1.4), e('shielded', 6, 0.8, 1.3)], 46),
      w([e('brute', 5, 1.0, 1.6), e('healer', 4, 1.1, 1.25), e('swarm', 24, 0.13, 1.5)], 52),
      w([e('swarm', 36, 0.11, 1.5), e('healer', 5, 1.0, 1.3), e('brute', 5, 1.0, 1.65)], 140),
    ],
  },
  {
    id: 'l6',
    index: 5,
    name: 'The Hollow Throne',
    blurb: "Everything at once — and Morose's Titan",
    lanes: [0, 2, 4, 6, 8, 10],
    startGold: 340,
    startLives: 16,
    baseCoins: 160,
    palette: PAL.void,
    waves: [
      w([e('grunt', 12, 0.4, 1.5), e('flyer', 8, 0.6, 1.3)], 30),
      w([e('shielded', 8, 0.7, 1.4), e('swarm', 24, 0.13, 1.4)], 34),
      w([e('healer', 4, 1.0, 1.3), e('brute', 4, 1.0, 1.6)], 38),
      w([e('flyer', 12, 0.45, 1.5), e('shielded', 8, 0.7, 1.45)], 42),
      w([e('swarm', 32, 0.11, 1.6), e('brute', 5, 1.0, 1.7), e('healer', 4, 1.1, 1.35)], 46),
      w([e('shielded', 10, 0.6, 1.5), e('flyer', 12, 0.45, 1.55), e('grunt', 14, 0.35, 1.7)], 52),
      w([e('brute', 6, 0.9, 1.8), e('healer', 5, 1.0, 1.4), e('swarm', 30, 0.11, 1.6)], 58),
      w([e('boss', 1, 1, 1), e('shielded', 8, 0.7, 1.5)], 70),
      w([e('boss', 1, 1, 1.3), e('brute', 6, 0.9, 1.9), e('flyer', 12, 0.4, 1.6), e('swarm', 30, 0.1, 1.7)], 250),
    ],
  },
]

export function levelById(id: string): LevelDef | undefined {
  return LEVELS.find((l) => l.id === id)
}

// A level is unlocked if it's the first, or the previous level has >= 1 star.
export function isLevelUnlocked(index: number, stars: Record<string, number>): boolean {
  if (index <= 0) return true
  const prev = LEVELS[index - 1]
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
