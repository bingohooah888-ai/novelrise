-- November contest stage 05 prelaunch: respect general / AI / R18 discovery zones.
-- DO NOT CHANGE participation eligibility or activate the contest.
-- Readers can hide R15 without fetching hidden rows or breaking pagination.
-- Legacy public catalog remains callable by the homepage but inherits zoning.
begin;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtext('novelight:20261012133000:contest-safe-catalog')
);

create or replace function public.novelight_public_contest_catalog_filtered(
  p_limit integer default 24,
  p_offset integer default 0,
  p_include_r15 boolean default true
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
begin
  if p_limit is null or p_limit not between 1 and 48
     or p_offset is null or p_offset not between 0 and 10000
     or p_include_r15 is null then
    raise exception using errcode = '22023',
      message = 'Invalid contest catalog pagination or rating preference';
  end if;

  select * into v_contest
    from public.novelight_contests
   where contest_key = 'novelight-november-2026';

  if not found or v_contest.public_visible is not true
     or v_contest.status not in ('registration','active','review','finalized') then
    return pg_catalog.jsonb_build_object(
      'ok', false, 'reason', 'contest_unavailable'
    );
  end if;

  -- Consistent eligibility across total and page:
  --   general discovery: general & R15, human / AI-assisted.
  --   NEVER return R18 works or AI-generated-zone works on this endpoint.
  --   This restriction concerns the listing, NOT competition eligibility.
  with eligible as materialized (
    select
      e.id as entry_id, e.novel_id, e.entered_at,
      n.title, n.genre, n.content_rating,
      (
        select pg_catalog.count(*)::integer
          from public.episodes ep
         where ep.novel_id = n.id
           and ep.status = 'published'
      ) as published_count
    from public.novelight_contest_entries e
    join public.novels n on n.id = e.novel_id
    where e.contest_id = v_contest.id
      and e.status = 'entered'
      and n.status = 'published'
      and n.content_rating in ('general','sensitive_15','mature')
      and n.ai_usage in ('human','ai_assisted')
      and (
        p_include_r15
        or n.content_rating = 'general'
      )
  ),
  visible as materialized (
    select * from eligible
    where published_count >= v_contest.minimum_published_episodes
  ),
  page as (
    select * from visible
    order by entered_at desc, entry_id desc
    limit p_limit offset p_offset
  )
  select
    (select pg_catalog.count(*)::bigint from visible),
    coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'novel_id', p.novel_id,
            'title', p.title,
            'genre', p.genre,
            'content_rating', p.content_rating,
            'published_episodes', p.published_count,
            'entered_at', p.entered_at
          )
          order by p.entered_at desc, p.entry_id desc
        )
        from page p
      ),
      '[]'::jsonb
    )
  into v_total, v_results;

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

revoke all on function
  public.novelight_public_contest_catalog_filtered(integer,integer,boolean)
  from public, anon, authenticated;

grant execute on function
  public.novelight_public_contest_catalog_filtered(integer,integer,boolean)
  to anon, authenticated;

-- Preserve current caller signature and redirect all callers through the
-- fail-closed general-zone implementation. Do not leave a legacy R18 path.
create or replace function public.novelight_public_contest_catalog(
  p_limit integer default 24,
  p_offset integer default 0
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.novelight_public_contest_catalog_filtered(
    p_limit, p_offset, true
  );
$$;

revoke all on function public.novelight_public_contest_catalog(integer,integer)
  from public, anon, authenticated;

grant execute on function public.novelight_public_contest_catalog(integer,integer)
  to anon, authenticated;

comment on function
  public.novelight_public_contest_catalog_filtered(integer,integer,boolean)
is 'General-zone only; respect R15 preference, do not include AI / R18 zone works. Does not decide who may enter the competition.';

commit;
