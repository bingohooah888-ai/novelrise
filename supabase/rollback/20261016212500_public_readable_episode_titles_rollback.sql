-- Manual recovery only. DO NOT deploy automatically.
-- Restore the metadata read-progress mask to the definitions deployed just
-- before migration 20261016212500 if a Production rollback is authorized.
-- Other authorization, publication and block/mute rules are unchanged.
begin;

select pg_advisory_xact_lock(hashtext('novelight:20261016212500'));

create or replace function public.novelight_reader_episode_index(
  p_novel_ids text[]
)
returns table (
  novel_id text,
  episode_id text,
  episode_number bigint,
  episode_title text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
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
  with requested as (
    select unnest(p_novel_ids) as novel_id
  ),
  published as (
    select
      n.id::text as novel_id,
      n.user_id as author_id,
      e.id::text as episode_id,
      e.episode_number,
      e.title
    from requested r
    join public.novels n
      on n.id::text = r.novel_id
     and n.status = 'published'
    join public.episodes e
      on e.novel_id = n.id
     and e.status = 'published'
  ),
  reveal_bounds as (
    select
      p.novel_id,
      p.author_id,
      case
        when v_uid is not null and v_uid = p.author_id then 9223372036854775807::bigint
        when v_uid is null then 0::bigint
        else coalesce(max(read_episode.episode_number), 0)::bigint
      end as reveal_through
    from (
      select distinct
        published_row.novel_id,
        published_row.author_id
      from published as published_row
    ) p
    left join public.valid_read_events vr
      on v_uid is not null
     and vr.reader_id = v_uid
     and vr.novel_id_snapshot = p.novel_id
    left join public.episodes read_episode
      on read_episode.id::text = vr.episode_id_snapshot
     and read_episode.novel_id::text = p.novel_id
     and read_episode.status = 'published'
    group by p.novel_id, p.author_id
  )
  select
    p.novel_id,
    p.episode_id,
    p.episode_number,
    case
      when p.episode_number <= b.reveal_through then p.title
      else null
    end as episode_title
  from published p
  join reveal_bounds b on b.novel_id = p.novel_id
  order by p.novel_id, p.episode_number, p.episode_id;
end
$$;

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
    case
      when idx.episode_title is not null then c.title
      else null
    end as chapter_title
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

create or replace function public.novelight_followed_author_updates(p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
          'episode_title', case
            when ep.id is null then null
            when exists (
              select 1
              from public.valid_read_events vr
              join public.episodes read_episode
                on read_episode.id::text = vr.episode_id_snapshot
               and read_episode.novel_id = n.id
               and read_episode.status = 'published'
              where vr.reader_id = v_uid
                and vr.novel_id_snapshot = n.id::text
                and read_episode.episode_number >= ep.episode_number
            ) then ep.title
            else null
          end
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
$$;

revoke all on function public.novelight_reader_episode_index(text[])
  from public, anon, authenticated, service_role;
grant execute on function public.novelight_reader_episode_index(text[])
  to anon, authenticated;

revoke all on function public.novelight_reader_episode_chapter_index(text[])
  from public, anon, authenticated, service_role;
grant execute on function public.novelight_reader_episode_chapter_index(text[])
  to anon, authenticated, service_role;

revoke all on function public.novelight_followed_author_updates(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.novelight_followed_author_updates(integer)
  to authenticated;

commit;
