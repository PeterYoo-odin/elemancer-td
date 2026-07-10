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
  buildPathPlan, computeBuildCandidates, connectAnchors,
  SIMPLE_ARCHETYPES, COMPLEX_ARCHETYPES, MULTI_TOPOLOGIES,
  type PathArchetype, type PathTopology, type TerrainKind, type TerrainCell,
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
    roster: ['shielded', 'brute', 'flyer', 'swarm', 'armored'], terrain: ['frozen', 'fog', 'highground'],
    archetypes: ['switchback', 'serpentine', 'spiral', 'verticalSnake'],
    names: ['Spire-Crown Heights', 'The Frozen Throne', 'Aurora Galleries', 'Glacier-Heart Deep', 'Still-Crystal Chasm', 'The Icebound Galleries', 'Rimeward Pass', 'Maravelle’s Vigil'],
    suffixes: ['Heights', 'Chasm', 'Shelf', 'Causeway', 'Hollow', 'Vault', 'Drift', 'Vigil'],
  },
  {
    id: 'stormpeaks', name: 'Stormpeaks', element: 'Storm', emoji: '⚡',
    intro: 'Silent summits where thunder used to sing. Climb, and call the storm back home.',
    ui: { accent: '#ffd95c', deep: '#0a1e22', mid: '#155059', glow: 'rgba(72,214,202,.26)', ridge: '#0d2c31', ridgeFar: '#175059' },
    palette: PAL.storm, keeperId: 'vorn', finaleId: 'l3',
    roster: ['flyer', 'runner', 'brute', 'grunt', 'armored', 'elite'], terrain: ['highground', 'fog'],
    archetypes: ['switchback', 'zigzag', 'verticalSnake', 'hairpin'],
    names: ['Windbreak Peaks', 'The Becalmed Isle', 'Cloud-Breach Spire', 'Sky-Rigging Yards', 'Gale’s Crags', 'Storm-Eye Galleries', 'Thunderless Reach', 'Vorn’s Anchorage'],
    suffixes: ['Peaks', 'Spire', 'Crags', 'Reach', 'Ascent', 'Yards', 'Isle', 'Gale'],
  },
  {
    id: 'verdant', name: 'Verdant Wilds', element: 'Nature', emoji: '🌿',
    intro: 'Every leaf hangs ashen and still. The Wilds are waiting for one drop of green.',
    ui: { accent: '#6fe08a', deep: '#0a2010', mid: '#1b4a22', glow: 'rgba(110,224,138,.26)', ridge: '#113016', ridgeFar: '#1e5426' },
    palette: PAL.meadow, keeperId: 'wessa', finaleId: 'l4',
    roster: ['healer', 'swarm', 'shielded', 'runner', 'elite'], terrain: ['fog', 'highground', 'sacred'],
    archetypes: ['spiral', 'hairpin', 'serpentine', 'corridor'],
    names: ['Thornwood Canopy', 'The Deeproot Chasm', 'Overgrown Sanctum', 'Vine-Heart Galleries', 'Seedbed Thicket', 'Blight-Choked Wilds', 'Mossway', 'Wessa’s Grove'],
    suffixes: ['Canopy', 'Thicket', 'Grove', 'Hollow', 'Tangle', 'Sanctum', 'Reach', 'Deep'],
  },
  {
    id: 'lumen', name: 'Lumen Sanctum', element: 'Light', emoji: '✨',
    intro: 'The last lanterns of Aetheria gutter. Rekindle the Sanctum before its gold goes out.',
    ui: { accent: '#ffe27a', deep: '#241c06', mid: '#59460f', glow: 'rgba(255,226,122,.28)', ridge: '#372c09', ridgeFar: '#5c4c14' },
    palette: PAL.lumen, keeperId: 'aurelin', finaleId: 'l5',
    roster: ['healer', 'shielded', 'swarm', 'flyer', 'elite'], terrain: ['sacred', 'fog', 'highground'],
    archetypes: ['serpentine', 'spiral', 'corridor', 'zigzag'],
    names: ['Dawnspire Cathedral', 'Golden Halls', 'The Aureate Court', 'Light-Heart Sanctum', 'Blessed Galleries', 'The Radiant Sanctum', 'Gilded Approach', 'Aurelin’s Choir'],
    suffixes: ['Cathedral', 'Halls', 'Court', 'Sanctum', 'Gallery', 'Aisle', 'Nave', 'Choir'],
  },
  {
    id: 'hollow', name: 'The Hollow', element: 'Shadow', emoji: '🌑',
    intro: 'Morose the Hollow King sits at the heart of the Greying. End it — and colour comes home.',
    ui: { accent: '#b06bff', deep: '#0f0722', mid: '#2a1150', glow: 'rgba(176,107,255,.30)', ridge: '#190b34', ridgeFar: '#2c165a' },
    palette: PAL.void, keeperId: 'vesper', finaleId: 'l6',
    roster: ['swarm', 'shielded', 'brute', 'flyer', 'healer', 'armored', 'elite'], terrain: ['void', 'fog', 'highground'],
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
  armored: { base: 3, per: 3.2, spacing: 0.78 },
  elite: { base: 1, per: 1.7, spacing: 1.15 },
}

