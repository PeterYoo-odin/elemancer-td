// ============================================================================
//  CODEX — "The Cadet's Sketchbook". Lore fragments earned through play.
//  Data model + persistence for the full ~90-entry book; this slice seeds ~15
//  entries (heroes, realms, field notes, and the first scattered pieces of
//  Morose's tragedy). Unlocks live in their own localStorage key — never in
//  SaveData — so the save schema stays untouched.
// ============================================================================

export type CodexCategory = 'heroes' | 'wyrms' | 'world' | 'realms' | 'keepers' | 'enemies' | 'morose' | 'lore' | 'field'

export interface CodexEntry {
  id: string
  category: CodexCategory
  title: string
  text: string
  /** shown while locked, hints at how to earn it */
  hint: string
}

export const CODEX_CATEGORY_LABEL: Record<CodexCategory, string> = {
  heroes: 'The Company',
  wyrms: 'The Chromatic Wyrms',
  world: 'Aetheria',
  realms: 'The Six Realms',
  keepers: 'The Fallen Keepers',
  enemies: 'The Greyed',
  morose: 'The Hollow King',
  lore: 'The Deeper Canon',
  field: 'Field Notes',
}

// Panel render order (CodexPanel iterates this). Adding a category here is the
// ONLY place the collection UI needs to learn about it.
export const CODEX_CATEGORY_ORDER: CodexCategory[] = ['heroes', 'wyrms', 'world', 'realms', 'keepers', 'enemies', 'morose', 'lore', 'field']

// Wyrm codex ids, in canon order (unlocked when a Wyrm is discovered / bonded).
export const WYRM_CODEX_IDS: string[] = ['wyrm-pyrax', 'wyrm-glaciaxis', 'wyrm-voltaryx', 'wyrm-verdwyrm', 'wyrm-lumenwyrm', 'wyrm-umbrawyrm']

