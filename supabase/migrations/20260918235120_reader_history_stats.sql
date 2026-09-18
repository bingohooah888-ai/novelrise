-- NOVELIGHT competitor audit #17: private reader history and personal reading stats.
--
-- Reuse existing valid_read_events as the Source of Truth. This feature adds no
-- second reading tracker and must never feed Rank, LIGHT SEED, SCOUT EXP,
-- discovery, exposure, favorites, or author analytics.
begin;

select pg_advisory_xact_lock(hashtext('novelight:20260918235120'));

do $$
begin
  if to_regclass('public.valid_read_events') is null
     or to_regclass('public.reader_reading_progress') is null
     or to_regclass('public.reader_bookshelf_entries') is null
     or to_regclass('public.novels') is null
     or to_regclass('public.episodes') is null then
    raise exception 'B #17 requires existing reader history foundations';
  end if;

  if to_regprocedure('public.novelight_reader_history_stats(integer)') is not null then
    raise exception 'B #17 reader history RPC already exists';
  end if;
end
$$;

create or replace function public.novelight_reader_history_stats(
  p_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_summary jsonb;
  v_genres jsonb;
  v_history jsonb;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  select pg_catalog.jsonb_build_object(
    'valid_read_episode_count',
      (
        select count(*)::bigint
          from public.valid_read_events v
         where v.reader_id = v_uid
      ),
    'valid_read_work_count',
      (
        select count(distinct v.novel_id_snapshot)::bigint
          from public.valid_read_events v
         where v.reader_id = v_uid
      ),
    'first_valid_read_day_count',
      (
        select count(
          distinct (pg_catalog.timezone('Asia/Tokyo', v.qualified_at))::date
        )::bigint
          from public.valid_read_events v
         where v.reader_id = v_uid
      ),
    'completed_marked_work_count',
      (
        select count(*)::bigint
          from public.reader_bookshelf_entries b
         where b.user_id = v_uid
           and b.reading_state = 'completed'
      )
  )
    into v_summary;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'genre', g.genre,
        'work_count', g.work_count
      )
      order by g.work_count desc, g.genre
    ),
    '[]'::jsonb
  )
    into v_genres
    from (
      select
        n.genre,
        count(*)::bigint as work_count
        from (
          select distinct v.novel_id_snapshot
            from public.valid_read_events v
           where v.reader_id = v_uid
        ) r
        join public.novels n
          on n.id::text = r.novel_id_snapshot
         and n.status = 'published'
       where n.genre is not null
         and pg_catalog.btrim(n.genre) <> ''
       group by n.genre
       order by count(*) desc, n.genre
       limit 8
    ) g;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'novel_id', h.novel_id,
        'novel_title', h.novel_title,
        'genre', h.genre,
        'episode_id', h.episode_id,
        'episode_number', h.episode_number,
        'episode_title', h.episode_title,
        'first_valid_read_at', h.qualified_at
      )
      order by h.qualified_at desc, h.event_id desc
    ),
    '[]'::jsonb
  )
    into v_history
    from (
      select
        v.id as event_id,
        n.id::text as novel_id,
        n.title as novel_title,
        n.genre,
        e.id::text as episode_id,
        e.episode_number,
        e.title as episode_title,
        v.qualified_at
        from public.valid_read_events v
        join public.novels n
          on n.id::text = v.novel_id_snapshot
         and n.status = 'published'
        join public.episodes e
          on e.id::text = v.episode_id_snapshot
         and e.novel_id = n.id
         and e.status = 'published'
       where v.reader_id = v_uid
       order by v.qualified_at desc, v.id desc
       limit v_limit
    ) h;

  return pg_catalog.jsonb_build_object(
    'summary', v_summary,
    'genres', v_genres,
    'history', v_history,
    'semantics',
      pg_catalog.jsonb_build_object(
        'history_kind', 'first_valid_read_per_episode',
        'timezone', 'Asia/Tokyo',
        'public_profile', false
      )
  );
end
$$;

revoke all on function public.novelight_reader_history_stats(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.novelight_reader_history_stats(integer)
  to authenticated;

comment on function public.novelight_reader_history_stats(integer) is
  'B #17 private reader-only aggregation over existing valid-read and bookshelf data. No new tracking and no evaluation, Rank, SCOUT, discovery, exposure, or author analytics effect.';

commit;
