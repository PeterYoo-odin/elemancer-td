// LOGON GAPS CHECK — unit proof for chromancer #60's code-fixable log-on gaps:
//   1. OAuth buttons are conditional on GoTrue's real provider settings, and
//      fail SAFE (hidden) on any fetch/parse failure or timeout — the fix for
//      the live "Continue with Google/Apple" → raw 400 dead-end.
//   2. The server-side handle sanitizer strips control/HTML-significant chars
//      a raw API caller could sneak past the client-side strip.
//   3. The /api/account rate limiter trips past its cap and fails OPEN if the
//      limiter itself throws (must never lock a player out of their account).
//
// Pure-logic checks in the qa-hub-check.ts style — no DOM/browser needed: the
// SignInModal render is a direct 1:1 mapping of ProviderFlags → button HTML
// (see oauthSectionHtml in src/ui/SignInModal.ts), so proving the flags is
// proving the buttons.
//
//   run:  npx tsx scripts/logoncheck.ts

import { providerFlagsFromSettings, resolveProviderFlags, HIDDEN } from '../src/game/authProviders'
import { rateLimited, sanitizeHandle } from '../server/account'

let failures = 0
function check(cond: boolean, msg: string): void {
  console.log(`  ${cond ? '✓' : '✗'} ${msg}`)
  if (!cond) failures++
}

// ---------------------------------------------------------------------------
// 1a. providerFlagsFromSettings — the pure parse (drives which buttons show).
// ---------------------------------------------------------------------------
console.log('providerFlagsFromSettings…')
check(
  providerFlagsFromSettings({ external: { google: true, apple: true, email: true } }).google === true &&
    providerFlagsFromSettings({ external: { google: true, apple: true, email: true } }).apple === true,
  'both providers enabled → both flags true (buttons SHOWN)',
)
check(
  providerFlagsFromSettings({ external: { google: false, apple: false, email: true } }).google === false &&
    providerFlagsFromSettings({ external: { google: false, apple: false, email: true } }).apple === false,
  'both providers disabled → both flags false (buttons HIDDEN) — the live bug this closes',
)
check(
  providerFlagsFromSettings({ external: { google: true, apple: false } }).google === true &&
    providerFlagsFromSettings({ external: { google: true, apple: false } }).apple === false,
  'mixed providers → independently reflected',
)
check(
  providerFlagsFromSettings(null).google === false && providerFlagsFromSettings(null).apple === false,
  'null body → HIDDEN (never guess a provider is live)',
)
check(
  providerFlagsFromSettings({}).google === false && providerFlagsFromSettings({}).apple === false,
  'missing `external` key → HIDDEN',
)
check(
  providerFlagsFromSettings({ external: { google: 'true' } }).google === false,
  'truthy-but-not-boolean value → HIDDEN (strict === true, no coercion)',
)

// ---------------------------------------------------------------------------
// 1b. resolveProviderFlags — the network wrapper's fail-safe behavior.
// ---------------------------------------------------------------------------
console.log('resolveProviderFlags…')

async function run(): Promise<void> {
  {
    const flags = await resolveProviderFlags('https://x.test', 'anon', async () =>
      new Response(JSON.stringify({ external: { google: true, apple: false } }), { status: 200 }),
    )
    check(flags.google === true && flags.apple === false, 'ok response → parsed flags shown/hidden per provider')
  }
  {
    const flags = await resolveProviderFlags('https://x.test', 'anon', async () => new Response('nope', { status: 500 }))
    check(flags.google === false && flags.apple === false, 'non-OK response (e.g. 500) → HIDDEN, never guess')
  }
  {
    const flags = await resolveProviderFlags('https://x.test', 'anon', async () => {
      throw new TypeError('offline')
    })
    check(flags.google === false && flags.apple === false, 'network throw (offline) → HIDDEN')
  }
  {
    const flags = await resolveProviderFlags('https://x.test', 'anon', async () => new Response('not json{', { status: 200 }))
    check(flags.google === false && flags.apple === false, 'malformed JSON body → HIDDEN')
  }
  {
    // Never resolves on its own; only settles if the AbortSignal fires — proves
    // the timeout path actually hides the buttons instead of hanging the caller.
    const hangingFetch = (async (_url: any, init?: any) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })) as typeof fetch
    const start = Date.now()
    const flags = await resolveProviderFlags('https://x.test', 'anon', hangingFetch, 50)
    check(flags.google === false && flags.apple === false, 'timeout → HIDDEN (never risk the OAuth dead-end)')
    check(Date.now() - start < 2000, 'timeout is actually bounded by timeoutMs, not left hanging')
  }
  check(HIDDEN.google === false && HIDDEN.apple === false, 'HIDDEN constant is the all-off default')

  // -------------------------------------------------------------------------
  // 2. Server-side handle sanitization — a raw API caller bypasses the
  //    client-side strip in registerHandle() entirely; op:register's old
  //    `slice(0, 24)` alone let control/HTML-significant chars through.
  // -------------------------------------------------------------------------
  console.log('sanitizeHandle…')
  check(sanitizeHandle('<script>alert(1)</script>') === 'scriptalert1script', 'strips HTML-significant chars')
  check(sanitizeHandle('bad\x00\x07\x1bname') === 'badname', 'strips control/escape chars')
  check(sanitizeHandle('Coolname_99') === 'Coolname_99', 'plain word chars pass through untouched')
  check(sanitizeHandle('a b-c') === 'a b-c', 'spaces and hyphens (client-allowed) still pass through')
  check(sanitizeHandle('x'.repeat(40)).length === 24, '24-char cap is preserved')
  check(sanitizeHandle('   ') === undefined, 'whitespace-only → undefined (no empty handle set)')
  check(sanitizeHandle('<<<>>>') === undefined, 'purely hostile input → undefined, not an empty string handle')

  // -------------------------------------------------------------------------
  // 3. /api/account rate limiter — per-IP AND per-device sliding window,
  //    fails OPEN on an internal error.
  // -------------------------------------------------------------------------
  console.log('rate limiter…')
  {
    // Fresh keys per assertion (module-level Map persists across calls in this
    // process) so the cap-crossing test starts from an empty window.
    const dev = `test-device-${Math.random().toString(36).slice(2)}`
    const fakeReq = { headers: { 'x-forwarded-for': '203.0.113.9' }, socket: { remoteAddress: '203.0.113.9' } }
    let blockedAt = -1
    for (let i = 0; i < 40; i++) {
      if (rateLimited(fakeReq, dev)) { blockedAt = i; break }
    }
    check(blockedAt !== -1, 'enough calls past the cap eventually return 429-worthy `true`')
    check(blockedAt >= 25 && blockedAt <= 31, `trips close to the documented cap (tripped at call #${blockedAt + 1})`)
  }
  {
    // A request object that THROWS when read (simulates a limiter-internal
    // bug) must fail OPEN — rateLimited() must swallow it and return false.
    const throwingReq = {
      get headers(): any { throw new Error('boom: limiter bug') },
    }
    let ok = true
    let result: boolean
    try {
      result = rateLimited(throwingReq, 'some-device')
    } catch {
      ok = false
      result = true
    }
    check(ok, 'a throwing request object never escapes rateLimited() as an exception')
    check(result === false, 'and resolves to NOT limited (fail OPEN) — a limiter bug can never lock a player out')
  }

  if (failures) {
    console.log(`\n${failures} check(s) FAILED`)
    process.exit(1)
  }
  console.log('\nAll logon-gap checks passed.')
}

run()
