-- NOVELIGHT Chapter 38: authoritative work completion, inactivity demotion,
-- and FINAL RANK lifecycle.
--
-- Depends on:
--   20260909071500_scout_beta_event_foundations
--   20260909100000_chapter38_work_rank_engine
--
-- This migration does not expose raw Rank/SCOUT tables to clients. Authors use
-- narrowly-scoped RPCs for completion state. Global Rank recalculation remains
-- service_role-only.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260909120000'));

create schema if not exists novelrise_migration_backup;
revoke all on schema novelrise_migration_backup from public, anon, authenticated;

create table if not exists novelrise_migration_backup.chapter38_rank_lifecycle_state (
  migration_id text primary key,
  applied_at timestamptz not null default now(),
  original_rank_recalculator text not null
);

do $precondition$
begin
  if to_regprocedure('public.novelight_recalculate_work_ranks(timestamp with time zone)') is null then
    raise exception 'Chapter 38 work Rank engine must exist before lifecycle migration';
  end if;

  if exists (
    select 1
      from novelrise_migration_backup.chapter38_rank_lifecycle_state
     where migration_id = '20260909120000'
  ) then
    raise exception 'Chapter 38 work Rank lifecycle backup already exists';
  end if;
end
$precondition$;

insert into novelrise_migration_backup.chapter38_rank_lifecycle_state (
  migration_id,
  original_rank_recalculator
)
select
  '20260909120000',
  pg_get_functiondef('public.novelight_recalculate_work_ranks(timestamp with time zone)'::regprocedure);

alter table public.novel_rank_state
  add column completion_ever_recorded boolean not null default false,
  add column completion_cycle smallint not null default 0
    check (completion_cycle between 0 and 2),
  add column completion_state_changes_used smallint not null default 0
    check (completion_state_changes_used between 0 and 2),
  add column dormant_since timestamptz,
  add column inactivity_demotions_applied smallint not null default 0
    check (inactivity_demotions_applied between 0 and 5),
  add column last_inactivity_demotion_at timestamptz;

alter table public.novel_rank_state
  add constraint novel_rank_completion_cycle_consistency
    check (
      (not completion_ever_recorded and completion_cycle = 0)
      or (completion_ever_recorded and completion_cycle between 1 and 2)
    ),
  add constraint novel_rank_completion_timestamp_consistency
    check (
      (is_completed and completed_at is not null)
      or (not is_completed and completed_at is null)
    ),
  add constraint novel_rank_final_requires_completion
    check (final_rank is null or is_completed);

create table public.novel_final_rank_history (
  id uuid primary key default gen_random_uuid(),
  novel_id_snapshot text not null,
  author_id_snapshot uuid not null,
  completion_cycle smallint not null check (completion_cycle between 1 and 2),
  final_rank smallint not null check (final_rank between 1 and 6),
  finalized_at timestamptz not null,
  superseded_at timestamptz,
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint novel_final_rank_history_cycle_once
    unique (novel_id_snapshot, completion_cycle),
  constraint novel_final_rank_history_superseded_after_final
    check (superseded_at is null or superseded_at >= finalized_at)
);

create index novel_final_rank_history_author_idx
  on public.novel_final_rank_history (author_id_snapshot, finalized_at desc);

alter table public.novel_final_rank_history enable row level security;
revoke all on table public.novel_final_rank_history from public, anon, authenticated;

create or replace function public.novelight_work_completion_status(p_novel_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_owner uuid;
  v_status text;
  v_state public.novel_rank_state%rowtype;
  v_history jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  select n.user_id, n.status
    into v_owner, v_status
    from public.novels n
   where n.id::text = p_novel_id;

  if not found or v_owner is distinct from v_uid then
    raise exception using errcode = '42501', message = 'Work owner access required';
  end if;

  select s.*
    into v_state
    from public.novel_rank_state s
   where s.novel_id_snapshot = p_novel_id;

  if found then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'completion_cycle', h.completion_cycle,
          'final_rank', h.final_rank,
          'finalized_at', h.finalized_at,
          'superseded_at', h.superseded_at,
          'is_public', h.is_public
        )
        order by h.completion_cycle
      ),
      '[]'::jsonb
    )
      into v_history
      from public.novel_final_rank_history h
     where h.novel_id_snapshot = p_novel_id
       and h.author_id_snapshot = v_uid;

    return jsonb_build_object(
      'novel_id', p_novel_id,
      'novel_status', v_status,
      'rank_state_ready', true,
      'is_completed', v_state.is_completed,
      'completed_at', v_state.completed_at,
      'completion_ever_recorded', v_state.completion_ever_recorded,
      'completion_cycle', v_state.completion_cycle,
      'state_changes_used', v_state.completion_state_changes_used,
      'state_changes_remaining', greatest(0, 2 - v_state.completion_state_changes_used),
      'state_locked', v_state.completion_state_changes_used >= 2,
      'current_rank', v_state.current_rank,
      'final_rank', v_state.final_rank,
      'finalized_at', v_state.finalized_at,
      'final_rank_history', v_history
    );
  end if;

  return jsonb_build_object(
    'novel_id', p_novel_id,
    'novel_status', v_status,
    'rank_state_ready', false,
    'is_completed', false,
    'completion_ever_recorded', false,
    'completion_cycle', 0,
    'state_changes_used', 0,
    'state_changes_remaining', 2,
    'state_locked', false,
    'current_rank', null,
    'final_rank', null,
    'finalized_at', null,
    'final_rank_history', '[]'::jsonb
  );
