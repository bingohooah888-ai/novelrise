\set ON_ERROR_STOP on

-- MASTER beta prior strength is m=10 and C is supplied independently from each
-- work's own average. This guards against regressing to the old fixed-3.0 score.
select public.test_assert(
  abs(
    public.novelight_bayesian_adjusted_rating(2, 5.0, 4.0)
    - (50.0::numeric / 12.0::numeric)
  ) < 0.000001::numeric,
  'Bayesian adjusted rating must use n/(n+10)*R + 10/(n+10)*C'
);

select public.test_assert(
  public.novelight_bayesian_adjusted_rating(0, null, 4.2) = 4.2,
  'an unrated work must shrink completely to the current global mean C'
);

-- Establish controlled current rating evidence on two published works. Direct
-- fixture writes are intentional here: raw rating rows are client-hidden in
-- production, while the integration test needs exact distributions.
delete from public.novel_star_ratings;

insert into public.novel_star_ratings (
  user_id,
  novel_id_snapshot,
  author_id_snapshot,
  rating
) values
  ('91000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 5),
  ('91000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 5),
  ('92000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 3),
  ('92000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 3),
  ('92000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 3),
  ('92000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 3),
  -- A draft-work row must not enter C because MASTER defines the reference from
  -- valid ratings on the live NOVELIGHT corpus.
  ('93000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 1);

select public.test_assert(
  abs(
    (
      select avg(r.rating)::numeric
        from public.novel_star_ratings r
        join public.novels n on n.id::text = r.novel_id_snapshot
       where n.status = 'published'
    ) - (22.0::numeric / 6.0::numeric)
  ) < 0.000001::numeric,
  'global Rank prior C must use current valid ratings on published works only'
);

update public.novels
   set pv = case id::text
     when '10000000-0000-0000-0000-000000000001' then 100
     when '20000000-0000-0000-0000-000000000001' then 200
     else pv
   end
 where id::text in (
   '10000000-0000-0000-0000-000000000001',
   '20000000-0000-0000-0000-000000000001'
 );

-- Bring both controlled works into the active population without weakening the
-- production activity-timestamp trigger. The first work retains its completion
-- history metadata but receives a fresh completion timestamp so it stays inside
-- the 30-day reader-response window during this score test.
update public.novel_rank_state
   set is_completed = true,
       completed_at = now(),
       final_rank = null,
       finalized_at = null,
       dormant_since = null,
       inactivity_demotions_applied = 0,
       last_inactivity_demotion_at = null
 where novel_id_snapshot = '10000000-0000-0000-0000-000000000001';

update public.novel_rank_state
   set is_completed = false,
       completed_at = null,
       final_rank = null,
       finalized_at = null,
       dormant_since = null,
       inactivity_demotions_applied = 0,
       last_inactivity_demotion_at = null
 where novel_id_snapshot = '20000000-0000-0000-0000-000000000001';

alter table public.episodes disable trigger episodes_touch_novelight_updated_at;
update public.episodes
   set updated_at = now()
 where novel_id::text in (
   '10000000-0000-0000-0000-000000000001',
   '20000000-0000-0000-0000-000000000001'
 )
   and status = 'published';
alter table public.episodes enable trigger episodes_touch_novelight_updated_at;

create temporary table rank_score_clock as
select now()::timestamptz as evaluated_at;

-- Recompute the MASTER score independently of the production evaluator and keep
-- every component so the test can distinguish adjusted-average percentile from
-- rating-count percentile before checking the final weighted score.
create temporary table expected_rank_percentile_score as
with favorite_metric as (
  select f.novel_id::text as novel_id_snapshot,
         count(distinct f.user_id)::bigint as favorite_count
    from public.favorites f
   group by f.novel_id::text
),
rating_metric as (
  select r.novel_id_snapshot,
         count(*)::bigint as rating_count,
         avg(r.rating)::numeric as rating_average
    from public.novel_star_ratings r
   group by r.novel_id_snapshot
),
global_rating_reference as (
  select coalesce(avg(r.rating)::numeric, 3.0::numeric) as global_rating_average
    from public.novel_star_ratings r
    join public.novels n on n.id::text = r.novel_id_snapshot
   where n.status = 'published'
),
activity_metric as (
  select e.novel_id::text as novel_id_snapshot,
         max(e.updated_at) filter (where e.status = 'published') as last_episode_activity_at
    from public.episodes e
   group by e.novel_id::text
),
metric_base as (
  select n.id::text as novel_id_snapshot,
         greatest(coalesce(n.pv, 0), 0)::bigint as pv,
         coalesce(f.favorite_count, 0)::bigint as favorite_count,
         coalesce(r.rating_count, 0)::bigint as rating_count,
         r.rating_average,
         coalesce(a.last_episode_activity_at, n.first_published_at) as last_episode_activity_at,
         s.is_completed,
         s.finalized_at
    from public.novels n
    join public.novel_rank_state s on s.novel_id_snapshot = n.id::text
    left join favorite_metric f on f.novel_id_snapshot = n.id::text
    left join rating_metric r on r.novel_id_snapshot = n.id::text
    left join activity_metric a on a.novel_id_snapshot = n.id::text
   where n.status = 'published'
),
active_metric as (
  select m.*,
         g.global_rating_average,
         (
           (
             m.rating_count::numeric
             * coalesce(m.rating_average, g.global_rating_average)
           )
           + (10::numeric * g.global_rating_average)
         ) / (m.rating_count::numeric + 10::numeric) as bayesian_rating_average
    from metric_base m
    cross join global_rating_reference g
    cross join rank_score_clock c
   where (
     m.is_completed and m.finalized_at is null
   ) or (
     not m.is_completed
     and (
       m.last_episode_activity_at is null
       or m.last_episode_activity_at > c.evaluated_at - interval '30 days'
     )
   )
),
percentile_metric as (
  select a.*,
         100.0::double precision * percent_rank() over (order by a.pv) as pv_percentile,
         100.0::double precision * percent_rank() over (order by a.favorite_count) as favorite_percentile,
         100.0::double precision * percent_rank() over (order by a.bayesian_rating_average) as bayesian_rating_percentile,
         100.0::double precision * percent_rank() over (order by a.rating_count) as rating_count_percentile
    from active_metric a
),
star_scored as (
  select p.*,
         (
           (0.75::double precision * p.bayesian_rating_percentile)
           + (0.25::double precision * p.rating_count_percentile)
         ) as star_related_score
    from percentile_metric p
)
select s.*,
       (
         (0.20::double precision * s.pv_percentile)
         + (0.35::double precision * s.favorite_percentile)
         + (0.45::double precision * s.star_related_score)
       ) as internal_score
  from star_scored s;

select public.test_assert(
  (
    select a.bayesian_rating_percentile > b.bayesian_rating_percentile
      from expected_rank_percentile_score a
      join expected_rank_percentile_score b on true
     where a.novel_id_snapshot = '10000000-0000-0000-0000-000000000001'
       and b.novel_id_snapshot = '20000000-0000-0000-0000-000000000001'
  ),
  'higher Bayesian-adjusted average must receive the higher adjusted-star percentile'
);

select public.test_assert(
  (
    select b.rating_count_percentile > a.rating_count_percentile
      from expected_rank_percentile_score a
      join expected_rank_percentile_score b on true
     where a.novel_id_snapshot = '10000000-0000-0000-0000-000000000001'
       and b.novel_id_snapshot = '20000000-0000-0000-0000-000000000001'
  ),
  'rating-count percentile must contribute independently from adjusted-star percentile'
);

select public.novelight_recalculate_work_ranks(
  (select evaluated_at from rank_score_clock)
);

select public.test_assert(
  not exists (
    select 1
      from expected_rank_percentile_score e
      join public.novel_rank_state s
        on s.novel_id_snapshot = e.novel_id_snapshot
     where s.last_internal_score is null
        or abs(s.last_internal_score - e.internal_score) > 0.000000001::double precision
  ),
  'stored internal Rank score must exactly follow the MASTER percentile weighting'
);

-- Absolute floors remain a separate gate even after the relative score rewrite.
select public.test_assert(
  public.novelight_rank_absolute_ceiling(49, 1000, 1000, 5.0) = 1,
  'relative score must not bypass the absolute Rank eligibility floor'
);

-- Client execution remains blocked after the formula replacement.
set role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
do $$
begin
  begin
    perform public.novelight_recalculate_work_ranks(now());
    raise exception 'authenticated client unexpectedly invoked percentile Rank evaluator';
  exception
    when insufficient_privilege then null;
  end;
end
$$;
reset role;
