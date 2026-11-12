-- NOVELIGHT SCOUT formal reader: Staging-only RLS/role REVIEW DRAFT.
-- NOT A MIGRATION. DO NOT EXECUTE WITHOUT DISTINCT OWNER APPROVAL.
-- Target Supabase branch/project ref: wmlzjgvxgoyrovdhbqbg (NOT Production).
-- No changes to any database, role, policy, secret or Vercel environment
-- are authorized by committing this document.
--
-- Existing code contract (no schema or function addition):
--   api/_lib/reader-reward/formal-staging-readonly-runtime.js
--   api/_lib/reader-reward/formal-new-reader-onboarding.js
--   api/_lib/reader-reward/formal-earning-source-reader.js
--   api/_lib/reader-reward/formal-usage-http.js
-- Require: VERCEL_ENV=preview and
-- NOVELIGHT_SCOUT_FORMAL_STAGING_PROBE=read-only and
-- STAGING_SUPABASE_URL=https://wmlzjgvxgoyrovdhbqbg.supabase.co and
-- STAGING_PROJECT_REF=wmlzjgvxgoyrovdhbqbg and PGSSLMODE=require,
-- STAGING_SUPABASE_PUBLISHABLE_KEY (server-side Supabase getUser JWT),
-- STAGING_FORMAL_RO_DATABASE_URL (server-side credential, NEVER in git).
-- Only direct db.<stagingref>.supabase.co:5432/postgres or a verified
-- Supavisor session-pooler host, with the exact dedicated role, is accepted.
-- Password and TLS CA verification are configured separately, not here.
--
-- OWNER MUST REVIEW BEFORE APPLYING:
-- 1. Authentic Staging ref, exact schema, current HEAD and permissions.
-- 2. This role sees only a post-reference cohort, but it can query all
--    permitted columns for that cohort if the server-side credential leaks.
-- 3. auth.users belongs to supabase_auth_admin, NOT postgres. The ordinary
--    postgres role is not a member and cannot create its auth.users policy.
--    Applying Section B requires the actual auth.users table owner/
--    supported Supabase-admin method. If unavailable, STOP; refactor the
--    trusted Auth reader instead. Do not use postgres/BYPASSRLS or relax RLS.
-- 4. An external, OWNER-approved secure step must set LOGIN + a strong
--    credential later. No password, login enablement or runtime env is here.
-- 5. No permission is given for INSERT/UPDATE/DELETE/TRUNCATE, table
--    ownership, triggers, private reward-function EXECUTE, or migrations.
-- 6. Source-event inspection, not award eligibility, is the sole purpose.
--    Review moderation prior-comment completeness before future awards.
--
-- SECTION A: database owner; draft to apply ONLY after OWNER approval.
-- This new role deliberately has NOLOGIN until separate credentials approval.
CREATE ROLE novelight_formal_reader_ro WITH
  NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT
  NOREPLICATION NOBYPASSRLS;
ALTER ROLE novelight_formal_reader_ro SET default_transaction_read_only = on;
ALTER ROLE novelight_formal_reader_ro SET statement_timeout = '5s';
ALTER ROLE novelight_formal_reader_ro SET search_path = pg_catalog;

GRANT USAGE ON SCHEMA public TO novelight_formal_reader_ro;
GRANT USAGE ON SCHEMA novelight_formal_private TO novelight_formal_reader_ro;

-- Only columns explicitly used by inspectOne(), getAdminSummary(), load().
GRANT SELECT (user_id)
  ON public.scout_point_ledger TO novelight_formal_reader_ro;
GRANT SELECT (user_id)
  ON public.scout_xp_ledger TO novelight_formal_reader_ro;
GRANT SELECT (user_id)
  ON novelight_formal_private.scout_level_state TO novelight_formal_reader_ro;
GRANT SELECT (user_id)
  ON novelight_formal_private.scout_point_usage_wallets
  TO novelight_formal_reader_ro;
