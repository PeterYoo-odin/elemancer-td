// ADMIN ALERTS — the high-signal security event channel. Alerts route to Slack
// via the BACKEND bridge (never a browser→Slack call: that would leak the webhook
// secret and trip CORS). The client POSTs the event to ${backend}/admin/alert and
// the server forwards it to the existing Slack bridge. When no backend is
// configured, alerts degrade gracefully to an in-dashboard feed + console log so
// the operator still sees every high-signal event.
//
// What fires an alert (per the research spec): verifier rejection-rate spike,
// submission-rate anomaly, off-origin API-call volume (clone signal), scraping
// bursts, DAU anomaly, payment/card-testing patterns.

import { adminPost, type AdminSession } from './config'
import { fmtAgo, esc } from './theme'
import { toast } from './ui'

export type AlertSeverity = 'info' | 'warn' | 'critical'
export interface AlertEvent {
  id: string
  ts: number
  severity: AlertSeverity
  kind: string
  title: string
  detail: string
  routedToSlack: boolean
  acked: boolean
}

const FEED_KEY = 'chromancer_admin_alertfeed_v1'
let feed: AlertEvent[] = load()

function load(): AlertEvent[] {
  try {
    const raw = localStorage.getItem(FEED_KEY)
    if (!raw) return seedFeed()
    const arr = JSON.parse(raw) as AlertEvent[]
    return Array.isArray(arr) ? arr.slice(0, 60) : seedFeed()
  } catch {
    return seedFeed()
  }
}
function persist(): void {
  try {
    localStorage.setItem(FEED_KEY, JSON.stringify(feed.slice(0, 60)))
  } catch {
    /* ignore */
  }
}

// A few pre-populated events so the feed is legible on first open (demo).
function seedFeed(): AlertEvent[] {
  const now = Date.now()
  const mk = (min: number, severity: AlertSeverity, kind: string, title: string, detail: string, slack: boolean): AlertEvent => ({
    id: `seed_${kind}_${min}`,
    ts: now - min * 60_000,
    severity,
    kind,
    title,
    detail,
    routedToSlack: slack,
    acked: false,
  })
  return [
    mk(18, 'critical', 'verify-spike', 'Verifier rejection-rate spike', 'Rejection rate hit 6.2% (baseline 1.3%) over the last hour — 41 top-N runs failed re-simulation.', true),
    mk(94, 'warn', 'submission-anomaly', 'Submission-rate anomaly', 'Ranked submissions 3.1× baseline for 2h — possible bot burst or campaign spike.', true),
    mk(210, 'critical', 'clone-signal', 'Off-origin API volume', '2,140 API calls with Origin ≠ chromancer.io from tdgames-free.example (site-lock phone-home).', true),
    mk(360, 'warn', 'scrape-burst', 'Asset scraping burst', 'Sequential pull of 812 sprite/audio assets in 22s from AS15169 — rate-limited.', true),
    mk(600, 'info', 'dau-note', 'DAU +18% vs 7-day avg', 'Emberwaste event + creator campaign correlating with acquisition lift.', false),
  ]
}

export function getFeed(): AlertEvent[] {
  return feed.slice()
}
export function unackedCount(): number {
  return feed.filter((a) => !a.acked && a.severity !== 'info').length
}
export function ack(id: string): void {
  const a = feed.find((x) => x.id === id)
  if (a) {
    a.acked = true
    persist()
  }
}
export function ackAll(): void {
  feed.forEach((a) => (a.acked = true))
  persist()
}

/**
 * Raise a high-signal alert. Routes to Slack via the backend bridge when
 * configured; always records to the in-dashboard feed + logs. Returns the event.
 */
export async function raiseAlert(
  session: AdminSession,
  ev: { severity: AlertSeverity; kind: string; title: string; detail: string },
): Promise<AlertEvent> {
  const evt: AlertEvent = {
    id: `alert_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
    ts: Date.now(),
    severity: ev.severity,
    kind: ev.kind,
    title: ev.title,
    detail: ev.detail,
    routedToSlack: false,
    acked: false,
  }
  // Backend bridge → Slack. Degrades to no-op (feed still records it).
  const res = await adminPost(session, '/alert', {
    severity: ev.severity,
    kind: ev.kind,
    title: ev.title,
    detail: ev.detail,
    channel: '#chromancer-security',
  })
  evt.routedToSlack = res.ok
  feed.unshift(evt)
  feed = feed.slice(0, 60)
  persist()
  // eslint-disable-next-line no-console
  console.info(`[chromancer-alert:${ev.severity}] ${ev.title} — ${ev.detail}${res.ok ? ' (→ Slack)' : ' (feed only)'}`)
  toast(res.ok ? `Alert sent to Slack: ${ev.title}` : `Alert logged (no backend): ${ev.title}`, ev.severity === 'critical' ? 'danger' : ev.severity === 'warn' ? 'warn' : 'info')
  return evt
}

/** Render the alert feed list (used by the security view + the top bell). */
export function renderFeed(now: number): string {
  const items = feed.slice(0, 30)
  if (!items.length) return '<div class="empty-row">No alerts.</div>'
  return (
    '<ul class="alert-feed">' +
    items
      .map(
        (a) => `<li class="alert-item alert--${a.severity}${a.acked ? ' acked' : ''}">
      <span class="alert-dot"></span>
      <div class="alert-main">
        <div class="alert-title">${esc(a.title)} ${a.routedToSlack ? '<span class="alert-slack">→ Slack</span>' : '<span class="alert-local">feed-only</span>'}</div>
        <div class="alert-detail">${esc(a.detail)}</div>
        <div class="alert-meta">${esc(a.kind)} · ${esc(fmtAgo(a.ts, now))}</div>
      </div>
      ${a.acked ? '' : `<button class="alert-ack" data-ack="${esc(a.id)}">ack</button>`}
    </li>`,
      )
      .join('') +
    '</ul>'
  )
}