export const CODEX: CodexEntry[] = [
  // ---- heroes (unlocked by first fielding each hero) ----
  { id: 'hero-ember', category: 'heroes', title: 'Ashka the Cinderblade',
    text: 'Foundling of the first town the Greying took. She counts her victories out loud because the silence afterwards is the part that scares her. Fire\'s first job is destruction. She is slowly learning its second job is warmth.',
    hint: 'Field Ashka in battle.' },
  { id: 'hero-glacia', category: 'heroes', title: 'Lumi the Glacier Oracle',
    text: 'Youngest ever to read the Deep Ice. She saw the Greying coming and was not believed. She answers questions a moment before they are asked, which she insists is politeness, not showing off.',
    hint: 'Field Lumi in battle.' },
  { id: 'hero-sylvan', category: 'heroes', title: 'Thornwick the Grovewarden',
    text: 'He held colour inside the oldest tree for three days, alone, and lost. He relays the moss\'s opinions verbatim. The moss is seldom wrong. What grows back after the grey is never quite what was lost — he is making his peace with that.',
    hint: 'Field Thornwick in battle.' },
  { id: 'hero-pyra', category: 'heroes', title: 'Bramble & Bloom',
    text: 'Orphaned by the greying of the Wilds, found commanding a squirrel ambush of remarkable sophistication. One twin ends the other\'s sentences — grim, then bright. They share one place in the line and count as one hero, which they consider cheating in their favour.',
    hint: 'Field Bramble & Bloom in battle.' },
  { id: 'hero-zephyra', category: 'heroes', title: 'Capt. Galea Stormwright',
    text: 'A sky-clipper captain becalmed for nineteen days while the grey took her crew\'s colours one by one. She is loud so nobody can vanish quietly again. She has adopted this entire company as crew. There was no vote.',
    hint: 'Field Galea in battle.' },
  { id: 'hero-volt', category: 'heroes', title: 'Fizz Arcwhistle',
    text: 'Prism maintenance corps, third rung, decorated twice, detonated once. Fizz believes the Greying is a solvable equation. Fizz is ninety-nine percent sure. The one percent is where the fun lives.',
    hint: 'Field Fizz in battle.' },
  { id: 'hero-aurelia', category: 'heroes', title: 'Seraphine Dawnhalo',
    text: 'The youngest Lightwarden ever commissioned, holder of a perfect record and a laminated certificate to prove it. (The certificate is currently missing.) She is learning — slowly, formally — that dawn is not the absence of night. It is what night is for.',
    hint: 'Field Seraphine in battle.' },
  { id: 'hero-vex', category: 'heroes', title: 'Nyx the Umbral Trickster',
    text: 'From the Twilight Margins, the realm everyone treated as basically grey already. Steals things and returns them improved. Lies constantly, kindly. Believes — quietly, fiercely — that shadow is not the absence of colour. Shadow is where colour rests.',
    hint: 'Field Nyx in battle.' },

  // ---- the Chromatic Wyrms (unlocked as the late act wakes each dragon) ----
  { id: 'wyrm-act', category: 'wyrms', title: 'The Waking of the Wyrms',
    text: 'Before the Greying, six great Wyrms were the living founts of colour in Aetheria — each the pure elemental soul of one realm. When Morose spread the grey, they did not die. They curled around the last ember of colour deep in each realm and went dormant, too drained to wake. Restore enough of the world and the feeling comes back to them. A hero can bond a waking Wyrm, and the world\'s colour takes flight again — the truest mirror of the Hollow King, who tried to hold all six alone.',
    hint: 'Restore four realms to wake the Wyrms.' },
  { id: 'wyrm-pyrax', category: 'wyrms', title: 'Pyrax, the First Ember',
    text: 'The fire-soul of Emberwaste, curled a hundred years around Kindlekeep\'s last unspent coal. It does not breathe to destroy — it breathes to keep the people behind it warm, which is fire\'s second and better job. Bonds perfectly with Ashka: two foundlings of the flame who were never really cold, just cold-adjacent.',
    hint: 'Restore Emberwaste, then wake the Wyrms.' },
  { id: 'wyrm-glaciaxis', category: 'wyrms', title: 'Glaciaxis, the Deep Frost',
    text: 'The ice-soul of Frostreach. Like Lumi, it dreamed the Greying before it came, and like Lumi it was not believed — so it chose to sleep until the aurora could sing again. Its rime-breath stills a whole field in place. Attunes to Lumi; the oracle and the dragon simply finish choosing the same better future.',
    hint: 'Restore Frostreach, then wake the Wyrms.' },
  { id: 'wyrm-voltaryx', category: 'wyrms', title: 'Voltaryx, the Sky\'s Verdict',
    text: 'The storm-soul of Stormpeaks. The dead calm that took Galea\'s crew nearly drank it dry; it hoarded one spark, and one spark turned out to be enough. Its breath is a verdict — loud, sudden, and final. Attunes to Galea, who finally has a sky that bets with her.',
    hint: 'Restore Stormpeaks, then wake the Wyrms.' },
  { id: 'wyrm-verdwyrm', category: 'wyrms', title: 'Verdwyrm, the Green Patience',
    text: 'The green-soul of the Verdant Wilds. It held a single seed of colour through a hundred grey years without complaint — it is extraordinarily good at waiting, which is a kind of strength Thornwick recognises on sight. Its breath is slow rot and fast bloom at once. Attunes to Thornwick; they plant this one together.',
    hint: 'Restore the Verdant Wilds, then wake the Wyrms.' },
  { id: 'wyrm-lumenwyrm', category: 'wyrms', title: 'Lumenwyrm, the Kept Dawn',
    text: 'The light-soul of Lumen Sanctum. It guttered but never went out — light that refused, gently, to give up. Its dawn-breath strips the grey off armour and inaction alike. Attunes to Seraphine, and foils darkly with Umbrawyrm: dawn and dusk, holding the line from opposite ends of the same day.',
    hint: 'Restore Lumen Sanctum, then wake the Wyrms.' },
  { id: 'wyrm-umbrawyrm', category: 'wyrms', title: 'Umbrawyrm, the Rested Colour',
    text: 'The shadow-soul of the Hollow — nearest of all six to the grey, and the living proof that shadow is not the grey\'s kin. Shadow is where colour goes to rest, and this Wyrm has been resting a very long, very patient while. Attunes to Nyx: the redemption pair, waking the last colour the Hollow King mistook for peace.',
    hint: 'Restore the Hollow, then wake the Wyrms.' },

  // ---- hero arcs (the second page — unlocked as the campaign resolves each) ----
  { id: 'arc-ember', category: 'heroes', title: 'Ashka — The Second Job of Fire',
    text: 'She held the forge-line against Kaelen and did not count the kills once. Afterward she stood in the rekindled hearth-light and let it warm her hands, which she has not done since the town that raised her went out. Fire\'s first job is destruction. She has finally been introduced to its second.',
    hint: 'See Ashka\'s story through Embervale.' },
  { id: 'arc-glacia', category: 'heroes', title: 'Lumi — Reading Blind',
    text: 'A future she had not foreseen came and went at the Glacier Courts, and she survived it by improvising like the rest of us. She has since begun leaving the last page of her visions unread — on purpose. "Foresight was a wall," she says. "I would rather have a window."',
    hint: 'See Lumi\'s story through Frostreach.' },
  { id: 'arc-zephyra', category: 'heroes', title: 'Galea — A Crew That Stays',
    text: 'Vorn offered her the only mercy he had left: never love another crew, and they can never vanish on you. She declined at the top of her considerable lungs. The company is her crew now, whether they enlisted or not, and she has stopped counting the days since anyone last disappeared.',
    hint: 'See Galea\'s story through Stormpeaks.' },
  { id: 'arc-sylvan', category: 'heroes', title: 'Thornwick — Different, Not Restored',
    text: 'What grows back in the Wilds is not what the grey took, and he has stopped mourning the difference. He carries an acorn now — from the tree he failed to save for three days — and he intends to plant it somewhere the Hollow King can watch it grow. "Regrowth isn\'t restoration," he says. "It\'s better. It\'s a second opinion."',
    hint: 'See Thornwick\'s story through the Verdant Wilds.' },
  { id: 'arc-aurelia', category: 'heroes', title: 'Seraphine — Failing Warmly',
    text: 'Her perfect record ended somewhere around the third realm, and the dawn came anyway. She discovered — to her formal astonishment — that she is more useful cracked than flawless. Nyx taught her this, mostly by accident, and Seraphine keeps meaning to thank her and losing her nerve.',
    hint: 'See Seraphine\'s story through the Dawnspire.' },
  { id: 'arc-vex', category: 'heroes', title: 'Nyx — Somebody Remembers',
    text: 'She said Vesper\'s true name in the dark and gave the Margins back a person. She still steals — old habits — but everything she takes now comes back with a note. In her coat, folded twice, is a laminated certificate that is not hers. She has never mentioned it. She never will.',
    hint: 'See Nyx\'s story through the Hollow.' },
  { id: 'arc-volt', category: 'heroes', title: 'Fizz — You Cannot Calibrate a Seed',
    text: 'Fizz once solved the Greying. Force-recoloured a whole village by arithmetic — and it came out soulless, colour with nobody home. A very small Morose, made in an afternoon. Fizz has retired the equation and become, instead, infrastructure: the one who keeps everyone else\'s feelings powered and running. Ninety-nine percent sure that\'s the better job.',
    hint: 'Reach the Stormpeaks.' },
  { id: 'arc-pyra', category: 'heroes', title: 'Bramble & Bloom — Two Fronts',
    text: 'They were made to fight on two fronts at once, the twins, and both fronts held — which is the first thing either has ever done without the other finishing it. They still share a sentence. They no longer share a spine. Bramble ended a thought alone the other day and Bloom applauded for a full minute.',
    hint: 'Reach the Verdant Wilds.' },

  // ---- world (unlocked by entering realms / play milestones) ----
  { id: 'world-greying', category: 'world', title: 'The Greying',
    text: 'It does not destroy. It anaesthetises. A greyed thing freezes mid-gesture, mid-want, mid-song — spared every hurt by being spared everything. Restoring a realm is not conquest. It is convincing the land to risk feeling again.',
    hint: 'Begin the journey.' },
  { id: 'world-maddervane', category: 'world', title: 'Maddervane, Last Keeper',
    text: 'An old painter-Keeper with one lantern and too many regrets. He calls every cadet "little brush" so he cannot play favourites. He sends children to fight his oldest friend because he cannot bear to. He knows exactly what that costs.',
    hint: 'Clear the first realm.' },
  { id: 'world-keepers', category: 'world', title: 'The Six Keepers',
    text: 'Each realm had a Keeper; each Keeper now serves the grey, wielding a beloved gift twisted inside out. They were not conquered. Each one, in a weak hour, was offered rest — and took it. They can be saved. Remember that when you face them.',
    hint: 'Reach the third realm.' },
  { id: 'world-brush', category: 'world', title: 'The Unfixed Brush',
    text: 'Every Chromancer\'s brush "fixes" to one colour young — one element, one feeling, for life. Yours never did. The Guild called it a defect and trained you anyway. It means you can channel all six. It means, structurally, you are exactly what Morose tried to be. The difference is the whole game: he held all six alone. You hold six friends.',
    hint: 'Field two heroes of different elements at once.' },
  { id: 'world-scars', category: 'world', title: 'Healing Scars',
    text: 'Colour returns to a freed realm, but not evenly — there are seams where the grey held longest, brighter at the edges like a mended bone. Maddervane calls them healing scars. "Healed is not the same as unmarked," he says. "Nobody worth loving is unmarked. Paint over nothing."',
    hint: 'Restore a realm to full colour.' },
  { id: 'world-bloom', category: 'world', title: 'The Colour Bloom',
    text: 'The instant a line holds and the last grey enemy falls, the drained world floods back to colour all at once, overshooting into something too bright before it settles. That overshoot is the point. A realm does not creep back to feeling. It gasps.',
    hint: 'Win a battle.' },

  // ---- the six realms (unlocked on first entry) ----
  { id: 'realm-emberwaste', category: 'realms', title: 'Embervale, the Cold Forge',
    text: 'Once the loudest realm in Aetheria — forge-song day and night, Kindlekeep\'s chimneys writing smoke-poems on the sky. The grey took it in one night and nobody smelled a thing. What remains is warm-coloured stone gone the temperature of a held breath, waiting for someone stubborn enough to say no on its behalf.',
    hint: 'Enter Embervale.' },
  { id: 'realm-frostreach', category: 'realms', title: 'Frostreach, the Stopped Aurora',
    text: 'They froze the aurora mid-ribbon; the Deep Ice keeps a record of every colour the sky ever was, and the grey turned that record into a mausoleum. Beautiful, silent, useless. Ice is meant to glitter, not apologise. This realm is one long argument with that idea.',
    hint: 'Enter Frostreach.' },
  { id: 'realm-stormpeaks', category: 'realms', title: 'Stormpeaks, the Dead Calm',
    text: 'A range that used to sing thunder to its climbers, now a sky with nothing left to say. The becalming here is the cruellest kind of quiet: not silence, but the absence of anyone deciding to speak. Give it back its weather and it remembers how to shout.',
    hint: 'Enter the Stormpeaks.' },
  { id: 'realm-verdant', category: 'realms', title: 'The Verdant Wilds, Holding Its Breath',
    text: 'The Wilds are not dead. Nothing in the Verdant ever fully dies — that is precisely the problem Wessa made of it. Everything grey here was green once, and the moss is very clear that it intends to be green again, on its own schedule, thank you. Help it exhale.',
    hint: 'Enter the Verdant Wilds.' },
  { id: 'realm-lumen', category: 'realms', title: 'The Dawnspire, Where Light Gave Up',
    text: 'The last lanterns of Aetheria gutter along the Gilded Aisle, and the terrible lesson of this realm is that even light can be talked out of shining. Grace here is a trap — a peace that stops the watch. The dawn is not a reward for stillness. It never was.',
    hint: 'Enter the Dawnspire.' },
  { id: 'realm-hollow', category: 'realms', title: 'The Hollow, Where He Sat Down',
    text: 'The Twilight Margins — the realm everyone had already written off as basically grey — and past it, the Hollow Throne, where the greatest Chromancer who ever lived sat down and refused to hurt. It is the quietest place in the world. It is not peaceful. There is a difference, and you have walked six realms to prove it.',
    hint: 'Enter the Hollow.' },
  { id: 'realm-companion-ember', category: 'realms', title: 'Companion: the Ember-Fox',
    text: 'The first thing to move in freed Embervale was a fox the colour of a banked coal, who trotted out of the reveal band, sat, and refused to leave. It is warm to the touch and follows Ashka in particular, who pretends not to notice and saves it the best of the rations. A realm that can spare you a pet has decided to have more than enough.',
    hint: 'Restore Embervale.' },
  { id: 'realm-landmark-frost', category: 'realms', title: 'Landmark: the Unfrozen Chime',
    text: 'Halfway up Frostreach hangs the Aurora Chime, a rack of ice-bells the grey stopped mid-peal. Free the realm and it finishes the note it was holding — one impossible chord, three years late, that Lumi says she foresaw and everyone else says made them cry. Both accounts can be true.',
    hint: 'Restore Frostreach.' },
  { id: 'realm-landmark-storm', category: 'realms', title: 'Landmark: the Weathervane of the Fleet',
    text: 'At the Stormpeaks\' summit stands the great iron weathervane of Vorn\'s drydocked fleet, rusted still in a dead calm for nineteen years. The morning the realm comes back it turns — a slow, protesting quarter-turn into a wind that finally arrived. Galea saluted it. She will deny this.',
    hint: 'Restore the Stormpeaks.' },
  { id: 'realm-landmark-verdant', category: 'realms', title: 'Landmark: the Three-Day Tree',
    text: 'The oldest tree in the Wilds — the one Thornwick held colour inside for three days before he lost it — still stands, grey and enormous, at the realm\'s heart. It does not come fully back. It comes back DIFFERENT: half its crown in new impossible colours, half still the silver of what it survived. A healing scar the size of a cathedral.',
    hint: 'Restore the Verdant Wilds.' },
  { id: 'realm-landmark-lumen', category: 'realms', title: 'Landmark: the Relit Aisle',
    text: 'The Gilded Aisle of the Dawnspire is a mile of lanterns, each dimmer than the last, ending in dark. Restored, they light in sequence from the far end back toward you — the darkest first, because that is where light is needed and least deserved and goes anyway. Seraphine watched the whole mile catch and said nothing, for once.',
    hint: 'Restore the Dawnspire.' },

  // ---- the fall (each Keeper's tragedy, paired with their redemption) ----
  { id: 'fall-kaelen', category: 'keepers', title: 'The Fall of Kaelen',
    text: 'Kindlekeep burned on his watch — a forge-fire he should have banked, that he was too proud or too tired to bank, that ate the town he was sworn to keep warm. He could not tell the difference anymore between warmth and the thing that took everything, so he chose neither. Ash, he decided, was the only honest colour. The grey agreed instantly. It always does.',
    hint: 'Redeem the Keeper of Embervale.' },
  { id: 'fall-maravelle', category: 'keepers', title: 'The Fall of Maravelle',
    text: 'She read further into the Deep Ice than anyone before her, and one day she read her own griefs, all of them, laid out to the end. So she stopped on the best morning she could find and froze the page. Not death — a bookmark, held forever. She meant to protect one perfect thing. She forgot that a river you stop is just a longer, colder grave.',
    hint: 'Redeem the Still Oracle.' },
  { id: 'fall-vorn', category: 'keepers', title: 'The Fall of Vorn',
    text: 'Nineteen years becalmed, watching his crew\'s colours go one by one while he asked a dead sky for wind that never came. Asking hurt. So he stopped, and turned the last of his storm inward to keep his ghost-fleet from rotting — a captain preserving a crew that was already gone rather than admit it. The grey calls that dignity. Galea calls it furling your sails in a harbour.',
    hint: 'Redeem the Becalmed Admiral.' },
  { id: 'fall-wessa', category: 'keepers', title: 'The Fall of Wessa',
    text: 'She loved the Wilds so fiercely she could not let one leaf of it die — and love without letting-go is just a very tender kind of stopping. Her preservative thorns held every living thing safe and still and slowly, quietly, meaningless. A pressed flower is not a garden. She knew. She held on anyway. That is the part that hurts.',
    hint: 'Redeem the Overgrown Keeper.' },
  { id: 'fall-aurelin', category: 'keepers', title: 'The Fall of Aurelin',
    text: 'The First Light never failed, and a thing that never fails eventually mistakes never-trying for never-failing. He preached a grace that asked nothing, risked nothing, and haloed his whole choir into a serene silence he called peace. The dawn kept coming without him. He had simply stopped being the reason it was worth watching.',
    hint: 'Redeem the High Cantor.' },
  { id: 'fall-vesper', category: 'keepers', title: 'The Fall of Vesper',
    text: 'The Margins were the realm everyone had already grieved while it was still alive — basically grey, they said, might as well be. When the whole world agrees you are already gone, it is a short walk to agreeing yourself. So Vesper became nobody, and wore everybody, because a borrowed self hurts less than an unremembered one. Nyx broke it with a single word: the name.',
    hint: 'Redeem the Margrave of Moths.' },

  // ---- the fallen Keepers (unlocked when each is redeemed, not killed) ----
  { id: 'keeper-kaelen', category: 'keepers', title: 'Kaelen, Keeper of Embervale',
    text: 'He kept Kindlekeep lit until the night it burned, and could not forgive himself for the difference between warmth and wildfire. So he greyed himself out of guilt and called the ash honest. Redeemed, he remembered that a forge is not an apology. "Ashka — I\'m sorry. I\'m LIT."',
    hint: 'Redeem the Keeper of Embervale.' },
  { id: 'keeper-maravelle', category: 'keepers', title: 'Maravelle, the Still Oracle',
    text: 'Lumi\'s own mentor, who taught her to read the Deep Ice, and then froze herself inside her happiest morning rather than read one more page of grief. Beautiful and useless, like everything the grey preserves. She was saved by remembering the ice was never meant to stop the river — only to remember it.',
    hint: 'Redeem the Still Oracle.' },
  { id: 'keeper-vorn', category: 'keepers', title: 'Admiral Vorn of the Stormfleet',
    text: 'Galea\'s rival, becalmed nineteen years, who stopped asking the wind to come back because asking is where the hurt lives. He reversed his own storm to heal his ghost-fleet instead of grieving it. Redeemed, he felt weather on his deck for the first time in two decades and wept in a way admirals are not supposed to.',
    hint: 'Redeem the Becalmed Admiral.' },
  { id: 'keeper-wessa', category: 'keepers', title: 'Wessa, the Overgrown',
    text: 'Thornwick\'s oldest friend, who could not bear to let anything in the Wilds die — so she wrapped it all in preservative thorns, and a garden where nothing dies is a garden where nothing grows. She opened her fists at the end. "Then let it all bloom and be brief." Growing means dying a little. She had forgotten the price, and chose to pay it again.',
    hint: 'Redeem the Overgrown Keeper.' },
  { id: 'keeper-aurelin', category: 'keepers', title: 'Aurelin, First Light of the Dawnspire',
    text: 'Seraphine\'s childhood idol, who mistook stillness for grace and haloed a whole realm into serene inaction. "Striving is just suffering with better posture," he told the child who worshipped him. She corrected him. The dawn, it turns out, does not wait to be deserved.',
    hint: 'Redeem the High Cantor.' },
  { id: 'keeper-vesper', category: 'keepers', title: 'Vesper of the Twilight Margins',
    text: 'The Margrave of Moths, Nyx\'s dark mirror, who became nobody by wearing everybody — because nobody remembers the Margins, so why keep a self? Nyx remembered. Said the name aloud: Vesper. "Somebody from the Margins remembers everybody." That was the whole cure. It always was.',
    hint: 'Redeem the Margrave of Moths.' },

  // ---- the Greyed (bestiary — unlocked when each kind is first felled) ----
  { id: 'enemy-runner', category: 'enemies', title: 'Runner',
    text: 'Someone who was in a hurry when the grey caught them, frozen mid-stride and set walking again toward your crystal on someone else\'s errand. They carry nothing and want nothing. That is the saddest thing about them. Free the realm and they finish whatever gesture the grey interrupted.',
    hint: 'Fell a Runner.' },
  { id: 'enemy-grunt', category: 'enemies', title: 'Grunt',
    text: 'The rank-and-file of the Greying: townsfolk, guildhands, gate-guards, hollowed to a uniform dull and pointed at the light. They march in step because step is easier than choice. Nothing personal in them. That is exactly the horror.',
    hint: 'Fell a Grunt.' },
  { id: 'enemy-brute', category: 'enemies', title: 'Brute',
    text: 'Grief that got big instead of quiet. The grey usually numbs; occasionally it calcifies, and what you get is a slab of stopped feeling that has to be broken to be freed. Hit it until the grey cracks. Under the crust there is always someone who used to laugh.',
    hint: 'Fell a Brute.' },
  { id: 'enemy-flyer', category: 'enemies', title: 'Flyer',
    text: 'Whatever the grey caught in the act of leaving — birds, kites, a captain\'s last signal-flare — kept aloft and aimed. They ignore the ground entirely, so must you: only sky-reaching towers touch them. A world stops looking up when it stops hoping. Make it look up.',
    hint: 'Fell a Flyer.' },
  { id: 'enemy-shielded', category: 'enemies', title: 'Bulwark',
    text: 'The ones who built a wall around the hurt and then forgot there was anything inside worth the wall. The shell must come down before the person can. Break the shield first; what\'s beneath is softer than it pretends, which is the point it spent so long denying.',
    hint: 'Fell a Bulwark.' },
  { id: 'enemy-healer', category: 'enemies', title: 'Mender',
    text: 'A cruel joke of the grey: someone who was kind in life, hollowed into a thing that keeps its neighbours numb — mending the others\' greyness so none of them can wake. Take the Mender first, or the whole cohort keeps sleeping on schedule. Even corrupted, it is still, technically, trying to help.',
    hint: 'Fell a Mender.' },
  { id: 'enemy-swarm', category: 'enemies', title: 'Sprite',
    text: 'Small joys, greyed in a cloud — fireflies, festival sparks, a child\'s handful of confetti caught mid-throw. Individually nothing; together they overrun a line by sheer forgotten number. The grey is thorough about the small things. It knows they add up.',
    hint: 'Fell a Sprite.' },
  { id: 'enemy-boss', category: 'enemies', title: 'The Hollow Titan',
    text: 'Not a person. Morose\'s engine — a mobile cathedral of stopped feeling that walks the last mile of the campaign, greying everything it passes as a matter of course. It does not hate you. It has no room left for hate, or anything. It is what "grey is peace" looks like when you build it a body.',
    hint: 'Face the Hollow Titan.' },

  // ---- Morose's tragedy, in scattered pieces (found on the road) ----
  { id: 'morose-1', category: 'morose', title: 'Fragment: The Sky-Painter',
    text: 'A page in a child\'s hand: "Today the greatest Chromancer painted the sky. He asked the town what blue it wanted. He held the ladder for the little ones to add clouds. He laughed the whole time." The signature is scratched out.',
    hint: 'Found somewhere on the road.' },
  { id: 'morose-2', category: 'morose', title: 'Fragment: The Keeper Wars',
    text: 'A field order, burnt at one corner: "Six colours, six armies, and every one of them right. He begged the Keepers to stop. Then he stopped begging and started holding." Six elements, one man. The margins are full of the same word: don\'t.',
    hint: 'Found somewhere on the road.' },
  { id: 'morose-3', category: 'morose', title: 'Fragment: The First Grey Morning',
    text: 'His own hand, steady and small: "The colours cancelled. The grief went quiet. I waited for it to come back and it did not. I have never slept so well. I think I have found peace. I will share it with everyone."',
    hint: 'Found somewhere on the road.' },
  { id: 'morose-4', category: 'morose', title: 'Fragment: The Word in the Margins',
    text: 'A field order recovered near Kindlekeep, the same word inked over and over down the side in a friend\'s hand: don\'t, don\'t, don\'t. On the back, smaller, later: "He didn\'t answer my last three letters. He used to answer before I finished writing them." Signed with a painter\'s mark — a single madder-red stroke.',
    hint: 'Found somewhere on the road.' },
  { id: 'morose-5', category: 'morose', title: 'Fragment: What Blue the Town Wanted',
    text: 'A page torn from a Kindlekeep record: the day the greatest Chromancer painted their sky, he did not simply paint it. He went door to door first and asked each house what blue it wanted, and painted a sky that was seven blues pretending to be one. Nobody in Aetheria has ever done that before or since. He held the ladder for the children.',
    hint: 'Found somewhere on the road.' },
  { id: 'morose-6', category: 'morose', title: 'Fragment: The Six Colours, All at Once',
    text: 'A Keeper-War dispatch: "He walked between the six armies unarmed and asked them, each, to stop. Six answers, every one certain, every one right, and none of them the same. So he stopped asking. He took a colour from each — took it INTO himself — meaning only to hold them apart until the shouting ended." The dispatch ends mid-sentence.',
    hint: 'Found somewhere on the road.' },
  { id: 'morose-7', category: 'morose', title: 'Fragment: Maddervane\'s Unsent Letter',
    text: 'Water-stained, never folded for posting: "Old friend. You are trying to feel everything for everyone so no one else has to, and it is going to cancel to nothing, and I cannot watch. I am going to teach a child to do what you did — but only ever one colour at a time, and never, ever alone. Forgive me for using them to reach you. — M."',
    hint: 'Found somewhere on the road.' },
  { id: 'morose-8', category: 'morose', title: 'Fragment: The Endearments',
    text: 'A cadet\'s frightened observation: "He does not shout. He condoles. He has a soft name for each of us tied to the exact thing that hurts — little cinder, poor becalmed captain, dawn-keeper. He speaks of us in the past tense while we are still standing. \'You WERE so bright.\' As if grieving us is a kindness he is doing us early."',
    hint: 'Found somewhere on the road.' },
  { id: 'morose-9', category: 'morose', title: 'Fragment: No One Came',
    text: 'Scratched into the stone of the Hollow Throne itself, low, where a seated man\'s hand would rest: "I held the line for everyone. When it was my turn to be held — no one came. That is not a complaint. It is the reason. If wanting always ends here, spare them the wanting. Spare them ALL of it." The last stroke gouges deep.',
    hint: 'Found near the Hollow Throne.' },
  { id: 'morose-10', category: 'morose', title: 'Fragment: Maddervane Still Sets Two Cups',
    text: 'The last page, in the mentor\'s hand, recent: "Every morning I set out two cups of the bitter red tea he liked. Every evening I pour one away. I am not senile, little brush. I am practising. When you bring him back to me — and you will — I do not want to fumble the ordinary things. Kindness is mostly rehearsal."',
    hint: 'Found somewhere on the road.' },

  // ---- the deeper canon (worldbuilding — earned through progress) ----
  { id: 'lore-chromancers', category: 'lore', title: 'On Chromancers',
    text: 'A Chromancer channels one of the six elements, and the six elements are only the six ways of feeling with your hands: Fire is wanting, Water is grieving, Storm is daring, Nature is enduring, Light is hoping, Shadow is resting. To paint the world is to make it feel. The Guild frowns on saying it that plainly. Fizz says it anyway.',
    hint: 'Clear the first realm.' },
  { id: 'lore-greying-how', category: 'lore', title: 'On How the Grey Spreads',
    text: 'It is not an army and it is not a weather. It is a decision, and decisions are contagious. One heart chooses numb over hurt, and the choice looks so restful that the next heart borrows it, and the next. The Greying advances at exactly the speed of despair, which is why colour returning even one node\'s length matters more than it should.',
    hint: 'Watch the Greying recede on the map.' },
  { id: 'lore-keeperwars', category: 'lore', title: 'On the Keeper Wars',
    text: 'Before the grey there was too much colour: six Keepers, six certainties, six armies each convinced its element was the true one. The Wars were not evil against good. They were right against right, which is worse, because nobody can end it by winning. Morose tried to end it by feeling all of it at once. That is the whole tragedy in one sentence.',
    hint: 'Reach the third realm.' },
  { id: 'lore-prism', category: 'lore', title: 'On the Prism',
    text: 'The Prism is the old Keeper-engine that split one white light into six living colours so the world could have feelings in the first place. Maddervane is its last keeper; Fizz once worked its maintenance corps. Run it backwards — pull all six colours into one point — and they cancel to nothing. Morose ran it backwards through himself.',
    hint: 'Reach the fifth realm.' },
  { id: 'lore-cancellation', category: 'lore', title: 'On Why Six Cancel to Grey',
    text: 'Any child with a paint-wheel knows it: mix every colour and you do not get every colour, you get a muddy nothing. The same is true of feeling everything at once with no one to share the load — it does not intensify, it cancels. Grief plus joy plus fear plus hope plus fury plus rest, all in one chest, alone, nets exactly zero. Peace, he called it. It was only arithmetic.',
    hint: 'Reach the Hollow.' },
  { id: 'lore-hold-hands', category: 'lore', title: 'On the Trick He Missed',
    text: 'Here is the thing the greatest Chromancer never worked out, that any cadet learns in week one: you are not supposed to hold all six colours. You are supposed to hold ONE, well, and stand close enough to five friends holding the others that together you make the white light without any of you cancelling. He held all six. He should have held hands.',
    hint: 'Reach the Hollow.' },
  { id: 'lore-companions', category: 'lore', title: 'On the Road-Companions',
    text: 'Each freed realm leaves behind one small creature that decides to follow you — an ember-fox, a frost-hare, a stormrel, whatever the reveal band coughs up when colour first returns. They fight nothing and carry nothing. They are proof, is all. A realm that can spare you a pet is a realm that has decided to have more than enough.',
    hint: 'Free a road-companion.' },
  { id: 'lore-maddervane-two', category: 'lore', title: 'On Sending a Child',
    text: 'The cruellest and kindest thing in this whole war is an old man who loves his oldest friend too much to fight him, and so trains a child to do it instead — not to kill him. To reach him. Maddervane knows exactly what that costs, and does it anyway, and sets out two cups of tea every morning against the day it works.',
    hint: 'Clear the first realm.' },
  { id: 'lore-redemption', category: 'lore', title: 'On Why We Do Not Kill Them',
    text: 'Every Keeper you face is somebody\'s mentor, rival, oldest friend — a person who chose numb over hurt in a weak hour, not a monster who chose evil. You do not defeat them. You out-argue the grey they surrendered to, and the winning move is always the same: remind them that the colour is still there, under the ash, and that someone is holding the other five so they need only pick up one. Killing would be so much easier. It would also be the grey\'s own logic, wearing your face.',
    hint: 'Redeem a fallen Keeper.' },
  { id: 'lore-elements-feel', category: 'lore', title: 'On the Wheel of Feeling',
    text: 'The element wheel that governs every tower and reaction is, if you squint, a map of the heart. Fire beats Nature the way wanting overruns endurance; Water quiets Fire the way grief cools a want; Storm and Light and Shadow each answer the next in turn. The "combat grid" is a love-and-loss chart the Guild is too dignified to label honestly. Detonate two feelings at once and you get a reaction. This is also true off the battlefield.',
    hint: 'Detonate an elemental reaction.' },
  { id: 'lore-two-cups', category: 'lore', title: 'On the Bitter Red Tea',
    text: 'Maddervane and Morose were apprenticed together under the old Prism-keepers, two boys who took their tea the same impossible way — steeped past bitter, a red so dark it read almost grey in the cup. A private joke: the only grey either of them ever liked. Maddervane still drinks it. He says it keeps the memory honest. He says a lot of things to keep from saying the one thing.',
    hint: 'Reach the Hollow.' },
  { id: 'world-guild', category: 'world', title: 'The Cadet\'s Guild',
    text: 'What is left of the old Chromancer orders, folded into one under-staffed school of last resort. They took you — unfixed brush and all — because a world running out of colour cannot afford to be picky, and because Maddervane insisted, and Maddervane does not insist about much anymore. You are Cadet, lowest rank, only rank they had left. It will have to do. It does.',
    hint: 'Begin the journey.' },
  { id: 'world-titan', category: 'world', title: 'The Hollow Titan',
    text: 'At the top of the world, guarding the Throne, walks the engine Morose built when hands were no longer enough to grey the world by touch — a slow cathedral of stopped feeling, greying by the acre. It is the closest thing this war has to a final wall. It is also the emptiest thing in it: a machine for doing on purpose what a broken heart does by accident.',
    hint: 'Reach the Hollow.' },
  { id: 'field-echo', category: 'field', title: 'On the Grey Echoes',
    text: 'Maddervane\'s note, unsteady: in the final approach you will fight ECHOES of the Keepers you already saved — grey memories of the fights, not the friends. Do not grieve them. The real ones are behind you, in colour, arguing about tea. An echo is just the grey trying to reuse a face you already rescued. Break it and keep climbing.',
    hint: 'Face a Keeper echo in the final approach.' },
  { id: 'field-morose-steal', category: 'field', title: 'On What He Takes',
    text: 'Fizz\'s marginalia: track it and Morose only ever steals your OPTIONS, never your board. He greys a tower to "rest" it, lifts a draft-choice so wanting can\'t hurt you — always the thing you might have wanted, never the thing you have. That is his whole thesis in one tell: he is not trying to beat you. He is trying to convince you that not-wanting is a gift. Decline it.',
    hint: 'Survive a Morose intrusion.' },
  { id: 'field-caravan', category: 'field', title: 'On the Caravan',
    text: 'The token that walks the map between battles is the exact squad you last fielded, on foot, in colour, in a greyed world — which is the whole picture in miniature. Watch who walks next to whom. Certain pairs have things to say only to each other, and only on the road. The Guild files this under "morale." Ashka and Lumi would prefer you did not read it aloud.',
    hint: 'Watch the caravan walk the road.' },
  { id: 'field-signature-two', category: 'field', title: 'On Growing a Signature',
    text: 'Maddervane\'s note: a hero seasoned past their third year wakes a signature no one else can copy — but the deeper trick is that signatures answer each other. Ashka\'s igniting fourth strike primes what Lumi\'s foreseen third then shatters; the twins\' refusal to hit once doubles every spark the others lay down. You are not stacking stats. You are teaching six people to finish each other\'s sentences.',
    hint: 'Field a seasoned hero of level 3 or higher.' },

  // ---- field notes (mechanics-flavour, unlocked by doing the thing) ----
  { id: 'field-reactions', category: 'field', title: 'On Elemental Reactions',
    text: 'Fizz\'s marginalia: two different elements on one target within the window and the sparks REMEMBER each other. Steam, shatter, flashover, wildfire… The Greying hates this. Feelings compounding is its opposite. Recommendation: compound feelings.',
    hint: 'Detonate an elemental reaction.' },
  { id: 'field-intrusion', category: 'field', title: 'On the Hollow King\'s Mercy',
    text: 'He does not attack. He condoles. Mid-battle he will reach in and grant a tower "rest", or take one of your choices away so wanting can\'t hurt you. It passes. Everything he does passes — that is the flaw in his peace.',
    hint: 'Survive a Morose intrusion.' },
  { id: 'field-signature', category: 'field', title: 'On Signatures',
    text: 'Maddervane\'s note: every brush leaves a stroke nobody else can make. A cadet\'s companions are the same — season one past their third year and their signature wakes: Ashka\'s fourth strike ignites, Lumi\'s third is already foreseen, the twins simply refuse to hit once. Learn each stroke. Build around it.',
    hint: 'Field a hero of level 3 or higher.' },
  { id: 'field-fusion', category: 'field', title: 'On Fusion',
    text: 'Maddervane\'s note, ink still wet: a master does not mix on the palette — a master mixes on the CANVAS. Two finished towers, side by side, colours that spark together… let one drink the other and you get a single brushstroke that argues with itself in two hues. The Hollow King painted this way once. It is how he made the sky.',
    hint: 'Forge a fusion tower from two adjacent max-tier towers.' },
  { id: 'field-resonance', category: 'field', title: 'On Resonance',
    text: 'Fizz\'s marginalia, underlined thrice: a seasoned hero standing among towers of their own colour makes the colour LOUDER — two towers hum, four sing. The towers hit harder, the hero hits harder, and the grey backs away from the noise. Recommendation: commit to a colour. Cowards diversify.',
    hint: 'Awaken an Element Resonance in battle.' },
  { id: 'field-terrain', category: 'field', title: 'On the Ground Itself',
    text: 'Maddervane\'s note: the board is not a neutral thing. Lava rewards fire and punishes standing still; high ground sees further; fog hides what the grey put there. A greyed realm forgets its own terrain has opinions. Read the tiles before you place. The map is a puzzle wearing a battlefield\'s clothes.',
    hint: 'Fight on a realm with special terrain.' },
  { id: 'field-drafts', category: 'field', title: 'On the Offered Powers',
    text: 'Every few waves the Prism offers you a choice of powers — the same seed, the same offers, for everyone, always. No luck, no paywall, just a fork in the road you can see coming. This is why Morose hates the draft enough to steal from it: a fair choice is the opposite of the grey, which offers you exactly one option and calls it peace.',
    hint: 'Pick a power from a draft.' },
  { id: 'field-heroes-line', category: 'field', title: 'On Fielding the Company',
    text: 'Maddervane\'s note: a tower holds a spot. A hero holds a GRUDGE. They deploy like towers but they walk, they cast, they bicker on the road, and they get better at being themselves the longer they live. Six of them, one colour each, standing close — that is the picture you are painting. It is also, not coincidentally, the picture that could have saved him.',
    hint: 'Field a hero in battle.' },
  { id: 'field-difficulty', category: 'field', title: 'On Choosing It Harder',
    text: 'Heroic, Iron, No-Hero, Spare: the challenge modes are not punishment, they are a way of asking the realm to take you seriously. A world coming back to feeling wants to be fought for, not condescended to. Turn one on when a realm has stopped costing you anything. It will remember how to cost.',
    hint: 'Clear a run on a challenge mode.' },
]

