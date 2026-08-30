\set ON_ERROR_STOP on

do $$
declare
  v_oid oid := to_regprocedure(
    'public.novelight_publish_episode_atomic(bigint,bigint,text,text)'
  );
begin
  if v_oid is null then
    raise exception 'novelight_publish_episode_atomic is missing';
  end if;

  if (select prosecdef from pg_proc where oid = v_oid) then
    raise exception 'Atomic episode publish RPC must remain SECURITY INVOKER';
  end if;

  if not has_function_privilege('authenticated', v_oid, 'EXECUTE') then
    raise exception 'authenticated must be able to execute atomic episode publish RPC';
  end if;

  if has_function_privilege('anon', v_oid, 'EXECUTE') then
    raise exception 'anon must not be able to execute atomic episode publish RPC';
  end if;

  if exists (
    select 1
    from pg_proc p
    cross join lateral aclexplode(
      coalesce(p.proacl, acldefault('f', p.proowner))
    ) acl
    where p.oid = v_oid
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ) then
    raise exception 'PUBLIC execute privilege must be revoked from atomic episode publish RPC';
  end if;
end
$$;
