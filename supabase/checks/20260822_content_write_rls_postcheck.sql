-- NOVELIGHT: verification after 20260822194000.
-- Read-only. Fails when the managed write-policy set is not exact.

do $$
declare
  expected_count integer;
  unexpected_count integer;
begin
  select count(*) into expected_count
  from pg_policies
  where schemaname = 'public'
    and (
      (tablename = 'novels' and policyname in (
        'novelrise_novels_insert_owner',
        'novelrise_novels_update_owner',
        'novelrise_novels_delete_owner'
      ))
      or
      (tablename = 'episodes' and policyname in (
        'novelrise_episodes_insert_owner',
        'novelrise_episodes_update_owner',
        'novelrise_episodes_delete_owner'
      ))
    )
    and cmd in ('INSERT', 'UPDATE', 'DELETE')
    and roles @> array['authenticated']::name[];

  if expected_count <> 6 then
    raise exception 'Expected exactly 6 managed write policies, found %', expected_count;
  end if;

  select count(*) into unexpected_count
  from pg_policies
  where schemaname = 'public'
    and tablename in ('novels', 'episodes')
    and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    and policyname not in (
      'novelrise_novels_insert_owner',
      'novelrise_novels_update_owner',
      'novelrise_novels_delete_owner',
      'novelrise_episodes_insert_owner',
      'novelrise_episodes_update_owner',
      'novelrise_episodes_delete_owner'
    );

  if unexpected_count <> 0 then
    raise exception 'Unexpected novels/episodes write policies remain: %', unexpected_count;
  end if;

  if not exists (
    select 1
    from novelrise_migration_backup.write_migration_state
    where migration_id = '20260822194000'
  ) then
    raise exception 'Write-policy backup state is missing';
  end if;
end
$$;

select
  tablename,
  policyname,
  cmd,
  roles,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('novels', 'episodes')
order by tablename, cmd, policyname;

select 'PASS: content write RLS is explicitly managed' as result;
