\set ON_ERROR_STOP on

select public.test_assert(
  not has_table_privilege('anon', 'public.novel_exposure_events', 'INSERT')
  and not has_table_privilege('authenticated', 'public.novel_exposure_events', 'INSERT'),
  'clients must not write the exposure ledger directly'
);

select public.test_assert(
  not has_table_privilege('anon', 'public.novel_exposure_events', 'SELECT')
  and not has_table_privilege('authenticated', 'public.novel_exposure_events', 'SELECT'),
  'clients must not read raw exposure viewer data'
);

set role anon;
select set_config('request.jwt.claim.sub', '', false);

select public.test_assert(
  exists (
    select 1
    from public.novelight_discovery_feed(
      'home_discovery',
      100,
      null,
      null,
      'visitor-feed-complete-0001'
    )
    where novel_id = '81000000-0000-0000-0000-000000000001'
      and author_plan = 'free'
  ),
  'Free works must remain eligible for discovery'
);

select public.test_assert(
  exists (
    select 1
    from public.novelight_discovery_feed(
      'home_discovery',
      100,
      null,
      null,
      'visitor-feed-complete-0002'
    )
    where novel_id = '81000000-0000-0000-0000-000000000002'
      and author_plan = 'standard'
  ),
  'Standard works must remain eligible for discovery'
);

select public.test_assert(
  exists (
    select 1
    from public.novelight_discovery_feed(
      'home_discovery',
      100,
      null,
      null,
      'visitor-feed-complete-0003'
    )
    where novel_id = '81000000-0000-0000-0000-000000000003'
      and author_plan = 'premium'
  ),
  'Premium works must remain eligible for discovery'
);

select public.test_assert(
  (
    select count(*) <= 1
    from public.novelight_discovery_feed(
      'home_discovery',
      3,
      null,
      null,
      'visitor-premium-slot-0001'
    )
    where is_premium_slot
  ),
  'Home feed may contain at most one dedicated Premium slot'
);

select public.test_assert(
  not exists (
    select 1
    from public.novelight_discovery_feed(
      'search_recommended',
      100,
      null,
      null,
      'visitor-search-no-slot-0001'
    )
    where is_premium_slot
  ),
  'Search recommended results must not add a dedicated Premium slot'
);

select public.test_assert(
  (
    select count(*) = 1
    from public.novelight_discovery_feed(
      'search_recommended',
      100,
      'Free discovery',
      'SF',
      'visitor-search-filter-0001'
    )
    where novel_id = '81000000-0000-0000-0000-000000000001'
  ),
  'Search discovery feed must honor keyword and genre filters'
);

select public.test_assert(
  public.record_novel_impressions(
    'home_discovery',
    array['81000000-0000-0000-0000-000000000001'],
    'visitor-impression-dedupe-0001'
  ) = 1,
  'First visible impression must be recorded'
);

select public.test_assert(
  public.record_novel_impressions(
    'home_discovery',
    array['81000000-0000-0000-0000-000000000001'],
    'visitor-impression-dedupe-0001'
  ) = 0,
  'Same visitor/work/surface impression must dedupe within the hour'
);

reset role;

-- Artificially give the Free fixture author much more recent exposure. The
-- allocator should then send a fresh visitor to a less-exposed author first,
-- proving allocation reacts to relative opportunity rather than static plan rank.
do $$
declare
  i integer;
begin
  perform set_config('request.jwt.claim.sub', '', false);

  for i in 1..20 loop
    perform public.record_novel_impressions(
      'home_discovery',
      array['81000000-0000-0000-0000-000000000001'],
      'fixture-heavy-free-' || lpad(i::text, 3, '0')
    );
  end loop;
end
$$;

set role anon;
select set_config('request.jwt.claim.sub', '', false);

select public.test_assert(
  (
    select author_id <> '33333333-3333-3333-3333-333333333333'::uuid
    from public.novelight_discovery_feed(
      'home_discovery',
      1,
      null,
      null,
      'visitor-relative-allocation-0001'
    )
    where not is_premium_slot
    order by feed_position
    limit 1
  ),
  'Heavily exposed author must yield the next general opportunity to a less-exposed author'
);

select public.test_assert(
  (
    select count(*) = count(distinct author_id)
    from public.novelight_discovery_feed(
      'home_discovery',
      5,
      null,
      null,
      'visitor-author-diversity-0001'
    )
    where not is_premium_slot
  ),
  'First discovery pass should prefer one work per author before second works'
);

reset role;

select public.test_assert(
  exists (
    select 1
    from public.novel_exposure_events
    where novel_id_snapshot = '81000000-0000-0000-0000-000000000001'
      and plan_snapshot = 'free'
  ),
  'Exposure ledger must snapshot the author plan at impression time'
);

select public.test_assert(
  exists (
    select 1
    from public.novel_exposure_rules
    where id = 1
      and free_weight = 1.000
      and standard_weight = 1.350
      and premium_weight = 1.600
      and premium_new_work_boost = 1.200
      and premium_new_work_hours = 48
  ),
  'Beta exposure weights must match the reviewed conservative rule set'
);

do $$
begin
  begin
    perform public.novelight_discovery_feed(
      'ranking',
      10,
      null,
      null,
      'visitor-invalid-surface'
    );
    raise exception 'invalid discovery surface unexpectedly succeeded';
  exception
    when sqlstate '22023' then null;
  end;

  begin
    perform public.record_novel_impressions(
      'home_discovery',
      array_fill('81000000-0000-0000-0000-000000000001'::text, array[25]),
      'visitor-too-large-batch'
    );
    raise exception 'oversized impression batch unexpectedly succeeded';
  exception
    when sqlstate '22023' then null;
  end;
end
$$;

select 'PASS: beta exposure allocation behavior' as result;
