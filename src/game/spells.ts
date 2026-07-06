// Active spell table. Tapped from the HUD on cooldown; BattleScene renders the
// cooldown ring and the (juicy) effect. `spellPowerMult`/`spellCooldownMult` from
// the workshop scale damage/gold and recharge time — but only in campaign; endless
// gets NEUTRAL modifiers so purchases never touch ranked balance.

export type SpellKey = 'meteor' | 'freeze' | 'goldrush'

export interface SpellDef {
  key: SpellKey
  name: string
  blurb: string
  color: number
  cooldown: number // seconds
  targeted: boolean // meteor: tap a spot on the map to aim
  // meteor
  damage?: number // centre damage (scaled by spell power)
  radius?: number // tiles
  burnDps?: number
  burnDuration?: number
  // freeze
  stunDuration?: number // seconds all enemies are frozen
  // goldrush
  gold?: number // instant battle-gold
}

export const SPELLS: Record<SpellKey, SpellDef> = {
  meteor: {
    key: 'meteor',
    name: 'Meteor',
    blurb: 'Tap an area · fiery AoE burst',
    color: 0xff7a3c,
    cooldown: 14,
    targeted: true,
    damage: 160,
    radius: 2.4,
    burnDps: 40,
    burnDuration: 3,
  },
  freeze: {
    key: 'freeze',
    name: 'Freeze',
    blurb: 'Stun every enemy briefly',
    color: 0x6bd6ff,
    cooldown: 18,
    targeted: false,
    stunDuration: 2.2,
  },
  goldrush: {
    key: 'goldrush',
    name: 'Gold Rush',
    blurb: 'Instant battle-gold',
    color: 0xffd54a,
    cooldown: 22,
    targeted: false,
    gold: 140,
  },
}

export const SPELL_ORDER: SpellKey[] = ['meteor', 'freeze', 'goldrush']
