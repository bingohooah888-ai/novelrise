begin;

select pg_advisory_xact_lock(hashtext('novelight:20261006150500'));

alter table public.announcements
  add column if not exists image_path text;

alter table public.announcements
  drop constraint if exists announcements_image_path_check;

alter table public.announcements
  add constraint announcements_image_path_check
  check (
    image_path is null
    or image_path ~ '^images/[0-9a-f-]{36}\.(webp|png|jpg|jpeg)$'
  );

create or replace function public.novelight_admin_create_announcement_v2(
  p_admin_user_id uuid,
  p_title text,
  p_body text,
  p_category text,
  p_status text default 'draft',
  p_image_path text default null
)
returns setof public.announcements
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_title text := trim(coalesce(p_title, ''));
  v_body text := trim(coalesce(p_body, ''));
  v_category text := trim(coalesce(p_category, ''));
  v_status text := lower(trim(coalesce(p_status, 'draft')));
  v_image_path text := nullif(trim(coalesce(p_image_path, '')), '');
  v_row public.announcements%rowtype;
begin
  if p_admin_user_id is null then
    raise exception 'Admin identity is required' using errcode = '22023';
  end if;
  if char_length(v_title) not between 1 and 120 then
    raise exception 'Announcement title is invalid' using errcode = '22023';
  end if;
  if char_length(v_body) not between 1 and 10000 then
    raise exception 'Announcement body is invalid' using errcode = '22023';
  end if;
  if char_length(v_category) not between 1 and 40 then
    raise exception 'Announcement category is invalid' using errcode = '22023';
  end if;
  if v_status not in ('draft', 'published', 'archived') then
    raise exception 'Announcement status is invalid' using errcode = '22023';
  end if;
  if v_image_path is not null
     and v_image_path !~ '^images/[0-9a-f-]{36}\.(webp|png|jpg|jpeg)$' then
    raise exception 'Announcement image path is invalid' using errcode = '22023';
  end if;

  insert into public.announcements (
    title,
    body,
    category,
    status,
    published_at,
    image_path
  ) values (
    v_title,
    v_body,
    v_category,
    v_status,
    case when v_status = 'published' then now() else null end,
    v_image_path
  )
  returning * into v_row;

  insert into public.admin_operation_audit (
    admin_user_id,
    action,
    resource_type,
    resource_id,
    metadata
  ) values (
    p_admin_user_id,
    'announcement.create',
    'announcement',
    v_row.id::text,
    jsonb_build_object(
      'status', v_row.status,
      'has_image', v_row.image_path is not null
    )
  );

  return next v_row;
end;
$$;

create or replace function public.novelight_admin_update_announcement_v2(
  p_admin_user_id uuid,
  p_id bigint,
  p_title text,
  p_body text,
  p_category text,
  p_status text,
  p_image_path text default null
)
returns setof public.announcements
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_title text := trim(coalesce(p_title, ''));
  v_body text := trim(coalesce(p_body, ''));
  v_category text := trim(coalesce(p_category, ''));
  v_status text := lower(trim(coalesce(p_status, '')));
  v_image_path text := nullif(trim(coalesce(p_image_path, '')), '');
  v_row public.announcements%rowtype;
begin
  if p_admin_user_id is null or p_id is null or p_id <= 0 then
    raise exception 'Admin identity and announcement ID are required' using errcode = '22023';
  end if;
  if char_length(v_title) not between 1 and 120 then
    raise exception 'Announcement title is invalid' using errcode = '22023';
  end if;
  if char_length(v_body) not between 1 and 10000 then
    raise exception 'Announcement body is invalid' using errcode = '22023';
  end if;
  if char_length(v_category) not between 1 and 40 then
    raise exception 'Announcement category is invalid' using errcode = '22023';
  end if;
  if v_status not in ('draft', 'published', 'archived') then
    raise exception 'Announcement status is invalid' using errcode = '22023';
  end if;
  if v_image_path is not null
     and v_image_path !~ '^images/[0-9a-f-]{36}\.(webp|png|jpg|jpeg)$' then
    raise exception 'Announcement image path is invalid' using errcode = '22023';
  end if;

  update public.announcements
     set title = v_title,
         body = v_body,
         category = v_category,
         status = v_status,
         image_path = v_image_path,
         published_at = case
           when v_status = 'published' then coalesce(published_at, now())
           when v_status = 'draft' then null
           else published_at
         end,
         updated_at = now()
   where id = p_id
   returning * into v_row;

  if not found then
    raise exception 'Announcement not found' using errcode = 'P0002';
  end if;

  insert into public.admin_operation_audit (
    admin_user_id,
    action,
    resource_type,
    resource_id,
    metadata
  ) values (
    p_admin_user_id,
    'announcement.update',
    'announcement',
    v_row.id::text,
    jsonb_build_object(
      'status', v_row.status,
      'has_image', v_row.image_path is not null
    )
  );

  return next v_row;
end;
$$;

revoke all on function public.novelight_admin_create_announcement_v2(uuid, text, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.novelight_admin_update_announcement_v2(uuid, bigint, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.novelight_admin_create_announcement_v2(uuid, text, text, text, text, text)
  to service_role;
grant execute on function public.novelight_admin_update_announcement_v2(uuid, bigint, text, text, text, text, text)
  to service_role;

do $$
declare
  v_public boolean;
  v_file_size_limit bigint;
  v_allowed_mime_types text[];
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage.buckets is unavailable; skipping announcement image bucket bootstrap in compatibility replay';
    return;
  end if;

  insert into storage.buckets (
    id,
    name,
    public,
    file_size_limit,
    allowed_mime_types
  ) values (
    'announcement-images',
    'announcement-images',
    true,
    5242880,
    array['image/webp','image/png','image/jpeg']
  )
  on conflict (id) do nothing;

  select public, file_size_limit, allowed_mime_types
    into v_public, v_file_size_limit, v_allowed_mime_types
    from storage.buckets
   where id = 'announcement-images';

  if v_public is distinct from true then
    raise exception 'Existing announcement-images bucket is not public; inspect before continuing';
  end if;
  if v_file_size_limit is distinct from 5242880 then
    raise exception 'Existing announcement-images bucket file-size limit differs from 5 MB; inspect before continuing';
  end if;
  if v_allowed_mime_types is null
     or not (v_allowed_mime_types @> array['image/webp','image/png','image/jpeg']::text[]) then
    raise exception 'Existing announcement-images bucket MIME allowlist differs; inspect before continuing';
  end if;
end;
$$;

comment on column public.announcements.image_path is
  'Optional operator-managed image path in the public announcement-images Storage bucket.';

comment on function public.novelight_admin_create_announcement_v2(uuid, text, text, text, text, text) is
  'Service-role-only announcement creation with optional managed image path and audit record.';

comment on function public.novelight_admin_update_announcement_v2(uuid, bigint, text, text, text, text, text) is
  'Service-role-only announcement update with optional managed image path and audit record.';

commit;
