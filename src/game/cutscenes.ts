// ============================================================================
//  CUTSCENES — the motion-comic script (pure data, consumed by ui/Cutscene.ts).
//  Every beat is a painted panel: a realm palette or key-art image, a camera
//  drift (pan), an optional typed line. The player is skippable + reduce-motion
//  aware; this file just holds the WRITING, trigger-keyed by id.
//
//  Canon: chromancer-narrative-bible. The spine everything hangs on — the Greying
//  is anaesthesia, not destruction; colour is feeling; Morose CONDOLES; the
//  Keepers are redeemed, not killed; the cure for grey was never victory, it was
//  company. The ending is written first (below) so every beat upstream leans
//  toward it: "Don't hold all six. Hold hands."
// ============================================================================

export interface CutsceneBeat {
  /** painted key-art image under BASE_URL (e.g. 'concepts/00-keyart-v2.jpg') */
  art?: string
  /** realm id → procedural painterly sky from that realm's palette */
  realm?: string
  /** explicit CSS background override (rare) */
  bg?: string
  /** colour grade over the panel */
  tone?: 'grey' | 'bloom' | 'dusk'
  /** camera drift for this panel */
  pan?: 'in' | 'out' | 'left' | 'right' | 'up' | 'down'
  /** drifting particle ambience */
  fx?: 'motes' | 'ash' | 'snow' | 'none'
  /** big centred chapter title (breathes in, no speaker) */
  heading?: string
  /** speaker key (hero id / 'maddervane' / 'morose' / keeper id); omit = narration */
  speaker?: string
  /** the line (typed on screen) */
  text?: string
  /** ms to auto-advance after the line finishes (omit/0 = wait for a tap) */
  hold?: number
}

export interface Cutscene {
  id: string
  title: string
  beats: CutsceneBeat[]
}

// hero id → painted portrait key-art (used for pan-over-key-art speaker beats)
const ART = {
  ember: 'concepts/hero-01-ashka-fire.jpg',
  glacia: 'concepts/hero-02-lumi-frost.jpg',
  zephyra: 'concepts/hero-03-galea-storm.jpg',
  sylvan: 'concepts/hero-04-thornwick-nature.jpg',
  aurelia: 'concepts/hero-05-seraphine-light.jpg',
  vex: 'concepts/hero-06-nyx-dark.jpg',
  volt: 'concepts/hero-07-fizz-arcane.jpg',
  keyart: 'concepts/00-keyart-v2.jpg',
} as const

// ---------------------------------------------------------------------------
//  OPENING — the world was painted; a grieving master unmade it; you are the
//  cadet whose brush never fixed to one colour. Plays once, before the first
//  battle. Skippable; a fresh player is interactive in seconds either way.
// ---------------------------------------------------------------------------
const OPENING: Cutscene = {
  id: 'opening',
  title: 'CHROMANCER',
  beats: [
    { art: ART.keyart, pan: 'in', fx: 'motes', tone: 'bloom', heading: 'CHROMANCER',
      text: 'Once, the world was painted by hand. Six colours, six feelings, six friends who could not agree on anything except that Aetheria should be allowed to feel.', hold: 0 },
    { realm: 'hollow', tone: 'dusk', pan: 'left', speaker: 'maddervane',
      text: 'The greatest of us was Morose. He painted the sky its first blue. He held the ladder so the little ones could add clouds.' },
    { realm: 'hollow', tone: 'grey', pan: 'in', fx: 'ash', speaker: 'maddervane',
      text: 'Then the Keeper Wars came — six certainties, all of them right — and to end the shouting he tried to feel all six at once. Alone.' },
    { realm: 'hollow', tone: 'grey', pan: 'out', fx: 'ash',
      text: 'The colours cancelled. To grey. And in that grey, for the first time, nothing hurt. He mistook the numbness for peace — and set out to share it with everyone.', hold: 0 },
    { realm: 'emberwaste', tone: 'grey', pan: 'right', fx: 'ash',
      text: 'This is the Greying. It does not destroy. It anaesthetises. A greyed world freezes mid-gesture, mid-want, mid-song, spared every hurt by being spared everything.', hold: 0 },
    { realm: 'emberwaste', tone: 'dusk', pan: 'in', speaker: 'maddervane',
      text: 'Which brings me to you, little brush. Your brush never fixed to one colour. The Guild called it a defect. I called it the only hope we had left.' },
    { art: ART.keyart, tone: 'bloom', pan: 'in', fx: 'motes', speaker: 'maddervane',
      text: 'He held all six colours alone, and cancelled. You will hold one — and stand beside five friends holding the rest. Now go. Every colour you ever loved is still there, under the grey. Go get it back.', hold: 0 },
  ],
}

