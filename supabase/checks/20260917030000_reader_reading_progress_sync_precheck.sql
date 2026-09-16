-- Precheck for 20260917030000_reader_reading_progress_sync.sql

do $$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.novels') is null
     or to_regclass('public.episodes') is null then
    raise exception 'Required NOVELIGHT reading foundations are missing';
  end if;

  if to_regclass('public.reader_reading_progress') is not null
     or to_regprocedure('public.novelight_guard_reader_reading_progress()') is not null then
    raise exception 'Reader progress sync objects already exist; reconcile before applying migration';
  end if;
end
$$;
