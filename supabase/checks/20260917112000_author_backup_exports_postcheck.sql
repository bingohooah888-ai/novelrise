-- Read-only postcheck for 20260917112000_author_backup_exports.sql

do $$
begin
  if to_regclass('public.author_backup_exports') is null then
    raise exception 'public.author_backup_exports is missing';
  end if;

  if to_regclass('public.author_backup_exports_user_requested_idx') is null then
    raise exception 'author_backup_exports_user_requested_idx is missing';
  end if;

  if not exists (
    select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'author_backup_exports'
       and c.relrowsecurity
  ) then
    raise exception 'RLS is not enabled on public.author_backup_exports';
  end if;

  if to_regprocedure('public.novelight_begin_author_backup_export(uuid)') is null then
    raise exception 'novelight_begin_author_backup_export(uuid) is missing';
  end if;

  if has_table_privilege('anon', 'public.author_backup_exports', 'SELECT')
     or has_table_privilege('authenticated', 'public.author_backup_exports', 'SELECT') then
    raise exception 'client roles must not read public.author_backup_exports directly';
  end if;

  if has_function_privilege('anon', 'public.novelight_begin_author_backup_export(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.novelight_begin_author_backup_export(uuid)', 'EXECUTE') then
    raise exception 'client roles must not execute novelight_begin_author_backup_export(uuid)';
  end if;

  if not has_function_privilege('service_role', 'public.novelight_begin_author_backup_export(uuid)', 'EXECUTE') then
    raise exception 'service_role cannot execute novelight_begin_author_backup_export(uuid)';
  end if;
end;
$$;
