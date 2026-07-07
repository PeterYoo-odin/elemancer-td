// ICONS — the one cohesive inline-SVG icon system that replaces the emoji glyphs
// used as UI iconography across the DOM overlays (FrontPage / Store / Workshop /
// HeroCollection / WorldMap / BattleHud / Codex). Every emoji rendered as an
// interface icon — the 6+1 elements, the currencies, stat rows, status effects,
// reaction types and the per-hero ability marks — resolves to a glyph here so it
// renders IDENTICALLY on every OS (the old emoji were the "prototype" tell).
//
// Design: a single 24×24 viewBox, filled silhouettes drawn in `currentColor` so
// each icon tints from CSS `color:` (gold by default, element/reaction hues where
// asked). Pure strings — no runtime, no dependency, crisp at any size. Anything
// used as a *pictogram inside text* (barks, tokens) can call `iconMarkup()`; the
// element-tinted helpers below cover the common cases.

export type IconName =
  // elements (the wheel + the Arcane wildcard)
  | 'fire' | 'water' | 'nature' | 'storm' | 'light' | 'dark' | 'arcane'
  // currencies
  | 'coin' | 'diamond' | 'prism' | 'star' | 'shard'
  // stat rows
  | 'damage' | 'attackSpeed' | 'range' | 'health' | 'armor' | 'crit'
  // status effects / reaction verbs
  | 'burn' | 'freeze' | 'stun' | 'poison' | 'root' | 'shield' | 'heal' | 'mark' | 'chain'
  // generic ability marks (per-hero spell/signature glyphs map onto these)
  | 'spell' | 'signature' | 'burst' | 'comet' | 'eye' | 'gear' | 'dice' | 'twin'
  | 'moon' | 'skull' | 'sparkle' | 'sprout' | 'tree' | 'blade' | 'book' | 'lock'
  | 'pencil' | 'link' | 'target' | 'brush' | 'flask'
  // store swatch fallbacks (item kinds)
  | 'frame' | 'crown' | 'hourglass' | 'magnet' | 'bag' | 'mask'
  | 'chat' | 'gift' | 'hand' | 'warn' | 'atom'

