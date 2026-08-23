-- NOVELIGHT beta exposure allocation precheck.
\set ON_ERROR_STOP on

do $$
begin
  if to_regclass('public.novels') is null then
    raise exception 'public.novels is required';
  end if;

  if to_regclass('public.profiles') is null then
    raise exception 'public.profiles is required';
  end if;

  if to_regclass('public.favorites') is null then
    raise exception 'public.favorites is required';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'novels' and column_name = 'id'
  ) then
    raise exception 'public.novels.id is required';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'novels' and column_name = 'user_id' and data_type = 'uuid'
  ) then
    raise exception 'public.novels.user_id must be uuid';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'novels' and column_name in ('title', 'genre', 'description', 'status', 'created_at', 'pv')
    group by table_schema, table_name
    having count(*) = 6
  ) then
    raise exception 'public.novels discovery columns are incomplete';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'plan'
  ) then
    raise exception 'public.profiles.plan is required';
  end if;

  if to_regclass('public.novel_exposure_events') is not null
     or to_regclass('public.novel_exposure_rules') is not null then
    raise exception 'Exposure allocation tables already exist; review before applying';
  end if;

  if to_regprocedure('public.novelight_discovery_feed(text,integer,text,text,text)') is not null
     or to_regprocedure('public.record_novel_impressions(text,text[],text)') is not null then
    raise exception 'Exposure allocation functions already exist; review before applying';
  end if;
end
$$;

select 'PASS: exposure allocation precheck' as result;
