# Chromancer — Difficulty & Balance Overhaul (pass 19)

> Regenerate anytime with `npm run difficulty` (campaign gate) and `npm run balance`
> (endless sweep). Both are pure, seeded and deterministic.

## The problem

The owner played **15 levels with 1 cannon + 1 frost + 1 flame, no upgrades, "no
problems."** The headless probe confirmed it empirically: on the pre-overhaul curve
**every** strategy — including *mono cannon, no upgrades* — cleared all **192/192**
levels, most at near-full lives. All the depth (upgrades, branches, reactions,
fusions, synergies) was **optional**, so it went unused.

Root cause: the campaign HP curve was `1 + globalDepth·1.3` with
`globalDepth = (realm + local)/6` — it compressed each 32-level realm into ~1/6 of a
shallow [1, 2.3] band. At level 15 a runner had ~35 HP vs 32 base. The whole game sat
below what a 3-tower board plus the hero floor trivially out-DPS'd.

## The fix (data-layer; the combat 0.5× no-immunity floor is untouched)

- **Campaign curve** (`src/game/campaign.ts`): a two-term shape pinned to the
  simcheck beatability ceiling —
  `baseHp = 1 + 4.5·min(1, prog/0.85) + 2.0·prog^1.15` (`prog = realm + local`, 0…6).
  A saturating **early bump** makes Emberwaste stop being a coast (the deep realms
  have ceiling headroom, the early ones don't, so they're lifted independently); a
  mild **superlinear** term keeps every realm out-demanding the last. Wave HP:
  `L6 2.2× · L20 5.6× · L32 6.5× · realm2 ~9× · realm4 ~14× · realm6 ~20×`.
- **Composition**: threats pulled EARLIER and interleaved (2–3 distinct archetypes
  per late wave) so no single tower answers a level — anti-air still unlocks before
  flyers (no unfair gate; ≥2 answers to every threat).
- **Openers**: depth-dependent floor (punchy 0.85× early, gentle 0.6× deep so a 20×
  wave 1 is survivable) + a realm-opener gold cushion so the roster shift at each
  realm boundary is a fair step, not a spike only one build survives.
- **Endless ramp** (`src/sim/sim.ts`): now ACCELERATES —
  `hp = 1 + n·0.22 + n²·0.006` (was linear `1 + n·0.18`); bosses ride it at ×1.25.
  `w20 7.8× · w40 19× · w60 36× · w90 69×` (was `4.6× / 8.2× / 11.8× / 17.2×`).
- **Hand-authored finales** (l2–l6) re-based onto the new curve so each realm still
  ENDS on its hardest stop instead of a crater. `SIM_VERSION 2→3` (endless outcomes
  shift). L1 tutorial + all base enemy stats untouched (demo razor preserved).

## Before → after (campaign, `npm run difficulty`)

Numbers below are at a realistic hero-progression envelope **capped at Lv 16** (the
level simcheck's beatability authority uses), verified seed-robust over 3 seeds.

| Build | Before | After (reliability · safety margin) |
|---|---|---|
| Mono cannon, **no upgrades** | 192/192, full lives | **walls ~L18** · 84% win · struggles deep (~0.78) |
| Owner: 1 cannon+1 frost+1 flame, **no upgrades** | 192/192, full lives | **walls ~L24** · 80% win · struggles deep (~0.60) |
| Trio spam, **no upgrades** | 192/192, full lives | grinds through — but **thin ~1–2 life** margin |
| Varied + upgraded + reactions | 192/192 (trivial) | clears all · **6-life** margin |
| Frost+Storm **Shatter combo** | 192/192 (trivial) | clears all · **14-life** margin |
| Distinct viable upgraded strategies | (n/a — all trivial) | **5** (varied, shatter, elem, physcc, spam+upgrade) |

**Depth is now REQUIRED for reliable, safe play.** Honest reading of the data:

- The two LITERAL "no problems for 15 levels" builds — mono spam and the owner's
  1-cannon/1-frost/1-flame — now **wall in the first realm (~L18 / ~L24)** and keep
  losing through the deep realms (80–84% win). A player using them is forced to
  engage the depth.
- We did **not** land the exact "fail by L6-8" wording: with a full 3-hero party the
  hero DPS floor carries a trio through the tutorial realm, and breaking L6-8 would
  require gutting heroes (which we rejected — it's net-neutral against the beatability
  ceiling and blast-radiuses the demo/ranked). The honest landing is **walls ~L18-24
  + unreliable throughout**, which delivers the intent (lazy can't coast, depth is
  needed) without breaking the ceiling.
- **Active** 3-type spam *can* still grind the campaign — but only on a **~1–2 life
  knife's edge** where the reaction build cruises at **14**. So depth (upgrades,
  branches, elemental-reaction combos) is what buys the safety margin — the crown-jewel
  systems are now the efficient answer, exactly as intended. NB: a player who maxes
  heroes to Lv 20 widens every build's margin — the "depth required" claim is scoped
  to typical (≤Lv 16) hero levels, the same envelope beatability is proven at.

## Beatability ceiling (`npm run simcheck`)

Every one of the 192 live levels remains provably beatable by the fair, min-resource
auto-player (base towers + unlocks, starter heroes) — tightest ≈ **12–14 lives** of
headroom. `npm run build` (tsc strict + vite) and `npm run simcheck` both green.

## Endless power ranking (`npm run balance`)

Under the harder ramp, builds now die shallower (top branch ≈ 38 waves vs ≈ 40).
No single tower branch trips the dominance gate. The Tempest+Blizzard+ChainReactor
rogue synergy remains the strongest combo in the harsh early-relic regime (a
pre-existing, harness-tracked finding whose suggested nerfs — comboRamp 1.6→1.45,
Blizzard range 4.0→3.5 — are already applied); it is not an auto-win (it dies by
wave 6 on 4 lives) and reactions being a real power spike is a stated design goal.