// ---------------------------------------------------------------------------
//  REALM INTROS — Maddervane names the wound, Morose condoles the realm, the
//  realm's hero answers. The 3-line banner, given room to breathe as panels.
// ---------------------------------------------------------------------------
const REALM_INTROS: Cutscene[] = [
  { id: 'realm-emberwaste', title: 'EMBERVALE', beats: [
    { realm: 'emberwaste', tone: 'grey', pan: 'in', fx: 'ash', heading: 'EMBERVALE',
      text: 'The loudest realm in Aetheria — forge-song day and night. It went out in one night. Nobody even smelled the smoke.', hold: 0 },
    { realm: 'emberwaste', tone: 'grey', pan: 'left', speaker: 'maddervane',
      text: 'Kindlekeep\'s fires went cold as a held breath, little brush. A whole town, frozen mid-hammer-stroke.' },
    { realm: 'emberwaste', tone: 'grey', pan: 'in', speaker: 'morose',
      text: 'The fires here begged to stop, little cinder. They were so tired of burning. I only said yes.' },
    { art: ART.ember, tone: 'bloom', pan: 'in', fx: 'motes', speaker: 'ember',
      text: 'Then I\'ll say no. Louder than you said yes. Fire\'s second job was always warmth — and I am about to remind this whole valley of it. Stay lit.' },
  ] },
  { id: 'realm-frostreach', title: 'FROSTREACH', beats: [
    { realm: 'frostreach', tone: 'grey', pan: 'up', fx: 'snow', heading: 'FROSTREACH',
      text: 'They froze the aurora itself, mid-ribbon. The Deep Ice remembers every colour the sky ever was — and the grey turned that memory into a tomb.', hold: 0 },
    { realm: 'frostreach', tone: 'grey', pan: 'right', speaker: 'maddervane',
      text: 'Beautiful, and silent, and useless. Ice should glitter, little brush. Not apologise.' },
    { realm: 'frostreach', tone: 'grey', pan: 'in', speaker: 'morose',
      text: 'Poor unbelieved oracle. You saw the grey coming, and they laughed at you. Doesn\'t the quiet feel like being finally, finally right?' },
    { art: ART.glacia, tone: 'bloom', pan: 'in', fx: 'snow', speaker: 'glacia',
      text: 'They did laugh. I have seen how this ends anyway. It goes well. I have simply chosen to stop reading the last page — and fight it blind, like the living do.' },
  ] },
  { id: 'realm-stormpeaks', title: 'THE STORMPEAKS', beats: [
    { realm: 'stormpeaks', tone: 'grey', pan: 'up', heading: 'THE STORMPEAKS',
      text: 'Listen. No thunder. These peaks used to sing weather to their climbers — now a sky with nothing left to say.', hold: 0 },
    { realm: 'stormpeaks', tone: 'grey', pan: 'left', speaker: 'maddervane',
      text: 'The cruellest quiet there is, little brush. Not silence — the absence of anyone deciding to speak.' },
    { realm: 'stormpeaks', tone: 'grey', pan: 'in', speaker: 'morose',
      text: 'The becalmed captain. Nineteen years you asked the wind to come back. It never did. Stop asking, and the not-coming stops hurting.' },
    { art: ART.zephyra, tone: 'bloom', pan: 'in', fx: 'motes', speaker: 'zephyra',
      text: 'The wind didn\'t come back for me — so I CAME BACK FOR MYSELF, and I brought a crew this time, and none of them are allowed to vanish quietly. WIND\'S UP, SAILS FULL — wager\'s ON!' },
  ] },
  { id: 'realm-verdant', title: 'THE VERDANT WILDS', beats: [
    { realm: 'verdant', tone: 'grey', pan: 'in', fx: 'motes', heading: 'THE VERDANT WILDS',
      text: 'The Wilds are not dead. Nothing in the Verdant ever fully dies — that is exactly the trouble that was made of it here.', hold: 0 },
    { realm: 'verdant', tone: 'grey', pan: 'right', speaker: 'maddervane',
      text: 'They\'re holding their breath, little brush. A whole forest, waiting. Help them exhale.' },
    { realm: 'verdant', tone: 'grey', pan: 'in', speaker: 'morose',
      text: 'Old warden. You held colour inside one tree for three days, and then you lost it. Doesn\'t it ache less, not to be holding anything at all?' },
    { art: ART.sylvan, tone: 'bloom', pan: 'in', fx: 'motes', speaker: 'sylvan',
      text: 'Aye. It aches less. It also means less. Everything grey was green once — and what grows back won\'t be what you took. It\'ll be a second opinion. Give it a minute.' },
  ] },
  { id: 'realm-lumen', title: 'THE DAWNSPIRE', beats: [
    { realm: 'lumen', tone: 'grey', pan: 'in', fx: 'motes', heading: 'THE DAWNSPIRE',
      text: 'The last lanterns of Aetheria gutter along the Gilded Aisle. The terrible lesson of this realm: even light can be talked out of shining.', hold: 0 },
    { realm: 'lumen', tone: 'grey', pan: 'up', speaker: 'maddervane',
      text: 'Careful here, little brush. This is the realm where giving up wears the face of grace.' },
    { realm: 'lumen', tone: 'grey', pan: 'in', speaker: 'morose',
      text: 'Little dawn-keeper. A perfect record, and for what? Striving is only suffering with better posture. Put the lantern down. Be at peace.' },
    { art: ART.aurelia, tone: 'bloom', pan: 'in', fx: 'motes', speaker: 'aurelia',
      text: 'A perfect record is worth nothing — and that was never why we hold the line. Dawn is not the absence of night. It is what night is FOR. Hold the line. The dawn is already coming.' },
  ] },
  // The Hollow intro IS the Morose confrontation — the approach to the throne.
  { id: 'realm-hollow', title: 'THE HOLLOW', beats: [
    { realm: 'hollow', tone: 'grey', pan: 'in', fx: 'ash', heading: 'THE HOLLOW',
      text: 'Past the Twilight Margins — the realm everyone had already grieved while it still lived — there is a room with two chairs, and a man who sat down and refused to hurt.', hold: 0 },
    { realm: 'hollow', tone: 'grey', pan: 'left', speaker: 'maddervane',
      text: 'This is where my oldest friend put down the brush. End it kindly, little brush. He is not a monster. He is the saddest thing I know.' },
    { realm: 'hollow', tone: 'grey', pan: 'in', speaker: 'morose',
      text: 'You came all this way to feel things. Six realms of wanting and losing and wanting again. Look at you. How tired you must be. Sit. I set out a chair.' },
    { realm: 'hollow', tone: 'grey', pan: 'right', speaker: 'morose',
      text: 'No one came to hold the line for ME, you know. When it was my turn to be held, the world was busy. So I made a peace where no one needs holding. Isn\'t it quiet? Isn\'t it kind?' },
    { art: ART.vex, tone: 'dusk', pan: 'in', speaker: 'vex',
      text: 'Kind. He greyed a world to spare it a hurt, and calls it kind. Shadow isn\'t the absence of colour, you sad old man. Shadow is where colour RESTS. Watch — we\'ll show you the difference.' },
  ] },
]

