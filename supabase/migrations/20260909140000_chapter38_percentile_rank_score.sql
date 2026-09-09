-- NOVELIGHT Chapter 38: percentile-normalized work Rank score.
--
-- Aligns the lifecycle-aware Rank evaluator with the current MASTER formula:
-- - PV percentile: 20%
-- - favorite-count percentile: 35%
-- - star-related score: 45%
--   - Bayesian-adjusted average percentile: 75% of the star component
--   - rating-count percentile: 25% of the star component
--
-- Bayesian prior strength m is fixed at 10 for beta. The prior mean C is the
-- average of current valid star ratings attached to published NOVELIGHT works.
-- If no valid published rating exists yet, C falls back to the neutral 3.0 only
-- so the evaluator remains deterministic before the first rating is recorded.
--
-- This migration preserves the existing absolute Rank floors, stability windows,
-- inactivity degradation, completion lifecycle, FINAL RANK handling, and
-- service_role-only evaluator boundary. LIGHT SEED is not read by Rank scoring.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260909140000'));

create schema if not exists novelrise_migration_backup;
revoke all on schema novelrise_migration_backup from public, anon, authenticated;

create table if not exists novelrise_migration_backup.chapter38_percentile_rank_score_state (
  migration_id text primary key,
  applied_at timestamptz not null default now(),
  original_rank_recalculator text not null
);

do $precondition$
begin
  if to_regprocedure('public.novelight_recalculate_work_ranks(timestamp with time zone)') is null
     or to_regclass('public.novel_star_ratings') is null
     or to_regclass('public.novel_final_rank_history') is null then
    raise exception 'Chapter 38 lifecycle-aware Rank engine must exist before percentile score migration';
  end if;

  if exists (
    select 1
      from novelrise_migration_backup.chapter38_percentile_rank_score_state
     where migration_id = '20260909140000'
  ) then
    raise exception 'Chapter 38 percentile Rank score backup already exists';
  end if;
end
$precondition$;

insert into novelrise_migration_backup.chapter38_percentile_rank_score_state (
  migration_id,
  original_rank_recalculator
)
select
  '20260909140000',
  pg_get_functiondef('public.novelight_recalculate_work_ranks(timestamp with time zone)'::regprocedure);

create or replace function public.novelight_bayesian_adjusted_rating(
  p_rating_count bigint,
  p_rating_average numeric,
  p_global_average numeric
)
returns numeric
language sql
immutable
parallel safe
set search_path = ''
as $$
  select (
    (
      greatest(coalesce(p_rating_count, 0), 0)::numeric
      * coalesce(p_rating_average, p_global_average, 3.0::numeric)
    )
    + (10::numeric * coalesce(p_global_average, 3.0::numeric))
  ) / (
    greatest(coalesce(p_rating_count, 0), 0)::numeric + 10::numeric
  )
$$;

revoke all on function public.novelight_bayesian_adjusted_rating(bigint, numeric, numeric)
  from public, anon, authenticated;

