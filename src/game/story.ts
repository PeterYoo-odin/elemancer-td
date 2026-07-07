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
