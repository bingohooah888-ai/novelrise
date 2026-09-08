\set ON_ERROR_STOP on

-- Read-only fail-closed precheck for the aggregate visual-trend RPC.
do $$
begin
  if to_regclass('public.novel_exposure_events') is null
     or to_regclass('public.novel_exposure_conversions') is null
     or to_regclass('public.episodes') is null then
    raise exception 'LIGHT ANALYTICS trend dependencies are incomplete';
  end if;

  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'novel_exposure_events'
       and column_name = 'author_id_snapshot'
  ) or not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'novel_exposure_events'
       and column_name = 'exposed_at'
  ) or not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'novel_exposure_conversions'
       and column_name = 'episode_number_snapshot'
  ) then
    raise exception 'LIGHT ANALYTICS trend dependency columns are incomplete';
  end if;

  if to_regprocedure('public.novelight_author_analytics_timeseries(integer)') is not null then
    raise exception 'LIGHT ANALYTICS trend RPC already exists';
  end if;
end
$$;