\set ON_ERROR_STOP on

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260919171500:rollback'));

do $$
declare
  v_row record;
begin
  if (
    select count(*)
    from novelrise_migration_backup.beta_spoiler_boundary_function_state
    where migration_id = '20260919171500'
  ) <> 2 then
    raise exception 'Spoiler-boundary rollback backup is incomplete';
  end if;

  for v_row in
    select definition
    from novelrise_migration_backup.beta_spoiler_boundary_function_state
    where migration_id = '20260919171500'
    order by function_signature
  loop
    execute v_row.definition;
  end loop;
end
$$;

revoke all on function public.novelight_reader_episode_index(text[])
  from public, anon, authenticated;
drop function if exists public.novelight_reader_episode_index(text[]);

grant execute on function public.novelight_novel_outline(bigint)
  to anon, authenticated, service_role;
grant execute on function public.novelight_followed_author_updates(integer)
  to authenticated;

commit;
