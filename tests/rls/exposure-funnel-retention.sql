\set ON_ERROR_STOP on

begin;

-- Use a dedicated work so earlier exposure-allocation tests cannot change the
-- expected impression count for this retention test.
insert into public.novels (
  id,
  user_id,
  title,
  genre,
  description,
  status,
  pv,
  created_at
) values (
  '82000000-0000-0000-0000-000000000001',
  '33333333-3333-3333-3333-333333333333',
  'Retention funnel work',
  'SF',
  'isolated retention fixture',
  'published',
  0,
  now() - interval '1 day'
);

insert into public.episodes (
  id,
  novel_id,
  user_id,
  episode_number,
  status
) values
  ('82100000-0000-0000-0000-000000000001', '82000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 1, 'published'),
  ('82100000-0000-0000-0000-000000000002', '82000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 2, 'published');

-- One exposure can now retain separate first- and second-episode read signals.
set role anon;
select set_config('request.jwt.claim.sub', '', false);

select public.test_assert(
  public.record_novel_impressions(
    'home_discovery',
    array['82000000-0000-0000-0000-000000000001'],
    'visitor-retention-reader-0001'
  ) = 1,
  'retention fixture impression must be recorded'
);

select public.test_assert(
  public.record_novel_exposure_conversion(
    'detail_open',
    '82000000-0000-0000-0000-000000000001',
    null,
    'visitor-retention-reader-0001'
  ),
  'retention fixture detail open must be attributed'
);

select public.test_assert(
  public.record_novel_exposure_conversion(
    'episode_read_10s',
    '82000000-0000-0000-0000-000000000001',
    '82100000-0000-0000-0000-000000000001',
    'visitor-retention-reader-0001'
  ),
  'first episode 10-second read must be attributed'
);

select public.test_assert(
  public.record_novel_exposure_conversion(
    'episode_read_10s',
    '82000000-0000-0000-0000-000000000001',
    '82100000-0000-0000-0000-000000000002',
    'visitor-retention-reader-0001'
  ),
  'second episode 10-second read must be stored separately'
);

select public.test_assert(
  not public.record_novel_exposure_conversion(
    'episode_read_10s',
    '82000000-0000-0000-0000-000000000001',
    '82100000-0000-0000-0000-000000000002',
    'visitor-retention-reader-0001'
  ),
  'the same episode read must not be counted twice for one exposure'
);

reset role;

-- Favorite conversion must require both a real authenticated exposure and an
-- actual favorite row; a client cannot simply claim a favorite event.
set role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '44444444-4444-4444-4444-444444444444',
  false
);

select public.test_assert(
  public.record_novel_impressions(
    'home_discovery',
    array['82000000-0000-0000-0000-000000000001'],
    null
  ) = 1,
  'authenticated favorite fixture impression must be recorded'
);

select public.test_assert(
  not public.record_novel_exposure_conversion(
    'favorite_added',
    '82000000-0000-0000-0000-000000000001',
    null,
    null
  ),
  'favorite event must fail when no favorite row exists'
);

reset role;

insert into public.favorites (user_id, novel_id) values (
  '44444444-4444-4444-4444-444444444444',
  '82000000-0000-0000-0000-000000000001'
);

set role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '44444444-4444-4444-4444-444444444444',
  false
);

select public.test_assert(
  public.record_novel_exposure_conversion(
    'favorite_added',
    '82000000-0000-0000-0000-000000000001',
    null,
    null
  ),
  'real favorite after a recent impression must be attributed'
);

select public.test_assert(
  not public.record_novel_exposure_conversion(
    'favorite_added',
    '82000000-0000-0000-0000-000000000001',
    null,
    null
  ),
  'the same favorite conversion must not count twice for one exposure'
);

reset role;

-- Author aggregate uses one body-read conversion per exposure even when that
-- exposure produced multiple per-episode read rows, preventing rates > 100%.
set role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '33333333-3333-3333-3333-333333333333',
  false
);

select public.test_assert(
  exists (
    select 1
    from public.novelight_author_exposure_funnel(30)
    where novel_id = '82000000-0000-0000-0000-000000000001'
      and impressions = 2
      and detail_opens = 1
      and body_reads_10s = 1
      and first_episode_reads_10s = 1
      and continued_to_episode_2 = 1
      and episode1_to_episode2_rate_pct = 100.00
      and favorites = 1
      and favorite_rate_pct = 50.00
  ),
  'author funnel must report first-to-second episode retention and attributed favorites'
);

reset role;

select public.test_assert(
  (
    select count(*)
    from public.novel_exposure_conversions c
    join public.novel_exposure_events e on e.id = c.exposure_id
    where e.novel_id_snapshot = '82000000-0000-0000-0000-000000000001'
      and c.event_type = 'episode_read_10s'
  ) = 2,
  'raw ledger must preserve separate first- and second-episode read signals'
);

rollback;

select 'PASS: exposure funnel retention and favorite attribution' as result;
