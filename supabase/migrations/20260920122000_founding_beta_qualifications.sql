-- NOVELIGHT: make preregistration order the permanent Founding Author source of truth.
-- Records beta participation separately and keeps internal/test accounts out of both ledgers.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260920122000'));

create schema if not exists novelrise_migration_backup;
revoke all on schema novelrise_migration_backup from public, anon, authenticated;

create table novelrise_migration_backup.founding_beta_20260920122000_founding_authors
as table public.founding_authors with no data;

insert into novelrise_migration_backup.founding_beta_20260920122000_founding_authors
select * from public.founding_authors;

create table novelrise_migration_backup.founding_beta_20260920122000_preregistration_links as
select
  p.id,
  p.auth_user_id,
  p.registered_at,
  p.updated_at
from public.beta_author_preregistrations p;

create table novelrise_migration_backup.founding_beta_20260920122000_auth_users as
select u.id
from auth.users u;

create table public.beta_author_founding_number_allocator (
  id smallint primary key,
  last_number bigint not null check (last_number >= 0),
  updated_at timestamptz not null default now(),
  constraint beta_author_founding_number_allocator_singleton check (id = 1)
);

create table public.beta_author_founding_qualifications (
  preregistration_id bigint primary key
    references public.beta_author_preregistrations(id) on delete restrict,
  founding_number bigint not null unique check (founding_number > 0),
  qualified_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.beta_author_founding_number_allocator enable row level security;
alter table public.beta_author_founding_qualifications enable row level security;

revoke all on table public.beta_author_founding_number_allocator
  from public, anon, authenticated;
revoke all on table public.beta_author_founding_qualifications
  from public, anon, authenticated;

grant select on table public.beta_author_founding_qualifications to service_role;

insert into public.beta_author_founding_qualifications (
  preregistration_id,
  founding_number,
  qualified_at
)
select
  p.id,
  row_number() over (order by p.created_at asc, p.id asc)::bigint,
  p.created_at
from public.beta_author_preregistrations p
order by p.created_at asc, p.id asc;

insert into public.beta_author_founding_number_allocator (id, last_number)
select 1, coalesce(max(q.founding_number), 0)
from public.beta_author_founding_qualifications q;

create unique index beta_author_preregistrations_auth_user_unique_idx
  on public.beta_author_preregistrations (auth_user_id)
  where auth_user_id is not null;

alter table public.founding_authors
  drop constraint if exists founding_authors_founding_number_check;

alter table public.founding_authors
  alter column founding_number type bigint using founding_number::bigint,
  alter column qualifying_novel_id drop not null;

alter table public.founding_authors
  add constraint founding_authors_founding_number_positive
  check (founding_number > 0);

delete from public.founding_authors;

create table public.beta_participation_qualification_config (
  id smallint primary key,
  starts_at timestamptz not null,
  ends_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint beta_participation_qualification_config_singleton check (id = 1),
  constraint beta_participation_qualification_window check (
    ends_at is null or ends_at > starts_at
  )
);

insert into public.beta_participation_qualification_config (
  id,
  starts_at,
  ends_at
) values (
  1,
  timestamptz '2026-09-28 00:00:00+09',
  null
);

create table public.beta_participants (
  id bigint generated always as identity primary key,
  auth_user_id uuid unique,
  email_normalized text not null unique,
  qualified_at timestamptz not null,
  auth_created_at timestamptz not null,
  linked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint beta_participants_email_length
    check (char_length(email_normalized) between 5 and 254)
);

alter table public.beta_participation_qualification_config enable row level security;
alter table public.beta_participants enable row level security;
revoke all on table public.beta_participation_qualification_config
  from public, anon, authenticated;
revoke all on table public.beta_participants
  from public, anon, authenticated;
revoke all on sequence public.beta_participants_id_seq
  from public, anon, authenticated;
grant select, insert, update, delete on table public.beta_participants to service_role;
grant usage, select on sequence public.beta_participants_id_seq to service_role;

create or replace function public.novelight_is_internal_participation_account(
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
  select
    exists (
      select 1
      from public.founding_author_exclusions e
      where e.user_id = p_user_id
    )
    or exists (
      select 1
      from auth.users u
      where u.id = p_user_id
        and lower(coalesce(u.raw_app_meta_data ->> 'internal_e2e', 'false'))
          in ('true', '1', 'yes')
    )
$$;

revoke all on function public.novelight_is_internal_participation_account(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.novelight_sync_user_participation_qualifications(
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_email text;
  v_created_at timestamptz;
  v_preregistration_id bigint;
  v_preregistration_status text;
  v_linked_user uuid;
  v_number bigint;
  v_qualified_at timestamptz;
  v_beta_start timestamptz;
  v_beta_end timestamptz;
  v_beta_id bigint;
  v_beta_matches integer;
begin
  select
    lower(btrim(coalesce(u.email, ''))),
    u.created_at
  into v_email, v_created_at
  from auth.users u
  where u.id = p_user_id;

  if not found then
    delete from public.founding_authors f
    where f.author_id = p_user_id;
    return;
  end if;

  if public.novelight_is_internal_participation_account(p_user_id) then
    delete from public.founding_authors f
    where f.author_id = p_user_id;
    delete from public.beta_participants b
    where b.auth_user_id = p_user_id
       or (v_email <> '' and b.email_normalized = v_email);
    return;
  end if;

  select
    p.id,
    p.status,
    p.auth_user_id,
    q.founding_number,
    q.qualified_at
  into
    v_preregistration_id,
    v_preregistration_status,
    v_linked_user,
    v_number,
    v_qualified_at
  from public.beta_author_preregistrations p
  join public.beta_author_founding_qualifications q
    on q.preregistration_id = p.id
  where p.auth_user_id = p_user_id
     or (v_email <> '' and p.email_normalized = v_email)
  order by
    case when p.auth_user_id = p_user_id then 0 else 1 end,
    p.id
  limit 1;

  if found then
    if v_linked_user is not null
       and v_linked_user <> p_user_id
       and exists (select 1 from auth.users u where u.id = v_linked_user) then
      raise exception 'Preregistration % is already linked to another active Auth user',
        v_preregistration_id;
    end if;

    update public.beta_author_preregistrations p
    set
      auth_user_id = p_user_id,
      registered_at = coalesce(p.registered_at, v_created_at),
      updated_at = case
        when p.auth_user_id is distinct from p_user_id
          or p.registered_at is null
        then now()
        else p.updated_at
      end
    where p.id = v_preregistration_id
      and (
        p.auth_user_id is distinct from p_user_id
        or p.registered_at is null
      );

    if v_preregistration_status <> 'cancelled' then
      insert into public.founding_authors (
        author_id,
        founding_number,
        qualifying_novel_id,
        qualified_at
      ) values (
        p_user_id,
        v_number,
        null,
        v_qualified_at
      )
      on conflict (author_id) do update
        set founding_number = excluded.founding_number,
            qualifying_novel_id = null,
            qualified_at = excluded.qualified_at;
    else
      delete from public.founding_authors f
      where f.author_id = p_user_id;
    end if;
  else
    delete from public.founding_authors f
    where f.author_id = p_user_id;
  end if;

  select c.starts_at, c.ends_at
  into v_beta_start, v_beta_end
  from public.beta_participation_qualification_config c
  where c.id = 1;

  if v_email <> ''
     and v_created_at >= v_beta_start
     and (v_beta_end is null or v_created_at < v_beta_end) then
    select count(*)::integer, min(b.id)
    into v_beta_matches, v_beta_id
    from public.beta_participants b
    where b.auth_user_id = p_user_id
       or b.email_normalized = v_email;

    if v_beta_matches > 1 then
      raise exception 'Conflicting beta participant identities for Auth user %', p_user_id;
    elsif v_beta_matches = 1 then
      update public.beta_participants b
      set
        auth_user_id = p_user_id,
        email_normalized = v_email,
        auth_created_at = least(b.auth_created_at, v_created_at),
        qualified_at = least(b.qualified_at, v_created_at),
        linked_at = now(),
        updated_at = now()
      where b.id = v_beta_id;
    else
      insert into public.beta_participants (
        auth_user_id,
        email_normalized,
        qualified_at,
        auth_created_at,
        linked_at
      ) values (
        p_user_id,
        v_email,
        v_created_at,
        v_created_at,
        now()
      );
    end if;
  end if;
end
$$;

revoke all on function public.novelight_sync_user_participation_qualifications(uuid)
  from public, anon, authenticated;
grant execute on function public.novelight_sync_user_participation_qualifications(uuid)
  to service_role;

create or replace function public.assign_beta_author_founding_qualification()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_number bigint;
  v_user_id uuid;
  v_user_matches integer;
begin
  update public.beta_author_founding_number_allocator a
  set last_number = a.last_number + 1,
      updated_at = now()
  where a.id = 1
  returning a.last_number into v_number;

  if v_number is null then
    raise exception 'Founding number allocator is unavailable';
  end if;

  insert into public.beta_author_founding_qualifications (
    preregistration_id,
    founding_number,
    qualified_at
  ) values (
    new.id,
    v_number,
    new.created_at
  );

  select count(*)::integer, (array_agg(u.id order by u.id))[1]
  into v_user_matches, v_user_id
  from auth.users u
  where lower(btrim(coalesce(u.email, ''))) = new.email_normalized;

  if v_user_matches > 1 then
    raise exception 'Multiple Auth users match preregistration %', new.id;
  elsif v_user_matches = 1 then
    perform public.novelight_sync_user_participation_qualifications(v_user_id);
  end if;

  return new;
end
$$;

revoke all on function public.assign_beta_author_founding_qualification()
  from public, anon, authenticated, service_role;

create trigger beta_author_preregistration_assign_founding
after insert on public.beta_author_preregistrations
for each row
execute function public.assign_beta_author_founding_qualification();

create or replace function public.guard_beta_author_founding_qualification()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  raise exception 'Founding preregistration numbers are immutable';
end
$$;

revoke all on function public.guard_beta_author_founding_qualification()
  from public, anon, authenticated, service_role;

create trigger beta_author_founding_qualification_immutable
before update or delete on public.beta_author_founding_qualifications
for each row
execute function public.guard_beta_author_founding_qualification();

create or replace function public.sync_beta_author_preregistration_link()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.auth_user_id is not null then
    perform public.novelight_sync_user_participation_qualifications(new.auth_user_id);
  end if;

  if old.auth_user_id is not null
     and old.auth_user_id is distinct from new.auth_user_id then
    perform public.novelight_sync_user_participation_qualifications(old.auth_user_id);
  end if;

  return new;
end
$$;

revoke all on function public.sync_beta_author_preregistration_link()
  from public, anon, authenticated, service_role;

create trigger beta_author_preregistration_sync_qualification
after update of status, auth_user_id on public.beta_author_preregistrations
for each row
when (
  old.status is distinct from new.status
  or old.auth_user_id is distinct from new.auth_user_id
)
execute function public.sync_beta_author_preregistration_link();

create or replace function public.sync_auth_user_participation_after_insert()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.novelight_sync_user_participation_qualifications(new.id);
  return new;
end
$$;

revoke all on function public.sync_auth_user_participation_after_insert()
  from public, anon, authenticated, service_role;

create trigger novelight_auth_user_sync_participation
after insert on auth.users
for each row
execute function public.sync_auth_user_participation_after_insert();

create or replace function public.sync_auth_user_participation_after_delete()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_internal boolean;
  v_email text := lower(btrim(coalesce(old.email, '')));
begin
  v_internal :=
    lower(coalesce(old.raw_app_meta_data ->> 'internal_e2e', 'false'))
      in ('true', '1', 'yes')
    or exists (
      select 1
      from public.founding_author_exclusions e
      where e.user_id = old.id
    );

  update public.beta_author_preregistrations p
  set
    auth_user_id = null,
    updated_at = now()
  where p.auth_user_id = old.id;

  delete from public.founding_authors f
  where f.author_id = old.id;

  if v_internal then
    delete from public.beta_participants b
    where b.auth_user_id = old.id
       or (v_email <> '' and b.email_normalized = v_email);
  else
    update public.beta_participants b
    set auth_user_id = null,
        linked_at = null,
        updated_at = now()
    where b.auth_user_id = old.id;
  end if;

  return old;
end
$$;

revoke all on function public.sync_auth_user_participation_after_delete()
  from public, anon, authenticated, service_role;

create trigger novelight_auth_user_unlink_participation
after delete on auth.users
for each row
execute function public.sync_auth_user_participation_after_delete();

create or replace function public.sync_founding_exclusion_participation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid;
begin
  v_user_id := coalesce(new.user_id, old.user_id);

  if tg_op in ('INSERT', 'UPDATE') then
    delete from public.founding_authors f
    where f.author_id = v_user_id;

    delete from public.beta_participants b
    where b.auth_user_id = v_user_id;
  elsif tg_op = 'DELETE' then
    perform public.novelight_sync_user_participation_qualifications(v_user_id);
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end
$$;

revoke all on function public.sync_founding_exclusion_participation()
  from public, anon, authenticated, service_role;

create trigger founding_author_exclusions_sync_participation
after insert or update or delete on public.founding_author_exclusions
for each row
execute function public.sync_founding_exclusion_participation();

drop trigger if exists novels_assign_founding_author on public.novels;
drop function if exists public.assign_founding_author();

do $sync_existing$
declare
  v_user record;
begin
  for v_user in
    select u.id
    from auth.users u
    where exists (
      select 1
      from public.beta_author_preregistrations p
      where p.auth_user_id = u.id
         or p.email_normalized = lower(btrim(coalesce(u.email, '')))
    )
    or exists (
      select 1
      from public.beta_participation_qualification_config c
      where c.id = 1
        and u.created_at >= c.starts_at
        and (c.ends_at is null or u.created_at < c.ends_at)
    )
  loop
    perform public.novelight_sync_user_participation_qualifications(v_user.id);
  end loop;
end
$sync_existing$;
create or replace function public.novelight_admin_beta_participation_metrics()
returns table (
  valid_preregistrations bigint,
  latest_founding_number bigint,
  linked_preregistrations bigint,
  beta_participants bigint,
  founding_badge_eligible bigint,
  beta_badge_eligible bigint
)
language sql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
  select
    (
      select count(*)::bigint
      from public.beta_author_preregistrations p
      where p.status <> 'cancelled'
        and (
          p.auth_user_id is null
          or not public.novelight_is_internal_participation_account(p.auth_user_id)
        )
    ),
    (
      select a.last_number::bigint
      from public.beta_author_founding_number_allocator a
      where a.id = 1
    ),
    (
      select count(*)::bigint
      from public.beta_author_preregistrations p
      where p.status <> 'cancelled'
        and p.auth_user_id is not null
        and exists (select 1 from auth.users u where u.id = p.auth_user_id)
        and not public.novelight_is_internal_participation_account(p.auth_user_id)
    ),
    (
      select count(*)::bigint
      from public.beta_participants b
    ),
    (
      select count(*)::bigint
      from public.founding_authors f
    ),
    (
      select count(*)::bigint
      from public.beta_participants b
      where b.auth_user_id is not null
        and exists (select 1 from auth.users u where u.id = b.auth_user_id)
        and not public.novelight_is_internal_participation_account(b.auth_user_id)
    )
$$;

revoke all on function public.novelight_admin_beta_participation_metrics()
  from public, anon, authenticated;
grant execute on function public.novelight_admin_beta_participation_metrics()
  to service_role;

comment on table public.beta_author_founding_qualifications is
  'Private immutable ledger of preregistration-order Founding Author numbers. Numbers never renumber or reuse.';
comment on table public.beta_participants is
  'Private permanent beta-participant qualification ledger. It intentionally has no ordinal number.';
comment on function public.novelight_admin_beta_participation_metrics() is
  'Service-role-only aggregate counts for Founding Author and beta participant qualification operations.';

commit;
