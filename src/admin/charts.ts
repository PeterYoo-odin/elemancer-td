// ADMIN CHARTS — dependency-free SVG dataviz primitives. Every chart returns an
// SVG string (inserted via innerHTML) so views stay declarative. Conventions:
//   · dark theme, one shared categorical palette (theme.ts)
//   · role="img" + aria-label on every chart for screen readers
//   · <title> hover tooltips on data marks (native, no JS tooltip layer)
//   · a fixed viewBox so charts scale fluidly to their container width
// Accessible, consistent, drillable-where-cheap — the dataviz bar the brief sets.

import { seriesColor, esc, INK, STATUS } from './theme'

const AXIS = INK.faint
const GRID = 'rgba(255,255,255,0.06)'
const LABEL = INK.dim

function svgOpen(w: number, h: number, aria: string): string {
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="${esc(aria)}" class="chart-svg" style="width:100%;height:auto;display:block">`
}

function niceMax(v: number): number {
  if (v <= 0) return 1
  const mag = Math.pow(10, Math.floor(Math.log10(v)))
  const norm = v / mag
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10
  return step * mag
}

export interface Series {
  name: string
  values: number[]
  color?: string
}

// ---------------------------------------------------------------------------
// Multi-series line / area chart with y-grid, x labels and a legend.
// ---------------------------------------------------------------------------
export function lineChart(opts: {
  series: Series[]
  labels: string[]
  area?: boolean
  height?: number
  yFormat?: (n: number) => string
  aria?: string
  yMax?: number
}): string {
  const W = 720
  const H = opts.height ?? 240
  const padL = 46
  const padR = 12
  const padT = 12
  const padB = 26
  const iw = W - padL - padR
  const ih = H - padT - padB
  const n = opts.labels.length
  const fmt = opts.yFormat ?? ((v: number) => String(Math.round(v)))
  const rawMax = opts.yMax ?? Math.max(1, ...opts.series.flatMap((s) => s.values))
  const yMax = niceMax(rawMax)
  const x = (i: number) => padL + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw)
  const y = (v: number) => padT + ih - (Math.max(0, v) / yMax) * ih

  let g = svgOpen(W, H, opts.aria ?? 'line chart')
  // y grid + labels (4 rows)
  for (let r = 0; r <= 4; r++) {
    const gy = padT + (r / 4) * ih
    const val = yMax * (1 - r / 4)
    g += `<line x1="${padL}" y1="${gy.toFixed(1)}" x2="${W - padR}" y2="${gy.toFixed(1)}" stroke="${GRID}" stroke-width="1"/>`
    g += `<text x="${padL - 6}" y="${(gy + 3).toFixed(1)}" text-anchor="end" font-size="10" fill="${LABEL}">${esc(fmt(val))}</text>`
  }
  // x labels (thin: first, mid, last + evenly ~6)
  const stepL = Math.max(1, Math.ceil(n / 6))
  for (let i = 0; i < n; i += stepL) {
    g += `<text x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="${LABEL}">${esc(opts.labels[i])}</text>`
  }
  // series
  opts.series.forEach((s, si) => {
    const col = s.color ?? seriesColor(si)
    const pts = s.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`)
    if (opts.area) {
      const areaPath = `M ${x(0).toFixed(1)},${(padT + ih).toFixed(1)} L ${pts.join(' L ')} L ${x(n - 1).toFixed(1)},${(padT + ih).toFixed(1)} Z`
      g += `<path d="${areaPath}" fill="${col}" fill-opacity="0.12"/>`
    }
    g += `<polyline points="${pts.join(' ')}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`
    // dots with hover titles
    s.values.forEach((v, i) => {
      g += `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="2.5" fill="${col}"><title>${esc(s.name)} · ${esc(opts.labels[i])}: ${esc(fmt(v))}</title></circle>`
    })
  })
  g += `<line x1="${padL}" y1="${padT + ih}" x2="${W - padR}" y2="${padT + ih}" stroke="${AXIS}" stroke-width="1"/>`
  g += '</svg>'
  return g + legend(opts.series)
}

