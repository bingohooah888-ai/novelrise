-- NOVELIGHT rollback for migration 20260822194000.
-- Restores write policies captured before the migration.

begin;

select pg_advisory_xact_lock(hashtext('novelrise:20260822194000'));

do $$
begin
  if to_regclass('novelrise_migration_backup.write_migration_state') is null
     or not exists (
       select 1
       from novelrise_migration_backup.write_migration_state
       where migration_id = '20260822194000'
     ) then
    raise exception 'Rollback backup for migration 20260822194000 was not found';
  end if;
end
$$;

drop policy if exists novelrise_novels_insert_owner on public.novels;
drop policy if exists novelrise_novels_update_owner on public.novels;
drop policy if exists novelrise_novels_delete_owner on public.novels;
drop policy if exists novelrise_episodes_insert_owner on public.episodes;
drop policy if exists novelrise_episodes_update_owner on public.episodes;
drop policy if exists novelrise_episodes_delete_owner on public.episodes;

-- Restore every INSERT/UPDATE/DELETE policy captured before migration.
do $$
declare
  p record;
  role_list text;
  sql_text text;
begin
  for p in
    select *
    from novelrise_migration_backup.write_policies
    where migration_id = '20260822194000'
    order by tablename, cmd, policyname
  loop
    select string_agg(quote_ident(role_name::text), ', ')
    into role_list
    from unnest(p.roles) as role_name;

    sql_text := format(
      'create policy %I on %I.%I as %s for %s to %s',
      p.policyname,
      p.schemaname,
      p.tablename,
      p.permissive,
      lower(p.cmd),
      role_list
    );

    if p.qual is not null then
      sql_text := sql_text || format(' using (%s)', p.qual);
    end if;

    if p.with_check is not null then
      sql_text := sql_text || format(' with check (%s)', p.with_check);
    end if;

    execute sql_text;
  end loop;
end
$$;

-- Backup rows are retained as an audit trail.
commit;
