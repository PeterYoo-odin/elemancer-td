// VIEW 4 — LEADERBOARD / LIVE-OPS. Leaderboard health, daily/weekly seed
// participation, event status, and the live-ops CONTROL surface: feature-flag +
// event kill-switches (read by the client at boot — no redeploy to react to an
// incident) and seed-rotation actions. Controls persist locally and push through
// the backend seam when configured.

import type { View, ViewCtx } from './view'
import { getLiveOps } from '../data'
import { card, statTile, grid, badge, sectionHeader, toggleRow, callout, table, toast, type Column } from '../ui'
import { lineChart, barChart, progressBar } from '../charts'
import { fmtInt, fmtCompact, fmtPct, fmtAgo, PALETTE, esc } from '../theme'
import { FLAG_DEFS, loadFlags, saveFlags, adminPost, type FlagState, type FlagDef } from '../config'
import { raiseAlert } from '../alerts'

interface RotationRow {
  kind: 'daily' | 'weekly'
  current: string
  rotatedAt: number
  by: string
}

export const liveopsView: View = {
  id: 'liveops',
  label: 'Leaderboard & Live-Ops',
  icon: '🎛️',
  async render(ctx: ViewCtx): Promise<string> {
    const d = await getLiveOps(ctx.session, ctx.range, ctx.now)
    const flags = loadFlags()
    const total = d.verified + d.pending + d.rejected

    const kpis = grid(
      [
        statTile({ label: 'Runs verified', value: fmtCompact(d.verified), tone: 'ok', hint: 'Passed server re-simulation' }),
        statTile({ label: 'Pending verify', value: fmtInt(d.pending), tone: d.pending > 150 ? 'warn' : 'neutral', hint: 'In the verifier queue' }),
        statTile({ label: 'Rejected', value: fmtInt(d.rejected), tone: 'danger', hint: 'Failed re-sim / plausibility' }),
        statTile({ label: 'Median verify latency', value: d.verifyLatencyMs + 'ms', hint: 'Time to re-simulate a run' }),
        statTile({ label: 'Event participants', value: fmtCompact(d.event.participants), hint: d.event.name }),
        statTile({ label: 'Suspicious in top-100', value: String(d.boardHealth.suspiciousInTop100), tone: d.boardHealth.suspiciousInTop100 > 0 ? 'warn' : 'ok' }),
      ].join(''),
      'grid grid--6',
    )

    const healthCard = card({
      title: 'Leaderboard health',
      subtitle: `${fmtPct(d.verified / total, 1)} verified · ${fmtPct(d.rejected / total, 2)} rejected — the provably-fair board`,
      body:
        `<div class="verify-bar">
          <div style="flex:${d.verified};background:${PALETTE.green}" title="Verified"></div>
          <div style="flex:${d.pending};background:${PALETTE.amber}" title="Pending"></div>
          <div style="flex:${d.rejected};background:${PALETTE.rose}" title="Rejected"></div>
        </div>
        <div class="verify-legend"><span><i style="background:${PALETTE.green}"></i>Verified ${fmtInt(d.verified)}</span><span><i style="background:${PALETTE.amber}"></i>Pending ${fmtInt(d.pending)}</span><span><i style="background:${PALETTE.rose}"></i>Rejected ${fmtInt(d.rejected)}</span></div>` +
        callout({ title: 'Our integrity wedge', tone: 'ok', icon: '🛡️', body: `Every top-N and daily-seed run is <b>re-simulated server-side</b> from its seed + input log. A forged score literally cannot reproduce — so unlike heuristic-only boards (BTD6-class), we can <b>prove</b> a score, not just doubt it. Top score ${d.boardHealth.topScore} · median top-100 ${d.boardHealth.medianTop100}.` }),
    })

    const dailyCard = card({
      title: 'Daily-seed participation',
      subtitle: 'Players on the shared daily challenge',
      body: lineChart({ series: [{ name: 'Daily players', values: d.dailyParticipation, color: PALETTE.teal }], labels: d.dailyLabels, area: true, yFormat: fmtCompact, aria: 'daily seed participation' }),
    })
    const weeklyCard = card({
      title: 'Weekly-seed participation',
      subtitle: `This week: ${esc(d.weeklySeed.seed)} · ${esc(d.weeklySeed.mutator)}`,
      body: barChart({ series: [{ name: 'Players', values: d.weeklyParticipation.map((w) => w.players), color: PALETTE.violet }], labels: d.weeklyParticipation.map((w) => w.week), yFormat: fmtCompact, aria: 'weekly seed participation' }),
    })

    // Event status
    const ev = d.event
    const eventCard = card({
      title: 'Event status',
      subtitle: 'Live-ops content calendar',
      body:
        `<div class="event-row">
          <div class="event-name">🔥 ${esc(ev.name)} ${badge(ev.status.toUpperCase(), ev.status === 'live' ? 'ok' : ev.status === 'scheduled' ? 'info' : 'muted')}</div>
          <div class="event-meta">${fmtCompact(ev.participants)} participants · ends in ${ev.endsInDays}d</div>
          <div class="event-completion"><span>Completion</span>${progressBar(ev.completion, { color: PALETTE.orange })}<span>${fmtPct(ev.completion, 0)}</span></div>
        </div>`,
    })

    // Seed rotation controls
    const rotCols: Column<RotationRow>[] = [
      { header: 'Seed', cell: (r) => `${badge(r.kind, 'info')} <code>${esc(r.current)}</code>` },
      { header: 'Rotated', cell: (r) => `<span class="dim">${esc(fmtAgo(r.rotatedAt, ctx.now))} · ${esc(r.by)}</span>` },
      { header: 'Action', cell: (r) => `<button class="btn btn--sm" data-rotate="${esc(r.kind)}">Rotate ${esc(r.kind)} now</button>`, align: 'right' },
    ]
    const rotationCard = card({
      title: 'Seed rotation',
      subtitle: 'Rotate the shared daily/weekly seed (a live-ops control — never re-architects seed generation)',
      body: table<RotationRow>(rotCols, d.seedRotations),
    })

    // Feature flags / kill switches, grouped
    const groups: Record<FlagDef['group'], FlagDef[]> = { store: [], growth: [], events: [], safety: [] }
    for (const f of FLAG_DEFS) groups[f.group].push(f)
    const groupTitle: Record<FlagDef['group'], string> = { store: 'Store & monetization', growth: 'Growth loops', events: 'Events & seeds', safety: 'Safety & integrity' }
    const flagsBody = (Object.keys(groups) as FlagDef['group'][])
      .map((g) => `<div class="flag-group"><h4>${esc(groupTitle[g])}</h4>${groups[g].map((f) => toggleRow({ id: f.id, label: f.label, sub: f.sub, on: flags[f.id], locked: false })).join('')}</div>`)
      .join('')
    const flagsCard = card({
      title: 'Feature flags & kill switches',
      subtitle: 'Minimum-viable live-ops — read by the client at boot, no redeploy to react to an incident',
      span: 2,
      body: flagsBody,
    })

    return (
      sectionHeader('Leaderboard & Live-Ops', 'Board health on our provably-fair core, seed participation, event status, and the control surface — flags, kill-switches and seed rotation.') +
      kpis +
      grid(healthCard + eventCard) +
      grid(dailyCard + weeklyCard) +
      grid(rotationCard + card({ title: 'Live-ops note', body: callout({ title: 'React without a redeploy', tone: 'info', icon: '⚡', body: 'Flags below are config rows the client reads at boot. In an incident (exploit, payment outage, cheat wave) flip <b>Ranked submissions</b> or the emergency <b>Freeze leaderboard</b> switch and the live game reacts on next boot — no build lane needed.' }) })) +
      flagsCard
    )
  },
  mount(root: HTMLElement, ctx: ViewCtx, rerender: () => void): void {
    // Feature-flag toggles
    root.querySelectorAll<HTMLButtonElement>('[data-toggle]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.toggle!
        const def = FLAG_DEFS.find((f) => f.id === id)
        const flags: FlagState = loadFlags()
        const next = !flags[id]
        flags[id] = next
        saveFlags(flags)
        // Push through the backend seam (no-op without a backend).
        await adminPost(ctx.session, '/flags', { id, on: next })
        // The emergency freeze is a high-signal event → alert.
        if (id === 'leaderboard_freeze' && next) {
          await raiseAlert(ctx.session, { severity: 'critical', kind: 'kill-switch', title: 'Leaderboard FROZEN', detail: 'An operator engaged the emergency leaderboard freeze — all board writes stopped.' })
        } else if (id === 'ranked_submissions' && !next) {
          await raiseAlert(ctx.session, { severity: 'warn', kind: 'kill-switch', title: 'Ranked submissions paused', detail: 'An operator paused ranked submissions.' })
        } else {
          toast(`${def?.label ?? id} → ${next ? 'ON' : 'OFF'}${ctx.session.mode === 'live' ? ' (pushed)' : ' (local — no backend)'}`, next ? 'ok' : 'warn')
        }
        rerender()
      })
    })
    // Seed rotation
    root.querySelectorAll<HTMLButtonElement>('[data-rotate]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const kind = btn.dataset.rotate as 'daily' | 'weekly'
        const res = await adminPost(ctx.session, '/seed/rotate', { kind })
        toast(`Rotated ${kind} seed${res.ok ? ' (pushed to backend)' : ' (queued locally — no backend)'}`, 'ok')
      })
    })
  },
}
