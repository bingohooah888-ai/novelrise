-- NOVELIGHT SCOUT XP daily 40 rule alignment.
--
-- Canonical daily activity buckets after this migration:
-- - valid read (work):    2 XP x 5 works    = 10 XP/day
-- - valid read (episode): 1 XP x 15 episodes = 15 XP/day
-- - valid comment:        5 XP x 3 works    = 15 XP/day
--
-- Historical XP already awarded under earlier beta rules is preserved for audit
-- and user continuity. The new episode bucket is prospective; historical valid
-- reads are not backfilled.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20261005153000'));

do $$
begin
  if to_regclass('public.scout_event_ledger') is null
     or to_regclass('public.scout_xp_ledger') is null
     or to_regclass('public.scout_reward_campaigns') is null then
    raise exception 'SCOUT foundations and campaign schema are required';
  end if;

  if to_regprocedure('public.novelight_award_valid_read_scout_xp()') is null then
    raise exception 'valid-read SCOUT XP runtime is required';
  end if;

  if to_regprocedure('public.set_novel_star_rating(text,integer)') is null then
    raise exception 'star-rating runtime is required';
  end if;
end
$$;

-- One valid-read event can satisfy both the work-level and episode-level rules.
-- Each bucket has its own lifetime uniqueness and JST daily cap.
create or replace function public.novelight_award_valid_read_scout_xp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := pg_catalog.timezone('Asia/Tokyo', new.occurred_at)::date;
  v_work_awarded_today integer := 0;
  v_episode_awarded_today integer := 0;
  v_work_already_awarded boolean := false;
  v_episode_already_awarded boolean := false;
begin
  if new.event_type <> 'valid_read'
     or new.user_id is null
     or new.novel_id_snapshot is null then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('novelight:valid-read-xp:' || new.user_id::text, 0)
  );

  select exists (
    select 1
    from public.scout_xp_ledger x
    join public.scout_event_ledger e on e.id = x.source_event_id
    where x.user_id = new.user_id
      and x.xp_kind = 'valid_read'
      and e.novel_id_snapshot = new.novel_id_snapshot
  ) into v_work_already_awarded;

  if not v_work_already_awarded then
    select count(*)::integer into v_work_awarded_today
    from public.scout_xp_ledger x
    where x.user_id = new.user_id
      and x.xp_kind = 'valid_read'
      and pg_catalog.timezone('Asia/Tokyo', x.occurred_at)::date = v_today;

    if v_work_awarded_today < 5 then
      insert into public.scout_xp_ledger (
        user_id, source_event_id, xp_kind, xp_value, rule_version, occurred_at
      ) values (
        new.user_id, new.id, 'valid_read', 2, 'chapter49-beta-v2', new.occurred_at
      )
      on conflict (user_id, source_event_id, xp_kind) do nothing;
    end if;
  end if;

  if new.episode_id_snapshot is not null then
    select exists (
      select 1
      from public.scout_xp_ledger x
      join public.scout_event_ledger e on e.id = x.source_event_id
      where x.user_id = new.user_id
        and x.xp_kind = 'valid_read_episode'
        and e.episode_id_snapshot = new.episode_id_snapshot
    ) into v_episode_already_awarded;

    if not v_episode_already_awarded then
      select count(*)::integer into v_episode_awarded_today
      from public.scout_xp_ledger x
      where x.user_id = new.user_id
        and x.xp_kind = 'valid_read_episode'
        and pg_catalog.timezone('Asia/Tokyo', x.occurred_at)::date = v_today;

      if v_episode_awarded_today < 15 then
        insert into public.scout_xp_ledger (
          user_id, source_event_id, xp_kind, xp_value, rule_version, occurred_at
        ) values (
          new.user_id, new.id, 'valid_read_episode', 1, 'chapter49-beta-v2', new.occurred_at
        )
        on conflict (user_id, source_event_id, xp_kind) do nothing;
      end if;
    end if;
  end if;

  return new;
end
$$;

revoke all on function public.novelight_award_valid_read_scout_xp()
  from public, anon, authenticated;

-- Star ratings remain valid product data, but no longer create Scout XP.
-- Existing star_rating ledger rows are intentionally left untouched.
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
  v_event_at timestamptz := pg_catalog.now();
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

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('novelight:star-rating:' || v_uid::text, 0)
  );

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
           updated_at = v_event_at
     where user_id = v_uid
       and novel_id_snapshot = p_novel_id;
    v_event_type := 'star_rating_changed';
  else
    insert into public.novel_star_ratings (
      user_id,
      novel_id_snapshot,
      author_id_snapshot,
      rating,
      first_rated_at,
      updated_at
    ) values (
      v_uid,
      p_novel_id,
      v_author_id,
      p_rating::smallint,
      v_event_at,
      v_event_at
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
    v_event_at,
    pg_catalog.jsonb_build_object(
      'old_rating', case when v_had_old then v_old_rating else null end,
      'new_rating', p_rating::smallint,
      'scout_xp_eligible', false,
      'rule_version', 'chapter49-beta-v2'
    )
  );

  return public.novelight_star_rating_status(p_novel_id);
end
$$;

revoke all on function public.set_novel_star_rating(text, integer) from public, anon;
grant execute on function public.set_novel_star_rating(text, integer) to authenticated;

