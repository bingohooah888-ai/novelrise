-- NOVELIGHT public official thumbnail lookup postcheck.
\set ON_ERROR_STOP on

do $$
declare
  v_oid oid;
  v_secdef boolean;
  v_config text[];
  v_definition text;
begin
  v_oid := to_regprocedure('public.novelight_public_thumbnail_urls(text[])');
  if v_oid is null then
    raise exception 'public thumbnail lookup function is missing';
  end if;

  select prosecdef, proconfig, pg_get_functiondef(oid)
    into v_secdef, v_config, v_definition
  from pg_proc
  where oid = v_oid;

  if v_secdef is distinct from true then
    raise exception 'public thumbnail lookup must be SECURITY DEFINER';
  end if;

  if not coalesce(v_config, '{}'::text[]) @> array['search_path=pg_catalog, public']::text[] then
    raise exception 'public thumbnail lookup fixed search_path is missing';
  end if;

  if has_function_privilege('public', 'public.novelight_public_thumbnail_urls(text[])', 'EXECUTE')
     or not has_function_privilege('anon', 'public.novelight_public_thumbnail_urls(text[])', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.novelight_public_thumbnail_urls(text[])', 'EXECUTE') then
    raise exception 'public thumbnail lookup function privileges are incorrect';
  end if;

  if position('cardinality(p_novel_ids) > 100' in v_definition) = 0
     or position('n.status = ''published''' in v_definition) = 0
     or position('n.thumbnail_url like ''https://%''' in v_definition) = 0 then
    raise exception 'public thumbnail lookup safety contract is incomplete';
  end if;
end
$$;

select 'PASS: public thumbnail lookup postcheck' as result;
