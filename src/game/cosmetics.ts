// Store catalog + Prism Pass data. PURE DATA + pure functions — no save access
// (economy.ts owns the wallet; skins.ts resolves what is equipped for the views).
//
// THE CONSTITUTION (every SKU in this file obeys it, and the Fairness Ledger
// renders this file verbatim so players can audit it):
//   1. Ranked / Endless / daily-seed IGNORE every purchase. Ranked effect: NONE.
//   2. Spend buys cosmetics, casual convenience, or breadth — NEVER power.
//   3. No loot boxes, no gacha, no blind buys: every item lists exactly what
//      you get before you pay.
//   4. All gameplay content is earnable free (diamonds drip from play).
//   5. Convenience items are CASUAL ONLY and visibly disabled in Ranked.

import type { TowerKind } from './towers'

export type SkuKind =
  | 'towerSkin' // palette-swap tower skin (applies in ALL modes — it is only paint)
  | 'heroSkin' // hero portrait/token recolor
  | 'dye' // UI palette dye (menu/store accent recolor)
  | 'spellVfx' // spell VFX recolor
  | 'banner' // menu banner ribbon
  | 'frame' // wordmark/portrait frame flourish
  | 'convenience' // casual-only quality of life
  | 'prestige' // Archchromancer — status, 1/season, never re-sold

export type SkuCurrency = 'diamonds' | 'prisms'

export interface Sku {
  id: string
  kind: SkuKind
  name: string
  /** EXACTLY what you get — shown before purchase. No blind buys. */
  desc: string
  price: number
  currency: SkuCurrency
  /** equip slot ('tower:cannon', 'hero:ember', 'spell:meteor', 'dye', 'banner', 'frame', 'title') */
  slot?: string
  towerKind?: TowerKind
  palette?: { color: number; accent: number }
  heroTint?: { tint: number; css: string } // 3D token tint + CSS filter for portraits
  spellKey?: string
  spellColor?: number
  bannerCss?: string
  dyeAccent?: string // CSS color for UI dyes
  /** earn gate (status, not wallet): the save flag that must be true to buy */
  gate?: { levelClear: string; label: string }
  /** true → earned only from the Prism Pass, never sold on the shelf */
  passExclusive?: boolean
  /** true → granted by a growth promo (welcome bundle / referral), never sold */
  promoExclusive?: boolean
  /** shown on the card; convenience items always carry the casual-only tag */
  casualOnly?: boolean
}

// ---------------------------------------------------------------------------
// CATALOG
// ---------------------------------------------------------------------------

