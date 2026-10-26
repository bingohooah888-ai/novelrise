-- NOVELIGHT work Rank: remove nonexistent star-rating concept.
-- Preserve six ranks, qualified-reader/favorite absolute floors,
-- relative score bands, promotion stability, inactivity/finalization,
-- LIGHT SEED / SCOUT discovery side effects and private visibility.
-- Production only after a separate explicit approval and migration precheck.
begin;
select pg_advisory_xact_lock(pg_catalog.hashtext('novelight:rank-starless-20261027'));
do $precondition$
begin
  if exists (select 1 from public.novel_star_ratings limit 1)
     or exists (select 1 from public.scout_xp_ledger where xp_kind = 'star_rating' limit 1)
     or exists (select 1 from public.user_scout_badges where badge_id like 'reader_rating_%' and earned_at is not null limit 1) then
    raise exception 'Nonempty historic star records: migrate explicitly before removing star specification';
  end if;
end;
$precondition$;

-- Keep existing exact eligible-reader/favorite absolute floors and ranks.
create or replace function public.novelight_rank_absolute_ceiling_v3(
 p_valid_read_count bigint, p_favorites bigint
) returns smallint language sql immutable parallel safe security invoker set search_path = ''
as $rank_ceiling$
 select case
   when coalesce(p_valid_read_count, 0) >= 10000 and coalesce(p_favorites, 0) >= 300 then 6
   when coalesce(p_valid_read_count, 0) >= 3000 and coalesce(p_favorites, 0) >= 100 then 5
   when coalesce(p_valid_read_count, 0) >= 800 and coalesce(p_favorites, 0) >= 30 then 4
   when coalesce(p_valid_read_count, 0) >= 200 and coalesce(p_favorites, 0) >= 8 then 3
   when coalesce(p_valid_read_count, 0) >= 50 and coalesce(p_favorites, 0) >= 2 then 2
   else 1
 end::smallint
$rank_ceiling$;

-- Preserve the 20:35 relative influence of the two remaining signals.
create or replace function public.novelight_rank_internal_score_v3(
 p_valid_read_percentile double precision, p_favorite_percentile double precision
) returns double precision language sql immutable parallel safe security invoker set search_path = ''
as $rank_score$
 select (
  20.0 * greatest(0.0, least(100.0, coalesce(p_valid_read_percentile, 0.0))) +
  35.0 * greatest(0.0, least(100.0, coalesce(p_favorite_percentile, 0.0)))
 ) / 55.0
$rank_score$;

revoke all on function public.novelight_rank_absolute_ceiling_v3(bigint,bigint) from public,anon,authenticated;
revoke all on function public.novelight_rank_internal_score_v3(double precision,double precision) from public,anon,authenticated;
grant execute on function public.novelight_rank_absolute_ceiling_v3(bigint,bigint) to service_role;
grant execute on function public.novelight_rank_internal_score_v3(double precision,double precision) to service_role;

