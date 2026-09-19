\set ON_ERROR_STOP on

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260919170000:rollback'));

do $$
declare
  v_row record;
begin
  if (
    select count(*)
    from novelrise_migration_backup.beta_launch_clock_function_state
    where migration_id = '20260919170000'
  ) <> 4 then
    raise exception 'Launch-clock rollback backup is incomplete';
  end if;

  for v_row in
    select function_signature, definition
    from novelrise_migration_backup.beta_launch_clock_function_state
    where migration_id = '20260919170000'
    order by function_signature
  loop
    execute v_row.definition;
  end loop;
end
$$;

drop function if exists public.novelight_effective_publication_at(
  timestamptz, timestamptz
);

commit;
