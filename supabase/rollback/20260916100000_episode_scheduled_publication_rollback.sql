\set ON_ERROR_STOP on

begin;

select pg_advisory_xact_lock(hashtext('novelrise:20260916100000:rollback'));

do $$
declare
  v_jobid bigint;
begin
  if to_regclass('public.episodes') is null then
    raise exception 'episodes table is missing';
  end if;

  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'episodes'
       and column_name = 'scheduled_publish_at'
  ) and exists (
    select 1
      from public.episodes
     where scheduled_publish_at is not null
  ) then
    raise exception 'Rollback refused: scheduled episodes still exist. Cancel or publish them before removing scheduled-publication schema.';
  end if;

  if to_regclass('cron.job') is not null then
    execute 'select jobid from cron.job where jobname = $1 order by jobid limit 1'
       into v_jobid
       using 'novelight-publish-scheduled-episodes';
    if v_jobid is not null then
      execute 'select cron.unschedule($1)' using v_jobid;
    end if;
  end if;
end
$$;

revoke all on function public.novelight_schedule_episode_draft(bigint, timestamptz) from public, anon, authenticated;
revoke all on function public.novelight_cancel_episode_schedule(bigint) from public, anon, authenticated;
revoke all on function public.novelight_publish_due_episode_schedules() from public, anon, authenticated, service_role;

drop function if exists public.novelight_schedule_episode_draft(bigint, timestamptz);
drop function if exists public.novelight_cancel_episode_schedule(bigint);
drop function if exists public.novelight_publish_due_episode_schedules();

-- Restore the exact pre-scheduling draft publication contract.
create or replace function public.novelight_publish_episode_draft_atomic(
  p_episode_id bigint
)
returns bigint
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_novel_id bigint;
  v_episode_number bigint;
  v_episode_status text;
  v_novel_status text;
  v_title text;
  v_content text;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select e.novel_id,
         e.episode_number,
         e.status,
         e.title,
         e.content,
         n.status
  into v_novel_id,
       v_episode_number,
       v_episode_status,
       v_title,
       v_content,
       v_novel_status
  from public.episodes e
  join public.novels n on n.id = e.novel_id
  where e.id = p_episode_id
    and e.user_id = v_user_id
    and n.user_id = v_user_id
  for update of e, n;

  if not found then
    raise exception 'Draft episode not found or not owned by current user' using errcode = '42501';
  end if;
  if v_episode_status <> 'draft' then
    raise exception 'Only draft episodes can be published by this RPC' using errcode = '22023';
  end if;
  if v_episode_number is null or v_episode_number < 1 then
    raise exception 'A valid episode number is required before publication' using errcode = '22023';
  end if;
  if char_length(trim(coalesce(v_title, ''))) < 1 or char_length(v_title) > 150 then
    raise exception 'Episode title must contain 1 to 150 characters before publication' using errcode = '22023';
  end if;
  if char_length(trim(coalesce(v_content, ''))) < 1 or char_length(v_content) > 100000 then
    raise exception 'Episode content must contain 1 to 100000 characters before publication' using errcode = '22023';
  end if;
  if v_novel_status <> 'published' and v_episode_number <> 1 then
    raise exception 'The first published episode must be episode 1' using errcode = '22023';
  end if;

  if v_novel_status <> 'published' then
    update public.novels
    set status = 'published'
    where id = v_novel_id
      and user_id = v_user_id;
    if not found then
      raise exception 'Novel could not be published by current user' using errcode = '42501';
    end if;
  end if;

  update public.episodes
  set status = 'published'
  where id = p_episode_id
    and user_id = v_user_id
    and status = 'draft';
  if not found then
    raise exception 'Draft episode publication raced with another update' using errcode = '40001';
  end if;

  return p_episode_id;
end
$$;

revoke all on function public.novelight_publish_episode_draft_atomic(bigint) from public;
revoke all on function public.novelight_publish_episode_draft_atomic(bigint) from anon;
grant execute on function public.novelight_publish_episode_draft_atomic(bigint) to authenticated;


