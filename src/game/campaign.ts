// CAMPAIGN GENERATOR — the seeded, deterministic level ladder.
//
// Candy-Crush / idle-TD ships thousands of levels by GENERATING them inside a few
// hand-crafted worlds, not by hand-authoring each. This module does the same: for
// each of the six realms it produces a long ladder of levels from a per-realm
// SEED, drawing wave composition from that realm's enemy roster + a global
// introduction schedule, on a smooth difficulty curve, over the varied
// authored-path/terrain library in paths.ts.
//
// • Deterministic: every level is a pure function of (realm, index) via RNG —
//   same seed ⇒ identical ladder on every device. No Math.random / Date.now.
// • Landmark levels (~every 10th) get a mid-realm keeper mini-boss + distinctive
//   path/terrain so the ladder never feels purely generated.
// • Each realm ENDS on its Keeper finale. Realms 1–5 reuse the hand-authored
//   keeper levels (their spectacle + story preserved); Emberwaste's opener stays
//   the tutorial (l1) and its finale is a generated Kaelen fight.
// • LEVELS_PER_WORLD is the LIVE launch count (conservative for quality); the
//   generator itself supports up to GENERATOR_MAX_PER_WORLD so we can dial the
//   ladder up to 500-900+ after a QA pass by bumping one constant.
//
// Beatability is proven at the gate: scripts/simcheck.ts auto-plays every live
// level with real resources and fails the build if any is unwinnable.

import { RNG } from '../sim/rng'
import type { EnemyKind } from './enemies'
import type { TowerKind } from './towers'
import {
  buildPath, computeBuildCandidates, PATH_ARCHETYPES,
  type PathArchetype, type TerrainKind, type TerrainCell,
} from './paths'
import type { LevelDef, Wave, WaveEntry, RealmDef, FieldPalette } from './levels'

// --- LIVE COUNT (dial UP post-QA) ------------------------------------------
export const LEVELS_PER_WORLD = 32        // conservative launch count / world (~192 total)
export const GENERATOR_MAX_PER_WORLD = 150 // supported ceiling — bump LEVELS_PER_WORLD toward this after QA
const LANDMARK_EVERY = 10                  // a spectacle/mini-boss level roughly every Nth stop

// Field palettes (per-realm ground identity). Campaign owns realm data.
export const PAL: Record<string, FieldPalette> = {
  meadow: { grassA: 0x53c66e, grassB: 0x49b862, build: 0x74d98a, path: 0xffcf5c, pathEdge: 0xe0a838 },
  frost: { grassA: 0x6fb6d6, grassB: 0x5ea6c8, build: 0x9fd8ee, path: 0xe8f4ff, pathEdge: 0x9ac0e0 },
  storm: { grassA: 0x3f8a96, grassB: 0x367c88, build: 0x5aa8b4, path: 0xffd54a, pathEdge: 0xc79a20 },
  lumen: { grassA: 0xcdb468, grassB: 0xc1a75c, build: 0xe6d493, path: 0xfff3c8, pathEdge: 0xd9ae44 },
  ember: { grassA: 0xc65c4a, grassB: 0xb84c3c, build: 0xe08070, path: 0xffb24c, pathEdge: 0xc76020 },
  void: { grassA: 0x3a2c66, grassB: 0x322458, build: 0x5a4c86, path: 0xff6ad5, pathEdge: 0xc72a95 },
}

// --- wave construction helpers ---------------------------------------------
function w(entries: WaveEntry[], clearBonus: number): Wave { return { entries, clearBonus } }
function e(kind: EnemyKind, count: number, spacing: number, hpMul = 1): WaveEntry { return { kind, count, spacing, hpMul } }
function k(keeperId: string, hpMul = 1, echo = false): WaveEntry { return { kind: 'keeper', count: 1, spacing: 1, hpMul, keeperId, echo } }

