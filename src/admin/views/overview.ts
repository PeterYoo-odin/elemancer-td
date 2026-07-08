// VIEW 1 — ACQUISITION & PLAYERS. "Who's downloading / playing." Installs & new
// players over time by source/campaign, the referral tree + k-factor, DAU/WAU/MAU
// + stickiness, session length, coarse geo, and platform split.

import type { View, ViewCtx } from './view'
import { getOverview } from '../data'
import { card, statTile, grid, table, badge, sectionHeader, toast, type Column } from '../ui'
import { lineChart, barChart, hBars, donut, type HBarRow } from '../charts'
import { fmtInt, fmtCompact, fmtDuration, fmtPct, PALETTE, esc } from '../theme'
import type { SourceRow, ReferrerRow, GeoRow } from '../data'

export const overviewView: View = {
  id: 'overview',
  label: 'Acquisition & Players',
  icon: '📈',
  async render(ctx: ViewCtx): Promise<string> {
    const d = await getOverview(ctx.session, ctx.range, ctx.now)

    const kpis = grid(
      [
        statTile({ label: 'DAU', value: fmtInt(d.dau.value), delta: d.dau.delta, spark: d.dau.spark, hint: 'Daily active users' }),
        statTile({ label: 'WAU', value: fmtInt(d.wau.value), delta: d.wau.delta, spark: d.wau.spark, hint: 'Weekly active users' }),
        statTile({ label: 'MAU', value: fmtCompact(d.mau.value), delta: d.mau.delta, spark: d.mau.spark, hint: 'Monthly active users' }),
        statTile({ label: 'Stickiness', value: d.stickiness.value + '%', delta: d.stickiness.delta, hint: 'DAU / MAU ratio' }),
        statTile({ label: 'New players / day', value: fmtInt(d.newPlayers.value), delta: d.newPlayers.delta, spark: d.newPlayers.spark }),
        statTile({ label: 'Avg session', value: fmtDuration(d.avgSessionSec.value), delta: d.avgSessionSec.delta, spark: d.avgSessionSec.spark }),
      ].join(''),
      'grid grid--6',
    )

    const acquisitionChart = card({
      title: 'New vs returning players',
      subtitle: `Daily active split · last ${ctx.range} days`,
      body: barChart({ series: d.newVsReturning, labels: d.labels, stacked: true, yFormat: fmtCompact, aria: 'new vs returning players per day' }),
    })

    const dauChart = card({
      title: 'DAU trend',
      subtitle: `Total daily active · last ${ctx.range} days`,
      body: lineChart({ series: [{ name: 'DAU', values: d.dauSeries, color: PALETTE.teal }], labels: d.labels, area: true, yFormat: fmtCompact, aria: 'daily active users trend' }),
    })

    const sourceRows: HBarRow[] = d.sources.map((s) => ({ label: s.label, value: s.players, sub: `D1 ${fmtPct(s.d1, 0)} · act ${fmtPct(s.convToActivation, 0)}`, drill: `src:${s.key}` }))
    const sourcesCard = card({
      title: 'New players by source',
      subtitle: 'First-touch attribution (utm / ref / campaign / portal) — click a row to drill',
      body: hBars({ rows: sourceRows, format: fmtInt }),
    })

    const campaignRows: HBarRow[] = d.campaigns.map((c) => ({ label: c.name, value: c.players }))
    const campaignsCard = card({ title: 'By campaign', subtitle: '?utm_campaign= / ?c=', body: hBars({ rows: campaignRows, format: fmtInt }) })

    // Referral tree + k-factor
    const refCols: Column<ReferrerRow>[] = [
      { header: 'Referrer code', cell: (r) => `<code>${esc(r.code)}</code>` },
      { header: 'Invited', cell: (r) => fmtInt(r.invited), align: 'right' },
      { header: 'Activated', cell: (r) => fmtInt(r.activated), align: 'right' },
      { header: 'Ladder rung', cell: (r) => badge(r.tier, r.tier.startsWith('10') ? 'ok' : r.tier === '—' ? 'muted' : 'info') },
    ]
    const referralCard = card({
      title: 'Referral tree',
      subtitle: `k-factor ${d.referralTotals.kFactor} · ${fmtInt(d.referralTotals.invitesSent)} invites → ${fmtInt(d.referralTotals.friendsActivated)} activated`,
      body: table<ReferrerRow>(refCols, d.referrers, { empty: 'No referrals yet.' }),
    })

    // Geo (coarse, country-level only — no finer location)
    const geoCols: Column<GeoRow>[] = [
      { header: 'Country', cell: (g) => `<span class="cc">${esc(g.cc)}</span> ${esc(g.country)}` },
      { header: 'Players', cell: (g) => fmtInt(g.players), align: 'right' },
      { header: 'Share', cell: (g) => `<div class="mini-bar"><span style="width:${(g.share * 100).toFixed(0)}%;background:${PALETTE.sky}"></span></div> ${fmtPct(g.share, 0)}`, align: 'right' },
    ]
    const geoCard = card({ title: 'Geo (coarse)', subtitle: 'Country-level only — no finer location or PII', body: table<GeoRow>(geoCols, d.geo.slice(0, 10)) })

    const platformCard = card({
      title: 'Platform',
      subtitle: 'Web · installed PWA · portal embed',
      body: donut({ slices: d.platform.map((p, i) => ({ label: p.label, value: p.value, color: [PALETTE.teal, PALETTE.violet, PALETTE.amber][i] })), centerLabel: '100%', centerSub: 'sessions' }),
    })
    const osCard = card({ title: 'OS mix', subtitle: 'Coarse device class', body: hBars({ rows: d.os.map((o) => ({ label: o.label, value: o.value })), format: (v) => v + '%' }) })

    return (
      sectionHeader('Acquisition & Players', 'Who is downloading and playing — installs, sources, referrals, engagement and reach.') +
      kpis +
      grid(acquisitionChart + dauChart) +
      grid(sourcesCard + campaignsCard) +
      grid(referralCard + geoCard) +
      grid(platformCard + osCard)
    )
  },
  mount(root: HTMLElement): void {
    root.querySelectorAll('[data-drill]').forEach((el) => {
      el.addEventListener('click', () => {
        const key = (el as HTMLElement).dataset.drill ?? ''
        toast(`Drilldown: ${key.replace('src:', 'source ')} — cohort breakdown (retention · LTV) would open here.`, 'info')
      })
    })
  },
}