-- Publication-embargo rollback compatibility:
-- The newer reader SELECT policy and read RPCs reference scheduled_publish_at.
-- Remove only that reference before dropping the old scheduling column.
-- Retain first-publication embargo and every owner-access exception.
-- The guard keeps this historical rollback usable on earlier schemas too.
do $embargo_rollback$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'episodes'
      and column_name = 'scheduled_publish_at'
  ) and exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'episodes'
      and column_name = 'first_published_at'
  ) then
    if exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = 'episodes'
        and policyname = 'novelrise_episodes_select_published_or_novel_owner'
    ) then
      execute $restore_policy$
        alter policy novelrise_episodes_select_published_or_novel_owner
          on public.episodes
          using (
            (
              status = 'published'
              and (first_published_at is null or first_published_at <= now())
              and exists (
                select 1 from public.novels n
                where n.id = episodes.novel_id
                  and n.status = 'published'
                  and (n.first_published_at is null or n.first_published_at <= now())
              )
            )
            or (
              (select auth.uid()) is not null
              and exists (
                select 1 from public.novels n
                where n.id = episodes.novel_id
                  and n.user_id = (select auth.uid())
              )
            )
          );
      $restore_policy$;
    end if;
    if to_regprocedure('public.novelight_reader_episode_index(text[])') is not null then
      execute $restore_reader$
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
   and (e.first_published_at is null or e.first_published_at <= now())
  order by n.id::text, e.episode_number, e.id;
end
$function$;
      $restore_reader$;
    end if;
    if to_regprocedure('public.novelight_novel_outline(bigint)') is not null then
      execute $restore_outline$
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
        and (e.first_published_at is null or e.first_published_at <= now())
      )
    )
  order by e.episode_number, e.id;
end
$function$;
      $restore_outline$;
    end if;
    -- Restore public metadata functions before removing the scheduling column.
    if to_regprocedure('public.novelight_character_feed(bigint)') is not null then
      execute $restore_novelight_character_feed$
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
      ))
    where c.novel_id = v_novel_id
      and c.reader_visible
      and c.reader_body_visible
      and e.novel_id = v_novel_id
      and e.status = 'published'
      and (v_uid = v_owner_id or (
        (e.first_published_at is null or e.first_published_at <= now())
      ))
      and e.episode_number <= v_current_number
      and (c.first_appearance_episode_id is null or (first_episode.id is not null and first_episode.episode_number <= v_current_number))
      and (s.override_mode = 'include' or (s.override_mode is null and s.auto_detected))
    group by c.id,c.name,c.description,c.image_url,c.display_order
  ) q;

  return v_result;
end
$function$;
      $restore_novelight_character_feed$;
    end if;
    if to_regprocedure('public.novelight_episode_comment_feed(text,integer)') is not null then
      execute $restore_novelight_episode_comment_feed$
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
       )
     );

  if not found then
    return '[]'::jsonb;
  end if;

  return public.novelight_comment_feed_scope(v_novel_id, v_episode_id, p_limit);
end
$function$;
      $restore_novelight_episode_comment_feed$;
    end if;
    if to_regprocedure('public.novelight_episode_heart_state(bigint)') is not null then
      execute $restore_novelight_episode_heart_state$
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
      $restore_novelight_episode_heart_state$;
    end if;
    if to_regprocedure('public.novelight_novel_character_feed(bigint)') is not null then
      execute $restore_novelight_novel_character_feed$
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
      $restore_novelight_novel_character_feed$;
    end if;
    if to_regprocedure('public.novelight_typo_report_state(bigint)') is not null then
      execute $restore_novelight_typo_report_state$
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
      $restore_novelight_typo_report_state$;
    end if;
  end if;
end
$embargo_rollback$;

drop index if exists public.episodes_scheduled_publish_due_idx;
alter table public.episodes drop constraint if exists episodes_scheduled_publish_requires_draft;
alter table public.episodes drop column if exists scheduled_publish_at;

-- pg_cron itself is intentionally left installed. It is a shared platform
-- extension and may be used by unrelated jobs later; only NOVELIGHT's job is removed.

commit;