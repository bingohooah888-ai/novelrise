-- NOVELIGHT strict beta audit hardening.
--
-- Goals:
-- - raw profile rows are readable only by their owner; public author cards use a narrow RPC
-- - raw favorite rows are readable only by their owner; public counts use aggregate RPCs
-- - neutral search and ranking aggregate favorite counts in PostgreSQL instead of N+1 browser queries
-- - preserve the previous SELECT policies/grants and RLS state so rollback is deterministic

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260828223000'));

create schema if not exists novelrise_migration_backup;
revoke all on schema novelrise_migration_backup from public;
revoke all on schema novelrise_migration_backup from anon, authenticated;

create table if not exists novelrise_migration_backup.table_select_grants (
  migration_id text not null,
  table_name text not null,
  role_name text not null,
  had_select boolean not null,
  primary key (migration_id, table_name, role_name)
);

create table if not exists novelrise_migration_backup.select_policies (
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

create table if not exists novelrise_migration_backup.table_rls_state (
  migration_id text not null,
  table_name text not null,
  was_enabled boolean not null,
  was_forced boolean not null,
  primary key (migration_id, table_name)
);

do $$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.favorites') is null
     or to_regclass('public.novels') is null then
    raise exception 'profiles, favorites, and novels are required';
  end if;

  if exists (
    select 1
    from novelrise_migration_backup.table_select_grants
    where migration_id = '20260828223000'
  ) or exists (
    select 1
    from novelrise_migration_backup.select_policies
    where migration_id = '20260828223000'
  ) or exists (
    select 1
    from novelrise_migration_backup.table_rls_state
    where migration_id = '20260828223000'
  ) then
    raise exception 'Migration 20260828223000 already has backup state; stop and inspect before retrying';
  end if;
end
$$;

insert into novelrise_migration_backup.table_select_grants (
  migration_id,
  table_name,
  role_name,
  had_select
)
select
  '20260828223000',
  t.table_name,
  r.role_name,
  exists (
    select 1
    from information_schema.table_privileges p
    where p.table_schema = 'public'
      and p.table_name = t.table_name
      and p.grantee = r.role_name
      and p.privilege_type = 'SELECT'
  )
from (values ('profiles'), ('favorites')) as t(table_name)
cross join (values ('anon'), ('authenticated')) as r(role_name);

insert into novelrise_migration_backup.select_policies (
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
  '20260828223000',
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
  and tablename in ('profiles', 'favorites')
  and cmd = 'SELECT';

insert into novelrise_migration_backup.table_rls_state (
  migration_id,
  table_name,
  was_enabled,
  was_forced
)
select
  '20260828223000',
  c.relname,
  c.relrowsecurity,
  c.relforcerowsecurity
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('profiles', 'favorites')
  and c.relkind in ('r', 'p');

do $$
declare
  p record;
begin
  for p in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('profiles', 'favorites')
      and cmd = 'SELECT'
  loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end
$$;

alter table public.profiles enable row level security;
alter table public.favorites enable row level security;

revoke select on table public.profiles from anon, authenticated;
revoke select on table public.favorites from anon, authenticated;
grant select on table public.profiles to authenticated;
grant select on table public.favorites to authenticated;

create policy novelight_profiles_select_own
on public.profiles
for select
to authenticated
using ((select auth.uid()) is not null and id = (select auth.uid()));

create policy novelight_favorites_select_own
on public.favorites
for select
to authenticated
using ((select auth.uid()) is not null and user_id = (select auth.uid()));

create or replace function public.novelight_public_profile(p_user_id uuid)
returns table (
  id uuid,
  display_name text,
  bio text
)
language sql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
  select p.id, p.display_name, p.bio
  from public.profiles p
  where p.id = p_user_id
    and (
      p.id = (select auth.uid())
      or exists (
        select 1
        from public.novels n
        where n.user_id = p.id
          and n.status = 'published'
      )
    )
  limit 1
$$;

revoke all on function public.novelight_public_profile(uuid) from public;
grant execute on function public.novelight_public_profile(uuid) to anon, authenticated;

create or replace function public.novelight_favorite_count(p_novel_id text)
returns bigint
language sql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
  select case
    when exists (
      select 1
      from public.novels n
      where n.id::text = p_novel_id
        and (
          n.status = 'published'
          or ((select auth.uid()) is not null and n.user_id = (select auth.uid()))
        )
    ) then (
      select count(*)::bigint
      from public.favorites f
      where f.novel_id::text = p_novel_id
    )
    else 0::bigint
  end
$$;

revoke all on function public.novelight_favorite_count(text) from public;
grant execute on function public.novelight_favorite_count(text) to anon, authenticated;

create or replace function public.novelight_neutral_search(
  p_keyword text default null,
  p_genre text default null,
  p_sort text default 'new',
  p_limit integer default 24,
  p_offset integer default 0
)
returns table (
  novel_id text,
  title text,
  genre text,
  description text,
  created_at timestamptz,
  pv bigint,
  favorite_count bigint,
  total_count bigint
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with candidates as (
    select
      n.id::text as novel_id,
      n.title,
      n.genre,
      n.description,
      n.created_at,
      coalesce(n.pv, 0)::bigint as pv,
      (
        select count(*)::bigint
        from public.favorites f
        where f.novel_id::text = n.id::text
      ) as favorite_count
    from public.novels n
    where n.status = 'published'
      and (
        nullif(btrim(coalesce(p_keyword, '')), '') is null
        or coalesce(n.title, '') ilike '%' || btrim(p_keyword) || '%'
        or coalesce(n.description, '') ilike '%' || btrim(p_keyword) || '%'
      )
      and (
        nullif(btrim(coalesce(p_genre, '')), '') is null
        or n.genre = btrim(p_genre)
      )
  ), counted as (
    select c.*, count(*) over ()::bigint as total_count
    from candidates c
  )
  select
    c.novel_id,
    c.title,
    c.genre,
    c.description,
    c.created_at,
    c.pv,
    c.favorite_count,
    c.total_count
  from counted c
  order by
    case when p_sort = 'pv' then c.pv end desc nulls last,
    case when p_sort = 'favorites' then c.favorite_count end desc nulls last,
    c.created_at desc,
    c.novel_id asc
  limit least(greatest(coalesce(p_limit, 24), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0)
$$;

revoke all on function public.novelight_neutral_search(text, text, text, integer, integer) from public;
grant execute on function public.novelight_neutral_search(text, text, text, integer, integer) to anon, authenticated;

create or replace function public.novelight_ranking_feed(
  p_sort text default 'total',
  p_limit integer default 100
)
returns table (
  novel_id text,
  title text,
  genre text,
  description text,
  created_at timestamptz,
  pv bigint,
  favorite_count bigint,
  score bigint
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with candidates as (
    select
      n.id::text as novel_id,
      n.title,
      n.genre,
      n.description,
      n.created_at,
      coalesce(n.pv, 0)::bigint as pv,
      (
        select count(*)::bigint
        from public.favorites f
        where f.novel_id::text = n.id::text
      ) as favorite_count
    from public.novels n
    where n.status = 'published'
  )
  select
    c.novel_id,
    c.title,
    c.genre,
    c.description,
    c.created_at,
    c.pv,
    c.favorite_count,
    (c.pv + c.favorite_count * 10)::bigint as score
  from candidates c
  order by
    case when p_sort = 'new' then c.created_at end desc nulls last,
    case when p_sort = 'pv' then c.pv end desc nulls last,
    case when p_sort = 'favorites' then c.favorite_count end desc nulls last,
    case when p_sort not in ('new', 'pv', 'favorites') then (c.pv + c.favorite_count * 10) end desc nulls last,
    c.created_at desc,
    c.novel_id asc
  limit least(greatest(coalesce(p_limit, 100), 1), 100)
$$;

revoke all on function public.novelight_ranking_feed(text, integer) from public;
grant execute on function public.novelight_ranking_feed(text, integer) to anon, authenticated;

commit;
