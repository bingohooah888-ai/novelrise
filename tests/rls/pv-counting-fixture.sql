\set ON_ERROR_STOP on

-- Compact RLS fixtures predate the production PV columns. Add only the fields
-- required to exercise the authoritative counting migration.
alter table public.novels
  add column if not exists pv bigint not null default 0;

alter table public.episodes
  add column if not exists pv bigint not null default 0;

update public.novels
   set pv = 0
 where id = '10000000-0000-0000-0000-000000000001';

update public.episodes
   set pv = 0
 where id in (
   '11000000-0000-0000-0000-000000000001',
   '22000000-0000-0000-0000-000000000001'
 );
