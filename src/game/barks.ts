// ============================================================================
//  BARKS — the character-voice layer of Chromancer. Pure data + a small engine.
//
//  Content comes from the narrative bible (chromancer-narrative-bible.md): each
//  of the 8 heroes has a distinct voice + catchphrase, Maddervane mentors in
//  paint metaphors, and Morose never rages — he CONDOLES. Lines are ≤3 short
//  screen lines, trigger-tagged, and the engine rate-limits so it never spams.
//
//  This module is PRESENTATION-side (no sim imports). The sim stays pure; the
//  scenes ask the engine for a line when a semantic event happens and the
//  bark UI draws it. Selection may use Math.random — nothing here feeds back
//  into gameplay.
// ============================================================================

export type BarkTrigger =
  | 'deploy'      // this hero just took the field (hero = speaker)
  | 'kill'        // a satisfying kill (boss / big combo) — rate-limited hard
  | 'reaction'    // an elemental reaction detonated — rate-limited hard
  | 'fusion'      // two max towers forged into one fusion tower (rare, earned)
  | 'lowLives'    // lives fell below the danger line (once per battle)
  | 'victory'     // level won (fires over the result screen)
  | 'defeat'      // level lost — Morose condoles
  | 'pair'        // BOTH named heroes are in the squad (the Hades trick)
  | 'walk'        // caravan walking the world-map road between levels
  | 'discovery'   // a Small Discovery on the road
  | 'moroseGrey'  // Morose greys one of your towers mid-battle
  | 'moroseSteal' // Morose steals a draft option
  | 'levelStart'  // pre-level card context line

export interface Bark {
  id: string
  trigger: BarkTrigger
  /** hero id ('ember'…'vex') or 'maddervane' / 'morose' */
  speaker: string
  text: string
  /** deploy/kill/…: the speaker hero must be fielded/in party. pair: both must be in the party. */
  pair?: [string, string]
  /** only offered while playing inside this realm (realm id from levels.ts) */
  realm?: string
  /** shown at most once ever (persisted) */
  once?: boolean
}

export interface Speaker {
  name: string
  color: number
  glyph: string
}

// Non-hero speakers (heroes resolve through HEROES in the UI layer).
export const NARRATOR_SPEAKERS: Record<string, Speaker> = {
  maddervane: { name: 'Maddervane', color: 0xffc46b, glyph: '🏮' },
  morose: { name: 'Morose, the Hollow King', color: 0x9a94b8, glyph: '👑' },
  bloom: { name: 'Bloom', color: 0xffb36b, glyph: '🌸' }, // Bramble's twin (shares the slot)
}

