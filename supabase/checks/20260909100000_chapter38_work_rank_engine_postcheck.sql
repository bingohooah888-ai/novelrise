\set ON_ERROR_STOP on

do $$
declare
  v_rls boolean;
begin
  if to_regclass('public.novel_star_ratings') is null then
    raise exception 'novel_star_ratings is missing';
  end if;

  select c.relrowsecurity
    into v_rls
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname = 'novel_star_ratings';

  if not coalesce(v_rls, false) then
    raise exception 'novel_star_ratings RLS is not enabled';
  end if;

  if has_table_privilege('anon', 'public.novel_star_ratings', 'SELECT')
     or has_table_privilege('authenticated', 'public.novel_star_ratings', 'SELECT')
     or has_table_privilege('anon', 'public.novel_star_ratings', 'INSERT')
     or has_table_privilege('authenticated', 'public.novel_star_ratings', 'INSERT')
     or has_table_privilege('authenticated', 'public.novel_star_ratings', 'UPDATE')
     or has_table_privilege('authenticated', 'public.novel_star_ratings', 'DELETE') then
    raise exception 'individual star-rating rows are directly client-accessible';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'episodes'
      and column_name = 'updated_at' and is_nullable = 'NO'
  ) then
    raise exception 'episodes.updated_at is missing or nullable';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'novel_rank_state'
      and column_name = 'candidate_rank'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'novel_rank_state'
      and column_name = 'candidate_rank_since'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'novel_rank_state'
      and column_name = 'last_internal_score'
  ) then
    raise exception 'Rank evaluation state columns are missing';
  end if;

  if not has_function_privilege('anon', 'public.novelight_star_rating_status(text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.novelight_star_rating_status(text)', 'EXECUTE') then
    raise exception 'star-rating status RPC is not readable by supported clients';
  end if;

  if has_function_privilege('anon', 'public.set_novel_star_rating(text,integer)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.set_novel_star_rating(text,integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.clear_novel_star_rating(text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.clear_novel_star_rating(text)', 'EXECUTE') then
    raise exception 'star-rating mutation RPC privileges are incorrect';
  end if;

  if has_function_privilege('anon', 'public.novelight_recalculate_work_ranks(timestamp with time zone)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.novelight_recalculate_work_ranks(timestamp with time zone)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.novelight_recalculate_work_ranks(timestamp with time zone)', 'EXECUTE') then
    raise exception 'Rank recalculation RPC must be service-role only';
  end if;

  if public.novelight_rank_absolute_ceiling(49, 2, 2, 3.0) <> 1
     or public.novelight_rank_absolute_ceiling(50, 2, 2, 3.0) <> 2
     or public.novelight_rank_absolute_ceiling(200, 8, 5, 3.3) <> 3
     or public.novelight_rank_absolute_ceiling(800, 30, 15, 3.5) <> 4
     or public.novelight_rank_absolute_ceiling(3000, 100, 50, 3.7) <> 5
     or public.novelight_rank_absolute_ceiling(10000, 300, 150, 4.0) <> 6 then
    raise exception 'Chapter 38 absolute Rank thresholds do not match MASTER';
  end if;

  if public.novelight_rank_relative_band(0.40) <> 1
     or public.novelight_rank_relative_band(0.70) <> 2
     or public.novelight_rank_relative_band(0.85) <> 3
     or public.novelight_rank_relative_band(0.95) <> 4
     or public.novelight_rank_relative_band(0.99) <> 5
     or public.novelight_rank_relative_band(1.00) <> 6 then
    raise exception 'Chapter 38 relative Rank bands do not match MASTER';
  end if;

  if public.novelight_rank_required_stability(2::smallint) <> interval '24 hours'
     or public.novelight_rank_required_stability(3::smallint) <> interval '24 hours'
     or public.novelight_rank_required_stability(4::smallint) <> interval '48 hours'
     or public.novelight_rank_required_stability(5::smallint) <> interval '72 hours'
     or public.novelight_rank_required_stability(6::smallint) <> interval '7 days' then
    raise exception 'Chapter 38 promotion stability windows do not match MASTER';
  end if;

  if has_function_privilege('anon', 'public.light_seed_status(text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.light_seed_status(text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.plant_light_seed(text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.plant_light_seed(text)', 'EXECUTE') then
    raise exception 'Rank engine unexpectedly reopened legacy LIGHT SEED v1 RPCs';
  end if;
end
$$;

select 'PASS: Chapter 38 work Rank engine postcheck' as result;