export const CATALOG: Sku[] = [
  // --- Tower skins (palette swaps; pure paint, applies everywhere) ---
  { id: 'ts-cannon-rose', kind: 'towerSkin', name: 'Rosequartz Cannon', desc: 'Cannon skin: rose-pink crystal palette on the cannon body, orb, range ring and shots.', price: 300, currency: 'diamonds', slot: 'tower:cannon', towerKind: 'cannon', palette: { color: 0xff7ab8, accent: 0x8a1f52 } },
  { id: 'ts-cannon-obsidian', kind: 'towerSkin', name: 'Obsidian Cannon', desc: 'Cannon skin: smoked-obsidian palette with ember-red edges.', price: 400, currency: 'diamonds', slot: 'tower:cannon', towerKind: 'cannon', palette: { color: 0xd8452f, accent: 0x2b0f0a } },
  { id: 'ts-frost-aurora', kind: 'towerSkin', name: 'Aurora Frost', desc: 'Frost skin: green-teal aurora palette on crystals, ring and frost shards.', price: 300, currency: 'diamonds', slot: 'tower:frost', towerKind: 'frost', palette: { color: 0x5cf0b8, accent: 0x0c6a4e } },
  { id: 'ts-frost-abyss', kind: 'towerSkin', name: 'Abyssal Frost', desc: 'Frost skin: deep indigo-violet glacier palette.', price: 400, currency: 'diamonds', slot: 'tower:frost', towerKind: 'frost', palette: { color: 0x8f7bff, accent: 0x2a1670 } },
  { id: 'ts-flame-viridian', kind: 'towerSkin', name: 'Viridian Fire', desc: 'Flame skin: emerald witch-fire palette on flames, burn glow and splash.', price: 300, currency: 'diamonds', slot: 'tower:flame', towerKind: 'flame', palette: { color: 0x4fe06a, accent: 0x0c5a22 } },
  { id: 'ts-flame-gold', kind: 'towerSkin', name: 'Emberwaste Gold', desc: 'Flame skin: molten-gold palette from the Emberwaste restoration.', price: 400, currency: 'diamonds', slot: 'tower:flame', towerKind: 'flame', palette: { color: 0xffc23c, accent: 0x7a4a00 } },
  { id: 'ts-storm-ion', kind: 'towerSkin', name: 'Ion Storm', desc: 'Storm skin: violet ion-lightning palette on bolts and chains.', price: 350, currency: 'diamonds', slot: 'tower:storm', towerKind: 'storm', palette: { color: 0xc470ff, accent: 0x4a1090 } },
  { id: 'ts-arcane-solar', kind: 'towerSkin', name: 'Solar Arcane', desc: 'Arcane skin: warm solar palette on the support beam, orb and buff links.', price: 350, currency: 'diamonds', slot: 'tower:arcane', towerKind: 'arcane', palette: { color: 0xffb054, accent: 0x8a4a08 } },
  // Redeemed-Keeper skin — GATED on beating that Keeper. Status, not wallet.
  { id: 'ts-arcane-vesper', kind: 'towerSkin', name: 'Vesper, Redeemed', desc: 'Legendary Arcane skin in Keeper Vesper’s moonlit silver-rose palette. Purchasable only after you free Vesper in the Hollow.', price: 1500, currency: 'diamonds', slot: 'tower:arcane', towerKind: 'arcane', palette: { color: 0xf2d9ff, accent: 0x6a3a8a }, gate: { levelClear: 'l6', label: 'Free Keeper Vesper (clear The Hollow) to unlock' } },

  // --- Hero skins (portrait + battle-token recolors) ---
  { id: 'hs-ember-solar', kind: 'heroSkin', name: 'Solarflare Ember', desc: 'Ember hero skin: sun-gold recolor of her portrait and battle token.', price: 400, currency: 'diamonds', slot: 'hero:ember', heroTint: { tint: 0xffd894, css: 'hue-rotate(18deg) saturate(1.35) brightness(1.08)' } },
  { id: 'hs-glacia-rose', kind: 'heroSkin', name: 'Rosefrost Glacia', desc: 'Glacia hero skin: rose-pink frost recolor of her portrait and battle token.', price: 400, currency: 'diamonds', slot: 'hero:glacia', heroTint: { tint: 0xffc0e8, css: 'hue-rotate(-75deg) saturate(1.2)' } },
  { id: 'hs-sylvan-gilt', kind: 'heroSkin', name: 'Gilded Sylvan', desc: 'Sylvan hero skin: autumn-gilt recolor of his portrait and battle token.', price: 400, currency: 'diamonds', slot: 'hero:sylvan', heroTint: { tint: 0xffe2a0, css: 'hue-rotate(-40deg) saturate(1.25) brightness(1.05)' } },

  // --- Spell VFX recolors ---
  { id: 'sv-meteor-azure', kind: 'spellVfx', name: 'Azure Comet', desc: 'Meteor VFX recolor: your meteor falls ice-blue. Damage unchanged.', price: 300, currency: 'diamonds', slot: 'spell:meteor', spellKey: 'meteor', spellColor: 0x6bb8ff },
  { id: 'sv-freeze-rose', kind: 'spellVfx', name: 'Rose Frost', desc: 'Freeze VFX recolor: the freeze blooms rose-pink. Duration unchanged.', price: 250, currency: 'diamonds', slot: 'spell:freeze', spellKey: 'freeze', spellColor: 0xff9ad6 },
  { id: 'sv-gold-emerald', kind: 'spellVfx', name: 'Emerald Boon', desc: 'Gold Rush VFX recolor: coins burst emerald-green. Gold gained unchanged.', price: 200, currency: 'diamonds', slot: 'spell:goldrush', spellKey: 'goldrush', spellColor: 0x59e08a },

  // --- UI dyes ---
  { id: 'dye-ember', kind: 'dye', name: 'Emberwaste Dye', desc: 'UI dye: tints the menu and store accents in Emberwaste orange.', price: 250, currency: 'diamonds', slot: 'dye', dyeAccent: '#ff8a4c' },
  { id: 'dye-verdant', kind: 'dye', name: 'Verdant Dye', desc: 'UI dye: tints the menu and store accents in Verdant green.', price: 250, currency: 'diamonds', slot: 'dye', dyeAccent: '#6fe08a' },
  { id: 'dye-prism', kind: 'dye', name: 'Prismatic Dye', desc: 'Event UI dye: iridescent prism accent for the menu and store. Prisms are earned by playing the season — never sold.', price: 25, currency: 'prisms', slot: 'dye', dyeAccent: '#b8f0ff' },

  // --- Banners & frames ---
  { id: 'bn-emberwaste', kind: 'banner', name: 'Emberwaste Banner', desc: 'Menu banner: the Emberwaste restoration ribbon under your title.', price: 150, currency: 'diamonds', slot: 'banner', bannerCss: 'linear-gradient(90deg, #3a1004, #ff8a4c 50%, #3a1004)' },
  { id: 'bn-frostreach', kind: 'banner', name: 'Frostreach Banner', desc: 'Menu banner: the Frostreach expedition ribbon under your title.', price: 150, currency: 'diamonds', slot: 'banner', bannerCss: 'linear-gradient(90deg, #061826, #7fe3ff 50%, #061826)' },
  { id: 'bn-restoration', kind: 'banner', name: 'Restorer’s Banner', desc: 'Event banner: proof you played Season 1. Bought with earned Prisms only.', price: 30, currency: 'prisms', slot: 'banner', bannerCss: 'linear-gradient(90deg, #2a1050, #ffd76a 30%, #ff8a4c 55%, #b06bff 80%, #2a1050)' },
  { id: 'fr-gilded', kind: 'frame', name: 'Gilded Frame', desc: 'Menu frame: gold flourish around the CHROMANCER wordmark.', price: 250, currency: 'diamonds', slot: 'frame' },

  // --- Convenience (CASUAL ONLY — visibly disabled in Ranked) ---
  { id: 'conv-idle2x', kind: 'convenience', name: '2× Idle Earnings', desc: 'Permanent: doubles offline coin earnings. Coins buy Workshop nodes for CASUAL runs only — Ranked ignores all of it.', price: 600, currency: 'diamonds', casualOnly: true },
  { id: 'conv-autocollect', kind: 'convenience', name: 'Auto-Collect', desc: 'Permanent: idle earnings bank themselves and the offline cap grows from 8h to 24h.', price: 300, currency: 'diamonds', casualOnly: true },
  { id: 'conv-slot2', kind: 'convenience', name: 'Loadout Slot 2', desc: 'A second saved hero loadout for casual play. Ranked ALWAYS uses Slot 1.', price: 200, currency: 'diamonds', casualOnly: true },
  { id: 'conv-slot3', kind: 'convenience', name: 'Loadout Slot 3', desc: 'A third saved hero loadout for casual play. Ranked ALWAYS uses Slot 1.', price: 200, currency: 'diamonds', casualOnly: true },

  // --- Prestige (1/season, never re-sold, pure status) ---
  { id: 'prestige-arch', kind: 'prestige', name: 'Archchromancer', desc: 'Season 1 prestige title with a gold name flourish on the menu. One per season. Never re-sold. Buys exactly zero power.', price: 5000, currency: 'diamonds', slot: 'title' },

  // --- Prism Pass exclusives (earned by PLAY on the pass; never on the shelf) ---
  { id: 'ts-cannon-restored', kind: 'towerSkin', name: 'Restored Cannon', desc: 'Free-track pass skin: warm terracotta restoration palette.', price: 0, currency: 'diamonds', slot: 'tower:cannon', towerKind: 'cannon', palette: { color: 0xff9a62, accent: 0x7a3010 }, passExclusive: true },
  { id: 'dye-emberheart', kind: 'dye', name: 'Emberheart Dye', desc: 'Premium pass dye: deep ember-rose UI accent.', price: 0, currency: 'diamonds', slot: 'dye', dyeAccent: '#ff6a7a', passExclusive: true },
  { id: 'ts-flame-emberlord', kind: 'towerSkin', name: 'Emberlord Flame', desc: 'Premium pass skin: white-hot coronal flame palette.', price: 0, currency: 'diamonds', slot: 'tower:flame', towerKind: 'flame', palette: { color: 0xfff0c0, accent: 0xc05a10 }, passExclusive: true },
  { id: 'sv-meteor-ember', kind: 'spellVfx', name: 'Emberfall Comet', desc: 'Premium pass VFX: your meteor falls in Emberwaste gold.', price: 0, currency: 'diamonds', slot: 'spell:meteor', spellKey: 'meteor', spellColor: 0xffc23c, passExclusive: true },
  { id: 'ts-storm-emberstorm', kind: 'towerSkin', name: 'Emberstorm', desc: 'Premium pass skin: storm bolts in burning orange.', price: 0, currency: 'diamonds', slot: 'tower:storm', towerKind: 'storm', palette: { color: 0xff9040, accent: 0x802e08 }, passExclusive: true },
  { id: 'hs-ember-emberlord', kind: 'heroSkin', name: 'Ember, Emberlord', desc: 'Premium pass finale: legendary molten-crown recolor of Ember’s portrait and token.', price: 0, currency: 'diamonds', slot: 'hero:ember', heroTint: { tint: 0xffb060, css: 'saturate(1.5) contrast(1.08) brightness(1.05)' }, passExclusive: true },

  // --- Growth promos (welcome bundle + referral; GRANTED never sold, cosmetic only) ---
  { id: 'ts-cannon-firstlight', kind: 'towerSkin', name: 'Firstlight Cannon', desc: 'Welcome starter skin: a dawn-gold “first light” palette on your Cannon. Exclusive to new Chromancers — never sold. Pure paint; Ranked ignores it.', price: 0, currency: 'diamonds', slot: 'tower:cannon', towerKind: 'cannon', palette: { color: 0xffd27a, accent: 0x9a5a10 }, promoExclusive: true },
  { id: 'dye-referred', kind: 'dye', name: 'Kindred Dye', desc: 'Referred-friend exclusive: a warm kindred-rose UI accent for players who arrived on a friend’s invite. Granted, never sold.', price: 0, currency: 'diamonds', slot: 'dye', dyeAccent: '#ff8fb0', promoExclusive: true },
  { id: 'frame-restorer', kind: 'frame', name: 'Restorer Frame', desc: 'Referral reward (3 friends): a woven-vine flourish around your CHROMANCER wordmark. Granted, never sold.', price: 0, currency: 'diamonds', slot: 'frame', promoExclusive: true },
  { id: 'ts-frost-referral', kind: 'towerSkin', name: 'Auric Frost', desc: 'Referral reward (5 friends): a gilded aurora palette on your Frost tower. Pure paint; granted, never sold.', price: 0, currency: 'diamonds', slot: 'tower:frost', towerKind: 'frost', palette: { color: 0xffe08a, accent: 0x7a5a10 }, promoExclusive: true },
  { id: 'dye-restorers-wall', kind: 'dye', name: 'Restorers-Wall Dye', desc: 'Referral reward (10 friends): a legendary iridescent UI dye + a Restorers-Wall credit. Granted, never sold.', price: 0, currency: 'diamonds', slot: 'dye', dyeAccent: '#c9a2ff', promoExclusive: true },
]

