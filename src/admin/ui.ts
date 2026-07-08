// ADMIN UI COMPONENTS — small string-building helpers shared by every section
// view. They render to HTML strings (inserted via innerHTML), matching the
// game's overlay idiom (StorePage/FrontPage build DOM the same way). Keeping
// them here means one consistent card/tile/table/badge language everywhere.

import { esc, fmtDelta, INK } from './theme'
import { sparkline } from './charts'

/** A KPI tile: big number, label, optional trend delta + sparkline. */
export function statTile(opts: {
  label: string
  value: string
  delta?: number // fractional change vs prior period
  spark?: number[]
  hint?: string
  tone?: 'ok' | 'warn' | 'danger' | 'neutral'
}): string {
  const deltaHtml =
    opts.delta !== undefined && Number.isFinite(opts.delta)
      ? `<span class="tile-delta ${opts.delta > 0 ? 'up' : opts.delta < 0 ? 'down' : 'flat'}">${fmtDelta(opts.delta)}</span>`
      : ''
  const spark = opts.spark && opts.spark.length > 1 ? sparkline(opts.spark) : ''
  const tone = opts.tone && opts.tone !== 'neutral' ? ` tile--${opts.tone}` : ''
  return `<div class="tile${tone}">
    <div class="tile-label">${esc(opts.label)}${opts.hint ? `<span class="tile-hint" title="${esc(opts.hint)}">ⓘ</span>` : ''}</div>
    <div class="tile-value">${esc(opts.value)} ${deltaHtml}</div>
    ${spark ? `<div class="tile-spark">${spark}</div>` : ''}
  </div>`
}

/** A panel/card with a title, optional subtitle + right-aligned action slot. */
export function card(opts: { title?: string; subtitle?: string; body: string; action?: string; span?: 1 | 2 | 3; id?: string }): string {
  const head =
    opts.title || opts.action
      ? `<div class="card-head"><div><h3 class="card-title">${esc(opts.title ?? '')}</h3>${opts.subtitle ? `<p class="card-sub">${esc(opts.subtitle)}</p>` : ''}</div>${opts.action ? `<div class="card-action">${opts.action}</div>` : ''}</div>`
      : ''
  return `<section class="card card--span${opts.span ?? 1}"${opts.id ? ` id="${esc(opts.id)}"` : ''}>${head}<div class="card-body">${opts.body}</div></section>`
}

export type BadgeTone = 'ok' | 'warn' | 'danger' | 'info' | 'muted'
export function badge(text: string, tone: BadgeTone = 'muted'): string {
  return `<span class="badge badge--${tone}">${esc(text)}</span>`
}

export interface Column<T> {
  header: string
  cell: (row: T) => string
  align?: 'left' | 'right' | 'center'
  width?: string
}

/** A data table. `cell` returns already-escaped/marked-up HTML. */
export function table<T>(cols: Column<T>[], rows: T[], opts: { empty?: string; rowClass?: (r: T) => string } = {}): string {
  if (!rows.length) return `<div class="empty-row">${esc(opts.empty ?? 'No data.')}</div>`
  const head = cols.map((c) => `<th style="text-align:${c.align ?? 'left'}${c.width ? `;width:${c.width}` : ''}">${esc(c.header)}</th>`).join('')
  const body = rows
    .map((r) => {
      const cls = opts.rowClass?.(r)
      const tds = cols.map((c) => `<td style="text-align:${c.align ?? 'left'}">${c.cell(r)}</td>`).join('')
      return `<tr${cls ? ` class="${esc(cls)}"` : ''}>${tds}</tr>`
    })
    .join('')
  return `<div class="table-wrap"><table class="dtable"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`
}

/** A labelled definition list — used for posture docs / config summaries. */
export function defList(items: { k: string; v: string }[]): string {
  return '<dl class="deflist">' + items.map((i) => `<div><dt>${esc(i.k)}</dt><dd>${i.v}</dd></div>`).join('') + '</dl>'
}

/** A toggle switch row (feature flags / event toggles). Wire via data-toggle. */
export function toggleRow(opts: { id: string; label: string; sub?: string; on: boolean; locked?: boolean }): string {
  return `<div class="toggle-row">
    <div class="toggle-meta"><div class="toggle-label">${esc(opts.label)}</div>${opts.sub ? `<div class="toggle-sub">${esc(opts.sub)}</div>` : ''}</div>
    <button class="switch${opts.on ? ' switch--on' : ''}${opts.locked ? ' switch--locked' : ''}" data-toggle="${esc(opts.id)}" role="switch" aria-checked="${opts.on}" aria-label="${esc(opts.label)}"${opts.locked ? ' disabled' : ''}><span class="switch-knob"></span></button>
  </div>`
}

/** A prominent callout box (posture notes, warnings, guidance). */
export function callout(opts: { title: string; body: string; tone?: 'info' | 'warn' | 'ok' | 'danger'; icon?: string }): string {
  const tone = opts.tone ?? 'info'
  return `<div class="callout callout--${tone}"><div class="callout-icon">${esc(opts.icon ?? 'ⓘ')}</div><div><div class="callout-title">${esc(opts.title)}</div><div class="callout-body">${opts.body}</div></div></div>`
}

/** A responsive grid wrapper for tiles/cards. */
export function grid(children: string, cls = 'grid'): string {
  return `<div class="${cls}">${children}</div>`
}

/** Section intro header. */
export function sectionHeader(title: string, sub: string): string {
  return `<header class="sec-head"><h2>${esc(title)}</h2><p>${esc(sub)}</p></header>`
}

let toastN = 0
/** Ephemeral toast (top-right). Safe to call anytime post-boot. */
export function toast(msg: string, tone: 'ok' | 'warn' | 'danger' | 'info' = 'info'): void {
  if (typeof document === 'undefined') return
  let host = document.getElementById('toast-host')
  if (!host) {
    host = document.createElement('div')
    host.id = 'toast-host'
    document.body.appendChild(host)
  }
  const el = document.createElement('div')
  el.className = `toast toast--${tone}`
  el.textContent = msg
  el.style.setProperty('--i', String(toastN++))
  host.appendChild(el)
  setTimeout(() => {
    el.style.opacity = '0'
    el.style.transform = 'translateY(-6px)'
    setTimeout(() => el.remove(), 300)
  }, 3200)
}

/** Small inline color swatch (legend text). */
export function swatch(color: string): string {
  return `<i class="sw" style="background:${esc(color)}"></i>`
}

export const inkDim = INK.dim