// ----------------------------------------------------------------------------
//  THE TRIGGER TABLE — actual written lines from the bible, plus fill lines in
//  each character's established voice. Keep every line ≤3 short screen lines.
// ----------------------------------------------------------------------------
export const BARKS: Bark[] = [
  // ===== ASHKA (ember) — fast, clipped, competitive; hides hurt behind body counts
  { id: 'ashka-dep-1', trigger: 'deploy', speaker: 'ember', text: 'Point me at something.' },
  { id: 'ashka-dep-2', trigger: 'deploy', speaker: 'ember', text: 'Stay lit.' },
  { id: 'ashka-kill-1', trigger: 'kill', speaker: 'ember', text: 'Next.' },
  { id: 'ashka-kill-2', trigger: 'kill', speaker: 'ember', text: 'Counted that one twice. It earned it.' },
  { id: 'ashka-react-1', trigger: 'reaction', speaker: 'ember', text: 'THAT\'S what fire is for!' },
  { id: 'ashka-low-1', trigger: 'lowLives', speaker: 'ember', text: 'I don\'t lose. Get up.' },
  { id: 'ashka-win-1', trigger: 'victory', speaker: 'ember', text: 'Told you. Stay lit.' },
  { id: 'ashka-walk-1', trigger: 'walk', speaker: 'ember', text: 'Walk faster. The grey doesn\'t.' },

  // ===== LUMI (glacia) — serene, dry, answers the question you were about to ask
  { id: 'lumi-dep-1', trigger: 'deploy', speaker: 'glacia', text: 'I arrived before you called.' },
  { id: 'lumi-dep-2', trigger: 'deploy', speaker: 'glacia', text: 'I have seen this. It goes well.' },
  { id: 'lumi-kill-1', trigger: 'kill', speaker: 'glacia', text: 'As foreseen.' },
  { id: 'lumi-react-1', trigger: 'reaction', speaker: 'glacia', text: 'The ice approves. It rarely does.' },
  { id: 'lumi-low-1', trigger: 'lowLives', speaker: 'glacia', text: 'This is a future I did not read — improvise!' },
  { id: 'lumi-win-1', trigger: 'victory', speaker: 'glacia', text: 'It went well. You were about to ask.' },
  { id: 'lumi-walk-1', trigger: 'walk', speaker: 'glacia', text: 'There is a fork ahead. We take the brighter road. We always do.' },

  // ===== GALEA (zephyra) — booming, nautical, generous; loudness is load-bearing
  { id: 'galea-dep-1', trigger: 'deploy', speaker: 'zephyra', text: 'Wind\'s up, sails full — WAGER\'S ON!' },
  { id: 'galea-dep-2', trigger: 'deploy', speaker: 'zephyra', text: 'New crew, same rule: nobody falls behind!' },
  { id: 'galea-kill-1', trigger: 'kill', speaker: 'zephyra', text: 'HA! Log that one in the manifest!' },
  { id: 'galea-react-1', trigger: 'reaction', speaker: 'zephyra', text: 'Now THAT\'S weather!' },
  { id: 'galea-low-1', trigger: 'lowLives', speaker: 'zephyra', text: 'We do not abandon ship. We ARE the ship!' },
  { id: 'galea-win-1', trigger: 'victory', speaker: 'zephyra', text: 'Pay up! I wagered on us and I ALWAYS collect!' },
  { id: 'galea-walk-1', trigger: 'walk', speaker: 'zephyra', text: 'Good walking weather. Any weather is, with a crew.' },

  // ===== THORNWICK (sylvan) — slow, warm, deadpan; relays the moss's opinions
  { id: 'thorn-dep-1', trigger: 'deploy', speaker: 'sylvan', text: 'Everything grey was green once. Give it a minute.' },
  { id: 'thorn-dep-2', trigger: 'deploy', speaker: 'sylvan', text: 'The moss says this is a good spot. The moss is seldom wrong.' },
  { id: 'thorn-kill-1', trigger: 'kill', speaker: 'sylvan', text: 'Compost, eventually. Everything is.' },
  { id: 'thorn-react-1', trigger: 'reaction', speaker: 'sylvan', text: 'Hm. The old sparks still remember each other.' },
  { id: 'thorn-low-1', trigger: 'lowLives', speaker: 'sylvan', text: 'Roots hold in worse storms than this. So do we.' },
  { id: 'thorn-win-1', trigger: 'victory', speaker: 'sylvan', text: 'There. Green enough for today.' },
  { id: 'thorn-walk-1', trigger: 'walk', speaker: 'sylvan', text: 'Slow down. The road is also the journey. The moss agrees.' },

  // ===== SERAPHINE (aurelia) — earnest, formal, radiant; no irony at all
  { id: 'sera-dep-1', trigger: 'deploy', speaker: 'aurelia', text: 'Hold the line — the dawn is already coming.' },
  { id: 'sera-dep-2', trigger: 'deploy', speaker: 'aurelia', text: 'Position accepted. I will not fail you.' },
  { id: 'sera-kill-1', trigger: 'kill', speaker: 'aurelia', text: 'Recorded and forgiven.' },
  { id: 'sera-react-1', trigger: 'reaction', speaker: 'aurelia', text: 'Light works best in company. Noted. Formally.' },
  { id: 'sera-low-1', trigger: 'lowLives', speaker: 'aurelia', text: 'Night is not the end. It is what the dawn is FOR.' },
  { id: 'sera-win-1', trigger: 'victory', speaker: 'aurelia', text: 'The line held. I am… genuinely pleased.' },
  { id: 'sera-walk-1', trigger: 'walk', speaker: 'aurelia', text: 'I have prepared a marching hymn. It is forty verses. We have time.' },

  // ===== NYX (vex) — sardonic; the only hero who lies in barks
  { id: 'nyx-dep-1', trigger: 'deploy', speaker: 'vex', text: 'You won\'t see me coming. Nobody ever does… their loss.' },
  { id: 'nyx-dep-2', trigger: 'deploy', speaker: 'vex', text: 'I was here the whole time. Probably.' },
  { id: 'nyx-kill-1', trigger: 'kill', speaker: 'vex', text: 'Didn\'t touch it. It fell on my knife. Repeatedly.' },
  { id: 'nyx-react-1', trigger: 'reaction', speaker: 'vex', text: 'Ooh, sparkly. I\'m definitely not stealing that.' },
  { id: 'nyx-low-1', trigger: 'lowLives', speaker: 'vex', text: 'Relax. I\'ve lost worse fights on purpose. …That was a lie.' },
  { id: 'nyx-win-1', trigger: 'victory', speaker: 'vex', text: 'Shadow isn\'t the absence of color. Shadow is where color RESTS.' },
  { id: 'nyx-walk-1', trigger: 'walk', speaker: 'vex', text: 'I checked the road ahead while you slept. You\'re welcome. No one asked.' },

  // ===== FIZZ (volt) — manic technobabble; the one percent is where the fun lives
  { id: 'fizz-dep-1', trigger: 'deploy', speaker: 'volt', text: 'Stasis coils calibrated! Ninety-nine percent sure!' },
  { id: 'fizz-dep-2', trigger: 'deploy', speaker: 'volt', text: 'The one percent is where the FUN lives!' },
  { id: 'fizz-kill-1', trigger: 'kill', speaker: 'volt', text: 'Results reproducible! Science!' },
  { id: 'fizz-react-1', trigger: 'reaction', speaker: 'volt', text: 'CROSS-ELEMENTAL CASCADE! Write that down, write that down!' },
  { id: 'fizz-low-1', trigger: 'lowLives', speaker: 'volt', text: 'Recalculating! …Recalculating!! Okay, plan B is also lightning!' },
  { id: 'fizz-win-1', trigger: 'victory', speaker: 'volt', text: 'Hypothesis confirmed: we are GREAT.' },
  { id: 'fizz-walk-1', trigger: 'walk', speaker: 'volt', text: 'Fun fact: this road is 0.3% conductive. I checked. Twice.' },

  // ===== BRAMBLE & BLOOM (pyra) — twins; grim half, bright half
  { id: 'twins-dep-1', trigger: 'deploy', speaker: 'pyra', text: 'Two of us— —too bad for you!' },
  { id: 'twins-dep-2', trigger: 'deploy', speaker: 'pyra', text: 'I\'ll take the left— —I\'ll take the rest!' },
  { id: 'twins-kill-1', trigger: 'kill', speaker: 'pyra', text: 'Got one!— —We got one!' },
  { id: 'twins-react-1', trigger: 'reaction', speaker: 'pyra', text: 'Did we do that?— —We SO did that!' },
  { id: 'twins-low-1', trigger: 'lowLives', speaker: 'pyra', text: 'Don\'t be scared— —we\'re not scared— —we\'re NOT.' },
  { id: 'twins-win-1', trigger: 'victory', speaker: 'pyra', text: 'Told you— —too bad for THEM!' },
  { id: 'twins-walk-1', trigger: 'walk', speaker: 'pyra', text: 'Race you to the next— —you always win— —that\'s why I race YOU.' },

  // ===== PARTY-COMPOSITION BANTER — fires only when BOTH heroes are in the squad
  { id: 'pair-ashka-lumi-1', trigger: 'pair', speaker: 'ember', pair: ['ember', 'glacia'], text: 'Lumi! We\'re good together — tell no one.' },
  { id: 'pair-ashka-lumi-2', trigger: 'pair', speaker: 'glacia', pair: ['ember', 'glacia'], text: 'Ashka is about to say we work well together. I have foreseen it.' },
  { id: 'pair-galea-nyx-1', trigger: 'pair', speaker: 'zephyra', pair: ['zephyra', 'vex'], text: 'Nyx! Where\'s my compass? …Why does it point at snacks now?' },
  { id: 'pair-galea-nyx-2', trigger: 'pair', speaker: 'vex', pair: ['zephyra', 'vex'], text: 'I improved the captain\'s compass. It points at what matters.' },
  { id: 'pair-sera-nyx-1', trigger: 'pair', speaker: 'aurelia', pair: ['aurelia', 'vex'], text: 'Nyx. My commendation certificate. Return it.' },
  { id: 'pair-sera-nyx-2', trigger: 'pair', speaker: 'vex', pair: ['aurelia', 'vex'], text: 'Never seen your certificate, Halo. (It\'s laminated now. She\'ll thank me.)' },
  { id: 'pair-thorn-twins-1', trigger: 'pair', speaker: 'sylvan', pair: ['sylvan', 'pyra'], text: 'Walk behind me, sprouts. …Fine. Beside me.' },
  { id: 'pair-thorn-twins-2', trigger: 'pair', speaker: 'pyra', pair: ['sylvan', 'pyra'], text: 'Grandfather Thornwick says trees don\'t hurry— —and neither do WE!' },
  { id: 'pair-lumi-fizz-1', trigger: 'pair', speaker: 'volt', pair: ['glacia', 'volt'], text: 'Lumi, quick — what are the ODDS of— "Yes." …She does that.' },
  { id: 'pair-lumi-fizz-2', trigger: 'pair', speaker: 'glacia', pair: ['glacia', 'volt'], text: 'Fizz\'s next experiment succeeds. The one after that is very loud.' },
  { id: 'pair-ashka-sera-1', trigger: 'pair', speaker: 'ember', pair: ['ember', 'aurelia'], text: 'Dawnhalo. Race you to the body count. …It\'s not a sin if you WIN.' },

  // ===== FUSION FORGED — two colours refusing to stay apart (the Greying's opposite)
  { id: 'fuse-ashka-1', trigger: 'fusion', speaker: 'ember', text: 'Two fires in one blade. NOW we\'re talking.' },
  { id: 'fuse-lumi-1', trigger: 'fusion', speaker: 'glacia', text: 'Two colours, one tower. I foresaw it. I am still impressed.' },
  { id: 'fuse-fizz-1', trigger: 'fusion', speaker: 'volt', text: 'DUAL-ELEMENT LATTICE ACHIEVED! This violates at least three of my own laws!' },
  { id: 'fuse-thorn-1', trigger: 'fusion', speaker: 'sylvan', text: 'Two trees grown into one trunk. The moss calls it marriage.' },
  { id: 'fuse-galea-1', trigger: 'fusion', speaker: 'zephyra', text: 'Two ships lashed into a MAN-O-WAR! Fire everything!' },
  { id: 'fuse-madder-1', trigger: 'fusion', speaker: 'maddervane', text: 'Mixing pigments on the canvas itself. Bold, little brush. He used to do that.' },

  // ===== MADDERVANE — mentor; everything is a paint metaphor
  { id: 'madder-walk-1', trigger: 'walk', speaker: 'maddervane', text: 'Grey is just color holding its breath, little brush. Our job\'s to make it exhale.' },
  { id: 'madder-walk-2', trigger: 'walk', speaker: 'maddervane', text: 'See how the hills take the light back? That\'s your work drying, little brush.' },
  { id: 'madder-walk-3', trigger: 'walk', speaker: 'maddervane', text: 'He wasn\'t always the Hollow King. Once, he painted the sky its blue.' },
  { id: 'madder-walk-4', trigger: 'walk', speaker: 'maddervane', text: 'Six friends on one palette. He tried to be all six alone. Don\'t.' },
  { id: 'madder-win-1', trigger: 'victory', speaker: 'maddervane', text: 'Good. Now breathe. Even masters let the coat dry.' },
  { id: 'madder-low-1', trigger: 'lowLives', speaker: 'maddervane', text: 'Steady, little brush. A shaking hand still paints — it just paints braver.' },

  // ===== MOROSE — never rages; condoles. Speaks of bright things in past tense.
  { id: 'morose-grey-1', trigger: 'moroseGrey', speaker: 'morose', text: 'Rest, little sentinel. You were so tired of burning.' },
  { id: 'morose-grey-2', trigger: 'moroseGrey', speaker: 'morose', text: 'There. No more striving. Isn\'t the quiet kind?' },
  { id: 'morose-grey-3', trigger: 'moroseGrey', speaker: 'morose', text: 'It fought so hard. It was so bright. Let it sleep a moment.' },
  { id: 'morose-steal-1', trigger: 'moroseSteal', speaker: 'morose', text: 'One less choice. Wanting is where the hurt begins.' },
  { id: 'morose-steal-2', trigger: 'moroseSteal', speaker: 'morose', text: 'I\'ll keep this one safe. Desire never kept anything safe.' },
  { id: 'morose-defeat-1', trigger: 'defeat', speaker: 'morose', text: 'Hush now. See how it stops hurting when you stop hoping?' },
  { id: 'morose-defeat-2', trigger: 'defeat', speaker: 'morose', text: 'You were so bright. Rest. Grey is peace.' },
]