export function skuById(id: string): Sku | undefined {
  return CATALOG.find((s) => s.id === id)
}

/** Everything sold on the shelf (pass + promo exclusives are earned, not sold). */
export function shelfSkus(): Sku[] {
  return CATALOG.filter((s) => !s.passExclusive && !s.promoExclusive)
}

// ---------------------------------------------------------------------------
// Rotation shelf — deterministic by epoch day. Rotation, not extortion: what
// leaves always returns; nothing is "last chance".
// ---------------------------------------------------------------------------

const ROTATION_POOL = ['ts-cannon-rose', 'ts-frost-aurora', 'ts-flame-viridian', 'ts-storm-ion', 'ts-arcane-solar', 'hs-ember-solar', 'hs-glacia-rose', 'hs-sylvan-gilt', 'sv-meteor-azure', 'sv-freeze-rose', 'bn-emberwaste', 'bn-frostreach']

export function rotationFor(epochDay: number): Sku[] {
  // 3 featured items, shifting daily through the pool — provably a rotation.
  const out: Sku[] = []
  for (let i = 0; i < 3; i++) {
    const sku = skuById(ROTATION_POOL[(epochDay + i * 4) % ROTATION_POOL.length])
    if (sku) out.push(sku)
  }
  return out
}

// ---------------------------------------------------------------------------
// PRISM PASS — Season 1: "The Emberwaste Restoration".
// Advances by PLAY only (see the duties below). Premium = $4.99 (mock) or
// 500 diamonds (real, and diamonds are earnable free).
// ---------------------------------------------------------------------------

