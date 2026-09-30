-- Read-only, bounded card enrichment shared by all search modes.
-- Existing rank lifecycle and tag tables remain the sources of truth.
begin;

create or replace function public.novelight_search_card_metadata(p_novel_ids bigint[])
returns table (
  novel_id text,
  author_name text,
  ai_usage text,
  content_rating text,
  is_completed boolean,
  published_episode_count bigint,
  published_character_count bigint,
  official_tag_names text[],
  custom_tag_names text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  with requested as materialized (
    select distinct id
    from unnest(coalesce(p_novel_ids, '{}'::bigint[])) as x(id)
    where id > 0
    limit 100
  ), visible as materialized (
    select n.id, n.user_id, n.ai_usage, n.content_rating
    from requested r
    join public.novels n on n.id = r.id
    where n.status = 'published'
  ), episode_totals as (
    select e.novel_id,
      count(*)::bigint as episode_count,
      coalesce(sum(pg_catalog.char_length(coalesce(e.content, ''))), 0)::bigint as character_count
    from visible v
    join public.episodes e on e.novel_id = v.id
    where e.status = 'published'
      and (e.scheduled_publish_at is null or e.scheduled_publish_at <= now())
    group by e.novel_id
  )
  select v.id::text,
    coalesce(nullif(p.display_name, ''), '未設定')::text,
    v.ai_usage::text,
    v.content_rating::text,
    coalesce(s.is_completed, false),
    coalesce(e.episode_count, 0)::bigint,
    coalesce(e.character_count, 0)::bigint,
    coalesce((
      select array_agg(t.display_name order by nt.position)
      from public.novel_official_tags nt
      join public.official_tags t on t.id = nt.tag_id and t.is_active
      where nt.novel_id = v.id
    ), '{}'::text[]),
    coalesce((
      select array_agg(ct.display_name order by ct.position)
      from public.novel_custom_tags ct
      where ct.novel_id = v.id
    ), '{}'::text[])
  from visible v
  left join public.profiles p on p.id = v.user_id
  left join public.novel_rank_state s on s.novel_id_snapshot = v.id::text
  left join episode_totals e on e.novel_id = v.id
$$;

revoke all on function public.novelight_search_card_metadata(bigint[]) from public, anon, authenticated;
grant execute on function public.novelight_search_card_metadata(bigint[]) to anon, authenticated;
comment on function public.novelight_search_card_metadata(bigint[]) is
  'Public search cards for at most 100 currently published novels. Published episode aggregates only; no private lifecycle, identity or body fields.';

commit;
