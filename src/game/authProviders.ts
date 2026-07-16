// ============================================================================
//  AUTH PROVIDERS — pure decision logic for which OAuth sign-in buttons a
//  player should see, kept separate from authNet.ts's import.meta.env-gated
//  fetch wiring so it is trivially unit-testable (see scripts/logoncheck.ts).
//
//  WHY THIS EXISTS: GoTrue only lights up Google/Apple once they're toggled on
//  in Supabase. Hardcoding the buttons on means a disabled provider sends the
//  player through `signInWithOAuth` straight into a raw 400
//  `{"error_code":"validation_failed","msg":"Unsupported provider..."}` page —
//  a dead end that yeets them out of the game. Asking GoTrue's own
//  `/auth/v1/settings` first (readable with the anon key) means the buttons
//  self-heal the moment a provider is enabled, with zero redeploy.
// ============================================================================

export interface ProviderFlags {
  google: boolean
  apple: boolean
}

/** The fail-safe default: no OAuth affordance. Magic-link email is never
 *  gated by this — it's handled independently and always available. */
export const HIDDEN: ProviderFlags = { google: false, apple: false }

/** Parse GoTrue's `/auth/v1/settings` body (`{ external: { google, apple, ... } }`)
 *  into the flags we act on. Anything malformed/missing reads as disabled —
 *  never GUESS a provider is live. */
export function providerFlagsFromSettings(json: unknown): ProviderFlags {
  const ext = (json && typeof json === 'object' ? (json as Record<string, unknown>).external : null) as
    | Record<string, unknown>
    | null
  return {
    google: ext?.google === true,
    apple: ext?.apple === true,
  }
}

/** Fetch + parse `/auth/v1/settings` into ProviderFlags. FAIL-SAFE: any network
 *  error, non-OK response, unparsable body, or timeout resolves to HIDDEN —
 *  never risk showing a button for a provider GoTrue will 400 on.
 *  `fetchImpl`/`timeoutMs` are injectable so this is testable without a real
 *  network or a slow test run. */
export async function resolveProviderFlags(
  url: string,
  anonKey: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 4000,
): Promise<ProviderFlags> {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await fetchImpl(`${url}/auth/v1/settings`, { headers: { apikey: anonKey }, signal: ctrl.signal })
      if (!res.ok) return HIDDEN
      return providerFlagsFromSettings(await res.json())
    } finally {
      clearTimeout(timer)
    }
  } catch {
    return HIDDEN
  }
}