// ---------------------------------------------------------------------------
//  REALM FINALES — the FULL BLOOM after a Keeper is redeemed. The trailer shot,
//  ×5 (the Hollow's "finale" is the ending). Colour floods the realm; the freed
//  Keeper and the hero share one line; a healing scar remains.
// ---------------------------------------------------------------------------
const REALM_FINALES: Cutscene[] = [
  { id: 'finale-emberwaste', title: 'EMBERVALE RESTORED', beats: [
    { realm: 'emberwaste', tone: 'bloom', pan: 'out', fx: 'motes', heading: 'EMBERVALE RESTORED',
      text: 'And the forges of Kindlekeep caught, all at once, all down the valley — colour flooding back too bright before it settled, the way a realm does not creep back to feeling but gasps.', hold: 0 },
    { realm: 'emberwaste', tone: 'bloom', pan: 'in', speaker: 'kaelen',
      text: 'The forge… remembers me. Ashka — I kept it lit until it burned, and I could not forgive the difference. I\'m sorry. I\'m… I\'m LIT.' },
    { art: ART.ember, tone: 'bloom', pan: 'in', fx: 'motes', speaker: 'ember',
      text: 'Warmth and wildfire aren\'t the same fire, Kaelen. Took me a whole valley to learn it too. Welcome back. Now come on — the hearths won\'t light themselves.' },
    { realm: 'emberwaste', tone: 'bloom', pan: 'out', fx: 'motes',
      text: 'The colour came back — but not evenly. Brighter at the seams, where the grey had held the longest. Maddervane calls them healing scars. Healed is not the same as unmarked. Nobody worth loving is.', hold: 0 },
  ] },
  { id: 'finale-frostreach', title: 'FROSTREACH RESTORED', beats: [
    { realm: 'frostreach', tone: 'bloom', pan: 'up', fx: 'snow', heading: 'FROSTREACH RESTORED',
      text: 'The Deep Ice thawed to blue, and the Aurora Chime finished the note it had held for three years — one impossible chord, three years late, that made the whole realm stop and listen.', hold: 0 },
    { realm: 'frostreach', tone: 'bloom', pan: 'in', speaker: 'maravelle',
      text: 'Oh. The ice was never meant to stop the river. Only to remember it. Lumi — read on without me. …No. WITH me. I would like to see a page I haven\'t.' },
    { art: ART.glacia, tone: 'bloom', pan: 'in', fx: 'snow', speaker: 'glacia',
      text: 'I foresaw this reunion, mentor. I did not foresee that it would make me cry. Foresight has its limits. I am learning to love the limits.' },
  ] },
  { id: 'finale-stormpeaks', title: 'THE STORMPEAKS RESTORED', beats: [
    { realm: 'stormpeaks', tone: 'bloom', pan: 'out', fx: 'motes', heading: 'THE STORMPEAKS RESTORED',
      text: 'Weather returned to the peaks like an argument resuming — thunder, then rain, then the great iron weathervane of a drydocked fleet turning, at last, into a wind that finally arrived.', hold: 0 },
    { realm: 'stormpeaks', tone: 'bloom', pan: 'in', speaker: 'vorn',
      text: 'WIND. Weather — on MY deck. Galea, you insufferable, magnificent gale — I furled my sails in a harbour and called it dignity. The fleet sails at dawn.' },
    { art: ART.zephyra, tone: 'bloom', pan: 'in', fx: 'motes', speaker: 'zephyra',
      text: 'A crew that vanished isn\'t a reason to never crew again, you old barnacle. It\'s the reason to be LOUD. Now hoist something. You\'re on my roster whether you enlisted or not.' },
  ] },
  { id: 'finale-verdant', title: 'THE VERDANT WILDS RESTORED', beats: [
    { realm: 'verdant', tone: 'bloom', pan: 'in', fx: 'motes', heading: 'THE VERDANT WILDS RESTORED',
      text: 'The Wilds exhaled. Not back to what the grey took — into something new, half its oldest tree in impossible new colours, half still the silver of what it survived. A healing scar the size of a cathedral.', hold: 0 },
    { realm: 'verdant', tone: 'bloom', pan: 'in', speaker: 'wessa',
      text: 'Then let it all bloom and be brief. Thornwick — a pressed flower was never a garden, and I knew it, and I held on anyway. The Wilds are BREATHING. Growing means dying a little. I had forgotten the price.' },
    { art: ART.sylvan, tone: 'bloom', pan: 'in', fx: 'motes', speaker: 'sylvan',
      text: 'Everything grey was green once, old friend. It just came back with opinions. The moss forgives you. I forgive you. Now help me plant something — I\'ve been carrying this acorn a long way.' },
  ] },
  { id: 'finale-lumen', title: 'THE DAWNSPIRE RESTORED', beats: [
    { realm: 'lumen', tone: 'bloom', pan: 'out', fx: 'motes', heading: 'THE DAWNSPIRE RESTORED',
      text: 'The Gilded Aisle relit in sequence, from the far dark end back toward the light — the darkest lantern first, because that is where light is needed and least deserved and goes anyway.', hold: 0 },
    { realm: 'lumen', tone: 'bloom', pan: 'in', speaker: 'aurelin',
      text: 'The dawn does not wait to be deserved. It never did. I mistook never-trying for never-failing, child, and haloed a whole choir into silence for it. Seraphine — sing the loud verse. All forty.' },
    { art: ART.aurelia, tone: 'bloom', pan: 'in', fx: 'motes', speaker: 'aurelia',
      text: 'I failed my perfect record somewhere in the third realm, High Cantor — and the dawn came anyway. I am more use to the light cracked than I ever was flawless. So, it turns out, are you.' },
  ] },
]

