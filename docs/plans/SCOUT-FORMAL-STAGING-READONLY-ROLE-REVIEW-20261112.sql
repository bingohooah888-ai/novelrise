-- NOVELIGHT SCOUT Formal Staging Reader Read-Only Role -- REVIEW ONLY.
-- NOT A MIGRATION. Do not execute before separately scoped OWNER approval.
-- Dedicated Staging Supabase ref: wmlzjgvxgoyrovdhbqbg (NOT Production).
-- This document is NOT scheduled, imported, applied or used to create roles.
--
-- Staging reader GET ?view=new_reader:
--   Auth identity AND created_at are obtained from trusted server-side
--   supabase.auth.getUser(bearerToken), never read from auth.users via SQL.
--   The existing new-reader reader still queries canonical public XP/Point
--   and private Level/Wallet rows by verified Auth user ID.
--   Its private DB transactions bind that ID to a transaction-local GUC:
--     SELECT set_config('novelight.formal_reader_id', verifiedId, true);
--   BEGIN READ ONLY ... COMMIT/ROLLBACK provides scoped per-request cleanup.
--   A missing GUC fails closed under these policies. Custom GUC values are
--   not cryptographic authorization: theft of the DB role password can
--   bypass this binding; limit/rotate and monitor credentials accordingly.
--
-- Staging admin GET ?view=new_readers: DISABLED with 503. getUser() cannot
-- calculate reliable totalRegistered/initialized/partial cohort statistics.
-- Future admin aggregation requires separate trusted, OWNER-reviewed source.
-- Staging admin GET ?view=earning_source: admin allowlist + JWT only;
-- source-event existence proof only, NEVER Point eligibility authorization.
-- Pre-reference comment history may be incomplete due to limited RLS window.
--
-- Required runtime config after SEPARATE approval:
--   VERCEL_ENV=preview (staging branch only),
--   NOVELIGHT_SCOUT_FORMAL_STAGING_PROBE=read-only,
--   STAGING_SUPABASE_URL or existing NOVELIGHT_STAGING_SUPABASE_URL
--     (must exactly match https://wmlzjgvxgoyrovdhbqbg.supabase.co),
--   STAGING_PROJECT_REF=wmlzjgvxgoyrovdhbqbg,
--   PGSSLMODE=require,
--   STAGING_SUPABASE_PUBLISHABLE_KEY or existing
--     NOVELIGHT_STAGING_SUPABASE_PUBLISHABLE_KEY (server-only Auth),
--   STAGING_FORMAL_RO_DATABASE_URL (server-only credential).
-- No values for these are created or modified here.
-- Never reuse the privileged STAGING_DATABASE_URL / postgres credentials.
-- Postgres direct 5432 or exact project-matched session pooler only.
--
-- SECTION A -- OWNER-REVIEWED STAGING SQL PLAN; NOT EXECUTED.
-- Role has no LOGIN, BYPASSRLS, inherited privileged roles or write rights.
CREATE ROLE novelight_formal_reader_ro WITH
  NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT
  NOREPLICATION NOBYPASSRLS;
ALTER ROLE novelight_formal_reader_ro SET default_transaction_read_only = on;
ALTER ROLE novelight_formal_reader_ro SET statement_timeout = '5s';
ALTER ROLE novelight_formal_reader_ro SET search_path = pg_catalog;

GRANT USAGE ON SCHEMA public TO novelight_formal_reader_ro;
GRANT USAGE ON SCHEMA novelight_formal_private TO novelight_formal_reader_ro;

-- Six tables. Column grants prohibit unrestricted SELECT *.
-- No auth.users table/schema privileges, policies or dependencies.
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

-- Four user-specific data sets: fail closed without a valid transaction
-- context. The trusted server sets this from getUser(token), never from a
-- browser-supplied user ID or an unverified JWT claim.
-- This is an additional guard, not a substitute for server-side Auth.
CREATE POLICY novelight_formal_ro_verified_reader
  ON public.scout_point_ledger FOR SELECT
  TO novelight_formal_reader_ro
  USING (
    user_id = nullif(
      current_setting('novelight.formal_reader_id', true), ''
    )::uuid
  );
CREATE POLICY novelight_formal_ro_verified_reader
  ON public.scout_xp_ledger FOR SELECT
  TO novelight_formal_reader_ro
  USING (
    user_id = nullif(
      current_setting('novelight.formal_reader_id', true), ''
    )::uuid
  );
CREATE POLICY novelight_formal_ro_verified_reader
  ON novelight_formal_private.scout_level_state FOR SELECT
  TO novelight_formal_reader_ro
  USING (
    user_id = nullif(
      current_setting('novelight.formal_reader_id', true), ''
    )::uuid
  );
CREATE POLICY novelight_formal_ro_verified_reader
  ON novelight_formal_private.scout_point_usage_wallets FOR SELECT
  TO novelight_formal_reader_ro
  USING (
    user_id = nullif(
      current_setting('novelight.formal_reader_id', true), ''
    )::uuid
  );

-- Trusted admin source-event inspection has no subject-scoped DB identity.
-- Limit it to the synthetic Staging proof window and columns only. This
-- privilege is broader than a single reader's data; OWNER must accept the
-- remaining server-credential exposure risk before enabling this role.
CREATE POLICY novelight_formal_ro_staging_event
  ON public.valid_read_events FOR SELECT
  TO novelight_formal_reader_ro
  USING (qualified_at >= timestamptz '2026-11-10T00:00:00Z');
CREATE POLICY novelight_formal_ro_staging_event
  ON public.novel_comments FOR SELECT
  TO novelight_formal_reader_ro
  USING (created_at >= timestamptz '2026-11-10T00:00:00Z');

-- SECTION B -- SEPARATE OWNER APPROVAL REQUIRED.
-- Provision role LOGIN + random strong password through secrets channel only
-- after direct-vs-session-pooler support and TLS are confirmed.
-- Never commit credentials or unlock Production.
-- Verify private-row RLS with two distinct test user IDs, GUC absent,
-- wrong user, isolated transaction reuse, before/after event timestamps,
-- and attempt to write/execute functions (must be denied).
-- The client only checks SQL SELECT; server-side Auth+RLS must BOTH hold.
-- No read/comment reward, Level initialization, beta conversion, gift grant,
-- worker launch, cron creation, or Production deployment is authorized.
