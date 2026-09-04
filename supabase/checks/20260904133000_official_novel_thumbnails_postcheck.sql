\set ON_ERROR_STOP on

do $$
declare
  v_assets_rls boolean;
  v_bucket_ok boolean := true;
  v_sync_security_definer boolean;
  v_admin_security_definer boolean;
begin
  if to_regclass('public.novel_thumbnail_assets') is null then
    raise exception 'Postcheck failed: public.novel_thumbnail_assets is missing';
  end if;

  if to_regclass('public.admin_operation_audit') is null then
    raise exception 'Postcheck failed: public.admin_operation_audit is missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'novels'
      and column_name = 'thumbnail_asset_id'
      and data_type = 'uuid'
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'novels'
      and column_name = 'thumbnail_url'
      and data_type = 'text'
  ) then
    raise exception 'Postcheck failed: novel thumbnail columns are missing or have unexpected types';
  end if;

  if not exists (
    select 1
    from pg_constraint con
    join pg_attribute att
      on att.attrelid = con.conrelid
     and att.attnum = any(con.conkey)
    where con.contype = 'f'
      and con.conrelid = 'public.novels'::regclass
      and con.confrelid = 'public.novel_thumbnail_assets'::regclass
      and att.attname = 'thumbnail_asset_id'
  ) then
    raise exception 'Postcheck failed: novels.thumbnail_asset_id foreign key is missing';
  end if;

  select relrowsecurity into v_assets_rls
    from pg_class
   where oid = 'public.novel_thumbnail_assets'::regclass;

  if not coalesce(v_assets_rls, false) then
    raise exception 'Postcheck failed: novel_thumbnail_assets RLS is not enabled';
  end if;

  if not has_table_privilege('anon', 'public.novel_thumbnail_assets', 'SELECT')
     or not has_table_privilege('authenticated', 'public.novel_thumbnail_assets', 'SELECT') then
    raise exception 'Postcheck failed: client roles cannot read active official thumbnail assets';
  end if;

  if has_table_privilege('anon', 'public.novel_thumbnail_assets', 'INSERT')
     or has_table_privilege('anon', 'public.novel_thumbnail_assets', 'UPDATE')
     or has_table_privilege('anon', 'public.novel_thumbnail_assets', 'DELETE')
     or has_table_privilege('authenticated', 'public.novel_thumbnail_assets', 'INSERT')
     or has_table_privilege('authenticated', 'public.novel_thumbnail_assets', 'UPDATE')
     or has_table_privilege('authenticated', 'public.novel_thumbnail_assets', 'DELETE') then
    raise exception 'Postcheck failed: client roles have direct official thumbnail mutation privileges';
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'novel_thumbnail_assets'
      and policyname = 'Public can read active official thumbnails'
      and cmd = 'SELECT'
  ) then
    raise exception 'Postcheck failed: active official thumbnail SELECT policy is missing';
  end if;

  if to_regprocedure('public.novelight_sync_official_thumbnail()') is null then
    raise exception 'Postcheck failed: novelight_sync_official_thumbnail is missing';
  end if;

  if to_regprocedure('public.novelight_admin_register_thumbnail_asset(uuid,text,text,text)') is null then
    raise exception 'Postcheck failed: novelight_admin_register_thumbnail_asset is missing';
  end if;

  select prosecdef into v_sync_security_definer
    from pg_proc
   where oid = 'public.novelight_sync_official_thumbnail()'::regprocedure;
  select prosecdef into v_admin_security_definer
    from pg_proc
   where oid = 'public.novelight_admin_register_thumbnail_asset(uuid,text,text,text)'::regprocedure;

  if not coalesce(v_sync_security_definer, false)
     or not coalesce(v_admin_security_definer, false) then
    raise exception 'Postcheck failed: official thumbnail functions must remain SECURITY DEFINER';
  end if;

  if has_function_privilege('anon', 'public.novelight_admin_register_thumbnail_asset(uuid,text,text,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.novelight_admin_register_thumbnail_asset(uuid,text,text,text)', 'EXECUTE') then
    raise exception 'Postcheck failed: client roles can execute ADMIN thumbnail registration';
  end if;

  if not has_function_privilege('service_role', 'public.novelight_admin_register_thumbnail_asset(uuid,text,text,text)', 'EXECUTE') then
    raise exception 'Postcheck failed: service_role cannot execute ADMIN thumbnail registration';
  end if;

  if has_function_privilege('anon', 'public.novelight_sync_official_thumbnail()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.novelight_sync_official_thumbnail()', 'EXECUTE') then
    raise exception 'Postcheck failed: client roles can directly execute thumbnail sync trigger function';
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.novels'::regclass
      and tgname = 'novelight_sync_official_thumbnail'
      and not tgisinternal
  ) then
    raise exception 'Postcheck failed: novelight_sync_official_thumbnail trigger is missing';
  end if;

  if to_regclass('storage.buckets') is not null then
    execute $sql$
      select exists (
        select 1
        from storage.buckets
        where id = 'novel-thumbnails'
          and public is true
          and file_size_limit = 5242880
          and allowed_mime_types @> array['image/webp','image/png','image/jpeg']::text[]
          and cardinality(allowed_mime_types) = 3
      )
    $sql$ into v_bucket_ok;

    if not coalesce(v_bucket_ok, false) then
      raise exception 'Postcheck failed: novel-thumbnails Storage bucket configuration is invalid';
    end if;
  end if;
end
$$;
