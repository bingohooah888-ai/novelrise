-- Postcheck for 20260917030000_reader_reading_progress_sync.sql

do $$
declare
  v_rls boolean;
  v_policy_count integer;
  v_trigger_count integer;
begin
  if to_regclass('public.reader_reading_progress') is null then
    raise exception 'Reader progress table was not created';
  end if;

  select c.relrowsecurity
    into v_rls
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'reader_reading_progress';

  if not coalesce(v_rls, false) then
    raise exception 'RLS must be enabled on reader_reading_progress';
  end if;

  if pg_catalog.has_table_privilege('anon', 'public.reader_reading_progress', 'select')
     or pg_catalog.has_table_privilege('anon', 'public.reader_reading_progress', 'insert')
     or pg_catalog.has_table_privilege('anon', 'public.reader_reading_progress', 'update')
     or pg_catalog.has_table_privilege('anon', 'public.reader_reading_progress', 'delete') then
    raise exception 'Anonymous users must not access reader progress';
  end if;

  if not pg_catalog.has_table_privilege('authenticated', 'public.reader_reading_progress', 'select')
     or not pg_catalog.has_table_privilege('authenticated', 'public.reader_reading_progress', 'insert')
     or not pg_catalog.has_table_privilege('authenticated', 'public.reader_reading_progress', 'update')
     or pg_catalog.has_table_privilege('authenticated', 'public.reader_reading_progress', 'delete') then
    raise exception 'Authenticated reader progress privileges are incorrect';
  end if;

  select count(*)
    into v_policy_count
    from pg_catalog.pg_policies
   where schemaname = 'public'
     and tablename = 'reader_reading_progress'
     and policyname in (
       'reader_reading_progress_select_own',
       'reader_reading_progress_insert_own',
       'reader_reading_progress_update_own'
     );
  if v_policy_count <> 3 then
    raise exception 'Reader progress RLS policies are incomplete';
  end if;

  if to_regprocedure('public.novelight_guard_reader_reading_progress()') is null then
    raise exception 'Reader progress guard function is missing';
  end if;

  if pg_catalog.has_function_privilege('public', 'public.novelight_guard_reader_reading_progress()', 'execute')
     or pg_catalog.has_function_privilege('anon', 'public.novelight_guard_reader_reading_progress()', 'execute')
     or pg_catalog.has_function_privilege('authenticated', 'public.novelight_guard_reader_reading_progress()', 'execute') then
    raise exception 'Reader progress trigger function must not be directly executable by clients';
  end if;

  select count(*)
    into v_trigger_count
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_class c on c.oid = t.tgrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname = 'reader_reading_progress'
     and t.tgname = 'reader_reading_progress_guard'
     and not t.tgisinternal;
  if v_trigger_count <> 1 then
    raise exception 'Reader progress guard trigger is missing';
  end if;
end
$$;