function legend(series: Series[]): string {
  if (series.length <= 1 && !series[0]?.name) return ''
  const items = series
    .map((s, i) => `<span class="lg-item"><i style="background:${s.color ?? seriesColor(i)}"></i>${esc(s.name)}</span>`)
    .join('')
  return `<div class="chart-legend">${items}</div>`
}

// ---------------------------------------------------------------------------
// Vertical bars — single or grouped. Good for daily installs, revenue by day.
// ---------------------------------------------------------------------------
export function barChart(opts: {
  series: Series[]
  labels: string[]
  height?: number
  yFormat?: (n: number) => string
  aria?: string
  stacked?: boolean
}): string {
  const W = 720
  const H = opts.height ?? 220
  const padL = 46
  const padR = 12
  const padT = 12
  const padB = 26
  const iw = W - padL - padR
  const ih = H - padT - padB
  const n = opts.labels.length
  const fmt = opts.yFormat ?? ((v: number) => String(Math.round(v)))
  const stacked = opts.stacked && opts.series.length > 1
  const colTotals = opts.labels.map((_, i) =>
    stacked ? opts.series.reduce((a, s) => a + Math.max(0, s.values[i] ?? 0), 0) : Math.max(...opts.series.map((s) => s.values[i] ?? 0)),
  )
  const yMax = niceMax(Math.max(1, ...colTotals))
  const slot = iw / n
  const barGroupW = slot * 0.66
  const k = opts.series.length
  const y = (v: number) => padT + ih - (Math.max(0, v) / yMax) * ih

  let g = svgOpen(W, H, opts.aria ?? 'bar chart')
  for (let r = 0; r <= 4; r++) {
    const gy = padT + (r / 4) * ih
    const val = yMax * (1 - r / 4)
    g += `<line x1="${padL}" y1="${gy.toFixed(1)}" x2="${W - padR}" y2="${gy.toFixed(1)}" stroke="${GRID}"/>`
    g += `<text x="${padL - 6}" y="${(gy + 3).toFixed(1)}" text-anchor="end" font-size="10" fill="${LABEL}">${esc(fmt(val))}</text>`
  }
  const stepL = Math.max(1, Math.ceil(n / 8))
  for (let i = 0; i < n; i++) {
    const cx = padL + i * slot + slot / 2
    if (i % stepL === 0) g += `<text x="${cx.toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="${LABEL}">${esc(opts.labels[i])}</text>`
    if (stacked) {
      let acc = 0
      opts.series.forEach((s, si) => {
        const v = Math.max(0, s.values[i] ?? 0)
        const y0 = y(acc)
        const y1 = y(acc + v)
        acc += v
        g += `<rect x="${(cx - barGroupW / 2).toFixed(1)}" y="${y1.toFixed(1)}" width="${barGroupW.toFixed(1)}" height="${Math.max(0, y0 - y1).toFixed(1)}" fill="${s.color ?? seriesColor(si)}" rx="1"><title>${esc(s.name)} · ${esc(opts.labels[i])}: ${esc(fmt(v))}</title></rect>`
      })
    } else {
      const bw = barGroupW / k
      opts.series.forEach((s, si) => {
        const v = Math.max(0, s.values[i] ?? 0)
        const bx = cx - barGroupW / 2 + si * bw
        const by = y(v)
        g += `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${(bw * 0.86).toFixed(1)}" height="${(padT + ih - by).toFixed(1)}" fill="${s.color ?? seriesColor(si)}" rx="1"><title>${esc(s.name)} · ${esc(opts.labels[i])}: ${esc(fmt(v))}</title></rect>`
      })
    }
  }
  g += `<line x1="${padL}" y1="${padT + ih}" x2="${W - padR}" y2="${padT + ih}" stroke="${AXIS}"/>`
  g += '</svg>'
  return g + legend(opts.series)
}

