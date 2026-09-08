-- NOVELIGHT beta runtime hardening.
-- Enforces official thumbnails, self-heals missing author profiles, and
-- validates episode publication inputs at the database boundary.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260908130000'));

-- Official thumbnails are mandatory for all novels before beta discovery.
do $$
begin
  if to_regclass('public.novel_thumbnail_assets') is null then
    raise exception 'Official thumbnail assets table is required before enforcing beta posting rules';
  end if;
end
$$;

with default_asset as (
  select id
    from public.novel_thumbnail_assets
   where is_active = true
   order by created_at desc
   limit 1
)
update public.novels n
   set thumbnail_asset_id = (select id from default_asset)
 where n.thumbnail_asset_id is null
   and exists (select 1 from default_asset);

do $$
begin
  if exists (select 1 from public.novels where thumbnail_asset_id is null) then
    raise exception 'Cannot enforce required thumbnails while novels without a thumbnail remain and no active official thumbnail is available';
  end if;
end
$$;

alter table public.novels
  alter column thumbnail_asset_id set not null;

create or replace function public.novelight_sync_official_thumbnail()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_url text;
begin
  if new.thumbnail_asset_id is null then
    raise exception 'Official thumbnail is required'
      using errcode = '23514';
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

create or replace function public.novelight_ensure_my_profile()
returns table (
  display_name text,
  bio text,
  plan text,
  payment_status text,
  avatar_path text
)
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text := '';
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  begin
    v_name := trim(coalesce(auth.jwt() -> 'user_metadata' ->> 'display_name', auth.jwt() -> 'user_metadata' ->> 'name', ''));
  exception when undefined_function then
    v_name := '';
  end;

  insert into public.profiles (id, display_name, bio, plan, payment_status)
  values (v_uid, v_name, '', 'free', 'active')
  on conflict (id) do nothing;

  return query
  select p.display_name, p.bio, p.plan, p.payment_status, p.avatar_path
    from public.profiles p
   where p.id = v_uid;

  if not found then
    raise exception using errcode = 'P0002', message = 'Profile not found';
  end if;
end
$$;

revoke all on function public.novelight_ensure_my_profile() from public, anon;
grant execute on function public.novelight_ensure_my_profile() to authenticated;

create or replace function public.novelight_publish_episode_atomic(
  p_novel_id bigint,
  p_episode_number bigint,
  p_title text,
  p_content text
)
returns bigint
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_novel_status text;
  v_episode_id bigint;
  v_title text := trim(coalesce(p_title, ''));
  v_content text := coalesce(p_content, '');
begin
  if v_user_id is null then
    raise exception 'Authentication required'
      using errcode = '42501';
  end if;

  if p_episode_number is null or p_episode_number < 1 then
    raise exception 'Episode number must be at least 1'
      using errcode = '22023';
  end if;

  if char_length(v_title) < 1 or char_length(v_title) > 150 then
    raise exception 'Episode title must be between 1 and 150 characters'
      using errcode = '22023';
  end if;

  if char_length(trim(v_content)) < 1 then
    raise exception 'Episode content is required'
      using errcode = '22023';
  end if;

  if char_length(v_content) > 100000 then
    raise exception 'Episode content must be 100000 characters or fewer'
      using errcode = '22023';
  end if;

  select n.status
  into v_novel_status
  from public.novels n
  where n.id = p_novel_id
    and n.user_id = v_user_id
  for update;

  if not found then
    raise exception 'Novel not found or not owned by current user'
      using errcode = '42501';
  end if;

  if v_novel_status <> 'published' then
    update public.novels
    set status = 'published'
    where id = p_novel_id
      and user_id = v_user_id;

    if not found then
      raise exception 'Novel could not be published by current user'
        using errcode = '42501';
    end if;
  end if;

  insert into public.episodes (
    novel_id,
    user_id,
    episode_number,
    title,
    content,
    status,
    pv
  ) values (
    p_novel_id,
    v_user_id,
    p_episode_number,
    v_title,
    v_content,
    'published',
    0
  )
  returning id into v_episode_id;

  return v_episode_id;
end
$$;

revoke all on function public.novelight_publish_episode_atomic(
  bigint,
  bigint,
  text,
  text
) from public;
revoke all on function public.novelight_publish_episode_atomic(
  bigint,
  bigint,
  text,
  text
) from anon;
grant execute on function public.novelight_publish_episode_atomic(
  bigint,
  bigint,
  text,
  text
) to authenticated;

commit;
