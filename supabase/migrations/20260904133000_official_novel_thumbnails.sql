begin;

create table public.novel_thumbnail_assets (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  storage_path text not null unique,
  image_url text not null unique,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint novel_thumbnail_assets_label_length check (char_length(trim(label)) between 1 and 80),
  constraint novel_thumbnail_assets_storage_path_check check (
    storage_path ~ '^official/[0-9a-f-]{36}\.(webp|png|jpg|jpeg)$'
  ),
  constraint novel_thumbnail_assets_image_url_check check (
    image_url like 'https://%'
  )
);

create index novel_thumbnail_assets_active_created_idx
  on public.novel_thumbnail_assets (is_active, created_at desc);

alter table public.novel_thumbnail_assets enable row level security;
revoke all on table public.novel_thumbnail_assets from anon, authenticated;
grant select on table public.novel_thumbnail_assets to anon, authenticated;
grant all on table public.novel_thumbnail_assets to service_role;

create policy "Public can read active official thumbnails"
  on public.novel_thumbnail_assets
  for select
  to anon, authenticated
  using (is_active = true);

alter table public.novels
  add column thumbnail_asset_id uuid references public.novel_thumbnail_assets(id),
  add column thumbnail_url text;

create index novels_thumbnail_asset_idx
  on public.novels (thumbnail_asset_id)
  where thumbnail_asset_id is not null;

create or replace function public.novelight_sync_official_thumbnail()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_url text;
begin
  if new.thumbnail_asset_id is null then
    new.thumbnail_url := null;
    return new;
  end if;

  select asset.image_url
    into v_url
    from public.novel_thumbnail_assets asset
   where asset.id = new.thumbnail_asset_id
     and asset.is_active = true;

  if v_url is null then
    raise exception 'Selected official thumbnail is unavailable'
      using errcode = '23514';
  end if;

  new.thumbnail_url := v_url;
  return new;
end;
$$;

revoke all on function public.novelight_sync_official_thumbnail() from public;

drop trigger if exists novelight_sync_official_thumbnail on public.novels;
create trigger novelight_sync_official_thumbnail
before insert or update of thumbnail_asset_id, thumbnail_url
on public.novels
for each row execute function public.novelight_sync_official_thumbnail();

create or replace function public.novelight_admin_register_thumbnail_asset(
  p_admin_user_id uuid,
  p_label text,
  p_storage_path text,
  p_image_url text
)
returns setof public.novel_thumbnail_assets
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_label text := trim(coalesce(p_label, ''));
  v_path text := trim(coalesce(p_storage_path, ''));
  v_url text := trim(coalesce(p_image_url, ''));
  v_row public.novel_thumbnail_assets%rowtype;
begin
  if p_admin_user_id is null then
    raise exception 'Admin identity is required' using errcode = '22023';
  end if;
  if char_length(v_label) not between 1 and 80 then
    raise exception 'Thumbnail label is invalid' using errcode = '22023';
  end if;
  if v_path !~ '^official/[0-9a-f-]{36}\.(webp|png|jpg|jpeg)$' then
    raise exception 'Thumbnail storage path is invalid' using errcode = '22023';
  end if;
  if v_url not like 'https://%' then
    raise exception 'Thumbnail URL is invalid' using errcode = '22023';
  end if;

  insert into public.novel_thumbnail_assets (
    label,
    storage_path,
    image_url,
    created_by
  ) values (
    v_label,
    v_path,
    v_url,
    p_admin_user_id
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
    'thumbnail.create',
    'novel_thumbnail_asset',
    v_row.id::text,
    jsonb_build_object('storage_path', v_row.storage_path)
  );

  return next v_row;
end;
$$;

revoke all on function public.novelight_admin_register_thumbnail_asset(uuid, text, text, text) from public;
grant execute on function public.novelight_admin_register_thumbnail_asset(uuid, text, text, text) to service_role;

-- The bucket is public for reader-facing image delivery. Upload permission is not
-- granted to browser roles: ADMIN receives one-time signed upload tokens from a
-- server endpoint authenticated by the existing ADMIN allowlist.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
) values (
  'novel-thumbnails',
  'novel-thumbnails',
  true,
  5242880,
  array['image/webp','image/png','image/jpeg']
)
on conflict (id) do nothing;

do $$
declare
  v_public boolean;
begin
  select public into v_public
    from storage.buckets
   where id = 'novel-thumbnails';

  if v_public is distinct from true then
    raise exception 'Existing novel-thumbnails bucket is not public; inspect before continuing';
  end if;
end;
$$;

commit;
