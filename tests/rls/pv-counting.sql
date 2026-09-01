\set ON_ERROR_STOP on

-- Anonymous readers are counted once per episode in the rolling six-hour window.
set role anon;
select set_config('request.jwt.claim.sub', '', false);

select public.test_assert(
  public.record_episode_pv(
    '11000000-0000-0000-0000-000000000001',
    'pv-visitor-alpha'
  ),
  'first anonymous episode read should count'
);

select public.test_assert(
  not public.record_episode_pv(
    '11000000-0000-0000-0000-000000000001',
    'pv-visitor-alpha'
  ),
  'same anonymous reader must not count twice inside six hours'
);

select public.test_assert(
  public.record_episode_pv(
    '11000000-0000-0000-0000-000000000001',
    'pv-visitor-beta'
  ),
  'a different anonymous reader should count independently'
);

reset role;

select public.test_assert(
  (select pv = 2 from public.episodes
    where id = '11000000-0000-0000-0000-000000000001'),
  'episode PV should equal two accepted anonymous reads'
);
select public.test_assert(
  (select pv = 2 from public.novels
    where id = '10000000-0000-0000-0000-000000000001'),
  'work PV must update atomically with episode PV'
);

-- Authenticated authors never count their own work.
set role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-1111-1111-111111111111',
  false
);
select public.test_assert(
  not public.record_episode_pv(
    '11000000-0000-0000-0000-000000000001',
    null
  ),
  'author must not count own episode PV'
);

-- Authenticated readers are deduped by account rather than browser token.
select set_config(
  'request.jwt.claim.sub',
  '33333333-3333-3333-3333-333333333333',
  false
);
select public.test_assert(
  public.record_episode_pv(
    '11000000-0000-0000-0000-000000000001',
    'ignored-for-authenticated-reader'
  ),
  'first authenticated reader view should count'
);
select public.test_assert(
  not public.record_episode_pv(
    '11000000-0000-0000-0000-000000000001',
    'rotated-but-ignored-token'
  ),
  'authenticated token rotation must not bypass the six-hour guard'
);

-- Draft episodes and episodes whose parent work is not published never count.
select public.test_assert(
  not public.record_episode_pv(
    '11000000-0000-0000-0000-000000000002',
    null
  ),
  'draft episode must not count PV'
);
select public.test_assert(
  not public.record_episode_pv(
    '11000000-0000-0000-0000-000000000003',
    null
  ),
  'episode under draft work must not count PV'
);

reset role;

select public.test_assert(
  (select pv = 3 from public.episodes
    where id = '11000000-0000-0000-0000-000000000001'),
  'author/draft rejection must leave only three accepted reads'
);
select public.test_assert(
  (select pv = 3 from public.novels
    where id = '10000000-0000-0000-0000-000000000001'),
  'work PV must stay aligned after rejected reads'
);

-- A short anonymous token is rejected before any counter mutation.
set role anon;
select set_config('request.jwt.claim.sub', '', false);
do $$
begin
  begin
    perform public.record_episode_pv(
      '11000000-0000-0000-0000-000000000001',
      'short'
    );
    raise exception 'short anonymous visitor token unexpectedly accepted';
  exception
    when sqlstate '22023' then null;
  end;
end
$$;
reset role;

-- After the rolling window expires, the same viewer can count once again.
update public.episode_pv_events
   set counted_at = now() - interval '7 hours'
 where viewer_key_hash = md5('visitor:' || 'pv-visitor-alpha')
   and episode_id_snapshot = '11000000-0000-0000-0000-000000000001';

set role anon;
select set_config('request.jwt.claim.sub', '', false);
select public.test_assert(
  public.record_episode_pv(
    '11000000-0000-0000-0000-000000000001',
    'pv-visitor-alpha'
  ),
  'same reader should count after the rolling six-hour window expires'
);
reset role;

select public.test_assert(
  (select pv = 4 from public.episodes
    where id = '11000000-0000-0000-0000-000000000001'),
  'episode PV should count exactly four accepted reads'
);
select public.test_assert(
  (select pv = 4 from public.novels
    where id = '10000000-0000-0000-0000-000000000001'),
  'work and episode PV must remain aligned'
);
select public.test_assert(
  (select count(*) = 4 from public.episode_pv_events
    where episode_id_snapshot = '11000000-0000-0000-0000-000000000001'),
  'PV audit ledger must contain one row per accepted count'
);

-- Browser roles can only use the guarded RPC, never raw event rows or legacy
-- direct counter writers.
select public.test_assert(
  not has_table_privilege('anon', 'public.episode_pv_events', 'SELECT')
  and not has_table_privilege('authenticated', 'public.episode_pv_events', 'SELECT')
  and not has_table_privilege('anon', 'public.episode_pv_events', 'INSERT')
  and not has_table_privilege('authenticated', 'public.episode_pv_events', 'INSERT'),
  'raw PV event ledger must stay server-only'
);
select public.test_assert(
  coalesce(
    not has_function_privilege(
      'anon',
      to_regprocedure('public.increment_novel_pv(bigint)'),
      'EXECUTE'
    ),
    true
  )
  and coalesce(
    not has_function_privilege(
      'authenticated',
      to_regprocedure('public.increment_novel_pv(bigint)'),
      'EXECUTE'
    ),
    true
  ),
  'legacy novel PV increment must not be browser-callable'
);
select public.test_assert(
  coalesce(
    not has_function_privilege(
      'anon',
      to_regprocedure('public.increment_episode_pv(bigint)'),
      'EXECUTE'
    ),
    true
  )
  and coalesce(
    not has_function_privilege(
      'authenticated',
      to_regprocedure('public.increment_episode_pv(bigint)'),
      'EXECUTE'
    ),
    true
  ),
  'legacy episode PV increment must not be browser-callable'
);

select 'PASS: authoritative PV counting behavior' as result;
