-- REVIEW ONLY: proposed catalog-only Staging assessment.
-- NOT A MIGRATION. DO NOT EXECUTE without exact Staging authorization.
-- Result contains booleans and object-presence only. No auth.sessions rows,
-- JWTs, manuscript, secret values, grants, mutations or migration repair.
-- This does NOT replace a separate check of Supabase migration-history parity.
--
-- IMPORTANT: PostgreSQL SELECT ... FOR SHARE requires UPDATE permission on
-- at least one column, even though no values are updated. Do not grant
-- privileges on the protected auth schema as an automatic repair.
with existing as (
  select
    pg_catalog.to_regclass('auth.sessions') as sessions_oid,
    pg_catalog.to_regclass('public.novels') as novels_oid,
    pg_catalog.to_regclass('public.novelight_ai_owner_review_states')
      as review_state_oid,
    pg_catalog.to_regprocedure(
      'public.novelight_ai_owner_review_state_cas(uuid,bigint,uuid,integer,jsonb)'
    ) as cas_oid
)
select
  (sessions_oid is not null) as auth_sessions_exists,
  (novels_oid is not null) as novels_exists,
  case when sessions_oid is not null then
    pg_catalog.has_schema_privilege('service_role', 'auth', 'USAGE')
  else false end as service_auth_schema_usage,
  case when sessions_oid is not null then
    pg_catalog.has_column_privilege(
      'service_role', sessions_oid, 'id', 'SELECT')
    and pg_catalog.has_column_privilege(
      'service_role', sessions_oid, 'user_id', 'SELECT')
  else false end as service_auth_sessions_pair_select,
  case when sessions_oid is not null then
    pg_catalog.has_any_column_privilege(
      'service_role', sessions_oid, 'UPDATE')
  else false end as service_auth_sessions_for_share_update,
  case when novels_oid is not null then
    pg_catalog.has_column_privilege(
      'service_role', novels_oid, 'id', 'SELECT')
    and pg_catalog.has_column_privilege(
      'service_role', novels_oid, 'user_id', 'SELECT')
  else false end as service_novels_owner_select,
  case when novels_oid is not null then
    pg_catalog.has_any_column_privilege(
      'service_role', novels_oid, 'UPDATE')
  else false end as service_novels_for_share_update,
  (review_state_oid is not null) as review_state_table_already_exists,
  (cas_oid is not null) as cas_function_already_exists,
  case when cas_oid is not null then
    pg_catalog.has_function_privilege('anon', cas_oid, 'EXECUTE')
  else false end as cas_anon_can_execute,
  case when cas_oid is not null then
    pg_catalog.has_function_privilege('authenticated', cas_oid, 'EXECUTE')
  else false end as cas_authenticated_can_execute
from existing;

-- NO GO when any service_* privilege required above is FALSE, the
-- session/novels objects are missing, ownership is uncertain, unexpected
-- existing owner-review objects exist, or migration-history parity fails.
-- Never use a positive catalog report as proof of signed-JWT correctness.
