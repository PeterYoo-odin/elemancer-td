// VIEW 3 — ECONOMY & MONETIZATION. Diamonds/coins earned vs spent (faucets vs
// sinks), welcome-bundle claims, referral payouts, store views/conversions,
// Prism Pass progress, cosmetic adoption, and the (mock) revenue surface with
// chargeback/refund guards. The levers for "encourage spend, stay fair".

import type { View, ViewCtx } from './view'
import { getEconomy } from '../data'
import { card, statTile, grid, table, badge, sectionHeader, callout, type Column } from '../ui'
import { lineChart, barChart, hBars, progressBar, type HBarRow } from '../charts'
import { fmtInt, fmtCompact, fmtPct, fmtUsd, fmtUsdCompact, PALETTE, STATUS, esc } from '../theme'

interface PackRow {
  id: string
  usd: string
  units: number
  grossCents: number
}
interface CosmeticRow {
  id: string
  name: string
  owners: number
  adoption: number
}

export const economyView: View = {
  id: 'economy',
  label: 'Economy & Monetization',
  icon: '💎',
  async render(ctx: ViewCtx): Promise<string> {
    const d = await getEconomy(ctx.session, ctx.range, ctx.now)
    const grossTotal = d.grossRevenueCents.reduce((a, b) => a + b, 0)
    const faucetTotal = d.diamondsEarned.reduce((a, b) => a + b, 0)
    const sinkTotal = d.diamondsSpent.reduce((a, b) => a + b, 0)

    const kpis = grid(
      [
        statTile({ label: 'Gross revenue', value: fmtUsdCompact(grossTotal), delta: 0.14, spark: d.grossRevenueCents.slice(-12), hint: `MOCK until Stripe · last ${ctx.range}d` }),
        statTile({ label: 'ARPDAU', value: fmtUsd(d.arpdauCents.value), delta: d.arpdauCents.delta, spark: d.arpdauCents.spark, hint: 'Avg revenue per DAU (mock)' }),
        statTile({ label: 'Store conversion', value: d.storeConversion.value + '%', delta: d.storeConversion.delta, spark: d.storeConversion.spark, hint: 'Store views → purchase' }),
        statTile({ label: 'Welcome claims / day', value: fmtInt(d.welcomeClaims.value), delta: d.welcomeClaims.delta, spark: d.welcomeClaims.spark }),
        statTile({ label: 'Pass premium rate', value: fmtPct(d.passPremiumRate, 0), hint: 'Players who bought the premium pass' }),
        statTile({ label: 'Chargeback rate', value: fmtPct(d.chargebackRate, 2), tone: d.chargebackRate > 0.009 ? 'danger' : d.chargebackRate > 0.006 ? 'warn' : 'ok', hint: '>0.9% is the network danger line' }),
      ].join(''),
      'grid grid--6',
    )

    // Faucets vs sinks — the fairness-economy tuning surface.
    const faucetSinkNet = d.diamondsEarned.map((e, i) => e - d.diamondsSpent[i])
    const flowCard = card({
      title: 'Diamond faucets vs sinks',
      subtitle: `Earned ${fmtCompact(faucetTotal)} · spent ${fmtCompact(sinkTotal)} · net ${fmtCompact(faucetTotal - sinkTotal)} into circulation`,
      span: 2,
      body: lineChart({
        series: [
          { name: 'Earned (faucet)', values: d.diamondsEarned, color: PALETTE.green },
          { name: 'Spent (sink)', values: d.diamondsSpent, color: PALETTE.rose },
          { name: 'Net', values: faucetSinkNet, color: PALETTE.sky },
        ],
        labels: d.labels,
        yFormat: fmtCompact,
        aria: 'diamond faucets vs sinks',
      }),
    })

    const faucetBreakdown = card({ title: 'Faucets (where diamonds come from)', body: barChart({ series: d.faucets, labels: d.labels, stacked: true, yFormat: fmtCompact, aria: 'faucet breakdown' }) })
    const sinkBreakdown = card({ title: 'Sinks (where diamonds go)', body: barChart({ series: d.sinks, labels: d.labels, stacked: true, yFormat: fmtCompact, aria: 'sink breakdown' }) })

    // Revenue by pack (mock)
    const packCols: Column<PackRow>[] = [
      { header: 'Pack', cell: (p) => `<code>${esc(p.id)}</code> ${esc(p.usd)}` },
      { header: 'Units', cell: (p) => fmtInt(p.units), align: 'right' },
      { header: 'Gross', cell: (p) => fmtUsd(p.grossCents), align: 'right' },
    ]
    const packCard = card({
      title: 'Diamond pack sales',
      subtitle: 'MOCK — no card is charged (wire Stripe to go live)',
      body: table<PackRow>(packCols, d.packSales, { empty: 'No sales.' }),
    })

    // Cosmetic adoption
    const cosCols: Column<CosmeticRow>[] = [
      { header: 'Cosmetic', cell: (c) => esc(c.name) },
      { header: 'Owners', cell: (c) => fmtInt(c.owners), align: 'right' },
      { header: 'Adoption', cell: (c) => `<div class="cell-bar">${progressBar(c.adoption, { color: PALETTE.violet })}<span>${fmtPct(c.adoption, 0)}</span></div>`, align: 'right', width: '150px' },
    ]
    const cosmeticCard = card({ title: 'Cosmetic adoption', subtitle: 'Owners per SKU — merchandising signal (fair: cosmetics only)', body: table<CosmeticRow>(cosCols, d.topCosmetics) })

    // Prism pass progression distribution
    const passRows: HBarRow[] = d.passProgress.filter((_, i) => i % 3 === 0).map((t) => ({ label: `Tier ${t.tier}`, value: t.players }))
    const passCard = card({
      title: 'Prism Pass progression',
      subtitle: `S1 · Emberwaste Restoration — players by tier (advances by PLAY)`,
      body: hBars({ rows: passRows, format: fmtInt }),
    })

    // Balance distribution + fairness note
    const balCard = card({
      title: 'Diamond balance distribution',
      subtitle: 'How much soft currency players are holding',
      body: hBars({ rows: d.balanceDistribution.map((b) => ({ label: b.bucket, value: b.players })), format: fmtInt }),
    })

    const fairnessCallout = callout({
      title: 'Fairness guardrails (constitution)',
      tone: 'ok',
      icon: '⚖️',
      body: `Every SKU is cosmetic or casual-only convenience — <b>Ranked ignores all of it</b>. Diamonds are earnable free. Chargebacks auto-revoke purchased diamonds (never keep cosmetics on a chargeback). Refund policy: 14-day, unspent diamonds — cheaper than chargebacks and on-brand.`,
    })

    const refundCard = card({
      title: 'Refunds & chargebacks',
      subtitle: 'Payment-fraud guardrails (mock)',
      body:
        `<div class="dual-stat"><div><span class="ds-label">Refund rate</span><span class="ds-val">${fmtPct(d.refundRate, 1)}</span>${progressBar(d.refundRate, { warn: 0.03, danger: 0.05, color: STATUS.info })}</div>` +
        `<div><span class="ds-label">Chargeback rate</span><span class="ds-val" style="color:${d.chargebackRate > 0.009 ? STATUS.danger : STATUS.ok}">${fmtPct(d.chargebackRate, 2)}</span>${progressBar(d.chargebackRate / 0.012, { warn: 0.5, danger: 0.75 })}<small>network danger line 0.9%</small></div></div>`,
    })

    return (
      sectionHeader('Economy & Monetization', 'The levers for “encourage spend, stay fair” — faucets vs sinks, store conversion, pass progression and cosmetic adoption.') +
      kpis +
      flowCard +
      grid(faucetBreakdown + sinkBreakdown) +
      grid(passCard + cosmeticCard) +
      grid(packCard + balCard) +
      grid(refundCard + card({ title: 'Fairness posture', body: fairnessCallout }))
    )
  },
}