// Inner SVG markup per icon (a 24×24 viewBox). Filled silhouettes read cleanly
// down to ~14px; stroke details use the same `currentColor`.
const PATHS: Record<IconName, string> = {
  // ---- elements ----------------------------------------------------------
  fire: '<path d="M13.4 2.2c.5 2.6-.6 4-1.9 5.4-1.4 1.5-3 3-3 5.9a5.5 5.5 0 0 0 11 .3c0-2-1-3.6-1.8-4.7-.4.9-1 1.5-1.9 1.7.7-2.7-.4-6.4-2.4-8.6Z"/>',
  water: '<path d="M12 2.5c3.4 4.2 6 7.4 6 10.8a6 6 0 0 1-12 0C6 9.9 8.6 6.7 12 2.5Z"/>',
  nature: '<path d="M20 3.5c0 7-3.8 11.5-9.2 11.9L12 12l-3.2 2.1C6.4 12.4 6 8.7 9 6.1 11.7 3.8 16 3.9 20 3.5ZM5 21c1.2-3.6 2.6-5.6 4.8-7"/><path d="M5 21c1.2-3.6 2.6-5.6 4.8-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  storm: '<path d="M13 2 4 13.5h6L9 22l9-12.5h-6L13 2Z"/>',
  light: '<circle cx="12" cy="12" r="4.4"/><g stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M12 2.4v2.8M12 18.8v2.8M2.4 12h2.8M18.8 12h2.8M5.2 5.2l2 2M16.8 16.8l2 2M18.8 5.2l-2 2M7.2 16.8l-2 2"/></g>',
  dark: '<path d="M15.5 3A9 9 0 1 0 21 14.2 7.2 7.2 0 0 1 15.5 3Z"/>',
  arcane: '<path d="M9 2.5h6v1.6l-.1 4.2 4.4 8.1A3 3 0 0 1 16.6 21H7.4a3 3 0 0 1-2.7-4.6l4.4-8.1L9 4.1Z"/><path d="M8.2 14.5h7.6" fill="none" stroke="#1a0f30" stroke-width="1.6"/>',

  // ---- currencies --------------------------------------------------------
  coin: '<circle cx="12" cy="12" r="9.2"/><circle cx="12" cy="12" r="6.4" fill="none" stroke="#7a5600" stroke-width="1.4" opacity=".55"/><path d="M12 7.4l1.3 2.7 3 .4-2.2 2.1.5 3-2.6-1.4-2.6 1.4.5-3-2.2-2.1 3-.4Z" fill="#7a5600" opacity=".55"/>',
  diamond: '<path d="M6 3h12l3.2 5.1L12 21.5 2.8 8.1Z"/><path d="M6 3 8.6 8.1h6.8L18 3M2.8 8.1h18.4M8.6 8.1 12 21.5l3.4-13.4" fill="none" stroke="#0a2733" stroke-width="1.1" opacity=".5"/>',
  prism: '<path d="M12 2.5 22 20H2Z"/><path d="M12 2.5V20M12 20l-4.6-9M12 20l4.6-9" fill="none" stroke="#2a1246" stroke-width="1.2" opacity=".55"/>',
  star: '<path d="M12 2.2l2.7 5.9 6.4.7-4.8 4.3 1.3 6.3L12 20.1 6.2 19.4l1.3-6.3-4.8-4.3 6.4-.7Z"/>',
  shard: '<path d="M13.5 2 20 11l-6 11-2-8-5-4Z"/><path d="M13.5 2 12 14l-5-4" fill="none" stroke="#0a2733" stroke-width="1.1" opacity=".5"/>',

  // ---- stat rows (line style, still one colour) --------------------------
  damage: '<path d="M4 3.5h4l11.5 11.5-4 4L4 7.5Z"/><path d="M14.5 14 21 20.5l-2 2L12.5 16" fill="currentColor"/>',
  attackSpeed: '<circle cx="12" cy="13" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 8.5V13l3 2M9 2.5h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  range: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="1.4"/>',
  health: '<path d="M12 20.5 4.2 12.8a4.7 4.7 0 0 1 6.6-6.7l1.2 1.1 1.2-1.1a4.7 4.7 0 0 1 6.6 6.7Z"/>',
  armor: '<path d="M12 2.4 20 5v6.2c0 5-3.4 8.6-8 10.4-4.6-1.8-8-5.4-8-10.4V5Z"/>',
  crit: '<path d="M12 2l1.9 6.1H20l-5 3.8 1.9 6.1L12 14.2 6.1 18l1.9-6.1-5-3.8h6.1Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',

  // ---- status effects / reaction verbs -----------------------------------
  burn: '<path d="M13.4 2.2c.5 2.6-.6 4-1.9 5.4-1.4 1.5-3 3-3 5.9a5.5 5.5 0 0 0 11 .3c0-2-1-3.6-1.8-4.7-.4.9-1 1.5-1.9 1.7.7-2.7-.4-6.4-2.4-8.6Z"/>',
  freeze: '<g stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M12 2v20M3.3 7l17.4 10M20.7 7 3.3 17"/><path d="m9 3.5 3 2.4 3-2.4M9 20.5l3-2.4 3 2.4M4 9.6l.6 3.7-3 2.2M20 9.6l-.6 3.7 3 2.2M20 14.4l-.6-3.7 3-2.2M4 14.4l.6-3.7-3-2.2" stroke-width="1.5"/></g>',
  stun: '<path d="M12 2 6 13h5l-1 9 8-12h-5l2-8Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  poison: '<path d="M12 3c3.4 3.6 5.5 6.4 5.5 9.4a5.5 5.5 0 0 1-11 0C6.5 9.4 8.6 6.6 12 3Z"/><circle cx="10.4" cy="12" r="1.1" fill="#0a2010"/><circle cx="13.4" cy="14" r="1.1" fill="#0a2010"/>',
  root: '<path d="M12 2v9M12 11 8 15M12 11l4 4M8 15l-3 5M8 15l1 5M16 15l3 5M16 15l-1 5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
  shield: '<path d="M12 2.4 20 5v6.2c0 5-3.4 8.6-8 10.4-4.6-1.8-8-5.4-8-10.4V5Z"/><path d="m8.6 12 2.4 2.4 4.4-4.6" fill="none" stroke="#0f2a12" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  heal: '<path d="M9.5 3h5v6h6v5h-6v6h-5v-6h-6V9h6Z"/>',
  mark: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 3v4M12 17v4M3 12h4M17 12h4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="12" r="2.4"/>',
  chain: '<path d="M4 4l6 6M14 14l6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><rect x="7.5" y="2.5" width="7" height="7" rx="3.5" fill="none" stroke="currentColor" stroke-width="2" transform="rotate(45 11 6)"/><rect x="9.5" y="14.5" width="7" height="7" rx="3.5" fill="none" stroke="currentColor" stroke-width="2" transform="rotate(45 13 18)"/>',

  // ---- generic ability marks ---------------------------------------------
  spell: '<path d="M12 2l1.7 5.3a4 4 0 0 0 2.6 2.6L21.6 12l-5.3 1.7a4 4 0 0 0-2.6 2.6L12 21.6l-1.7-5.3a4 4 0 0 0-2.6-2.6L2.4 12l5.3-1.7a4 4 0 0 0 2.6-2.6Z"/>',
  signature: '<path d="M12 2.2l2.5 6.4 6.9.4-5.3 4.4 1.7 6.7L12 16.9 6.2 20.5l1.7-6.7L2.6 9.4l6.9-.4Z"/><circle cx="12" cy="12.3" r="2" fill="#1a0f30"/>',
  burst: '<path d="M12 2l2.2 5.6L20 6l-3.4 5L20 16l-5.8-1.6L12 20l-2.2-5.6L4 16l3.4-5L4 6l5.8 1.6Z"/>',
  comet: '<circle cx="16.5" cy="7.5" r="4"/><path d="M13.7 10.3 3 21M12 6 5 13M18 12l-6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3.2" fill="#1a0f30"/>',
  gear: '<path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm9-.5-2 .6-.7-1.7 1.2-1.7-1.5-1.5-1.7 1.2-1.7-.7L14 2h-4l-.4 2-1.7.7L6.2 3.5 4.7 5l1.2 1.7-.7 1.7L3 8v4l2 .4.7 1.7-1.2 1.7 1.5 1.5 1.7-1.2 1.7.7L10 22h4l.4-2 1.7-.7 1.7 1.2 1.5-1.5-1.2-1.7.7-1.7 2-.4Z"/>',
  dice: '<rect x="3.5" y="3.5" width="17" height="17" rx="3.5"/><g fill="#1a0f30"><circle cx="8" cy="8" r="1.5"/><circle cx="16" cy="8" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="8" cy="16" r="1.5"/><circle cx="16" cy="16" r="1.5"/></g>',
  twin: '<circle cx="8" cy="9" r="4.5"/><circle cx="16" cy="9" r="4.5"/><path d="M2.5 21c.7-3.4 2.7-5 5.5-5s4.8 1.6 5.5 5M10.5 21c.7-3.4 2.7-5 5.5-5s4.8 1.6 5.5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  moon: '<path d="M15.5 3A9 9 0 1 0 21 14.2 7.2 7.2 0 0 1 15.5 3Z"/>',
  skull: '<path d="M12 2.5c-5 0-8.5 3.2-8.5 8 0 2.7 1.4 4.7 3 5.9V20a1.5 1.5 0 0 0 1.5 1.5H16A1.5 1.5 0 0 0 17.5 20v-3.6c1.6-1.2 3-3.2 3-5.9 0-4.8-3.5-8-8.5-8Z"/><circle cx="8.5" cy="11" r="2" fill="#1a0f30"/><circle cx="15.5" cy="11" r="2" fill="#1a0f30"/><path d="M11 15h2v3h-2Z" fill="#1a0f30"/>',
  sparkle: '<path d="M12 3l1.4 5.1a3 3 0 0 0 2.5 2.2L21 12l-5.1 1.7a3 3 0 0 0-2.5 2.2L12 21l-1.4-5.1a3 3 0 0 0-2.5-2.2L3 12l5.1-1.7a3 3 0 0 0 2.5-2.2Z"/><path d="M19 3.5l.7 2.1 2.1.7-2.1.7-.7 2.1-.7-2.1-2.1-.7 2.1-.7Z"/>',
  sprout: '<path d="M12 21v-8M12 13c0-2.5 1.8-4.3 4.5-4.5 0 2.7-1.8 4.5-4.5 4.5ZM12 15c0-2.7-1.8-4.5-4.5-4.7 0 2.9 1.8 4.7 4.5 4.7Z"/><path d="M12 21v-8" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
  tree: '<path d="M12 2c3.6 0 6 2.6 6 6 0 2.4-1.3 4.1-3 5h1c2 0 3.4 1.4 3.4 3.3S18 20 16 20H8c-2 0-3.4-1.4-3.4-3.4S6 13 8 13H9c-1.7-.9-3-2.6-3-5 0-3.4 2.4-6 6-6Z"/><path d="M12 22v-6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
  blade: '<path d="M4 3l11 11-2 2L2 5Z"/><path d="M13 14l7 7M18 17l3 1-1-3" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
  book: '<path d="M4 4.5A2 2 0 0 1 6 2.5h13v16H6a2 2 0 0 0-2 2Z"/><path d="M4 4.5v16A2 2 0 0 1 6 18.5h13" fill="none" stroke="#1a0f30" stroke-width="1.3" opacity=".5"/><path d="M9 7h6M9 10h6" fill="none" stroke="#1a0f30" stroke-width="1.3" opacity=".5"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="11" rx="2.5"/><path d="M7.5 10.5V8a4.5 4.5 0 0 1 9 0v2.5" fill="none" stroke="currentColor" stroke-width="2"/>',
  pencil: '<path d="M4 20l1-4L15.5 5.5l3 3L8 19Z"/><path d="M14.5 6.5l3 3 1.8-1.8a1.5 1.5 0 0 0 0-2.2l-.8-.8a1.5 1.5 0 0 0-2.2 0Z"/>',
  link: '<path d="M9 15l6-6M8.5 12 6 14.5a3.5 3.5 0 0 0 5 5L13.5 17M15.5 12 18 9.5a3.5 3.5 0 0 0-5-5L10.5 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  target: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="4.7" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="1.4"/>',
  brush: '<path d="M14 3.5c2.3-1.6 4.5-1.4 5.8-.1s1.5 3.5-.1 5.8C18 11.6 13 15 13 15l-4-4s3.4-5 5-7.5Z"/><path d="M9 11l4 4c0 2.5-2 5-5.5 5.5C8.5 18 5 18 4 20c-.3-3.5 1.5-6.5 5-9Z"/>',
  flask: '<path d="M9 2.5h6v1.6l-.1 4.2 4.4 8.1A3 3 0 0 1 16.6 21H7.4a3 3 0 0 1-2.7-4.6l4.4-8.1L9 4.1Z"/><path d="M8.2 14.5h7.6" fill="none" stroke="#1a0f30" stroke-width="1.6"/>',

  // ---- store swatch fallbacks --------------------------------------------
  frame: '<rect x="3" y="3" width="18" height="18" rx="2"/><rect x="6" y="6" width="12" height="12" rx="1" fill="#1a0f30"/><path d="M6 15l3.5-3.5 2.5 2.5L15 10l3 3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
  crown: '<path d="M3 8l3.5 3L12 5l5.5 6L21 8l-1.6 10.5H4.6Z"/><path d="M4.6 18.5h14.8" fill="none" stroke="#1a0f30" stroke-width="1.4"/>',
  hourglass: '<path d="M6 3h12M6 21h12M6.5 3c0 4 3 5.5 5.5 8 2.5-2.5 5.5-4 5.5-8M6.5 21c0-4 3-5.5 5.5-8 2.5 2.5 5.5 4 5.5 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 6.5h6L12 9.5Z"/>',
  magnet: '<path d="M6 3h4v8a2 2 0 0 0 4 0V3h4v8a6 6 0 0 1-12 0Z"/><path d="M6 6.5h4M14 6.5h4" fill="none" stroke="#1a0f30" stroke-width="1.6"/>',
  bag: '<path d="M6 8h12l1 12.5H5Z"/><path d="M8.5 8V6a3.5 3.5 0 0 1 7 0v2" fill="none" stroke="currentColor" stroke-width="2"/>',
  mask: '<path d="M4 5h16v6a8 8 0 0 1-16 0Z"/><circle cx="8.5" cy="10" r="1.6" fill="#1a0f30"/><circle cx="15.5" cy="10" r="1.6" fill="#1a0f30"/><path d="M9 14.5c1 1 4 1 6 0" fill="none" stroke="#1a0f30" stroke-width="1.6" stroke-linecap="round"/>',
  chat: '<path d="M3 5.5A2.5 2.5 0 0 1 5.5 3h13A2.5 2.5 0 0 1 21 5.5v8A2.5 2.5 0 0 1 18.5 16H9l-5 4.5V16H5.5A2.5 2.5 0 0 1 3 13.5Z"/><g fill="#1a0f30"><circle cx="8.5" cy="9.5" r="1.2"/><circle cx="12" cy="9.5" r="1.2"/><circle cx="15.5" cy="9.5" r="1.2"/></g>',
  gift: '<rect x="3.5" y="8" width="17" height="5" rx="1"/><path d="M5 13h14v7.5A1.5 1.5 0 0 1 17.5 22h-11A1.5 1.5 0 0 1 5 20.5Z"/><path d="M10.5 8V22M13.5 8V22" fill="none" stroke="#1a0f30" stroke-width="1.4"/><path d="M12 8S9.5 3.5 7.5 4.5 8 8 12 8Zm0 0s2.5-4.5 4.5-3.5S16 8 12 8Z"/>',
  hand: '<path d="M9 11V4.5a1.5 1.5 0 0 1 3 0V10m0-.5V3.5a1.5 1.5 0 0 1 3 0V10m0-1V5.5a1.5 1.5 0 0 1 3 0V13c0 4-2.6 8-7 8-3 0-4.7-1.4-6.3-4L4 13.2a1.5 1.5 0 0 1 2.5-1.6L9 14"/>',
  warn: '<path d="M12 2.5 22.5 21H1.5Z"/><path d="M12 9v5" fill="none" stroke="#1a0f30" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="17.5" r="1.4" fill="#1a0f30"/>',
  atom: '<circle cx="12" cy="12" r="2.2"/><g fill="none" stroke="currentColor" stroke-width="1.7"><ellipse cx="12" cy="12" rx="10" ry="4.2"/><ellipse cx="12" cy="12" rx="10" ry="4.2" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="4.2" transform="rotate(120 12 12)"/></g>',
}

