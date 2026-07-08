// HERO ARCS — the lightweight per-hero PROGRESSION that sits beside XP/levels.
// Each hero owns a small character arc (canon: chromancer-narrative-bible.md):
//   • an AWAKENING line, spoken in the Lv-3 cinematic when the signature wakes;
//   • a handful of QUESTS — simple, deterministic play challenges keyed to metrics
//     the presentation layer can attribute (signature detonations, spell casts,
//     deploys, wins-while-fielded) — NEVER to hidden sim internals;
//   • STORY BEATS unlocked as those quests complete (the arc "advances"), each a
//     scattered piece of the hero rhyming with the theme: colour = feeling.
//
// PURE DATA + pure helpers. No sim import, no Phaser, no persistence. The tracker
// (economy/heroArcProgress) accumulates the metric counts; this file only says
// what the quests ARE and when a beat unlocks. Rewards are cosmetic/lore only —
// arc progress grants a TITLE + frame tier and unlocks lore, never power.

import { HEROES } from './heroes'

// The metrics the tracker knows how to count, all attributable view-side:
//   signature — this hero's signature mechanic detonated (heroSig event)
//   spell     — this hero's active spell was cast
//   deploy    — this hero took the field in a battle
//   win       — a battle was won with this hero fielded
export type ArcMetric = 'signature' | 'spell' | 'deploy' | 'win'

export interface HeroQuest {
  id: string
  name: string
  desc: string // player-facing goal text — MUST describe exactly what is counted
  metric: ArcMetric
  goal: number
  reward: string // the cosmetic/lore reward earned (a title / lore beat)
}

export interface HeroArc {
  heroId: string
  /** the line spoken in the Lv-3 awakening cinematic (bible: each hero's turn) */
  awakenLine: string
  /** cosmetic titles by arc tier (index = quests completed, 0..quests.length) */
  titles: string[]
  quests: HeroQuest[]
  /** story beats; beat[i] unlocks once `i` quests are complete (beat[0] = awakening) */
  beats: Array<{ title: string; body: string }>
}

// Small helper to keep the table terse and consistent.
const Q = (id: string, name: string, desc: string, metric: ArcMetric, goal: number, reward: string): HeroQuest =>
  ({ id, name, desc, metric, goal, reward })

