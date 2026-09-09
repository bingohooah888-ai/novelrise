\set ON_ERROR_STOP on

-- The compact beta-P0 fixture predates a few production metric columns. Add only
-- the production-shape fields required by the Chapter 38 Rank engine.
alter table public.novels
  add column if not exists pv bigint not null default 0;

alter table public.episodes
  add column if not exists created_at timestamptz not null default now();

update public.novels
set first_published_at = coalesce(first_published_at, now())
where status = 'published';

update public.episodes
set created_at = coalesce(created_at, now());