// ---------------------------------------------------------------------------
// HAND-AUTHORED FINALES — the loved keeper levels, kept verbatim for realms
// 1–5, plus l1 as the Emberwaste tutorial opener. Their ids/keeper refs/story
// keys stay stable (keepers.ts, cosmetics 'l6' gate, coach 'l1').
// ---------------------------------------------------------------------------
export const L1_TUTORIAL: LevelDef = {
  id: 'l1', index: 0, name: 'The Cold Forge', blurb: 'Emberwaste · a gentle start',
  lanes: [3, 6, 9], startGold: 240, startLives: 20, baseCoins: 30, palette: PAL.ember,
  waves: [
    w([e('runner', 6, 0.65)], 20),
    w([e('runner', 6, 0.5), e('grunt', 4, 0.8)], 22),
    w([e('grunt', 8, 0.7, 1.05), e('runner', 5, 0.4, 1.05)], 25),
    w([e('runner', 12, 0.4, 1.1), e('grunt', 6, 0.6, 1.1)], 28),
    w([e('grunt', 10, 0.55, 1.2), e('runner', 8, 0.35, 1.2)], 34),
    w([e('runner', 16, 0.3, 1.35), e('grunt', 8, 0.5, 1.35)], 60),
    w([k('kaelen', 0.8, true), e('runner', 10, 0.55, 1.3)], 110), // first taste of a Keeper (echo)
  ],
}

