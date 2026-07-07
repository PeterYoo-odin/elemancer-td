// ATTRACT-MODE CINEMATOGRAPHY — camera cues + captions for the demo reel, keyed
// to the SIM CLOCK of the scripted Ember Vale run (see attractScript.ts). Pure
// data: the view owns the actual camera math. Times mirror the verified beat
// timeline (W1 4s · W2 ~19s · W3+SHATTER ~41-62s · draft ~62s · W4 ~68s ·
// W5/Keeper ~95s · leaks ~126-140s · clutch ~130-150s · victory ~164s).
//
// Framing is CENTER-SAFE: every look target sits in the middle band of the
// board so one 16:9 master crops cleanly to 9:16 and 1:1 for Shorts/Reels.

export interface CineCue {
  at: number // sim clock (s) — scales automatically with ?speed=
  x: number // look target, sim px
  y: number
  dist: number // camera distance, world units
  pitch: number // degrees above horizon
  yaw: number // degrees around the board (0 = classic south view)
  dur: number // blend seconds (in sim time)
}

export interface CaptionCue {
  at: number
  text: string
  sub?: string
  dur: number // seconds on screen (sim time)
}

// Board center is (360, 640) in sim px.
export const DEMO_CINE_CUES: CineCue[] = [
  // establishing: the greyed vale, slow push-in
  { at: 0.01, x: 360, y: 620, dist: 30, pitch: 56, yaw: 0, dur: 0.01 },
  { at: 0.1, x: 360, y: 600, dist: 24, pitch: 54, yaw: -4, dur: 5.5 },
  // W1: portal side, watch the first runners meet the first tower
  { at: 5.5, x: 220, y: 400, dist: 13, pitch: 42, yaw: -22, dur: 3.2 },
  { at: 12, x: 420, y: 400, dist: 11.5, pitch: 44, yaw: 12, dur: 6 },
  // W2: breathe wider, cannon row works
  { at: 19.5, x: 360, y: 480, dist: 16, pitch: 50, yaw: -8, dur: 4 },
  { at: 29, x: 380, y: 460, dist: 11, pitch: 39, yaw: 26, dur: 5 },
  // W3 prep: the chokepoint build (frost, then storm)
  { at: 36.5, x: 540, y: 480, dist: 10, pitch: 42, yaw: -18, dur: 2.6 },
  // SHATTER money shot: tight, low, slow creep — hold through the cascade
  { at: 44, x: 600, y: 470, dist: 8.6, pitch: 31, yaw: -30, dur: 3 },
  { at: 50, x: 580, y: 490, dist: 7.8, pitch: 29, yaw: -36, dur: 8 },
  // wave settles → pull back over the freshly coloured half
  { at: 59, x: 360, y: 600, dist: 19, pitch: 54, yaw: 4, dur: 3.5 },
  // W4: slow orbital drift while the new power flexes
  { at: 68, x: 400, y: 520, dist: 13, pitch: 47, yaw: -16, dur: 5 },
  { at: 80, x: 300, y: 420, dist: 10.5, pitch: 40, yaw: 22, dur: 7 },
  { at: 89, x: 360, y: 600, dist: 17, pitch: 52, yaw: 0, dur: 4 },
  // W5: the Keeper enters — low dread shot at the portal
  { at: 94.5, x: 140, y: 400, dist: 9.5, pitch: 27, yaw: -38, dur: 3 },
  { at: 102, x: 300, y: 430, dist: 11.5, pitch: 38, yaw: -14, dur: 6 },
  // the tide builds
  { at: 114, x: 380, y: 620, dist: 15.5, pitch: 49, yaw: 10, dur: 5 },
  // THE BLEED: crystal-side shot, leaks hitting home
  { at: 125, x: 600, y: 840, dist: 9.5, pitch: 33, yaw: 30, dur: 3 },
  // clutch build montage on the back line
  { at: 134, x: 400, y: 680, dist: 11.5, pitch: 42, yaw: -6, dur: 3 },
  // tempest save, wide enough to read the chains
  { at: 146, x: 420, y: 620, dist: 14.5, pitch: 48, yaw: 8, dur: 3.5 },
  // the Keeper's last stand on the bottom lane
  { at: 152, x: 340, y: 840, dist: 9.8, pitch: 32, yaw: -18, dur: 3.5 },
  // victory pull-back: the whole vale blooms
  { at: 160, x: 360, y: 640, dist: 24, pitch: 55, yaw: 0, dur: 5.5 },
]

// Short, sparse, skippable-in-spirit — the gameplay is the message.
// Disable entirely with ?captions=0 for clean capture.
export const DEMO_CAPTIONS: CaptionCue[] = [
  { at: 1.2, text: 'THE WORLD HAS BEEN GREYED', sub: 'Ember Vale, after Morose', dur: 3.4 },
  { at: 7.5, text: 'PAINT IT BACK', sub: 'one tower at a time', dur: 3 },
  { at: 43.5, text: 'FROST + STORM…', dur: 2.6 },
  { at: 63, text: 'EVERY FEW WAVES — PICK A POWER', sub: 'seeded · deterministic · fair', dur: 3.4 },
  { at: 95.5, text: 'CINDRAL, EMBER OF KAELEN', sub: 'the Keeper who snuffed his own forge', dur: 3.6 },
  { at: 126.5, text: 'HOLD THE LINE', dur: 2.8 },
  { at: 156, text: 'EVERYTHING YOU JUST SAW IS REAL GAMEPLAY', sub: 'seed EMBER-FOX-42 · go beat it', dur: 6 },
]

/** Default wide pose the camera returns to when cinematic mode ends. */
export const CINE_HOME = { x: 360, y: 640, dist: 22, pitch: 55, yaw: 0 }
