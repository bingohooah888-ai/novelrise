-- REVIEW ONLY: catalog booleans for a separately approved Staging install.
-- NOT A MIGRATION. DO NOT EXECUTE without exact Staging authorization.
-- No rows from auth.sessions, JWTs, secrets, grants, writes or history repair.
-- The private session guard runs with the trusted installer privileges; the
-- service_role must NOT receive Auth SELECT/UPDATE grants for FOR SHARE.
with existing as (
  select
    pg_catalog.to_regclass('auth.sessions') as sessions_oid,
    pg_catalog.to_regclass('public.novels') as novels_oid,
    pg_catalog.to_regclass('public.novelight_ai_owner_review_states')
      as review_state_oid,
    pg_catalog.to_regnamespace('novelight_ai_private') as private_schema_oid,
    pg_catalog.to_regprocedure(
      'public.novelight_ai_owner_review_state_cas(uuid,bigint,uuid,integer,jsonb)'
    ) as cas_oid,
    pg_catalog.to_regprocedure(
      'public.novelight_ai_owner_session_exists_v1(uuid,uuid)'
    ) as probe_oid
)
select
  (sessions_oid is not null) as auth_sessions_exists,
  (novels_oid is not null) as novels_exists,
  case when sessions_oid is not null then
    pg_catalog.has_schema_privilege(current_user, 'auth', 'USAGE')
    and pg_catalog.has_column_privilege(current_user, sessions_oid, 'id', 'SELECT')
    and pg_catalog.has_column_privilege(current_user, sessions_oid, 'user_id', 'SELECT')
    and pg_catalog.has_column_privilege(current_user, sessions_oid, 'not_after', 'SELECT')
  else false end as installer_can_read_session_fields,
  case when sessions_oid is not null then
    pg_catalog.has_any_column_privilege(current_user, sessions_oid, 'UPDATE')
  else false end as installer_can_lock_session,
  case when sessions_oid is not null then
    exists (select 1 from pg_catalog.pg_attribute
      where attrelid = sessions_oid and attname = 'not_after' and not attisdropped)
  else false end as auth_sessions_has_not_after,
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
  (private_schema_oid is not null) as private_schema_already_exists,
  (cas_oid is not null) as cas_function_already_exists,
  (probe_oid is not null) as session_probe_already_exists,
  case when cas_oid is not null then
    pg_catalog.has_function_privilege('anon', cas_oid, 'EXECUTE')
  else false end as cas_anon_can_execute,
  case when cas_oid is not null then
    pg_catalog.has_function_privilege('authenticated', cas_oid, 'EXECUTE')
  else false end as cas_authenticated_can_execute,
  case when probe_oid is not null then
    pg_catalog.has_function_privilege('anon', probe_oid, 'EXECUTE')
  else false end as probe_anon_can_execute,
  case when probe_oid is not null then
    pg_catalog.has_function_privilege('authenticated', probe_oid, 'EXECUTE')
  else false end as probe_authenticated_can_execute
from existing;

-- Fail closed on missing installer permissions, unexpected existing objects,
-- exposed private schema, or unrelated migration divergence. No Auth grants.
-- Real signed-JWT, RLS and transaction/race proofs remain separate gates.
