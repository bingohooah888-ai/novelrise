-- Read-only API/privilege checks. Fixture-based data checks live in tests/rls.
do $$
begin
  if to_regprocedure('public.novelight_search_card_metadata(bigint[])') is null then
    raise exception 'Search card metadata RPC is missing';
  end if;
  if not has_function_privilege('anon', 'public.novelight_search_card_metadata(bigint[])', 'execute')
     or not has_function_privilege('authenticated', 'public.novelight_search_card_metadata(bigint[])', 'execute') then
    raise exception 'Reader roles cannot read search cards';
  end if;
  if exists(select 1 from public.novelight_search_card_metadata('{}'::bigint[])) then
    raise exception 'Empty requests must not return cards';
  end if;
  if exists (
    select 1 from pg_proc p, lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid = 'public.novelight_search_card_metadata(bigint[])'::regprocedure
      and a.grantee = 0 and a.privilege_type = 'EXECUTE'
  ) then
    raise exception 'Unrestricted PUBLIC execution must be revoked';
  end if;
end
$$;
