-- Ranking tabs should not assign ordinal places to works with no signal for the selected metric.
-- New-arrivals remains a chronological feed and therefore keeps zero-signal published works.
-- security-definer-review: public.novelight_ranking_feed_v2

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260928112500'));

create or replace function public.novelight_ranking_feed_v2(
  p_sort text default 'total',
  p_limit integer default 100
)
returns table (
  novel_id text,
  title text,
  genre text,
  description text,
  created_at timestamptz,
  valid_read_count bigint,
  favorite_count bigint,
  score bigint
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with candidates as (
    select
      n.id::text as novel_id,
      n.title,
      n.genre,
      n.description,
      n.created_at,
      (
        select count(distinct vr.reader_id)::bigint
        from public.valid_read_events vr
        where vr.novel_id_snapshot = n.id::text
          and vr.foreground_signal
          and (vr.progress_signal or vr.interaction_signal)
      ) as valid_read_count,
      (
        select count(*)::bigint
        from public.favorites f
        where f.novel_id::text = n.id::text
          and f.user_id <> n.user_id
      ) as favorite_count
    from public.novels n
    where n.status = 'published'
      and public.novelight_is_general_discovery_eligible(n.ai_usage, n.content_rating)
  )
  select
    c.novel_id,
    c.title,
    c.genre,
    c.description,
    c.created_at,
    c.valid_read_count,
    c.favorite_count,
    (c.valid_read_count + c.favorite_count * 10)::bigint as score
  from candidates c
  where case
    when p_sort = 'new' then true
    when p_sort in ('reads', 'pv') then c.valid_read_count > 0
    when p_sort = 'favorites' then c.favorite_count > 0
    else (c.valid_read_count + c.favorite_count * 10) > 0
  end
  order by
    case when p_sort = 'new' then c.created_at end desc nulls last,
    case when p_sort in ('reads', 'pv') then c.valid_read_count end desc nulls last,
    case when p_sort = 'favorites' then c.favorite_count end desc nulls last,
    case when p_sort not in ('new', 'reads', 'pv', 'favorites')
      then (c.valid_read_count + c.favorite_count * 10) end desc nulls last,
    c.created_at desc,
    c.novel_id asc
  limit least(greatest(coalesce(p_limit, 100), 1), 100)
$$;

revoke all on function public.novelight_ranking_feed_v2(text, integer)
  from public;
grant execute on function public.novelight_ranking_feed_v2(text, integer)
  to anon, authenticated;

commit;