// ---------------------------------------------------------------------------
// Horizontal ranked bars — sources, level drop-off, top cosmetics, etc.
// Each row optionally clickable (drilldown) via data-drill.
// ---------------------------------------------------------------------------
export interface HBarRow {
  label: string
  value: number
  color?: string
  sub?: string
  drill?: string
}
export function hBars(opts: { rows: HBarRow[]; format?: (n: number) => string; max?: number }): string {
  const fmt = opts.format ?? ((v: number) => String(Math.round(v)))
  const max = Math.max(1, opts.max ?? Math.max(...opts.rows.map((r) => r.value)))
  return (
    '<div class="hbars">' +
    opts.rows
      .map((r, i) => {
        const w = Math.max(0, (r.value / max) * 100)
        const col = r.color ?? seriesColor(i)
        const drill = r.drill ? ` data-drill="${esc(r.drill)}" role="button" tabindex="0"` : ''
        return `<div class="hbar${r.drill ? ' hbar--drill' : ''}"${drill}>
        <div class="hbar-label">${esc(r.label)}${r.sub ? `<span class="hbar-sub">${esc(r.sub)}</span>` : ''}</div>
        <div class="hbar-track"><div class="hbar-fill" style="width:${w.toFixed(1)}%;background:${col}"></div></div>
        <div class="hbar-val">${esc(fmt(r.value))}</div>
      </div>`
      })
      .join('') +
    '</div>'
  )
}

// ---------------------------------------------------------------------------
// Funnel — ordered steps with conversion + drop between each.
// ---------------------------------------------------------------------------
export function funnel(steps: { label: string; value: number }[]): string {
  const top = Math.max(1, steps[0]?.value ?? 1)
  return (
    '<div class="funnel">' +
    steps
      .map((s, i) => {
        const pctOfTop = s.value / top
        const prev = i > 0 ? steps[i - 1].value : s.value
        const stepConv = prev > 0 ? s.value / prev : 1
        const dropPct = i > 0 ? 1 - stepConv : 0
        const col = seriesColor(i)
        return `<div class="fn-row">
        <div class="fn-head"><span class="fn-label">${esc(s.label)}</span><span class="fn-val">${s.value.toLocaleString('en-US')} <em>${(pctOfTop * 100).toFixed(0)}%</em></span></div>
        <div class="fn-track"><div class="fn-fill" style="width:${(pctOfTop * 100).toFixed(1)}%;background:${col}"></div></div>
        ${i > 0 ? `<div class="fn-drop${dropPct > 0.5 ? ' fn-drop--bad' : ''}">↳ ${(stepConv * 100).toFixed(0)}% continued · ${(dropPct * 100).toFixed(0)}% dropped</div>` : ''}
      </div>`
      })
      .join('') +
    '</div>'
  )
}

// ---------------------------------------------------------------------------
// Cohort retention triangle — rows = cohorts (days), cols = day-N retention.
// Heat cells shaded by retention fraction; hover shows exact %.
// ---------------------------------------------------------------------------
export function cohortTriangle(opts: {
  cohortLabels: string[]
  dayHeaders: number[] // e.g. [0,1,3,7,14,30]
  matrix: (number | null)[][] // matrix[cohort][dayIdx] = retained fraction, null = future
}): string {
  const heat = (v: number): string => {
    // teal→violet ramp on retention (0..1). Low = dim, high = saturated.
    const t = Math.max(0, Math.min(1, v))
    const alpha = 0.12 + t * 0.8
    return `rgba(77,208,224,${alpha.toFixed(2)})`
  }
  let h = '<div class="cohort-wrap"><table class="cohort"><thead><tr><th>Cohort</th>'
  for (const d of opts.dayHeaders) h += `<th>D${d}</th>`
  h += '</tr></thead><tbody>'
  opts.matrix.forEach((row, ri) => {
    h += `<tr><td class="coh-name">${esc(opts.cohortLabels[ri])}</td>`
    row.forEach((v, ci) => {
      if (v === null || v === undefined) {
        h += '<td class="coh-cell coh-empty"></td>'
      } else {
        h += `<td class="coh-cell" style="background:${heat(v)}" title="${esc(opts.cohortLabels[ri])} · D${opts.dayHeaders[ci]}: ${(v * 100).toFixed(1)}%">${(v * 100).toFixed(0)}</td>`
      }
    })
    h += '</tr>'
  })
  h += '</tbody></table></div>'
  return h
}

