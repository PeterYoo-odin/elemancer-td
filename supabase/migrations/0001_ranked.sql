-- ============================================================================
--  CHROMANCER RANKED — provably-fair leaderboard schema (DEDICATED game DB).
--  This is the GAME's OWN Supabase project — it shares NOTHING with any other
--  database and stores NO PHI, ever. Only run seeds, scores, replay input logs,
--  anonymous device accounts, and cloud saves.
--
--  Idempotent: safe to run repeatedly (create-if-not-exists + drop/recreate
--  policies). Migrations are NOT auto-applied — run this against the dedicated
--  project once it is provisioned.
--
--  SECURITY MODEL
--   • Leaderboards (runs, run_inputs, daily_seeds) are PUBLIC-READ.
--   • NO client may INSERT/UPDATE a run directly. The ONLY writer is the server
--     verify function (service role), which RE-RUNS the submitted input log and
--     accepts a row only if the replay reproduces the claimed score+wave. That
--     is the moat: a score you cannot fabricate.
--   • players + saves are PRIVATE (no anon policy → RLS denies). The account
--     function (service role) mutates ONLY the row matching the caller's device
--     identity, so "players write only their own rows" holds.
-- ============================================================================

create extension if not exists pgcrypto; -- gen_random_uuid()

-- ---------------------------------------------------------------------------
--  players — lightweight anonymous accounts. device_hash = SHA-256 of a random
--  client-held device secret (the secret itself NEVER reaches the server), so an
--  account is recoverable only by the device that owns it and is upgradable to a
--  chosen handle without any email/PHI.
-- ---------------------------------------------------------------------------
create table if not exists players (
  id           uuid primary key default gen_random_uuid(),
  device_hash  text unique not null,
  handle       text,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
--  daily_seeds — the shared seed per UTC day (also derived client-side from
--  dailySeed(); this table is the authoritative audit record).
-- ---------------------------------------------------------------------------
create table if not exists daily_seeds (
  date        date primary key,
  seed        bigint not null,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
--  runs — one VERIFIED leaderboard row. `period` partitions the board: UTC day
--  index (daily), UTC week index (weekly), or 0 (endless / all-time). Only the
--  player's BEST row per (mode, period) is kept (upserted server-side).
-- ---------------------------------------------------------------------------
create table if not exists runs (
  id                 uuid primary key default gen_random_uuid(),
  seed               bigint not null,
  mode               text   not null check (mode in ('daily','weekly','endless','level')),
  period             bigint not null default 0,
  score              bigint not null check (score >= 0),
  wave               int    not null check (wave  >= 0),
  sim_version        int    not null,
  player_id          uuid   references players(id) on delete set null,
  handle             text,                       -- denormalized for public reads
  replay_input_hash  text   not null,
  created_at         timestamptz not null default now()
);

-- one BEST row per player per board period (server upserts, keeping the higher)
create unique index if not exists runs_best_per_period
  on runs (mode, period, player_id) where player_id is not null;

-- leaderboard read path: top scores for a given board
create index if not exists runs_board
  on runs (mode, period, score desc, created_at asc);

-- ---------------------------------------------------------------------------
--  run_inputs — the deterministic replay log for a run (ghost racing +
--  re-verification). PUBLIC-READ so any player can download a top run's ghost.
-- ---------------------------------------------------------------------------
create table if not exists run_inputs (
  run_id      uuid primary key references runs(id) on delete cascade,
  log         jsonb not null,   -- { c: [...commands], d: [...draft picks] }
  party       jsonb not null,   -- declared loadout (re-normalized on verify)
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
--  saves — cloud save (progress / economy / unlocks). One row per player. Local
--  is authoritative; the server just mirrors so clearing the browser no longer
--  wipes a player. `rev` is a monotonic counter for last-write-wins reconcile.
-- ---------------------------------------------------------------------------
create table if not exists saves (
  player_id   uuid primary key references players(id) on delete cascade,
  data        jsonb  not null,
  rev         bigint not null default 0,
  updated_at  timestamptz not null default now()
);

-- ===========================================================================
--  ROW LEVEL SECURITY
-- ===========================================================================
alter table players     enable row level security;
alter table daily_seeds enable row level security;
alter table runs        enable row level security;
alter table run_inputs  enable row level security;
alter table saves       enable row level security;

-- Public-read the leaderboards (anon key, SELECT only). Recreate idempotently.
drop policy if exists runs_public_read        on runs;
drop policy if exists run_inputs_public_read   on run_inputs;
drop policy if exists daily_seeds_public_read  on daily_seeds;

create policy runs_public_read       on runs       for select using (true);
create policy run_inputs_public_read on run_inputs for select using (true);
create policy daily_seeds_public_read on daily_seeds for select using (true);

-- players + saves: NO anon policy on purpose. With RLS enabled and no policy,
-- the anon key can neither read nor write them. The service-role verify/account
-- functions bypass RLS and scope every write to the caller's own device row,
-- satisfying "players write only their own rows". Writes to runs/run_inputs are
-- likewise service-role-only (no anon INSERT/UPDATE policy exists above).
