-- ============================================================================
--  CHROMANCER #56 — PathForge joins the ranked spine. Two additive changes,
--  neither weakens the moat:
--   • runs.mode gains 'pathforge' (server still refuses any mode outside this
--     list — an unrecognized mode was already impossible to board, and stays
--     impossible).
--   • run_inputs gains a nullable `route` column: the PathForge run's committed
--     spawn→base road, stored ONLY after verify-run.ts's server-side
--     re-validation (never the raw client claim) — the ghost-race source for
--     maze runs, exactly like `log`/`party` already are for every other mode.
--
--  Idempotent: safe to run repeatedly. NOT auto-applied — run once against the
--  dedicated game project, after 0001_ranked.sql + 0002_auth.sql.
-- ============================================================================

-- 1) allow 'pathforge' in the mode check constraint (drop + recreate: Postgres
--    has no ADD-VALUE-TO-CHECK shorthand). Guarded so re-running is a no-op.
alter table runs drop constraint if exists runs_mode_check;
alter table runs add constraint runs_mode_check
  check (mode in ('daily', 'weekly', 'endless', 'level', 'pathforge'));

-- 2) route — PathForge's committed maze route ([[col,row],...] from Portal to
--    Wellspring). NULL for every non-pathforge run.
alter table run_inputs add column if not exists route jsonb;
