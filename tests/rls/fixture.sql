\set ON_ERROR_STOP on

create schema if not exists auth;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;

  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end
$$;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

create table public.novels (
  id uuid primary key,
  user_id uuid not null,
  status text not null
);

create table public.episodes (
  id uuid primary key,
  novel_id uuid not null references public.novels(id),
  user_id uuid not null,
  episode_number integer not null,
  status text not null
);

create table public.favorites (
  user_id uuid not null,
  novel_id uuid not null references public.novels(id)
);

grant select on public.novels, public.episodes to anon, authenticated;

insert into public.novels (id, user_id, status) values
  ('10000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'published'),
  ('10000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'draft'),
  ('20000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'published'),
  ('20000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'draft');

insert into public.episodes (
  id,
  novel_id,
  user_id,
  episode_number,
  status
) values
  ('11000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 1, 'published'),
  ('11000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 2, 'draft'),
  ('11000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 1, 'published'),
  ('22000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 1, 'published'),
  ('22000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 2, 'draft'),
  ('22000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 1, 'published');

insert into public.favorites (user_id, novel_id) values
  ('11111111-1111-1111-1111-111111111111', '20000000-0000-0000-0000-000000000001');

create or replace function public.test_assert(condition boolean, message text)
returns void
language plpgsql
as $$
begin
  if not coalesce(condition, false) then
    raise exception 'RLS assertion failed: %', message;
  end if;
end
$$;

grant execute on function public.test_assert(boolean, text) to anon, authenticated;
