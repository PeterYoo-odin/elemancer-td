// ============================================================================
//  CODEX — "The Cadet's Sketchbook". Lore fragments earned through play.
//  Data model + persistence for the full ~90-entry book; this slice seeds ~15
//  entries (heroes, realms, field notes, and the first scattered pieces of
//  Morose's tragedy). Unlocks live in their own localStorage key — never in
//  SaveData — so the save schema stays untouched.
// ============================================================================

export type CodexCategory = 'heroes' | 'world' | 'morose' | 'field'

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
  world: 'Aetheria',
  morose: 'The Hollow King',
  field: 'Field Notes',
}

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
]

export function codexById(id: string): CodexEntry | undefined {
  return CODEX.find((e) => e.id === id)
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