export const PASS_SEASON = 's1-emberwaste'
export const PASS_SEASON_NAME = 'S1 · THE EMBERWASTE RESTORATION'
export const PASS_TIERS = 30
export const PASS_TIER_XP = 40
export const PASS_PREMIUM_DIAMONDS = 500
export const PASS_PREMIUM_USD = '$4.99'

export interface PassReward {
  coins?: number
  diamonds?: number
  prisms?: number
  sku?: string
}

/** How pass XP is earned. PLAY ONLY — there is no way to buy XP or skip tiers. */
export const PASS_DUTIES = [
  'Clear any level: +12 XP',
  'Earn a NEW star: +6 XP each',
  'First clear of a level: +10 XP',
  'Endless (Ranked): +2 XP per wave reached (max 40 per run)',
]

function tierReward(tier: number, premium: boolean): PassReward {
  // tier is 1-based. Free track: ~200 diamonds + prisms + coins + a tower skin.
  if (!premium) {
    if (tier === 30) return { sku: 'ts-cannon-restored' }
    if (tier % 5 === 0) return { diamonds: 30 }
    if (tier % 3 === 0) return { prisms: 6 }
    return { coins: 120 + tier * 10 }
  }
  // Premium track: exclusives + ~300 diamond rebate + prisms.
  switch (tier) {
    case 5: return { sku: 'dye-emberheart' }
    case 10: return { sku: 'ts-flame-emberlord' }
    case 15: return { sku: 'sv-meteor-ember' }
    case 20: return { sku: 'ts-storm-emberstorm' }
    case 30: return { sku: 'hs-ember-emberlord' }
    case 8: case 16: case 24: return { diamonds: 100 }
    default: return tier % 2 === 0 ? { prisms: 4 } : { coins: 200 + tier * 12 }
  }
}

