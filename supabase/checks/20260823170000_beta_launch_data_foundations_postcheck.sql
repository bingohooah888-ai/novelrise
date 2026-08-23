\set ON_ERROR_STOP on

select public.test_assert(to_regclass('public.content_reports') is not null, 'content reports table exists');
select public.test_assert(to_regclass('public.acquisition_touches') is not null, 'acquisition touches table exists');
select public.test_assert(to_regclass('public.beta_activity_days') is not null, 'activity ledger exists');
select public.test_assert(to_regclass('public.reader_journey_events') is not null, 'reader journey ledger exists');
select public.test_assert(to_regclass('public.founding_authors') is not null, 'founding authors table exists');
select public.test_assert(to_regclass('public.subscription_event_log') is not null, 'subscription event log exists');
select public.test_assert(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'novels' and column_name = 'ai_usage'
  ),
  'novels has AI classification'
);
select public.test_assert(
  not has_table_privilege('anon', 'public.content_reports', 'SELECT')
  and not has_table_privilege('authenticated', 'public.content_reports', 'SELECT'),
  'raw reports are private'
);
select public.test_assert(
  not has_table_privilege('anon', 'public.reader_journey_events', 'SELECT')
  and not has_table_privilege('authenticated', 'public.reader_journey_events', 'SELECT'),
  'raw reader journey events are private'
);
