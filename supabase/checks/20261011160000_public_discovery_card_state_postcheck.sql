-- Read-only function, grants, and empty-request contract verification.
-- Published/draft and future-scheduled visibility is regression-tested in tests/rls.
do $$
begin
  if to_regprocedure('public.novelight_public_discovery_card_state(bigint[])') is null then
    raise exception 'Public discovery card RPC is missing';
  end if;

  if not has_function_privilege(
      'anon', 'public.novelight_public_discovery_card_state(bigint[])', 'EXECUTE'
    )
    or not has_function_privilege(
      'authenticated', 'public.novelight_public_discovery_card_state(bigint[])', 'EXECUTE'
    ) then
    raise exception 'Reader roles cannot execute public discovery card RPC';
  end if;

  if exists (
    select 1
    from pg_proc p,
      lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid = 'public.novelight_public_discovery_card_state(bigint[])'::regprocedure
      and a.grantee = 0
      and a.privilege_type = 'EXECUTE'
  ) then
    raise exception 'Unrestricted PUBLIC execution on discovery card RPC';
  end if;

  if exists (
    select 1
    from public.novelight_public_discovery_card_state('{}'::bigint[])
  ) then
    raise exception 'Empty discovery requests must not return cards';
  end if;
end
$$;
