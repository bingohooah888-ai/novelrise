-- NOVELIGHT SCOUT / LIGHT SEED beta event foundations precheck.
\set ON_ERROR_STOP on

do $$
begin
  if to_regclass('public.novels') is null
     or to_regclass('public.episodes') is null
     or to_regclass('public.favorites') is null
     or to_regclass('public.light_seeds') is null then
    raise exception 'SCOUT beta foundations require novels, episodes, favorites, and light_seeds';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'novels' and column_name = 'id'
  ) or not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'novels' and column_name = 'user_id'
  ) or not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'novels' and column_name = 'status'
  ) or not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'novels' and column_name = 'pv'
  ) then
    raise exception 'SCOUT beta foundations require novels.id/user_id/status/pv';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'episodes' and column_name = 'id'
  ) or not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'episodes' and column_name = 'novel_id'
  ) or not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'episodes' and column_name = 'user_id'
  ) or not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'episodes' and column_name = 'status'
  ) or not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'episodes' and column_name = 'content'
  ) then
    raise exception 'SCOUT beta foundations require episodes.id/novel_id/user_id/status/content';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'light_seeds' and column_name = 'id'
  ) or not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'light_seeds' and column_name = 'reader_id'
  ) or not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'light_seeds' and column_name = 'novel_id_snapshot'
  ) or not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'light_seeds' and column_name = 'seed_month'
  ) or not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'light_seeds' and column_name = 'seeded_at'
  ) then
    raise exception 'SCOUT beta foundations require the existing LIGHT SEED ledger contract';
  end if;

  if to_regprocedure('public.light_seed_status(text)') is null
     or to_regprocedure('public.plant_light_seed(text)') is null then
    raise exception 'Expected staged LIGHT SEED v1 RPCs are missing; inspect migration order before applying';
  end if;

  if to_regclass('public.scout_event_ledger') is not null
     or to_regclass('public.scout_xp_ledger') is not null
     or to_regclass('public.novel_rank_state') is not null
     or to_regclass('public.novel_rank_events') is not null
     or to_regclass('public.valid_read_rules') is not null
     or to_regclass('public.valid_read_sessions') is not null
     or to_regclass('public.valid_read_events') is not null
     or to_regclass('public.light_seed_monthly_inventory') is not null
     or to_regclass('public.seed_discovery_state') is not null then
    raise exception 'One or more SCOUT beta foundation tables already exist; review before applying';
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'light_seeds'
       and column_name in ('seed_type', 'rank_at_seed', 'rank_code_at_seed', 'valid_read_event_id')
  ) then
    raise exception 'LIGHT SEED v2 columns already exist; review before applying';
  end if;

  if to_regprocedure('public.light_seed_status_v2(text)') is not null
     or to_regprocedure('public.plant_light_seed_v2(text,text)') is not null
     or to_regprocedure('public.record_valid_read_progress(text,uuid,double precision,integer,integer)') is not null then
    raise exception 'SCOUT beta foundation RPCs already exist; review before applying';
  end if;
end
$$;

select 'PASS: SCOUT beta event foundations precheck' as result;