export interface IconOpts {
  size?: number // px (width == height); default 1em so it flows with text
  color?: string // CSS colour → `currentColor`; default inherits
  cls?: string // extra class on the <svg>
  title?: string // accessible label
}

/** Inline `<svg>` markup for an icon, tintable via `color`. Returns '' if unknown. */
export function iconMarkup(name: IconName, opts: IconOpts = {}): string {
  const body = PATHS[name]
  if (!body) return ''
  const size = opts.size ? `${opts.size}px` : '1em'
  const style = `width:${size};height:${size};display:inline-block;vertical-align:-0.14em;flex:0 0 auto;${opts.color ? `color:${opts.color};` : ''}`
  const cls = opts.cls ? ` class="${opts.cls}"` : ''
  const a11y = opts.title ? ` role="img" aria-label="${opts.title}"` : ' aria-hidden="true"'
  return `<svg viewBox="0 0 24 24" fill="currentColor" style="${style}"${cls}${a11y}>${body}</svg>`
}

// ---------------------------------------------------------------------------
//  Elements — the wheel + Arcane, with their shipping hues.
// ---------------------------------------------------------------------------
export type ElementName = 'Fire' | 'Water' | 'Nature' | 'Storm' | 'Light' | 'Dark' | 'Arcane'

const ELEMENT_ICON: Record<ElementName, IconName> = {
  Fire: 'fire', Water: 'water', Nature: 'nature', Storm: 'storm',
  Light: 'light', Dark: 'dark', Arcane: 'arcane',
}

