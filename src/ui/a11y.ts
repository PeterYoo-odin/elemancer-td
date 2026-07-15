// ACCESSIBILITY — the colour-vision layer for a game whose whole identity is
// ELEMENT COLOUR. Two guarantees, in priority order:
//
//   1. GLYPHS (the real guarantee). Every element carries a distinct SHAPE, so
//      element identity NEVER depends on colour being perceived correctly. This is
//      the belt; the palette is the suspenders.
//   2. Colourblind-safe PALETTES. Deuteranopia/protanopia/tritanopia remaps that
//      separate the colliding pairs by LIGHTNESS and the blue-yellow axis, not just
//      hue (a hue-shift alone would not help red-green deficiency).
//
// The colliding pairs in the default palette (see combat.ts ELEMENT_COLOR):
//   · Fire (orange) / Nature (lime) / Light (yellow)  — collapse under deuter/protan
//   · Water (cyan) / Storm (light-blue)               — close for everyone, worst tritan
// The deuter/protan set uses the Okabe-Ito colourblind-safe palette; the tritan set
// separates on red-green + lightness. Arcane gets its own distinct hue in each.
//
// Consumers call elementHex()/elementNum()/elementGlyph() instead of reading a raw
// colour constant, so a single setting re-tints the whole HUD. applyAccessibility()
// pushes the current settings onto <html> (data-attrs + CSS vars) before first paint.

import type { Element } from '../sim/combat'
import { appSettings, type ColorblindMode } from './settings'

export type ElementKey = Element | 'Arcane'
export const ALL_ELEMENTS: ElementKey[] = ['Fire', 'Water', 'Nature', 'Light', 'Dark', 'Storm', 'Arcane']

// Default (colour-vision-typical) palette — matches combat.ts / icons.ts today.
const DEFAULT_HEX: Record<ElementKey, string> = {
  Fire: '#ff6a3c', Water: '#4ad9ff', Nature: '#8dff4a', Light: '#ffe14a',
  Dark: '#c06bff', Storm: '#9ad0ff', Arcane: '#8fbfff',
}

// Okabe-Ito colourblind-safe palette, assigned so the colliding pairs land far
// apart on lightness + blue-yellow. Used for BOTH deuter and protan (their
// confusion lines are near-identical).
const OKABE: Record<ElementKey, string> = {
  Fire: '#d55e00', // vermilion (dark warm)
  Water: '#0072b2', // strong blue (deep) — far from Storm on lightness
  Nature: '#009e73', // bluish green
  Light: '#f0e442', // yellow (bright)
  Dark: '#cc79a7', // reddish purple
  Storm: '#56b4e9', // sky blue (light) — far from Water on lightness
  Arcane: '#e69f00', // orange (its own warm, distinct from Fire's dark vermilion)
}

// Tritan (blue-yellow deficiency): separate on red-green + lightness; blues/yellows
// are the risk so they are pushed apart by lightness and toward red/green anchors.
const TRITAN: Record<ElementKey, string> = {
  Fire: '#e8482e', // red
  Water: '#0e8a8a', // dark teal (leans green-cyan, low lightness)
  Nature: '#7dd35a', // light green (high lightness) — split from Water by lightness
  Light: '#f2b6c6', // pale pink (yellow reads pinkish under tritan — lean into it, keep it LIGHT)
  Dark: '#8b4fb0', // purple
  Storm: '#56c6e9', // light cyan-blue
  Arcane: '#c98bea', // light violet
}

const PALETTES: Record<ColorblindMode, Record<ElementKey, string>> = {
  off: DEFAULT_HEX,
  deuter: OKABE,
  protan: OKABE,
  trit: TRITAN,
}

// Distinct SHAPE per element — the colour-independent identity. Chosen for wide
// glyph coverage and legibility at small sizes.
export const ELEMENT_GLYPH: Record<ElementKey, string> = {
  Fire: '▲', // flame
  Water: '●', // droplet
  Nature: '✿', // leaf/bloom
  Light: '☀', // sun
  Dark: '☾', // moon
  Storm: '⚡', // bolt
  Arcane: '✦', // star
}

function mode(): ColorblindMode { return appSettings.data.colorblind }

/** Element colour as a CSS hex string, honouring the active colourblind palette. */
export function elementHex(el: ElementKey): string {
  return (PALETTES[mode()] ?? DEFAULT_HEX)[el] ?? DEFAULT_HEX[el]
}

/** Element colour as a 0xRRGGBB number (for Phaser / Three.js material colours). */
export function elementNum(el: ElementKey): number {
  const hex = elementHex(el).replace('#', '')
  const n = Number.parseInt(hex, 16)
  return Number.isFinite(n) ? n : 0xffffff
}

/** The element's distinct shape glyph, or '' when glyphs are disabled. */
export function elementGlyph(el: ElementKey): string {
  return appSettings.data.elementGlyphs ? (ELEMENT_GLYPH[el] ?? '') : ''
}

let cssInjected = false
function injectCss(): void {
  if (cssInjected) return
  cssInjected = true
  const style = document.createElement('style')
  style.id = 'a11y-css'
  style.textContent = CSS
  document.head.appendChild(style)
}

// Apply the current accessibility settings to the document root. Idempotent —
// call again after any settings change to re-tint live.
export function applyAccessibility(): void {
  if (typeof document === 'undefined') return
  injectCss()
  const root = document.documentElement
  const s = appSettings.data
  root.setAttribute('data-colorblind', s.colorblind)
  root.setAttribute('data-glyphs', s.elementGlyphs ? 'on' : 'off')
  root.setAttribute('data-contrast', s.highContrast ? 'high' : 'normal')
  root.setAttribute('data-reduce-motion', appSettings.reducedMotion() ? 'on' : 'off')
  root.style.setProperty('--ui-text-scale', String(s.textScale))
  // Publish element colours as CSS custom properties so pure-CSS chips can theme too.
  for (const el of ALL_ELEMENTS) root.style.setProperty(`--el-${el.toLowerCase()}`, elementHex(el))
}

// Root-level CSS: text scaling + high-contrast overrides. The reduce-motion killer
// is layered on top of the per-component media queries the game already ships.
const CSS = `
:root { --ui-text-scale: 1; }
/* Scale the DOM HUD/overlays as a block so px-based layouts stay coherent. */
.eld-hud, .efp-card, .ecdx-card, .settings-card { font-size: calc(1em * var(--ui-text-scale)); }
html[data-contrast="high"] .eld-hud, html[data-contrast="high"] .efp-card,
html[data-contrast="high"] .settings-card, html[data-contrast="high"] .ecdx-card {
  --panel: #0d0a1c; --panel2: #171130; --stroke: rgba(255,255,255,.55);
  text-shadow: 0 1px 2px #000, 0 0 1px #000;
}
html[data-contrast="high"] { color: #fff; }
/* Keyboard-nav focus ring: visible on :focus-visible only (never on taps), so
   remappable-keys players can actually see where they are. */
button:focus-visible, [role="switch"]:focus-visible, [role="tab"]:focus-visible, input:focus-visible {
  outline: 2px solid #ffd76a !important; outline-offset: 2px;
}
/* Belt-and-suspenders reduce-motion: kill transitions/animations app-wide when set. */
html[data-reduce-motion="on"] * {
  animation-duration: 0.001ms !important;
  animation-iteration-count: 1 !important;
  transition-duration: 0.001ms !important;
  scroll-behavior: auto !important;
}
/* Element glyph chip — a small shape badge that carries element identity without colour. */
.el-glyph { display: inline-block; font-weight: 700; line-height: 1; }
`
