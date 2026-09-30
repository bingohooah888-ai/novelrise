-- Let authors remove unused episode illustrations from the active upload list
-- without physically deleting storage objects that may still be referenced by
-- revision history. Deleted illustrations become active again automatically
-- if a restored/current episode body references their marker.

alter table public.episode_illustrations
  add column if not exists deleted_at timestamptz;

create index if not exists episode_illustrations_episode_deleted_idx
  on public.episode_illustrations (episode_id, deleted_at);

create or replace function public.novelight_episode_illustration_editor_bundle(
  p_episode_id bigint,
  p_actor_user_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_episode record;
  v_can_edit boolean;
  v_assets jsonb;
begin
  if p_actor_user_id is null then
    raise exception using errcode='42501', message='Authenticated actor required';
  end if;

  select e.id,
         e.novel_id,
         e.user_id as owner_user_id,
         e.status,
         e.content,
         n.illustration_ai_usage
    into v_episode
    from public.episodes e
    join public.novels n on n.id = e.novel_id
   where e.id = p_episode_id;

  if not found then
    return null;
  end if;

  v_can_edit :=
    v_episode.owner_user_id = p_actor_user_id
    or public.novelight_collaboration_can_edit(v_episode.novel_id, p_actor_user_id);

  if not v_can_edit then
    return pg_catalog.jsonb_build_object(
      'episode_id', p_episode_id,
      'can_edit', false
    );
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', i.id,
        'storage_path', i.storage_path,
        'mime_type', i.mime_type,
        'file_size', i.file_size,
        'width', i.width,
        'height', i.height,
        'alt_text', i.alt_text,
        'created_at', i.created_at
      )
      order by i.created_at, i.id
    ),
    '[]'::jsonb
  )
    into v_assets
    from public.episode_illustrations i
   where i.episode_id = p_episode_id
     and (
       i.deleted_at is null
       or exists (
         select 1
           from pg_catalog.regexp_split_to_table(
             pg_catalog.replace(coalesce(v_episode.content, ''), E'\r', ''),
             E'\n'
           ) as marker_line(line)
          where pg_catalog.btrim(marker_line.line, E' \t') =
                '[[NOVELIGHT_ILLUSTRATION:' || i.id::text || ']]'
       )
     );

  return pg_catalog.jsonb_build_object(
    'episode_id', v_episode.id,
    'novel_id', v_episode.novel_id,
    'owner_user_id', v_episode.owner_user_id,
    'episode_status', v_episode.status,
    'can_edit', true,
    'is_owner', v_episode.owner_user_id = p_actor_user_id,
    'illustration_ai_usage', v_episode.illustration_ai_usage,
    'limit', 10,
    'assets', v_assets
  );
end
$$;

create or replace function public.novelight_register_episode_illustration(
  p_episode_id bigint,
  p_actor_user_id uuid,
  p_storage_path text,
  p_mime_type text,
  p_file_size bigint,
  p_width integer,
  p_height integer,
  p_alt_text text
) returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_episode record;
  v_id uuid;
  v_count integer;
  v_alt text := coalesce(p_alt_text, '');
  v_path_pattern text;
