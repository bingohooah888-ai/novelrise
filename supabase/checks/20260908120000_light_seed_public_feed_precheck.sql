\set ON_ERROR_STOP on

do $$
declare
  v_missing_columns text[] := array[]::text[];
begin
  if to_regclass('public.novels') is null then
    raise exception 'Precheck failed: public.novels is missing';
  end if;

  if to_regclass('public.profiles') is null then
    raise exception 'Precheck failed: public.profiles is missing';
  end if;

  if to_regclass('public.favorites') is null then
    raise exception 'Precheck failed: public.favorites is missing';
  end if;

  if to_regclass('public.light_seeds') is null then
    raise exception 'Precheck failed: public.light_seeds is missing';
  end if;

  select array_agg(required.column_name order by required.column_name)
  into v_missing_columns
  from (
    values
      ('created_at'),
      ('description'),
      ('genre'),
      ('id'),
      ('pv'),
      ('status'),
      ('thumbnail_url'),
      ('title'),
      ('user_id')
  ) as required(column_name)
  where not exists (
    select 1
    from information_schema.columns as actual
    where actual.table_schema = 'public'
      and actual.table_name = 'novels'
      and actual.column_name = required.column_name
  );

  if coalesce(array_length(v_missing_columns, 1), 0) > 0 then
    raise exception 'Precheck failed: public.novels is missing required columns: %', v_missing_columns;
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'display_name'
  ) then
    raise exception 'Precheck failed: public.profiles.display_name is missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'light_seeds'
      and column_name = 'novel_id_snapshot'
  ) then
    raise exception 'Precheck failed: public.light_seeds.novel_id_snapshot is missing';
  end if;

  if to_regprocedure('public.novelight_light_seed_feed(integer,integer)') is not null then
    raise exception 'Precheck failed: novelight_light_seed_feed(integer, integer) already exists';
  end if;
end
$$;
