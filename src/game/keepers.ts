// ============================================================================
//  THE SIX CORRUPTED KEEPERS — realm bosses. Canon: chromancer-narrative-bible.
//  Each Keeper is a FALLEN hero-counterpart wielding a TWISTED version of one
//  hero's signature mechanic; beating them is a REDEMPTION (re-colouring), not
//  a kill. Pure data + pure helpers — the sim drives the fight (deterministic,
//  zero RNG: telegraphed casts on a fixed clock, phase thresholds on HP).
//
//  l1-l5 host their realm's Keeper as the finale wave. l6 is the FINAL GAUNTLET:
//  Vesper (the 6th Keeper) guards the gate, grey ECHOES of the five redeemed
//  Keepers walk again, and Morose's Titan engine closes the campaign.
// ============================================================================

import type { Element } from '../sim/combat'
import type { EnemyDef } from './enemies'

/** The twisted-mechanic verbs the sim implements. Each corrupts ONE hero kit. */
export type KeeperAbility =
  | 'ashenSnuff'  // Kaelen ⇄ Ashka's Cindernova: snuffs every burn/aura nearby
  | 'stillGrace'  // Maravelle ⇄ Lumi's Foreseen: freezes a tower "in its happiest instant"
  | 'becalm'      // Vorn ⇄ Galea's Squall: the chain runs BACKWARDS — grey rigging heals his fleet
  | 'thornCocoon' // Wessa ⇄ Thornwick's Deeproots: preservative thorns shield her brood
  | 'gildedHalo'  // Aurelin ⇄ Seraphine's Blessing: pacifying grace haloes towers into inaction
  | 'mothMirror'  // Vesper ⇄ Nyx's identity theft: borrows one of YOUR heroes for a while

export interface KeeperDef {
  id: string
  levelId: string      // campaign level whose finale this Keeper is
  /** corrupted title — the boss bar name */
  name: string
  /** redeemed name — the banner after the grey breaks */
  trueName: string
  element: Element
  /** the hero whose mechanic is twisted (hero id — barks + counter-line) */
  heroId: string
  ability: KeeperAbility
  abilityName: string  // telegraph callout
  /** one-line "how to read this fight" — surfaced in telegraph tooltip/codex */
  twist: string
  castEvery: number    // seconds between casts (phase 1; phases quicken this)
  telegraph: number    // seconds of visible warning before a cast lands
  /** ability tuning (interpretation per ability; all deterministic + clamped) */
  power: number        // snuff/halo radius in tiles · heal/shield fraction · grey seconds
  greySeconds: number  // how long a greyed tower/hero sleeps (grey-type casts)
  enemy: EnemyDef      // full stat block (kind 'keeper', boss: true)
  barks: {
    reveal: string     // the Keeper speaks as it takes the field
    heroLine: string   // the twisted hero answers (if fielded / in party)
    phase2: string     // the grey cracks
    phase3: string     // almost free
    redeemed: string   // the colour returns
    morose: string     // Morose's thread stinger, a beat after redemption
  }
}

const keeperEnemy = (o: Partial<EnemyDef> & Pick<EnemyDef, 'name' | 'hp' | 'color' | 'accent' | 'reward' | 'armor'>): EnemyDef => ({
  kind: 'keeper',
  speed: 0.52,
  radius: 34,
  shape: 'hex',
  flatArmor: 2,
  boss: true,
  ...o,
})

