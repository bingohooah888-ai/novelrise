\set ON_ERROR_STOP on

do $$
declare
  v_proc oid;
  v_security_definer boolean;
  v_config text[];
  v_definition text;
begin
  v_proc := to_regprocedure('public.novelight_light_seed_feed(integer,integer)');
  if v_proc is null then
    raise exception 'Postcheck failed: novelight_light_seed_feed(integer, integer) is missing';
  end if;

  select prosecdef, proconfig, pg_get_functiondef(oid)
  into v_security_definer, v_config, v_definition
  from pg_proc
  where oid = v_proc;

  if v_security_definer is not true then
    raise exception 'Postcheck failed: novelight_light_seed_feed must be SECURITY DEFINER';
  end if;

  if not ('search_path=pg_catalog, public, pg_temp' = any(coalesce(v_config, array[]::text[]))) then
    raise exception 'Postcheck failed: novelight_light_seed_feed search_path is not pinned';
  end if;

  if position('light_seed_ledger' in v_definition) = 0
     or position('having sum(ledger.delta) > 0' in lower(v_definition)) = 0 then
    raise exception 'Postcheck failed: LIGHT SEED > 0 eligibility is missing';
  end if;

  if position('novel.status = ''published''' in lower(v_definition)) = 0 then
    raise exception 'Postcheck failed: published-only eligibility is missing';
  end if;

  if position('first_published_at' in v_definition) = 0 then
    raise exception 'Postcheck failed: published-date ordering is missing';
  end if;

  if has_function_privilege('public', 'public.novelight_light_seed_feed(integer,integer)', 'EXECUTE') then
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

select id, light_seed_count
from public.novelight_light_seed_feed(1, 0)
where light_seed_count > 0
limit 1;
