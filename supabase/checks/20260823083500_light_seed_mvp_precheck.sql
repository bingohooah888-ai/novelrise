-- NOVELIGHT LIGHT SEED MVP precheck.
-- Stop before migration if the production schema is not the shape this migration expects.

\set ON_ERROR_STOP on

do $$
begin
  if to_regclass('public.novels') is null then
    raise exception 'public.novels is required';
  end if;

  if to_regclass('public.favorites') is null then
    raise exception 'public.favorites is required';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'novels'
      and column_name = 'id'
      and data_type = 'uuid'
  ) then
    raise exception 'public.novels.id must be uuid';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'novels'
      and column_name = 'user_id'
      and data_type = 'uuid'
  ) then
    raise exception 'public.novels.user_id must be uuid';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'novels'
      and column_name = 'status'
  ) then
    raise exception 'public.novels.status is required';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'novels'
      and column_name = 'pv'
  ) then
    raise exception 'public.novels.pv is required for LIGHT SEED eligibility';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'favorites'
      and column_name = 'novel_id'
      and data_type = 'uuid'
  ) then
    raise exception 'public.favorites.novel_id must be uuid';
  end if;

  if to_regclass('public.light_seeds') is not null
     or to_regclass('public.light_seed_rules') is not null then
    raise exception 'LIGHT SEED tables already exist; review before applying';
  end if;

  if to_regprocedure('public.light_seed_status(uuid)') is not null
     or to_regprocedure('public.plant_light_seed(uuid)') is not null then
    raise exception 'LIGHT SEED functions already exist; review before applying';
  end if;
end
$$;

select 'PASS: LIGHT SEED precheck' as result;
