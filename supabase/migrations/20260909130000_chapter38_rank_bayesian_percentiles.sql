-- NOVELIGHT Chapter 38: align work Rank internal scoring with the MASTER formula.
--
-- The existing absolute Rank thresholds, relative Rank bands, promotion stability,
-- inactivity degradation, and FINAL RANK lifecycle remain unchanged. This
-- migration only replaces the active-work internal score construction:
--
--   PV percentile                         20%
--   favorite-count percentile             35%
--   Bayesian-adjusted star percentile      33.75%
--   star-rating-count percentile           11.25%
--
-- The Bayesian prior strength is m = 10. C is the current NOVELIGHT-wide
-- average of valid current star-rating rows. When no star ratings exist at all,
-- 3.0 is used only as a deterministic empty-dataset fallback so the formula is
-- defined until the first valid rating exists.
--
-- This migration does NOT invoke the Rank evaluator and therefore does not
-- change any work Rank by itself.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260909130000'));

create schema if not exists novelrise_migration_backup;
revoke all on schema novelrise_migration_backup from public, anon, authenticated;

create table novelrise_migration_backup.chapter38_rank_bayesian_percentile_state (
  migration_id text primary key,
  applied_at timestamptz not null default now(),
  original_rank_recalculator text not null
);

insert into novelrise_migration_backup.chapter38_rank_bayesian_percentile_state (
  migration_id,
  original_rank_recalculator
)
select
  '20260909130000',
  pg_get_functiondef(
    'public.novelight_recalculate_work_ranks(timestamp with time zone)'::regprocedure
  );

create or replace function public.novelight_global_rating_baseline()
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(pg_catalog.avg(r.rating)::numeric, 3.0::numeric)
    from public.novel_star_ratings r
$$;

revoke all on function public.novelight_global_rating_baseline()
  from public, anon, authenticated;

create or replace function public.novelight_bayesian_rating_average(
  p_rating_count bigint,
  p_rating_average numeric,
  p_global_average numeric
)
returns numeric
language sql
immutable
parallel safe
security invoker
set search_path = ''
as $$
  select (
    (
      greatest(coalesce(p_rating_count, 0), 0)::numeric
      * coalesce(
          p_rating_average,
          coalesce(p_global_average, 3.0::numeric)
        )
    )
    + (10::numeric * coalesce(p_global_average, 3.0::numeric))
  )
  / (greatest(coalesce(p_rating_count, 0), 0)::numeric + 10::numeric)
$$;

revoke all on function public.novelight_bayesian_rating_average(bigint, numeric, numeric)
  from public, anon, authenticated;

create or replace function public.novelight_rank_internal_score(
  p_pv_percentile double precision,
  p_favorite_percentile double precision,
  p_bayesian_rating_percentile double precision,
  p_rating_count_percentile double precision
)
returns double precision
language sql
immutable
parallel safe
security invoker
set search_path = ''
as $$
  select
    (0.20::double precision * greatest(0::double precision, least(100::double precision, coalesce(p_pv_percentile, 0::double precision))))
    + (0.35::double precision * greatest(0::double precision, least(100::double precision, coalesce(p_favorite_percentile, 0::double precision))))
    + (
      0.45::double precision
      * (
        (0.75::double precision * greatest(0::double precision, least(100::double precision, coalesce(p_bayesian_rating_percentile, 0::double precision))))
        + (0.25::double precision * greatest(0::double precision, least(100::double precision, coalesce(p_rating_count_percentile, 0::double precision))))
      )
    )
$$;

revoke all on function public.novelight_rank_internal_score(
  double precision,
  double precision,
  double precision,
  double precision
) from public, anon, authenticated;

do $patch$
declare
  v_definition text;
  v_start integer;
  v_end integer;
  v_replacement text := $score$
    active_metric as (
      select m.*,
             public.novelight_rank_absolute_ceiling(
               m.pv,
               m.favorite_count,
               m.rating_count,
               m.rating_average
             ) as absolute_ceiling,
             public.novelight_bayesian_rating_average(
               m.rating_count,
               m.rating_average,
               g.global_rating_average
             ) as bayesian_rating_average
        from metric_base m
        cross join (
          select public.novelight_global_rating_baseline() as global_rating_average
        ) g
       where (
         m.is_completed
         and m.finalized_at is null
       )
       or (
         not m.is_completed
         and (
           m.last_episode_activity_at is null
           or m.last_episode_activity_at > p_now - interval '30 days'
         )
       )
    ),
    percentile_metric as (
      select a.*,
             (100.0::double precision * percent_rank() over (order by a.pv)) as pv_percentile,
             (100.0::double precision * percent_rank() over (order by a.favorite_count)) as favorite_percentile,
             (100.0::double precision * percent_rank() over (order by a.bayesian_rating_average)) as bayesian_rating_percentile,
             (100.0::double precision * percent_rank() over (order by a.rating_count)) as rating_count_percentile
        from active_metric a
    ),
    scored as (
      select p.*,
             public.novelight_rank_internal_score(
               p.pv_percentile,
               p.favorite_percentile,
               p.bayesian_rating_percentile,
               p.rating_count_percentile
             ) as internal_score
        from percentile_metric p
    ),
$score$;
begin
  select pg_get_functiondef(
           'public.novelight_recalculate_work_ranks(timestamp with time zone)'::regprocedure
         )
    into v_definition;

  if v_definition is null then
    raise exception 'Chapter 38 Rank evaluator definition is missing';
  end if;

  if pg_catalog.strpos(
       v_definition,
       'public.novelight_rating_reliability_score('
     ) = 0 then
    raise exception 'Rank evaluator no longer matches the expected pre-migration scoring implementation';
  end if;

  v_start := pg_catalog.strpos(v_definition, '    active_metric as (');
  v_end := pg_catalog.strpos(v_definition, '    banded as (');

  if v_start = 0 or v_end = 0 or v_end <= v_start then
    raise exception 'Rank evaluator scoring block boundaries could not be located safely';
  end if;

  v_definition :=
    pg_catalog.substring(v_definition from 1 for v_start - 1)
    || v_replacement
    || pg_catalog.substring(v_definition from v_end);

  if pg_catalog.strpos(
       v_definition,
       'public.novelight_rank_internal_score('
     ) = 0
     or pg_catalog.strpos(v_definition, 'rating_count_percentile') = 0
     or pg_catalog.strpos(v_definition, 'bayesian_rating_percentile') = 0
     or pg_catalog.strpos(
          v_definition,
          'public.novelight_rating_reliability_score('
        ) <> 0 then
    raise exception 'Rank evaluator scoring patch did not produce the required MASTER formula';
  end if;

  execute v_definition;
end
$patch$;

revoke all on function public.novelight_recalculate_work_ranks(timestamptz)
  from public, anon, authenticated;
grant execute on function public.novelight_recalculate_work_ranks(timestamptz)
  to service_role;

commit;
