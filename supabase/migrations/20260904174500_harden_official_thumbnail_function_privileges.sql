begin;

create schema if not exists novelrise_migration_backup;

create table if not exists novelrise_migration_backup.function_execute_acl_state (
  migration_id text not null,
  function_signature text not null,
  role_name text not null,
  had_execute boolean not null,
  captured_at timestamptz not null default now(),
  primary key (migration_id, function_signature, role_name),
  constraint function_execute_acl_state_role_check
    check (role_name in ('anon', 'authenticated'))
);

do $$
declare
  v_signature text;
  v_role text;
begin
  if to_regprocedure('public.novelight_sync_official_thumbnail()') is null then
    raise exception 'Privilege hardening failed: novelight_sync_official_thumbnail is missing';
  end if;

  if to_regprocedure('public.novelight_admin_register_thumbnail_asset(uuid,text,text,text)') is null then
    raise exception 'Privilege hardening failed: novelight_admin_register_thumbnail_asset is missing';
  end if;

  if exists (
    select 1
    from novelrise_migration_backup.function_execute_acl_state
    where migration_id = '20260904174500'
  ) then
    raise exception 'Privilege hardening failed: backup state for migration 20260904174500 already exists';
  end if;

  foreach v_signature in array array[
    'public.novelight_sync_official_thumbnail()',
    'public.novelight_admin_register_thumbnail_asset(uuid,text,text,text)'
  ] loop
    foreach v_role in array array['anon', 'authenticated'] loop
      insert into novelrise_migration_backup.function_execute_acl_state (
        migration_id,
        function_signature,
        role_name,
        had_execute
      ) values (
        '20260904174500',
        v_signature,
        v_role,
        has_function_privilege(v_role, v_signature, 'EXECUTE')
      );
    end loop;
  end loop;
end
$$;

revoke all on function public.novelight_sync_official_thumbnail()
  from public, anon, authenticated;

revoke all on function public.novelight_admin_register_thumbnail_asset(uuid, text, text, text)
  from public, anon, authenticated;

grant execute on function public.novelight_admin_register_thumbnail_asset(uuid, text, text, text)
  to service_role;

commit;