// Finale wave tables for realms 1–5 (Frostreach…Hollow), keyed by keeper level id.
const FINALE_WAVES: Record<string, { name: string; blurb: string; lanes: number[]; startGold: number; startLives: number; baseCoins: number; palette: FieldPalette; waves: Wave[] }> = {
  l2: {
    name: 'Glacier Causeway', blurb: 'Frostreach finale · Maravelle, the Still Oracle',
    lanes: [1, 4, 7, 10], startGold: 300, startLives: 20, baseCoins: 90, palette: PAL.frost,
    waves: [
      w([e('runner', 10, 0.4, 1.2)], 24),
      w([e('grunt', 12, 0.5, 1.3), e('shielded', 3, 0.9, 1.1)], 28),
      w([e('shielded', 6, 0.8, 1.2), e('runner', 14, 0.3, 1.3)], 32),
      w([e('brute', 3, 1.2, 1.35), e('flyer', 6, 0.7, 1.25)], 38),
      w([e('shielded', 8, 0.7, 1.35), e('grunt', 12, 0.45, 1.4)], 44),
      w([e('brute', 5, 1.0, 1.45), e('runner', 16, 0.28, 1.5)], 96),
      w([k('maravelle'), e('grunt', 8, 0.6, 1.4)], 150),
    ],
  },
  l3: {
    name: 'Thunder Steps', blurb: 'Stormpeaks finale · Admiral Vorn, the Becalmed',
    lanes: [2, 4, 6, 8], startGold: 320, startLives: 18, baseCoins: 110, palette: PAL.storm,
    waves: [
      w([e('flyer', 6, 0.8, 1.25), e('runner', 10, 0.4, 1.3)], 26),
      w([e('grunt', 12, 0.5, 1.4), e('flyer', 5, 0.85, 1.3)], 30),
      w([e('brute', 3, 1.2, 1.4), e('flyer', 8, 0.6, 1.35)], 36),
      w([e('runner', 18, 0.26, 1.5), e('flyer', 8, 0.55, 1.4)], 42),
      w([e('flyer', 12, 0.5, 1.45), e('brute', 4, 1.0, 1.55), e('grunt', 12, 0.4, 1.5)], 100),
      w([k('vorn'), e('flyer', 6, 0.7, 1.4), e('grunt', 8, 0.55, 1.45)], 160),
    ],
  },
  l4: {
    name: 'Rootveil Marsh', blurb: 'Verdant finale · Wessa, the Overgrown',
    lanes: [1, 3, 5, 7, 9], startGold: 340, startLives: 18, baseCoins: 130, palette: PAL.meadow,
    waves: [
      w([e('grunt', 12, 0.45, 1.4), e('healer', 3, 1.2, 1.1)], 28),
      w([e('shielded', 6, 0.8, 1.3), e('swarm', 20, 0.16, 1.3)], 32),
      w([e('healer', 4, 1.0, 1.2), e('brute', 3, 1.1, 1.5)], 36),
      w([e('shielded', 8, 0.7, 1.4), e('swarm', 26, 0.13, 1.45)], 42),
      w([e('brute', 5, 1.0, 1.55), e('healer', 4, 1.1, 1.3), e('shielded', 6, 0.7, 1.4)], 48),
      w([e('swarm', 32, 0.12, 1.55), e('brute', 5, 1.0, 1.6), e('healer', 4, 1.0, 1.35)], 120),
      w([k('wessa'), e('shielded', 6, 0.85, 1.4), e('swarm', 16, 0.14, 1.5)], 170),
    ],
  },
  l5: {
    name: 'The Gilded Aisle', blurb: 'Lumen finale · High Cantor Aurelin',
    lanes: [0, 3, 6, 9], startGold: 350, startLives: 16, baseCoins: 150, palette: PAL.lumen,
    waves: [
      w([e('swarm', 24, 0.14, 1.4), e('healer', 2, 1.5, 1.2)], 30),
      w([e('healer', 4, 1.0, 1.3), e('shielded', 6, 0.8, 1.4)], 34),
      w([e('swarm', 30, 0.12, 1.5), e('brute', 3, 1.1, 1.55)], 40),
      w([e('healer', 5, 1.0, 1.35), e('flyer', 10, 0.5, 1.5), e('shielded', 6, 0.8, 1.45)], 46),
      w([e('brute', 5, 1.0, 1.65), e('healer', 5, 1.0, 1.4), e('swarm', 28, 0.12, 1.55)], 52),
      w([e('swarm', 36, 0.11, 1.6), e('healer', 6, 1.0, 1.45), e('brute', 6, 0.95, 1.7)], 140),
      w([k('aurelin'), e('healer', 3, 1.2, 1.4), e('swarm', 20, 0.13, 1.55)], 190),
    ],
  },
  l6: {
    name: 'The Hollow Throne', blurb: "The Hollow finale · Morose's Titan",
    lanes: [0, 2, 4, 6, 8, 10], startGold: 360, startLives: 16, baseCoins: 200, palette: PAL.void,
    waves: [
      w([e('grunt', 14, 0.4, 1.6), e('flyer', 8, 0.6, 1.4)], 32),
      w([e('shielded', 8, 0.7, 1.5), e('swarm', 26, 0.13, 1.5)], 36),
      w([e('healer', 4, 1.0, 1.4), e('brute', 4, 1.0, 1.7)], 40),
      w([e('flyer', 12, 0.45, 1.6), e('shielded', 8, 0.7, 1.55)], 44),
      w([e('swarm', 32, 0.11, 1.7), e('brute', 5, 1.0, 1.8), e('healer', 4, 1.1, 1.45)], 48),
      w([e('shielded', 10, 0.6, 1.6), e('flyer', 12, 0.45, 1.65), e('grunt', 14, 0.35, 1.8)], 54),
      w([e('brute', 6, 0.9, 1.9), e('healer', 5, 1.0, 1.5), e('swarm', 30, 0.11, 1.7)], 60),
      w([k('vesper'), e('swarm', 20, 0.12, 1.7)], 90),
      w([k('kaelen', 1, true), k('maravelle', 1, true), k('vorn', 1, true), k('wessa', 1, true), k('aurelin', 1, true), e('grunt', 12, 0.4, 1.8)], 120),
      w([e('boss', 1, 1, 1.3), e('brute', 6, 0.9, 1.9), e('flyer', 12, 0.4, 1.6), e('swarm', 30, 0.1, 1.7)], 260),
    ],
  },
}

// ---------------------------------------------------------------------------
// REALM GENERATION CONFIG — canon-sourced flavor per realm (chromancer bible).
// ---------------------------------------------------------------------------
interface RealmGen {
  id: string
  name: string
  element: string
  emoji: string
  intro: string
  ui: RealmDef['ui']
  palette: FieldPalette
  keeperId: string
  finaleId: string      // reuses hand-authored finale, or generated for Emberwaste
  roster: EnemyKind[]   // thematic bias — which unlocked enemies dominate here
  terrain: TerrainKind[] // hazard palette (applied to build tiles)
  archetypes: PathArchetype[]
  names: string[]
  suffixes: string[]
}