// ----------------------------------------------------------------------------
//  THE ENGINE — picks a line for a trigger, rate-limits, never repeats itself
//  back-to-back, and persists once-only lines. Pure presentation logic.
// ----------------------------------------------------------------------------

const ONCE_KEY = 'chromancer_barks_seen_v1'

export interface BarkContext {
  /** hero ids in the current squad (speaker heroes must be present) */
  party: string[]
  /** restrict to this speaker hero (e.g. the hero that just deployed) */
  heroId?: string
  /** current realm id (realm-tagged lines only match here) */
  realmId?: string
}

// per-trigger minimum seconds between lines (global gap applies on top)
const TRIGGER_GAP: Partial<Record<BarkTrigger, number>> = {
  kill: 26,
  reaction: 22,
  fusion: 0, // rare, player-initiated — always worth a line
  deploy: 2,
  pair: 30,
  lowLives: 9999, // once per battle (resetBattle clears it)
  victory: 0,
  defeat: 0,
  moroseGrey: 0,
  moroseSteal: 0,
  walk: 0,
  discovery: 0,
  levelStart: 0,
}

const NARRATORS = new Set(['maddervane', 'morose', 'bloom'])

export class BarkEngine {
  private lastGlobal = -999
  private lastByTrigger = new Map<BarkTrigger, number>()
  private recent: string[] = [] // last shown ids (avoid echo)
  private seenOnce: Set<string>