export const ELEMENT_HEX: Record<ElementName, string> = {
  Fire: '#ff6a3c', Water: '#4ad9ff', Nature: '#8dff4a', Storm: '#9ad0ff',
  Light: '#ffe14a', Dark: '#c06bff', Arcane: '#8fbfff',
}

/** Element icon, pre-tinted to its wheel hue (pass a colour to override). */
export function elementIcon(el: string, opts: IconOpts = {}): string {
  const name = (ELEMENT_ICON as Record<string, IconName>)[el] ?? 'sparkle'
  const color = opts.color ?? ELEMENT_HEX[el as ElementName] ?? undefined
  return iconMarkup(name, { ...opts, color })
}

// ---------------------------------------------------------------------------
//  Currencies — coin / diamond / prism / star / shard, on-brand tints.
// ---------------------------------------------------------------------------
export type CurrencyName = 'coin' | 'diamond' | 'prism' | 'star' | 'shard'

const CURRENCY_HEX: Record<CurrencyName, string> = {
  coin: '#ffd54a', diamond: '#8fe9ff', prism: '#e2a6ff', star: '#ffd54a', shard: '#7dffb0',
}

/** Currency icon, pre-tinted (pass a colour to override). */
export function currencyIcon(cur: CurrencyName, opts: IconOpts = {}): string {
  return iconMarkup(cur, { ...opts, color: opts.color ?? CURRENCY_HEX[cur] })
}

