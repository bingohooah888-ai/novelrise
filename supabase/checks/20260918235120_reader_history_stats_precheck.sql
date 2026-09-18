\set ON_ERROR_STOP on

do $$
begin
  if to_regclass('public.valid_read_events') is null
     or to_regclass('public.reader_reading_progress') is null
     or to_regclass('public.reader_bookshelf_entries') is null
     or to_regclass('public.novels') is null
     or to_regclass('public.episodes') is null then
    raise exception 'PRECHECK FAIL: B #17 reader history prerequisites are missing';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.valid_read_events'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.reader_reading_progress'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.reader_bookshelf_entries'::regclass) then
    raise exception 'PRECHECK FAIL: private reader data must keep RLS enabled';
  end if;

  if pg_catalog.has_table_privilege('anon', 'public.valid_read_events', 'select')
     or pg_catalog.has_table_privilege('authenticated', 'public.valid_read_events', 'select') then
    raise exception 'PRECHECK FAIL: raw valid-read events became client-readable';
  end if;

  if to_regprocedure('public.novelight_reader_history_stats(integer)') is not null then
    raise exception 'PRECHECK FAIL: B #17 history RPC already exists';
  end if;
end
$$;

select 'PRECHECK PASS: B #17 private reader history prerequisites are ready' as result;
