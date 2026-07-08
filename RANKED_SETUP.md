# Chromancer Ranked — wiring the DEDICATED game backend

The ranked leaderboard uses a **dedicated Supabase project for the GAME ONLY** —
completely separate from any other database. It stores **no PHI, ever** (only run
seeds, scores, replay input logs, anonymous device accounts, and cloud saves).

The game **degrades gracefully to local-only** when these are unset: boards show
"connecting to ranked servers…", local PB history still works, and play is never
blocked. So this wiring is optional to ship — it just lights up the global board.

## 1) Environment variables

### Client (Vite — safe to expose; the anon key is public-read only)
```
VITE_GAME_SUPABASE_URL=https://<your-game-project>.supabase.co
VITE_GAME_SUPABASE_ANON_KEY=<anon public key>
```

### Server (Vercel serverless functions — SECRET; never prefix with VITE_)
```
GAME_SUPABASE_URL=https://<your-game-project>.supabase.co
GAME_SUPABASE_SERVICE_ROLE_KEY=<service_role secret key>
```
`GAME_SUPABASE_URL` may be omitted if identical to the client URL — the server
helper falls back to `VITE_GAME_SUPABASE_URL`. The **service role key must only
live in the Vercel server environment** (it bypasses RLS to insert verified runs
and mirror cloud saves).

## 2) Database schema (run once against the dedicated project)

Apply `supabase/migrations/0001_ranked.sql`. It is **idempotent**. Migrations are
NOT auto-applied; run it via the Supabase SQL editor or `supabase db push` once the
project is provisioned. Full SQL:

```sql
create extension if not exists pgcrypto;

create table if not exists players (
  id uuid primary key default gen_random_uuid(),
  device_hash text unique not null,
  handle text,
  created_at timestamptz not null default now()
);

create table if not exists daily_seeds (
  date date primary key,
  seed bigint not null,
  created_at timestamptz not null default now()
);

create table if not exists runs (
  id uuid primary key default gen_random_uuid(),
  seed bigint not null,
  mode text not null check (mode in ('daily','weekly','endless','level')),
  period bigint not null default 0,
  score bigint not null check (score >= 0),
  wave int not null check (wave >= 0),
  sim_version int not null,
  player_id uuid references players(id) on delete set null,
  handle text,
  replay_input_hash text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists runs_best_per_period
  on runs (mode, period, player_id) where player_id is not null;
create index if not exists runs_board
  on runs (mode, period, score desc, created_at asc);

create table if not exists run_inputs (
  run_id uuid primary key references runs(id) on delete cascade,
  log jsonb not null,
  party jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists saves (
  player_id uuid primary key references players(id) on delete cascade,
  data jsonb not null,
  rev bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table players     enable row level security;
alter table daily_seeds enable row level security;
alter table runs        enable row level security;
alter table run_inputs  enable row level security;
alter table saves       enable row level security;

drop policy if exists runs_public_read        on runs;
drop policy if exists run_inputs_public_read   on run_inputs;
drop policy if exists daily_seeds_public_read  on daily_seeds;
create policy runs_public_read       on runs       for select using (true);
create policy run_inputs_public_read on run_inputs for select using (true);
create policy daily_seeds_public_read on daily_seeds for select using (true);
-- players + saves: NO anon policy (RLS denies). Only the service-role verify/
-- account functions write them, scoped to the caller's own device row.
```

## 3) The moat (why this is "the TD that literally cannot cheat")

- Every ranked run records a **deterministic input log** (`src/game/ranked.ts`
  `RunRecorder`) keyed to sim ticks.
- On run end the client POSTs `{ seed, mode, party, score, wave, log }` to
  **`/api/verify-run`**, which **re-runs the pure `src/sim`** from the seed + log
  (`verifyRun`) and only boards the run if the replay reproduces the **integer
  score AND wave** under the current `SIM_VERSION`. Tampered scores, tampered
  waves, and stale sim versions are rejected.
- The client's ranked Sim is built by the **same** `rankedConfig()` the server
  re-runs, so an honest run can never fail verification (zero config drift).
- `npm run simcheck` exercises this end-to-end: record → replay reproduces →
  tamper rejected → version rejected → dropped-command changes outcome.

## 4) Endpoints

| Path | Runtime | Role | Purpose |
|------|---------|------|---------|
| `/api/verify-run` | Vercel Node (V8 == browser) | service | re-run + board a run |
| `/api/account`    | Vercel Node | service | register handle · cloud save get/put |
| PostgREST `runs`, `run_inputs` | anon | public-read | leaderboards + ghost logs |

Bump `SIM_VERSION` in `src/game/ranked.ts` whenever sim math changes so old logs
stop verifying instead of mis-verifying.