-- Existing rank lifecycle body, with ONLY star-derived inputs removed.
CREATE OR REPLACE FUNCTION public.novelight_recalculate_work_ranks(p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
        join public.novels fn on fn.id = f.novel_id
       where f.user_id <> fn.user_id
       group by f.novel_id::text
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
             (select count(distinct vr.reader_id)::bigint
                from public.valid_read_events vr
               where vr.novel_id_snapshot = n.id::text
                 and vr.foreground_signal
                 and (vr.progress_signal or vr.interaction_signal)) as valid_read_count,
             coalesce(f.favorite_count, 0)::bigint as favorite_count,
             coalesce(a.last_episode_activity_at, n.first_published_at) as last_episode_activity_at,
             s.is_completed,
             s.finalized_at
        from public.novels n
        join public.novel_rank_state s
          on s.novel_id_snapshot = n.id::text
        left join favorite_metric f on f.novel_id_snapshot = n.id::text
        left join activity_metric a on a.novel_id_snapshot = n.id::text
       where n.status = 'published'
    ),

    active_metric as (
      select m.*,
             public.novelight_rank_absolute_ceiling_v3(
               m.valid_read_count,
               m.favorite_count
             ) as absolute_ceiling
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
             (100.0::double precision * percent_rank() over (order by a.valid_read_count)) as valid_read_percentile,
             (100.0::double precision * percent_rank() over (order by a.favorite_count)) as favorite_percentile
        from active_metric a
    ),
    scored as (
      select p.*,
             public.novelight_rank_internal_score_v3(
               p.valid_read_percentile,
               p.favorite_percentile
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
             last_valid_read_count = v_row.valid_read_count,
             last_favorite_count = v_row.favorite_count,
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
             last_valid_read_count = v_row.valid_read_count,
             last_favorite_count = v_row.favorite_count,
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
             last_valid_read_count = v_row.valid_read_count,
               last_favorite_count = v_row.favorite_count,
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
             last_valid_read_count = v_row.valid_read_count,
                 last_favorite_count = v_row.favorite_count,
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
             last_valid_read_count = v_row.valid_read_count,
                 last_favorite_count = v_row.favorite_count,
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
$function$;

-- Preserve special-zone RPC return fields for backward compatibility;
-- inactive legacy fields are constant 0/NULL, not actual star signals.
CREATE OR REPLACE FUNCTION public.novelight_special_zone_feed_v1(p_zone text, p_mode text DEFAULT 'recommended'::text, p_genre text DEFAULT NULL::text, p_limit integer DEFAULT 24, p_offset integer DEFAULT 0, p_rotation_key text DEFAULT NULL::text)
 RETURNS TABLE(feed_position integer, novel_id text, title text, genre text, description text, created_at timestamp with time zone, author_id uuid, author_name text, thumbnail_url text, favorite_count bigint, rating_count bigint, average_rating numeric, qualified_reader_count bigint, zone text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_zone text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_zone, '')));
  v_mode text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_mode, 'recommended')));
  v_limit integer := least(greatest(coalesce(p_limit, 24), 1), 48);
  v_offset integer := least(greatest(coalesce(p_offset, 0), 0), 10000);
  v_rotation text := pg_catalog.left(
    coalesce(
      nullif(pg_catalog.btrim(p_rotation_key), ''),
      pg_catalog.date_trunc('hour', pg_catalog.now())::text
    ),
    128
  );
begin
  if v_zone not in ('ai', 'r15', 'r18') then
    raise exception using errcode = '22023', message = 'Unknown special-light zone';
  end if;

  if v_mode not in ('recommended', 'ranking') then
    raise exception using errcode = '22023', message = 'Unknown special-light display mode';
  end if;

  return query
  with metrics as materialized (
    select
      n.id::text as novel_id,
      n.title,
      n.genre,
      n.description,
      n.created_at,
      n.user_id as author_id,
      coalesce(p.display_name, '')::text as author_name,
      n.thumbnail_url,
      (pg_catalog.count(distinct f.user_id) filter (where f.user_id <> n.user_id))::bigint as favorite_count,
      0::bigint as rating_count,
      null::numeric as average_rating,
      (
        pg_catalog.count(distinct vr.reader_id) filter (
          where vr.reader_id <> n.user_id
            and vr.foreground_signal
            and (vr.progress_signal or vr.interaction_signal)
        )
      )::bigint as qualified_reader_count,
      public.novelight_discovery_zone(n.ai_usage, n.content_rating) as zone,
      pg_catalog.md5(v_rotation || ':' || n.id::text) as rotation_key
    from public.novels n
    left join public.profiles p on p.id = n.user_id
    left join public.favorites f on f.novel_id::text = n.id::text
    left join public.valid_read_events vr on vr.novel_id_snapshot = n.id::text
    where n.status = 'published'
      and public.novelight_discovery_zone(n.ai_usage, n.content_rating) = v_zone
      and (
        p_genre is null
        or pg_catalog.btrim(p_genre) = ''
        or n.genre = pg_catalog.btrim(p_genre)
      )
    group by
      n.id,
      n.title,
      n.genre,
      n.description,
      n.created_at,
      n.user_id,
      p.display_name,
      n.thumbnail_url,
      n.ai_usage,
      n.content_rating
  ),
  scored as materialized (
    select
      m.*,
      (pg_catalog.ln(1 + coalesce(m.favorite_count, 0)) * 0.28)
      + (pg_catalog.ln(1 + coalesce(m.qualified_reader_count, 0)) * 0.22) as ranking_score,
      pg_catalog.row_number() over (
        partition by m.author_id
        order by m.rotation_key, m.created_at desc, m.novel_id
      ) as author_rotation_position
    from metrics m
  ),
  ordered as (
    select
      s.*,
      pg_catalog.row_number() over (
        order by
          case when v_mode = 'recommended' then s.author_rotation_position else 1 end asc,
          case when v_mode = 'ranking' then s.ranking_score end desc nulls last,
          case when v_mode = 'ranking' then s.qualified_reader_count end desc nulls last,
          case when v_mode = 'ranking' then s.favorite_count end desc nulls last,
          case when v_mode = 'recommended' then s.rotation_key end asc nulls last,
          s.created_at desc,
          s.novel_id
      )::integer as feed_position
    from scored s
  )
  select
    o.feed_position,
    o.novel_id,
    o.title,
    o.genre,
    o.description,
    o.created_at,
    o.author_id,
    o.author_name,
    o.thumbnail_url,
    o.favorite_count,
    o.rating_count,
    o.average_rating,
    o.qualified_reader_count,
    o.zone
  from ordered o
  where o.feed_position > v_offset
    and o.feed_position <= v_offset + v_limit
  order by o.feed_position;
