-- ============================================================================
--  CHROMANCER AUTH — portable, recoverable accounts LAYERED ON TOP of the
--  anonymous device identity from 0001_ranked.sql. This migration adds NOTHING
--  that weakens the moat: leaderboards stay public-read, players/saves stay
--  RLS-private (server-role-only writes), and verify-run is untouched.
--
--  WHAT THIS ADDS
--   • players.auth_uid — the Supabase Auth user (auth.users.id) a player has
--     signed in as. NULLABLE: guests never have one; device_hash stays the guest
--     anchor. When set, it is the DURABLE, cross-device identity — the server
--     resolves a signed-in player by auth_uid so their handle / progress / cloud
--     save / purchases are PORTABLE across every device they sign in on.
--   • device_hash is relaxed to NULLABLE so a signed-in account that has no guest
--     row on a given device (e.g. a second person signs into their own account on
--     a device already anchored to someone else's guest row) can exist as a
--     pure-auth row. Guests ALWAYS still carry a device_hash — nothing changes
--     for them. (Postgres treats NULLs as distinct, so many auth-only rows with
--     device_hash = NULL coexist fine under the existing unique index.)
--
--  Idempotent: safe to run repeatedly. NOT auto-applied — run once against the
--  DEDICATED game project (see the ranked README / the PR summary).
--
--  NO PHI: we store ONLY the auth uid (an opaque uuid). We deliberately do NOT
--  copy the email or any profile field into players — GoTrue owns that, and the
--  game never needs it.
-- ============================================================================

-- 1) auth_uid — nullable link to the Supabase Auth user. Guests have none.
alter table players add column if not exists auth_uid uuid;

-- 2) FK to auth.users so a deleted auth user cleanly detaches (falls back to the
--    guest device row, never orphaning or wiping the player). Guarded so the
--    migration is idempotent (ADD CONSTRAINT has no IF NOT EXISTS).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'players_auth_uid_fkey'
  ) then
    alter table players
      add constraint players_auth_uid_fkey
      foreign key (auth_uid) references auth.users(id) on delete set null;
  end if;
end $$;

-- 3) PARTIAL UNIQUE index on auth_uid (only over non-null rows): one player row
--    per auth user, while any number of guests (auth_uid IS NULL) coexist. This
--    is both the uniqueness guarantee AND the fast lookup path the link/save/load
--    ops use to resolve a signed-in player.
create unique index if not exists players_auth_uid_key
  on players (auth_uid) where auth_uid is not null;

-- 4) Relax device_hash to nullable (guest anchor stays for guests; auth-only rows
--    may have none). No-op if already nullable. device_hash's UNIQUE index from
--    0001 is unaffected — NULLs are distinct, so it keeps enforcing one row per
--    real device while permitting many null (auth-only) rows.
alter table players alter column device_hash drop not null;
