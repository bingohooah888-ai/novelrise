\set ON_ERROR_STOP on

do $$
declare
  v_has_assets boolean := false;
  v_has_novel_refs boolean := false;
  v_has_audit boolean := false;
  v_has_objects boolean := false;
begin
  if to_regclass('public.novel_thumbnail_assets') is not null then
    execute 'select exists (select 1 from public.novel_thumbnail_assets limit 1)'
      into v_has_assets;
  end if;

  if to_regclass('public.novels') is not null
     and exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'novels'
         and column_name = 'thumbnail_asset_id'
     )
     and exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'novels'
         and column_name = 'thumbnail_url'
     ) then
    execute 'select exists (select 1 from public.novels where thumbnail_asset_id is not null or thumbnail_url is not null limit 1)'
      into v_has_novel_refs;
  end if;

  if to_regclass('public.admin_operation_audit') is not null then
    execute $$select exists (
      select 1
      from public.admin_operation_audit
      where resource_type = 'novel_thumbnail_asset'
      limit 1
    )$$ into v_has_audit;
  end if;

  if to_regclass('storage.objects') is not null then
    execute $$select exists (
      select 1
      from storage.objects
      where bucket_id = 'novel-thumbnails'
      limit 1
    )$$ into v_has_objects;
  end if;

  if v_has_assets or v_has_novel_refs or v_has_audit or v_has_objects then
    raise exception 'Refusing rollback: official thumbnail assets, novel references, ADMIN audit rows, or Storage objects exist. Export and explicitly clear retained data before rollback.';
  end if;
end
$$;

begin;

drop function if exists public.novelight_admin_register_thumbnail_asset(uuid, text, text, text);
drop trigger if exists novelight_sync_official_thumbnail on public.novels;
drop function if exists public.novelight_sync_official_thumbnail();
drop index if exists public.novels_thumbnail_asset_idx;

alter table if exists public.novels
  drop column if exists thumbnail_asset_id,
  drop column if exists thumbnail_url;

drop table if exists public.novel_thumbnail_assets;

do $$
begin
  if to_regclass('storage.buckets') is not null then
    delete from storage.buckets where id = 'novel-thumbnails';
  end if;
end
$$;

commit;