const REALM_GEN: RealmGen[] = [
  {
    id: 'emberwaste', name: 'Emberwaste', element: 'Fire', emoji: '🔥',
    intro: 'The forges have gone cold and grey. Wake the fire before it forgets how to burn.',
    ui: { accent: '#ff8a4c', deep: '#260c07', mid: '#5a1d0e', glow: 'rgba(255,122,60,.32)', ridge: '#38130a', ridgeFar: '#552012' },
    palette: PAL.ember, keeperId: 'kaelen', finaleId: 'w0_finale',
    roster: ['runner', 'grunt', 'brute'], terrain: ['lava', 'highground'],
    archetypes: ['serpentine', 'corridor', 'zigzag', 'hairpin'],
    names: ['Cinder Causeway', 'The Ashen Steps', 'Ember-Veins Deep', 'Molten Throne', 'Soot-Choked Forge', 'The Snuffing Galleries', 'Slagfall', 'Kaelen’s Reach'],
    suffixes: ['Approach', 'Deep', 'Rise', 'Descent', 'Crossing', 'Vault', 'Furnace', 'Ridge'],
  },
  {
    id: 'frostreach', name: 'Frostreach', element: 'Frost', emoji: '❄️',
    intro: 'The Greying froze even the aurora. Bring back the blue of deep winter ice.',
    ui: { accent: '#7fe3ff', deep: '#081827', mid: '#14395c', glow: 'rgba(127,227,255,.28)', ridge: '#0f2439', ridgeFar: '#1b3c5e' },
    palette: PAL.frost, keeperId: 'maravelle', finaleId: 'l2',
    roster: ['shielded', 'brute', 'flyer', 'swarm'], terrain: ['frozen', 'fog', 'highground'],
    archetypes: ['switchback', 'serpentine', 'spiral', 'verticalSnake'],
    names: ['Spire-Crown Heights', 'The Frozen Throne', 'Aurora Galleries', 'Glacier-Heart Deep', 'Still-Crystal Chasm', 'The Icebound Galleries', 'Rimeward Pass', 'Maravelle’s Vigil'],
    suffixes: ['Heights', 'Chasm', 'Shelf', 'Causeway', 'Hollow', 'Vault', 'Drift', 'Vigil'],
  },
  {
    id: 'stormpeaks', name: 'Stormpeaks', element: 'Storm', emoji: '⚡',
    intro: 'Silent summits where thunder used to sing. Climb, and call the storm back home.',
    ui: { accent: '#ffd95c', deep: '#0a1e22', mid: '#155059', glow: 'rgba(72,214,202,.26)', ridge: '#0d2c31', ridgeFar: '#175059' },
    palette: PAL.storm, keeperId: 'vorn', finaleId: 'l3',
    roster: ['flyer', 'runner', 'brute', 'grunt'], terrain: ['highground', 'fog'],
    archetypes: ['switchback', 'zigzag', 'verticalSnake', 'hairpin'],
    names: ['Windbreak Peaks', 'The Becalmed Isle', 'Cloud-Breach Spire', 'Sky-Rigging Yards', 'Gale’s Crags', 'Storm-Eye Galleries', 'Thunderless Reach', 'Vorn’s Anchorage'],
    suffixes: ['Peaks', 'Spire', 'Crags', 'Reach', 'Ascent', 'Yards', 'Isle', 'Gale'],
  },
  {
    id: 'verdant', name: 'Verdant Wilds', element: 'Nature', emoji: '🌿',
    intro: 'Every leaf hangs ashen and still. The Wilds are waiting for one drop of green.',
    ui: { accent: '#6fe08a', deep: '#0a2010', mid: '#1b4a22', glow: 'rgba(110,224,138,.26)', ridge: '#113016', ridgeFar: '#1e5426' },
    palette: PAL.meadow, keeperId: 'wessa', finaleId: 'l4',
    roster: ['healer', 'swarm', 'shielded', 'runner'], terrain: ['fog', 'highground', 'sacred'],
    archetypes: ['spiral', 'hairpin', 'serpentine', 'corridor'],
    names: ['Thornwood Canopy', 'The Deeproot Chasm', 'Overgrown Sanctum', 'Vine-Heart Galleries', 'Seedbed Thicket', 'Blight-Choked Wilds', 'Mossway', 'Wessa’s Grove'],
    suffixes: ['Canopy', 'Thicket', 'Grove', 'Hollow', 'Tangle', 'Sanctum', 'Reach', 'Deep'],
  },
  {
    id: 'lumen', name: 'Lumen Sanctum', element: 'Light', emoji: '✨',
    intro: 'The last lanterns of Aetheria gutter. Rekindle the Sanctum before its gold goes out.',
    ui: { accent: '#ffe27a', deep: '#241c06', mid: '#59460f', glow: 'rgba(255,226,122,.28)', ridge: '#372c09', ridgeFar: '#5c4c14' },
    palette: PAL.lumen, keeperId: 'aurelin', finaleId: 'l5',
    roster: ['healer', 'shielded', 'swarm', 'flyer'], terrain: ['sacred', 'fog', 'highground'],
    archetypes: ['serpentine', 'spiral', 'corridor', 'zigzag'],
    names: ['Dawnspire Cathedral', 'Golden Halls', 'The Aureate Court', 'Light-Heart Sanctum', 'Blessed Galleries', 'The Radiant Sanctum', 'Gilded Approach', 'Aurelin’s Choir'],
    suffixes: ['Cathedral', 'Halls', 'Court', 'Sanctum', 'Gallery', 'Aisle', 'Nave', 'Choir'],
  },
  {
    id: 'hollow', name: 'The Hollow', element: 'Shadow', emoji: '🌑',
    intro: 'Morose the Hollow King sits at the heart of the Greying. End it — and colour comes home.',
    ui: { accent: '#b06bff', deep: '#0f0722', mid: '#2a1150', glow: 'rgba(176,107,255,.30)', ridge: '#190b34', ridgeFar: '#2c165a' },
    palette: PAL.void, keeperId: 'vesper', finaleId: 'l6',
    roster: ['swarm', 'shielded', 'brute', 'flyer', 'healer'], terrain: ['void', 'fog', 'highground'],
    archetypes: ['spiral', 'switchback', 'zigzag', 'hairpin', 'verticalSnake'],
    names: ['The Mirror Chasm', 'Void-Heart Cathedral', 'The Forgotten Throne', 'Moth-Wing Galleries', 'The Hollow’s Embrace', 'Shard-Breach Sanctum', 'The Grey Between', 'Vesper’s Margin'],
    suffixes: ['Chasm', 'Cathedral', 'Throne', 'Gallery', 'Rift', 'Sanctum', 'Margin', 'Echo'],
  },
]

