-- NOVELIGHT Point10x / STAGING CATALOG READ-ONLY REVIEW CANDIDATE.
-- NOT AN ACTIVE MIGRATION. DO NOT EXECUTE IN THIS TURN.
-- OWNER fresh SHA + dedicated Staging ref + exact SQL digest approval REQUIRED.
-- NEVER execute in Production. No source row data, function body, tokens or secrets.
-- Output is metadata ONLY; absence of findings is NOT proof of a fenced Data Plane.
-- SQL designed for PostgreSQL 15+ catalog review; not runtime-verified.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

-- NL-CATALOG-01: identity, context and read-only posture.
SELECT
  'NL-CATALOG-01' AS evidence_id,
  current_database() AS database_name,
  current_user AS current_role_name,
  session_user AS session_role_name,
  current_setting('server_version_num') AS pg_server_version_num,
  current_setting('transaction_read_only') AS transaction_read_only,
  pg_catalog.pg_is_in_recovery() AS is_in_recovery;

-- NL-CATALOG-02: protected relations, owner, RLS and effective role privileges.
WITH target(relname) AS (
  VALUES
    ('scout_xp_ledger'), ('scout_event_ledger'),
    ('scout_point_ledger'), ('scout_badge_definitions'),
    ('user_scout_badges'), ('scout_point_operator_actions'),
    ('scout_point_user_controls'), ('scout_badge_metric_events'),
    ('scout_badge_metric_state')
),
target_role AS (
  SELECT oid, rolname, rolbypassrls, rolsuper
  FROM pg_catalog.pg_roles
  WHERE rolname = 'service_role'
)
SELECT
  'NL-CATALOG-02' AS evidence_id,
  target.relname AS expected_relation,
  c.oid IS NOT NULL AS found,
  c.relkind,
  pg_catalog.pg_get_userbyid(c.relowner) AS table_owner,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS force_rls,
  c.relacl::text AS explicit_acl,
  r.rolname AS tested_role,
  r.rolbypassrls AS tested_role_bypassrls,
  r.rolsuper AS tested_role_superuser,
  CASE WHEN r.oid IS NULL OR c.oid IS NULL THEN NULL
       ELSE pg_catalog.has_table_privilege(r.oid, c.oid, 'INSERT') END AS can_insert,
  CASE WHEN r.oid IS NULL OR c.oid IS NULL THEN NULL
       ELSE pg_catalog.has_table_privilege(r.oid, c.oid, 'UPDATE') END AS can_update,
  CASE WHEN r.oid IS NULL OR c.oid IS NULL THEN NULL
       ELSE pg_catalog.has_table_privilege(r.oid, c.oid, 'DELETE') END AS can_delete,
  CASE WHEN r.oid IS NULL OR c.oid IS NULL THEN NULL
       ELSE pg_catalog.has_table_privilege(r.oid, c.oid, 'TRUNCATE') END AS can_truncate,
  CASE WHEN r.oid IS NULL OR c.oid IS NULL THEN NULL
       ELSE pg_catalog.has_table_privilege(r.oid, c.oid, 'TRIGGER') END AS can_trigger
FROM target
LEFT JOIN pg_catalog.pg_namespace n ON n.nspname = 'public'
LEFT JOIN pg_catalog.pg_class c ON c.relnamespace = n.oid AND c.relname = target.relname
LEFT JOIN target_role r ON TRUE
ORDER BY target.relname;

-- NL-CATALOG-03: trigger enablement and referenced function identity.
WITH target(relname) AS (
  VALUES ('scout_event_ledger'), ('scout_xp_ledger'), ('scout_point_ledger'),
         ('scout_badge_definitions'), ('user_scout_badges'),
         ('scout_point_operator_actions'), ('scout_badge_metric_events')
)
SELECT
  'NL-CATALOG-03' AS evidence_id,
  target.relname AS expected_relation,
  c.oid IS NOT NULL AS relation_found,
  t.tgname AS trigger_name,
  t.tgenabled AS trigger_enabled_state,
  t.tgisinternal AS internal_trigger,
  t.tgfoid::regprocedure::text AS invoked_function,
  CASE WHEN t.oid IS NULL THEN NULL
       ELSE pg_catalog.pg_get_triggerdef(t.oid, FALSE) END AS trigger_definition
FROM target
LEFT JOIN pg_catalog.pg_namespace n ON n.nspname = 'public'
LEFT JOIN pg_catalog.pg_class c ON c.relnamespace = n.oid AND c.relname = target.relname
LEFT JOIN pg_catalog.pg_trigger t ON t.tgrelid = c.oid
ORDER BY target.relname, t.tgname;

