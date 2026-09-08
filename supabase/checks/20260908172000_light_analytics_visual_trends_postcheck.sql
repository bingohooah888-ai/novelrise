\set ON_ERROR_STOP on

do $$
declare
  v_proc oid;
  v_owner oid;
  v_acl aclitem[];
  v_security_definer boolean;
  v_config text[];
  v_definition text;
begin
  v_proc := to_regprocedure('public.novelight_author_analytics_timeseries(integer)');
  if v_proc is null then
    raise exception 'Postcheck failed: LIGHT ANALYTICS trend RPC is missing';
  end if;

  select proowner, proacl, prosecdef, proconfig, lower(pg_get_functiondef(oid))
    into v_owner, v_acl, v_security_definer, v_config, v_definition
    from pg_proc
   where oid = v_proc;

  if v_security_definer is not true then
    raise exception 'Postcheck failed: LIGHT ANALYTICS trend RPC must be SECURITY DEFINER';
  end if;

  if not exists (
    select 1
      from unnest(coalesce(v_config, array[]::text[])) as setting
     where setting like 'search_path=pg_catalog, public, auth%'
  ) then
    raise exception 'Postcheck failed: LIGHT ANALYTICS trend search_path is not pinned';
  end if;

  if position('author_id_snapshot = v_uid' in v_definition) = 0
     or position('p_days * 2' in v_definition) = 0
     or position('previous_impressions' in v_definition) = 0
     or position('generate_series(0, p_days - 1)' in v_definition) = 0 then
    raise exception 'Postcheck failed: LIGHT ANALYTICS trend aggregation contract is incomplete';
  end if;

  if position('p_days > 90' in v_definition) = 0 then
    raise exception 'Postcheck failed: LIGHT ANALYTICS trend maximum window guard is missing';
  end if;

  if exists (
    select 1
      from aclexplode(coalesce(v_acl, acldefault('f', v_owner))) as privilege
     where privilege.grantee = 0
       and privilege.privilege_type = 'EXECUTE'
  ) then
    raise exception 'Postcheck failed: PUBLIC must not execute LIGHT ANALYTICS trend RPC';
  end if;

  if has_function_privilege('anon', 'public.novelight_author_analytics_timeseries(integer)', 'EXECUTE') then
    raise exception 'Postcheck failed: anon must not execute LIGHT ANALYTICS trend RPC';
  end if;

  if not has_function_privilege('authenticated', 'public.novelight_author_analytics_timeseries(integer)', 'EXECUTE') then
    raise exception 'Postcheck failed: authenticated execute grant is missing';
  end if;
end
$$;