// --- per-enemy spawn tuning (baseline count/spacing) ------------------------
const KIND_TUNE: Record<string, { base: number; per: number; spacing: number }> = {
  runner: { base: 8, per: 9, spacing: 0.42 },
  grunt: { base: 6, per: 7, spacing: 0.58 },
  brute: { base: 2, per: 2.6, spacing: 1.0 },
  flyer: { base: 4, per: 5, spacing: 0.68 },
  shielded: { base: 4, per: 4, spacing: 0.8 },
  healer: { base: 2, per: 1.8, spacing: 1.2 },
  swarm: { base: 14, per: 16, spacing: 0.14 },
}

// GLOBAL introduction gates (0..1 campaign depth). An enemy may appear only once
// its gate is reached — and anti-air (storm) unlocks BEFORE the flyer gate, so a
// flyer wave is never unfair. Realm roster only WEIGHTS the unlocked set.
const INTRO_GATE: Partial<Record<EnemyKind, number>> = {
  runner: 0, grunt: 0, brute: 0.03, swarm: 0.1, flyer: 0.17, shielded: 0.2, healer: 0.42,
}

function unlockedKinds(globalDepth: number): EnemyKind[] {
  const out: EnemyKind[] = []
  for (const kind of ['runner', 'grunt', 'brute', 'swarm', 'flyer', 'shielded', 'healer'] as EnemyKind[]) {
    if (globalDepth >= (INTRO_GATE[kind] ?? 1)) out.push(kind)
  }
  return out
}

