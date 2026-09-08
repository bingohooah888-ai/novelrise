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
  v_proc := to_regprocedure('public.novelight_light_seed_feed(integer,integer)');
  if v_proc is null then
    raise exception 'Postcheck failed: novelight_light_seed_feed(integer, integer) is missing';
  end if;

  select proowner, proacl, prosecdef, proconfig, lower(pg_get_functiondef(oid))
  into v_owner, v_acl, v_security_definer, v_config, v_definition
  from pg_proc
  where oid = v_proc;

  if v_security_definer is not true then
    raise exception 'Postcheck failed: novelight_light_seed_feed must be SECURITY DEFINER';
  end if;

  if not exists (
    select 1
    from unnest(coalesce(v_config, array[]::text[])) as setting
    where setting like 'search_path=pg_catalog, public%'
  ) then
    raise exception 'Postcheck failed: novelight_light_seed_feed search_path is not pinned';
  end if;

  if position('light_seeds' in v_definition) = 0
     or position('novel_id_snapshot' in v_definition) = 0
     or position('light_seed_count' in v_definition) = 0 then
    raise exception 'Postcheck failed: LIGHT SEED aggregation is missing';
  end if;

  if position('novel.status = ''published''' in v_definition) = 0 then
    raise exception 'Postcheck failed: published-only eligibility is missing';
  end if;

  if position('novel.created_at desc' in v_definition) = 0 then
    raise exception 'Postcheck failed: newest-first ordering is missing';
  end if;

  if exists (
    select 1
    from aclexplode(coalesce(v_acl, acldefault('f', v_owner))) as privilege
    where privilege.grantee = 0
      and privilege.privilege_type = 'EXECUTE'
  ) then
    raise exception 'Postcheck failed: PUBLIC must not execute novelight_light_seed_feed';
  end if;

  if not has_function_privilege('anon', 'public.novelight_light_seed_feed(integer,integer)', 'EXECUTE') then
    raise exception 'Postcheck failed: anon execute grant is missing';
  end if;

  if not has_function_privilege('authenticated', 'public.novelight_light_seed_feed(integer,integer)', 'EXECUTE') then
    raise exception 'Postcheck failed: authenticated execute grant is missing';
  end if;
end
$$;

select novel_id, light_seed_count
from public.novelight_light_seed_feed(1, 0)
where light_seed_count > 0
limit 1;
