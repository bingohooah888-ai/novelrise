-- Block premature metadata disclosure when published records have future dates.
-- The normal publishing workflow already keeps future episodes as drafts;
-- these guards protect against inconsistent status/time combinations.
-- Owner-only outline editing stays unchanged. No access grants are modified.
begin;

CREATE OR REPLACE FUNCTION public.novelight_novel_outline(p_novel_id bigint)
 RETURNS TABLE(episode_id bigint, episode_title text, episode_number bigint, episode_status text, chapter_id bigint, chapter_title text, chapter_position bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_owner_id uuid;
  v_novel_status text;
  v_is_owner boolean := false;
begin
  if p_novel_id is null then
    return;
  end if;

  select n.user_id, n.status
    into v_owner_id, v_novel_status
    from public.novels n
   where n.id = p_novel_id;

  if not found then
    return;
  end if;

  v_is_owner := v_user_id is not null and v_user_id = v_owner_id;
  if not v_is_owner and v_novel_status <> 'published' then
    return;
  end if;

  return query
  select
    e.id,
    e.title,
    e.episode_number,
    e.status,
    c.id,
    c.title,
    c.position
  from public.episodes e
  left join public.novel_chapters c
    on c.id = e.chapter_id
   and c.novel_id = e.novel_id
  where e.novel_id = p_novel_id
    and (
      v_is_owner
      or (
        v_novel_status = 'published'
        and e.status = 'published'
        and (e.scheduled_publish_at is null or e.scheduled_publish_at <= now())
        and (e.first_published_at is null or e.first_published_at <= now())
      )
    )
  order by e.episode_number, e.id;
end
$function$;

CREATE OR REPLACE FUNCTION public.novelight_public_author_notes(p_author_user_id uuid, p_limit integer DEFAULT 5)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', q.id,
        'title', q.title,
        'body', q.body,
        'published_at', q.published_at,
        'linked_novel', case
          when q.novel_id is null then null
          else pg_catalog.jsonb_build_object('id', q.novel_id, 'title', q.novel_title)
        end
      ) order by q.published_at desc, q.id desc
    ),
    '[]'::jsonb
  )
  from (
    select
      note.id,
      note.title,
      note.body,
      note.published_at,
      novel.id as novel_id,
      novel.title as novel_title
    from public.author_notes note
    left join public.novels novel
      on novel.id = note.linked_novel_id
     and novel.user_id = note.author_user_id
     and novel.status = 'published'
    where note.author_user_id = p_author_user_id
      and note.status = 'published'
      and note.published_at <= now()
    order by note.published_at desc, note.id desc
    limit least(greatest(coalesce(p_limit, 5), 1), 20)
  ) q
$function$;

CREATE OR REPLACE FUNCTION public.novelight_reader_episode_index(p_novel_ids text[])
 RETURNS TABLE(novel_id text, episode_id text, episode_number bigint, episode_title text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
   and (e.scheduled_publish_at is null or e.scheduled_publish_at <= now())
   and (e.first_published_at is null or e.first_published_at <= now())
  order by n.id::text, e.episode_number, e.id;
end
$function$;

commit;
