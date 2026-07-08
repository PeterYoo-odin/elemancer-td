// CLOUD SAVE — a LOCAL-FIRST mirror of the save to the dedicated game DB, so
// clearing the browser (or moving devices) no longer wipes progress. This is a
// mirror, not a merge: the active device is authoritative and pushes up; a FRESH
// device (empty local) pulls the cloud down. Degrades to a no-op when the backend
// is unwired — offline play and local saves are completely unaffected.

import { economy } from './economy'
import { coerceSave, type SaveData } from './save'
import { cloudSaveGet, cloudSavePut, rankedConfigured } from './rankedNet'
import { getAccessToken, isSignedIn } from './authNet'

let lastPushedJson = ''
let pushTimer = 0

// A cheap "how much progress is here" score, used to detect a fresh/empty local
// save (the browser-cleared case) so we adopt the cloud instead of clobbering it.
function progressScore(d: SaveData): number {
  return (
    Object.keys(d.firstClears || {}).length * 10 +
    (d.endlessBest || 0) +
    Math.floor((d.coins || 0) / 100) +
    (d.diamonds || 0) +
    Object.keys(d.heroes || {}).length
  )
}

/** Mirror the local save up to the cloud (deduped; last-write-wins by timestamp).
 *  No-op when unwired/unchanged. */
export function pushSave(): void {
  if (!rankedConfigured()) return
  const json = JSON.stringify(economy.data)
  if (json === lastPushedJson) return
  lastPushedJson = json
  const data = economy.data
  const rev = Date.now()
  // When signed in, target the durable auth account (portable across devices);
  // otherwise the guest device row. Token fetch is fire-and-forget.
  void getAccessToken().then((token) => cloudSavePut(data, rev, token ?? undefined))
}

/** Debounced push — call after any progress change (e.g. returning to the menu). */
export function scheduleCloudPush(): void {
  if (!rankedConfigured()) return
  window.clearTimeout(pushTimer)
  pushTimer = window.setTimeout(pushSave, 2500)
}

/** Boot-time reconcile: pull the cloud, and if THIS device's save looks fresh/
 *  empty while the cloud holds real progress, adopt the cloud (recovery). Else
 *  the local device wins and we seed/refresh the cloud. Fire-and-forget. */
export async function reconcileCloudSave(): Promise<void> {
  if (!rankedConfigured()) return
  let cloud: Awaited<ReturnType<typeof cloudSaveGet>>
  try {
    const token = await getAccessToken()
    cloud = await cloudSaveGet(token ?? undefined)
  } catch { return }
  if (!cloud || cloud.data == null) { pushSave(); return }
  const remote = coerceSave(cloud.data)
  const localScore = progressScore(economy.data)
  const remoteScore = progressScore(remote)
  // Recover the cloud when it holds MORE progress than this device.
  //  • GUEST (one row per device): only a fresh/browser-cleared device adopts —
  //    the local device stays authoritative otherwise (unchanged behavior).
  //  • SIGNED IN (the save row is now SHARED across devices): higher progress
  //    always wins, so signing in to RECOVER on a new device that has a little
  //    guest progress never clobbers a richer account. Prevents last-write-wins
  //    thrash on the sign-in transition (the account, not the timestamp, wins).
  const recoverRemote = isSignedIn()
    ? remoteScore > localScore
    : localScore <= 1 && remoteScore > localScore
  if (recoverRemote) {
    economy.data = remote
    economy.save()
    lastPushedJson = JSON.stringify(economy.data)
    return
  }
  pushSave()
}