// ---------------------------------------------------------------------------
//  CAMPFIRE INTERSTITIALS — the reused-staging trick (one campfire, many nights).
//  Short character beats between realms that pay off the hero relationships and
//  the world's emotional arc. Fire-lit, quiet, ≤4 panels, always skippable.
// ---------------------------------------------------------------------------
const CAMPFIRE_BG = 'radial-gradient(60% 45% at 50% 74%, rgba(255,150,60,.5), rgba(120,50,20,.2) 45%, transparent 70%), linear-gradient(180deg, #1a1230 0%, #0c0820 60%, #05030e 100%)'
const camp = (id: string, title: string, beats: CutsceneBeat[]): Cutscene => ({
  id, title,
  beats: beats.map((b) => ({ bg: CAMPFIRE_BG, fx: 'motes', pan: 'in', tone: 'dusk', ...b })),
})

const CAMPFIRES: Cutscene[] = [
  // after Embervale — Ashka & Lumi, the seeded rival→devotion pair
  camp('campfire-1', 'A FIRE, THE FIRST NIGHT', [
    { heading: 'A FIRE, THE FIRST NIGHT',
      text: 'One realm freed. Six to go. The company makes camp in the first colour they\'ve seen in weeks, and nobody quite knows what to do with the quiet.', hold: 0 },
    { speaker: 'ember', text: 'You knew we\'d win that. You said "it goes well" before we even started. Kind of takes the fun out, oracle.' },
    { speaker: 'glacia', text: 'I said it goes well. I did not say how. The how was you, running at a Keeper with your hair on fire. That part I did not foresee. That part was… nice.' },
    { speaker: 'ember', text: '…Don\'t tell anyone I sat this close to the ice and didn\'t complain.' },
    { speaker: 'glacia', text: 'I foresee that I won\'t. Warm up, Ashka. There is a long grey road, and I would rather walk it next to a fire that argues.' },
  ]),
  // after Frostreach — Galea adopts the roster; Nyx watches from the dark
  camp('campfire-2', 'A FIRE, AND A ROSTER', [
    { heading: 'A FIRE, AND A ROSTER',
      text: 'Two realms in colour behind them. Galea has produced, from somewhere, a ship\'s log, and is writing names in it with great ceremony.', hold: 0 },
    { speaker: 'zephyra', text: 'Right. New crew article, effective tonight: nobody vanishes quiet. You want to leave, you leave LOUD, to my face, with notice. That\'s the whole rule. That\'s the only rule.' },
    { speaker: 'vex', text: 'You can\'t roster me, captain. I wasn\'t here. I\'m never here. That\'s rather the point of me.' },
    { speaker: 'zephyra', text: 'Wrote you down anyway. Nyx of the Margins. Spelled it right and everything. Now you\'re somebody who\'d be MISSED. Terribly sorry. Wager\'s on.' },
    { speaker: 'vex', text: '…Hm. Nobody\'s spelled it right in a while. Fine. But I\'m stealing your good quill. I\'ll bring it back better.' },
  ]),
  // after Stormpeaks — Fizz's guilt; the miniature-Morose lesson
  camp('campfire-3', 'A FIRE, AND AN EQUATION', [
    { heading: 'A FIRE, AND AN EQUATION',
      text: 'Halfway now. Fizz has been quiet for a whole realm, which for Fizz is a medical emergency, and is staring into the fire not calculating anything.', hold: 0 },
    { speaker: 'volt', text: 'I solved it once, you know. The Greying. Force-recoloured a whole village by arithmetic. Ninety-nine percent perfect. Looked exactly right.' },
    { speaker: 'sylvan', text: 'And the one percent?' },
    { speaker: 'volt', text: 'Nobody was home. Colour with the feeling left out. A little Morose, made in an afternoon, by me. …You can\'t calibrate a seed, Thornwick. I keep the equation to remind me not to run it.' },
    { speaker: 'sylvan', text: 'Then be the fire instead of the arithmetic. Keep the rest of us lit. The moss says a good root doesn\'t bloom — it lets everything above it bloom. High praise, from the moss.' },
  ]),
  // after Verdant — Seraphine & Nyx, the bicker-ship, failing warmly
  camp('campfire-4', 'A FIRE, AND A CERTIFICATE', [
    { heading: 'A FIRE, AND A CERTIFICATE',
      text: 'Four realms bloom behind them; two grey ones wait ahead. Seraphine is reorganising the camp for the third time. Nyx is watching, with the specific patience of someone about to be kind and hating it.', hold: 0 },
    { speaker: 'aurelia', text: 'I lost my commendation certificate in the Wilds. Twelve years, perfect record, laminated. It\'s just… gone. I keep reaching for it and it isn\'t there.' },
    { speaker: 'vex', text: 'Tragic. A whole laminated card. However will the dawn come without it.' },
    { speaker: 'aurelia', text: 'You\'re right. That\'s — you\'re right. Dawn isn\'t a reward for a spotless record. It\'s what the night is for. I think I needed to lose it to learn that. Thank you, Nyx. Genuinely.' },
    { speaker: 'vex', text: '…Ugh. Don\'t. Go to sleep, dawn-keeper. (…she does not mention the certificate, folded twice, in the lining of her coat. She never will.)' },
  ]),
  // after Lumen — the whole company, and the road to the Hollow
  camp('campfire-5', 'A FIRE, BEFORE THE HOLLOW', [
    { heading: 'A FIRE, BEFORE THE HOLLOW',
      text: 'Five realms in full colour. One grey throne left, at the top of the world, where the man who unmade all of it is waiting with two chairs set out.', hold: 0 },
    { speaker: 'sylvan', text: 'He tried to feel all six of these at once. Everything we just walked through — all of it, in one chest, alone. No wonder it cancelled.' },
    { speaker: 'zephyra', text: 'Aye. And we did it the other way. One colour each, six friends, one loud fire. Same six colours. Completely different arithmetic.' },
    { speaker: 'vex', text: 'That\'s the whole trick, isn\'t it. The thing he never worked out. He held all six. He should have held hands.' },
    { speaker: 'ember', text: 'Then let\'s go tell him. Loudly. All of us. Stay lit.' },
  ]),
]

