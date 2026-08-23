\set ON_ERROR_STOP on

select public.test_assert(
  not has_table_privilege('anon', 'public.novel_exposure_conversions', 'SELECT')
  and not has_table_privilege('authenticated', 'public.novel_exposure_conversions', 'SELECT')
  and not has_table_privilege('anon', 'public.novel_exposure_conversions', 'INSERT')
  and not has_table_privilege('authenticated', 'public.novel_exposure_conversions', 'INSERT'),
  'clients must not access the raw exposure conversion ledger'
);

-- A real impression can convert into detail and meaningful body reading.
set role anon;
select set_config('request.jwt.claim.sub', '', false);

select public.test_assert(
  public.record_novel_impressions(
    'home_discovery',
    array['10000000-0000-0000-0000-000000000001'],
    'visitor-funnel-reader-0001'
  ) = 1,
  'funnel fixture impression must be recorded'
);

select public.test_assert(
  public.record_novel_exposure_conversion(
    'detail_open',
    '10000000-0000-0000-0000-000000000001',
    null,
    'visitor-funnel-reader-0001'
  ),
  'detail open should attribute to the recent real impression'
);

select public.test_assert(
  not public.record_novel_exposure_conversion(
    'detail_open',
    '10000000-0000-0000-0000-000000000001',
    null,
    'visitor-funnel-reader-0001'
  ),
  'the same exposure must not count detail conversion twice'
);

select public.test_assert(
  public.record_novel_exposure_conversion(
    'episode_read_10s',
    '10000000-0000-0000-0000-000000000001',
    '11000000-0000-0000-0000-000000000001',
    'visitor-funnel-reader-0001'
  ),
  'published episode read should attribute to the recent impression'
);

select public.test_assert(
  not public.record_novel_exposure_conversion(
    'episode_read_10s',
    '10000000-0000-0000-0000-000000000001',
    '11000000-0000-0000-0000-000000000001',
    'visitor-funnel-reader-0001'
  ),
  'the same exposure must not count meaningful reading twice'
);

select public.test_assert(
  not public.record_novel_exposure_conversion(
    'detail_open',
    '20000000-0000-0000-0000-000000000001',
    null,
    'visitor-direct-traffic-0001'
  ),
  'direct traffic without a recent exposure must not be attributed'
);

do $$
begin
  begin
    perform public.record_novel_exposure_conversion(
      'episode_read_10s',
      '10000000-0000-0000-0000-000000000001',
      '22000000-0000-0000-0000-000000000001',
      'visitor-funnel-reader-0001'
    );
    raise exception 'mismatched episode unexpectedly converted';
  exception
    when check_violation then null;
  end;
end
$$;

-- Premium's dedicated extra slot is measurable separately from general exposure.
select public.test_assert(
  public.record_novel_impressions(
    'home_premium_slot',
    array['81000000-0000-0000-0000-000000000003'],
    'visitor-premium-funnel-0001'
  ) = 1,
  'Premium extra-slot impression must be recorded'
);

select public.test_assert(
  public.record_novel_exposure_conversion(
    'detail_open',
    '81000000-0000-0000-0000-000000000003',
    null,
    'visitor-premium-funnel-0001'
  ),
  'Premium extra-slot detail conversion must be attributable'
);

reset role;

-- Authors only receive aggregate rows for their own exposure history.
set role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-1111-1111-111111111111',
  false
);

select public.test_assert(
  exists (
    select 1
    from public.novelight_author_exposure_funnel(30)
    where novel_id = '10000000-0000-0000-0000-000000000001'
      and impressions = 1
      and detail_opens = 1
      and body_reads_10s = 1
      and detail_rate_pct = 100.00
      and body_read_rate_pct = 100.00
  ),
  'author funnel must aggregate impression-to-detail-to-reading conversion'
);

-- Even if an author receives an impression event for their own work, their own
-- browsing must never become a discovery conversion.
select public.test_assert(
  public.record_novel_impressions(
    'home_discovery',
    array['10000000-0000-0000-0000-000000000001'],
    null
  ) = 1,
  'authenticated self-view fixture impression must be recorded for the guard test'
);

select public.test_assert(
  not public.record_novel_exposure_conversion(
    'detail_open',
    '10000000-0000-0000-0000-000000000001',
    null,
    null
  ),
  'author self-view must not count as a discovery conversion'
);

select set_config(
  'request.jwt.claim.sub',
  '22222222-2222-2222-2222-222222222222',
  false
);

select public.test_assert(
  not exists (
    select 1
    from public.novelight_author_exposure_funnel(30)
    where novel_id = '10000000-0000-0000-0000-000000000001'
  ),
  'authors must not receive another author''s funnel rows'
);

select set_config(
  'request.jwt.claim.sub',
  '55555555-5555-5555-5555-555555555555',
  false
);

select public.test_assert(
  exists (
    select 1
    from public.novelight_author_exposure_funnel(30)
    where novel_id = '81000000-0000-0000-0000-000000000003'
      and premium_slot_impressions = 1
      and premium_slot_detail_opens = 1
  ),
  'Premium extra exposure must be reported separately in author analytics'
);

reset role;

select public.test_assert(
  (select count(*) = 3 from public.novel_exposure_conversions),
  'only valid attributed conversions should be stored'
);

select 'PASS: exposure-to-reading funnel attribution' as result;
