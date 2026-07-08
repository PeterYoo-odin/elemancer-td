// CLOUD SAVE — a LOCAL-FIRST mirror of the save to the dedicated game DB, so
// clearing the browser (or moving devices) no longer wipes progress. This is a
// mirror, not a merge: the active device is authoritative and pushes up; a FRESH
// device (empty local) pulls the cloud down. Degrades to a no-op when the backend
// is unwired — offline play and local saves are completely unaffected.

import { economy } from './economy'
import { coerceSave, type SaveData } from './save'
import { cloudSaveGet, cloudSavePut, rankedConfigured } from './rankedNet'

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
  void cloudSavePut(economy.data, Date.now())
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
  try { cloud = await cloudSaveGet() } catch { return }
  if (!cloud || cloud.data == null) { pushSave(); return }
  const remote = coerceSave(cloud.data)
  const localScore = progressScore(economy.data)
  const remoteScore = progressScore(remote)
  if (localScore <= 1 && remoteScore > localScore) {
    // browser-cleared / new device → recover the cloud save
    economy.data = remote
    economy.save()
    lastPushedJson = JSON.stringify(economy.data)
    return
  }
  pushSave()
}