// ---------------------------------------------------------------------------
//  THE ENDING — redemption, not death. Written first; everything above leans
//  here. The Hollow King does not fall; he stops holding. The cure for grey was
//  never victory. It was company.
// ---------------------------------------------------------------------------
const ENDING: Cutscene = {
  id: 'ending',
  title: 'THE HOLLOW THRONE',
  beats: [
    { realm: 'hollow', tone: 'grey', pan: 'in', fx: 'ash', heading: 'THE HOLLOW THRONE',
      text: 'He does not fall. He was never standing. When the last grey breaks and the Titan goes still, the Hollow King simply… stops holding.', hold: 0 },
    { realm: 'hollow', tone: 'grey', pan: 'in', speaker: 'morose',
      text: '…oh. Oh, it\'s warm. I\'d forgotten warm. I held so much, for so long, so that no one else would have to — and I forgot there was a person under all of it, getting cold.' },
    { realm: 'hollow', tone: 'dusk', pan: 'left', speaker: 'morose',
      text: 'Don\'t hold all six, little brush. That was my whole mistake, and I made it out of love, which is the worst way to be wrong. Don\'t hold all six. Hold —' },
    { realm: 'hollow', tone: 'bloom', pan: 'in', fx: 'motes', speaker: 'morose',
      text: '— hold hands. That was the trick. It was always, only, ever the trick. Six friends, one colour each, standing close. I could have just… asked someone to stand close.' },
    { realm: 'hollow', tone: 'bloom', pan: 'out', fx: 'motes',
      text: 'And colour came back into the Hollow — not all at once, not evenly. In seams and scars, brightest where the grey had held the longest. A healed world. Not an unmarked one. There is a difference, and it is the whole point.', hold: 0 },
    { realm: 'hollow', tone: 'bloom', pan: 'in', speaker: 'maddervane',
      text: 'There you are, you old fool. I kept the tea bitter, the way we drank it when we were boys and thought grey was just a colour. Sit down. You\'re de-crowned and you\'re holding up the light. Let me take a turn.' },
    { realm: 'verdant', tone: 'bloom', pan: 'in', fx: 'motes', speaker: 'sylvan',
      text: 'Here. In the Hollow Throne, where nothing grew for a hundred years. One acorn from the tree I couldn\'t save. Everything grey was green once, Morose. Give it a minute. Give yourself one too.' },
    { realm: 'hollow', tone: 'bloom', pan: 'out', fx: 'motes',
      text: 'The war did not end because someone won it. It ended because someone, finally, was held. The cure for grey was never victory. It was company. It was always company.', hold: 0 },
    { art: ART.keyart, tone: 'bloom', pan: 'in', fx: 'motes', heading: 'hold hands.',
      text: 'Six friends. One unfixed brush. A world learning again, panel by coloured panel, to hurt and to hope. There is so much left to paint. Go on, little brush. Go get the rest of it back.', hold: 0 },
  ],
}

