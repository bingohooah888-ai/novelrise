-- STAGING ONLY. One-time, reversible metadata version alias of exactly
-- one verified identical migration SQL body. No user/content tables are changed.
-- Requires a fresh approved GitHub issue-comment request and precheck.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
lock table supabase_migrations.schema_migrations in exclusive mode;
-- Re-run exact read-only gate after acquiring the write lock, to prevent races.
\i supabase/checks/staging_search_card_history_reconcile_precheck.sql
update supabase_migrations.schema_migrations
set version = '20260930153337'
where version = '20260930210000'
  and name = 'search_card_metadata'
  and coalesce(array_length(statements,1),0) = 1
  and md5(statements[1]) = '35209c5b79644ca0d66c1a0c2112b535';
do $check$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20260930153337') <> 1
     or exists (select 1 from supabase_migrations.schema_migrations
       where version = '20260930210000')
     or (select count(*) from supabase_migrations.schema_migrations) <> 133
  then raise exception 'Staging history alias transaction failed; rolled back';
  end if;
end
$check$;
commit;
