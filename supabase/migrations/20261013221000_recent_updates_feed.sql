-- Order the new-arrivals surfaces by the latest actually published episode.
-- Keep novelight_neutral_search('new') unchanged for all other search clients.
-- Only public, general-discovery-eligible novels and due published episodes
-- contribute to the ordering. No draft content or author-only metadata is exposed.
begin;

create or replace function public.novelight_recent_updates_feed(
  p_limit integer default 24,
  p_offset integer default 0
)
returns table (
  novel_id text,
  title text,
  genre text,
  description text,
  created_at timestamptz,
  pv bigint,
  favorite_count bigint,
  total_count bigint
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with candidates as materialized (
    select
      n.id::text as novel_id,
      n.title,
      n.genre,
      n.description,
      n.created_at,
      coalesce(n.pv, 0)::bigint as pv,
      (
        select count(*)::bigint
        from public.favorites f
        where f.novel_id::text = n.id::text
          and f.user_id <> n.user_id
      ) as favorite_count,
      coalesce(
        (
          select max(coalesce(e.first_published_at, e.created_at))
          from public.episodes e
          where e.novel_id = n.id
            and e.status = 'published'
            and (
              e.scheduled_publish_at is null
              or e.scheduled_publish_at <= now()
            )
        ),
        public.novelight_effective_publication_at(
          n.created_at, n.first_published_at
        )
      ) as last_published_at
    from public.novels n
    where n.status = 'published'
      and public.novelight_is_general_discovery_eligible(
        n.ai_usage, n.content_rating
      )
  ), counted as (
    select c.*, count(*) over ()::bigint as total_count
    from candidates c
  )
  select
    c.novel_id,
    c.title,
    c.genre,
    c.description,
    c.created_at,
    c.pv,
    c.favorite_count,
    c.total_count
  from counted c
  order by
    c.last_published_at desc,
    c.created_at desc,
    c.novel_id asc
  limit least(greatest(coalesce(p_limit, 24), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0)
$$;

revoke all on function public.novelight_recent_updates_feed(integer, integer)
  from public, anon, authenticated;
grant execute on function public.novelight_recent_updates_feed(integer, integer)
  to anon, authenticated;

comment on function public.novelight_recent_updates_feed(integer, integer)
  is 'Published general-discovery works ordered by their last due published episode, matching public discovery card dates; initial publication is a fallback for works with no published episode.';

commit;
