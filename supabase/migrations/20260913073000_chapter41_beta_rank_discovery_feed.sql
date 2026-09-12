-- NOVELIGHT Chapter 41 beta home discovery shelves.
--
-- Work Rank remains private during beta. This public RPC uses the private
-- novel_rank_state only as an internal eligibility filter and returns ordinary
-- public work-card fields. It deliberately returns no Rank, Rank code, score,
-- candidate Rank, SCOUT EXP, Level, badge, or other hidden progression value.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260913073000'));

create or replace function public.novelight_beta_rank_discovery_feed(
  p_group text,
  p_limit integer default 12,
  p_rotation_key text default null
)
returns table (
  novel_id text,
  title text,
  genre text,
  description text,
  created_at timestamptz,
  pv bigint,
  author_id uuid,
  author_name text,
  thumbnail_url text,
  status text,
  favorite_count bigint
)
language sql
stable
security definer
set search_path = pg_catalog
as $$
  with favorite_totals as (
    select
      favorite.novel_id::text as novel_id,
      count(*)::bigint as favorite_count
    from public.favorites as favorite
    group by favorite.novel_id::text
  ),
  candidates as (
    select
      novel.id::text as novel_id,
      novel.title,
      novel.genre,
      novel.description,
      novel.created_at,
      coalesce(novel.pv, 0)::bigint as pv,
      novel.user_id as author_id,
      coalesce(profile.display_name, '')::text as author_name,
      novel.thumbnail_url,
      novel.status::text as status,
      coalesce(favorites.favorite_count, 0)::bigint as favorite_count,
      pg_catalog.md5(
        novel.id::text || ':' || pg_catalog.left(coalesce(p_rotation_key, ''), 128)
      ) as rotation_key
    from public.novels as novel
    join public.novel_rank_state as rank_state
      on rank_state.novel_id_snapshot = novel.id::text
    left join public.profiles as profile
      on profile.id = novel.user_id
    left join favorite_totals as favorites
      on favorites.novel_id = novel.id::text
    where novel.status = 'published'
      and (
        (
          pg_catalog.btrim(coalesce(p_group, '')) = 'unseen'
          and rank_state.current_rank between 1 and 2
        )
        or (
          pg_catalog.btrim(coalesce(p_group, '')) = 'gathering'
          and rank_state.current_rank between 3 and 4
        )
      )
  )
  select
    candidate.novel_id,
    candidate.title,
    candidate.genre,
    candidate.description,
    candidate.created_at,
    candidate.pv,
    candidate.author_id,
    candidate.author_name,
    candidate.thumbnail_url,
    candidate.status,
    candidate.favorite_count
  from candidates as candidate
  order by
    candidate.rotation_key asc,
    candidate.created_at desc,
    candidate.novel_id asc
  limit least(greatest(coalesce(p_limit, 12), 1), 24);
$$;

revoke all on function public.novelight_beta_rank_discovery_feed(text, integer, text)
  from public;
grant execute on function public.novelight_beta_rank_discovery_feed(text, integer, text)
  to anon, authenticated;

commit;
