-- Staging-only, read-only postcheck. The new comment function must match
-- the already observed Production definition, without changing AI candidate RLS.
do $comment_postcheck$
declare
  v_oid oid := pg_catalog.to_regprocedure(
    'public.novelight_comment_feed_scope(bigint,bigint,integer)'
  );
begin
  if v_oid is null
     or pg_catalog.md5(pg_catalog.pg_get_functiondef(v_oid))
        <> '9883e151750cf28b49c30a2b4a286e9d' then
    raise exception 'STAGING_COMMENT_POST_MISMATCH';
  end if;
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261028084410') <> 1
     or (select count(*) from supabase_migrations.schema_migrations
         where version = '20261030010000') <> 1 then
    raise exception 'STAGING_COMMENT_LEDGER_POST_MISMATCH';
  end if;
  if pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE') then
    raise exception 'STAGING_COMMENT_POST_PRIVILEGES_CHANGED';
  end if;
  if not exists (
       select 1 from pg_catalog.pg_class c
       where c.oid = pg_catalog.to_regclass('public.novelight_ai_review_candidates')
         and c.relrowsecurity
     )
     or (select count(*) from public.novelight_ai_review_candidates) <> 0 then
    raise exception 'STAGING_REVIEW_CANDIDATE_POST_UNSAFE';
  end if;
end
$comment_postcheck$;