begin
  if p_actor_user_id is null then
    raise exception using errcode='42501', message='Authenticated actor required';
  end if;

  select e.id,
         e.novel_id,
         e.user_id as owner_user_id,
         e.content,
         n.illustration_ai_usage
    into v_episode
    from public.episodes e
    join public.novels n on n.id = e.novel_id
   where e.id = p_episode_id
   for update of e;

  if not found
     or not (
       v_episode.owner_user_id = p_actor_user_id
       or public.novelight_collaboration_can_edit(v_episode.novel_id, p_actor_user_id)
     ) then
    raise exception using errcode='42501', message='Episode illustration edit access required';
  end if;

  if v_episode.illustration_ai_usage is null then
    raise exception using errcode='22023', message='ILLUSTRATION_AI_USAGE_REQUIRED';
  end if;

  if p_mime_type is distinct from 'image/webp'
     or p_file_size is null or p_file_size < 1 or p_file_size > 10485760
     or p_width is null or p_width < 1 or p_width > 2000
     or p_height is null or p_height < 1 or p_height > 2000
     or pg_catalog.char_length(v_alt) > 500 then
    raise exception using errcode='22023', message='Invalid optimized illustration metadata';
  end if;

  v_path_pattern :=
    '^' || v_episode.owner_user_id::text || '/' || p_episode_id::text
    || '/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$';

  if p_storage_path is null or p_storage_path !~ v_path_pattern then
    raise exception using errcode='22023', message='Invalid illustration storage path';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('novelight:episode-illustrations:' || p_episode_id::text, 0)
  );

  select pg_catalog.count(*)::integer
    into v_count
    from public.episode_illustrations i
   where i.episode_id = p_episode_id
     and (
       i.deleted_at is null
       or exists (
         select 1
           from pg_catalog.regexp_split_to_table(
             pg_catalog.replace(coalesce(v_episode.content, ''), E'\r', ''),
             E'\n'
           ) as marker_line(line)
          where pg_catalog.btrim(marker_line.line, E' \t') =
                '[[NOVELIGHT_ILLUSTRATION:' || i.id::text || ']]'
       )
     );

  if v_count >= 10 then
    raise exception using errcode='22023', message='EPISODE_ILLUSTRATION_LIMIT_REACHED';
  end if;

  insert into public.episode_illustrations (
    episode_id,
    novel_id,
    owner_user_id,
    created_by_user_id,
    storage_path,
    mime_type,
    file_size,
    width,
    height,
    alt_text
  ) values (
    p_episode_id,
    v_episode.novel_id,
    v_episode.owner_user_id,
    p_actor_user_id,
    p_storage_path,
    p_mime_type,
    p_file_size,
    p_width,
    p_height,
    v_alt
  )
  returning id into v_id;

  return v_id;
end
$$;

create or replace function public.novelight_delete_episode_illustration(
  p_episode_id bigint,
  p_novel_id bigint,
  p_illustration_id uuid,
  p_actor_user_id uuid
) returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_episode record;
  v_image record;
  v_marker text;
begin
  if p_actor_user_id is null then
    raise exception using errcode='42501', message='Authenticated actor required';
  end if;

  select e.id,
         e.novel_id,
         e.user_id as owner_user_id,
         e.content
    into v_episode
    from public.episodes e
   where e.id = p_episode_id
   for update of e;

  if not found or v_episode.novel_id <> p_novel_id then
    raise exception using errcode='22023', message='EPISODE_ILLUSTRATION_NOT_FOUND';
  end if;

  if not (
    v_episode.owner_user_id = p_actor_user_id
    or public.novelight_collaboration_can_edit(v_episode.novel_id, p_actor_user_id)
  ) then
    raise exception using errcode='42501', message='Episode illustration edit access required';
  end if;

  select i.id,
         i.episode_id,
         i.novel_id,
         i.deleted_at
    into v_image
    from public.episode_illustrations i
   where i.id = p_illustration_id
   for update;

  if not found
     or v_image.episode_id <> p_episode_id
     or v_image.novel_id <> p_novel_id then
    raise exception using errcode='22023', message='EPISODE_ILLUSTRATION_NOT_FOUND';
  end if;

  v_marker := '[[NOVELIGHT_ILLUSTRATION:' || p_illustration_id::text || ']]';

  if exists (
    select 1
      from pg_catalog.regexp_split_to_table(
        pg_catalog.replace(coalesce(v_episode.content, ''), E'\r', ''),
        E'\n'
      ) as marker_line(line)
     where pg_catalog.btrim(marker_line.line, E' \t') = v_marker
  ) then
    raise exception using errcode='55000', message='EPISODE_ILLUSTRATION_IN_USE';
  end if;

  if v_image.deleted_at is not null then
    return false;
  end if;

  update public.episode_illustrations
     set deleted_at = pg_catalog.now(),
         updated_at = pg_catalog.now()
   where id = p_illustration_id;

  return true;
end
$$;

revoke all on function public.novelight_delete_episode_illustration(bigint, bigint, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.novelight_delete_episode_illustration(bigint, bigint, uuid, uuid)
  to service_role;
