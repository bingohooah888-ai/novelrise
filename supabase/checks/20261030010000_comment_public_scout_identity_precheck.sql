-- Staging-only, read-only precheck for the existing 20261030010000 migration.
-- Never use this as approval to execute a migration.
do $comment_precheck$
declare
  v_oid oid := pg_catalog.to_regprocedure(
    'public.novelight_comment_feed_scope(bigint,bigint,integer)'
  );
begin
  if v_oid is null
     or pg_catalog.md5(pg_catalog.pg_get_functiondef(v_oid))
        <> '92dd0172a48e9c35deb38eb8ba75f4cf' then
    raise exception 'STAGING_COMMENT_BASELINE_MISMATCH';
  end if;
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261028084410') <> 1
     or (select count(*) from supabase_migrations.schema_migrations
         where version = '20261030010000') <> 0 then
    raise exception 'STAGING_COMMENT_LEDGER_MISMATCH';
  end if;
  if pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE') then
    raise exception 'STAGING_COMMENT_EXECUTE_PRIVILEGES_CHANGED';
  end if;
  if pg_catalog.to_regclass('public.novelight_ai_review_candidates')
        is null
     or not exists (
       select 1 from pg_catalog.pg_class c
       where c.oid = 'public.novelight_ai_review_candidates'::regclass
         and c.relrowsecurity
     )
     or (select count(*) from public.novelight_ai_review_candidates) <> 0 then
    raise exception 'STAGING_REVIEW_CANDIDATE_STATE_UNSAFE';
  end if;
end
$comment_precheck$;
