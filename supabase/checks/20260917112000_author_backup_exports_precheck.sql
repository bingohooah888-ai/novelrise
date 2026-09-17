-- Read-only precheck for 20260917112000_author_backup_exports.sql

do $$
begin
  if to_regclass('auth.users') is null then
    raise exception 'auth.users is missing';
  end if;

  if to_regclass('public.author_backup_exports') is not null then
    raise exception 'public.author_backup_exports already exists; reconcile current state before applying';
  end if;

  if to_regprocedure('public.novelight_begin_author_backup_export(uuid)') is not null then
    raise exception 'novelight_begin_author_backup_export(uuid) already exists; reconcile current state before applying';
  end if;
end;
$$;
