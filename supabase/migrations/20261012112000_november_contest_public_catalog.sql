-- NOVELIGHT November contest step 04: public contest catalog, read only.
-- Previous step 02/03 private schema and author-only entry endpoints are required.
-- This public RPC returns ONLY already published, actively enrolled work cards.
-- It does not expose guest reader identities, payout records, or risk evidence.

begin;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtext('novelight:20261012112000:contest-public-catalog')
);

do $$
begin
  if to_regclass('public.novelight_contest_entries') is null then
    raise exception 'Contest entry foundation is missing';
  end if;
end
$$;

create or replace function public.novelight_public_contest_catalog(
  p_limit integer default 24,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_contest public.novelight_contests%rowtype;
  v_results jsonb := '[]'::jsonb;
  v_total bigint := 0;
  v_limit integer;
begin
  if p_limit is null or p_limit not between 1 and 48
     or p_offset is null or p_offset not between 0 and 10000 then
    raise exception using
      errcode = '22023',
      message = 'Invalid contest catalog pagination';
  end if;
  v_limit := p_limit;

  select * into v_contest
    from public.novelight_contests
   where contest_key = 'novelight-november-2026';

  if not found then
    return pg_catalog.jsonb_build_object(
      'ok', false, 'reason', 'contest_unavailable'
    );
  end if;

  -- A valid status alone must never make entries public.
  if v_contest.public_visible is not true
     or v_contest.status not in ('registration','active','review','finalized') then
    return pg_catalog.jsonb_build_object(
      'ok', false, 'reason', 'contest_unavailable'
    );
  end if;

  if v_contest.public_visible is true
     and v_contest.status in ('registration','active','review','finalized') then
    select pg_catalog.count(*)::bigint into v_total
    from public.novelight_contest_entries e
    join public.novels n on n.id = e.novel_id
    cross join lateral (
      select pg_catalog.count(*)::integer as published_count
      from public.episodes ep
      where ep.novel_id = n.id
        and ep.status = 'published'
    ) episodes
    where e.contest_id = v_contest.id
      and e.status = 'entered'
      and n.status = 'published'
      and episodes.published_count >= v_contest.minimum_published_episodes;

    select coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'novel_id', works.novel_id,
          'title', works.title,
          'genre', works.genre,
          'content_rating', works.content_rating,
          'published_episodes', works.published_count,
          'entered_at', works.entered_at
        )
        order by works.entered_at desc, works.entry_id desc
      ),
      '[]'::jsonb
    ) into v_results
    from (
      select
        e.id as entry_id,
        e.novel_id,
        e.entered_at,
        n.title,
        n.genre,
        n.content_rating,
        episodes.published_count
      from public.novelight_contest_entries e
      join public.novels n on n.id = e.novel_id
      cross join lateral (
        select pg_catalog.count(*)::integer as published_count
        from public.episodes ep
        where ep.novel_id = n.id
          and ep.status = 'published'
      ) episodes
      where e.contest_id = v_contest.id
        and e.status = 'entered'
        and n.status = 'published'
        and episodes.published_count >= v_contest.minimum_published_episodes
      order by e.entered_at desc, e.id desc
      limit v_limit offset p_offset
    ) works;
  end if;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'contest_status', v_contest.status,
    'starts_at', v_contest.starts_at,
    'ends_at', v_contest.ends_at,
    'entry_deadline_at', v_contest.entry_deadline_at,
    'minimum_published_episodes', v_contest.minimum_published_episodes,
    'total_entries', v_total,
    'entries', v_results
  );
end
$$;

revoke all on function public.novelight_public_contest_catalog(integer,integer)
  from public, anon, authenticated;

grant execute on function public.novelight_public_contest_catalog(integer,integer)
  to anon, authenticated;

comment on function public.novelight_public_contest_catalog(integer,integer) is
  'Read-only public contest listing: published works only, no author/reader private identifiers.';

commit;