  /** global minimum seconds between any two barks (battle pacing) */
  constructor(private globalGap = 5) {
    this.seenOnce = new Set(readJson<string[]>(ONCE_KEY, []))
  }

  /** call when a new battle starts so per-battle limits reset */
  resetBattle(): void {
    this.lastGlobal = -999
    this.lastByTrigger.clear()
  }

  /**
   * Pick a line for `trigger` under the rate limits, or null if none/too soon.
   * `now` is any monotonic seconds clock (performance.now()/1000 works).
   */
  pick(trigger: BarkTrigger, ctx: BarkContext, now: number): Bark | null {
    if (now - this.lastGlobal < this.globalGap && (TRIGGER_GAP[trigger] ?? 0) > 0) return null
    const lastT = this.lastByTrigger.get(trigger) ?? -999
    if (now - lastT < (TRIGGER_GAP[trigger] ?? 0)) return null

    const pool = BARKS.filter((b) => {
      if (b.trigger !== trigger) return false
      if (b.once && this.seenOnce.has(b.id)) return false
      if (b.realm && b.realm !== ctx.realmId) return false
      if (b.pair && !(ctx.party.includes(b.pair[0]) && ctx.party.includes(b.pair[1]))) return false
      if (ctx.heroId && !NARRATORS.has(b.speaker) && b.speaker !== ctx.heroId) return false
      if (!ctx.heroId && !NARRATORS.has(b.speaker) && !ctx.party.includes(b.speaker)) return false
      return true
    })
    if (pool.length === 0) return null

    const fresh = pool.filter((b) => !this.recent.includes(b.id))
    const from = fresh.length > 0 ? fresh : pool
    const bark = from[Math.floor(Math.random() * from.length)]
    this.commit(bark, trigger, now)
    return bark
  }

  /** record a bark as shown (pick() does this automatically). */
  commit(bark: Bark, trigger: BarkTrigger, now: number): void {
    this.lastGlobal = now
    this.lastByTrigger.set(trigger, now)
    this.recent.push(bark.id)
    if (this.recent.length > 10) this.recent.shift()
    if (bark.once) {
      this.seenOnce.add(bark.id)
      writeJson(ONCE_KEY, [...this.seenOnce])
    }
  }
}

/** shared engine — battle + map both use it so pacing carries across scenes */
export const barkEngine = new BarkEngine()

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}
function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // private mode — once-only lines may repeat, nothing breaks
  }
}
