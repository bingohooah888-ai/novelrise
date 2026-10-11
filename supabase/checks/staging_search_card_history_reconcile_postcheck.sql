do $check$
begin
  if (select count(*) from supabase_migrations.schema_migrations) <> 133
     or exists (select 1 from supabase_migrations.schema_migrations
       where version = '20260930210000')
     or (select count(*) from supabase_migrations.schema_migrations
       where version = '20260930153337'
         and name = 'search_card_metadata'
         and coalesce(array_length(statements,1),0) = 1
         and md5(statements[1]) = '35209c5b79644ca0d66c1a0c2112b535') <> 1
  then raise exception 'Staging version reconciliation postcheck failed';
  end if;
  if not exists (
    select 1 from pg_proc p
    where p.oid = to_regprocedure('public.novelight_search_card_metadata(bigint[])')
      and md5(pg_get_functiondef(p.oid)) = 'f913180101c8cd35744e51d34db1c55e'
  ) then raise exception 'Staging search card function changed after repair';
  end if;
end
$check$;