// Weighted pick of an unlocked kind, biased toward the realm's roster.
function pickKind(rng: RNG, unlocked: EnemyKind[], roster: EnemyKind[]): EnemyKind {
  const weighted: EnemyKind[] = []
  for (const kind of unlocked) {
    weighted.push(kind)
    if (roster.includes(kind)) { weighted.push(kind); weighted.push(kind) } // 3× weight for thematic
  }
  return weighted.length ? rng.pick(weighted) : 'runner'
}

function entryCount(kind: EnemyKind, globalDepth: number, waveFrac: number): number {
  const t = KIND_TUNE[kind] ?? KIND_TUNE.runner
  const n = (t.base + globalDepth * t.per) * (0.7 + 0.55 * waveFrac)
  return Math.max(1, Math.round(n))
}

// Deterministically sprinkle realm terrain onto buildable tiles.
function genTerrain(rng: RNG, path: [number, number][], kinds: TerrainKind[], localDepth: number): TerrainCell[] {
  if (kinds.length === 0) return []
  const cands = computeBuildCandidates(path)
  if (cands.length === 0) return []
  const density = 0.14 + 0.16 * localDepth // 14%→30% of buildable tiles carry terrain
  const target = Math.min(cands.length - 1, Math.max(1, Math.round(cands.length * density)))
  const chosen = rng.sample(cands, target)
  const out: TerrainCell[] = []
  for (const [col, row] of chosen) out.push({ col, row, kind: rng.pick(kinds) })
  return out
}

// Generate ONE level for realm `rg` at local index `j` of `count`.
function genLevel(rg: RealmGen, realmOrder: number, j: number, count: number, id: string, unlockTower?: TowerKind): LevelDef {
  const rng = new RNG(((realmOrder * 928371 + j * 40503 + 0x51ce) ^ 0xC0FFEE) >>> 0)
  const localDepth = count <= 1 ? 0 : j / (count - 1)
  const globalDepth = (realmOrder + localDepth) / REALM_GEN.length
  const isFinale = j === count - 1
  const isLandmark = !isFinale && (j + 1) % LANDMARK_EVERY === 0

  const archetype: PathArchetype = isLandmark
    ? rg.archetypes[(j * 7) % rg.archetypes.length]
    : rng.pick(rg.archetypes.length ? rg.archetypes : PATH_ARCHETYPES)
  const path = buildPath(archetype, () => rng.next())
  const terrain = genTerrain(rng, path, rg.terrain, localDepth)

  const baseHp = 1 + globalDepth * 1.3
  const waveCount = Math.max(5, Math.min(9, 5 + Math.round(localDepth * 4)))
  const unlocked = unlockedKinds(globalDepth)
  const waves: Wave[] = []
  for (let wi = 0; wi < waveCount; wi++) {
    const waveFrac = waveCount <= 1 ? 1 : wi / (waveCount - 1)
    const hpMul = +(baseHp * (0.85 + 0.5 * waveFrac)).toFixed(3)
    const entries: WaveEntry[] = []
    const primary = pickKind(rng, unlocked, rg.roster)
    entries.push(e(primary, entryCount(primary, globalDepth, waveFrac), (KIND_TUNE[primary]?.spacing ?? 0.5), hpMul))
    if (waveFrac > 0.35 && rng.chance(0.7)) {
      let secondary = pickKind(rng, unlocked, rg.roster)
      if (secondary === primary && unlocked.length > 1) secondary = rng.pick(unlocked)
      entries.push(e(secondary, Math.round(entryCount(secondary, globalDepth, waveFrac) * 0.7), (KIND_TUNE[secondary]?.spacing ?? 0.5), +(hpMul * 0.98).toFixed(3)))
    }
    const clearBonus = Math.round(20 + globalDepth * 60 + wi * 4)
    waves.push(w(entries, clearBonus))
  }

  // Mid-realm mini-boss: a keeper ECHO caps the landmark's penultimate wave.
  if (isLandmark) {
    const echoHp = +(0.7 + globalDepth * 0.5).toFixed(3)
    waves.splice(waves.length - 1, 0, w([k(rg.keeperId, echoHp, true), e('grunt', Math.round(8 + globalDepth * 8), 0.5, baseHp)], Math.round(80 + globalDepth * 60)))
  }
  // Emberwaste's generated finale — a full Kaelen fight.
  if (isFinale) {
    waves.push(w([k(rg.keeperId), e('brute', Math.round(4 + globalDepth * 4), 0.9, baseHp), e('runner', 12, 0.4, baseHp)], Math.round(140 + globalDepth * 80)))
  }

  const nameBase = isFinale
    ? rg.names[rg.names.length - 1]
    : isLandmark
      ? rg.names[(Math.floor(j / LANDMARK_EVERY)) % (rg.names.length - 1)]
      : rg.names[j % (rg.names.length - 1)]
  const name = isFinale ? nameBase : `${nameBase} ${rg.suffixes[j % rg.suffixes.length]}`

  const startGold = Math.round(240 + globalDepth * 150 + (isLandmark || isFinale ? 30 : 0))
  const startLives = Math.max(12, Math.round(20 - globalDepth * 6))
  const baseCoins = Math.round(30 + globalDepth * 130 + (isLandmark ? 20 : 0) + (isFinale ? 40 : 0))

  return {
    id, index: 0, name,
    blurb: isFinale ? `${rg.name} finale · ${rg.keeperId}` : isLandmark ? `${rg.name} · landmark` : `${rg.name} · stop ${j + 1}`,
    lanes: [3, 6, 9], // fallback; `path` drives the real route
    path, terrain,
    landmark: isFinale ? 'finale' : isLandmark ? 'landmark' : undefined,
    startGold, startLives, baseCoins, palette: rg.palette,
    unlockTower,
    waves,
  }
}

