-- Protect all public episode metadata against status/time inconsistencies.
-- SECURITY DEFINER functions bypass table RLS, so guard before returning data.
-- Preserve author previews, original RPC signatures and existing grants.
begin;

CREATE OR REPLACE FUNCTION public.novelight_character_feed(p_episode_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
  v_owner_id uuid;
  v_novel_id bigint;
  v_current_number integer;
  v_show_images boolean := false;
  v_result jsonb;
begin
  select e.novel_id,e.episode_number,n.character_images_visible,n.user_id
    into v_novel_id,v_current_number,v_show_images,v_owner_id
  from public.episodes e
  join public.novels n on n.id = e.novel_id
  where e.id = p_episode_id and e.status = 'published' and n.status = 'published'
    and (
      v_uid = n.user_id
      or (
        (n.first_published_at is null or n.first_published_at <= now())
        and (e.first_published_at is null or e.first_published_at <= now())
        and (e.scheduled_publish_at is null or e.scheduled_publish_at <= now())
      )
    );

  if v_novel_id is null then return '[]'::jsonb; end if;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',q.id,
    'name',q.name,
    'description',q.description,
    'image_url',case when v_show_images then q.image_url else null end,
    'appears_current_episode',q.appears_current_episode,
    'latest_episode_id',q.latest_episode_id,
    'latest_episode_number',q.latest_episode_number,
    'latest_episode_title',q.latest_episode_title
  ) order by q.display_order,q.appears_current_episode desc,q.latest_episode_number desc,q.name,q.id), '[]'::jsonb)
  into v_result
  from (
    select c.id,c.name,c.description,c.image_url,c.display_order,
      pg_catalog.bool_or(e.id = p_episode_id and (s.override_mode = 'include' or (s.override_mode is null and s.auto_detected))) as appears_current_episode,
      (pg_catalog.array_agg(e.id order by e.episode_number desc,e.id desc))[1] as latest_episode_id,
      max(e.episode_number) as latest_episode_number,
      (pg_catalog.array_agg(e.title order by e.episode_number desc,e.id desc))[1] as latest_episode_title
    from public.novel_characters c
    join public.novel_character_episode_states s on s.character_id = c.id
    join public.episodes e on e.id = s.episode_id
    left join public.episodes first_episode
      on first_episode.id = c.first_appearance_episode_id
      and first_episode.novel_id = c.novel_id
      and first_episode.status = 'published'
      and (v_uid = v_owner_id or (
        (first_episode.first_published_at is null or first_episode.first_published_at <= now())
        and (first_episode.scheduled_publish_at is null or first_episode.scheduled_publish_at <= now())
      ))
    where c.novel_id = v_novel_id
      and c.reader_visible
      and c.reader_body_visible
      and e.novel_id = v_novel_id
      and e.status = 'published'
      and (v_uid = v_owner_id or (
        (e.first_published_at is null or e.first_published_at <= now())
        and (e.scheduled_publish_at is null or e.scheduled_publish_at <= now())
      ))
      and e.episode_number <= v_current_number
      and (c.first_appearance_episode_id is null or (first_episode.id is not null and first_episode.episode_number <= v_current_number))
      and (s.override_mode = 'include' or (s.override_mode is null and s.auto_detected))
    group by c.id,c.name,c.description,c.image_url,c.display_order
  ) q;

  return v_result;
end
$function$;

