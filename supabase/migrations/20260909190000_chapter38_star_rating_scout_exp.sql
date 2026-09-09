-- NOVELIGHT Chapter 38 star-rating SCOUT EXP.
--
-- MASTER contract:
-- - a first lifetime star rating on a work is worth 3 XP
-- - at most 5 different works per user/JST day can award rating XP
-- - changing, removing, or re-rating the same work never awards additional XP
-- - rating itself remains available after the daily XP cap is reached
--
-- Raw star-rating history stays in scout_event_ledger. This migration derives
-- replayable XP from those events and keeps the browser API contract unchanged.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260909190000'));

do $$
begin
  if to_regclass('public.scout_event_ledger') is null
     or to_regclass('public.scout_xp_ledger') is null
     or to_regclass('public.novel_star_ratings') is null then
    raise exception 'Chapter 38 SCOUT and star-rating foundations are required';
  end if;

  if to_regprocedure('public.set_novel_star_rating(text,integer)') is null then
    raise exception 'Chapter 38 star-rating RPC is required';
  end if;

  if position(
    'novelight:star-rating-xp:' in
    pg_get_functiondef('public.set_novel_star_rating(text,integer)'::regprocedure)
  ) > 0 then
    raise exception 'Star-rating SCOUT EXP runtime is already installed';
  end if;

  if exists (
    select 1
      from public.scout_xp_ledger x
     where x.xp_kind = 'star_rating'
  ) then
    raise exception 'Existing star-rating SCOUT EXP requires manual reconciliation';
  end if;
end
$$;

-- Backfill deterministically from raw beta history. Only the first lifetime
-- star_rating_set event for each user/work is eligible, and only the first five
-- such works on each Asia/Tokyo calendar day receive XP.
with ranked_lifetime as (
  select
    e.id as source_event_id,
    e.user_id,
    e.novel_id_snapshot,
    e.occurred_at,
    row_number() over (
      partition by e.user_id, e.novel_id_snapshot
      order by e.occurred_at, e.id
    ) as lifetime_order
  from public.scout_event_ledger e
  where e.event_type = 'star_rating_set'
    and e.user_id is not null
    and e.novel_id_snapshot is not null
),
first_lifetime as (
  select
    source_event_id,
    user_id,
    novel_id_snapshot,
    occurred_at
  from ranked_lifetime
  where lifetime_order = 1
),
daily_ranked as (
  select
    f.*,
    row_number() over (
      partition by
        f.user_id,
        pg_catalog.timezone('Asia/Tokyo', f.occurred_at)::date
      order by f.occurred_at, f.source_event_id
    ) as daily_order
  from first_lifetime f
)
insert into public.scout_xp_ledger (
  user_id,
  source_event_id,
  xp_kind,
  xp_value,
  rule_version,
  occurred_at
)
select
  d.user_id,
  d.source_event_id,
  'star_rating',
  3,
  'beta-v1',
  d.occurred_at
from daily_ranked d
where d.daily_order <= 5
on conflict (user_id, source_event_id, xp_kind) do nothing;

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
  v_had_lifetime_set boolean := false;
  v_event_id uuid := pg_catalog.gen_random_uuid();
  v_event_type text;
  v_event_at timestamptz := pg_catalog.now();
  v_awarded_today integer := 0;
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

  -- Serialize one reader's rating actions so lifetime eligibility and the
  -- five-work daily cap cannot race across simultaneous requests.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('novelight:star-rating-xp:' || v_uid::text, 0)
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

  if not v_had_old then
    select exists (
      select 1
        from public.scout_event_ledger e
       where e.user_id = v_uid
         and e.novel_id_snapshot = p_novel_id
         and e.event_type = 'star_rating_set'
    ) into v_had_lifetime_set;
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
      'new_rating', p_rating::smallint
    )
  );

  if v_event_type = 'star_rating_set' and not v_had_lifetime_set then
    select count(*)::integer
      into v_awarded_today
      from public.scout_xp_ledger x
     where x.user_id = v_uid
       and x.xp_kind = 'star_rating'
       and pg_catalog.timezone('Asia/Tokyo', x.occurred_at)::date
           = pg_catalog.timezone('Asia/Tokyo', v_event_at)::date;

    if v_awarded_today < 5 then
      insert into public.scout_xp_ledger (
        user_id,
        source_event_id,
        xp_kind,
        xp_value,
        rule_version,
        occurred_at
      ) values (
        v_uid,
        v_event_id,
        'star_rating',
        3,
        'beta-v1',
        v_event_at
      )
      on conflict (user_id, source_event_id, xp_kind) do nothing;
    end if;
  end if;

  return public.novelight_star_rating_status(p_novel_id);
end
$$;

revoke all on function public.set_novel_star_rating(text, integer) from public, anon;
grant execute on function public.set_novel_star_rating(text, integer) to authenticated;

commit;