export function codexById(id: string): CodexEntry | undefined {
  return CODEX.find((e) => e.id === id)
}

// ============================================================================
//  UNLOCK WIRING — declarative milestone → codex-id maps. The ONE place that
//  decides what a realm entry / realm clear / Keeper redemption / enemy kill
//  fills into the Sketchbook. Callers (WorldMap, BattleScene) just hand us the
//  milestone; this keeps unlock logic out of the sim and out of the views.
// ============================================================================

/** Pages that fill in the FIRST time the squad enters each realm. */
export const CODEX_ON_REALM_ENTER: Record<string, string[]> = {
  emberwaste: ['realm-emberwaste', 'world-guild', 'world-bloom', 'field-terrain'],
  frostreach: ['realm-frostreach', 'lore-greying-how', 'field-drafts'],
  stormpeaks: ['realm-stormpeaks', 'arc-volt', 'lore-companions', 'field-heroes-line'],
  verdant: ['realm-verdant', 'arc-pyra', 'lore-elements-feel'],
  lumen: ['realm-lumen', 'field-difficulty'],
  hollow: ['realm-hollow', 'world-titan', 'field-echo', 'lore-two-cups'],
}

/** Pages that fill in when a realm is RESTORED (its Keeper finale cleared). */
export const CODEX_ON_REALM_CLEAR: Record<string, string[]> = {
  emberwaste: ['arc-ember', 'realm-companion-ember', 'world-scars', 'world-brush', 'lore-chromancers', 'lore-maddervane-two', 'field-caravan'],
  frostreach: ['arc-glacia', 'realm-landmark-frost', 'field-signature-two'],
  stormpeaks: ['arc-zephyra', 'realm-landmark-storm', 'lore-keeperwars'],
  verdant: ['arc-sylvan', 'realm-landmark-verdant'],
  lumen: ['arc-aurelia', 'realm-landmark-lumen', 'lore-prism'],
  hollow: ['arc-vex', 'lore-hold-hands', 'lore-cancellation', 'lore-redemption'],
}

