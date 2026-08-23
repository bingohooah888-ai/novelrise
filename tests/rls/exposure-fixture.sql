\set ON_ERROR_STOP on

-- The compact RLS fixture intentionally contains only permission-critical
-- columns. Add the production discovery columns required by the exposure
-- allocator before inserting dedicated feed fixtures. LIGHT SEED has already
-- added `pv` earlier in the CI sequence.
alter table public.novels
  add column if not exists title text;

alter table public.novels
  add column if not exists genre text;

alter table public.novels
  add column if not exists description text;

alter table public.novels
  add column if not exists created_at timestamptz not null default now();

-- Add dedicated works for exposure allocation tests. These fixture inserts run
-- without an end-user JWT, so plan posting limits intentionally do not gate them.
insert into public.novels (
  id,
  user_id,
  title,
  genre,
  description,
  status,
  pv,
  created_at
) values
  ('81000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'Free discovery work', 'SF', 'free exposure fixture', 'published', 0, now() - interval '10 days'),
  ('81000000-0000-0000-0000-000000000002', '44444444-4444-4444-4444-444444444444', 'Standard discovery work', 'SF', 'standard exposure fixture', 'published', 0, now() - interval '10 days'),
  ('81000000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555555', 'Premium new discovery work', 'SF', 'premium exposure fixture', 'published', 0, now() - interval '12 hours'),
  ('81000000-0000-0000-0000-000000000004', '55555555-5555-5555-5555-555555555555', 'Premium older discovery work', '恋愛', 'premium second fixture', 'published', 0, now() - interval '10 days');