// Wrap a hand-authored finale table into a LevelDef.
function finaleLevel(id: string, rg: RealmGen): LevelDef {
  const f = FINALE_WAVES[id]
  return {
    id, index: 0, name: f.name, blurb: f.blurb, lanes: f.lanes,
    landmark: 'finale', startGold: f.startGold, startLives: f.startLives, baseCoins: f.baseCoins,
    palette: f.palette, waves: f.waves,
  }
}

// Which local index of a realm grants storm / arcane (spread EARLY so players
// aren't gated behind a keeper for basic towers; both land before flyers appear).
const UNLOCK_AT: Record<string, { j: number; tower: TowerKind }> = {
  emberwaste: { j: 5, tower: 'storm' },
  frostreach: { j: 4, tower: 'arcane' },
}

export interface BuiltCampaign { levels: LevelDef[]; realms: RealmDef[]; firstLevelId: string }

export function buildCampaign(perWorld = LEVELS_PER_WORLD): BuiltCampaign {
  const count = Math.max(2, Math.min(GENERATOR_MAX_PER_WORLD, Math.floor(perWorld)))
  const levels: LevelDef[] = []
  const realms: RealmDef[] = []

  REALM_GEN.forEach((rg, realmOrder) => {
    const ids: string[] = []
    const realmLevels: LevelDef[] = []
    for (let j = 0; j < count; j++) {
      const isFinale = j === count - 1
      let lvl: LevelDef
      if (j === 0 && rg.id === 'emberwaste') {
        lvl = { ...L1_TUTORIAL } // the tutorial opener keeps id 'l1'
      } else if (isFinale && rg.finaleId !== 'w0_finale' && FINALE_WAVES[rg.finaleId]) {
        lvl = finaleLevel(rg.finaleId, rg) // reuse the hand-authored keeper level
      } else {
        const id = isFinale ? rg.finaleId : `w${realmOrder}_${j}`
        const unlock = UNLOCK_AT[rg.id]?.j === j ? UNLOCK_AT[rg.id].tower : undefined
        lvl = genLevel(rg, realmOrder, j, count, id, unlock)
      }
      realmLevels.push(lvl)
      ids.push(lvl.id)
    }
    realms.push({ id: rg.id, name: rg.name, element: rg.element, emoji: rg.emoji, intro: rg.intro, ui: rg.ui, levelIds: ids })
    levels.push(...realmLevels)
  })

  // Assign contiguous indices (isLevelUnlocked relies on index === array position).
  levels.forEach((l, i) => { l.index = i })
  return { levels, realms, firstLevelId: 'l1' }
}
