-- Public discovery card facts, bounded to 100 already-published eligible works.
-- Author names and completion states are already public; never expose episode text.
begin;

create or replace function public.novelight_public_discovery_card_state(
  p_novel_ids bigint[]
)
returns table (
  novel_id text,
  author_name text,
  is_completed boolean,
  published_episode_count bigint,
  latest_published_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with requested as materialized (
    select distinct requested_id
    from unnest(coalesce(p_novel_ids, '{}'::bigint[])) as ids(requested_id)
    where requested_id > 0
    limit 100
  ), visible as materialized (
    select n.id, n.user_id
    from requested r
    join public.novels n on n.id = r.requested_id
    where n.status = 'published'
      and public.novelight_is_general_discovery_eligible(
        n.ai_usage, n.content_rating
      )
  ), published_episodes as (
    select
      e.novel_id,
      count(*)::bigint as episode_count,
      max(coalesce(e.first_published_at, e.created_at))
        as last_episode_published
    from visible v
    join public.episodes e on e.novel_id = v.id
    where e.status = 'published'
      and (
        e.scheduled_publish_at is null
        or e.scheduled_publish_at <= now()
      )
    group by e.novel_id
  )
  select
    v.id::text,
    coalesce(nullif(btrim(p.display_name), ''), '')::text,
    coalesce(s.is_completed, false),
    coalesce(e.episode_count, 0)::bigint,
    e.last_episode_published
  from visible v
  left join public.profiles p on p.id = v.user_id
  left join public.novel_rank_state s on s.novel_id_snapshot = v.id::text
  left join published_episodes e on e.novel_id = v.id
$$;

revoke all on function
  public.novelight_public_discovery_card_state(bigint[])
  from public, anon, authenticated;
grant execute on function
  public.novelight_public_discovery_card_state(bigint[])
  to anon, authenticated;
comment on function
  public.novelight_public_discovery_card_state(bigint[])
  is 'Public discovery-card author, completion, published-episode count, and last episode publication date for at most 100 eligible published novels. Uses episode created_at only when first_published_at is absent.';

commit;
