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
     or to_regprocedure('public.novelight_rank_relative_band(double precision)') is null
     or to_regprocedure('public.novelight_rank_required_stability(smallint)') is null then
    raise exception 'Chapter 38 Rank lifecycle prerequisites are missing';
  end if;

  if to_regprocedure('public.novelight_global_rating_baseline()') is not null
     or to_regprocedure('public.novelight_bayesian_rating_average(bigint,numeric,numeric)') is not null
     or to_regprocedure('public.novelight_rank_internal_score(double precision,double precision,double precision,double precision)') is not null
     or to_regclass('novelrise_migration_backup.chapter38_rank_bayesian_percentile_state') is not null then
    raise exception 'Chapter 38 Bayesian percentile scoring objects already exist';
  end if;

  select pg_get_functiondef(
           'public.novelight_recalculate_work_ranks(timestamp with time zone)'::regprocedure
         )
    into v_definition;

  if pg_catalog.strpos(
       v_definition,
       'public.novelight_rating_reliability_score('
     ) = 0
     or pg_catalog.strpos(v_definition, '0.45::double precision * p.rating_reliability') = 0 then
    raise exception 'Current Rank evaluator is not the expected pre-Bayesian scoring implementation';
  end if;

  if pg_catalog.strpos(v_definition, 'completion_cycle') = 0
     or pg_catalog.strpos(v_definition, 'inactivity_demotions_applied') = 0
     or pg_catalog.strpos(v_definition, 'work_final_rank_fixed') = 0 then
    raise exception 'Current Rank evaluator is missing lifecycle behavior that must be preserved';
  end if;

  if has_function_privilege('anon', 'public.novelight_recalculate_work_ranks(timestamp with time zone)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.novelight_recalculate_work_ranks(timestamp with time zone)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.novelight_recalculate_work_ranks(timestamp with time zone)', 'EXECUTE') then
    raise exception 'Global Rank evaluator privileges do not match the required service_role-only contract';
  end if;
end
$$;

select 'PASS: Chapter 38 Bayesian percentile Rank score precheck' as result;
