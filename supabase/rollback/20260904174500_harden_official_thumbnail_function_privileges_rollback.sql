\set ON_ERROR_STOP on

begin;

do $$
declare
  v_row record;
  v_count integer;
begin
  if to_regclass('novelrise_migration_backup.function_execute_acl_state') is null then
    raise exception 'Rollback backup for migration 20260904174500 was not found';
  end if;

  select count(*) into v_count
    from novelrise_migration_backup.function_execute_acl_state
   where migration_id = '20260904174500';

  if v_count <> 4 then
    raise exception 'Rollback backup for migration 20260904174500 is incomplete';
  end if;

  if to_regprocedure('public.novelight_sync_official_thumbnail()') is null
     or to_regprocedure('public.novelight_admin_register_thumbnail_asset(uuid,text,text,text)') is null then
    raise exception 'Rollback refused: official thumbnail functions are missing';
  end if;

  revoke all on function public.novelight_sync_official_thumbnail()
    from public, anon, authenticated;
  revoke all on function public.novelight_admin_register_thumbnail_asset(uuid, text, text, text)
    from public, anon, authenticated;

  for v_row in
    select function_signature, role_name, had_execute
      from novelrise_migration_backup.function_execute_acl_state
     where migration_id = '20260904174500'
     order by function_signature, role_name
  loop
    if not v_row.had_execute then
      continue;
    end if;

    if v_row.function_signature = 'public.novelight_sync_official_thumbnail()'
       and v_row.role_name = 'anon' then
      grant execute on function public.novelight_sync_official_thumbnail() to anon;
    elsif v_row.function_signature = 'public.novelight_sync_official_thumbnail()'
       and v_row.role_name = 'authenticated' then
      grant execute on function public.novelight_sync_official_thumbnail() to authenticated;
    elsif v_row.function_signature = 'public.novelight_admin_register_thumbnail_asset(uuid,text,text,text)'
       and v_row.role_name = 'anon' then
      grant execute on function public.novelight_admin_register_thumbnail_asset(uuid, text, text, text) to anon;
    elsif v_row.function_signature = 'public.novelight_admin_register_thumbnail_asset(uuid,text,text,text)'
       and v_row.role_name = 'authenticated' then
      grant execute on function public.novelight_admin_register_thumbnail_asset(uuid, text, text, text) to authenticated;
    else
      raise exception 'Rollback refused: unexpected function ACL backup row';
    end if;
  end loop;

  grant execute on function public.novelight_admin_register_thumbnail_asset(uuid, text, text, text)
    to service_role;
end
$$;

commit;
