// SEED CODES — the human-memorable run-seed codec behind every "beat this run"
// link (chromancer.io/?seed=EMBER-FOX-42). A code is WORD-WORD-NN drawn from two
// 64-word painterly lists plus 00-99, giving a 409,600-seed space that maps
// 1:1 onto the sim's PRNG seeds. Pure + deterministic both ways, so a shared
// code replays the EXACT run on any device. DOM access only inside the launch
// helpers (module stays importable by the headless sim checks).

// 64 paint/element words (index = high bits of the seed)
const WORDS_A = [
  'EMBER', 'FROST', 'STORM', 'IVY', 'DAWN', 'DUSK', 'OPAL', 'RUBY',
  'JADE', 'GOLD', 'AZURE', 'CORAL', 'INDIGO', 'VIOLET', 'CRIMSON', 'AMBER',
  'PEARL', 'ONYX', 'TOPAZ', 'COBALT', 'SCARLET', 'SAFFRON', 'LILAC', 'MOSS',
  'FERN', 'TIDE', 'CINDER', 'ASH', 'BLAZE', 'SPARK', 'THUNDER', 'ZEPHYR',
  'MIST', 'RAIN', 'SNOW', 'HAIL', 'RIVER', 'OCEAN', 'MEADOW', 'GROVE',
  'BRIAR', 'THORN', 'PETAL', 'BLOOM', 'PRISM', 'GLOW', 'SHADE', 'NIGHT',
  'STAR', 'LUNAR', 'SOLAR', 'COMET', 'NOVA', 'AURORA', 'HALO', 'RUNE',
  'GLYPH', 'CHROMA', 'MARBLE', 'SLATE', 'COPPER', 'SILVER', 'IRON', 'QUARTZ',
]

// 64 creature words (index = middle bits)
const WORDS_B = [
  'FOX', 'WOLF', 'RAVEN', 'OTTER', 'LYNX', 'HARE', 'OWL', 'CRANE',
  'HERON', 'FINCH', 'WREN', 'ROBIN', 'FALCON', 'HAWK', 'EAGLE', 'BEAR',
  'ELK', 'DEER', 'MOLE', 'VOLE', 'TOAD', 'NEWT', 'KOI', 'CARP',
  'PIKE', 'TROUT', 'SEAL', 'ORCA', 'WHALE', 'CRAB', 'MOTH', 'WASP',
  'BEE', 'ANT', 'BEETLE', 'CICADA', 'MANTIS', 'BADGER', 'STOAT', 'FERRET',
  'MARTEN', 'SABLE', 'MINK', 'SHREW', 'BAT', 'GECKO', 'VIPER', 'ADDER',
  'SKINK', 'CROW', 'MAGPIE', 'JAY', 'DOVE', 'SWAN', 'GOOSE', 'DUCK',
  'PONY', 'MULE', 'GOAT', 'RAM', 'BOAR', 'HOUND', 'TABBY', 'MOUSE',
]

/** total distinct seed codes: 64 × 64 × 100 */
export const SEED_SPACE = WORDS_A.length * WORDS_B.length * 100

/** Fold any 32-bit value into the shareable seed space (identity for codes). */
export function canonicalSeed(n: number): number {
  return ((n >>> 0) % SEED_SPACE + SEED_SPACE) % SEED_SPACE
}

/** seed number → WORD-WORD-NN (seed is folded into the code space first). */
export function seedToCode(seed: number): string {
  const s = canonicalSeed(seed)
  const a = Math.floor(s / (WORDS_B.length * 100))
  const b = Math.floor((s % (WORDS_B.length * 100)) / 100)
  const nn = s % 100
  return `${WORDS_A[a]}-${WORDS_B[b]}-${String(nn).padStart(2, '0')}`
}

/** WORD-WORD-NN (any case, spaces ok) → seed, or null if unparseable. Raw digits also accepted. */
export function codeToSeed(code: string): number | null {
  const raw = (code ?? '').trim().toUpperCase().replace(/\s+/g, '-')
  if (!raw) return null
  if (/^\d{1,10}$/.test(raw)) return canonicalSeed(parseInt(raw, 10))
  const m = raw.match(/^([A-Z]+)-([A-Z]+)-(\d{1,2})$/)
  if (!m) return null
  const a = WORDS_A.indexOf(m[1])
  const b = WORDS_B.indexOf(m[2])
  const nn = parseInt(m[3], 10)
  if (a < 0 || b < 0 || !Number.isFinite(nn) || nn < 0 || nn > 99) return null
  return a * WORDS_B.length * 100 + b * 100 + nn
}