// ---------------------------------------------------------------------------
// Donut — categorical share (platform, geo, currency split).
// ---------------------------------------------------------------------------
export function donut(opts: { slices: { label: string; value: number; color?: string }[]; centerLabel?: string; centerSub?: string }): string {
  const total = Math.max(1e-9, opts.slices.reduce((a, s) => a + Math.max(0, s.value), 0))
  const R = 54
  const r = 34
  const cx = 70
  const cy = 70
  let a0 = -Math.PI / 2
  let paths = ''
  opts.slices.forEach((s, i) => {
    const frac = Math.max(0, s.value) / total
    const a1 = a0 + frac * Math.PI * 2
    const large = frac > 0.5 ? 1 : 0
    const x0 = cx + R * Math.cos(a0)
    const y0 = cy + R * Math.sin(a0)
    const x1 = cx + R * Math.cos(a1)
    const y1 = cy + R * Math.sin(a1)
    const xi1 = cx + r * Math.cos(a1)
    const yi1 = cy + r * Math.sin(a1)
    const xi0 = cx + r * Math.cos(a0)
    const yi0 = cy + r * Math.sin(a0)
    const col = s.color ?? seriesColor(i)
    if (frac > 0.0001) {
      paths += `<path d="M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${R} ${R} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} L ${xi1.toFixed(2)} ${yi1.toFixed(2)} A ${r} ${r} 0 ${large} 0 ${xi0.toFixed(2)} ${yi0.toFixed(2)} Z" fill="${col}"><title>${esc(s.label)}: ${(frac * 100).toFixed(1)}%</title></path>`
    }
    a0 = a1
  })
  const center = opts.centerLabel
    ? `<text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="18" font-weight="700" fill="${INK.text}">${esc(opts.centerLabel)}</text>${opts.centerSub ? `<text x="${cx}" y="${cy + 14}" text-anchor="middle" font-size="9" fill="${LABEL}">${esc(opts.centerSub)}</text>` : ''}`
    : ''
  const svg = `<svg viewBox="0 0 140 140" role="img" aria-label="donut chart" class="donut-svg">${paths}${center}</svg>`
  const leg =
    '<div class="donut-legend">' +
    opts.slices
      .map((s, i) => `<span class="lg-item"><i style="background:${s.color ?? seriesColor(i)}"></i>${esc(s.label)} <b>${((Math.max(0, s.value) / total) * 100).toFixed(0)}%</b></span>`)
      .join('') +
    '</div>'
  return `<div class="donut-wrap">${svg}${leg}</div>`
}

// ---------------------------------------------------------------------------
// Sparkline — tiny inline trend for KPI tiles.
// ---------------------------------------------------------------------------
export function sparkline(values: number[], color = seriesColor(0)): string {
  if (!values.length) return ''
  const W = 120
  const H = 30
  const max = Math.max(...values)
  const min = Math.min(...values)
  const span = max - min || 1
  const pts = values
    .map((v, i) => `${((i / (values.length - 1)) * W).toFixed(1)},${(H - ((v - min) / span) * (H - 4) - 2).toFixed(1)}`)
    .join(' ')
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="spark" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/></svg>`
}

// ---------------------------------------------------------------------------
// Gauge / progress bar — leaderboard health, pass progress, chargeback rate.
// ---------------------------------------------------------------------------
export function progressBar(frac: number, opts: { color?: string; danger?: number; warn?: number } = {}): string {
  const p = Math.max(0, Math.min(1, frac))
  let col = opts.color ?? STATUS.ok
  if (opts.danger !== undefined && frac >= opts.danger) col = STATUS.danger
  else if (opts.warn !== undefined && frac >= opts.warn) col = STATUS.warn
  return `<div class="pbar"><div class="pbar-fill" style="width:${(p * 100).toFixed(1)}%;background:${col}"></div></div>`
}