// ===========================================================================
//  DIFFICULTY CURVE (harness-tuned — validated by `npm run difficulty` and the
//  simcheck beatability gate). `prog` = realmOrder + localDepth, i.e. 0 at the
//  very first stop … ~6 at the deepest Hollow stop. The old curve compressed each
//  realm into 1/6 of a shallow [1, 2.3] band, so an un-upgraded mono/trio build
//  cruised ~15 levels with "no problems" — all the depth (upgrades, branches,
//  reactions, fusions) was optional. This curve is:
//    · STEEP EARLY  — the sqrt term bites by the realm-0 midpoint (~L6-8), so a
//      flat, un-upgraded defence can no longer out-DPS the wave.
//    · SUSTAINED    — the linear term keeps demanding more DPS every realm, so
//      the player must keep upgrading, branching and comboing to keep pace.
//  No immunities are introduced anywhere — difficulty is HP / count / composition
//  only; the combat model's 0.5× floor is untouched.
// ===========================================================================
// Two-term shape. The key insight: the beatability CEILING (the @16 upgraded-spread
// bot must clear all 192) binds in the DEEP realms — the early realms have enormous
// headroom. So we lift them independently:
//   · EARLY BUMP  — a term that ramps across the first realm then SATURATES (flat
//     thereafter), so Emberwaste stops being a coast (an un-upgraded 3-tower build
//     can't keep pace by mid-realm-0) WITHOUT inflating the deep realms it can't
//     afford to inflate. This is where the "played 15 levels, no problems" bug dies.
//   · SUPERLINEAR — takes over past realm 0 and stays RELENTLESS through the deep
//     realms (every realm out-demands the last — a ramp, not a wall-then-plateau).
// Difficulty is HP/count/composition only — no immunities, the 0.5× floor is intact.
const HP_E = 4.5      // early bump magnitude (fully applied by ~realm-0 exit)
const HP_ESAT = 0.85  // prog at which the early bump saturates (~L20)
const HP_K = 2.0      // late coefficient
const HP_P = 1.15     // mild superlinear — relentless without exploding the deep realms
const CNT_PER = 0.5   // extra enemies per prog unit — crowd pressure ramps into the late game
const CNT_EARLY = 4.0 // early count kicker: denser waves stress a thin board's COVERAGE

function difficultyHp(prog: number): number {
  const p = Math.max(0, prog)
  return 1 + HP_E * Math.min(1, p / HP_ESAT) + HP_K * Math.pow(p, HP_P)
}

// GLOBAL introduction gates, in `prog` units (realmOrder + localDepth ∈ [0,6]). An
// enemy appears only once its gate is reached. Anti-air (Storm) is owned from L6,
// so flyers gate at prog ≥ 0.55 (well after) — never unfair. Threats are pulled
// EARLIER than before so the very first realm already interleaves types that no
// single tower answers, forcing a varied defence. Realm roster only WEIGHTS the
// unlocked set; the 0.5× no-immunity rule keeps ≥2 viable answers to each threat.
// armored/elite gate LAST (after healer) — they're the ones that actually punish a
// mono damage-type board (Fortified folds Pierce/Physical; Warded folds Magic), so
// they only show up once the player has had every earlier realm to pick up a spread
// of towers. Never in l1 (the tutorial is hand-authored and untouched by this gate).
const INTRO_GATE: Partial<Record<EnemyKind, number>> = {
  runner: 0, grunt: 0, brute: 0.18, swarm: 0.35, flyer: 0.55, shielded: 0.7, healer: 1.15,
  armored: 0.9, elite: 1.3,
}

