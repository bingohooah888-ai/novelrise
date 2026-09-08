begin;

create or replace function public.novelight_light_seed_feed(
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
  author_id uuid,
  author_name text,
  thumbnail_url text,
  status text,
  favorite_count bigint,
  light_seed_count bigint
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with seed_totals as (
    select
      seed.novel_id_snapshot,
      count(*)::bigint as light_seed_count
    from public.light_seeds as seed
    group by seed.novel_id_snapshot
    having count(*) > 0
  ),
  favorite_totals as (
    select
      favorite.novel_id::text as novel_id,
      count(*)::bigint as favorite_count
    from public.favorites as favorite
    group by favorite.novel_id::text
  )
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
    seeds.light_seed_count
  from public.novels as novel
  join seed_totals as seeds
    on seeds.novel_id_snapshot = novel.id::text
  left join public.profiles as profile
    on profile.id = novel.user_id
  left join favorite_totals as favorites
    on favorites.novel_id = novel.id::text
  where novel.status = 'published'
  order by
    novel.created_at desc,
    novel.id::text asc
  limit least(greatest(coalesce(p_limit, 24), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.novelight_light_seed_feed(integer, integer) from public;
grant execute on function public.novelight_light_seed_feed(integer, integer) to anon, authenticated;

commit;
