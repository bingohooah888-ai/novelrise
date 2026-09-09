\set ON_ERROR_STOP on

-- The NOVELIGHT-wide star baseline must come from current valid star-rating rows,
-- not from the superseded hard-coded 3.0 prior mean. Use a transaction so the
-- extra rating leaves no fixture residue for the lifecycle tests that follow.
begin;

insert into public.novel_star_ratings (
  user_id,
  novel_id_snapshot,
  author_id_snapshot,
  rating,
  first_rated_at,
  updated_at
) values (
  '55555555-5555-5555-5555-555555555555',
  'bayesian-baseline-test-only',
  '66666666-6666-6666-6666-666666666666',
  1,
  now(),
  now()
);

select public.test_assert(
  abs(
    public.novelight_global_rating_baseline()
    - (select avg(r.rating)::numeric from public.novel_star_ratings r)
  ) < 0.000000001::numeric,
  'global star baseline must equal the current NOVELIGHT-wide valid rating average'
);

select public.test_assert(
  public.novelight_global_rating_baseline() <> 3.0::numeric,
  'global star baseline must not remain the superseded fixed 3.0 prior when ratings exist'
);

rollback;

-- Bayesian adjustment uses m=10 and the supplied global baseline C.
select public.test_assert(
  abs(
    public.novelight_bayesian_rating_average(2, 5.0, 4.0)
    - (50.0::numeric / 12.0::numeric)
  ) < 0.000000001::numeric,
  'Bayesian star adjustment must use n, R, C, and prior strength m=10'
);

select public.test_assert(
  abs(
    public.novelight_bayesian_rating_average(0, null, 4.2)
    - 4.2::numeric
  ) < 0.000000001::numeric,
  'an unrated work must start from the current global star baseline before percentile conversion'
);

-- Pin every effective weight in the MASTER formula on the 0-100 percentile scale.
select public.test_assert(
  abs(public.novelight_rank_internal_score(100, 0, 0, 0) - 20.0) < 0.000000001,
  'PV percentile effective weight must be 20 percent'
);

select public.test_assert(
  abs(public.novelight_rank_internal_score(0, 100, 0, 0) - 35.0) < 0.000000001,
  'favorite percentile effective weight must be 35 percent'
);

select public.test_assert(
  abs(public.novelight_rank_internal_score(0, 0, 100, 0) - 33.75) < 0.000000001,
  'Bayesian-adjusted star-average percentile effective weight must be 33.75 percent'
);

select public.test_assert(
  abs(public.novelight_rank_internal_score(0, 0, 0, 100) - 11.25) < 0.000000001,
  'star-rating-count percentile effective weight must be 11.25 percent'
);

select public.test_assert(
  abs(public.novelight_rank_internal_score(100, 100, 100, 100) - 100.0) < 0.000000001,
  'all four maximum percentile inputs must produce a 100-point internal score'
);

-- Equal metric values are peers under percent_rank(), so ties stay deterministic
-- without an arbitrary novel-id tiebreaker altering the percentile itself.
select public.test_assert(
  (
    with sample(v) as (
      values (1::integer), (1::integer), (2::integer)
    ), ranked as (
      select v, percent_rank() over (order by v) as p
        from sample
    )
    select count(distinct p) = 1
      from ranked
     where v = 1
  ),
  'equal metric values must receive the same percentile deterministically'
);

-- Pin integration: the global evaluator must actually use both star percentiles
-- and must no longer reference the superseded fixed-prior reliability scalar.
do $$
declare
  v_definition text;
begin
  select pg_get_functiondef(
           'public.novelight_recalculate_work_ranks(timestamp with time zone)'::regprocedure
         )
    into v_definition;

  if pg_catalog.strpos(v_definition, 'bayesian_rating_percentile') = 0
     or pg_catalog.strpos(v_definition, 'rating_count_percentile') = 0
     or pg_catalog.strpos(v_definition, 'public.novelight_rank_internal_score(') = 0 then
    raise exception 'Rank evaluator is not wired to both MASTER star percentiles';
  end if;

  if pg_catalog.strpos(v_definition, 'public.novelight_rating_reliability_score(') <> 0 then
    raise exception 'Rank evaluator still references the superseded reliability scalar';
  end if;
end
$$;

-- Internal helpers and the global evaluator remain unavailable to clients.
set role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
do $$
begin
  begin
    perform public.novelight_global_rating_baseline();
    raise exception 'authenticated client unexpectedly invoked internal global baseline helper';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform public.novelight_bayesian_rating_average(2, 5.0, 4.0);
    raise exception 'authenticated client unexpectedly invoked internal Bayesian helper';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform public.novelight_rank_internal_score(20, 30, 40, 50);
    raise exception 'authenticated client unexpectedly invoked internal Rank score helper';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform public.novelight_recalculate_work_ranks(now());
    raise exception 'authenticated client unexpectedly invoked global Rank evaluator';
  exception
    when insufficient_privilege then null;
  end;
end
$$;
reset role;
