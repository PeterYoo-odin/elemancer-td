// Equipped-cosmetic resolver for the VIEW layers (BattleView3D, BattleHud,
// FrontPage). Pure paint: everything here returns colors/CSS only. The sim
// never imports this file — skins cannot change gameplay by construction.

import { TOWERS, type TowerKind } from './towers'
import { economy } from './economy'
import { skuById } from './cosmetics'

export interface TowerPalette {
  color: number
  accent: number
  skinned: boolean
}

/** Equipped tower skin palette, or the tower's stock colors. */
export function towerPalette(kind: TowerKind): TowerPalette {
  const id = economy.equippedIn('tower:' + kind)
  const sku = id ? skuById(id) : undefined
  if (sku?.palette && economy.owns(sku.id)) return { ...sku.palette, skinned: true }
  const def = TOWERS[kind]
  return { color: def.color, accent: def.accent, skinned: false }
}

/** Equipped spell-VFX recolor for a spell key, else the given fallback. */
export function spellColor(key: string, fallback: number): number {
  const id = economy.equippedIn('spell:' + key)
  const sku = id ? skuById(id) : undefined
  if (sku?.spellColor !== undefined && economy.owns(sku.id)) return sku.spellColor
  return fallback
}

/** Equipped hero skin: 3D token tint + CSS filter for painted portraits. */
export function heroDye(heroId: string): { tint: number; css: string } | null {
  const id = economy.equippedIn('hero:' + heroId)
  const sku = id ? skuById(id) : undefined
  if (sku?.heroTint && economy.owns(sku.id)) return sku.heroTint
  return null
}

/** Equipped UI dye accent (CSS color) for menus/store, or null. */
export function uiDyeAccent(): string | null {
  const id = economy.equippedIn('dye')
  const sku = id ? skuById(id) : undefined
  return sku?.dyeAccent && economy.owns(sku.id) ? sku.dyeAccent : null
}

/** Equipped menu banner (CSS gradient + name), or null. */
export function menuBanner(): { css: string; name: string } | null {
  const id = economy.equippedIn('banner')
  const sku = id ? skuById(id) : undefined
  return sku?.bannerCss && economy.owns(sku.id) ? { css: sku.bannerCss, name: sku.name } : null
}

/** Gilded frame flourish equipped? (FrontPage wordmark ornament) */
export function hasFrame(): boolean {
  const id = economy.equippedIn('frame')
  return !!id && economy.owns(id)
}

/** Prestige title ('Archchromancer') if owned+equipped, else null. */
export function prestigeTitle(): string | null {
  const id = economy.equippedIn('title')
  const sku = id ? skuById(id) : undefined
  return sku && economy.owns(sku.id) ? sku.name : null
}