create or replace function public.novelight_recalculate_work_ranks(
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_state record;
  v_lifecycle record;
  v_candidate smallint;
  v_required interval;
  v_desired_inactivity_demotions integer;
  v_additional_inactivity_demotions integer;
  v_new_rank smallint;
  v_active integer := 0;
  v_promoted integer := 0;
  v_demoted integer := 0;
  v_pending integer := 0;
  v_dormant integer := 0;
  v_inactivity_demotions integer := 0;
  v_finalized integer := 0;
  v_final_history_id uuid;
begin
  if p_now is null then
    raise exception using errcode = '22023', message = 'Evaluation timestamp is required';
  end if;

  for v_row in
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
        join public.novels n
          on n.id::text = r.novel_id_snapshot
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
             n.user_id as author_id_snapshot,
             greatest(coalesce(n.pv, 0), 0)::bigint as pv,
             coalesce(f.favorite_count, 0)::bigint as favorite_count,
             coalesce(r.rating_count, 0)::bigint as rating_count,
             r.rating_average,
             coalesce(a.last_episode_activity_at, n.first_published_at) as last_episode_activity_at,
             s.is_completed,
             s.finalized_at
        from public.novels n
        join public.novel_rank_state s
          on s.novel_id_snapshot = n.id::text
        left join favorite_metric f on f.novel_id_snapshot = n.id::text
        left join rating_metric r on r.novel_id_snapshot = n.id::text
        left join activity_metric a on a.novel_id_snapshot = n.id::text
       where n.status = 'published'
    ),
    active_metric as (
      select m.*,
             g.global_rating_average,
             public.novelight_rank_absolute_ceiling(
               m.pv,
               m.favorite_count,
               m.rating_count,
               m.rating_average
             ) as absolute_ceiling,
             public.novelight_bayesian_adjusted_rating(
               m.rating_count,
               m.rating_average,
               g.global_rating_average
             ) as bayesian_rating_average
        from metric_base m
        cross join global_rating_reference g
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
    ),
    scored as (
      select s.*,
             (
               (0.20::double precision * s.pv_percentile)
               + (0.35::double precision * s.favorite_percentile)
               + (0.45::double precision * s.star_related_score)
             ) as internal_score
        from star_scored s
    ),
    banded as (
      select s.*,
             cume_dist() over (order by s.internal_score) as score_percentile
        from scored s
    )
    select b.*,
           public.novelight_rank_relative_band(b.score_percentile) as relative_rank
      from banded b
  loop
    v_active := v_active + 1;

    select s.current_rank,
           s.candidate_rank,
           s.candidate_rank_since
      into v_state
      from public.novel_rank_state s
     where s.novel_id_snapshot = v_row.novel_id_snapshot
     for update;

    if not found then
      raise exception 'Rank state missing for published novel %', v_row.novel_id_snapshot;
    end if;

    v_candidate := least(
      v_row.absolute_ceiling,
      v_row.relative_rank
    )::smallint;

    if v_candidate < v_state.current_rank then
      update public.novel_rank_state
         set current_rank = v_candidate,
             candidate_rank = v_candidate,
             candidate_rank_since = p_now,
             last_evaluated_at = p_now,
             last_internal_score = v_row.internal_score,
             last_absolute_ceiling = v_row.absolute_ceiling,
             last_relative_rank = v_row.relative_rank,
             last_pv = v_row.pv,
             last_favorite_count = v_row.favorite_count,
             last_rating_count = v_row.rating_count,
             last_rating_average = pg_catalog.round(v_row.rating_average, 2),
             last_episode_activity_at = v_row.last_episode_activity_at,
             dormant_since = case when v_row.is_completed then dormant_since else null end,
             inactivity_demotions_applied = case when v_row.is_completed then inactivity_demotions_applied else 0 end,
             last_inactivity_demotion_at = case when v_row.is_completed then last_inactivity_demotion_at else null end
       where novel_id_snapshot = v_row.novel_id_snapshot;
      v_demoted := v_demoted + 1;

    elsif v_candidate = v_state.current_rank then
      update public.novel_rank_state
         set candidate_rank = v_candidate,
             candidate_rank_since = case
               when v_state.candidate_rank = v_candidate then v_state.candidate_rank_since
               else p_now
             end,
             last_evaluated_at = p_now,
             last_internal_score = v_row.internal_score,
             last_absolute_ceiling = v_row.absolute_ceiling,
             last_relative_rank = v_row.relative_rank,
             last_pv = v_row.pv,
             last_favorite_count = v_row.favorite_count,
             last_rating_count = v_row.rating_count,
             last_rating_average = pg_catalog.round(v_row.rating_average, 2),
             last_episode_activity_at = v_row.last_episode_activity_at,
             dormant_since = case when v_row.is_completed then dormant_since else null end,
             inactivity_demotions_applied = case when v_row.is_completed then inactivity_demotions_applied else 0 end,
             last_inactivity_demotion_at = case when v_row.is_completed then last_inactivity_demotion_at else null end
       where novel_id_snapshot = v_row.novel_id_snapshot;

    else
      if v_state.candidate_rank <> v_candidate then
        update public.novel_rank_state
           set candidate_rank = v_candidate,
               candidate_rank_since = p_now,
               last_evaluated_at = p_now,
               last_internal_score = v_row.internal_score,
               last_absolute_ceiling = v_row.absolute_ceiling,
               last_relative_rank = v_row.relative_rank,
               last_pv = v_row.pv,
               last_favorite_count = v_row.favorite_count,
               last_rating_count = v_row.rating_count,
               last_rating_average = pg_catalog.round(v_row.rating_average, 2),
               last_episode_activity_at = v_row.last_episode_activity_at,
               dormant_since = case when v_row.is_completed then dormant_since else null end,
               inactivity_demotions_applied = case when v_row.is_completed then inactivity_demotions_applied else 0 end,
               last_inactivity_demotion_at = case when v_row.is_completed then last_inactivity_demotion_at else null end
         where novel_id_snapshot = v_row.novel_id_snapshot;
        v_pending := v_pending + 1;
      else
        v_required := public.novelight_rank_required_stability(v_candidate);

        if v_state.candidate_rank_since + v_required <= p_now then
          update public.novel_rank_state
             set current_rank = v_candidate,
                 candidate_rank = v_candidate,
                 last_evaluated_at = p_now,
                 last_internal_score = v_row.internal_score,
                 last_absolute_ceiling = v_row.absolute_ceiling,
                 last_relative_rank = v_row.relative_rank,
                 last_pv = v_row.pv,
                 last_favorite_count = v_row.favorite_count,
                 last_rating_count = v_row.rating_count,
                 last_rating_average = pg_catalog.round(v_row.rating_average, 2),
                 last_episode_activity_at = v_row.last_episode_activity_at,
                 dormant_since = case when v_row.is_completed then dormant_since else null end,
                 inactivity_demotions_applied = case when v_row.is_completed then inactivity_demotions_applied else 0 end,
                 last_inactivity_demotion_at = case when v_row.is_completed then last_inactivity_demotion_at else null end
           where novel_id_snapshot = v_row.novel_id_snapshot;
          v_promoted := v_promoted + 1;
        else
          update public.novel_rank_state
             set last_evaluated_at = p_now,
                 last_internal_score = v_row.internal_score,
                 last_absolute_ceiling = v_row.absolute_ceiling,
                 last_relative_rank = v_row.relative_rank,
                 last_pv = v_row.pv,
                 last_favorite_count = v_row.favorite_count,
                 last_rating_count = v_row.rating_count,
                 last_rating_average = pg_catalog.round(v_row.rating_average, 2),
                 last_episode_activity_at = v_row.last_episode_activity_at,
                 dormant_since = case when v_row.is_completed then dormant_since else null end,
                 inactivity_demotions_applied = case when v_row.is_completed then inactivity_demotions_applied else 0 end,
                 last_inactivity_demotion_at = case when v_row.is_completed then last_inactivity_demotion_at else null end
           where novel_id_snapshot = v_row.novel_id_snapshot;
          v_pending := v_pending + 1;
        end if;
      end if;
    end if;
  end loop;

  -- Preserve the lifecycle behavior introduced by 20260909120000. Dormant
  -- incomplete works stay outside the active percentile population and receive
  -- idempotent one-Rank degradation for each completed 60-day inactivity block.
  for v_lifecycle in
    select s.novel_id_snapshot,
           s.author_id_snapshot,
           s.current_rank,
           s.candidate_rank,
           s.is_completed,
           s.completed_at,
           s.finalized_at,
           s.completion_cycle,
           s.inactivity_demotions_applied,
           coalesce(
             (
               select max(e.updated_at)
                 from public.episodes e
                where e.novel_id::text = s.novel_id_snapshot
                  and e.status = 'published'
             ),
             n.first_published_at
           ) as last_episode_activity_at
      from public.novel_rank_state s
      join public.novels n
        on n.id::text = s.novel_id_snapshot
     where n.status = 'published'
  loop
    if not v_lifecycle.is_completed then
      if v_lifecycle.last_episode_activity_at is null
         or v_lifecycle.last_episode_activity_at > p_now - interval '30 days' then
        update public.novel_rank_state
           set dormant_since = null,
               inactivity_demotions_applied = 0,
               last_inactivity_demotion_at = null,
               last_episode_activity_at = v_lifecycle.last_episode_activity_at
         where novel_id_snapshot = v_lifecycle.novel_id_snapshot;
      else
        v_dormant := v_dormant + 1;
        v_desired_inactivity_demotions := greatest(
          0,
          least(
            5,
            floor(
              extract(epoch from (p_now - v_lifecycle.last_episode_activity_at))
              / extract(epoch from interval '60 days')
            )::integer
          )
        );

        v_additional_inactivity_demotions := greatest(
          0,
          v_desired_inactivity_demotions - v_lifecycle.inactivity_demotions_applied
        );

        v_new_rank := greatest(
          1,
          v_lifecycle.current_rank - v_additional_inactivity_demotions
        )::smallint;

        update public.novel_rank_state
           set current_rank = v_new_rank,
               candidate_rank = case
                 when v_new_rank < v_lifecycle.current_rank then v_new_rank
                 else candidate_rank
               end,
               candidate_rank_since = case
                 when v_new_rank < v_lifecycle.current_rank then p_now
                 else candidate_rank_since
               end,
               dormant_since = coalesce(
                 dormant_since,
                 v_lifecycle.last_episode_activity_at + interval '30 days'
               ),
               inactivity_demotions_applied = greatest(
                 inactivity_demotions_applied,
                 v_desired_inactivity_demotions
               )::smallint,
               last_inactivity_demotion_at = case
                 when v_desired_inactivity_demotions > v_lifecycle.inactivity_demotions_applied
                   then v_lifecycle.last_episode_activity_at
                        + (v_desired_inactivity_demotions * interval '60 days')
                 else last_inactivity_demotion_at
               end,
               last_episode_activity_at = v_lifecycle.last_episode_activity_at,
               last_evaluated_at = p_now
         where novel_id_snapshot = v_lifecycle.novel_id_snapshot;

        v_inactivity_demotions := v_inactivity_demotions
          + greatest(0, v_lifecycle.current_rank - v_new_rank);
      end if;

    elsif v_lifecycle.finalized_at is null
      and v_lifecycle.completed_at is not null
      and v_lifecycle.completed_at <= p_now - interval '30 days' then

      update public.novel_rank_state
         set final_rank = current_rank,
             finalized_at = p_now,
             last_evaluated_at = p_now
       where novel_id_snapshot = v_lifecycle.novel_id_snapshot
         and is_completed
         and finalized_at is null
      returning current_rank into v_new_rank;

      if found then
        insert into public.novel_final_rank_history (
          novel_id_snapshot,
          author_id_snapshot,
          completion_cycle,
          final_rank,
          finalized_at
        ) values (
          v_lifecycle.novel_id_snapshot,
          v_lifecycle.author_id_snapshot,
          v_lifecycle.completion_cycle,
          v_new_rank,
          p_now
        )
        on conflict (novel_id_snapshot, completion_cycle) do update
          set final_rank = excluded.final_rank,
              finalized_at = excluded.finalized_at,
              updated_at = p_now
        returning id into v_final_history_id;

        insert into public.novel_rank_events (
          novel_id_snapshot,
          author_id_snapshot,
          from_rank,
          to_rank,
          event_type,
          occurred_at
        )
        select
          v_lifecycle.novel_id_snapshot,
          v_lifecycle.author_id_snapshot,
          v_new_rank,
          v_new_rank,
          'finalized',
          p_now
        where not exists (
          select 1
            from public.novel_rank_events e
           where e.novel_id_snapshot = v_lifecycle.novel_id_snapshot
             and e.event_type = 'finalized'
             and e.occurred_at = p_now
        );

        insert into public.scout_event_ledger (
          user_id,
          event_type,
          event_key,
          novel_id_snapshot,
          occurred_at,
          metadata
        ) values (
          null,
          'work_final_rank_fixed',
          'work_final_rank_fixed:' || v_lifecycle.novel_id_snapshot || ':' ||
            v_lifecycle.completion_cycle::text,
          v_lifecycle.novel_id_snapshot,
          p_now,
          jsonb_build_object(
            'completion_cycle', v_lifecycle.completion_cycle,
            'final_rank', v_new_rank,
            'final_history_id', v_final_history_id
          )
        )
        on conflict (event_key) do nothing;

        v_finalized := v_finalized + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'evaluated_at', p_now,
    'active_works', v_active,
    'promotions', v_promoted,
    'demotions', v_demoted,
    'metric_demotions', v_demoted,
    'pending_promotions', v_pending,
    'dormant_works', v_dormant,
    'inactivity_rank_steps', v_inactivity_demotions,
    'final_ranks_fixed', v_finalized
  );
end
$$;

revoke all on function public.novelight_recalculate_work_ranks(timestamptz)
  from public, anon, authenticated;
grant execute on function public.novelight_recalculate_work_ranks(timestamptz)
  to service_role;

commit;