end
$$;

revoke all on function public.novelight_work_completion_status(text)
  from public, anon, authenticated;
grant execute on function public.novelight_work_completion_status(text)
  to authenticated;

create or replace function public.novelight_set_work_completion_status(
  p_novel_id text,
  p_is_completed boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_owner uuid;
  v_novel_status text;
  v_state public.novel_rank_state%rowtype;
  v_next_changes smallint;
  v_next_cycle smallint;
  v_event_id uuid := pg_catalog.gen_random_uuid();
  v_now timestamptz := pg_catalog.now();
  v_prior_final_rank smallint;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  if p_novel_id is null or btrim(p_novel_id) = '' or p_is_completed is null then
    raise exception using errcode = '22023', message = 'Valid work completion payload is required';
  end if;

  select n.user_id, n.status
    into v_owner, v_novel_status
    from public.novels n
   where n.id::text = p_novel_id
   for update;

  if not found or v_owner is distinct from v_uid then
    raise exception using errcode = '42501', message = 'Work owner access required';
  end if;

  if v_novel_status <> 'published' then
    raise exception using errcode = '23514', message = 'Published work is required before completion state can change';
  end if;

  select s.*
    into v_state
    from public.novel_rank_state s
   where s.novel_id_snapshot = p_novel_id
   for update;

  if not found then
    raise exception 'Rank state missing for published work %', p_novel_id;
  end if;

  if v_state.is_completed = p_is_completed then
    return public.novelight_work_completion_status(p_novel_id);
  end if;

  v_prior_final_rank := v_state.final_rank;

  if p_is_completed then
    if v_state.completion_ever_recorded then
      if v_state.completion_state_changes_used >= 2 then
        raise exception using errcode = 'P0001', message = 'Completion state change limit reached';
      end if;
      v_next_changes := (v_state.completion_state_changes_used + 1)::smallint;
      v_next_cycle := (v_state.completion_cycle + 1)::smallint;
    else
      v_next_changes := v_state.completion_state_changes_used;
      v_next_cycle := 1;
    end if;

    if v_next_changes > 2 or v_next_cycle > 2 then
      raise exception using errcode = 'P0001', message = 'Completion state change limit reached';
    end if;

    update public.novel_rank_state
       set is_completed = true,
           completed_at = v_now,
           final_rank = null,
           finalized_at = null,
           completion_ever_recorded = true,
           completion_cycle = v_next_cycle,
           completion_state_changes_used = v_next_changes,
           dormant_since = null,
           inactivity_demotions_applied = 0,
           last_inactivity_demotion_at = null,
           candidate_rank = current_rank,
           candidate_rank_since = v_now
     where novel_id_snapshot = p_novel_id
     returning * into v_state;
  else
    if not v_state.completion_ever_recorded then
      raise exception 'Completion lifecycle invariant violated for work %', p_novel_id;
    end if;

    if v_state.completion_state_changes_used >= 2 then
      raise exception using errcode = 'P0001', message = 'Completion state change limit reached';
    end if;

    v_next_changes := (v_state.completion_state_changes_used + 1)::smallint;

    update public.novel_final_rank_history
       set superseded_at = coalesce(superseded_at, v_now),
           updated_at = v_now
     where novel_id_snapshot = p_novel_id
       and completion_cycle = v_state.completion_cycle
       and superseded_at is null;

    update public.novel_rank_state
       set is_completed = false,
           completed_at = null,
           final_rank = null,
           finalized_at = null,
           completion_state_changes_used = v_next_changes,
           dormant_since = null,
           inactivity_demotions_applied = 0,
           last_inactivity_demotion_at = null,
           candidate_rank = current_rank,
           candidate_rank_since = v_now
     where novel_id_snapshot = p_novel_id
     returning * into v_state;
  end if;

  insert into public.scout_event_ledger (
    id,
    user_id,
    event_type,
    event_key,
    novel_id_snapshot,
    occurred_at,
    metadata
  ) values (
    v_event_id,
    v_uid,
    'work_completion_changed',
    'work_completion_changed:' || p_novel_id || ':' ||
      v_state.completion_cycle::text || ':' ||
      case when v_state.is_completed then 'completed' else 'ongoing' end || ':' ||
      v_state.completion_state_changes_used::text,
    p_novel_id,
    v_now,
    jsonb_build_object(
      'is_completed', v_state.is_completed,
      'completion_cycle', v_state.completion_cycle,
      'state_changes_used', v_state.completion_state_changes_used,
      'prior_final_rank', v_prior_final_rank
    )
  )
  on conflict (event_key) do nothing;

  return public.novelight_work_completion_status(p_novel_id);
end
$$;

revoke all on function public.novelight_set_work_completion_status(text, boolean)
  from public, anon, authenticated;
grant execute on function public.novelight_set_work_completion_status(text, boolean)
  to authenticated;

create or replace function public.novelight_set_past_final_rank_public(
  p_novel_id text,
  p_completion_cycle smallint,
  p_is_public boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_owner uuid;
  v_event_id uuid := pg_catalog.gen_random_uuid();
  v_history public.novel_final_rank_history%rowtype;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  if p_completion_cycle is null or p_completion_cycle < 1 or p_completion_cycle > 2
     or p_is_public is null then
    raise exception using errcode = '22023', message = 'Valid FINAL RANK history payload is required';
  end if;

  select n.user_id
    into v_owner
    from public.novels n
   where n.id::text = p_novel_id;

  if not found or v_owner is distinct from v_uid then
    raise exception using errcode = '42501', message = 'Work owner access required';
  end if;

  update public.novel_final_rank_history h
     set is_public = p_is_public,
         updated_at = now()
   where h.novel_id_snapshot = p_novel_id
     and h.author_id_snapshot = v_uid
     and h.completion_cycle = p_completion_cycle
     and h.superseded_at is not null
     and h.is_public is distinct from p_is_public
  returning h.* into v_history;

  if not found then
    select h.*
      into v_history
      from public.novel_final_rank_history h
     where h.novel_id_snapshot = p_novel_id
       and h.author_id_snapshot = v_uid
       and h.completion_cycle = p_completion_cycle
       and h.superseded_at is not null;

    if not found then
      raise exception using errcode = '23514', message = 'Past FINAL RANK history entry is not available';
    end if;

    return jsonb_build_object(
      'novel_id', p_novel_id,
      'completion_cycle', v_history.completion_cycle,
      'final_rank', v_history.final_rank,
      'is_public', v_history.is_public,
      'changed', false
    );
  end if;

  insert into public.scout_event_ledger (
    id,
    user_id,
    event_type,
    event_key,
    novel_id_snapshot,
    occurred_at,
    metadata
  ) values (
    v_event_id,
    v_uid,
    'past_final_rank_visibility_changed',
    'past_final_rank_visibility_changed:' || v_event_id::text,
    p_novel_id,
    now(),
    jsonb_build_object(
      'completion_cycle', v_history.completion_cycle,
      'final_rank', v_history.final_rank,
      'is_public', v_history.is_public
    )
  );

  return jsonb_build_object(
    'novel_id', p_novel_id,
    'completion_cycle', v_history.completion_cycle,
    'final_rank', v_history.final_rank,
    'is_public', v_history.is_public,
    'changed', true
  );
end
$$;

revoke all on function public.novelight_set_past_final_rank_public(text, smallint, boolean)
  from public, anon, authenticated;
grant execute on function public.novelight_set_past_final_rank_public(text, smallint, boolean)
  to authenticated;

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
             public.novelight_rank_absolute_ceiling(
               m.pv,
               m.favorite_count,
               m.rating_count,
               m.rating_average
             ) as absolute_ceiling,
             public.novelight_rating_reliability_score(
               m.rating_count,
               m.rating_average
             ) as rating_reliability
        from metric_base m
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
             percent_rank() over (order by a.pv) as pv_percentile,
             percent_rank() over (order by a.favorite_count) as favorite_percentile
        from active_metric a
    ),
    scored as (
      select p.*,
             (
               (0.20::double precision * p.pv_percentile)
               + (0.35::double precision * p.favorite_percentile)
               + (0.45::double precision * p.rating_reliability)
             ) as internal_score
        from percentile_metric p
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

  -- Apply inactivity degradation only after the normal active-work evaluation.
  -- This keeps dormant works outside the relative population and makes the
  -- 60-day decay idempotent across repeated scheduler runs.
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
