-- Read-only gate for the one historical Staging migration version alias.
-- Do NOT delete migration history or replay the already deployed function.
do $check$
declare
  v_old supabase_migrations.schema_migrations%rowtype;
  v_func oid;
begin
  if (select count(*) from supabase_migrations.schema_migrations) <> 133 then
    raise exception 'Staging migration count drift: expected 133';
  end if;
  if exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '20260930153337'
  ) then
    raise exception 'canonical history version already applied; refusing repair';
  end if;

  select * into v_old from supabase_migrations.schema_migrations
  where version = '20260930210000';
  if not found or v_old.name <> 'search_card_metadata'
     or coalesce(array_length(v_old.statements,1),0) <> 1
     or md5(v_old.statements[1]) <> '35209c5b79644ca0d66c1a0c2112b535' then
    raise exception 'Staging migration SQL provenance failed';
  end if;

  v_func := to_regprocedure('public.novelight_search_card_metadata(bigint[])');
  if v_func is null
     or not exists (
       select 1 from pg_proc p
       where p.oid = v_func
         and pg_get_userbyid(p.proowner) = 'postgres'
         and md5(pg_get_functiondef(p.oid)) = 'f913180101c8cd35744e51d34db1c55e'
         and p.prosecdef and p.provolatile = 's'
     )
     or not has_function_privilege('anon', v_func, 'EXECUTE')
     or not has_function_privilege('authenticated', v_func, 'EXECUTE')
     or has_function_privilege('public', v_func, 'EXECUTE')
     or obj_description(v_func,'pg_proc') <>
       'Public search cards for at most 100 currently published novels. Published episode aggregates only; no private lifecycle, identity or body fields.'
  then
    raise exception 'Staging search-card function definition, owner or grants drifted';
  end if;
end
$check$;
