begin;

select pg_advisory_xact_lock(hashtext('novelight:20261022010000'));

-- FIX: Use first publication time, never initial draft creation time, as the
-- source of truth for new published-episode activity.
-- Legacy rows can use their authoritative author-follow publication event.
-- Do not update episodes or fabricate historical publication timestamps:
-- modifying historical episodes would also fire updated_at triggers.
-- For the remaining legacy records only, retain "episode_added" and
-- their known creation timestamp rather than claiming a publication date.
create or replace function public.novelight_author_recent_activity_v1(
  p_days integer default 30,
  p_limit integer default 10
)
returns table (
  activity_type text,
  occurred_at timestamptz,
  novel_id text,
  novel_title text,
  episode_number bigint
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  if p_days is null or p_days < 1 or p_days > 90 then
    raise exception using errcode = '22023', message = 'Activity window must be between 1 and 90 days';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 30 then
    raise exception using errcode = '22023', message = 'Activity limit must be between 1 and 30';
  end if;

  return query
  with owned_novels as materialized (
    select n.id::text as novel_id, coalesce(nullif(trim(n.title), ''), 'タイトル未設定')::text as title
      from public.novels n
     where n.user_id = v_uid
  ),
  novel_published as (
    select
      'novel_published'::text as activity_type,
      n.first_published_at as occurred_at,
      n.id::text as novel_id,
      coalesce(nullif(trim(n.title), ''), 'タイトル未設定')::text as novel_title,
      null::bigint as episode_number
      from public.novels n
     where n.user_id = v_uid
       and n.first_published_at is not null
       and n.first_published_at >= now() - make_interval(days => p_days)
  ),
  episode_publication as (
    select
      -- The original creation date is not necessarily the publication date.
      -- Older records may have an authoritative episode_published event even
      -- when first_published_at was not recorded at the time.
      case
        when e.first_published_at is not null or fe.occurred_at is not null
          then 'episode_published'::text
        else 'episode_added'::text
      end as activity_type,
      coalesce(e.first_published_at, fe.occurred_at, e.created_at) as occurred_at,
      e.novel_id::text as novel_id,
      o.title as novel_title,
      e.episode_number::bigint as episode_number
      from public.episodes e
      join owned_novels o on o.novel_id = e.novel_id::text
      left join public.author_follow_events fe
        on fe.episode_id = e.id
       and fe.author_user_id = v_uid
       and fe.event_type = 'episode_published'
     where e.user_id = v_uid
       and e.status = 'published'
       and coalesce(e.first_published_at, fe.occurred_at, e.created_at)
           >= now() - make_interval(days => p_days)
  ),
  seeds_received as (
    select
      'light_seed_received'::text,
      s.seeded_at,
      s.novel_id_snapshot,
      coalesce(o.title, '削除済み作品')::text,
      null::bigint
      from public.light_seeds s
      left join owned_novels o on o.novel_id = s.novel_id_snapshot
     where s.author_id_snapshot = v_uid
       and s.seeded_at >= now() - make_interval(days => p_days)
  ),
  favorites_received as (
    select
      'favorite_added'::text,
      c.converted_at,
      c.novel_id_snapshot,
      coalesce(o.title, '削除済み作品')::text,
      null::bigint
      from public.novel_exposure_conversions c
      left join owned_novels o on o.novel_id = c.novel_id_snapshot
     where c.author_id_snapshot = v_uid
       and c.event_type = 'favorite_added'
       and c.converted_at >= now() - make_interval(days => p_days)
  ),
  first_episode_two_read as (
    select
      'first_episode_two_read'::text,
      min(c.converted_at) as occurred_at,
      c.novel_id_snapshot,
      coalesce(o.title, '削除済み作品')::text,
      2::bigint
      from public.novel_exposure_conversions c
      left join public.episodes ep on ep.id::text = c.episode_id_snapshot
      left join owned_novels o on o.novel_id = c.novel_id_snapshot
     where c.author_id_snapshot = v_uid
       and c.event_type = 'episode_read_10s'
       and coalesce(c.episode_number_snapshot, ep.episode_number) = 2
     group by c.novel_id_snapshot, o.title
    having min(c.converted_at) >= now() - make_interval(days => p_days)
  ),
  activity as (
    select * from novel_published
    union all select * from episode_publication
    union all select * from seeds_received
    union all select * from favorites_received
    union all select * from first_episode_two_read
  )
  select a.activity_type, a.occurred_at, a.novel_id, a.novel_title, a.episode_number
    from activity a
   where a.occurred_at is not null
   order by a.occurred_at desc
   limit p_limit;
end
$$;

revoke all on function public.novelight_author_recent_activity_v1(integer, integer) from public, anon;
grant execute on function public.novelight_author_recent_activity_v1(integer, integer) to authenticated;

commit;