/** Pages that fill in when a fallen Keeper is REDEEMED (not killed). */
export const CODEX_ON_KEEPER_REDEEM: Record<string, string[]> = {
  kaelen: ['keeper-kaelen', 'fall-kaelen'],
  maravelle: ['keeper-maravelle', 'fall-maravelle'],
  vorn: ['keeper-vorn', 'fall-vorn'],
  wessa: ['keeper-wessa', 'fall-wessa'],
  aurelin: ['keeper-aurelin', 'fall-aurelin'],
  vesper: ['keeper-vesper', 'fall-vesper'],
}

/** enemy kind → bestiary page (unlocked when the kind is first felled). */
const ENEMY_CODEX: Record<string, string> = {
  runner: 'enemy-runner', grunt: 'enemy-grunt', brute: 'enemy-brute', flyer: 'enemy-flyer',
  shielded: 'enemy-shielded', healer: 'enemy-healer', swarm: 'enemy-swarm', boss: 'enemy-boss',
}

/** Unlock a batch of ids; returns how many were NEWLY filled in (for a toast). */
export function unlockCodexBatch(ids: string[] | undefined): number {
  if (!ids) return 0
  let n = 0
  for (const id of ids) if (unlockCodex(id)) n++
  return n
}

/** Unlock the bestiary page for a felled enemy kind. Returns the entry if new. */
export function unlockEnemyCodex(kind: string): CodexEntry | null {
  const id = ENEMY_CODEX[kind]
  return id ? unlockCodex(id) : null
}

