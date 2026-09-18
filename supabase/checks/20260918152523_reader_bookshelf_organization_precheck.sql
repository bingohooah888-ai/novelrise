-- Precheck for NOVELIGHT B #10 private reader bookshelf organization.

do $$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.novels') is null
     or to_regclass('public.favorites') is null
     or to_regclass('public.reader_reading_progress') is null then
    raise exception 'PRECHECK FAIL: reader bookshelf prerequisites are missing';
  end if;

  if to_regclass('public.reader_bookshelf_entries') is not null
     or to_regprocedure('public.novelight_touch_reader_bookshelf_entry()') is not null then
    raise exception 'PRECHECK FAIL: reader bookshelf objects already exist';
  end if;

  if not (
    select relrowsecurity
    from pg_class
    where oid = 'public.favorites'::regclass
  ) then
    raise exception 'PRECHECK FAIL: favorites RLS is not enabled';
  end if;
end
$$;

select 'PRECHECK PASS: private bookshelf prerequisites are ready' as result;
