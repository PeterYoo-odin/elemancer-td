// VIEW 5 — SECURITY / INTEGRITY (the headline ask: "someone copying the IP /
// cheating"). Three planes:
//   A. ANTI-CHEAT — surface the ranked replay-verify results: rejected/mismatched
//      runs, impossible scores, submission-rate spikes; a flag/watchlist workflow.
//   B. ABUSE / SCRAPING — anomalous access (rapid asset/API pulls, hotlinking,
//      odd UAs/referrers, bulk enumeration), rate-limit signals, asset integrity.
//   C. IP-PROTECTION POSTURE — what's inspectable client-side vs what the SERVER
//      protects (re-sim = scores can't be forged even if the code is copied),
//      asset watermarking, ToS — plus the live attempted-clone/scrape feed.
// High-signal events route to Slack via the backend bridge (alerts.ts).

import type { View, ViewCtx } from './view'
import {
  getSecurity,
  type SecurityData,
  type SuspectAccount,
  type ScrapeSignal,
  type CloneSignal,
  type AssetIntegrityRow,
} from '../data'
import { card, statTile, grid, table, badge, sectionHeader, callout, defList, toast, type Column, type BadgeTone } from '../ui'
import { barChart, hBars, lineChart, type HBarRow } from '../charts'
import { fmtInt, fmtCompact, fmtPct, fmtAgo, PALETTE, STATUS, INK, esc } from '../theme'
import { raiseAlert, renderFeed, ack } from '../alerts'
import { adminPost } from '../config'

function sevTone(s: 'low' | 'med' | 'high'): BadgeTone {
  return s === 'high' ? 'danger' : s === 'med' ? 'warn' : 'muted'
}
function statusTone(s: SuspectAccount['status']): BadgeTone {
  return s === 'flagged' ? 'danger' : s === 'shadow' ? 'warn' : s === 'watch' ? 'info' : 'muted'
}