// ---- persistence (view-side, one key) ----
const CODEX_KEY = 'chromancer_codex_v1'

function readIds(): string[] {
  try {
    const raw = localStorage.getItem(CODEX_KEY)
    const arr = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

let unlocked = new Set<string>(readIds())
let freshCount = 0 // entries earned since the codex was last opened (badge)

function persist(): void {
  try {
    localStorage.setItem(CODEX_KEY, JSON.stringify([...unlocked]))
  } catch {
    // private mode — unlocks won't persist, gameplay unaffected
  }
}

/** Unlock an entry. Returns the entry if it was NEWLY unlocked (for a toast). */
export function unlockCodex(id: string): CodexEntry | null {
  if (unlocked.has(id)) return null
  const entry = codexById(id)
  if (!entry) return null
  unlocked.add(id)
  freshCount++
  persist()
  return entry
}

export function isCodexUnlocked(id: string): boolean {
  return unlocked.has(id)
}

export function codexUnlockedCount(): number {
  let n = 0
  for (const e of CODEX) if (unlocked.has(e.id)) n++
  return n
}

/** ids of Morose fragments still locked, in order (road discoveries draw these) */
export function lockedMoroseFragments(): string[] {
  return CODEX.filter((e) => e.category === 'morose' && !unlocked.has(e.id)).map((e) => e.id)
}

export function codexFreshCount(): number {
  return freshCount
}
export function clearCodexFresh(): void {
  freshCount = 0
}

// ============================================================================
//  REACTIONS DISCOVERED — the crown-jewel combo depth, made legible. Tracks
//  which of the nine elemental reactions the player has ever detonated. Its own
//  localStorage key (never in SaveData, like the codex above); the battle view
//  records a key each time a reaction fires and the codex surfaces the count.
// ============================================================================

import type { ReactionKey } from '../sim/reactions'

/** The nine reactions, in the order the codex lists them. */
export const REACTION_ORDER: ReactionKey[] = [
  'thermal', 'shatter', 'flashover', 'wildfire', 'overgrow', 'eclipse', 'conduct', 'blight', 'amplify',
]
export const REACTION_TOTAL = REACTION_ORDER.length

const REACTIONS_KEY = 'chromancer_reactions_v1'

function readReactions(): Set<string> {
  try {
    const raw = localStorage.getItem(REACTIONS_KEY)
    const arr = raw ? (JSON.parse(raw) as unknown) : []
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

let reactionsSeen = readReactions()

/** Record a detonated reaction. Returns true if it was NEWLY discovered. */
export function recordReaction(key: ReactionKey): boolean {
  if (reactionsSeen.has(key)) return false
  reactionsSeen.add(key)
  try {
    localStorage.setItem(REACTIONS_KEY, JSON.stringify([...reactionsSeen]))
  } catch {
    // private mode — discovery won't persist, gameplay unaffected
  }
  return true
}

export function isReactionDiscovered(key: ReactionKey): boolean {
  return reactionsSeen.has(key)
}

export function reactionsDiscoveredCount(): number {
  let n = 0
  for (const k of REACTION_ORDER) if (reactionsSeen.has(k)) n++
  return n
}
