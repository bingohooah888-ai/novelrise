-- Public title discovery: remove read-progress masking for published episodes
-- and their chapter headings. Private works, drafts and scheduled/unpublished
-- episodes remain filtered at the existing public metadata RPC boundaries.
-- Reader progress, valid-read rewards, character future-info and comment spoiler
-- protections are deliberately untouched.
begin;

select pg_advisory_xact_lock(hashtext('novelight:20261016212500'));

do $precheck$
begin
  if to_regprocedure('public.novelight_reader_episode_index(text[])') is null
     or to_regprocedure('public.novelight_reader_episode_chapter_index(text[])') is null
     or to_regprocedure('public.novelight_followed_author_updates(integer)') is null
     or to_regprocedure('public.novelight_novel_outline(bigint)') is null then
    raise exception 'Required NOVELIGHT public metadata RPCs are missing';
  end if;
end
$precheck$;

-- Used by the reading continuity buttons, reader bookshelf and favorite updates.
-- Retain the input bound and published-novel + published-episode predicates.
create or replace function public.novelight_reader_episode_index(p_novel_ids text[])
returns table (
  novel_id text,
  episode_id text,
  episode_number bigint,
  episode_title text
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_novel_ids is null
     or cardinality(p_novel_ids) < 1
     or cardinality(p_novel_ids) > 50
     or cardinality(p_novel_ids) <>
       cardinality(array(select distinct x from unnest(p_novel_ids) as x)) then
    raise exception using errcode = '22023',
      message = 'Reader episode index requires 1 to 50 unique works';
  end if;

  return query
  select
    n.id::text as novel_id,
    e.id::text as episode_id,
    e.episode_number::bigint,
    e.title as episode_title
  from (select unnest(p_novel_ids) as novel_id) requested
  join public.novels n
    on n.id::text = requested.novel_id
   and n.status = 'published'
  join public.episodes e
    on e.novel_id = n.id
   and e.status = 'published'
  order by n.id::text, e.episode_number, e.id;
end
$function$;

revoke all on function public.novelight_reader_episode_index(text[])
  from public, anon, authenticated, service_role;
grant execute on function public.novelight_reader_episode_index(text[])
  to anon, authenticated;

comment on function public.novelight_reader_episode_index(text[]) is
  'Published works and episodes only; episode titles are public irrespective of valid-read progress.';

-- A chapter heading must not be masked when a public episode has no title.
-- Base episode index still restricts every row to published work and episode.
create or replace function public.novelight_reader_episode_chapter_index(p_novel_ids text[])
returns table (
  novel_id text,
  episode_id text,
  episode_number bigint,
  episode_title text,
  chapter_id bigint,
  chapter_title text
)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    idx.novel_id,
    idx.episode_id,
    idx.episode_number,
    idx.episode_title,
    c.id as chapter_id,
    c.title as chapter_title
  from public.novelight_reader_episode_index(p_novel_ids) as idx
  left join public.episodes as e
    on e.id::text = idx.episode_id
   and e.novel_id::text = idx.novel_id
   and e.status = 'published'
  left join public.novel_chapters as c
    on c.id = e.chapter_id
   and c.novel_id = e.novel_id
  order by idx.novel_id, idx.episode_number, idx.episode_id;
$function$;

revoke all on function public.novelight_reader_episode_chapter_index(text[])
  from public, anon, authenticated, service_role;
grant execute on function public.novelight_reader_episode_chapter_index(text[])
  to anon, authenticated, service_role;

comment on function public.novelight_reader_episode_chapter_index(text[]) is
  'Chapter headings for published episodes are public, including unread episodes.';

-- Follow-update notifications retain authentication, subscriptions, block/mute,
-- publication checks, pagination and existing response shape. Only title masking
-- based on valid_read_events is removed.
create or replace function public.novelight_followed_author_updates(p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_result jsonb;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  select coalesce(
    pg_catalog.jsonb_agg(q.item order by q.event_id desc),
    '[]'::jsonb
  )
    into v_result
    from (
      select
        e.id as event_id,
        pg_catalog.jsonb_build_object(
          'event_id', e.id::text,
          'event_type', e.event_type,
          'occurred_at', e.occurred_at,
          'author_user_id', e.author_user_id::text,
          'author_display_name', coalesce(p.display_name, '名前未設定'),
          'novel_id', n.id::text,
          'novel_title', coalesce(n.title, 'タイトル未設定'),
          'episode_id', case when ep.id is null then null else ep.id::text end,
          'episode_number', ep.episode_number,
          'episode_title', ep.title
        ) as item
      from public.author_follows f
      join public.author_follow_events e
        on e.author_user_id = f.author_user_id
      join public.profiles p
        on p.id = e.author_user_id
      join public.novels n
        on n.id = e.novel_id
       and n.user_id = e.author_user_id
       and n.status = 'published'
      left join public.episodes ep
        on ep.id = e.episode_id
       and ep.novel_id = e.novel_id
       and ep.status = 'published'
     where f.follower_user_id = v_uid
       and (
         (
           e.event_type = 'novel_published'
           and f.notify_new_works
           and e.id > f.new_work_seen_event_id
         )
         or (
           e.event_type = 'episode_published'
           and f.notify_updates
           and e.id > f.update_seen_event_id
           and ep.status = 'published'
         )
       )
       and not exists(
         select 1 from public.user_mutes m
          where m.muter_user_id = v_uid
            and m.muted_user_id = e.author_user_id
       )
       and not exists(
         select 1 from public.user_blocks b
          where (b.blocker_user_id = v_uid and b.blocked_user_id = e.author_user_id)
             or (b.blocker_user_id = e.author_user_id and b.blocked_user_id = v_uid)
       )
     order by e.id desc
     limit v_limit
    ) q;

  return v_result;
end
$function$;

revoke all on function public.novelight_followed_author_updates(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.novelight_followed_author_updates(integer)
  to authenticated;

comment on function public.novelight_followed_author_updates(integer) is
  'Authenticated followed-author notifications: public episode titles remain visible before valid-read.';

commit;
