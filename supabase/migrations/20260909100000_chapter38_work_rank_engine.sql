-- NOVELIGHT Chapter 38 work Rank calculation engine.
--
-- This migration adds the missing star-rating evidence needed by Rank 2+, then
-- layers deterministic Rank inputs/candidates on top of the existing
-- novel_rank_state / novel_rank_events foundations from 20260909071500.
--
-- Scope intentionally stops before inactivity demotion and FINAL RANK lifecycle.
-- Those require the dedicated completion-state workstream. This migration does
-- establish authoritative episode activity timestamps so the active-work pool
-- can exclude unfinished works after 30 days without changing their Rank.
--
-- LIGHT SEED remains completely separate: no seed count or seed type is read by
-- any Rank calculation function in this migration.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260909100000'));

-- ---------------------------------------------------------------------------
-- Episode activity timestamp.
-- PV-only updates must never make a dormant work appear newly updated.
-- ---------------------------------------------------------------------------
alter table public.episodes
  add column updated_at timestamptz;

update public.episodes
set updated_at = created_at
where updated_at is null;

alter table public.episodes
  alter column updated_at set default now(),
  alter column updated_at set not null;

create or replace function public.novelight_touch_episode_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Ignore PV-only changes. Any other episode mutation is meaningful author
  -- activity for Chapter 38's "last episode update" rule.
  if (pg_catalog.to_jsonb(new) - 'pv' - 'updated_at')
     is distinct from
     (pg_catalog.to_jsonb(old) - 'pv' - 'updated_at') then
    new.updated_at := pg_catalog.now();
  else
    new.updated_at := old.updated_at;
  end if;

  return new;
end
$$;

revoke all on function public.novelight_touch_episode_updated_at()
  from public, anon, authenticated;

create trigger episodes_touch_novelight_updated_at
before update on public.episodes
for each row
execute function public.novelight_touch_episode_updated_at();

-- ---------------------------------------------------------------------------
-- Current star rating state.
-- Individual rows are private; clients use narrowly scoped RPCs only.
-- Every actual change is copied to scout_event_ledger so beta history remains
-- replayable even when the current rating is later changed or removed.
-- ---------------------------------------------------------------------------
create table public.novel_star_ratings (
  user_id uuid not null,
  novel_id_snapshot text not null,
  author_id_snapshot uuid not null,
  rating smallint not null check (rating between 1 and 5),
  first_rated_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, novel_id_snapshot)
);

create index novel_star_ratings_novel_idx
  on public.novel_star_ratings (novel_id_snapshot);

alter table public.novel_star_ratings enable row level security;
revoke all on table public.novel_star_ratings from public, anon, authenticated;

