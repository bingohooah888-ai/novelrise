-- NOVELIGHT exposure-to-reading funnel precheck.
\set ON_ERROR_STOP on

do $$
begin
  if to_regclass('public.novel_exposure_events') is null then
    raise exception 'public.novel_exposure_events is required';
  end if;

  if to_regclass('public.novels') is null or to_regclass('public.episodes') is null then
    raise exception 'public.novels and public.episodes are required';
  end if;

  if to_regclass('public.novel_exposure_conversions') is not null then
    raise exception 'novel_exposure_conversions already exists; review before applying';
  end if;

  if to_regprocedure('public.record_novel_exposure_conversion(text,text,text,text)') is not null then
    raise exception 'record_novel_exposure_conversion already exists';
  end if;

  if to_regprocedure('public.novelight_author_exposure_funnel(integer)') is not null then
    raise exception 'novelight_author_exposure_funnel already exists';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'novel_exposure_events'
      and column_name = 'viewer_key'
  ) then
    raise exception 'novel_exposure_events.viewer_key is required';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'episodes'
      and column_name = 'status'
  ) then
    raise exception 'episodes.status is required';
  end if;
end
$$;

select 'PASS: exposure funnel precheck' as result;
