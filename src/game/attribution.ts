// ATTRIBUTION — the frictionless-funnel capture shim. A shared/ad/social link
// drops the player STRAIGHT into playable game; on first load we snapshot the
// marketing params (?ref= · ?utm_* · ?campaign= · ?src= · ?c=) and persist them
// so the ranked backend can attribute the player at account-creation time.
//
// FIRST-TOUCH wins: the params are frozen on the very first visit that carried
// any, so a later organic reload never overwrites how the player arrived.
// Everything is view-side + localStorage; DOM access lives only inside these
// functions (the file stays importable by headless checks). Never throws.

const ATTR_KEY = 'chromancer_attribution_v1'

export interface Attribution {
  ref: string // ?ref= referral code that brought them ('' = organic)
  utmSource: string // ?utm_source=  (e.g. yt_shorts)
  utmMedium: string // ?utm_medium=  (e.g. social)
  utmCampaign: string // ?utm_campaign= or ?campaign=
  utmContent: string // ?utm_content=
  utmTerm: string // ?utm_term=
  src: string // ?src= shorthand (playbook link shape)
  c: string // ?c= campaign shorthand (playbook link shape)
  landedAt: string // ISO timestamp of first attributed landing
  landingPath: string // pathname the player first landed on (/, /landing, …)
}

function empty(): Attribution {
  return {
    ref: '', utmSource: '', utmMedium: '', utmCampaign: '', utmContent: '',
    utmTerm: '', src: '', c: '', landedAt: '', landingPath: '',
  }
}

function read(): Attribution {
  try {
    const raw = localStorage.getItem(ATTR_KEY)
    if (!raw) return empty()
    const o = JSON.parse(raw) as Partial<Attribution>
    const d = empty()
    for (const k of Object.keys(d) as Array<keyof Attribution>) {
      if (typeof o[k] === 'string') d[k] = o[k] as string
    }
    return d
  } catch {
    return empty()
  }
}

function write(a: Attribution): void {
  try {
    localStorage.setItem(ATTR_KEY, JSON.stringify(a))
  } catch {
    // private mode / quota — attribution just won't persist; play is unaffected.
  }
}

/** Has a first-touch attribution already been frozen? */
export function hasAttribution(): boolean {
  const a = read()
  return a.landedAt !== ''
}

/** The frozen first-touch attribution (empty fields if the player arrived cold). */
export function getAttribution(): Attribution {
  return read()
}

/** The inbound referral code, if this player arrived via someone's ?ref= link. */
export function getReferrer(): string {
  return read().ref
}

// keep a value safe for storage/telemetry: printable, trimmed, length-capped
function clean(v: string | null): string {
  if (!v) return ''
  return v.replace(/[^\w.\-:+]/g, '').slice(0, 64)
}

/**
 * Capture marketing params on landing and FREEZE them first-touch. Safe to call
 * on every entry point (game + landing) every load — it only writes the first
 * time params are seen. Returns the (possibly newly-frozen) attribution.
 */
export function captureAttribution(search?: string, path?: string): Attribution {
  const existing = read()
  // Already frozen once? First-touch is sacred — never overwrite it.
  if (existing.landedAt !== '') return existing
  try {
    const q = new URLSearchParams(
      search ?? (typeof location !== 'undefined' ? location.search : ''),
    )
    const ref = clean(q.get('ref'))
    const utmSource = clean(q.get('utm_source'))
    const utmMedium = clean(q.get('utm_medium'))
    const utmCampaign = clean(q.get('utm_campaign') || q.get('campaign'))
    const utmContent = clean(q.get('utm_content'))
    const utmTerm = clean(q.get('utm_term'))
    const src = clean(q.get('src'))
    const c = clean(q.get('c'))
    // Nothing marketing-relevant on this URL → stay unfrozen so a later
    // attributed visit can still be the first-touch.
    if (!ref && !utmSource && !utmMedium && !utmCampaign && !utmContent && !utmTerm && !src && !c) {
      return existing
    }
    const a: Attribution = {
      ref, utmSource, utmMedium, utmCampaign, utmContent, utmTerm, src, c,
      landedAt: new Date().toISOString(),
      landingPath: path ?? (typeof location !== 'undefined' ? location.pathname : ''),
    }
    write(a)
    return a
  } catch {
    return existing
  }
}

/**
 * BACKEND SEAM — hand the frozen attribution to the accounts/ranked backend at
 * account creation so admin can attribute the player. Degrades to a no-op when
 * no endpoint is configured (window.__CHROMANCER_BACKEND__), so local-only play
 * never blocks on a network round-trip.
 */
export function reportAttribution(): void {
  try {
    const backend = (window as unknown as { __CHROMANCER_BACKEND__?: string }).__CHROMANCER_BACKEND__
    if (!backend) return
    const a = read()
    if (a.landedAt === '') return
    void fetch(`${backend.replace(/\/$/, '')}/attribution`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(a),
      keepalive: true,
    }).catch(() => { /* fire-and-forget; attribution stays in localStorage */ })
  } catch {
    // no window / blocked — local attribution remains for the next attempt.
  }
}
