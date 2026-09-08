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

  if to_regclass('public.light_seed_ledger') is null then
    raise exception 'Precheck failed: public.light_seed_ledger is missing';
  end if;

  select array_agg(required.column_name order by required.column_name)
  into v_missing_columns
  from (
    values
      ('author_id'),
      ('created_at'),
      ('first_published_at'),
      ('genre'),
      ('id'),
      ('pv'),
      ('status'),
      ('thumbnail_url'),
      ('title')
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

  if to_regprocedure('public.novelight_light_seed_feed(integer,integer)') is not null then
    raise exception 'Precheck failed: novelight_light_seed_feed(integer, integer) already exists';
  end if;
end
$$;
