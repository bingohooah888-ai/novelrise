-- Data-preserving rollback. Refuse while any PNG object/asset exists.
-- Roll back application code separately before executing in an approved environment.
begin;
select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('novelight:episode-illustrations:png-contract:20261114:rollback'));
do $$
begin
  if exists (select 1 from public.episode_illustrations where mime_type='image/png')
     or exists (
       select 1 from storage.objects where bucket_id='episode-illustrations'
         and name ~ '\.png$'
     ) then
    raise exception 'ROLLBACK BLOCKED: PNG illustration data exists; do not discard user assets';
  end if;
  if not exists (
    select 1 from storage.buckets where id='episode-illustrations'
      and public=false and file_size_limit=10485760
      and allowed_mime_types=array['image/webp','image/png']::text[]
  ) then
    raise exception 'ROLLBACK BLOCKED: unexpected Storage bucket state';
  end if;
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

alter table public.episode_illustrations
  drop constraint episode_illustrations_mime_extension_check;
alter table public.episode_illustrations
  drop constraint episode_illustrations_mime_type_check;
alter table public.episode_illustrations
  add constraint episode_illustrations_mime_type_check check (mime_type = 'image/webp');

update storage.buckets
   set allowed_mime_types=array['image/webp']::text[]
 where id='episode-illustrations'
   and public=false and file_size_limit=10485760
   and allowed_mime_types=array['image/webp','image/png']::text[];
commit;
