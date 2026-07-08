// ADMIN THEME — the single source of truth for the dashboard's dataviz palette,
// spacing tokens and number/date formatting. Dark-first, accessible: the series
// palette is a categorical set chosen for contrast against #0b0e17 and for
// colour-blind separability (no red/green adjacency in the default order).
//
// View-side only — never imported by the game bundle or the sim. Everything
// here is pure/DOM-free so section views can format without touching the DOM.

// ---- Categorical series palette (ordered; wrap after 8) --------------------
// Teal · violet · amber · rose · green · sky · orange · magenta. Deliberately
// avoids putting the only red-ish next to the only green for colour-blind
// separability against the #080a12 backdrop.
export const PALETTE = {
  teal: '#4dd0e0',
  violet: '#8b7bff',
  amber: '#ffc23c',
  rose: '#ff6a9a',
  green: '#4fe08a',
  sky: '#5cc8ff',
  orange: '#ff9a4c',
  magenta: '#e07bff',
} as const

export const SERIES_COLORS = [
  PALETTE.teal, PALETTE.violet, PALETTE.amber, PALETTE.rose,
  PALETTE.green, PALETTE.sky, PALETTE.orange, PALETTE.magenta,
]

export function seriesColor(i: number): string {
  return SERIES_COLORS[((i % SERIES_COLORS.length) + SERIES_COLORS.length) % SERIES_COLORS.length]
}

// Semantic colours for status/severity — used by badges, alerts, verdict chips.
export const STATUS = {
  ok: '#4fe08a', // verified / healthy
  warn: '#ffc23c', // pending / watch
  danger: '#ff5a6e', // rejected / critical
  info: '#5cc8ff', // informational
  muted: '#6b7590', // disabled / n/a
} as const

// Ink / surface tokens (kept in sync with admin.css custom properties).
export const INK = {
  bg: '#080a12',
  panel: '#0f1320',
  panel2: '#141a2b',
  line: '#232a40',
  text: '#e7ecf7',
  dim: '#9aa5be',
  faint: '#6b7590',
} as const

// ---- Formatting ------------------------------------------------------------
export function fmtInt(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return Math.round(n).toLocaleString('en-US')
}

/** Compact human number: 1.2k, 3.4M. */
export function fmtCompact(n: number): string {
  if (!Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  if (abs >= 1e9) return (n / 1e9).toFixed(abs >= 1e10 ? 0 : 1) + 'B'
  if (abs >= 1e6) return (n / 1e6).toFixed(abs >= 1e7 ? 0 : 1) + 'M'
  if (abs >= 1e3) return (n / 1e3).toFixed(abs >= 1e4 ? 0 : 1) + 'k'
  return String(Math.round(n))
}

export function fmtPct(frac: number, digits = 1): string {
  if (!Number.isFinite(frac)) return '—'
  return (frac * 100).toFixed(digits) + '%'
}

/** A signed delta with sign glyph, for KPI trend chips. */
export function fmtDelta(frac: number, digits = 1): string {
  if (!Number.isFinite(frac)) return '—'
  const s = (frac * 100).toFixed(digits)
  return (frac > 0 ? '▲ ' : frac < 0 ? '▼ ' : '· ') + Math.abs(Number(s)) + '%'
}

export function fmtUsd(cents: number): string {
  if (!Number.isFinite(cents)) return '—'
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function fmtUsdCompact(cents: number): string {
  if (!Number.isFinite(cents)) return '—'
  const d = cents / 100
  if (Math.abs(d) >= 1000) return '$' + fmtCompact(d)
  return '$' + d.toFixed(0)
}

export function fmtDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—'
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  if (m <= 0) return `${s}s`
  return `${m}m ${String(s).padStart(2, '0')}s`
}

const MS_DAY = 86_400_000

/** A short label (e.g. "Jul 3") for a UTC day offset back from `nowMs`. */
export function dayLabel(daysAgo: number, nowMs: number): string {
  const d = new Date(nowMs - daysAgo * MS_DAY)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/** "3m ago" / "2h ago" / "5d ago" from a past epoch ms. */
export function fmtAgo(pastMs: number, nowMs: number): string {
  const s = Math.max(0, Math.round((nowMs - pastMs) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

/** Escape a string for safe interpolation into innerHTML. */
export function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
