\set ON_ERROR_STOP on

do $$
begin
  if to_regclass('public.novel_series') is null
     or to_regclass('public.novel_series_items') is null then
    raise exception 'Novel series tables were not created';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.novel_series'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.novel_series_items'::regclass) then
    raise exception 'RLS is not enabled on novel series tables';
  end if;

  if to_regprocedure('public.novelight_set_series_items(bigint,bigint[])') is null
     or to_regprocedure('public.novelight_public_series_context(bigint)') is null then
    raise exception 'Novel series RPC is missing';
  end if;

  if has_table_privilege('anon', 'public.novel_series', 'SELECT')
     or has_table_privilege('anon', 'public.novel_series_items', 'SELECT') then
    raise exception 'anon must not have raw series table access';
  end if;

  if not has_table_privilege('authenticated', 'public.novel_series', 'SELECT')
     or not has_table_privilege('authenticated', 'public.novel_series', 'INSERT')
     or not has_table_privilege('authenticated', 'public.novel_series', 'UPDATE')
     or not has_table_privilege('authenticated', 'public.novel_series', 'DELETE')
     or not has_table_privilege('authenticated', 'public.novel_series_items', 'SELECT')
     or not has_table_privilege('authenticated', 'public.novel_series_items', 'INSERT')
     or not has_table_privilege('authenticated', 'public.novel_series_items', 'UPDATE')
     or not has_table_privilege('authenticated', 'public.novel_series_items', 'DELETE') then
    raise exception 'authenticated series table grants are incomplete';
  end if;

  if not has_function_privilege('anon', 'public.novelight_public_series_context(bigint)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.novelight_public_series_context(bigint)', 'EXECUTE') then
    raise exception 'Public series context execute grants are incomplete';
  end if;

  if has_function_privilege('anon', 'public.novelight_set_series_items(bigint,bigint[])', 'EXECUTE') then
    raise exception 'anon must not execute author series mutation RPC';
  end if;

  if (
    select count(*)
      from pg_policies
     where schemaname = 'public'
       and tablename = 'novel_series'
       and roles @> array['authenticated']::name[]
  ) < 4 then
    raise exception 'Novel series owner policies are incomplete';
  end if;

  if (
    select count(*)
      from pg_policies
     where schemaname = 'public'
       and tablename = 'novel_series_items'
       and roles @> array['authenticated']::name[]
  ) < 4 then
    raise exception 'Novel series item owner policies are incomplete';
  end if;
end
$$;
