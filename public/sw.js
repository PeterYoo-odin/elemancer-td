/* CHROMANCER service worker — the installable "download" shell.
 *
 * Strategy (deliberately conservative so a redeploy is never stale):
 *   - Navigations / HTML → NETWORK-FIRST, fall back to cache when offline.
 *     A fresh index.html is always fetched when online, so a new build lands
 *     immediately; the cached copy only serves the offline shell.
 *   - Content-hashed build assets (/assets/*) → CACHE-FIRST (immutable by name).
 *   - Other static (icons, manifest, art, audio, models) → STALE-WHILE-REVALIDATE.
 * Heavy media is NOT precached — it warms on demand so install stays instant.
 */
const VERSION = 'chromancer-v1'
const SHELL = VERSION + '-shell'
const RUNTIME = VERSION + '-runtime'

// Minimal offline shell: the two entry documents + the manifest/icons.
const SHELL_URLS = [
  './',
  './index.html',
  './landing',
  './landing.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
].map((p) => new URL(p, self.location).toString())

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then((cache) =>
      // best-effort: one missing URL (a rewrite path may 404 in dev) must not
      // fail the whole install, or the SW never activates.
      Promise.allSettled(SHELL_URLS.map((u) => cache.add(u))),
    ).then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== SHELL && k !== RUNTIME).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  )
})

// let the page tell a waiting SW to take over immediately
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting()
})

function isHashedAsset(url) {
  // vite emits everything under /assets/ with a content hash in the filename
  // (name-<hash>.<ext>), so those files are immutable — safe to cache-first.
  return url.pathname.includes('/assets/')
}

// Painted art that ships from public/ keeps a STABLE filename across builds, so an
// art redrop overwrites the same URL (e.g. textures/realms/emberwaste-ground.webp).
// Under stale-while-revalidate a returning player therefore sees the OLD painting
// for a whole session after a deploy — indistinguishable from "the art never
// shipped". These get network-first with a cache fallback instead: the CDN already
// serves them must-revalidate + ETag, so a warm hit is a cheap 304, and offline
// still works. Genuinely additive media (audio, models, icons, fonts) stays on
// stale-while-revalidate, where instant-from-cache is the right trade.
const REDRAWN_ART = ['/textures/', '/concepts/', '/brand/']
function isRedrawnArt(url) {
  return REDRAWN_ART.some((p) => url.pathname.includes(p))
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return // never intercept cross-origin (fonts, backend)

  const isNav = req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html')

  if (isNav) {
    // NETWORK-FIRST: keep the shell fresh; cache is only the offline fallback.
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone()
        caches.open(SHELL).then((c) => c.put(req, copy)).catch(() => {})
        return res
      }).catch(() =>
        caches.match(req).then((hit) =>
          hit || caches.match(new URL('./index.html', self.location).toString()),
        ).then((hit) => hit || Response.error()),
      ),
    )
    return
  }

  if (isHashedAsset(url)) {
    // CACHE-FIRST: filenames change on every build, so a hit is always correct.
    event.respondWith(
      caches.match(req).then((hit) =>
        hit || fetch(req).then((res) => {
          const copy = res.clone()
          caches.open(RUNTIME).then((c) => c.put(req, copy)).catch(() => {})
          return res
        }),
      ),
    )
    return
  }

  if (isRedrawnArt(url)) {
    // NETWORK-FIRST: a redrawn painting at a stable URL must never lose to the cache.
    event.respondWith(
      fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone()
          caches.open(RUNTIME).then((c) => c.put(req, copy)).catch(() => {})
        }
        return res
      }).catch(() => caches.match(req).then((hit) => hit || Response.error())),
    )
    return
  }

  // STALE-WHILE-REVALIDATE for other same-origin static (icons, audio, models…).
  event.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone()
          caches.open(RUNTIME).then((c) => c.put(req, copy)).catch(() => {})
        }
        return res
      }).catch(() => hit)
      return hit || net
    }),
  )
})
