\set ON_ERROR_STOP on

do $$
declare
  v_definition text;
begin
  if to_regclass('public.novel_rank_state') is null
     or to_regclass('public.novel_star_ratings') is null
     or to_regclass('public.novel_final_rank_history') is null
     or to_regprocedure('public.novelight_recalculate_work_ranks(timestamp with time zone)') is null
     or to_regprocedure('public.novelight_rank_absolute_ceiling(bigint,bigint,bigint,numeric)') is null
     or to_regprocedure('public.novelight_rank_relative_band(double precision)') is null then
    raise exception 'Chapter 38 percentile Rank score prerequisites are missing';
  end if;

  if to_regprocedure('public.novelight_bayesian_adjusted_rating(bigint,numeric,numeric)') is not null then
    raise exception 'Chapter 38 Bayesian Rank helper already exists';
  end if;

  if to_regclass('novelrise_migration_backup.chapter38_percentile_rank_score_state') is not null
     and exists (
       select 1
         from novelrise_migration_backup.chapter38_percentile_rank_score_state
        where migration_id = '20260909140000'
     ) then
    raise exception 'Chapter 38 percentile Rank score backup already exists';
  end if;

  select pg_get_functiondef(
    'public.novelight_recalculate_work_ranks(timestamp with time zone)'::regprocedure
  ) into v_definition;

  if position('novelight_rating_reliability_score' in v_definition) = 0 then
    raise exception 'Expected predecessor Rank score implementation was not found';
  end if;

  if has_function_privilege('anon', 'public.novelight_recalculate_work_ranks(timestamp with time zone)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.novelight_recalculate_work_ranks(timestamp with time zone)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.novelight_recalculate_work_ranks(timestamp with time zone)', 'EXECUTE') then
    raise exception 'Global Rank evaluator privileges do not match the service_role-only contract';
  end if;
end
$$;

select 'PASS: Chapter 38 percentile Rank score precheck' as result;