/** A fresh shareable seed for a new run (view-side only; the sim never calls this). */
export function randomSeed(): number {
  return Math.floor(Math.random() * SEED_SPACE)
}

// ---------------------------------------------------------------------------
//  DAILY SEED — one deterministic run per UTC day, shared by every device.
//  Lives here (not in the landing page) so the marketing widget and the in-game
//  Daily screen derive the SAME code from the SAME day and can never drift.
// ---------------------------------------------------------------------------

/** UTC day index → seed. Knuth-hash the day so consecutive days don't share words. */
export function dailySeed(utcDayIndex: number): number {
  const mixed = (Math.imul(utcDayIndex, 2654435761) ^ 0x9e3779b9) >>> 0
  return canonicalSeed(mixed)
}

/** The UTC day index for an epoch-ms instant (defaults to now). */
export function utcDayIndex(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / 86_400_000)
}

/** Today's daily seed + human-memorable code (browser/local clock). */
export function todaysDaily(nowMs: number = Date.now()): { day: number; seed: number; code: string } {
  const day = utcDayIndex(nowMs)
  const seed = dailySeed(day)
  return { day, seed, code: seedToCode(seed) }
}

// ---------------------------------------------------------------------------
//  Seed links + URL launch params (browser-only helpers)
// ---------------------------------------------------------------------------

/** Canonical public home of the game — used when we can't trust location (file:). */
const SHARE_HOME = 'https://chromancer.io/'

/** Build the shareable deep-link for a run. Uses the current origin when served
 *  over http(s) (links always work in dev/preview), falling back to the public
 *  domain otherwise. levelId is included for campaign/demo runs; endless omits it. */
export function seedLink(code: string, levelId?: string): string {
  let base = SHARE_HOME
  try {
    if (typeof location !== 'undefined' && /^https?:$/.test(location.protocol)) {
      base = location.origin + location.pathname
    }
  } catch { /* non-browser context */ }
  const lv = levelId && levelId !== 'endless' ? `&lv=${encodeURIComponent(levelId)}` : ''
  return `${base}?seed=${encodeURIComponent(code)}${lv}`
}

export interface LaunchParams {
  attract: boolean // ?attract=1 → hands-free cinematic demo reel
  demo: boolean // ?demo=1 or ?lv=demo → the Ember Vale demo level, played live
  seedCode: string | null // raw ?seed= value (for display)
  seed: number | null // decoded seed, if valid
  levelId: string | null // ?lv= target level
  speed: number // ?speed= sim-speed multiplier for capture (attract only)
  captions: boolean // ?captions=0 disables attract captions (clean capture)
  loop: boolean // ?loop=1 → attract restarts itself after the end card
}

/** Parse the growth-infra query params. Never throws; bad values fall back. */
export function readLaunchParams(search?: string): LaunchParams {
  const out: LaunchParams = {
    attract: false, demo: false, seedCode: null, seed: null,
    levelId: null, speed: 1, captions: true, loop: false,
  }
  try {
    const q = new URLSearchParams(search ?? (typeof location !== 'undefined' ? location.search : ''))
    out.attract = q.get('attract') === '1' || q.get('attract') === 'true'
    out.demo = q.get('demo') === '1' || q.get('demo') === 'true'
    const seed = q.get('seed')
    if (seed) {
      out.seedCode = seed
      out.seed = codeToSeed(seed)
    }
    const lv = q.get('lv')
    if (lv && /^[a-z0-9_-]{1,24}$/i.test(lv)) out.levelId = lv
    if (out.levelId === 'demo') out.demo = true
    const sp = parseFloat(q.get('speed') ?? '')
    if (Number.isFinite(sp) && sp > 0) out.speed = Math.min(8, Math.max(0.25, sp))
    if (q.get('captions') === '0' || q.get('captions') === 'false') out.captions = false
    out.loop = q.get('loop') === '1' || q.get('loop') === 'true'
  } catch { /* malformed URL — plain launch */ }
  return out
}
