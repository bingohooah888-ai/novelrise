\set ON_ERROR_STOP on

do $$
declare
  v_bucket_exists boolean := false;
begin
  if to_regclass('public.novels') is null then
    raise exception 'Precheck failed: public.novels is missing';
  end if;

  if to_regclass('public.admin_operation_audit') is null then
    raise exception 'Precheck failed: public.admin_operation_audit is missing; apply 20260903010000 first';
  end if;

  if to_regclass('auth.users') is null then
    raise exception 'Precheck failed: auth.users is missing';
  end if;

  if to_regclass('public.novel_thumbnail_assets') is not null then
    raise exception 'Precheck failed: public.novel_thumbnail_assets already exists';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'novels'
      and column_name in ('thumbnail_asset_id', 'thumbnail_url')
  ) then
    raise exception 'Precheck failed: novel thumbnail columns already exist';
  end if;

  if to_regprocedure('public.novelight_sync_official_thumbnail()') is not null then
    raise exception 'Precheck failed: novelight_sync_official_thumbnail already exists';
  end if;

  if to_regprocedure('public.novelight_admin_register_thumbnail_asset(uuid,text,text,text)') is not null then
    raise exception 'Precheck failed: novelight_admin_register_thumbnail_asset already exists';
  end if;

  if to_regclass('storage.buckets') is not null then
    execute 'select exists (select 1 from storage.buckets where id = $1)'
      into v_bucket_exists
      using 'novel-thumbnails';

    if v_bucket_exists then
      raise exception 'Precheck failed: novel-thumbnails Storage bucket already exists; inspect ownership before migration';
    end if;
  end if;
end
$$;
