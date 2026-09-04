\set ON_ERROR_STOP on

do $$
declare
  v_sync_security_definer boolean;
  v_admin_security_definer boolean;
  v_backup_rows integer;
begin
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

  if has_function_privilege(
       'anon',
       'public.novelight_sync_official_thumbnail()',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.novelight_sync_official_thumbnail()',
       'EXECUTE'
     ) then
    raise exception 'Postcheck failed: client roles can execute thumbnail sync trigger function';
  end if;

  if has_function_privilege(
       'anon',
       'public.novelight_admin_register_thumbnail_asset(uuid,text,text,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.novelight_admin_register_thumbnail_asset(uuid,text,text,text)',
       'EXECUTE'
     ) then
    raise exception 'Postcheck failed: client roles can execute ADMIN thumbnail registration';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.novelight_admin_register_thumbnail_asset(uuid,text,text,text)',
    'EXECUTE'
  ) then
    raise exception 'Postcheck failed: service_role cannot execute ADMIN thumbnail registration';
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

  if to_regclass('novelrise_migration_backup.function_execute_acl_state') is null then
    raise exception 'Postcheck failed: function execute ACL backup table is missing';
  end if;

  select count(*) into v_backup_rows
    from novelrise_migration_backup.function_execute_acl_state
   where migration_id = '20260904174500';

  if v_backup_rows <> 4 then
    raise exception 'Postcheck failed: expected four captured client function ACL rows, found %', v_backup_rows;
  end if;
end
$$;