export interface PassTier {
  tier: number // 1..PASS_TIERS
  xpNeeded: number // cumulative XP to reach this tier
  free: PassReward
  premium: PassReward
}

export const PASS_TRACK: PassTier[] = Array.from({ length: PASS_TIERS }, (_, i) => ({
  tier: i + 1,
  xpNeeded: (i + 1) * PASS_TIER_XP,
  free: tierReward(i + 1, false),
  premium: tierReward(i + 1, true),
}))

export function passTierForXp(xp: number): number {
  return Math.min(PASS_TIERS, Math.floor(xp / PASS_TIER_XP))
}

// ---------------------------------------------------------------------------
// Real-money SKUs — ALL MOCK this build (nothing charges; Stripe/backend later).
// Listed here so the Fairness Ledger can show them with Ranked effect: NONE.
// ---------------------------------------------------------------------------

export interface DiamondPack {
  id: string
  usd: string
  diamonds: number
  best?: boolean
}

/** Web prices ~10% under app-store. First purchase is DOUBLED (no countdown). */
export const DIAMOND_PACKS: DiamondPack[] = [
  { id: 'pack-60', usd: '$1.99', diamonds: 60 },
  { id: 'pack-100', usd: '$2.99', diamonds: 100 },
  { id: 'pack-250', usd: '$5.99', diamonds: 250 },
  { id: 'pack-600', usd: '$12.99', diamonds: 600, best: true },
  { id: 'pack-1400', usd: '$24.99', diamonds: 1400 },
  { id: 'pack-3200', usd: '$49.99', diamonds: 3200 },
]

export const STARTER_KIT = {
  id: 'starter-kit',
  usd: '$2.99',
  name: 'Starter Chroma Kit',
  contents: ['150 \u{1F48E}', 'Rosequartz Cannon skin', 'Emberwaste Dye', '+25% coin boost for 7 days (casual only)'],
  note: 'Appears after World 1. No countdown — it will still be here tomorrow.',
}

export const PLUS_SUB = {
  id: 'chromancer-plus',
  usd: '$4.99 / mo',
  name: 'Chromancer Plus',
  perks: ['30 \u{1F48E} daily stipend', '2× idle earnings', 'Auto-collect', '+1 casual loadout slot', 'Monthly dye drop', 'Gold name flourish', 'Restorers Wall credit'],
  note: 'Plus never touches Ranked — it buys you time & style, and us servers.',
}

/** Rewarded ads — opt-in, gift-framed, CASUAL ONLY, zero in Ranked. All mock. */
export const REWARDED_ADS = [
  { id: 'ad-revive', name: 'Second Wind', desc: 'Watch an ad to revive once in a CASUAL run.', icon: '❤️' },
  { id: 'ad-coins2x', name: 'Double Coins', desc: 'Watch an ad to double end-of-battle coins (casual).', icon: '\u{1FA99}' },
  { id: 'ad-skipidle', name: 'Skip Ahead', desc: 'Watch an ad to instantly collect 2h of idle coins.', icon: '⏩' },
]

/** Rotating post-purchase thank-you lines (the color-bloom overlay). */
export const THANKYOU_LINES = [
  'This bought zero power. It buys us servers. Thank you.',
  'Morose grumbles: “More colour. Wonderful.”',
  'The leaderboard didn’t notice. The world got prettier. Thank you.',
  'Every diamond here keeps Ranked pure. Genuinely: thank you.',
]

/** Founding Restorers Wall — stub until accounts land (S6). */
export const RESTORERS_WALL_STUB = ['✦ The first restorers will be named here ✦', 'Your name joins the Wall with any purchase — belonging, not power.']