// ---------------------------------------------------------------------------
//  Emoji → icon bridge. The game's data tables (heroes / synergy) still carry
//  emoji `glyph`/`icon` strings; DOM render sites route them through here so no
//  emoji ever reaches the screen. Unknown glyphs fall back to a spark.
// ---------------------------------------------------------------------------
const EMOJI_ICON: Record<string, IconName> = {
  '🔥': 'fire', '🌋': 'fire',
  '❄': 'water', '❆': 'freeze', '🌊': 'water', '💧': 'water',
  '🌿': 'nature', '🌱': 'sprout', '🌳': 'tree',
  '⚡': 'storm', '🌩': 'storm',
  '☀': 'light', '✦': 'star', '✧': 'star', '◆': 'diamond', '✨': 'sparkle', '🌟': 'star',
  '🗡': 'blade', '🌓': 'moon', '🌙': 'moon',
  '⚗': 'flask', '⚙': 'gear',
  '🛡': 'shield', '🛡️': 'shield', '💥': 'burst', '☄': 'comet',
  '👁': 'eye', '👁️': 'eye', '✚': 'heal', '➕': 'heal', '❤️': 'health', '❤': 'health',
  '✌': 'twin', '✌️': 'twin', '🎲': 'dice',
  '💰': 'coin', '🪙': 'coin', '💎': 'diamond', '⭐': 'star', '🔹': 'shard',
  '☠': 'skull', '☠️': 'skull',
  '📖': 'book', '📚': 'book', '🔒': 'lock', '✎': 'pencil', '✏️': 'pencil', '🖌️': 'brush', '🖌': 'brush',
  '🎯': 'target', '🔗': 'link',
  '🎇': 'burst', '🌀': 'sparkle', '💫': 'sparkle', '🔮': 'sparkle',
  '🖼️': 'frame', '🖼': 'frame', '👑': 'crown', '⏳': 'hourglass', '⌛': 'hourglass',
  '🧲': 'magnet', '🎒': 'bag', '🎭': 'mask', '⚔': 'blade', '⚔️': 'blade', '➡': 'link',
  '💬': 'chat', '🗨️': 'chat', '🗨': 'chat', '🎁': 'gift', '👆': 'hand', '👉': 'hand', '👇': 'hand',
  '⚠': 'warn', '⚠️': 'warn', '⚛': 'atom', '⚛️': 'atom',
}

