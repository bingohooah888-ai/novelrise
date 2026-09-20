\set ON_ERROR_STOP on

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260920122000'));

do $rollback_guard$
begin
  if to_regclass('novelrise_migration_backup.founding_beta_20260920122000_founding_authors') is null
     or to_regclass('novelrise_migration_backup.founding_beta_20260920122000_preregistration_links') is null
     or to_regclass('novelrise_migration_backup.founding_beta_20260920122000_auth_users') is null then
    raise exception 'Founding/beta qualification rollback backup is missing';
  end if;

  if not exists (
    select 1
    from public.beta_participation_qualification_config c
    where c.id = 1
      and c.starts_at = timestamptz '2026-09-28 00:00:00+09'
      and c.ends_at is null
  ) then
    raise exception 'Rollback refused: beta qualification window changed after migration';
  end if;

  if exists (
    select 1
    from public.beta_participants b
    left join novelrise_migration_backup.founding_beta_20260920122000_auth_users u
      on u.id = b.auth_user_id
    where b.auth_user_id is null
       or u.id is null
       or b.qualified_at is distinct from b.auth_created_at
  ) then
    raise exception 'Rollback refused: beta participant history changed after migration';
  end if;

  if exists (
    select p.id from public.beta_author_preregistrations p
    except
    select b.id
    from novelrise_migration_backup.founding_beta_20260920122000_preregistration_links b
  ) or exists (
    select b.id
    from novelrise_migration_backup.founding_beta_20260920122000_preregistration_links b
    except
    select p.id from public.beta_author_preregistrations p
  ) then
    raise exception 'Rollback refused: preregistration population changed after migration';
  end if;

  if exists (
    select u.id from auth.users u
    except
    select b.id
    from novelrise_migration_backup.founding_beta_20260920122000_auth_users b
  ) or exists (
    select b.id
    from novelrise_migration_backup.founding_beta_20260920122000_auth_users b
    except
    select u.id from auth.users u
  ) then
    raise exception 'Rollback refused: Auth user population changed after migration';
  end if;
end
$rollback_guard$;

drop trigger if exists founding_author_exclusions_sync_participation
  on public.founding_author_exclusions;
drop trigger if exists novelight_auth_user_unlink_participation on auth.users;
drop trigger if exists novelight_auth_user_sync_participation on auth.users;
drop trigger if exists beta_author_preregistration_sync_qualification
  on public.beta_author_preregistrations;
drop trigger if exists beta_author_founding_qualification_immutable
  on public.beta_author_founding_qualifications;
drop trigger if exists beta_author_preregistration_assign_founding
  on public.beta_author_preregistrations;

drop function if exists public.novelight_admin_beta_participation_metrics();
drop function if exists public.sync_founding_exclusion_participation();
drop function if exists public.sync_auth_user_participation_after_delete();
drop function if exists public.sync_auth_user_participation_after_insert();
drop function if exists public.sync_beta_author_preregistration_link();
drop function if exists public.guard_beta_author_founding_qualification();
drop function if exists public.assign_beta_author_founding_qualification();
drop function if exists public.novelight_sync_user_participation_qualifications(uuid);
drop function if exists public.novelight_is_internal_participation_account(uuid);

update public.beta_author_preregistrations p
set
  auth_user_id = b.auth_user_id,
  registered_at = b.registered_at,
  updated_at = b.updated_at
from novelrise_migration_backup.founding_beta_20260920122000_preregistration_links b
where b.id = p.id;

drop index if exists public.beta_author_preregistrations_auth_user_unique_idx;
delete from public.founding_authors;

insert into public.founding_authors (
  author_id,
  founding_number,
  qualifying_novel_id,
  qualified_at
)
select
  b.author_id,
  b.founding_number,
  b.qualifying_novel_id,
  b.qualified_at
from novelrise_migration_backup.founding_beta_20260920122000_founding_authors b;

alter table public.founding_authors
  drop constraint if exists founding_authors_founding_number_positive;

alter table public.founding_authors
  alter column founding_number type integer using founding_number::integer,
  alter column qualifying_novel_id set not null;

alter table public.founding_authors
  add constraint founding_authors_founding_number_check
  check (founding_number between 1 and 100);

drop table public.beta_participants;
drop table public.beta_participation_qualification_config;
drop table public.beta_author_founding_qualifications;
drop table public.beta_author_founding_number_allocator;

create or replace function public.assign_founding_author()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_next integer;
begin
  if new.status <> 'published' then
    return new;
  end if;

  if exists (
    select 1
    from public.founding_author_exclusions e
    where e.user_id = new.user_id
  ) then
    return new;
  end if;

  if exists (
    select 1
    from public.founding_authors f
    where f.author_id = new.user_id
  ) then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('novelight:founding-authors'));

  if exists (
    select 1
    from public.founding_author_exclusions e
    where e.user_id = new.user_id
  ) then
    return new;
  end if;

  if exists (
    select 1
    from public.founding_authors f
    where f.author_id = new.user_id
  ) then
    return new;
  end if;

  select coalesce(max(f.founding_number), 0) + 1
  into v_next
  from public.founding_authors f;

  if v_next <= 100 then
    insert into public.founding_authors (
      author_id,
      founding_number,
      qualifying_novel_id,
      qualified_at
    ) values (
      new.user_id,
      v_next,
      new.id::text,
      now()
    )
    on conflict (author_id) do nothing;
  end if;

  return new;
end
$$;

revoke execute on function public.assign_founding_author()
  from public, anon, authenticated;
grant execute on function public.assign_founding_author() to service_role;

create trigger novels_assign_founding_author
after insert or update of status
on public.novels
for each row
when (new.status = 'published')
execute function public.assign_founding_author();

drop table novelrise_migration_backup.founding_beta_20260920122000_auth_users;
drop table novelrise_migration_backup.founding_beta_20260920122000_preregistration_links;
drop table novelrise_migration_backup.founding_beta_20260920122000_founding_authors;

commit;
