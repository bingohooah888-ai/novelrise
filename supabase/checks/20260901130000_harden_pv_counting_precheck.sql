\set ON_ERROR_STOP on

-- NOVELIGHT authoritative PV counting precheck.
do $$
begin
  if to_regclass('public.novels') is null
     or to_regclass('public.episodes') is null then
    raise exception 'Required novels/episodes tables are missing';
  end if;

  if to_regprocedure('auth.uid()') is null then
    raise exception 'auth.uid() is required for authoritative PV identity';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'novels'
       and column_name = 'pv'
  ) or not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'episodes'
       and column_name = 'pv'
  ) then
    raise exception 'novels.pv and episodes.pv are required';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'novels'
       and column_name = 'status'
  ) or not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'episodes'
       and column_name = 'status'
  ) then
    raise exception 'Published-state columns are required';
  end if;

  if to_regclass('public.episode_pv_events') is not null then
    raise exception 'episode_pv_events already exists; stop and inspect before retrying';
  end if;

  if to_regprocedure('public.record_episode_pv(text,text)') is not null then
    raise exception 'record_episode_pv already exists; stop and inspect before retrying';
  end if;
end
$$;
