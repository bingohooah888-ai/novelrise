\set ON_ERROR_STOP on

do $$
declare
  v_definition text;
  v_helper numeric;
begin
  if to_regprocedure('public.novelight_bayesian_adjusted_rating(bigint,numeric,numeric)') is null then
    raise exception 'Bayesian adjusted-rating helper is missing';
  end if;

  select public.novelight_bayesian_adjusted_rating(2, 5.0, 4.0)
    into v_helper;

  if abs(v_helper - (50.0::numeric / 12.0::numeric)) > 0.000001::numeric then
    raise exception 'Bayesian helper does not use m=10 and supplied global mean C';
  end if;

  select pg_get_functiondef(
    'public.novelight_recalculate_work_ranks(timestamp with time zone)'::regprocedure
  ) into v_definition;

  if position('novelight_bayesian_adjusted_rating' in v_definition) = 0
     or position('bayesian_rating_percentile' in v_definition) = 0
     or position('rating_count_percentile' in v_definition) = 0
     or position('star_related_score' in v_definition) = 0 then
    raise exception 'Rank evaluator is missing MASTER percentile score components';
  end if;

  if position('novelight_rating_reliability_score' in v_definition) > 0 then
    raise exception 'Rank evaluator still uses the superseded direct rating reliability score';
  end if;

  if position('light_seed' in lower(v_definition)) > 0 then
    raise exception 'LIGHT SEED must remain outside work Rank calculation';
  end if;

  if has_function_privilege('anon', 'public.novelight_bayesian_adjusted_rating(bigint,numeric,numeric)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.novelight_bayesian_adjusted_rating(bigint,numeric,numeric)', 'EXECUTE') then
    raise exception 'Internal Bayesian Rank helper must not be client executable';
  end if;

  if has_function_privilege('anon', 'public.novelight_recalculate_work_ranks(timestamp with time zone)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.novelight_recalculate_work_ranks(timestamp with time zone)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.novelight_recalculate_work_ranks(timestamp with time zone)', 'EXECUTE') then
    raise exception 'Global Rank evaluator must remain service_role-only';
  end if;

  if not exists (
    select 1
      from novelrise_migration_backup.chapter38_percentile_rank_score_state
     where migration_id = '20260909140000'
       and original_rank_recalculator is not null
       and length(original_rank_recalculator) > 0
  ) then
    raise exception 'Percentile Rank score rollback backup is missing';
  end if;
end
$$;

select 'PASS: Chapter 38 percentile Rank score postcheck' as result;
