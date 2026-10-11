-- Manual-only rollback. Never run automatically and never run on Production.
-- Requires a separately approved Staging recovery request and proof that
-- no new migration or dependent operation has been executed after alias repair.
begin;
set local lock_timeout = '5s';
lock table supabase_migrations.schema_migrations in exclusive mode;
do $check$
begin
  if (select count(*) from supabase_migrations.schema_migrations) <> 133
     or exists (select 1 from supabase_migrations.schema_migrations
         where version = '20260930210000')
     or (select count(*) from supabase_migrations.schema_migrations
         where version = '20260930153337' and name = 'search_card_metadata'
           and coalesce(array_length(statements,1),0)=1
           and md5(statements[1])='35209c5b79644ca0d66c1a0c2112b535') <> 1
  then raise exception 'Cannot reverse Staging history mapping after state drift';
  end if;
end
$check$;
update supabase_migrations.schema_migrations
  set version = '20260930210000'
  where version = '20260930153337'
    and name = 'search_card_metadata'
    and md5(statements[1])='35209c5b79644ca0d66c1a0c2112b535';
commit;
