// ---------------------------------------------------------------------------
//  REALM BACKDROPS — painted per-realm landscapes wired behind the battle board
//  (and onto the realm intro / pre-level cards). One 16:9 backdrop per realm,
//  keyed by REALM ORDER (0..5), NOT by realm id: the campaign realm ids differ
//  from the art keys (verdant→verdantwilds, lumen→radiantsanctum, hollow→
//  umbralvoid), so INDEX is the only safe join to public/concepts/realms.
//
//  Kept out of src/sim/ — this is pure view data (simcheck untouched). The art
//  lives under public/ and is served at the site root, so we reference plain
//  string URLs (never `import` from public/ — Vite won't process it).
// ---------------------------------------------------------------------------

export interface RealmBackdrop {
  key: string
  url: string
  tint: number // manifest ambient/fog tint for this biome
}

// Mirrors public/concepts/realms/manifest.json, in realm order 1..6.
const TABLE: ReadonlyArray<{ key: string; file: string; tint: number }> = [
  { key: 'emberwaste',     file: 'emberwaste.png',     tint: 0xe8802c }, // fire / volcanic
  { key: 'frostreach',     file: 'frostreach.png',     tint: 0x6cc6e8 }, // ice / tundra
  { key: 'stormpeaks',     file: 'stormpeaks.png',     tint: 0x8a6ce0 }, // lightning / peaks
  { key: 'verdantwilds',   file: 'verdantwilds.png',   tint: 0x4fbf6a }, // nature / swamp
  { key: 'radiantsanctum', file: 'radiantsanctum.png', tint: 0xe8c65a }, // light / celestial
  { key: 'umbralvoid',     file: 'umbralvoid.png',     tint: 0x9a5ac0 }, // void / greying
]

const BASE = '/concepts/realms/'

/** Backdrop descriptor for a realm by its 0-based campaign order (wraps/defaults
 *  to Emberwaste for out-of-range indices — e.g. endless/demo levels). */
export function realmBackdrop(index: number): RealmBackdrop {
  const e = TABLE[((index % TABLE.length) + TABLE.length) % TABLE.length] ?? TABLE[0]
  return { key: e.key, url: BASE + e.file, tint: e.tint }
}

/** Just the URL — handy for DOM `background-image` on the realm/pre-level cards. */
export function realmBackdropUrl(index: number): string {
  return realmBackdrop(index).url
}