-- The legacy column name describes the work-level valid-read bucket, so align
-- its stored cap with the canonical 10 XP work bucket.
update public.scout_reward_campaigns
set daily_valid_read_xp_cap = 10,
    updated_at = now()
where campaign_key = 'scout-lv10-bookcard-500';

create or replace function public.novelight_scout_campaign_progress(
  p_user_id uuid,
  p_campaign_key text default 'scout-lv10-bookcard-500'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign public.scout_reward_campaigns%rowtype;
  v_total_xp integer := 0;
  v_level integer := 1;
  v_rank_tier integer := 1;
  v_level_floor integer := 0;
  v_next_level_xp integer := 0;
  v_next_rank_level integer := null;
  v_next_rank_xp integer := null;
  v_target_xp integer := 0;
  v_today_valid_read_xp integer := 0;
  v_today_valid_read_episode_xp integer := 0;
  v_today_comment_xp integer := 0;
  v_qualified_at timestamptz := null;
begin
  if p_user_id is null then raise exception 'user_id is required'; end if;

  select * into v_campaign
  from public.scout_reward_campaigns
  where campaign_key = p_campaign_key;
  if not found then raise exception 'campaign not found'; end if;

  select coalesce(sum(x.xp_value), 0)::integer
  into v_total_xp
  from public.scout_xp_ledger x
  where x.user_id = p_user_id
    and x.xp_kind <> 'light_seed_discovery';

  v_level := public.novelight_scout_level_for_xp(v_total_xp);
  v_rank_tier := least(3, ((v_level - 1) / 10) + 1)::integer;

  select t.cumulative_xp into v_level_floor
  from public.scout_level_thresholds t
  where t.level = v_level;

  select t.cumulative_xp into v_next_level_xp
  from public.scout_level_thresholds t
  where t.level = least(30, v_level + 1);

  if v_rank_tier < 3 then
    v_next_rank_level := (v_rank_tier * 10) + 1;
    select t.cumulative_xp into v_next_rank_xp
    from public.scout_level_thresholds t
    where t.level = v_next_rank_level;
  end if;

  select t.cumulative_xp into v_target_xp
  from public.scout_level_thresholds t
  where t.level = v_campaign.target_level;

  select
    coalesce(sum(x.xp_value) filter (where x.xp_kind = 'valid_read'), 0)::integer,
    coalesce(sum(x.xp_value) filter (where x.xp_kind = 'valid_read_episode'), 0)::integer,
    coalesce(sum(x.xp_value) filter (where x.xp_kind = 'comment'), 0)::integer
  into v_today_valid_read_xp, v_today_valid_read_episode_xp, v_today_comment_xp
  from public.scout_xp_ledger x
  where x.user_id = p_user_id
    and pg_catalog.timezone('Asia/Tokyo', x.occurred_at)::date
        = pg_catalog.timezone('Asia/Tokyo', pg_catalog.now())::date;

  with ordered_xp as (
    select
      x.id,
      x.occurred_at,
      sum(x.xp_value) over (
        order by x.occurred_at, x.id
        rows between unbounded preceding and current row
      ) as running_xp
    from public.scout_xp_ledger x
    where x.user_id = p_user_id
      and x.xp_kind <> 'light_seed_discovery'
  )
  select o.occurred_at into v_qualified_at
  from ordered_xp o
  where o.running_xp >= v_target_xp
  order by o.occurred_at, o.id
  limit 1;

  return jsonb_build_object(
    'total_xp', v_total_xp,
    'level', v_level,
    'rank_tier', v_rank_tier,
    'level_floor_xp', coalesce(v_level_floor, 0),
    'next_level_xp', coalesce(v_next_level_xp, v_total_xp),
    'xp_for_next_level', greatest(0, coalesce(v_next_level_xp, v_total_xp) - v_total_xp),
    'next_rank_level', v_next_rank_level,
    'next_rank_xp', v_next_rank_xp,
    'xp_for_next_rank', case when v_next_rank_xp is null then 0 else greatest(0, v_next_rank_xp - v_total_xp) end,
    'target_level', v_campaign.target_level,
    'target_level_xp', v_target_xp,
    'xp_to_target', greatest(0, v_target_xp - v_total_xp),
    'qualified_at', v_qualified_at,
    'today_valid_read_xp', v_today_valid_read_xp,
    'today_valid_read_xp_cap', 10,
    'today_valid_read_xp_remaining', greatest(0, 10 - v_today_valid_read_xp),
    'today_valid_read_episode_xp', v_today_valid_read_episode_xp,
    'today_valid_read_episode_xp_cap', 15,
    'today_valid_read_episode_xp_remaining', greatest(0, 15 - v_today_valid_read_episode_xp),
    'today_comment_xp', v_today_comment_xp,
    'today_comment_xp_cap', 15,
    'today_comment_xp_remaining', greatest(0, 15 - v_today_comment_xp),
    'today_activity_xp', v_today_valid_read_xp + v_today_valid_read_episode_xp + v_today_comment_xp,
    'today_activity_xp_cap', 40
  );
end;
$$;

revoke all on function public.novelight_scout_campaign_progress(uuid,text) from public, anon, authenticated;
grant execute on function public.novelight_scout_campaign_progress(uuid,text) to service_role;

commit;