export const HERO_ARCS: Record<string, HeroArc> = {
  ember: {
    heroId: 'ember',
    awakenLine: 'Fire\'s first job is to burn. Its second job — the one that matters — is to keep the people behind you warm. Stay lit.',
    titles: ['the Cinderblade', 'Warmthkeeper', 'the Unquenched', 'Kindlekeep\'s Return'],
    quests: [
      Q('ember-q1', 'Ashes to Warmth', 'Erupt 30 Cindernovas (her signature)', 'signature', 30, 'Lore: “The Warm Street”'),
      Q('ember-q2', 'Open Fire', 'Cast Fireball 20 times', 'spell', 20, 'Title: the Unquenched'),
      Q('ember-q3', 'Hold the Warm', 'Win 12 battles with Ashka fielded', 'win', 12, 'Lore: “Second Job”'),
    ],
    beats: [
      { title: 'The Foundling', body: 'They found her in the ashes of Kindlekeep — the only warm thing in a cold grey street. She has been counting victories out loud ever since, because the alternative is counting what she lost.' },
      { title: 'The Warm Street', body: 'She goes back, sometimes, to the street where they found her. It is colour now. She stands in it and does not count anything at all.' },
      { title: 'Second Job', body: 'Fire destroys; everyone knows that. What took her longer: fire is also the thing you build a house around. She is learning to be the hearth, not just the blaze.' },
      { title: 'Stay Lit', body: 'The people behind her are warm. That is the whole job. She finally believes it.' },
    ],
  },
  glacia: {
    heroId: 'glacia',
    awakenLine: 'I have read every future but this one. …Good. I would rather fight blind beside you than see the end alone. Improvise. I\'ll keep up.',
    titles: ['the Glacier Oracle', 'the Unforeseen', 'Blind by Choice', 'the Deep Ice Answered'],
    quests: [
      Q('glacia-q1', 'As Foreseen', 'Land 30 Foreseen strikes (her signature)', 'signature', 30, 'Lore: “The Unbelieved”'),
      Q('glacia-q2', 'Read the Cold', 'Cast Frost Nova 20 times', 'spell', 20, 'Title: Blind by Choice'),
      Q('glacia-q3', 'Improvise', 'Win 12 battles with Lumi fielded', 'win', 12, 'Lore: “A Future She Did Not Read”'),
    ],
    beats: [
      { title: 'The Youngest Oracle', body: 'She read the Greying coming in the Deep Ice, and no one believed her. She is not bitter about it. Bitterness is a future she chose not to read.' },
      { title: 'The Unbelieved', body: 'Being right and being ignored are the same loneliness. She learned to answer the question you were about to ask — so at least someone would be heard in time.' },
      { title: 'A Future She Did Not Read', body: 'The first time your improvisation broke one of her visions, she laughed out loud. The ice never showed her that. She wants more of it.' },
      { title: 'Blind by Choice', body: 'She can still see the safe path. She just doesn\'t always take it anymore. Foresight was a cage; she picked the lock.' },
    ],
  },
  sylvan: {
    heroId: 'sylvan',
    awakenLine: 'Regrowth is not restoration, little brush. What comes back comes back different — and it is still worth planting. Everything grey was green once.',
    titles: ['the Grovewarden', 'the Patient', 'Keeper of the Different', 'the Acorn Planted'],
    quests: [
      Q('sylvan-q1', 'Deep Roots', 'Let his aura deepen 24 times (his signature)', 'signature', 24, 'Lore: “Three Days”'),
      Q('sylvan-q2', 'Give It a Minute', 'Cast Healing Circle 18 times', 'spell', 18, 'Title: the Patient'),
      Q('sylvan-q3', 'Plant Anyway', 'Win 12 battles with Thornwick fielded', 'win', 12, 'Lore: “The Hollow Throne”'),
    ],
    beats: [
      { title: 'The Oldest Tree', body: 'When the Greying reached the oldest tree in the Deeproot Wilds, he held the colour in it with his bare hands for three days. He lost. He tells you this the way he tells you everything — slowly, warmly.' },
      { title: 'Three Days', body: 'Three days is a long time to hold something you know you will drop. He does not regret the holding. The dropping taught him what the roots were for.' },
      { title: 'The Different Green', body: 'The Wilds are coming back. Not the same — a stranger green, unfamiliar birds. He walks it every dawn and names the new things kindly.' },
      { title: 'The Hollow Throne', body: 'When it is over, he plants an acorn in the Hollow Throne itself. Give it a minute. Give it a century. Either way, green.' },
    ],
  },
  pyra: {
    heroId: 'pyra',
    awakenLine: 'Two of us— —and we finally know which two! We can hold two fronts now— —because we\'re two, silly. Too bad for you!',
    titles: ['Bramble & Bloom', 'Two Who Hold', 'the Undivided', 'One Slot, Two Hearts'],
    quests: [
      Q('pyra-q1', 'Sprout & Spark', 'Field the twins in 12 battles', 'deploy', 12, 'Lore: “Squirrel Ambush”'),
      Q('pyra-q2', 'Sparkseed', 'Cast Sparkseed Storm 20 times', 'spell', 20, 'Title: the Undivided'),
      Q('pyra-q3', 'Both Hold', 'Win 10 battles with the twins fielded', 'win', 10, 'Lore: “Two Fronts”'),
    ],
    beats: [
      { title: 'Orphaned Together', body: 'When the Wilds greyed, they were found coordinating squirrel ambushes against Morose\'s wisps — grim little Bramble laying the trap, bright little Bloom springing it.' },
      { title: 'Squirrel Ambush', body: 'The squirrels still remember them. Two children who taught a greyed forest to bite back, one nut-cache at a time.' },
      { title: 'Two Fronts', body: 'Forced to fight on two fronts at once, they were terrified they\'d break in half. They didn\'t. Bramble held one line, Bloom the other. Both held.' },
      { title: 'One Slot, Two Hearts', body: 'They finish each other\'s sentences, sparks, and fights — but each one, now, could finish alone. That\'s why they choose not to.' },
    ],
  },
  zephyra: {
    heroId: 'zephyra',
    awakenLine: 'Vorn told me: never love another crew, they only vanish. Wrong, Admiral. I checked the knots twice — this crew stays. Wind\'s up, sails FULL!',
    titles: ['Capt. Stormwright', 'the Recrewed', 'Knot-Checker', 'Captain of the Kept'],
    quests: [
      Q('zephyra-q1', 'Wager\'s On', 'Pay out 24 Wager squalls (her signature)', 'signature', 24, 'Lore: “Nineteen Days”'),
      Q('zephyra-q2', 'Call the Storm', 'Cast Chain Squall 18 times', 'spell', 18, 'Title: Knot-Checker'),
      Q('zephyra-q3', 'Crew Stays', 'Win 12 battles with Galea fielded', 'win', 12, 'Lore: “Two Knots”'),
    ],
    beats: [
      { title: 'The Dead Calm', body: 'Her sky-clipper hung in the dead calm for nineteen days while the Greying drank the wind. When it lifted, she was the only one still aboard.' },
      { title: 'Nineteen Days', body: 'She is loud because the quiet is where the calm lives. Nineteen days of it taught her to fill every silence before it can fill her.' },
      { title: 'Two Knots', body: 'She checks every knot twice now — once for the rope, once for the promise. This crew does not get to vanish on her watch.' },
      { title: 'Captain of the Kept', body: 'The roster is her crew now, and she bets on all of you — first kill, last leak, your next brilliant mistake. A wager means there is a future to collect in.' },
    ],
  },
  volt: {
    heroId: 'volt',
    awakenLine: 'You can\'t calibrate a seed. I tried — force-recoloured a whole village, perfect, soulless. So I build the coils and leave the FEELINGS to the experts. Ninety-nine percent sure!',
    titles: ['Arcwhistle', 'the Recalibrated', 'Infrastructure', 'the One Percent'],
    quests: [
      Q('volt-q1', 'Maintenance Corps', 'Field Fizz in 12 battles', 'deploy', 12, 'Lore: “The Soulless Village”'),
      Q('volt-q2', 'Static Field', 'Cast Static Field 20 times', 'spell', 20, 'Title: Infrastructure'),
      Q('volt-q3', 'Leave the Feelings', 'Win 10 battles with Fizz fielded', 'win', 10, 'Lore: “Can\'t Calibrate a Seed”'),
    ],
    beats: [
      { title: 'Third Class, Decorated Twice', body: 'Prism maintenance-corps, third class, decorated twice — once on purpose. He builds the coils and calibrates the stasis fields and is ninety-nine percent sure about all of it.' },
      { title: 'The Soulless Village', body: 'He once "solved" the Greying mathematically and force-recoloured a whole village. Technically perfect. Completely soulless. He has never fully forgiven the math.' },
      { title: 'Can\'t Calibrate a Seed', body: 'A seed doesn\'t want to be optimal. It wants to be planted and left alone to make its own mistakes. This took him embarrassingly long to accept.' },
      { title: 'Infrastructure', body: 'His new job: be the coils other people\'s feelings run on. Unglamorous. Load-bearing. The one percent, he\'ll tell you, is where the fun lives.' },
    ],
  },
  aurelia: {
    heroId: 'aurelia',
    awakenLine: 'Dawn is not the absence of night. It is what night is FOR. I am allowed to fail — warmly. Hold the line; the dawn is already coming.',
    titles: ['Dawnhalo', 'the Graced', 'Warmly Fallible', 'What Night Is For'],
    quests: [
      Q('aurelia-q1', 'Hold the Line', 'Smite 18 enemies at the gate (her signature)', 'signature', 18, 'Lore: “The Certificate”'),
      Q('aurelia-q2', 'Aegis of Dawn', 'Cast Aegis of Dawn 16 times', 'spell', 16, 'Title: Warmly Fallible'),
      Q('aurelia-q3', 'Learn to Fail', 'Win 12 battles with Seraphine fielded', 'win', 12, 'Lore: “Grace”'),
    ],
    beats: [
      { title: 'Never Failed', body: 'The youngest Lightwarden ever commissioned, with a laminated certificate to prove it. She has never failed. Not once. She keeps the record out of terror of what failing might cost someone else.' },
      { title: 'The Certificate', body: 'The certificate is missing. Nyx knows nothing about it. (It is laminated now, and Nyx is, secretly, keeping it very safe.)' },
      { title: 'Grace', body: 'Nyx taught her to fail — by accident, by failing warmly right in front of her and surviving it. Grace, it turns out, is not the absence of mistakes. It is what you do after.' },
      { title: 'What Night Is For', body: 'She stopped guarding her perfect record. Dawn is not the absence of night; it is what night is for. She fails now, sometimes. Warmly. On purpose.' },
    ],
  },
  vex: {
    heroId: 'vex',
    awakenLine: 'Shadow isn\'t the absence of colour, you sad old man. Shadow is where colour RESTS. You never saw me coming. Nobody ever does — their loss.',
    titles: ['the Umbral Trickster', 'Margin-Keeper', 'Where Colour Rests', 'Somebody Who Remembers'],
    quests: [
      Q('vex-q1', 'Their Loss', 'Pickpocket 30 kills for gold (her signature)', 'signature', 30, 'Lore: “Basically Grey”'),
      Q('vex-q2', 'Umbral Pounce', 'Cast Umbral Pounce 20 times', 'spell', 20, 'Title: Where Colour Rests'),
      Q('vex-q3', 'The Margins Remember', 'Win 12 battles with Nyx fielded', 'win', 12, 'Lore: “Vesper”'),
    ],
    beats: [
      { title: 'The Twilight Margins', body: 'She grew up in the realm everyone treated as basically grey already — so she knows better than anyone that they were wrong. She steals things and returns them improved.' },
      { title: 'Basically Grey', body: 'Being written off as grey your whole childhood does one of two things to you. In her, it made a connoisseur of shadow — the one who can tell you exactly which colours are only resting.' },
      { title: 'Vesper', body: 'The Margrave of Moths steals identities, mimics your greyed heroes. Nyx defeats them by saying their forgotten name: "Vesper. Somebody from the Margins remembers everybody."' },
      { title: 'Where Colour Rests', body: 'Morose told her she was always his. She laughed. Shadow isn\'t the absence of colour, you sad old man. Shadow is where colour rests — and rested colour comes back.' },
    ],
  },
}