// ---------------------------------------------------------------------------
//  REGISTRY + persistence (one localStorage key, view-side, never in SaveData).
// ---------------------------------------------------------------------------
export const CUTSCENES: Record<string, Cutscene> = Object.fromEntries(
  [OPENING, ...REALM_INTROS, ...REALM_FINALES, ...CAMPFIRES, ENDING].map((c) => [c.id, c]),
)

export function getCutscene(id: string): Cutscene | undefined {
  return CUTSCENES[id]
}

/** The finale/campfire that plays when each realm is RESTORED, in play order. */
export const REALM_FINALE_CUTSCENE: Record<string, string> = {
  emberwaste: 'finale-emberwaste',
  frostreach: 'finale-frostreach',
  stormpeaks: 'finale-stormpeaks',
  verdant: 'finale-verdant',
  lumen: 'finale-lumen',
  // the Hollow's "finale" is the ending itself (handled separately).
}
export const REALM_CAMPFIRE_CUTSCENE: Record<string, string> = {
  emberwaste: 'campfire-1',
  frostreach: 'campfire-2',
  stormpeaks: 'campfire-3',
  verdant: 'campfire-4',
  lumen: 'campfire-5',
}

const SEEN_KEY = 'chromancer_cutscenes_v1'

function readSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY)
    const arr = raw ? (JSON.parse(raw) as unknown) : []
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

let seen = readSeen()

export function isCutsceneSeen(id: string): boolean {
  return seen.has(id)
}

export function markCutsceneSeen(id: string): void {
  if (seen.has(id)) return
  seen.add(id)
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen]))
  } catch {
    // private mode — replays every time, gameplay unaffected
  }
}

/** Settings "replay the story" — wipe the seen set so intros play fresh. */
export function resetCutscenesSeen(): void {
  seen = new Set()
  try { localStorage.removeItem(SEEN_KEY) } catch { /* ignore */ }
}