CREATE OR REPLACE FUNCTION public.novelight_episode_comment_feed(p_episode_id text, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_episode_id bigint;
  v_novel_id bigint;
begin
  select e.id, e.novel_id
    into v_episode_id, v_novel_id
    from public.episodes e
    join public.novels n on n.id = e.novel_id
   where e.id::text = p_episode_id
     and e.status = 'published'
     and n.status = 'published'
     and (
       n.user_id = (select auth.uid())
       or (
         (n.first_published_at is null or n.first_published_at <= now())
         and (e.first_published_at is null or e.first_published_at <= now())
         and (e.scheduled_publish_at is null or e.scheduled_publish_at <= now())
       )
     );

  if not found then
    return '[]'::jsonb;
  end if;

  return public.novelight_comment_feed_scope(v_novel_id, v_episode_id, p_limit);
end
$function$;

CREATE OR REPLACE FUNCTION public.novelight_episode_heart_state(p_episode_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
  v_author_id uuid;
  v_count bigint := 0;
  v_hearted boolean := false;
  v_can_heart boolean := false;
begin
  if p_episode_id is null or p_episode_id <= 0 then
    return pg_catalog.jsonb_build_object(
      'available', false,
      'heart_count', 0,
      'hearted', false,
      'can_heart', false
    );
  end if;

  select e.user_id
    into v_author_id
    from public.episodes e
    join public.novels n on n.id = e.novel_id
   where e.id = p_episode_id
     and e.status = 'published'
     and n.status = 'published'
     and (
       n.user_id = (select auth.uid())
       or (
         (n.first_published_at is null or n.first_published_at <= now())
         and (e.first_published_at is null or e.first_published_at <= now())
         and (e.scheduled_publish_at is null or e.scheduled_publish_at <= now())
       )
     );

  if not found then
    return pg_catalog.jsonb_build_object(
      'available', false,
      'heart_count', 0,
      'hearted', false,
      'can_heart', false
    );
  end if;

  select count(*)::bigint
    into v_count
    from public.episode_hearts h
   where h.episode_id = p_episode_id;

  if v_uid is not null then
    select exists(
      select 1
        from public.episode_hearts h
       where h.episode_id = p_episode_id
         and h.user_id = v_uid
    ) into v_hearted;

    v_can_heart :=
      v_uid <> v_author_id
      and not exists(
        select 1
          from public.user_blocks b
         where (b.blocker_user_id = v_author_id and b.blocked_user_id = v_uid)
            or (b.blocker_user_id = v_uid and b.blocked_user_id = v_author_id)
      );
  end if;

  return pg_catalog.jsonb_build_object(
    'available', true,
    'heart_count', v_count,
    'hearted', v_hearted,
    'can_heart', v_can_heart
  );
end
$function$;

CREATE OR REPLACE FUNCTION public.novelight_novel_character_feed(p_novel_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
  v_author_id uuid;
  v_show_images boolean := false;
  v_reveal_through bigint := 0;
  v_result jsonb;
begin
  select n.user_id,n.character_images_visible
    into v_author_id,v_show_images
  from public.novels n
  where n.id = p_novel_id and n.status = 'published'
    and (v_uid = n.user_id or n.first_published_at is null or n.first_published_at <= now());

  if not found then return '[]'::jsonb; end if;

  if v_uid is not null and v_uid = v_author_id then
    v_reveal_through := 9223372036854775807::bigint;
  elsif v_uid is not null then
    select coalesce(max(e.episode_number),0)::bigint
      into v_reveal_through
    from public.valid_read_events vr
    join public.episodes e
      on e.id::text = vr.episode_id_snapshot
     and e.novel_id = p_novel_id
     and e.status = 'published'
     and (e.first_published_at is null or e.first_published_at <= now())
     and (e.scheduled_publish_at is null or e.scheduled_publish_at <= now())
    where vr.reader_id = v_uid
      and vr.novel_id_snapshot = p_novel_id::text;
  end if;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',q.id,
    'name',q.name,
    'description',q.description,
    'image_url',case when v_show_images then q.image_url else null end,
    'first_appearance_episode_number',q.first_appearance_episode_number
  ) order by q.display_order,q.name,q.id), '[]'::jsonb)
  into v_result
  from (
    select
      c.id,
      c.name,
      c.description,
      c.image_url,
      c.display_order,
      coalesce(
        first_episode.episode_number,
        (
          select min(e2.episode_number)
          from public.novel_character_episode_states s2
          join public.episodes e2 on e2.id = s2.episode_id
          where s2.character_id = c.id
            and e2.novel_id = p_novel_id
            and e2.status = 'published'
            and (v_uid = v_author_id or (
              (e2.first_published_at is null or e2.first_published_at <= now())
              and (e2.scheduled_publish_at is null or e2.scheduled_publish_at <= now())
            ))
            and (s2.override_mode = 'include' or (s2.override_mode is null and s2.auto_detected))
        )
      ) as first_appearance_episode_number
    from public.novel_characters c
    left join public.episodes first_episode
      on first_episode.id = c.first_appearance_episode_id
      and first_episode.novel_id = c.novel_id
      and first_episode.status = 'published'
      and (v_uid = v_author_id or (
        (first_episode.first_published_at is null or first_episode.first_published_at <= now())
        and (first_episode.scheduled_publish_at is null or first_episode.scheduled_publish_at <= now())
      ))
    where c.novel_id = p_novel_id
      and c.reader_visible
      and c.novel_detail_visible
  ) q
  where q.first_appearance_episode_number is not null
    and q.first_appearance_episode_number <= v_reveal_through;

  return v_result;
end
$function$;

CREATE OR REPLACE FUNCTION public.novelight_typo_report_state(p_episode_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_author_id uuid;
  v_enabled boolean := false;
begin
  if p_episode_id is null then
    return pg_catalog.jsonb_build_object('enabled', false);
  end if;

  select n.user_id,
         coalesce(s.enabled, false)
    into v_author_id, v_enabled
    from public.episodes e
    join public.novels n on n.id = e.novel_id
    left join public.novel_typo_report_settings s on s.novel_id = n.id
   where e.id = p_episode_id
     and e.status = 'published'
     and n.status = 'published'
     and (
       n.user_id = (select auth.uid())
       or (
         (n.first_published_at is null or n.first_published_at <= now())
         and (e.first_published_at is null or e.first_published_at <= now())
         and (e.scheduled_publish_at is null or e.scheduled_publish_at <= now())
       )
     );

  if not found then
    return pg_catalog.jsonb_build_object('enabled', false);
  end if;

  if v_uid is not null then
    if v_uid = v_author_id then
      v_enabled := false;
    elsif exists (
      select 1
        from public.user_blocks b
       where (b.blocker_user_id = v_author_id and b.blocked_user_id = v_uid)
          or (b.blocker_user_id = v_uid and b.blocked_user_id = v_author_id)
    ) then
      v_enabled := false;
    end if;
  end if;

  return pg_catalog.jsonb_build_object('enabled', v_enabled);
end
$function$;

commit;
