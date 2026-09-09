\set ON_ERROR_STOP on

-- Fail closed unless the exact Chapter 38 foundations and LIGHT SEED v1 cutover
-- are already present. This prevents applying the Rank engine out of order.
do $$
begin
  if to_regclass('public.novel_rank_state') is null
     or to_regclass('public.novel_rank_events') is null
     or to_regclass('public.scout_event_ledger') is null then
    raise exception 'Chapter 38 SCOUT/Rank foundations are missing';
  end if;

  if to_regprocedure('public.light_seed_status(text)') is null
     or to_regprocedure('public.plant_light_seed(text)') is null
     or to_regprocedure('public.light_seed_status_v2(text)') is null
     or to_regprocedure('public.plant_light_seed_v2(text,text)') is null then
    raise exception 'LIGHT SEED v1/v2 functions are missing';
  end if;

  if has_function_privilege('anon', 'public.light_seed_status(text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.light_seed_status(text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.plant_light_seed(text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.plant_light_seed(text)', 'EXECUTE') then
    raise exception 'legacy LIGHT SEED v1 client RPC cutover is not applied';
  end if;

  if not has_function_privilege('anon', 'public.light_seed_status_v2(text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.light_seed_status_v2(text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.plant_light_seed_v2(text,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.plant_light_seed_v2(text,text)', 'EXECUTE') then
    raise exception 'LIGHT SEED v2 privileges do not match the supported client contract';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'novels' and column_name = 'pv'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'novels' and column_name = 'first_published_at'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'episodes' and column_name = 'created_at'
  ) then
    raise exception 'Rank metric prerequisite columns are missing';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'episodes' and column_name = 'updated_at'
  ) then
    raise exception 'episodes.updated_at already exists; inspect before applying Rank engine';
  end if;

  if to_regclass('public.novel_star_ratings') is not null
     or to_regprocedure('public.novelight_star_rating_status(text)') is not null
     or to_regprocedure('public.set_novel_star_rating(text,integer)') is not null
     or to_regprocedure('public.clear_novel_star_rating(text)') is not null
     or to_regprocedure('public.novelight_recalculate_work_ranks(timestamp with time zone)') is not null then
    raise exception 'Rank engine objects already exist; migration is not in pristine pre-state';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'novel_rank_state'
      and column_name in ('candidate_rank', 'candidate_rank_since', 'last_evaluated_at')
  ) then
    raise exception 'Rank engine state columns already exist';
  end if;
end
$$;

select 'PASS: Chapter 38 work Rank engine precheck' as result;
