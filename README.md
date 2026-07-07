# CHROMANCER (Elemancer TD)

> Display name: **CHROMANCER** — “Paint the world back.” Repo/package/paths keep the
> original `elemancer` naming on purpose (renaming them would break Vercel/builds).

A colorful, cartoon **idle + tower-defense** hybrid for the web. Built and hosted in Odin.

**Goal:** beat the 2026 TD ad-games (Raid Rush, Arcane Arena) on the things they all sacrifice —
**provably-fair** (deterministic seeded runs, a no-paid-advantage leaderboard), **systemic depth**
(small roster × synergies × roguelike runs), and **honest, retention-first** design. Full design
spec: `~/elemancer-td-build-spec.md`.

## Stack
- **Vite + Phaser 3 + TypeScript** — HTML5, mobile-first, 60fps.
- `base: './'` so the same `dist/` bundle works on Vercel *and* zips straight to CrazyGames / Poki.

## Run locally
```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # tsc --noEmit && vite build → dist/
npm run preview  # serve the production build
```

## Deploy
Point a Vercel project at this repo (framework: Vite, output: `dist`). Every push auto-deploys;
PRs get preview URLs. No secrets required.

## Status
- **v0.1** — scaffold: boots to a living title screen.
- **Next** — battle scene: path, 5 towers (Element × Behavior) with branching upgrades, 8 monster
  archetypes, 3 spells, visible synergies, then the idle/prestige spine. Built slice-by-slice via Odin.