-- NL-CATALOG-04: SECDEF, owner, EXECUTE, search_path; hash only, no function body.
WITH target(signature) AS (
  VALUES
    ('public.novelight_award_level_up_points()'),
    ('public.novelight_award_level_up_points_rank_internal_20260928()'),
    ('public.novelight_award_discovery_points()'),
    ('public.novelight_award_discovery_points_rank_internal_20260928()'),
    ('public.novelight_enforce_scout_point_control()'),
    ('public.novelight_apply_scout_badge_progress(uuid,text,bigint,jsonb)'),
    ('public.novelight_apply_scout_badge_evaluation(uuid,text,bigint,numeric,boolean,jsonb,boolean)'),
    ('public.novelight_admin_scout_point_action(uuid,text,text,uuid,uuid,timestamp with time zone,integer)'),
    ('public.novelight_process_seed_discovery(uuid)'),
    ('public.novelight_scout_point_earning_allowed(uuid)'),
    ('public.novelight_refresh_my_scout_badges()'),
    ('public.novelight_record_scout_badge_metric(uuid,text,bigint,text,jsonb)')
), role_target AS (
  SELECT oid, rolname FROM pg_catalog.pg_roles WHERE rolname = 'service_role'
)
SELECT
  'NL-CATALOG-04' AS evidence_id,
  target.signature,
  p.oid IS NOT NULL AS found,
  p.oid::regprocedure::text AS deployed_identity,
  pg_catalog.pg_get_userbyid(p.proowner) AS function_owner,
  p.prosecdef AS is_security_definer,
  p.proconfig::text AS function_session_settings,
  p.proacl::text AS explicit_execute_acl,
  CASE WHEN p.oid IS NULL THEN NULL ELSE pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)) END AS function_definition_md5,
  r.rolname AS tested_role,
  CASE WHEN r.oid IS NULL OR p.oid IS NULL THEN NULL
       ELSE pg_catalog.has_function_privilege(r.oid, p.oid, 'EXECUTE') END AS role_can_execute
FROM target
LEFT JOIN pg_catalog.pg_proc p ON p.oid = pg_catalog.to_regprocedure(target.signature)
LEFT JOIN role_target r ON TRUE
ORDER BY target.signature;

-- NL-CATALOG-05: role flags; missing roles remain explicit NULL.
WITH target(rolname) AS (
  VALUES ('service_role'), ('postgres'), ('anon'),
         ('authenticated'), ('supabase_admin')
)
SELECT
  'NL-CATALOG-05' AS evidence_id,
  target.rolname AS expected_role,
  r.oid IS NOT NULL AS found,
  r.rolsuper, r.rolbypassrls, r.rolinherit, r.rolcreaterole, r.rolcreatedb, r.rolcanlogin
FROM target
LEFT JOIN pg_catalog.pg_roles r ON r.rolname = target.rolname
ORDER BY target.rolname;

-- NL-CATALOG-06: role memberships; do not read pg_authid/password material.
SELECT
  'NL-CATALOG-06' AS evidence_id,
  role.rolname AS granted_role,
  member.rolname AS member_role,
  grantor.rolname AS grantor_role,
  m.admin_option
FROM pg_catalog.pg_auth_members m
JOIN pg_catalog.pg_roles role ON role.oid = m.roleid
JOIN pg_catalog.pg_roles member ON member.oid = m.member
LEFT JOIN pg_catalog.pg_roles grantor ON grantor.oid = m.grantor
WHERE role.rolname IN ('service_role','postgres','anon','authenticated','supabase_admin')
   OR member.rolname IN ('service_role','postgres','anon','authenticated','supabase_admin')
ORDER BY role.rolname, member.rolname;

-- NL-CATALOG-07: schema and default ACLs that may grant future writers.
SELECT
  'NL-CATALOG-07' AS evidence_id,
  n.nspname AS schema_name,
  pg_catalog.pg_get_userbyid(n.nspowner) AS schema_owner,
  n.nspacl::text AS schema_acl,
  d.defaclobjtype AS default_object_type,
  pg_catalog.pg_get_userbyid(d.defaclrole) AS default_grant_owner,
  d.defaclacl::text AS default_acl
FROM pg_catalog.pg_namespace n
LEFT JOIN pg_catalog.pg_default_acl d ON d.defaclnamespace = n.oid
WHERE n.nspname IN ('public','cron')
ORDER BY n.nspname, d.defaclobjtype;

-- NL-CATALOG-08: pg_cron metadata presence only, NO jobs or secrets read.
SELECT
  'NL-CATALOG-08' AS evidence_id,
  pg_catalog.to_regclass('cron.job') IS NOT NULL AS cron_job_relation_exists,
  EXISTS (SELECT 1 FROM pg_catalog.pg_extension e WHERE e.extname = 'pg_cron') AS pg_cron_extension_installed;

ROLLBACK;