create or replace function public.novelight_star_rating_status(p_novel_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_count bigint := 0;
  v_average numeric;
  v_my_rating smallint;
begin
  if not exists (
    select 1
      from public.novels n
     where n.id::text = p_novel_id
       and n.status = 'published'
  ) then
    raise exception using errcode = '23514', message = '公開作品が見つかりません';
  end if;

  select count(*)::bigint,
         pg_catalog.round(avg(r.rating)::numeric, 2)
    into v_count, v_average
    from public.novel_star_ratings r
   where r.novel_id_snapshot = p_novel_id;

  if v_uid is not null then
    select r.rating
      into v_my_rating
      from public.novel_star_ratings r
     where r.user_id = v_uid
       and r.novel_id_snapshot = p_novel_id;
  end if;

  return pg_catalog.jsonb_build_object(
    'novel_id', p_novel_id,
    'rating_count', v_count,
    'average_rating', v_average,
    'my_rating', v_my_rating
  );
end
$$;

revoke all on function public.novelight_star_rating_status(text) from public;
grant execute on function public.novelight_star_rating_status(text)
  to anon, authenticated;

create or replace function public.set_novel_star_rating(
  p_novel_id text,
  p_rating integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_author_id uuid;
  v_old_rating smallint;
  v_had_old boolean := false;
  v_event_id uuid := pg_catalog.gen_random_uuid();
  v_event_type text;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  if p_rating is null or p_rating not between 1 and 5 then
    raise exception using errcode = '22023', message = '評価は1から5で指定してください';
  end if;

  select n.user_id
    into v_author_id
    from public.novels n
   where n.id::text = p_novel_id
     and n.status = 'published';

  if not found then
    raise exception using errcode = '23514', message = '公開作品が見つかりません';
  end if;

  if v_author_id = v_uid then
    raise exception using errcode = '42501', message = '自分の作品は評価できません';
  end if;

  select r.rating
    into v_old_rating
    from public.novel_star_ratings r
   where r.user_id = v_uid
     and r.novel_id_snapshot = p_novel_id;
  v_had_old := found;

  if v_had_old and v_old_rating = p_rating::smallint then
    return public.novelight_star_rating_status(p_novel_id);
  end if;

  if v_had_old then
    update public.novel_star_ratings
       set rating = p_rating::smallint,
           author_id_snapshot = v_author_id,
           updated_at = pg_catalog.now()
     where user_id = v_uid
       and novel_id_snapshot = p_novel_id;
    v_event_type := 'star_rating_changed';
  else
    insert into public.novel_star_ratings (
      user_id,
      novel_id_snapshot,
      author_id_snapshot,
      rating
    ) values (
      v_uid,
      p_novel_id,
      v_author_id,
      p_rating::smallint
    );
    v_event_type := 'star_rating_set';
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
    v_event_type,
    v_event_type || ':' || v_event_id::text,
    p_novel_id,
    pg_catalog.now(),
    pg_catalog.jsonb_build_object(
      'old_rating', case when v_had_old then v_old_rating else null end,
      'new_rating', p_rating::smallint
    )
  );

  return public.novelight_star_rating_status(p_novel_id);
end
$$;

revoke all on function public.set_novel_star_rating(text, integer) from public, anon;
grant execute on function public.set_novel_star_rating(text, integer) to authenticated;

create or replace function public.clear_novel_star_rating(p_novel_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_old_rating smallint;
  v_event_id uuid := pg_catalog.gen_random_uuid();
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  delete from public.novel_star_ratings r
   where r.user_id = v_uid
     and r.novel_id_snapshot = p_novel_id
  returning r.rating into v_old_rating;

  if not found then
    return pg_catalog.jsonb_build_object(
      'novel_id', p_novel_id,
      'removed', false
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
    'star_rating_removed',
    'star_rating_removed:' || v_event_id::text,
    p_novel_id,
    pg_catalog.now(),
    pg_catalog.jsonb_build_object('old_rating', v_old_rating)
  );

  if exists (
    select 1
      from public.novels n
     where n.id::text = p_novel_id
       and n.status = 'published'
  ) then
    return public.novelight_star_rating_status(p_novel_id);
  end if;

  return pg_catalog.jsonb_build_object(
    'novel_id', p_novel_id,
    'removed', true
  );
end
$$;

revoke all on function public.clear_novel_star_rating(text) from public, anon;
grant execute on function public.clear_novel_star_rating(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Rank state evaluation fields.
-- candidate_rank / candidate_rank_since are intentionally separate from
-- rank_stable_since, which describes the already-earned current Rank.
-- ---------------------------------------------------------------------------
alter table public.novel_rank_state
  add column candidate_rank smallint not null default 1
    check (candidate_rank between 1 and 6),
  add column candidate_rank_since timestamptz not null default now(),
  add column last_evaluated_at timestamptz,
  add column last_internal_score double precision,
  add column last_absolute_ceiling smallint
    check (last_absolute_ceiling between 1 and 6),
  add column last_relative_rank smallint
    check (last_relative_rank between 1 and 6),
  add column last_pv bigint,
  add column last_favorite_count bigint,
  add column last_rating_count bigint,
  add column last_rating_average numeric(4, 2),
  add column last_episode_activity_at timestamptz;

update public.novel_rank_state
set candidate_rank = current_rank,
    candidate_rank_since = pg_catalog.now();

-- Absolute threshold ceiling from MASTER Chapter 38.
create or replace function public.novelight_rank_absolute_ceiling(
  p_pv bigint,
  p_favorites bigint,
  p_rating_count bigint,
  p_rating_average numeric
)
returns smallint
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when coalesce(p_pv, 0) >= 10000
     and coalesce(p_favorites, 0) >= 300
     and coalesce(p_rating_count, 0) >= 150
     and coalesce(p_rating_average, 0) >= 4.0 then 6
    when coalesce(p_pv, 0) >= 3000
     and coalesce(p_favorites, 0) >= 100
     and coalesce(p_rating_count, 0) >= 50
     and coalesce(p_rating_average, 0) >= 3.7 then 5
    when coalesce(p_pv, 0) >= 800
     and coalesce(p_favorites, 0) >= 30
     and coalesce(p_rating_count, 0) >= 15
     and coalesce(p_rating_average, 0) >= 3.5 then 4
    when coalesce(p_pv, 0) >= 200
     and coalesce(p_favorites, 0) >= 8
     and coalesce(p_rating_count, 0) >= 5
     and coalesce(p_rating_average, 0) >= 3.3 then 3
    when coalesce(p_pv, 0) >= 50
     and coalesce(p_favorites, 0) >= 2
     and coalesce(p_rating_count, 0) >= 2
     and coalesce(p_rating_average, 0) >= 3.0 then 2
    else 1
  end::smallint
$$;

-- Bayesian shrinkage toward neutral 3.0. The prior weight is an internal beta
-- tuning constant, not a public scoring promise. It prevents a tiny number of
-- extreme ratings from outranking broad, stable positive reception.
create or replace function public.novelight_rating_reliability_score(
  p_rating_count bigint,
  p_rating_average numeric
)
returns double precision
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when coalesce(p_rating_count, 0) <= 0 or p_rating_average is null then 0::double precision
    else pg_catalog.greatest(
      0::double precision,
      pg_catalog.least(
        1::double precision,
        (
          (
            ((p_rating_count::numeric * p_rating_average) + (10::numeric * 3.0::numeric))
            / (p_rating_count::numeric + 10::numeric)
          ) - 1::numeric
        )::double precision / 4::double precision
      )
    )
  end
$$;

create or replace function public.novelight_rank_relative_band(p_percentile double precision)
returns smallint
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when coalesce(p_percentile, 0) <= 0.40 then 1
    when p_percentile <= 0.70 then 2
    when p_percentile <= 0.85 then 3
    when p_percentile <= 0.95 then 4
    when p_percentile <= 0.99 then 5
    else 6
  end::smallint
$$;

create or replace function public.novelight_rank_required_stability(p_rank smallint)
returns interval
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case p_rank
    when 2 then interval '24 hours'
    when 3 then interval '24 hours'
    when 4 then interval '48 hours'
    when 5 then interval '72 hours'
    when 6 then interval '7 days'
    else interval '0 seconds'
  end
$$;

revoke all on function public.novelight_rank_absolute_ceiling(bigint, bigint, bigint, numeric)
  from public, anon, authenticated;
revoke all on function public.novelight_rating_reliability_score(bigint, numeric)
  from public, anon, authenticated;
revoke all on function public.novelight_rank_relative_band(double precision)
  from public, anon, authenticated;
revoke all on function public.novelight_rank_required_stability(smallint)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Batch Rank evaluator.
--
-- Active pool = published works whose latest published episode update (falling
-- back to first publication) is within 30 days. Inactive works are excluded but
-- are not demoted here, matching Chapter 38's 30-day grace rule.
--
-- Internal beta score = PV 20% + favorites 35% + star-related 45%.
-- PV/favorites use their active-pool percentile; star score uses the reliability
-- corrected 1..5 average normalized to 0..1. Relative bands are then applied to
-- the composite score. Absolute threshold ceiling and relative band must both be
-- satisfied, so candidate Rank is the lower of the two.
-- ---------------------------------------------------------------------------
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
  v_candidate smallint;
  v_required interval;
  v_active integer := 0;
  v_promoted integer := 0;
  v_demoted integer := 0;
  v_pending integer := 0;
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
             pg_catalog.greatest(coalesce(n.pv, 0), 0)::bigint as pv,
             coalesce(f.favorite_count, 0)::bigint as favorite_count,
             coalesce(r.rating_count, 0)::bigint as rating_count,
             r.rating_average,
             coalesce(a.last_episode_activity_at, n.first_published_at) as last_episode_activity_at
        from public.novels n
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
       where m.last_episode_activity_at is null
          or m.last_episode_activity_at >= p_now - interval '30 days'
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

    v_candidate := pg_catalog.least(
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
             last_episode_activity_at = v_row.last_episode_activity_at
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
             last_episode_activity_at = v_row.last_episode_activity_at
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
               last_episode_activity_at = v_row.last_episode_activity_at
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
                 last_episode_activity_at = v_row.last_episode_activity_at
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
                 last_episode_activity_at = v_row.last_episode_activity_at
           where novel_id_snapshot = v_row.novel_id_snapshot;
          v_pending := v_pending + 1;
        end if;
      end if;
    end if;
  end loop;

  return pg_catalog.jsonb_build_object(
    'evaluated_at', p_now,
    'active_works', v_active,
    'promotions', v_promoted,
    'demotions', v_demoted,
    'pending_promotions', v_pending
  );
end
$$;

revoke all on function public.novelight_recalculate_work_ranks(timestamptz)
  from public, anon, authenticated;
grant execute on function public.novelight_recalculate_work_ranks(timestamptz)
  to service_role;

commit;
