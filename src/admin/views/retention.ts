// VIEW 2 — RETENTION & FUNNEL. D1/D7/D30 cohort triangle, the onboarding funnel
// (click → first tower → first "wow" → level clears → day-2 return), per-level
// drop-off (which levels bleed players), and completion-by-world. The defeat-
// reason breakdown is our unique lever — we log WHY players lost.

import type { View, ViewCtx } from './view'
import { getRetention, type LevelDropRow } from '../data'
import { card, statTile, grid, table, badge, sectionHeader, callout, toast, type Column } from '../ui'
import { cohortTriangle, funnel, hBars, barChart, progressBar, type HBarRow } from '../charts'
import { fmtInt, fmtPct, PALETTE, esc } from '../theme'

function retentionTone(actual: number, target: number): 'ok' | 'warn' | 'danger' {
  if (actual >= target) return 'ok'
  if (actual >= target * 0.85) return 'warn'
  return 'danger'
}

export const retentionView: View = {
  id: 'retention',
  label: 'Retention & Funnel',
  icon: '🔁',
  async render(ctx: ViewCtx): Promise<string> {
    const d = await getRetention(ctx.session, ctx.range, ctx.now)

    const kpis = grid(
      [
        statTile({ label: 'D1 retention', value: fmtPct(d.actual.d1, 0), tone: retentionTone(d.actual.d1, d.benchmark.d1), hint: `Target ${fmtPct(d.benchmark.d1, 0)}` }),
        statTile({ label: 'D7 retention', value: fmtPct(d.actual.d7, 0), tone: retentionTone(d.actual.d7, d.benchmark.d7), hint: `Target ${fmtPct(d.benchmark.d7, 0)}` }),
        statTile({ label: 'D30 retention', value: fmtPct(d.actual.d30, 1), tone: retentionTone(d.actual.d30, d.benchmark.d30), hint: `Target ${fmtPct(d.benchmark.d30, 1)}` }),
        statTile({ label: 'Activation', value: fmtPct(d.onboarding[7].value / d.onboarding[0].value, 0), hint: 'Landed → welcome-bundle claimed' }),
      ].join(''),
      'grid grid--4',
    )

    const cohortCard = card({
      title: 'Cohort retention triangle',
      subtitle: 'Rows = signup-day cohorts · columns = day-N return rate (%). Blank = not yet reached.',
      span: 2,
      body:
        cohortTriangle({ cohortLabels: d.cohortLabels, dayHeaders: d.dayHeaders, matrix: d.cohortMatrix }) +
        `<div class="bench-row">Benchmark (2026 web mid-core): D1 ${fmtPct(d.benchmark.d1, 0)} · D7 ${fmtPct(d.benchmark.d7, 0)} · D30 ${fmtPct(d.benchmark.d30, 0)}</div>`,
    })

    const funnelCard = card({
      title: 'Onboarding funnel',
      subtitle: 'Landing → first tower → first "wow" → clears → activation → day-2 return',
      span: 2,
      body: funnel(d.onboarding),
    })

    // Per-level drop-off — the highest-value analytics for a level-based TD.
    const worstIdx = d.levelDrop.reduce((wi, r, i, arr) => (r.clearRate < arr[wi].clearRate ? i : wi), 0)
    const levelCols: Column<LevelDropRow>[] = [
      { header: 'Level', cell: (r) => `<code>${esc(r.levelId)}</code> ${esc(r.name)}` },
      { header: 'Realm', cell: (r) => badge(r.realm, 'muted') },
      { header: 'Starts', cell: (r) => fmtInt(r.starts), align: 'right' },
      { header: 'Clear rate', cell: (r) => `<div class="cell-bar">${progressBar(r.clearRate, { warn: 0, color: r.clearRate < 0.45 ? PALETTE.rose : r.clearRate < 0.65 ? PALETTE.amber : PALETTE.green })}<span>${fmtPct(r.clearRate, 0)}</span></div>`, align: 'right', width: '160px' },
      { header: 'Top defeat reason', cell: (r) => `<span class="dim">${esc(r.topDefeatReason)}</span>` },
    ]
    const levelCard = card({
      title: 'Per-level drop-off',
      subtitle: 'Where players bleed — lowest clear-rate levels need difficulty tuning',
      span: 2,
      body:
        table<LevelDropRow>(levelCols, d.levelDrop, { rowClass: (r) => (r.clearRate < 0.45 ? 'row-danger' : '') }) +
        callout({ title: 'Difficulty spike', tone: 'warn', icon: '⚠️', body: `<b>${esc(d.levelDrop[worstIdx].name)}</b> (<code>${esc(d.levelDrop[worstIdx].levelId)}</code>) has the worst clear rate at ${fmtPct(d.levelDrop[worstIdx].clearRate, 0)} — most common loss: “${esc(d.levelDrop[worstIdx].topDefeatReason)}”. Candidate for a rebalance pass.` }),
    })

    const worldRows: HBarRow[] = d.worldCompletion.map((w) => ({ label: w.realm, value: w.completed, sub: `${fmtInt(w.completed)} / ${fmtInt(w.started)} started`, drill: `world:${w.realm}` }))
    const worldCard = card({ title: 'Completion by world', subtitle: 'Players who finished each realm', body: hBars({ rows: worldRows, format: fmtInt, max: Math.max(...d.worldCompletion.map((w) => w.started)) }) })

    const defeatCard = card({
      title: 'Why players lose',
      subtitle: 'Defeat-diagnoser reasons across all runs — our unique tuning signal',
      body: barChart({ series: [{ name: 'Defeats', values: d.defeatReasons.map((x) => x.count), color: PALETTE.rose }], labels: d.defeatReasons.map((x) => x.reason.split(' ').slice(0, 2).join(' ')), yFormat: fmtInt, aria: 'defeat reasons' }),
    })

    return (
      sectionHeader('Retention & Funnel', 'Do they come back, and where do they stop? Cohort retention, the activation funnel, and per-level drop-off.') +
      kpis +
      grid(cohortCard + funnelCard) +
      levelCard +
      grid(worldCard + defeatCard)
    )
  },
  mount(root: HTMLElement): void {
    root.querySelectorAll('[data-drill]').forEach((el) => {
      el.addEventListener('click', () => {
        const key = (el as HTMLElement).dataset.drill ?? ''
        toast(`Drilldown: ${key} — per-level start/complete/abandon + defeat breakdown would open here.`, 'info')
      })
    })
  },
}