end
$function$;

-- Preserve existing reader badge calculation/other metrics; legacy rating
-- count is always zero and the six unattainable rating-only badges are retired.
CREATE OR REPLACE FUNCTION public.novelight_reader_badge_metrics_rank_internal_20260928(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_settings jsonb;
  v_new_author_days integer;
  v_new_work_days integer;
  v_low_rank_threshold integer;
  v_long_chars integer;
  v_long_valid_episodes integer;
  v_short_chars integer;
  v_completed_ratio numeric;

  v_read bigint := 0;
  v_rating bigint := 0;
  v_comment bigint := 0;
  v_seed bigint := 0;
  v_gold bigint := 0;
  v_silver bigint := 0;
  v_bronze bigint := 0;
  v_plus2 bigint := 0;
  v_plus3 bigint := 0;
  v_plus4 bigint := 0;
  v_plus5 bigint := 0;
  v_nova bigint := 0;
  v_gold_plus5 bigint := 0;
  v_silver_plus5 bigint := 0;
  v_bronze_plus5 bigint := 0;
  v_new_author bigint := 0;
  v_new_work bigint := 0;
  v_low_rank bigint := 0;
  v_genres bigint := 0;
  v_long_read bigint := 0;
  v_short_read bigint := 0;
  v_completed_read bigint := 0;
  v_active_days bigint := 0;
  v_level bigint := 1;
  v_point_earned bigint := 0;
  v_cap bigint := 0;
  v_xp bigint := 0;
begin
  if p_user_id is null then
    return '{}'::jsonb;
  end if;

  select c.badge_settings into v_settings
    from public.scout_badge_runtime_config c where c.id = 1;

  v_new_author_days := greatest(coalesce((v_settings->>'new_author_days')::integer, 30), 1);
  v_new_work_days := greatest(coalesce((v_settings->>'new_work_days')::integer, 7), 1);
  v_low_rank_threshold := least(greatest(coalesce((v_settings->>'low_rank_threshold')::integer, 2), 1), 6);
  v_long_chars := greatest(coalesce((v_settings->>'long_chars')::integer, 100000), 1);
  v_long_valid_episodes := greatest(coalesce((v_settings->>'long_valid_episodes')::integer, 5), 1);
  v_short_chars := greatest(coalesce((v_settings->>'short_chars')::integer, 20000), 1);
  v_completed_ratio := least(greatest(coalesce((v_settings->>'completed_read_ratio')::numeric, 0.80), 0.01), 1.00);

  select count(distinct v.novel_id_snapshot)::bigint into v_read
    from public.valid_read_events v
   where v.reader_id = p_user_id;

  select count(distinct c.novel_id)::bigint into v_comment
    from public.novel_comments c
    join public.novels n on n.id = c.novel_id
   where c.user_id = p_user_id
     and c.deleted_at is null
     and c.author_hidden_at is null
     and n.status = 'published'
     and n.user_id <> p_user_id;

  select
    count(*)::bigint,
    count(*) filter (where s.seed_type = 'GOLD')::bigint,
    count(*) filter (where s.seed_type = 'SILVER')::bigint,
    count(*) filter (where s.seed_type = 'BRONZE')::bigint
  into v_seed, v_gold, v_silver, v_bronze
  from public.light_seeds s
  where s.reader_id = p_user_id;

  select
    count(*) filter (where d.best_rank_delta >= 2)::bigint,
    count(*) filter (where d.best_rank_delta >= 3)::bigint,
    count(*) filter (where d.best_rank_delta >= 4)::bigint,
    count(*) filter (where d.best_rank_delta >= 5)::bigint,
    count(*) filter (where d.rank_at_seed = 5 and d.highest_rank_seen = 6)::bigint,
    count(*) filter (where d.seed_type = 'GOLD' and d.best_rank_delta >= 5)::bigint,
    count(*) filter (where d.seed_type = 'SILVER' and d.best_rank_delta >= 5)::bigint,
    count(*) filter (where d.seed_type = 'BRONZE' and d.best_rank_delta >= 5)::bigint
  into v_plus2, v_plus3, v_plus4, v_plus5, v_nova,
       v_gold_plus5, v_silver_plus5, v_bronze_plus5
  from public.seed_discovery_state d
  where d.reader_id = p_user_id;

  with author_first as (
    select n.user_id, min(n.first_published_at) as first_published_at
      from public.novels n
     where n.first_published_at is not null
     group by n.user_id
  )
  select count(distinct v.author_id_snapshot)::bigint into v_new_author
    from public.valid_read_events v
    join author_first a on a.user_id = v.author_id_snapshot
   where v.reader_id = p_user_id
     and v.qualified_at >= a.first_published_at
     and v.qualified_at < a.first_published_at
       + pg_catalog.make_interval(days => v_new_author_days);

  select count(distinct v.novel_id_snapshot)::bigint into v_new_work
    from public.valid_read_events v
    join public.novels n on n.id::text = v.novel_id_snapshot
   where v.reader_id = p_user_id
     and n.first_published_at is not null
     and v.qualified_at >= n.first_published_at
     and v.qualified_at < n.first_published_at
       + pg_catalog.make_interval(days => v_new_work_days);

  select count(distinct x.novel_id_snapshot)::bigint into v_low_rank
    from (
      select
        v.novel_id_snapshot,
        (
          select re.to_rank
            from public.novel_rank_events re
           where re.novel_id_snapshot = v.novel_id_snapshot
             and re.occurred_at <= v.qualified_at
           order by re.occurred_at desc, re.id desc
           limit 1
        ) as rank_at_read
      from public.valid_read_events v
      where v.reader_id = p_user_id
    ) x
   where x.rank_at_read is not null
     and x.rank_at_read <= v_low_rank_threshold;

  select count(distinct n.genre)::bigint into v_genres
    from (
      select distinct v.novel_id_snapshot
        from public.valid_read_events v
       where v.reader_id = p_user_id
    ) r
    join public.novels n on n.id::text = r.novel_id_snapshot
   where n.status = 'published'
     and n.genre is not null
     and pg_catalog.btrim(n.genre) <> '';

  with work_stats as (
    select
      n.id::text as novel_id,
      coalesce(sum(pg_catalog.char_length(coalesce(e.content, ''))), 0)::bigint as published_chars,
      count(e.id)::bigint as published_episodes,
      (pg_catalog.array_agg(e.id::text order by e.episode_number desc, e.id desc))[1] as final_episode_id,
      coalesce(rs.is_completed, false) as is_completed
    from public.novels n
    join public.episodes e
      on e.novel_id = n.id
     and e.status = 'published'
    left join public.novel_rank_state rs
      on rs.novel_id_snapshot = n.id::text
    where n.status = 'published'
    group by n.id, rs.is_completed
  ),
  reader_stats as (
    select
      w.*,
      count(v.id)::bigint as valid_read_episodes,
      coalesce(bool_or(v.episode_id_snapshot = w.final_episode_id), false) as read_final_episode
    from work_stats w
    left join public.valid_read_events v
      on v.reader_id = p_user_id
     and v.novel_id_snapshot = w.novel_id
    group by
      w.novel_id, w.published_chars, w.published_episodes,
      w.final_episode_id, w.is_completed
  )
  select
    count(*) filter (
      where r.published_chars >= v_long_chars
        and r.valid_read_episodes >= v_long_valid_episodes
    )::bigint,
    count(*) filter (
      where r.is_completed
        and r.read_final_episode
        and r.published_episodes > 0
        and r.valid_read_episodes::numeric / r.published_episodes::numeric >= v_completed_ratio
        and r.published_chars <= v_short_chars
    )::bigint,
    count(*) filter (
      where r.is_completed
        and r.read_final_episode
        and r.published_episodes > 0
        and r.valid_read_episodes::numeric / r.published_episodes::numeric >= v_completed_ratio
    )::bigint
  into v_long_read, v_short_read, v_completed_read
  from reader_stats r;

  select count(distinct a.activity_day)::bigint into v_active_days
  from (
    select pg_catalog.timezone('Asia/Tokyo', v.qualified_at)::date as activity_day
      from public.valid_read_events v
     where v.reader_id = p_user_id

    union
    select pg_catalog.timezone('Asia/Tokyo', c.created_at)::date
      from public.novel_comments c
      join public.novels n on n.id = c.novel_id
     where c.user_id = p_user_id
       and c.deleted_at is null
       and c.author_hidden_at is null
       and n.user_id <> p_user_id
    union
    select pg_catalog.timezone('Asia/Tokyo', s.seeded_at)::date
      from public.light_seeds s
     where s.reader_id = p_user_id
  ) a
  where a.activity_day is not null;

  select t.cumulative_xp::bigint into v_cap
    from public.scout_level_thresholds t where t.level = 30;

  select least(coalesce(sum(x.xp_value), 0)::bigint, coalesce(v_cap, 0))
    into v_xp
    from public.scout_xp_ledger x
   where x.user_id = p_user_id;

  v_level := public.novelight_scout_level_for_xp(greatest(v_xp, 0));

  select coalesce(sum(p.point_value) filter (
           where p.status = 'confirmed' and p.point_value > 0
         ), 0)::bigint
    into v_point_earned
    from public.scout_point_ledger p
   where p.user_id = p_user_id;

  return pg_catalog.jsonb_build_object(
    'valid_read_work_count', v_read,
    'rating_work_count', v_rating,
    'comment_work_count', v_comment,
    'seed_count', v_seed,
    'gold_seed_count', v_gold,
    'silver_seed_count', v_silver,
    'bronze_seed_count', v_bronze,
    'discovery_plus2_count', v_plus2,
    'discovery_plus3_count', v_plus3,
    'discovery_plus4_count', v_plus4,
    'discovery_plus5_count', v_plus5,
    'nova_prediction_count', v_nova,
    'gold_plus5_count', v_gold_plus5,
    'silver_plus5_count', v_silver_plus5,
    'bronze_plus5_count', v_bronze_plus5,
    'new_author_read_count', v_new_author,
    'new_work_read_count', v_new_work,
    'low_rank_read_count', v_low_rank,
    'genre_count', v_genres,
    'qualified_long_read_count', v_long_read,
    'qualified_short_read_count', v_short_read,
    'completed_read_count', v_completed_read,
    'active_day_count', v_active_days,
    'scout_level', v_level,
    'scout_point_earned_total', v_point_earned
  );
end
$function$;

update public.scout_badge_definitions
   set enabled=false, updated_at=now()
 where badge_id in (
  'reader_rating_001','reader_rating_005','reader_rating_010',
  'reader_rating_025','reader_rating_050','reader_rating_100'
 );
 
-- Removed author/reader star-rating API. Nothing is deleted from earned
-- discovery history; the removed star-rating table must be empty.
drop function if exists public.set_novel_star_rating(text,integer) restrict;
drop function if exists public.clear_novel_star_rating(text) restrict;
drop function if exists public.novelight_star_rating_status(text) restrict;
drop function if exists public.novelight_global_rating_baseline() restrict;
drop function if exists public.novelight_bayesian_rating_average(bigint,numeric,numeric) restrict;
drop function if exists public.novelight_rank_absolute_ceiling_v2(bigint,bigint,bigint,numeric) restrict;
drop function if exists public.novelight_rank_internal_score_v2(double precision,double precision,double precision,double precision) restrict;
alter table public.novel_rank_state
 drop column if exists last_rating_count,
 drop column if exists last_rating_average;
drop table public.novel_star_ratings restrict;

-- pg_cron performs an authoritative evaluation every hour at minute 15 UTC.
-- Cron history is available in cron.job_run_details; each evaluated
-- state writes last_evaluated_at, last_internal_score and signal snapshots.
-- Production has pg_cron. Plain PostgreSQL test replays may not.
-- Never weaken production verification: postcheck requires an active job.
do $scheduler$
begin
 if to_regclass('cron.job') is null then
   raise notice 'No pg_cron in local database; skip schedule for offline replay';
 else
   execute $schedule$
     select cron.schedule(
       'novelight-recalculate-work-ranks',
       '15 * * * *',
       'select public.novelight_recalculate_work_ranks();'
     )
   $schedule$;
 end if;
end;
$scheduler$;

-- Smoke checks use immutable helper functions only; do NOT perform an
-- early global rank update in a migration, which could emit SCOUT rewards.
do $smoke$
begin
 if public.novelight_rank_absolute_ceiling_v3(49,2) <> 1
 or public.novelight_rank_absolute_ceiling_v3(50,2) <> 2
 or public.novelight_rank_absolute_ceiling_v3(200,8) <> 3
 or public.novelight_rank_absolute_ceiling_v3(10000,300) <> 6
 or abs(public.novelight_rank_internal_score_v3(100,100)-100) > 0.000001
 or abs(public.novelight_rank_internal_score_v3(0,0)) > 0.000001 then
   raise exception 'Starless rank calculator regression check failed';
 end if;
end;
$smoke$;
commit;
