-- Keep Safari Canvas PNG fallback coherent from signed upload through private Storage,
-- durable registry and ZIP export. This is a schema/config change, not a bucket reset.
-- Apply ONLY after approved Staging verification / separate Production DB approval.
begin;
select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('novelight:episode-illustrations:png-contract:20261114'));

do $$
begin
  if pg_catalog.to_regclass('public.episode_illustrations') is null
     or pg_catalog.to_regprocedure('public.novelight_register_episode_illustration(bigint,uuid,text,text,bigint,integer,integer,text)') is null
     or pg_catalog.to_regclass('storage.buckets') is null then
    raise exception 'Illustration PNG contract prerequisites missing';
  end if;

  if not exists (
    select 1 from storage.buckets
    where id = 'episode-illustrations' and public = false
      and file_size_limit = 10485760
      and allowed_mime_types = array['image/webp']::text[]
  ) then
    raise exception 'Unexpected private illustration bucket baseline; inspect before migrating';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.episode_illustrations'::regclass
      and conname = 'episode_illustrations_mime_type_check'
      and pg_catalog.pg_get_constraintdef(oid) like '%image/webp%'
  ) then
    raise exception 'Unexpected illustration registry MIME constraint';
  end if;

  if exists (
    select 1 from public.episode_illustrations
    where mime_type <> 'image/webp'
       or storage_path !~ '\.webp$'
  ) then
    raise exception 'Unexpected illustration asset MIME/path; migration would be unsafe';
  end if;
end
$$;

alter table public.episode_illustrations
  drop constraint episode_illustrations_mime_type_check;
alter table public.episode_illustrations
  add constraint episode_illustrations_mime_type_check
  check (mime_type in ('image/webp', 'image/png'));
alter table public.episode_illustrations
  add constraint episode_illustrations_mime_extension_check
  check (
    (mime_type = 'image/webp' and storage_path ~ '\.webp$')
    or (mime_type = 'image/png' and storage_path ~ '\.png$')
  );

-- Preserve server-only RPC permissions, owner/collaborator checks, AI declaration,
-- 10-image quota, active-reference protection and per-actor issuance rate limits.
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

  if p_mime_type is null or p_mime_type not in ('image/webp', 'image/png')
     or p_file_size is null or p_file_size < 1 or p_file_size > 10485760
     or p_width is null or p_width < 1 or p_width > 2000
     or p_height is null or p_height < 1 or p_height > 2000
     or pg_catalog.char_length(v_alt) > 500 then
    raise exception using errcode='22023', message='Invalid optimized illustration metadata';
  end if;

  v_path_pattern :=
    '^' || v_episode.owner_user_id::text || '/' || p_episode_id::text
    || '/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.' || (case when p_mime_type = 'image/png' then 'png' else 'webp' end) || '$';

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

-- Signed upload tokens do not bypass bucket MIME configuration.
update storage.buckets
   set allowed_mime_types = array['image/webp', 'image/png']::text[]
 where id = 'episode-illustrations'
   and public = false
   and file_size_limit = 10485760
   and allowed_mime_types = array['image/webp']::text[];

do $$
begin
  if not exists (
    select 1 from storage.buckets
    where id='episode-illustrations' and public=false
      and file_size_limit=10485760
      and allowed_mime_types=array['image/webp','image/png']::text[]
  ) then
    raise exception 'Illustration bucket MIME update did not take effect';
  end if;
end
$$;

commit;