export const KEEPERS: KeeperDef[] = [
  {
    id: 'kaelen',
    levelId: 'l1',
    name: 'KAELEN, THE ASHEN COURT',
    trueName: 'Kaelen, Keeper of Embervale',
    element: 'Fire',
    heroId: 'ember',
    ability: 'ashenSnuff',
    abilityName: 'ASHEN SNUFF',
    twist: "Ashka's Cindernova, inverted: his pulse SNUFFS every burn, poison and primed aura around him. Burst him down between pulses.",
    castEvery: 9,
    telegraph: 2.0,
    power: 2.8, // snuff radius in tiles
    greySeconds: 0,
    enemy: keeperEnemy({ name: 'Kaelen, the Ashen Court', hp: 640, speed: 0.5, color: 0x9c8f8f, accent: 0xff8a4c, reward: 90, armor: 'Light', flatArmor: 1, affinity: 'Fire' }),
    barks: {
      reveal: 'Kindlekeep burned because I kept it lit. Ash is the only honest colour.',
      heroLine: 'Kaelen. You taught me "stay lit." Say it back. SAY IT BACK.',
      phase2: 'Why does it still glow… under the ash…',
      phase3: 'It\'s warm. Stop. STOP. …don\'t stop.',
      redeemed: 'The forge… remembers me. Ashka — I\'m sorry. I\'m LIT.',
      morose: 'One ember rekindled. How exhausting for it. The grey will wait.',
    },
  },
  {
    id: 'maravelle',
    levelId: 'l2',
    name: 'MARAVELLE, THE STILL ORACLE',
    trueName: 'Maravelle, Keeper of the Glacier Courts',
    element: 'Water',
    heroId: 'glacia',
    ability: 'stillGrace',
    abilityName: 'STILL GRACE',
    twist: "Lumi's Foreseen, frozen solid: she seals your proudest tower in 'its happiest instant' — beautiful, useless. Spread your damage; don't lean on one tower.",
    castEvery: 11,
    telegraph: 2.2,
    power: 1, // towers frozen per cast
    greySeconds: 4.5,
    enemy: keeperEnemy({ name: 'Maravelle, the Still Oracle', hp: 980, speed: 0.48, color: 0xbcd4de, accent: 0x7fe3ff, reward: 105, armor: 'Fortified', shield: 220, shieldBlock: 0.5, affinity: 'Water' }),
    barks: {
      reveal: 'Little Lumi\'s new friend. I froze my happiest morning and I live there now.',
      heroLine: 'Mentor. You taught me to read the ice. This page is WRONG.',
      phase2: 'The morning is… melting…',
      phase3: 'I foresaw this. I hoped I misread. I never misread.',
      redeemed: 'Oh. The ice was never meant to stop the river. Lumi — read on without me. No. WITH me.',
      morose: 'She chose the moving water. It will hurt her, you know. Moving always does.',
    },
  },
  {
    id: 'vorn',
    levelId: 'l3',
    name: 'ADMIRAL VORN, THE BECALMED',
    trueName: 'Admiral Vorn of the Stormfleet',
    element: 'Storm',
    heroId: 'zephyra',
    ability: 'becalm',
    abilityName: 'GREY RIGGING',
    twist: "Galea's chain squall, reversed: his grey rigging arcs through his own fleet and HEALS it. Kill his escorts first, or focus him before the rigging links.",
    castEvery: 8,
    telegraph: 1.8,
    power: 0.08, // heal fraction of maxHp per linked ally
    greySeconds: 0,
    enemy: keeperEnemy({ name: 'Admiral Vorn, the Becalmed', hp: 1280, speed: 0.55, color: 0x8fa3a8, accent: 0xffd95c, reward: 120, armor: 'Light', flatArmor: 2, affinity: 'Storm' }),
    barks: {
      reveal: 'Stormwright\'s protégé. I waited nineteen years for wind. It never came. So I stopped the asking.',
      heroLine: 'VORN! The wind doesn\'t come back for ships that furl their sails! HOIST!',
      phase2: 'The rigging… hums. It has not hummed since…',
      phase3: 'Is that… weather? On MY deck?',
      redeemed: 'WIND. Galea — you insufferable, magnificent gale — the fleet sails at dawn!',
      morose: 'A sail full of wanting. It will tear, poor captain. Sails always tear.',
    },
  },
  {
    id: 'wessa',
    levelId: 'l4',
    name: 'WESSA, THE OVERGROWN',
    trueName: 'Wessa, Keeper of the Deeproot Wilds',
    element: 'Nature',
    heroId: 'sylvan',
    ability: 'thornCocoon',
    abilityName: 'THORN COCOON',
    twist: "Thornwick's Deeproots, smothering: she wraps her brood in preservative thorn-shields — nothing may die, so nothing may live. Bring shield-breakers and siege.",
    castEvery: 10,
    telegraph: 2.0,
    power: 0.14, // shield fraction of each ally's maxHp per cast
    greySeconds: 0,
    enemy: keeperEnemy({ name: 'Wessa, the Overgrown', hp: 1580, speed: 0.46, color: 0x9aa88f, accent: 0x6fe08a, reward: 135, armor: 'Heavy', flatArmor: 3, affinity: 'Nature' }),
    barks: {
      reveal: 'Thornwick sent a gardener. I preserved EVERYTHING, old friend. Nothing I hold will ever die again.',
      heroLine: 'Wessa. A pressed flower isn\'t a garden. The moss votes we let things GROW. So do I.',
      phase2: 'The cocoons… they\'re cracking from INSIDE…',
      phase3: 'Growing means dying a little. I had… forgotten the price.',
      redeemed: 'Then let it all bloom and be brief. Thornwick — the Wilds are BREATHING.',
      morose: 'She opened her fists. Everything she holds will wilt now. I did warn her.',
    },
  },
  {
    id: 'aurelin',
    levelId: 'l5',
    name: 'HIGH CANTOR AURELIN',
    trueName: 'Aurelin, First Light of the Dawnspire',
    element: 'Light',
    heroId: 'aurelia',
    ability: 'gildedHalo',
    abilityName: 'PACIFYING GRACE',
    twist: "Seraphine's blessing, gone soft: his grace haloes your two strongest towers into serene inaction. Keep backup damage wide — grace can't pacify everyone.",
    castEvery: 9.5,
    telegraph: 2.2,
    power: 2, // towers haloed per cast
    greySeconds: 3.6,
    enemy: keeperEnemy({ name: 'High Cantor Aurelin', hp: 1950, speed: 0.5, color: 0xcfc4a2, accent: 0xffe27a, reward: 150, armor: 'Warded', shield: 320, shieldBlock: 0.45, affinity: 'Light' }),
    barks: {
      reveal: 'Seraphine\'s little vigil. Child, striving is just suffering with better posture. Be at peace.',
      heroLine: 'High Cantor. You pinned my first commendation. Peace that stops the WATCH is not peace. The line HOLDS.',
      phase2: 'The hymn falters… who changed the KEY?',
      phase3: 'Dawn is… not a reward for stillness, is it. It never was.',
      redeemed: 'The dawn does not wait to be deserved. Seraphine — sing the loud verse. ALL forty.',
      morose: 'Even the choir turns on me. Sing, then. The grey has excellent acoustics.',
    },
  },
  {
    id: 'vesper',
    levelId: 'l6',
    name: 'VESPER, MARGRAVE OF MOTHS',
    trueName: 'Vesper of the Twilight Margins',
    element: 'Dark',
    heroId: 'vex',
    ability: 'mothMirror',
    abilityName: 'MOTH MIRROR',
    twist: "Nyx's own trick, hollowed: the Margrave BORROWS one of your fielded heroes — greyed, absent, gone for a breath. The rest of the line must hold without them.",
    castEvery: 10,
    telegraph: 2.4,
    power: 1,
    greySeconds: 5,
    enemy: keeperEnemy({ name: 'Vesper, Margrave of Moths', hp: 2150, speed: 0.5, color: 0x8f86a8, accent: 0xb06bff, reward: 170, armor: 'Warded', shield: 260, shieldBlock: 0.5, affinity: 'Dark' }),
    barks: {
      reveal: 'Nobody remembers the Margins. So I became nobody, wearing everybody. Which of yours shall I be?',
      heroLine: 'I remember you. VESPER. Somebody from the Margins remembers EVERYBODY.',
      phase2: 'That name. Nobody has said that name in—',
      phase3: 'Stop LOOKING at me like I\'m someone. …like I\'m me.',
      redeemed: 'Vesper. I had a name. Nyx — you terrible little thief. You stole me BACK.',
      morose: 'So the moths fly home. Come then, little brush. It is only me now. It was always only me.',
    },
  },
]

export const KEEPER_BY_ID: Record<string, KeeperDef> = Object.fromEntries(KEEPERS.map((k) => [k.id, k]))

/** The realm Keeper whose finale lives on this level (undefined for demo/endless). */
export function keeperForLevel(levelId: string): KeeperDef | undefined {
  return KEEPERS.find((k) => k.levelId === levelId)
}

// ---- phases ----------------------------------------------------------------
// Every full Keeper fights in 3 phases on HP thresholds; each phase casts
// faster, phase 3 also strides faster. Echoes (final-gauntlet ghosts) stay in
// phase 1 and cast slower — a memory of the fight, not the fight itself.
export const KEEPER_PHASES = 3
export const PHASE2_AT = 0.66
export const PHASE3_AT = 0.33
export const PHASE_CAST_MULT = [1, 0.78, 0.58] // castEvery × this, per phase (index phase-1)
export const PHASE3_SPEED = 1.14
export const ECHO_CAST_MULT = 1.6
export const ECHO_HP_MULT = 0.42

export function keeperPhaseFor(hpFrac: number): number {
  return hpFrac <= PHASE3_AT ? 3 : hpFrac <= PHASE2_AT ? 2 : 1
}