export const securityView: View = {
  id: 'security',
  label: 'Security & Integrity',
  icon: '🛡️',
  async render(ctx: ViewCtx): Promise<string> {
    const d: SecurityData = await getSecurity(ctx.session, ctx.now)
    const vt = d.verifyTotals
    const verifyTotal = vt.verified + vt.pending + vt.rejected

    const kpis = grid(
      [
        statTile({ label: 'Runs verified today', value: fmtCompact(d.runsVerifiedToday), tone: 'ok', hint: 'Passed server re-simulation' }),
        statTile({ label: 'Rejection rate', value: fmtPct(d.rejectionRatePct / 100, 2), tone: d.rejectionRatePct > 3 ? 'danger' : d.rejectionRatePct > 1.8 ? 'warn' : 'ok', hint: 'Rejected / (verified + rejected)' }),
        statTile({ label: 'Median verify', value: d.medianVerifyMs + 'ms', hint: 'Re-simulation latency' }),
        statTile({ label: 'Suspicious accounts', value: String(d.suspects.filter((s) => s.status !== 'cleared').length), tone: 'warn', hint: 'On the integrity watchlist' }),
        statTile({ label: 'Off-origin API calls', value: fmtCompact(d.offOriginCallsToday), tone: d.offOriginCallsToday > 3000 ? 'danger' : 'warn', hint: 'Origin ≠ chromancer.io (clone signal)' }),
        statTile({ label: 'Impossible scores', value: String(d.impossibleScores.length), tone: d.impossibleScores.length ? 'danger' : 'ok', hint: 'Claims above theoretical ceiling' }),
      ].join(''),
      'grid grid--6',
    )

    // ---- Plane A: anti-cheat ------------------------------------------------
    const verifyCard = card({
      title: 'Replay-verify results',
      subtitle: `${fmtPct(vt.verified / verifyTotal, 2)} verified · ${fmtInt(vt.rejected)} rejected — every ranked run re-simulated from seed + input log`,
      body:
        `<div class="verify-bar">
          <div style="flex:${vt.verified};background:${PALETTE.green}" title="Verified ${vt.verified}"></div>
          <div style="flex:${vt.pending};background:${PALETTE.amber}" title="Pending ${vt.pending}"></div>
          <div style="flex:${vt.rejected};background:${PALETTE.rose}" title="Rejected ${vt.rejected}"></div>
        </div>
        <div class="verify-legend"><span><i style="background:${PALETTE.green}"></i>Verified ${fmtInt(vt.verified)}</span><span><i style="background:${PALETTE.amber}"></i>Pending ${fmtInt(vt.pending)}</span><span><i style="background:${PALETTE.rose}"></i>Rejected ${fmtInt(vt.rejected)}</span></div>`,
    })

    const reasonCard = card({
      title: 'Rejection reasons',
      subtitle: 'Why runs failed verification — an impossible score cannot re-simulate',
      body: hBars({ rows: d.rejectionReasons.map((r) => ({ label: r.reason, value: r.count, color: PALETTE.rose } as HBarRow)), format: fmtInt }),
    })

    // submission-rate spike detector
    const spikeIdx = d.submissionRate.reduce((mi, v, i, a) => (v > a[mi] ? i : mi), 0)
    const submissionCard = card({
      title: 'Submission-rate monitor',
      subtitle: `Ranked runs/hour · last 48h — baseline ~${d.submissionBaseline}/h. A sustained spike = bot burst or campaign.`,
      span: 2,
      body: lineChart({
        series: [
          { name: 'Runs/hour', values: d.submissionRate, color: PALETTE.teal },
          { name: 'Baseline', values: d.submissionRate.map(() => d.submissionBaseline), color: INK.faint },
        ],
        labels: d.submissionLabels,
        yFormat: fmtInt,
        aria: 'submission rate per hour',
      }) + `<div class="bench-row">Peak ${fmtInt(d.submissionRate[spikeIdx])}/h at ${esc(d.submissionLabels[spikeIdx])} ago — ${(d.submissionRate[spikeIdx] / d.submissionBaseline).toFixed(1)}× baseline.</div>`,
    })

    const impCols: Column<SecurityData['impossibleScores'][number]>[] = [
      { header: 'Account', cell: (r) => `<code>${esc(r.acct)}</code>` },
      { header: 'Claimed', cell: (r) => `<b style="color:${STATUS.danger}">${fmtInt(r.claimed)}</b>`, align: 'right' },
      { header: 'Ceiling', cell: (r) => fmtInt(r.ceiling), align: 'right' },
      { header: 'Seed', cell: (r) => `<code>${esc(r.seed)}</code>` },
      { header: 'When', cell: (r) => `<span class="dim">${esc(fmtAgo(r.ms, ctx.now))}</span>` },
    ]
    const impossibleCard = card({
      title: 'Impossible scores',
      subtitle: 'Claims above the theoretical wave ceiling — auto-rejected, then flagged',
      body: table(impCols, d.impossibleScores, { empty: 'None — the board is clean.', rowClass: () => 'row-danger' }),
    })

    // Suspicious-account watchlist with flag/shadow/clear actions
    const suspectCols: Column<SuspectAccount>[] = [
      { header: 'Account', cell: (s) => `<code>${esc(s.acct)}</code>` },
      { header: 'Risk', cell: (s) => `<span class="risk risk--${s.score >= 90 ? 'hi' : s.score >= 70 ? 'mid' : 'lo'}">${s.score}</span>`, align: 'center', width: '64px' },
      { header: 'Signals', cell: (s) => s.flags.map((f) => `<span class="flagchip">${esc(f)}</span>`).join(' ') },
      { header: 'Reason', cell: (s) => `<span class="dim">${esc(s.reason)}</span>` },
      { header: 'Status', cell: (s) => badge(s.status, statusTone(s.status)) },
      {
        header: 'Action',
        cell: (s) =>
          `<div class="act-group">
            <button class="btn btn--sm btn--danger" data-flag="${esc(s.acct)}" title="Flag account (removes from board, resets ranked stats)">flag</button>
            <button class="btn btn--sm" data-shadow="${esc(s.acct)}" title="Shadow-remove from the public board pending review">shadow</button>
            <button class="btn btn--sm btn--ghost" data-clear="${esc(s.acct)}" title="Clear — false positive">clear</button>
          </div>`,
        align: 'right',
        width: '190px',
      },
    ]
    const watchlistCard = card({
      title: 'Suspicious-account watchlist',
      subtitle: 'Behavioral + cluster signals a re-sim alone can’t catch (a bot’s run is a real run). Flag → shadow-remove → human review → confirm.',
      span: 2,
      body: table<SuspectAccount>(suspectCols, d.suspects, { rowClass: (s) => (s.status === 'flagged' ? 'row-danger' : '') }),
    })

    // ---- Plane B: abuse / scraping -----------------------------------------
    const scrapeCols: Column<ScrapeSignal>[] = [
      { header: 'Signal', cell: (s) => `${badge(s.severity, sevTone(s.severity))} <b>${esc(s.kind)}</b>` },
      { header: 'Detail', cell: (s) => `<span class="dim">${esc(s.detail)}</span>` },
      { header: 'Source', cell: (s) => `<code>${esc(s.source)}</code>` },
      { header: 'Count', cell: (s) => fmtInt(s.count), align: 'right' },
      { header: 'Last', cell: (s) => `<span class="dim">${esc(fmtAgo(s.lastMs, ctx.now))}</span>` },
      { header: '', cell: (s) => `<button class="btn btn--sm" data-alert-scrape="${esc(s.id)}" title="Send to Slack security channel">alert</button>`, align: 'right' },
    ]
    const scrapeCard = card({
      title: 'Abuse & scraping signals',
      subtitle: 'Rapid asset/API pulls, hotlinking, bulk enumeration, odd user-agents — the scraper/clone-harvest defense',
      span: 2,
      body: table<ScrapeSignal>(scrapeCols, d.scrapeSignals, { rowClass: (s) => (s.severity === 'high' ? 'row-danger' : '') }),
    })

    const rateCard = card({
      title: 'Rate-limit trips',
      subtitle: 'Per-IP/fingerprint 429s — last 24h (DDoS + scraper defense)',
      body: barChart({ series: [{ name: '429s', values: d.rateLimitTrips, color: PALETTE.orange }], labels: d.rateLimitLabels, yFormat: fmtInt, aria: 'rate limit trips' }),
    })

    const assetCols: Column<AssetIntegrityRow>[] = [
      { header: 'Asset', cell: (a) => `<code>${esc(a.asset)}</code>` },
      { header: 'Integrity', cell: (a) => badge(a.status, a.status === 'ok' ? 'ok' : a.status === 'served-elsewhere' ? 'warn' : 'danger') },
      { header: 'Watermark', cell: (a) => `<span class="dim">${esc(a.watermark)}</span>` },
    ]
    const assetCard = card({
      title: 'Asset integrity & watermarking',
      subtitle: 'Per-build watermark + hash — a rip’s source build is identifiable for DMCA',
      body: table<AssetIntegrityRow>(assetCols, d.assetIntegrity),
    })

    // ---- Plane C: IP-protection posture + clone feed ------------------------
    const cloneCols: Column<CloneSignal>[] = [
      { header: 'Host (re-hosted copy)', cell: (c) => `<code>${esc(c.host)}</code>` },
      { header: 'Referrer hits', cell: (c) => fmtInt(c.referrerHits), align: 'right' },
      { header: 'First seen', cell: (c) => `<span class="dim">${esc(fmtAgo(c.firstMs, ctx.now))}</span>` },
      { header: 'Status', cell: (c) => badge(c.status, c.status === 'removed' ? 'ok' : c.status === 'dmca-filed' ? 'info' : c.status === 'phone-home' ? 'danger' : 'warn') },
      { header: '', cell: (c) => `<button class="btn btn--sm btn--ghost" data-dmca="${esc(c.host)}">track DMCA</button>`, align: 'right' },
    ]
    const cloneCard = card({
      title: 'Attempted-clone / scrape watch',
      subtitle: 'Off-origin site-lock phone-home hits — a ripped client reports its host, giving us clone telemetry for free',
      span: 2,
      body: table<CloneSignal>(cloneCols, d.cloneSignals),
    })

    const postureCard = card({
      title: 'IP-protection posture',
      subtitle: 'A web game’s client is inherently inspectable. Here is what that means — and what actually protects us.',
      span: 2,
      body:
        callout({
          title: 'The server is the moat',
          tone: 'ok',
          icon: '🔒',
          body: `Chromancer’s sim is a <b>pure, seeded, deterministic</b> re-runnable simulation. Even if the entire client is copied, <b>scores can’t be forged</b>: the server re-simulates every ranked run from its seed + input log and rejects any mismatch. Determinism means openness costs us nothing — client knowledge is useless for cheating.`,
        }) +
        defList([
          { k: 'Exposed client-side (accept it)', v: 'Sim logic, art, audio, UI code — inspectable in any browser. Obfuscation only raises effort; we minify, bundle and <b>strip prod source maps</b>, and obfuscate only anti-cheat-adjacent bits (input recorder, site-lock).' },
          { k: 'Protected server-side (the moat)', v: 'Accounts, cloud saves, the <b>verified leaderboard</b>, daily/weekly <b>server-issued seeds</b>, events and the store. A ripped client is a hollow shell — no board, no seeds, no community.' },
          { k: 'API hardening', v: 'Origin allowlist + CORS + short-lived signed session tokens (a re-hosted copy gets 403s) and per-IP/fingerprint rate-limits (also the DDoS/scraper defense).' },
          { k: 'Site-lock phone-home', v: 'Off-list clients show “you’re playing a stolen copy — the real game is at chromancer.io” and log the referrer → the clone telemetry feed above.' },
          { k: 'Asset watermarking', v: 'Invisible per-build watermark + unique deployment fingerprint so a rip’s source build is identifiable in DMCA filings.' },
          { k: 'Takedown & legal', v: 'Scheduled title/unique-string search alerts, DMCA pipeline (~48h removals), portal-partner enforcement, clear ToS + key-art copyright.' },
        ]),
    })

    const alertsCard = card({
      title: 'Security alert feed',
      subtitle: 'High-signal events — routed to Slack (#chromancer-security) via the backend bridge when configured',
      span: 2,
      body: renderFeed(ctx.now),
    })

    const modeNote =
      ctx.session.mode === 'demo'
        ? callout({ title: 'Demo mode', tone: 'warn', icon: '🧪', body: 'No game backend is configured, so these integrity signals are <b>synthetic</b> (seeded, stable). With the ranked/accounts backend wired, this plane surfaces the real verifier queue, watchlist and clone feed, and alerts route to Slack.' })
        : ''

    return (
      sectionHeader('Security & Integrity', 'The “someone copying the IP / cheating” plane — replay-verify results, an abuse/scraping watch, and our IP-protection posture.') +
      modeNote +
      kpis +
      `<h3 class="plane-head">A · Anti-cheat</h3>` +
      grid(verifyCard + reasonCard) +
      submissionCard +
      grid(impossibleCard + card({ title: 'Verification ladder', body: verifyLadder() })) +
      watchlistCard +
      `<h3 class="plane-head">B · Abuse & scraping</h3>` +
      scrapeCard +
      grid(rateCard + assetCard) +
      `<h3 class="plane-head">C · IP protection</h3>` +
      cloneCard +
      postureCard +
      alertsCard
    )
  },
  mount(root: HTMLElement, ctx: ViewCtx, rerender: () => void): void {
    const act = async (acct: string, action: 'flag' | 'shadow' | 'clear'): Promise<void> => {
      await adminPost(ctx.session, '/integrity/account', { acct, action })
      if (action === 'flag') {
        await raiseAlert(ctx.session, { severity: 'critical', kind: 'account-flag', title: `Account flagged: ${acct}`, detail: 'Removed from the public board, ranked stats reset, blocked from competitive events pending appeal.' })
      } else {
        toast(`${acct} → ${action}${ctx.session.mode === 'live' ? ' (pushed)' : ' (local — no backend)'}`, action === 'shadow' ? 'warn' : 'ok')
      }
      rerender()
    }
    root.querySelectorAll<HTMLButtonElement>('[data-flag]').forEach((b) => b.addEventListener('click', () => void act(b.dataset.flag!, 'flag')))
    root.querySelectorAll<HTMLButtonElement>('[data-shadow]').forEach((b) => b.addEventListener('click', () => void act(b.dataset.shadow!, 'shadow')))
    root.querySelectorAll<HTMLButtonElement>('[data-clear]').forEach((b) => b.addEventListener('click', () => void act(b.dataset.clear!, 'clear')))
    root.querySelectorAll<HTMLButtonElement>('[data-alert-scrape]').forEach((b) =>
      b.addEventListener('click', () =>
        void raiseAlert(ctx.session, { severity: 'warn', kind: 'scrape-burst', title: 'Scraping signal escalated', detail: `Operator escalated scrape signal ${b.dataset.alertScrape} to the security channel.` }),
      ),
    )
    root.querySelectorAll<HTMLButtonElement>('[data-dmca]').forEach((b) =>
      b.addEventListener('click', () => {
        void adminPost(ctx.session, '/integrity/dmca', { host: b.dataset.dmca })
        toast(`DMCA case tracked for ${b.dataset.dmca}${ctx.session.mode === 'live' ? '' : ' (local)'}`, 'info')
      }),
    )
    root.querySelectorAll<HTMLButtonElement>('[data-ack]').forEach((b) =>
      b.addEventListener('click', () => {
        ack(b.dataset.ack!)
        rerender()
      }),
    )
  },
}

function verifyLadder(): string {
  const steps = [
    ['1 · Plausibility pre-filter', 'Instant bounds check: score vs wave count, run duration vs server-observed elapsed time, impossible DPS/economy.'],
    ['2 · Server re-simulation', 'Re-run seed + input log headlessly; byte-compare the final state hash. Reject on mismatch. 100% of top-N + daily seed; sample the tail.'],
    ['3 · Purchase-isolation', 'Reject any ranked run with a paid modifier active (constitution rule — a verifier assertion, not a policy).'],
    ['4 · Behavioral layer', 'Bot detection a re-sim can’t catch: superhuman APM regularity, zero-jitter placement, multi-account/one-device clusters, submission bursts.'],
    ['5 · Admin workflow', 'Flag → shadow-remove → review the replay in the actual game client → confirm = account flag + public rejected-runs counter++.'],
  ]
  return '<ol class="ladder">' + steps.map(([t, b]) => `<li><b>${esc(t)}</b><span>${esc(b)}</span></li>`).join('') + '</ol>'
}