GRANT SELECT (id, reader_id, episode_id_snapshot, qualified_at)
  ON public.valid_read_events TO novelight_formal_reader_ro;
GRANT SELECT (
  id, user_id, episode_id, body, deleted_at, author_hidden_at, created_at
) ON public.novel_comments TO novelight_formal_reader_ro;

-- The RLS predicates intentionally restrict inspected rows to post-reference
-- Auth accounts; cross-table predicates require the separately owned
-- Section B auth.users SELECT(id,created_at) policy to be available.
CREATE POLICY novelight_formal_ro_post_reference
  ON public.scout_point_ledger FOR SELECT
  TO novelight_formal_reader_ro
  USING (
    EXISTS (
      SELECT 1 FROM auth.users u WHERE u.id = user_id
        AND u.created_at >= timestamptz '2026-11-10T00:00:00Z'
    )
  );
CREATE POLICY novelight_formal_ro_post_reference
  ON public.scout_xp_ledger FOR SELECT
  TO novelight_formal_reader_ro
  USING (
    EXISTS (
      SELECT 1 FROM auth.users u WHERE u.id = user_id
        AND u.created_at >= timestamptz '2026-11-10T00:00:00Z'
    )
  );
CREATE POLICY novelight_formal_ro_post_reference
  ON novelight_formal_private.scout_level_state FOR SELECT
  TO novelight_formal_reader_ro
  USING (
    EXISTS (
      SELECT 1 FROM auth.users u WHERE u.id = user_id
        AND u.created_at >= timestamptz '2026-11-10T00:00:00Z'
    )
  );
CREATE POLICY novelight_formal_ro_post_reference
  ON novelight_formal_private.scout_point_usage_wallets FOR SELECT
  TO novelight_formal_reader_ro
  USING (
    EXISTS (
      SELECT 1 FROM auth.users u WHERE u.id = user_id
        AND u.created_at >= timestamptz '2026-11-10T00:00:00Z'
    )
  );
CREATE POLICY novelight_formal_ro_post_reference
  ON public.valid_read_events FOR SELECT
  TO novelight_formal_reader_ro
  USING (
    qualified_at >= timestamptz '2026-11-10T00:00:00Z'
    AND EXISTS (
      SELECT 1 FROM auth.users u WHERE u.id = reader_id
        AND u.created_at >= timestamptz '2026-11-10T00:00:00Z'
    )
  );
CREATE POLICY novelight_formal_ro_post_reference
  ON public.novel_comments FOR SELECT
  TO novelight_formal_reader_ro
  USING (
    created_at >= timestamptz '2026-11-10T00:00:00Z'
    AND EXISTS (
      SELECT 1 FROM auth.users u WHERE u.id = user_id
        AND u.created_at >= timestamptz '2026-11-10T00:00:00Z'
    )
  );

-- SECTION B: REQUIRES SEPARATE AUTH-SCHEMA OWNER REVIEW/EXECUTION.
-- Supabase-managed auth.users is owned by supabase_auth_admin.
-- Do NOT attempt as postgres, do NOT change ownership, do NOT bypass RLS.
-- Both statements below are for OWNER security review, not approval to run.
GRANT USAGE ON SCHEMA auth TO novelight_formal_reader_ro;
GRANT SELECT (id, created_at) ON auth.users
  TO novelight_formal_reader_ro;
CREATE POLICY novelight_formal_ro_post_reference
  ON auth.users FOR SELECT
  TO novelight_formal_reader_ro
  USING (created_at >= timestamptz '2026-11-10T00:00:00Z');

-- AFTER a separate OWNER-approved credential provisioning:
-- - Permit LOGIN and rotate a strong role password only through a secret
--   channel; never add credential literals to version control or logs.
-- - Set the Staging-only server-side connection env after authorization.
-- - Verify with a single synthetic reader JWT and source IDs, read-only.
-- - SELECT of pre-reference users/rows and attempts to mutate must fail.
-- - No Production credential, release, Point award or migration is permitted.
-- - For future read/comment awards, use a DIFFERENT reviewed writer gate.
