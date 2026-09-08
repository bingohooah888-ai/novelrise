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
  v_proc := to_regprocedure('public.novelight_author_exposure_funnel_v2(integer)');
  if v_proc is null then
    raise exception 'Postcheck failed: LIGHT ANALYTICS v2 RPC is missing';
  end if;

  select proowner, proacl, prosecdef, proconfig, lower(pg_get_functiondef(oid))
    into v_owner, v_acl, v_security_definer, v_config, v_definition
    from pg_proc
   where oid = v_proc;

  if v_security_definer is not true then
    raise exception 'Postcheck failed: LIGHT ANALYTICS v2 must be SECURITY DEFINER';
  end if;

  if not exists (
    select 1
      from unnest(coalesce(v_config, array[]::text[])) as setting
     where setting like 'search_path=pg_catalog, public, auth%'
  ) then
    raise exception 'Postcheck failed: LIGHT ANALYTICS v2 search_path is not pinned';
  end if;

  if position('order by 3 desc nulls last, 1 nulls last' in v_definition) = 0 then
    raise exception 'Postcheck failed: non-ambiguous LIGHT ANALYTICS ordering is missing';
  end if;

  if position('order by impressions desc nulls last, novel_id nulls last' in v_definition) > 0 then
    raise exception 'Postcheck failed: ambiguous LIGHT ANALYTICS ordering remains';
  end if;

  if position('where v_plan in (''standard'', ''premium'')' in v_definition) = 0
     or position('having v_plan = ''free''' in v_definition) = 0
     or position('v_plan = ''premium''' in v_definition) = 0 then
    raise exception 'Postcheck failed: plan entitlement boundaries changed unexpectedly';
  end if;

  if exists (
    select 1
      from aclexplode(coalesce(v_acl, acldefault('f', v_owner))) as privilege
     where privilege.grantee = 0
       and privilege.privilege_type = 'EXECUTE'
  ) then
    raise exception 'Postcheck failed: PUBLIC must not execute LIGHT ANALYTICS v2';
  end if;

  if has_function_privilege('anon', 'public.novelight_author_exposure_funnel_v2(integer)', 'EXECUTE') then
    raise exception 'Postcheck failed: anon must not execute LIGHT ANALYTICS v2';
  end if;

  if not has_function_privilege('authenticated', 'public.novelight_author_exposure_funnel_v2(integer)', 'EXECUTE') then
    raise exception 'Postcheck failed: authenticated execute grant is missing';
  end if;
end
$$;
