-- READ-ONLY metadata probe for a *separately identified* NOVELIGHT Staging DB.
-- DO NOT RUN ON PRODUCTION. This file never changes the database.
-- A matching Staging project ID/ref and authorized connection must first be
-- established using scripts/verify-staging-migration-target.mjs.
-- Do not append, execute or combine this with the DDL proposal.
select
  current_database() as database_name,
  (select jsonb_agg(
    jsonb_build_object(
      'table', c.table_name, 'column', c.column_name, 'udt', c.udt_name
    )
    order by c.table_name, c.column_name
  ) from information_schema.columns c
   where c.table_schema = 'public'
     and (
       (c.table_name = 'novels' and c.column_name in ('id', 'user_id'))
       or (c.table_name = 'episodes' and c.column_name in ('id', 'novel_id', 'user_id'))
     )) as owner_fk_types,
  (select jsonb_agg(
    jsonb_build_object(
      'table', cls.relname,
      'rls_enabled', cls.relrowsecurity,
      'force_rls', cls.relforcerowsecurity
    ) order by cls.relname
  ) from pg_catalog.pg_class cls
    join pg_catalog.pg_namespace ns on ns.oid = cls.relnamespace
   where ns.nspname = 'public'
     and cls.relkind = 'r'
     and cls.relname in (
       'novelight_ai_external_processing_consents',
       'novelight_ai_external_consent_action_audit',
       'novelight_ai_review_candidates'
     )) as ai_table_metadata,
  (select jsonb_agg(
    jsonb_build_object(
      'function', proc.proname,
      'signature', pg_catalog.pg_get_function_identity_arguments(proc.oid),
      'security_definer', proc.prosecdef,
      'anon_execute', has_function_privilege(
        'anon', proc.oid, 'EXECUTE'
      ),
      'authenticated_execute', has_function_privilege(
        'authenticated', proc.oid, 'EXECUTE'
      ),
      'service_execute', has_function_privilege(
        'service_role', proc.oid, 'EXECUTE'
      )
    ) order by proc.proname
  ) from pg_catalog.pg_proc proc
    join pg_catalog.pg_namespace ns on ns.oid = proc.pronamespace
   where ns.nspname = 'public'
     and proc.proname in (
       'novelight_ai_consent_grant',
       'novelight_ai_consent_revoke',
       'novelight_ai_review_stage_batch',
       'novelight_ai_review_decide'
     )) as ai_rpc_metadata;
