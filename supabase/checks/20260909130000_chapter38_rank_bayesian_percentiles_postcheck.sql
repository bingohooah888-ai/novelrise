\set ON_ERROR_STOP on

do $$
declare
  v_definition text;
  v_baseline numeric;
  v_expected numeric;
  v_score double precision;
begin
  if to_regprocedure('public.novelight_global_rating_baseline()') is null
     or to_regprocedure('public.novelight_bayesian_rating_average(bigint,numeric,numeric)') is null
     or to_regprocedure('public.novelight_rank_internal_score(double precision,double precision,double precision,double precision)') is null then
    raise exception 'Bayesian percentile Rank helper functions are missing';
  end if;

  if has_function_privilege('anon', 'public.novelight_global_rating_baseline()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.novelight_global_rating_baseline()', 'EXECUTE')
     or has_function_privilege('anon', 'public.novelight_bayesian_rating_average(bigint,numeric,numeric)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.novelight_bayesian_rating_average(bigint,numeric,numeric)', 'EXECUTE')
     or has_function_privilege('anon', 'public.novelight_rank_internal_score(double precision,double precision,double precision,double precision)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.novelight_rank_internal_score(double precision,double precision,double precision,double precision)', 'EXECUTE') then
    raise exception 'Internal Rank scoring helpers must not be client-executable';
  end if;

  if has_function_privilege('anon', 'public.novelight_recalculate_work_ranks(timestamp with time zone)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.novelight_recalculate_work_ranks(timestamp with time zone)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.novelight_recalculate_work_ranks(timestamp with time zone)', 'EXECUTE') then
    raise exception 'Global Rank evaluator must remain service_role-only';
  end if;

  select pg_get_functiondef(
           'public.novelight_recalculate_work_ranks(timestamp with time zone)'::regprocedure
         )
    into v_definition;

  if pg_catalog.strpos(v_definition, 'public.novelight_global_rating_baseline()') = 0
     or pg_catalog.strpos(v_definition, 'public.novelight_bayesian_rating_average(') = 0
     or pg_catalog.strpos(v_definition, 'bayesian_rating_percentile') = 0
     or pg_catalog.strpos(v_definition, 'rating_count_percentile') = 0
     or pg_catalog.strpos(v_definition, 'public.novelight_rank_internal_score(') = 0 then
    raise exception 'Rank evaluator does not contain the MASTER Bayesian percentile score path';
  end if;

  if pg_catalog.strpos(
       v_definition,
       'public.novelight_rating_reliability_score('
     ) <> 0 then
    raise exception 'Rank evaluator still uses the superseded fixed-prior reliability score';
  end if;

  if pg_catalog.strpos(v_definition, 'completion_cycle') = 0
     or pg_catalog.strpos(v_definition, 'inactivity_demotions_applied') = 0
     or pg_catalog.strpos(v_definition, 'work_final_rank_fixed') = 0 then
    raise exception 'Rank lifecycle behavior was not preserved while replacing scoring';
  end if;

  select public.novelight_global_rating_baseline()
    into v_baseline;
  select coalesce(pg_catalog.avg(r.rating)::numeric, 3.0::numeric)
    into v_expected
    from public.novel_star_ratings r;

  if v_baseline is distinct from v_expected then
    raise exception 'Global star baseline is not derived from current valid rating rows';
  end if;

  if abs(
       public.novelight_bayesian_rating_average(2, 5.0, 4.0)
       - (50.0::numeric / 12.0::numeric)
     ) > 0.000000001::numeric then
    raise exception 'Bayesian star average does not use m=10 and the supplied NOVELIGHT baseline';
  end if;

  v_score := public.novelight_rank_internal_score(0, 0, 100, 0);
  if abs(v_score - 33.75::double precision) > 0.000000001::double precision then
    raise exception 'Bayesian-adjusted star percentile effective weight must be 33.75%%';
  end if;

  v_score := public.novelight_rank_internal_score(0, 0, 0, 100);
  if abs(v_score - 11.25::double precision) > 0.000000001::double precision then
    raise exception 'Star-rating-count percentile effective weight must be 11.25%%';
  end if;

  if not exists (
    select 1
      from novelrise_migration_backup.chapter38_rank_bayesian_percentile_state
     where migration_id = '20260909130000'
       and original_rank_recalculator is not null
       and length(original_rank_recalculator) > 0
  ) then
    raise exception 'Original Rank evaluator rollback backup is missing';
  end if;

  if has_function_privilege('anon', 'public.light_seed_status(text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.light_seed_status(text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.plant_light_seed(text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.plant_light_seed(text)', 'EXECUTE') then
    raise exception 'Rank score migration unexpectedly reopened legacy LIGHT SEED v1 RPCs';
  end if;
end
$$;

select 'PASS: Chapter 38 Bayesian percentile Rank score postcheck' as result;
