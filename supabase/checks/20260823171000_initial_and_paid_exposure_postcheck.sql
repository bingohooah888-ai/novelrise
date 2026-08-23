\set ON_ERROR_STOP on

select public.test_assert(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'novel_exposure_rules' and column_name = 'initial_exposure_target'
  ),
  'initial exposure target exists'
);
select public.test_assert(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'novelight_discovery_feed_v2'
  ),
  'v2 discovery RPC exists'
);
select public.test_assert(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'novelight_plan_extra_feed'
  ),
  'plan extra RPC exists'
);
select public.test_assert(
  not has_table_privilege('anon', 'public.novel_exposure_events', 'SELECT')
  and not has_table_privilege('authenticated', 'public.novel_exposure_events', 'SELECT'),
  'raw exposure ledger remains private'
);
