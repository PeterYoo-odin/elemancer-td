// ============================================================================
//  STORY FRAMING DATA — realm-entry moments, pre-level flavor + context barks.
//  Pure data (bible content), consumed by WorldMap. Every beat is ≤3 lines on
//  screen and one-tap skippable; nothing here ever gates the Play flow.
// ============================================================================

export interface StoryLine {
  /** speaker key: hero id, 'maddervane' or 'morose' (resolved by the UI) */
  speaker: string
  text: string
}

// Realm-entry moment: 3 lines — Maddervane sets the wound, Morose taunts the
// realm, the realm hero answers. Shown once, on first entering the realm.
export const REALM_ENTRY: Record<string, StoryLine[]> = {
  emberwaste: [
    { speaker: 'maddervane', text: 'Kindlekeep\'s forges went out in one night, little brush. Nobody even smelled smoke.' },
    { speaker: 'morose', text: 'The fires here begged to stop, little cinder. I only said yes.' },
    { speaker: 'ember', text: 'Then I\'ll say no. Louder. Stay lit.' },
  ],
  frostreach: [
    { speaker: 'maddervane', text: 'They froze the aurora itself. Ice should glitter, not apologise.' },
    { speaker: 'morose', text: 'Poor unbelieved oracle. You saw the grey coming, and they laughed.' },
    { speaker: 'glacia', text: 'They did. I have seen how this ends anyway. It goes well.' },
  ],
  stormpeaks: [
    { speaker: 'maddervane', text: 'Listen. No thunder. A sky with nothing left to say, little brush.' },
    { speaker: 'morose', text: 'The becalmed captain. No wind ever came back for you, did it?' },
    { speaker: 'zephyra', text: 'It didn\'t have to. I CAME BACK FOR MYSELF. Wind\'s up!' },
  ],
  verdant: [
    { speaker: 'maddervane', text: 'The Wilds aren\'t dead — they\'re holding their breath. Help them exhale.' },
    { speaker: 'morose', text: 'Old warden. You held colour in one tree for three days. Then you lost.' },
    { speaker: 'sylvan', text: 'Aye. And everything grey was green once. Give it a minute.' },
  ],
  lumen: [
    { speaker: 'maddervane', text: 'The last lanterns of Aetheria gutter here. Careful — even light can give up.' },
    { speaker: 'morose', text: 'Little dawn-keeper. What is a perfect record worth in the dark?' },
    { speaker: 'aurelia', text: 'Nothing. That is not why we hold the line. The dawn is already coming.' },
  ],
  hollow: [
    { speaker: 'maddervane', text: 'This is where my friend sat down and refused to hurt. End it kindly, little brush.' },
    { speaker: 'morose', text: 'You came all this way to feel things. How tired you must be.' },
    { speaker: 'vex', text: 'Shadow isn\'t the absence of color, you sad old man. Shadow is where color RESTS.' },
  ],
}

// Pre-level card: one flavor line per level + a contextual bark (featured realm
// hero, Maddervane, or Morose when boss-adjacent).
export interface LevelStory {
  flavor: string
  bark: StoryLine
}

// The realm hero who narrates its generated stops, + a deterministic bark pool.
const REALM_HERO: Record<string, string> = {
  emberwaste: 'ember', frostreach: 'glacia', stormpeaks: 'zephyra', verdant: 'sylvan', lumen: 'aurelia', hollow: 'vex',
}
const REALM_STOP_BARKS: Record<string, string[]> = {
  emberwaste: ['Warm hands, steady eyes. Wake this stretch and move on.', 'Ash on the wind means embers underneath. Find them.', 'One hearth at a time. That is how you unburn a world.'],
  frostreach: ['The ice remembers blue. Give it a reason to thaw.', 'Step light — this crust hides what it froze.', 'I have seen this stop go well. Make my sight true.'],
  stormpeaks: ['Eyes up — the sky here has teeth and no manners.', 'Catch the wind before it catches you. Move!', 'Thunder used to live here. Let us evict the silence.'],
  verdant: ['Patience cracks any shell. The moss agrees.', 'Everything grey was green once. Give it a minute.', 'Roots run under all of this. So does hope.'],
  lumen: ['Hold the line, not the record. Light the way.', 'Even a dim lantern is a promise kept.', 'Grace is a trap here. Fight anyway.'],
  hollow: ['Shadow is where colour rests. Wake it gently.', 'Mirrors lie. Your towers do not.', 'Say its true name and the grey lets go.'],
}
const MINIBOSS_BARKS = [
  'A grey echo stands in the road. Break it and keep climbing.',
  'Something old and hollow guards this stop. Answer it with fire.',
  'The Greying left a warden here. Redeem it or route around it.',
]
const FINALE_BARKS = [
  'Come in, little brush. Put down the wanting.',
  'The Keeper waits at the top of the world. End it kindly.',
  'This is the last colour they stole here. Take it back.',
]

function hashId(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return (h >>> 0)
}

// Return the authored beat for a level, or a deterministic generated one so every
// stop on the long ladder carries a line (never a blank pre-level card).
export function storyForLevel(
  lvl: { id: string; blurb: string; landmark?: 'landmark' | 'finale' },
  realm: { id: string; name: string },
): LevelStory {
  const authored = LEVEL_STORY[lvl.id]
  if (authored) return authored
  const h = hashId(lvl.id)
  if (lvl.landmark === 'finale') {
    return { flavor: lvl.blurb, bark: { speaker: 'morose', text: FINALE_BARKS[h % FINALE_BARKS.length] } }
  }
  if (lvl.landmark === 'landmark') {
    return { flavor: lvl.blurb, bark: { speaker: 'maddervane', text: MINIBOSS_BARKS[h % MINIBOSS_BARKS.length] } }
  }
  const pool = REALM_STOP_BARKS[realm.id] ?? REALM_STOP_BARKS.emberwaste
  const speaker = REALM_HERO[realm.id] ?? 'maddervane'
  return { flavor: lvl.blurb, bark: { speaker, text: pool[h % pool.length] } }
}

export const LEVEL_STORY: Record<string, LevelStory> = {
  l1: {
    flavor: 'The first forge of Kindlekeep, cold as a held breath.',
    bark: { speaker: 'maddervane', text: 'Small strokes first, little brush. Wake one hearth and the rest remember.' },
  },
  l2: {
    flavor: 'A causeway of frozen music — the aurora stopped mid-note.',
    bark: { speaker: 'glacia', text: 'The Deep Ice remembers being blue. Remind it.' },
  },
  l3: {
    flavor: 'Stairways where thunder used to sing to the climbers.',
    bark: { speaker: 'zephyra', text: 'Watch the skies — what flies up here doesn\'t knock first!' },
  },
  l4: {
    flavor: 'The marsh keeps what it catches. Lately it keeps everything.',
    bark: { speaker: 'sylvan', text: 'Shields crack like bark, given patience. The moss suggests violence, politely.' },
  },
  l5: {
    flavor: 'A gilded aisle of lanterns, each one dimmer than the last.',
    bark: { speaker: 'morose', text: 'So many little lights, straining. I could make it effortless. Say the word.' },
  },
  l6: {
    flavor: 'The Hollow Throne. He is expecting you. He set out chairs.',
    bark: { speaker: 'morose', text: 'Come in, little brush. Put down the wanting. See how I stopped hurting.' },
  },
}
