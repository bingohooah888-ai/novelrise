-- NOVELIGHT: make novels/episodes INSERT, UPDATE, DELETE policies explicit.
-- Run the matching precheck first.

begin;

select pg_advisory_xact_lock(hashtext('novelrise:20260822194000'));

create schema if not exists novelrise_migration_backup;
revoke all on schema novelrise_migration_backup from public;
revoke all on schema novelrise_migration_backup from anon, authenticated;

create table if not exists novelrise_migration_backup.write_migration_state (
  migration_id text primary key,
  applied_at timestamptz not null default now()
);

create table if not exists novelrise_migration_backup.write_policies (
  migration_id text not null,
  schemaname name not null,
  tablename name not null,
  policyname name not null,
  permissive text not null,
  roles name[] not null,
  cmd text not null,
  qual text,
  with_check text,
  primary key (migration_id, schemaname, tablename, policyname)
);

do $$
begin
  if exists (
    select 1
    from novelrise_migration_backup.write_migration_state
    where migration_id = '20260822194000'
  ) then
    raise exception 'Migration 20260822194000 already has backup state';
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename in ('novels', 'episodes')
      and cmd = 'ALL'
  ) then
    raise exception 'A FOR ALL policy exists on novels or episodes. Stop and review before applying this migration.';
  end if;
end
$$;

insert into novelrise_migration_backup.write_migration_state (migration_id)
values ('20260822194000');

insert into novelrise_migration_backup.write_policies (
  migration_id,
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
)
select
  '20260822194000',
  schemaname,
  tablename,
  policyname,
  permissive,
  roles::name[],
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('novels', 'episodes')
  and cmd in ('INSERT', 'UPDATE', 'DELETE');

-- Replace only write policies. Existing SELECT policies remain untouched.
do $$
declare
  p record;
begin
  for p in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('novels', 'episodes')
      and cmd in ('INSERT', 'UPDATE', 'DELETE')
  loop
    execute format(
      'drop policy %I on %I.%I',
      p.policyname,
      p.schemaname,
      p.tablename
    );
  end loop;
end
$$;

create policy novelrise_novels_insert_owner
on public.novels
as permissive
for insert
to authenticated
with check (
  (select auth.uid()) is not null
  and user_id = (select auth.uid())
);

create policy novelrise_novels_update_owner
on public.novels
as permissive
for update
to authenticated
using (
  (select auth.uid()) is not null
  and user_id = (select auth.uid())
)
with check (
  (select auth.uid()) is not null
  and user_id = (select auth.uid())
);

create policy novelrise_novels_delete_owner
on public.novels
as permissive
for delete
to authenticated
using (
  (select auth.uid()) is not null
  and user_id = (select auth.uid())
);

create policy novelrise_episodes_insert_owner
on public.episodes
as permissive
for insert
to authenticated
with check (
  (select auth.uid()) is not null
  and user_id = (select auth.uid())
  and exists (
    select 1
    from public.novels n
    where n.id = episodes.novel_id
      and n.user_id = (select auth.uid())
  )
);

create policy novelrise_episodes_update_owner
on public.episodes
as permissive
for update
to authenticated
using (
  (select auth.uid()) is not null
  and user_id = (select auth.uid())
  and exists (
    select 1
    from public.novels n
    where n.id = episodes.novel_id
      and n.user_id = (select auth.uid())
  )
)
with check (
  (select auth.uid()) is not null
  and user_id = (select auth.uid())
  and exists (
    select 1
    from public.novels n
    where n.id = episodes.novel_id
      and n.user_id = (select auth.uid())
  )
);

create policy novelrise_episodes_delete_owner
on public.episodes
as permissive
for delete
to authenticated
using (
  (select auth.uid()) is not null
  and user_id = (select auth.uid())
  and exists (
    select 1
    from public.novels n
    where n.id = episodes.novel_id
      and n.user_id = (select auth.uid())
  )
);

commit;