/** Map a data-table glyph (emoji) to inline-SVG markup. `color` tints it. */
export function glyphIcon(glyph: string, opts: IconOpts = {}): string {
  const name = EMOJI_ICON[glyph] ?? EMOJI_ICON[glyph.trim()] ?? 'sparkle'
  return iconMarkup(name, opts)
}

/** True when a string is one of the emoji we can render as an icon. */
export function hasGlyphIcon(glyph: string): boolean {
  return !!(EMOJI_ICON[glyph] ?? EMOJI_ICON[glyph.trim()])
}

// ---------------------------------------------------------------------------
//  Reactions — the 9 signature elemental reactions, each a two-tone burst tinted
//  to its callout colours. Used by the "Reactions Discovered x/9" codex surface.
// ---------------------------------------------------------------------------
const REACTION_ICON: Record<string, IconName> = {
  thermal: 'burst', shatter: 'freeze', flashover: 'fire', wildfire: 'nature',
  overgrow: 'root', eclipse: 'moon', conduct: 'chain', blight: 'poison', amplify: 'sparkle',
}

/** Reaction icon, tinted to a hex (usually the reaction's primary callout hue). */
export function reactionIcon(key: string, colorHex: string, opts: IconOpts = {}): string {
  const name = REACTION_ICON[key] ?? 'burst'
  return iconMarkup(name, { ...opts, color: colorHex })
}

/** Hex string from a 0xRRGGBB sim colour number. */
export function hexOf(color: number): string {
  return '#' + (color & 0xffffff).toString(16).padStart(6, '0')
}