export function heroArc(heroId: string): HeroArc | null {
  return HERO_ARCS[heroId] ?? null
}

// --- pure progress helpers (the stored shape lives in save.ts) --------------

export interface ArcProgress {
  metrics: Partial<Record<ArcMetric, number>>
  quests: string[] // completed quest ids
  beats: number // how many story beats are unlocked (>=1 once awakened at Lv3)
}

export function emptyArcProgress(): ArcProgress {
  return { metrics: {}, quests: [], beats: 0 }
}

/** current count for a quest's metric (0 if untouched). */
export function metricCount(p: ArcProgress, metric: ArcMetric): number {
  return p.metrics[metric] ?? 0
}

/** is a quest complete? — done set OR metric already at goal. */
export function questDone(p: ArcProgress, q: HeroQuest): boolean {
  return p.quests.includes(q.id) || metricCount(p, q.metric) >= q.goal
}

/** arc tier = number of completed quests (drives the cosmetic title/frame). */
export function arcTier(arc: HeroArc, p: ArcProgress): number {
  return arc.quests.reduce((n, q) => n + (questDone(p, q) ? 1 : 0), 0)
}

/** the cosmetic title the hero currently displays for their arc tier. */
export function arcTitle(arc: HeroArc, p: ArcProgress): string {
  const t = Math.min(arc.titles.length - 1, arcTier(arc, p))
  return arc.titles[Math.max(0, t)]
}

/** signature display name for a hero (used by the awakening cinematic). */
export function signatureName(heroId: string): string {
  return HEROES[heroId]?.signature.name ?? 'Signature'
}
