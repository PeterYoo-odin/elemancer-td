# CHROMANCER shared screen/layout spec (frozen from FrontPage — the reference)

This is the coherence anchor + audit checklist for the all-screens UI pass.
FrontPage (`src/ui/FrontPage.ts`) is the gold-standard implementation.

## Design language (match these, don't invent new values)
- Radius: buttons/cards 16–22px, chips/pills 999px, small tiles 12px.
- Shadow: `0 6px 18px rgba(0,0,0,.35)` (raised), `0 24px 70px rgba(0,0,0,.6)` (modal card).
- Gaps: 8–14px between stacked controls; 6–10px inside chips.
- Fonts: `'Baloo 2','Nunito',system-ui,...`; wordmark `'Cinzel'`.
- Palette: deep indigo bg gradients; gold `#ffd76a`/`#ffcf5c` primary; text `#efe9ff`.

## Full-screen page pattern (StorePage/Workshop/Daily/Ranked/Pathforge/etc.)
- Root: `position:fixed; inset:0; z-index:15` (page) / higher for modal overlays.
- Column: `display:flex; flex-direction:column`.
- Header: `flex:0 0 auto`, padded with `padding-top: env(safe-area-inset-top)`.
- Body: `flex:1 1 auto; min-height:0; overflow-y:auto; -webkit-overflow-scrolling:touch;`
  bottom padding `calc(Npx + env(safe-area-inset-bottom))`.
- Backgrounds/attract/decorative layers: MUST have `pointer-events:none`.
- `position:fixed` background layers only work if the fixed ancestor has NO
  transform/filter/will-change/contain. Leave anims should be opacity-only.

## Modal pattern (settings/reward/referral/codex/bond)
- Overlay: `position:fixed; inset:0; z-index:>=20; display:flex; align-items:center;
  justify-content:center; padding:18–24px; overflow-y:auto;` dim backdrop + blur.
- Card: `width:min(Npx, 92-96vw); max-height:~90vh; overflow-y:auto;` so it scrolls
  rather than clipping on short/landscape viewports.
- Backdrop click closes; card click stops propagation. Backdrop must not trap under
  a transformed ancestor.

## Breakpoints (short-viewport compression — copy FrontPage's tiers)
- `@media (max-height: 720px)` — reduce hero gaps, logo size, button padding.
- `@media (max-height: 560px)` — hide ornaments, drop sub-labels.
- `@media (orientation: landscape) and (max-height: 500px)` — cap wordmark, drop rules.
- Narrow width: guard headers/tab-rows/button-rows against 320px (iPhone SE) overflow.

## Provable-defect checklist (ONLY fix when you can name viewport → element → failure)
1. Horizontal children summing past 320px with no `flex-wrap` / no `min-width:0` +
   ellipsis on the flexing text / fixed widths that don't shrink.
2. Decorative/attract/background layer missing `pointer-events:none` (eats clicks).
3. Fixed bottom-anchored element missing bottom safe-area inset.
4. Modal taller than viewport with no `max-height`+`overflow-y:auto` (clips controls).
5. z-order between concurrently-visible layers (modal over page, toast, banner).
6. `position:fixed` bg under a transformed/filtered/will-change ancestor.
7. Untappable control (covered by a sibling, or under a click-eating overlay).

## Discipline
- UI/CSS only. No logic, no copy changes, no new features.
- Do NOT do a dvh conversion crusade — `90vh`/`86vh` modals that also
  `overflow-y:auto` already scroll and are fine.
- Keep the premium look + entrance animations. Prefer minimal, provable edits.