function unlockedKinds(prog: number): EnemyKind[] {
  const out: EnemyKind[] = []
  for (const kind of ['runner', 'grunt', 'brute', 'swarm', 'flyer', 'shielded', 'healer', 'armored', 'elite'] as EnemyKind[]) {
    if (prog >= (INTRO_GATE[kind] ?? 1e9)) out.push(kind)
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

function entryCount(kind: EnemyKind, prog: number, waveFrac: number): number {
  const t = KIND_TUNE[kind] ?? KIND_TUNE.runner
  const n = (t.base + prog * t.per * CNT_PER + prog * CNT_EARLY) * (0.7 + 0.55 * waveFrac)
  return Math.max(1, Math.round(n))
}

// Difficulty-tiered archetype pick, blended with the realm's thematic set for
// flavor. Early stops draw the SIMPLE (open, few-turn) shapes; deep + landmark
// stops draw the COMPLEX (many-chokepoint) shapes — map complexity tracks the curve.
function pickArchetype(rng: RNG, prog: number, realmArchetypes: PathArchetype[], forceComplex: boolean): PathArchetype {
  const tier: PathArchetype[] = forceComplex || prog >= 2.6
    ? COMPLEX_ARCHETYPES
    : prog < 0.9
      ? SIMPLE_ARCHETYPES
      : [...SIMPLE_ARCHETYPES, 'serpentine', 'verticalSnake', 'zigzag', 'switchback']
  const pool = [...tier, ...realmArchetypes]
  return pool.length ? rng.pick(pool) : 'serpentine'
}

// Deterministically place realm terrain onto buildable tiles, SHAPED by openness
// (req #3/#4): range-buff tiles (high-ground / sacred) land in OPEN pockets so
// coverage pays off, while hazard/damage tiles cling to the tight path edges near
// chokepoints. Takes the full route PLAN (union of all lanes). Density ramps with
// depth. Per-realm `kinds` keeps each realm's terrain flavor distinct.
function genTerrain(rng: RNG, routes: [number, number][][], kinds: TerrainKind[], localDepth: number): TerrainCell[] {
  if (kinds.length === 0) return []
  const flat = routes.flat()
  const cands = computeBuildCandidates(flat)
  if (cands.length === 0) return []
  const onPath = new Set(flat.map(([c, r]) => `${c},${r}`))
  const rangeKinds = kinds.filter((k) => k === 'highground' || k === 'sacred')
  const otherKinds = kinds.filter((k) => k !== 'highground' && k !== 'sacred')
  // openness = non-path neighbours (0..8) — higher means a more open pocket.
  const openness = (col: number, row: number): number => {
    let open = 0
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue
      if (!onPath.has(`${col + dc},${row + dr}`)) open++
    }
    return open
  }
  const density = 0.16 + 0.18 * localDepth // 16%→34% of buildable tiles carry terrain
  const target = Math.min(cands.length - 1, Math.max(1, Math.round(cands.length * density)))
  const chosen = rng.sample(cands, target)
  const out: TerrainCell[] = []
  for (const [col, row] of chosen) {
    const isOpen = openness(col, row) >= 6
    const pool = isOpen && rangeKinds.length ? rangeKinds : !isOpen && otherKinds.length ? otherKinds : kinds
    out.push({ col, row, kind: rng.pick(pool) })
  }
  return out
}

// Generate ONE level for realm `rg` at local index `j` of `count`.
function genLevel(rg: RealmGen, realmOrder: number, j: number, count: number, id: string, unlockTower?: TowerKind): LevelDef {
  const rng = new RNG(((realmOrder * 928371 + j * 40503 + 0x51ce) ^ 0xC0FFEE) >>> 0)
  const localDepth = count <= 1 ? 0 : j / (count - 1)
  const globalDepth = (realmOrder + localDepth) / REALM_GEN.length
  const isFinale = j === count - 1
  const isLandmark = !isFinale && (j + 1) % LANDMARK_EVERY === 0
  const prog = realmOrder + localDepth

  // TOPOLOGY & SHAPE tied to difficulty (req #1/#5). Early stops read open + simple;
  // deep + landmark stops get trickier — more turns, and MULTI-SPAWN lanes that
  // converge on the base. The wave is SPLIT across lanes (not duplicated), so
  // beatability holds; the simcheck gate re-proves every generated level.
  const forceComplex = isLandmark || isFinale
  const archetype = pickArchetype(rng, prog, rg.archetypes, forceComplex)
  // MULTI-SPAWN frequency is a TRAPEZOID over the ladder: it stays off for the first
  // few tutorial stops, ramps up so it's already present within the opening realm
  // (the owner's "first 15 levels" — where the repetitive feel was reported), holds a
  // plateau through the mid realms, then tapers to zero before the deepest realms.
  // Why the taper: the difficulty curve (#37) pins the deep realms at the HP/count
  // beatability ceiling, so the extra COVERAGE burden of two lanes there would make
  // them unwinnable for a min-resource defence — those realms get their "trickier
  // topology" from COMPLEX single-lane shapes instead. Finales (each realm's hardest
  // stop) never go multi. All of this is re-proven beatable by the simcheck gate.
  const MULTI_LO = 0.25, MULTI_HI = 2.0 // active window in prog units (Emberwaste→Frostreach)
  let multiChance = 0
  if (!isFinale && prog >= MULTI_LO && prog <= MULTI_HI) {
    const rampUp = Math.min(1, (prog - MULTI_LO) / 0.5)
    const rampDown = Math.min(1, (MULTI_HI - prog) / 0.4)
    multiChance = 0.4 * Math.max(0, Math.min(rampUp, rampDown))
    if (isLandmark) multiChance += 0.2
  }
  const topology: PathTopology = rng.chance(Math.min(0.7, multiChance)) ? rng.pick(MULTI_TOPOLOGIES) : 'single'
  const plan = buildPathPlan(topology, archetype, () => rng.next())
  const path = plan[0]
  const paths = plan.length > 1 ? plan : undefined
  const terrain = genTerrain(rng, plan, rg.terrain, localDepth)
  const baseHp = difficultyHp(prog)
  const waveCount = Math.max(5, Math.min(9, 5 + Math.round(localDepth * 4)))
  const unlocked = unlockedKinds(prog)
  const waves: Wave[] = []
  // Draw a DISTINCT kind, different from anything already in this wave, so the
  // interleaved threats genuinely demand different answers (no two runner-clones).
  const pickDistinct = (used: EnemyKind[]): EnemyKind => {
    for (let tries = 0; tries < 6; tries++) {
      const cand = pickKind(rng, unlocked, rg.roster)
      if (!used.includes(cand)) return cand
    }
    const rest = unlocked.filter((u) => !used.includes(u))
    return rest.length ? rng.pick(rest) : pickKind(rng, unlocked, rg.roster)
  }
  for (let wi = 0; wi < waveCount; wi++) {
    const waveFrac = waveCount <= 1 ? 1 : wi / (waveCount - 1)
    // Intra-level ramp with a DEPTH-DEPENDENT opener: early realms open punchy
    // (0.85×) so the lazy build is pressured from wave 1, but deep realms — where
    // baseHp is huge — open gentler (down to ~0.6×) so wave 1 is survivable before
    // any defence is built (else a 25× opener is an unavoidable death, not a fair
    // fight). The peak (last wave) stays ~1.35× baseHp at every realm.
    const openFloor = Math.max(0.6, Math.min(0.85, 0.85 - 0.045 * prog))
    const hpMul = +(baseHp * (openFloor + (1.35 - openFloor) * waveFrac)).toFixed(3)
    const entries: WaveEntry[] = []
    const used: EnemyKind[] = []
    const primary = pickKind(rng, unlocked, rg.roster)
    used.push(primary)
    entries.push(e(primary, entryCount(primary, prog, waveFrac), (KIND_TUNE[primary]?.spacing ?? 0.5), hpMul))
    // SECONDARY threat — from the level's midpoint on, and always in the back half.
    // Interleaving two archetypes that no single tower answers is the core "you need
    // a mix" pressure, pulled in far earlier than the old 0.35 / 70%-chance gate.
    if (unlocked.length > 1 && (waveFrac >= 0.4 || (waveFrac > 0.15 && rng.chance(0.6)))) {
      const secondary = pickDistinct(used)
      used.push(secondary)
      entries.push(e(secondary, Math.round(entryCount(secondary, prog, waveFrac) * 0.72), (KIND_TUNE[secondary]?.spacing ?? 0.5), +(hpMul * 0.98).toFixed(3)))
    }
    // TERTIARY threat — deep runs (prog high) throw a third distinct type into the
    // final waves, so late levels are a true mixed assault that punishes mono builds.
    if (unlocked.length > 2 && prog >= 1.2 && waveFrac >= 0.7) {
      const tertiary = pickDistinct(used)
      used.push(tertiary)
      entries.push(e(tertiary, Math.max(1, Math.round(entryCount(tertiary, prog, waveFrac) * 0.55)), (KIND_TUNE[tertiary]?.spacing ?? 0.5), +(hpMul * 0.96).toFixed(3)))
    }
    const clearBonus = Math.round(18 + prog * 16 + wi * 4)
    waves.push(w(entries, clearBonus))
  }

  // Mid-realm mini-boss: a keeper ECHO caps the landmark's penultimate wave.
  if (isLandmark) {
    const echoHp = +(0.7 + prog * 0.28).toFixed(3)
    waves.splice(waves.length - 1, 0, w([k(rg.keeperId, echoHp, true), e('grunt', Math.round(8 + prog * 4), 0.5, baseHp)], Math.round(80 + prog * 22)))
  }
  // Emberwaste's generated finale — a full Kaelen fight.
  if (isFinale) {
    waves.push(w([k(rg.keeperId), e('brute', Math.round(4 + prog * 1.5), 0.9, baseHp), e('runner', 12, 0.4, baseHp)], Math.round(140 + prog * 28)))
  }

  const nameBase = isFinale
    ? rg.names[rg.names.length - 1]
    : isLandmark
      ? rg.names[(Math.floor(j / LANDMARK_EVERY)) % (rg.names.length - 1)]
      : rg.names[j % (rg.names.length - 1)]
  const name = isFinale ? nameBase : `${nameBase} ${rg.suffixes[j % rg.suffixes.length]}`

  // Opening gold rises with depth so a deep-realm player can actually establish a
  // defence before the (now much tankier) wave 1 lands — without being so rich that
  // cheap-spam works (the steep HP curve out-scales an un-upgraded board regardless).
  // A REALM-OPENER cushion softens the roster shift each realm opens on (the first
  // stops have few waves to bank gold yet already face the realm's harsh new mix) —
  // so the boundary is a fair step-up, not a spike only one build survives.
  const opener = localDepth < 0.25 ? Math.round((0.25 - localDepth) * 180) : 0
  // MULTI-SPAWN cushion: two entry mouths demand earlier coverage on both lanes, so
  // a small opening-gold bump keeps these fair (not a knife-edge) without touching
  // single-lane economy. The wave is still SPLIT not multiplied.
  const multiCushion = paths ? 45 : 0
  const startGold = Math.round(240 + prog * 45 + opener + multiCushion + (isLandmark || isFinale ? 40 : 0))
  const startLives = Math.max(12, Math.round(20 - globalDepth * 6))
  const baseCoins = Math.round(30 + globalDepth * 130 + (isLandmark ? 20 : 0) + (isFinale ? 40 : 0))

  return {
    id, index: 0, name,
    blurb: isFinale ? `${rg.name} finale · ${rg.keeperId}` : isLandmark ? `${rg.name} · landmark` : `${rg.name} · stop ${j + 1}`,
    lanes: [3, 6, 9], // fallback; `path`/`paths` drive the real route(s)
    path, paths, terrain,
    landmark: isFinale ? 'finale' : isLandmark ? 'landmark' : undefined,
    startGold, startLives, baseCoins, palette: rg.palette,
    unlockTower,
    waves,
  }
}

// Wrap a hand-authored finale table into a LevelDef. The loved finale wave TABLES
// were tuned to the OLD shallow curve (hpMul ~1.1-1.9); on the new steep curve the
// generated levels leading up to them out-scale them, which would leave each realm
// ENDING in a difficulty crater at its boss. We lift every entry's hpMul onto the
// new curve by the same factor the generator gained at this prog, so the finale
// stays the realm's hardest stop — its authored SHAPE (which wave is spiky, the
// keeper beats) preserved, only the magnitude re-based. Beatability is re-proven by
// the simcheck gate on every one of these levels.
function finaleLevel(id: string, rg: RealmGen, realmOrder: number): LevelDef {
  const f = FINALE_WAVES[id]
  const prog = realmOrder + 1 // a finale sits at the realm's deepest prog
  const oldBase = 1 + (prog / REALM_GEN.length) * 1.3 // the curve the tables were tuned to
  const scale = +(difficultyHp(prog) / oldBase).toFixed(3)
  const waves: Wave[] = f.waves.map((wave) => ({
    clearBonus: wave.clearBonus,
    entries: wave.entries.map((en) => ({ ...en, hpMul: +(((en.hpMul ?? 1) * scale)).toFixed(3) })),
  }))
  return {
    id, index: 0, name: f.name, blurb: f.blurb, lanes: f.lanes,
    landmark: 'finale', startGold: f.startGold, startLives: f.startLives, baseCoins: f.baseCoins,
    palette: f.palette, waves,
  }
}

// ---------------------------------------------------------------------------
// WAYPOINTS — CHROMANCER #52: 3 hand-authored set-piece levels per realm
// (18 total, 6→24 authored), REPLACING specific generated slots so level
// `index` stays contiguous and the 192-level total is untouched. Each waypoint
// carries a genuine gimmick — never a reskin of the procedural HP curve:
//   · MINI-BOSS  — a single named foe (an existing enemy archetype, hugely
//     buffed, alone) flanked by an escort, introduced by an authored bark.
//   · FIXED LANE — a bespoke hand-drawn route (via connectAnchors) that no
//     procedural archetype produces, place ONCE, never regenerated.
//   · MID-WAVE EVENT — a scripted ambush wave at a fixed point in the level
//     that nudges the player toward a specific elemental reaction using the
//     towers they already own at that depth.
// Difficulty stays on the SAME curve as the generator (difficultyHp(prog) at
// this waypoint's exact realm/depth), so beatability is proven the same way
// (the simcheck auto-player), not hand-waved.
// ---------------------------------------------------------------------------
// Waypoints sit at local index 8/16/24 (~1/4, ~1/2, ~3/4 depth of each 32-stop
// realm) — see the `WAYPOINTS` keys below for the exact per-realm placement.
interface WaypointSpec {
  name: string
  blurb: string
  lanes?: number[]
  path?: Array<[number, number]>
  waves: (baseHp: number) => Wave[]
}

// Compact wave builders shared by every waypoint table below. `mul` is a
// fraction of this waypoint's REAL difficultyHp(prog) baseline (same curve the
// generator uses), so magnitude always tracks the ladder's actual depth.
function stdWave(baseHp: number, mul: number, clearBonus: number, entries: Array<[EnemyKind, number, number]>): Wave {
  return w(entries.map(([kind, count, spacing]) => e(kind, count, spacing, +(baseHp * mul).toFixed(3))), clearBonus)
}
function bossWave(
  baseHp: number, bossMul: number, escortMul: number, clearBonus: number,
  boss: [EnemyKind, number, number], escorts: Array<[EnemyKind, number, number]>,
): Wave {
  return w([
    e(boss[0], boss[1], boss[2], +(baseHp * bossMul).toFixed(3)),
    ...escorts.map(([kind, count, spacing]) => e(kind, count, spacing, +(baseHp * escortMul).toFixed(3))),
  ], clearBonus)
}

const WAYPOINTS: Record<string, Partial<Record<number, WaypointSpec>>> = {
  emberwaste: {
    8: { // MINI-BOSS — Grask the Cinderback
      name: 'The Cinderback Trial', blurb: 'Emberwaste waypoint · Grask the Cinderback blocks the vein',
      waves: (hp) => [
        stdWave(hp, 0.55, 30, [['runner', 14, 0.42], ['grunt', 6, 0.58]]),
        stdWave(hp, 0.70, 34, [['grunt', 10, 0.58], ['runner', 10, 0.42]]),
        stdWave(hp, 0.85, 38, [['runner', 16, 0.4], ['grunt', 8, 0.55]]),
        stdWave(hp, 1.00, 44, [['grunt', 12, 0.55], ['runner', 14, 0.38], ['brute', 3, 1.0]]),
        bossWave(hp, 1.90, 1.05, 90, ['brute', 1, 1], [['grunt', 8, 0.55], ['runner', 10, 0.42]]),
      ],
    },
    16: { // FIXED UNUSUAL LANE — The Split Forge (hand-drawn comb path)
      name: 'The Split Forge', blurb: 'Emberwaste waypoint · a comb of kilns, hand-cut into the rock',
      path: connectAnchors([[4, 0], [1, 1], [1, 3], [7, 3], [7, 5], [1, 5], [1, 7], [7, 7], [7, 9], [4, 9], [4, 10]]),
      waves: (hp) => [
        stdWave(hp, 0.60, 32, [['runner', 16, 0.4], ['grunt', 8, 0.55]]),
        stdWave(hp, 0.75, 36, [['grunt', 12, 0.55], ['swarm', 18, 0.14]]),
        stdWave(hp, 0.90, 40, [['runner', 20, 0.36], ['brute', 3, 1.0]]),
        stdWave(hp, 1.05, 46, [['grunt', 14, 0.5], ['swarm', 22, 0.13], ['runner', 10, 0.38]]),
        stdWave(hp, 1.25, 100, [['brute', 4, 0.95], ['grunt', 14, 0.5], ['runner', 16, 0.36]]),
      ],
    },
    24: { // SCRIPTED MID-WAVE EVENT — teaches FLASHOVER (Fire+Storm: flame+storm)
      name: 'The Second Kiln', blurb: 'Emberwaste waypoint · the kiln floor cracks — meet fire with lightning',
      waves: (hp) => [
        stdWave(hp, 0.60, 34, [['runner', 18, 0.38], ['grunt', 10, 0.55]]),
        stdWave(hp, 0.75, 38, [['grunt', 14, 0.5], ['flyer', 6, 0.68]]),
        stdWave(hp, 1.05, 55, [['shielded', 6, 0.8], ['brute', 4, 0.95], ['grunt', 10, 0.5]]), // EVENT: the second brood ignites
        stdWave(hp, 1.00, 48, [['flyer', 8, 0.62], ['swarm', 24, 0.13], ['grunt', 12, 0.5]]),
        stdWave(hp, 1.25, 110, [['brute', 5, 0.9], ['shielded', 6, 0.75], ['runner', 16, 0.36], ['flyer', 6, 0.62]]),
      ],
    },
  },
  frostreach: {
    8: { // MINI-BOSS — the Rime Sentinel (Fortified: teaches Siege/Magic vs armor)
      name: "The Sentinel's Causeway", blurb: 'Frostreach waypoint · the Rime Sentinel holds the ice bridge',
      waves: (hp) => [
        stdWave(hp, 0.55, 32, [['grunt', 12, 0.55], ['shielded', 4, 0.8]]),
        stdWave(hp, 0.70, 36, [['shielded', 6, 0.75], ['swarm', 20, 0.13]]),
        stdWave(hp, 0.85, 40, [['flyer', 8, 0.65], ['grunt', 14, 0.5]]),
        stdWave(hp, 1.00, 46, [['shielded', 8, 0.7], ['brute', 4, 0.95], ['swarm', 22, 0.13]]),
        bossWave(hp, 1.90, 1.05, 100, ['armored', 1, 1], [['shielded', 6, 0.75], ['grunt', 10, 0.5]]),
      ],
    },
    16: { // FIXED UNUSUAL LANE — The Frozen Maze (hand-drawn nested box)
      name: 'The Frozen Maze', blurb: 'Frostreach waypoint · a glacier maze cut in concentric rings',
      path: connectAnchors([[0, 0], [8, 0], [8, 8], [2, 8], [2, 2], [6, 2], [6, 6], [4, 6], [4, 4]]),
      waves: (hp) => [
        stdWave(hp, 0.60, 34, [['grunt', 14, 0.5], ['shielded', 6, 0.75]]),
        stdWave(hp, 0.75, 38, [['swarm', 24, 0.12], ['flyer', 8, 0.62]]),
        stdWave(hp, 0.90, 42, [['armored', 4, 0.75], ['grunt', 12, 0.5]]),
        stdWave(hp, 1.05, 48, [['shielded', 8, 0.68], ['brute', 5, 0.9], ['swarm', 26, 0.12]]),
        stdWave(hp, 1.30, 105, [['flyer', 10, 0.6], ['armored', 5, 0.72], ['grunt', 16, 0.46]]),
      ],
    },
    24: { // SCRIPTED MID-WAVE EVENT — teaches SHATTER (Water+Storm: frost+storm)
      name: 'Avalanche', blurb: 'Frostreach waypoint · the ice shelf gives way — shatter it before it lands',
      waves: (hp) => [
        stdWave(hp, 0.60, 36, [['grunt', 16, 0.48], ['flyer', 8, 0.6]]),
        stdWave(hp, 0.75, 40, [['shielded', 8, 0.68], ['swarm', 26, 0.12]]),
        stdWave(hp, 1.05, 58, [['brute', 6, 0.85], ['flyer', 10, 0.58], ['armored', 4, 0.72]]), // EVENT: the ice shelf breaks loose
        stdWave(hp, 1.00, 50, [['shielded', 10, 0.62], ['grunt', 16, 0.46], ['swarm', 28, 0.11]]),
        stdWave(hp, 1.30, 115, [['armored', 6, 0.68], ['brute', 6, 0.82], ['flyer', 10, 0.56], ['grunt', 14, 0.46]]),
      ],
    },
  },
  stormpeaks: {
    8: { // MINI-BOSS — Squall, the Gale Wraith (solo flyer: commits anti-air)
      name: "The Wraith's Gale", blurb: 'Stormpeaks waypoint · Squall the Gale Wraith circles the ridge',
      waves: (hp) => [
        stdWave(hp, 0.55, 34, [['flyer', 10, 0.65], ['runner', 14, 0.4]]),
        stdWave(hp, 0.70, 38, [['grunt', 14, 0.52], ['flyer', 8, 0.62]]),
        stdWave(hp, 0.85, 42, [['armored', 5, 0.72], ['runner', 16, 0.36]]),
        stdWave(hp, 1.00, 48, [['flyer', 12, 0.58], ['elite', 2, 1.05], ['grunt', 14, 0.48]]),
        bossWave(hp, 1.90, 1.05, 110, ['flyer', 1, 1], [['flyer', 8, 0.6], ['runner', 16, 0.36]]),
      ],
    },
    16: { // FIXED UNUSUAL LANE — The Thunder Cross (hand-drawn crossing corridors)
      name: 'The Thunder Cross', blurb: 'Stormpeaks waypoint · two gales cross the summit at once',
      path: connectAnchors([[0, 0], [3, 0], [3, 5], [8, 5], [8, 2], [5, 2], [5, 9], [0, 9], [0, 10], [4, 10]]),
      waves: (hp) => [
        stdWave(hp, 0.60, 36, [['flyer', 12, 0.6], ['grunt', 16, 0.46]]),
        stdWave(hp, 0.75, 40, [['armored', 6, 0.68], ['runner', 18, 0.34]]),
        stdWave(hp, 0.90, 44, [['elite', 3, 1.0], ['flyer', 10, 0.56]]),
        stdWave(hp, 1.05, 50, [['brute', 6, 0.82], ['flyer', 12, 0.54], ['grunt', 16, 0.44]]),
        stdWave(hp, 1.30, 112, [['elite', 4, 0.95], ['armored', 6, 0.65], ['flyer', 14, 0.52]]),
      ],
    },
    24: { // SCRIPTED MID-WAVE EVENT — teaches WILDFIRE (Fire+Nature: flame+bloom)
      name: 'The Overgrown Squall', blurb: 'Stormpeaks waypoint · vines ride the thunderhead — burn it clean',
      waves: (hp) => [
        stdWave(hp, 0.60, 38, [['flyer', 14, 0.56], ['grunt', 18, 0.42]]),
        stdWave(hp, 0.75, 42, [['armored', 7, 0.64], ['brute', 6, 0.78]]),
        stdWave(hp, 1.05, 60, [['elite', 4, 0.9], ['flyer', 12, 0.52], ['grunt', 16, 0.42]]), // EVENT: a green squall rides the thunderhead
        stdWave(hp, 1.00, 52, [['brute', 7, 0.76], ['armored', 6, 0.62], ['flyer', 14, 0.5]]),
        stdWave(hp, 1.30, 118, [['elite', 5, 0.88], ['flyer', 16, 0.48], ['armored', 8, 0.6]]),
      ],
    },
  },
  verdant: {
    8: { // MINI-BOSS — Old Man Bramble (solo elite: commits Physical/cannon vs Warded)
      name: "Old Man Bramble's Root", blurb: 'Verdant waypoint · Old Man Bramble roots the crossing',
      waves: (hp) => [
        stdWave(hp, 0.55, 36, [['swarm', 26, 0.12], ['healer', 3, 1.2]]),
        stdWave(hp, 0.70, 40, [['shielded', 8, 0.68], ['runner', 18, 0.36]]),
        stdWave(hp, 0.85, 44, [['healer', 4, 1.1], ['swarm', 28, 0.11]]),
        stdWave(hp, 1.00, 50, [['shielded', 10, 0.62], ['elite', 3, 1.0], ['runner', 16, 0.36]]),
        bossWave(hp, 1.90, 1.05, 118, ['elite', 1, 1], [['healer', 4, 1.1], ['swarm', 26, 0.12]]),
      ],
    },
    16: { // FIXED UNUSUAL LANE — The Vine Labyrinth (hand-drawn wide switchbacks)
      name: 'The Vine Labyrinth', blurb: 'Verdant waypoint · roots have grown their own maze',
      path: connectAnchors([[4, 0], [4, 3], [0, 3], [0, 6], [8, 6], [8, 3], [6, 3], [6, 8], [2, 8], [2, 10], [4, 10]]),
      waves: (hp) => [
        stdWave(hp, 0.60, 38, [['swarm', 28, 0.11], ['shielded', 8, 0.65]]),
        stdWave(hp, 0.75, 42, [['healer', 5, 1.0], ['runner', 20, 0.34]]),
        stdWave(hp, 0.90, 46, [['elite', 4, 0.95], ['swarm', 30, 0.11]]),
        stdWave(hp, 1.05, 52, [['shielded', 12, 0.6], ['healer', 5, 1.0], ['runner', 18, 0.34]]),
        stdWave(hp, 1.30, 122, [['elite', 5, 0.9], ['swarm', 32, 0.1], ['shielded', 10, 0.58]]),
      ],
    },
    24: { // SCRIPTED MID-WAVE EVENT — teaches OVERGROW (Water+Nature: frost+bloom)
      name: 'The Weeping Bog', blurb: 'Verdant waypoint · the bog swells — root it before it swallows the path',
      waves: (hp) => [
        stdWave(hp, 0.60, 40, [['swarm', 30, 0.11], ['healer', 5, 1.0]]),
        stdWave(hp, 0.75, 44, [['shielded', 10, 0.6], ['elite', 4, 0.9]]),
        stdWave(hp, 1.05, 62, [['healer', 6, 0.95], ['swarm', 34, 0.1], ['shielded', 10, 0.58]]), // EVENT: the bog swells and swallows the path
        stdWave(hp, 1.00, 54, [['elite', 5, 0.85], ['shielded', 12, 0.56], ['runner', 18, 0.34]]),
        stdWave(hp, 1.30, 126, [['elite', 6, 0.82], ['healer', 6, 0.92], ['swarm', 34, 0.1]]),
      ],
    },
  },
  lumen: {
    8: { // MINI-BOSS — The Undying Choir (solo healer: teaches focus-fire priority)
      name: 'The Undying Choir', blurb: 'Lumen waypoint · a mender that will not stop singing',
      waves: (hp) => [
        stdWave(hp, 0.55, 40, [['swarm', 30, 0.11], ['flyer', 10, 0.6]]),
        stdWave(hp, 0.70, 44, [['shielded', 10, 0.6], ['healer', 5, 0.95]]),
        stdWave(hp, 0.85, 48, [['elite', 4, 0.88], ['flyer', 12, 0.56]]),
        stdWave(hp, 1.00, 54, [['shielded', 12, 0.56], ['swarm', 32, 0.1], ['healer', 5, 0.92]]),
        bossWave(hp, 1.70, 1.10, 126, ['healer', 1, 1], [['elite', 4, 0.85], ['shielded', 10, 0.58], ['swarm', 28, 0.1]]),
      ],
    },
    16: { // FIXED UNUSUAL LANE — The Sunken Aisle (hand-drawn ring loop)
      name: 'The Sunken Aisle', blurb: 'Lumen waypoint · a ring of pillars sunk in gold-lit water',
      path: connectAnchors([[0, 1], [0, 9], [8, 9], [8, 1], [2, 1], [2, 7], [6, 7], [6, 3], [4, 3], [4, 10]]),
      waves: (hp) => [
        stdWave(hp, 0.60, 42, [['flyer', 14, 0.54], ['shielded', 10, 0.58]]),
        stdWave(hp, 0.75, 46, [['elite', 5, 0.82], ['swarm', 32, 0.1]]),
        stdWave(hp, 0.90, 50, [['healer', 6, 0.9], ['flyer', 12, 0.52]]),
        stdWave(hp, 1.05, 56, [['shielded', 14, 0.54], ['elite', 5, 0.8], ['swarm', 34, 0.1]]),
        stdWave(hp, 1.30, 130, [['elite', 6, 0.78], ['flyer', 16, 0.48], ['healer', 6, 0.88]]),
      ],
    },
    24: { // SCRIPTED MID-WAVE EVENT — teaches ECLIPSE (Light+Dark: radiant+shade)
      name: 'The Choir Ascendant', blurb: 'Lumen waypoint · light and shadow collide in the nave — eclipse them',
      waves: (hp) => [
        stdWave(hp, 0.60, 44, [['flyer', 16, 0.52], ['shielded', 12, 0.56]]),
        stdWave(hp, 0.75, 48, [['elite', 6, 0.76], ['swarm', 34, 0.1]]),
        stdWave(hp, 1.05, 66, [['healer', 7, 0.86], ['elite', 5, 0.78], ['flyer', 14, 0.5]]), // EVENT: the choir's light and shadow collide
        stdWave(hp, 1.00, 58, [['shielded', 14, 0.52], ['swarm', 36, 0.1], ['flyer', 14, 0.5]]),
        stdWave(hp, 1.30, 134, [['elite', 7, 0.74], ['healer', 7, 0.84], ['shielded', 14, 0.5]]),
      ],
    },
  },
  hollow: {
    8: { // MINI-BOSS — Nyx, the Unraveled Shade (solo armored: deep-game Fortified check)
      name: "Nyx's Unraveling", blurb: 'The Hollow waypoint · Nyx the Unraveled Shade guards the throne road',
      waves: (hp) => [
        stdWave(hp, 0.55, 44, [['swarm', 32, 0.1], ['flyer', 14, 0.52]]),
        stdWave(hp, 0.70, 48, [['shielded', 12, 0.56], ['brute', 6, 0.78]]),
        stdWave(hp, 0.85, 52, [['healer', 6, 0.9], ['elite', 5, 0.78]]),
        stdWave(hp, 1.00, 58, [['armored', 7, 0.62], ['swarm', 34, 0.1], ['flyer', 14, 0.5]]),
        bossWave(hp, 1.90, 1.05, 130, ['armored', 1, 1], [['elite', 5, 0.78], ['shielded', 12, 0.54], ['swarm', 30, 0.1]]),
      ],
    },
    16: { // FIXED UNUSUAL LANE — The Mirror Rift (hand-drawn hourglass crossing)
      name: 'The Mirror Rift', blurb: 'The Hollow waypoint · the road forks and rejoins itself, over and over',
      path: connectAnchors([[0, 0], [8, 0], [0, 4], [8, 4], [0, 8], [8, 8], [4, 8], [4, 10]]),
      waves: (hp) => [
        stdWave(hp, 0.60, 46, [['flyer', 16, 0.5], ['shielded', 14, 0.52]]),
        stdWave(hp, 0.75, 50, [['brute', 7, 0.74], ['healer', 6, 0.86]]),
        stdWave(hp, 0.90, 54, [['armored', 8, 0.58], ['elite', 6, 0.74]]),
        stdWave(hp, 1.05, 60, [['swarm', 36, 0.09], ['flyer', 16, 0.48], ['shielded', 14, 0.5]]),
        stdWave(hp, 1.30, 136, [['elite', 7, 0.72], ['armored', 8, 0.56], ['brute', 7, 0.72]]),
      ],
    },
    24: { // SCRIPTED MID-WAVE EVENT — teaches BLIGHT (Nature+Dark: bloom+shade)
      name: 'The Blight Choir', blurb: 'The Hollow waypoint · the void chorus opens beneath the throne road',
      waves: (hp) => [
        stdWave(hp, 0.60, 48, [['flyer', 18, 0.48], ['shielded', 14, 0.5]]),
        stdWave(hp, 0.75, 52, [['armored', 8, 0.56], ['brute', 7, 0.7]]),
        stdWave(hp, 1.05, 70, [['healer', 7, 0.82], ['elite', 6, 0.7], ['swarm', 36, 0.09]]), // EVENT: the void chorus opens
        stdWave(hp, 1.00, 62, [['shielded', 16, 0.48], ['armored', 8, 0.54], ['flyer', 16, 0.46]]),
        stdWave(hp, 1.30, 140, [['elite', 8, 0.68], ['armored', 9, 0.52], ['brute', 8, 0.68]]),
      ],
    },
  },
}

// Build ONE waypoint level. Same difficulty curve as the generator
// (difficultyHp(prog) at this exact realm/depth) so beatability is proven the
// same way — the simcheck auto-player treats it identically to a generated stop.
function waypointLevel(
  id: string, rg: RealmGen, realmOrder: number, j: number, count: number,
  wp: WaypointSpec, unlockTower?: TowerKind,
): LevelDef {
  const localDepth = count <= 1 ? 0 : j / (count - 1)
  const prog = realmOrder + localDepth
  const globalDepth = prog / REALM_GEN.length
  const baseHp = difficultyHp(prog)
  const opener = localDepth < 0.25 ? Math.round((0.25 - localDepth) * 180) : 0
  const startGold = Math.round(240 + prog * 45 + opener + 40) // landmark cushion, same as generated landmarks
  const startLives = Math.max(12, Math.round(20 - globalDepth * 6))
  const baseCoins = Math.round(30 + globalDepth * 130 + 20)
  return {
    id, index: 0, name: wp.name, blurb: wp.blurb,
    lanes: wp.lanes ?? [3, 6, 9],
    path: wp.path,
    landmark: 'landmark',
    startGold, startLives, baseCoins, palette: rg.palette,
    unlockTower,
    waves: wp.waves(baseHp),
  }
}

// Which local index of a realm grants a new tower. Storm/arcane are spread EARLY
// so players aren't gated behind a keeper for basic towers (both land before
// flyers appear); the reaction-complete trio (bloom/radiant/shade) lands one per
// realm across the mid-game so every element is tower-native well before Hollow.
const UNLOCK_AT: Record<string, { j: number; tower: TowerKind }> = {
  emberwaste: { j: 5, tower: 'storm' },
  frostreach: { j: 4, tower: 'arcane' },
  stormpeaks: { j: 5, tower: 'bloom' },
  verdant: { j: 5, tower: 'radiant' },
  lumen: { j: 5, tower: 'shade' },
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
      const waypoint = !isFinale ? WAYPOINTS[rg.id]?.[j] : undefined
      if (j === 0 && rg.id === 'emberwaste') {
        lvl = { ...L1_TUTORIAL } // the tutorial opener keeps id 'l1'
      } else if (isFinale && rg.finaleId !== 'w0_finale' && FINALE_WAVES[rg.finaleId]) {
        lvl = finaleLevel(rg.finaleId, rg, realmOrder) // reuse the hand-authored keeper level
      } else if (waypoint) {
        const id = `w${realmOrder}_${j}`
        const unlock = UNLOCK_AT[rg.id]?.j === j ? UNLOCK_AT[rg.id].tower : undefined
        lvl = waypointLevel(id, rg, realmOrder, j, count, waypoint, unlock) // hand-authored set-piece (replaces a generated slot)
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
