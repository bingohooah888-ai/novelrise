-- Controlled rollback for Chapter 39 layered thumbnails.
-- This rollback intentionally aborts once any novel has migrated to a layered
-- composition. At that point a forward repair is safer than destroying source IDs.

begin;

select pg_advisory_xact_lock(hashtext('novelight:rollback:20260910220000'));

do $$
begin
  if to_regclass('public.novel_thumbnail_compositions') is not null
     and exists (select 1 from public.novel_thumbnail_compositions limit 1)
  then
    raise exception 'Chapter 39 rollback refused: layered thumbnail compositions exist';
  end if;

  if exists (select 1 from public.novels where thumbnail_asset_id is null) then
    raise exception 'Chapter 39 rollback refused: novels without legacy thumbnail_asset_id exist';
  end if;
end
$$;

drop function if exists public.novelight_my_thumbnail_composition(bigint);
drop function if exists public.novelight_thumbnail_compositions(bigint[]);
drop function if exists public.novelight_set_my_thumbnail_composition(
  bigint, text, uuid, uuid, uuid, uuid, uuid, uuid, uuid
);
drop function if exists public.novelight_attach_thumbnail_render(bigint, uuid, text, text);
drop function if exists public.novelight_admin_register_thumbnail_layer_asset(
  uuid, text, text, text, text, text, integer, text
);
drop function if exists public.novelight_admin_set_thumbnail_asset_status(uuid, uuid, text);

drop trigger if exists novelight_validate_thumbnail_composition_template
  on public.novel_thumbnail_compositions;
drop function if exists public.novelight_validate_thumbnail_composition_template();

drop table if exists public.novel_thumbnail_compositions;
drop table if exists public.novel_thumbnail_templates;

drop trigger if exists novelight_sync_thumbnail_asset_status
  on public.novel_thumbnail_assets;
drop function if exists public.novelight_sync_thumbnail_asset_status();

drop policy if exists "Public can read active official thumbnails"
  on public.novel_thumbnail_assets;
create policy "Public can read active official thumbnails"
  on public.novel_thumbnail_assets
  for select
  to anon, authenticated
  using (is_active = true);

alter table public.novel_thumbnail_assets
  drop constraint if exists novel_thumbnail_assets_layer_type_check,
  drop constraint if exists novel_thumbnail_assets_template_key_check,
  drop constraint if exists novel_thumbnail_assets_sort_order_check,
  drop constraint if exists novel_thumbnail_assets_availability_status_check,
  drop column if exists layer_type,
  drop column if exists template_key,
  drop column if exists sort_order,
  drop column if exists availability_status;

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

-- The novel-thumbnail-renders Storage bucket is deliberately left in place.
-- Dropping a bucket containing objects requires separate audited Storage cleanup.

commit;
