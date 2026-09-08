\set ON_ERROR_STOP on

begin;

insert into auth.users (id, raw_user_meta_data)
values
  ('91000000-0000-0000-0000-000000000001', '{"display_name":"Feed Author"}'::jsonb),
  ('91000000-0000-0000-0000-000000000002', '{}'::jsonb),
  ('91000000-0000-0000-0000-000000000003', '{}'::jsonb)
on conflict (id) do nothing;

insert into public.profiles (id, display_name)
values ('91000000-0000-0000-0000-000000000001', 'Feed Author')
on conflict (id) do update set display_name = excluded.display_name;

insert into public.novel_thumbnail_assets (
  id,
  label,
  storage_path,
  image_url,
  created_by
)
values (
  '93000000-0000-0000-0000-000000000001',
  'Feed thumbnail',
  'official/93000000-0000-0000-0000-000000000001.webp',
  'https://example.invalid/old-seeded.webp',
  '91000000-0000-0000-0000-000000000001'
);

insert into public.novels (
  id,
  user_id,
  title,
  description,
  genre,
  status,
  pv,
  created_at,
  ai_usage,
  content_policy_ack,
  content_policy_version,
  thumbnail_asset_id
)
values
  (
    990001,
    '91000000-0000-0000-0000-000000000001',
    'Old seeded work',
    'Older than the newest discovery window',
    'ファンタジー',
    'published',
    10,
    '2025-01-01T00:00:00Z',
    'human',
    true,
    'beta-v1',
    '93000000-0000-0000-0000-000000000001'
  ),
  (
    990002,
    '91000000-0000-0000-0000-000000000001',
    'Newer seeded work',
    'Newer seeded candidate',
    'SF',
    'published',
    20,
    '2026-01-01T00:00:00Z',
    'human',
    true,
    'beta-v1',
    null
  ),
  (
    990003,
    '91000000-0000-0000-0000-000000000001',
    'Unseeded work',
    'Must not enter the seed feed',
    '現代ドラマ',
    'published',
    30,
    '2026-04-01T00:00:00Z',
    'human',
    true,
    'beta-v1',
    null
  ),
  (
    990004,
    '91000000-0000-0000-0000-000000000001',
    'Draft seeded work',
    'Must remain private',
    'ミステリー',
    'draft',
    0,
    '2026-05-01T00:00:00Z',
    'unspecified',
    false,
    null,
    null
  );

insert into public.novels (
  id,
  user_id,
  title,
  description,
  genre,
  status,
  pv,
  created_at,
  ai_usage,
  content_policy_ack,
  content_policy_version
)
select
  990100 + series.n,
  '91000000-0000-0000-0000-000000000001',
  'Newer unseeded ' || series.n,
  'Keeps the old seeded work outside the newest ten',
  'ファンタジー',
  'published',
  0,
  '2026-03-01T00:00:00Z'::timestamptz + (series.n || ' minutes')::interval,
  'human',
  true,
  'beta-v1'
from generate_series(1, 12) as series(n);

insert into public.light_seeds (
  id,
  reader_id,
  novel_id_snapshot,
  author_id_snapshot,
  seeded_at,
  seed_month,
  pv_at_seed,
  favorites_at_seed,
  rule_version
)
values
  (
    '92000000-0000-0000-0000-000000000001',
    '91000000-0000-0000-0000-000000000002',
    '990001',
    '91000000-0000-0000-0000-000000000001',
    '2025-01-02T00:00:00Z',
    '2025-01-01',
    0,
    0,
    'beta-v1'
  ),
  (
    '92000000-0000-0000-0000-000000000002',
    '91000000-0000-0000-0000-000000000003',
    '990001',
    '91000000-0000-0000-0000-000000000001',
    '2025-01-03T00:00:00Z',
    '2025-01-01',
    0,
    0,
    'beta-v1'
  ),
  (
    '92000000-0000-0000-0000-000000000003',
    '91000000-0000-0000-0000-000000000002',
    '990002',
    '91000000-0000-0000-0000-000000000001',
    '2026-01-02T00:00:00Z',
    '2026-01-01',
    0,
    0,
    'beta-v1'
  ),
  (
    '92000000-0000-0000-0000-000000000004',
    '91000000-0000-0000-0000-000000000002',
    '990004',
    '91000000-0000-0000-0000-000000000001',
    '2026-05-02T00:00:00Z',
    '2026-05-01',
    0,
    0,
    'beta-v1'
  );

do $$
declare
  v_first text;
  v_old_seed_count bigint;
  v_old_author text;
  v_old_thumbnail text;
begin
  if exists (
    select 1
    from public.novelight_neutral_search(null, null, 'new', 10, 0)
    where novel_id = '990001'
  ) then
    raise exception 'Fixture invalid: old seeded work unexpectedly appears in newest ten';
  end if;

  if (select count(*) from public.novelight_light_seed_feed(100, 0)) <> 2 then
    raise exception 'LIGHT SEED feed must contain exactly the two published seeded works';
  end if;

  select novel_id
  into v_first
  from public.novelight_light_seed_feed(100, 0)
  limit 1;

  if v_first <> '990002' then
    raise exception 'LIGHT SEED feed must preserve newest-first discovery ordering';
  end if;

  select light_seed_count, author_name, thumbnail_url
  into v_old_seed_count, v_old_author, v_old_thumbnail
  from public.novelight_light_seed_feed(100, 0)
  where novel_id = '990001';

  if v_old_seed_count <> 2 then
    raise exception 'Old seeded work must report the real LIGHT SEED count';
  end if;

  if v_old_author <> 'Feed Author' then
    raise exception 'LIGHT SEED feed must return the public author name';
  end if;

  if v_old_thumbnail <> 'https://example.invalid/old-seeded.webp' then
    raise exception 'LIGHT SEED feed must return the official thumbnail URL';
  end if;

  if exists (
    select 1 from public.novelight_light_seed_feed(100, 0) where novel_id = '990003'
  ) then
    raise exception 'Unseeded work must not enter the LIGHT SEED feed';
  end if;

  if exists (
    select 1 from public.novelight_light_seed_feed(100, 0) where novel_id = '990004'
  ) then
    raise exception 'Draft work must not enter the LIGHT SEED feed';
  end if;
end
$$;

rollback;
