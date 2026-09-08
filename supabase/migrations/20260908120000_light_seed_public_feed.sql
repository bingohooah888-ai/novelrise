begin;

create or replace function public.novelight_light_seed_feed(
  p_limit integer default 24,
  p_offset integer default 0
)
returns table (
  id bigint,
  title text,
  genre text,
  pv bigint,
  created_at timestamptz,
  published_at timestamptz,
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
set search_path = pg_catalog, public, pg_temp
as $$
  with seed_totals as (
    select
      ledger.novel_id,
      sum(ledger.delta)::bigint as light_seed_count
    from public.light_seed_ledger as ledger
    group by ledger.novel_id
    having sum(ledger.delta) > 0
  ),
  favorite_totals as (
    select
      favorite.novel_id,
      count(*)::bigint as favorite_count
    from public.favorites as favorite
    group by favorite.novel_id
  )
  select
    novel.id,
    novel.title,
    novel.genre,
    coalesce(novel.pv, 0)::bigint as pv,
    novel.created_at,
    coalesce(novel.first_published_at, novel.created_at) as published_at,
    novel.author_id,
    coalesce(profile.display_name, '')::text as author_name,
    novel.thumbnail_url,
    novel.status::text as status,
    coalesce(favorites.favorite_count, 0)::bigint as favorite_count,
    seeds.light_seed_count
  from public.novels as novel
  join seed_totals as seeds
    on seeds.novel_id = novel.id
  left join public.profiles as profile
    on profile.id = novel.author_id
  left join favorite_totals as favorites
    on favorites.novel_id = novel.id
  where novel.status = 'published'
  order by
    coalesce(novel.first_published_at, novel.created_at) desc,
    novel.id desc
  limit least(greatest(coalesce(p_limit, 24), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.novelight_light_seed_feed(integer, integer) from public;
grant execute on function public.novelight_light_seed_feed(integer, integer) to anon, authenticated;

commit;
